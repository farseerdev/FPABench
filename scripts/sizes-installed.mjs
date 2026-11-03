// The files an entry's system takes on disk once it is installed: its packages, its native libraries and its
// server programs.
//
//   node scripts/sizes-installed.mjs <entry>
//
// It prints the sizes as JSON, or null when none of the entry is installed. The runner calls the same
// function and stores the same object in the results as `installSize`, or leaves the field out for that null.
// The runner calls it after it has loaded the entry's db.mjs, which can set environment variables of its own.
//
// Sizes are the bytes of file content (what `du -sb` counts), in MiB, rounded to 0.01. A file that has
// several hard links is counted once. A link itself is counted as a link and not followed. If a folder or a
// file cannot be read, or the entry.json is not valid, there is no result, never a partial one.
//
// The packages are systems/<entry>/node_modules. What is installed elsewhere is listed in the entry's
// entry.json under `programs`, each one { name, env, path, probe?, extra? }:
//   env    the environment variable that points to the program, as the system's db.mjs reads it. When it
//          is set it is used as it is.
//   path   a file or folder, or a list of them: the first that exists is used. `${VAR}` in it is the
//          environment variable VAR, and a path with an unset variable is skipped. A bare name is looked up
//          on the PATH (with .exe and the other PATHEXT endings on Windows).
//   probe  for a folder: the file in it that shows it is the right one, such as `postgres`. If none of the
//          paths is right, the probe is looked up on the PATH and its folder is used.
//   extra  more folders that belong to the program, such as `../lib`: relative to the program's folder
//          (with its links resolved) or absolute. Those that exist are included.
// A folder with a package.json is measured as the files `npm pack` would ship, which leaves out a source
// checkout's .git, build folders and tests. A program that is not there, or that lies inside what is
// already measured (such as an addon in node_modules or in the package folder), is left out.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MiB = 2 ** 20;
const mb = (bytes) => Number((bytes / MiB).toFixed(2));
// A native library or addon, and the smallest one worth listing.
const NATIVE = /\.(node|so(\.\d+)*|dylib|dll)$/;
const NATIVE_MIN = MiB;

/** What one measurement has seen: the files with several hard links, and the roots that are measured. */
const newMeasure = () => ({ links: new Set(), roots: [] });

/** The size of a file on disk, 0 when a hard link of it was counted before, null when it is gone. A link is not followed. */
function sizeOnce(m, file) {
    let st;
    try {
        st = fs.lstatSync(file, { bigint: true });
    } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
    }
    if (st.nlink > 1n) {
        const id = `${st.dev}:${st.ino}`;
        if (m.links.has(id)) return 0;
        m.links.add(id);
    }
    return Number(st.size);
}

/** The files under `dir`, as { file, bytes }, without the entries named in `skip`. A file that vanishes while it is walked is skipped, any other error is thrown. */
function* walk(m, dir, skip = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.includes(e.name)) continue;
        const file = path.join(dir, e.name);
        if (e.isDirectory()) yield* walk(m, file, skip);
        else {
            const bytes = sizeOnce(m, file);
            if (bytes !== null) yield { file, bytes };
        }
    }
}

const isFile = (p) => {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
};
const isDir = (p) => {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
};

/** Where a bare program name is on the PATH, or null. */
function onPath(name) {
    const ends = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT').toLowerCase().split(';').filter(Boolean)] : [''];
    for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean))
        for (const end of ends) {
            const p = path.join(dir, name + end);
            if (isFile(p)) return p;
        }
    return null;
}

/** The files `npm pack` would ship from a package folder, as { file, bytes }, or null if npm cannot say. */
function packed(dir) {
    try {
        const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--silent'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' });
        return JSON.parse(out)[0].files.map((f) => ({ file: path.join(dir, f.path), bytes: f.size }));
    } catch {
        return null;
    }
}

const real = (p) => fs.realpathSync(p);
const inside = (p, dir) => p === dir || p.startsWith(dir + path.sep);
const expand = (s) => {
    let missing = false;
    const out = s.replace(/\$\{(\w+)\}/g, (_, v) => process.env[v] ?? ((missing = true), ''));
    return missing ? null : out;
};

/** The place of a program: the file or folder to measure, or null. Follows the same order as the system's db.mjs. */
function locate({ env, path: where, probe }) {
    const fromEnv = env && process.env[env];
    const candidates = fromEnv ? [fromEnv] : [where ?? []].flat().map(expand).filter(Boolean);
    for (const c of candidates) {
        if (path.basename(c) === c) {
            const p = onPath(c);
            if (p) return p;
        } else if (fs.existsSync(c) && (!probe || !isDir(c) || fs.existsSync(path.join(c, probe)) || fs.existsSync(path.join(c, probe + '.exe')))) return c;
    }
    if (!fromEnv && probe) {
        const p = onPath(probe);
        if (p) return path.dirname(real(p));
    }
    return null;
}

/** Adds the size of a file or folder to what is measured: the bytes, or null when it lies inside what is measured already. */
function measure(m, place) {
    const at = real(place);
    if (m.roots.some((r) => inside(at, r))) return null;
    m.roots.push(at);
    if (!isDir(at)) return sizeOnce(m, at) ?? 0;
    const files = (fs.existsSync(path.join(at, 'package.json')) && packed(at)) || walk(m, at, ['.git', 'node_modules']);
    return [...files].reduce((sum, f) => sum + f.bytes, 0);
}

/**
 * The installed size of an entry: { packagesMB, files, nativeMB, programsMB }, or null when nothing of it
 * is installed. nativeMB lists each native file of 1 MiB or more in the packages, by its path in them.
 * Throws if something cannot be read.
 */
export function installSize(entry) {
    const dir = path.join(root, 'systems', entry);
    const info = JSON.parse(fs.readFileSync(path.join(dir, 'entry.json'), 'utf8'));
    const specs = info.programs ?? [];
    if (!Array.isArray(specs) || specs.some((s) => !s || typeof s.name !== 'string')) throw new Error(`${entry}/entry.json: programs must be a list of { name, env, path }`);
    const m = newMeasure();
    const result = {};
    const modules = path.join(dir, 'node_modules');
    if (fs.existsSync(modules)) {
        m.roots.push(real(modules));
        let bytes = 0;
        let files = 0;
        const native = {};
        for (const f of walk(m, modules)) {
            bytes += f.bytes;
            files++;
            if (NATIVE.test(f.file) && f.bytes >= NATIVE_MIN) native[path.relative(modules, f.file).split(path.sep).join('/')] = mb(f.bytes);
        }
        Object.assign(result, { packagesMB: mb(bytes), files, nativeMB: native });
    }
    const programs = {};
    for (const spec of specs) {
        const place = locate(spec);
        if (!place) continue;
        let bytes = measure(m, place);
        if (bytes === null) continue;
        if (spec.extra && isDir(real(place)))
            for (const x of spec.extra) {
                const p = path.resolve(real(place), x);
                if (fs.existsSync(p)) bytes += measure(m, p) ?? 0;
            }
        programs[spec.name] = mb(bytes);
    }
    if (Object.keys(programs).length) result.programsMB = programs;
    return Object.keys(result).length ? result : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    if (!process.argv[2]) {
        console.error('usage: node scripts/sizes-installed.mjs <entry>');
        process.exit(2);
    }
    try {
        console.log(JSON.stringify(installSize(process.argv[2]), null, 1));
    } catch (e) {
        console.error(`no install size: ${e.message}`);
        process.exit(1);
    }
}
