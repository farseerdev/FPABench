// The FPABench runner. It runs one system's tests and writes the times, the checks and every answer.
//
//   node runner/run.mjs --entry rama --dataset <dir> --work <dir> --out <dir> --record <expected file>
//   node runner/run.mjs --entry <entry> --dataset <dir> --work <dir> --out <dir> --expected <expected file>
//   node runner/run.mjs --entry <entry> --dataset 10m --work <dir> --out <dir>    downloads 10m and its expected answers
//   options: [--tests L1,W3] [--machine <name>] [--quick]
//
// The picks, the cells each test writes, come with the dataset in picks.json. --record runs RAMA on them and
// saves every answer and check as the expected results, with the picks. Every other system is then held to
// those. When a system disagrees with RAMA, someone looks at which one is right.
//
// Each test is one file per system, systems/<entry>/tests/<id>.mjs, in the system's own calls:
//   setup(context)      gets the system ready, untimed
//   open(context)       optional, for R8: starts the system, inside the timer
//   run(context)        one timed run, from the first call to the proving read; returns the rows it read
//   check(context)      optional untimed checks after a run; returns { name: rows }
//   teardown(context)   untimed
// context holds the folders, the picks of the test, the pick of the run, and whatever setup puts in it.
// This file runs every test the same way, times run(), compares what it returns, and writes the results.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// --- the dataset and the folders ------------------------------------------------------------------------------

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The published datasets, by generator version. It changes with GENERATOR_VERSION in data/generate.mjs.
const DATA_URL = 'https://pub-508fd3a914ed495baefdd48005785ed9.r2.dev/data-0.6-draft';
const SIZES = ['10m', '100m', '1b', '10b'];

/**
 * Downloads a published size into `dir`, once: the dataset, expected.json and SHA256SUMS. Every file must
 * match its SHA-256 before the dataset is unpacked. Returns the dataset folder and the expected answers.
 */
async function download(size, dir) {
    const dataset = path.join(dir, `fpabench-${size}`);
    const expected = path.join(dir, 'expected.json');
    const kept = path.join(dir, 'SHA256SUMS');
    const complete = () => fs.existsSync(path.join(dataset, 'manifest.json')) && fs.existsSync(expected) && fs.existsSync(kept);
    fs.mkdirSync(dir, { recursive: true });
    const url = (name) => `${DATA_URL}/${size}/${name}`;
    // The list of files and their SHA-256. When it is the same as the copy kept from the last download, so is
    // the data. When it changed, a new version was published, and everything is downloaded again.
    let text;
    try {
        const res = await fetch(url('SHA256SUMS'));
        if (!res.ok) throw new Error(`${url('SHA256SUMS')}: ${res.status} ${res.statusText}`);
        text = await res.text();
    } catch (e) {
        if (!complete()) throw e;
        console.log(`could not check ${url('SHA256SUMS')} (${e.message}), so the copy in ${dir} is used`);
        return { dataset, expected };
    }
    if (complete() && fs.readFileSync(kept, 'utf8') === text) return { dataset, expected };
    for (const p of [dataset, expected, kept]) fs.rmSync(p, { recursive: true, force: true });
    // Each line is a SHA-256 and a file name, in text or binary mode. A name is a plain file name, never a path.
    const sums = text
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            const m = /^([0-9a-f]{64}) [ *]([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(line.trim());
            if (!m) throw new Error(`${url('SHA256SUMS')}: cannot read the line "${line}"`);
            return [m[1], m[2]];
        });
    // Each file is streamed to disk and hashed on the way, so a large archive never sits in memory.
    for (const [sha, name] of sums) {
        const res = await fetch(url(name));
        if (!res.ok) throw new Error(`${url(name)}: ${res.status} ${res.statusText}`);
        const hash = createHash('sha256');
        const file = fs.createWriteStream(path.join(dir, name));
        for await (const chunk of res.body) {
            hash.update(chunk);
            if (!file.write(chunk)) await new Promise((r) => file.once('drain', r));
        }
        await new Promise((r, no) => file.end((e) => (e ? no(e) : r())));
        if (hash.digest('hex') !== sha) throw new Error(`${name}: the download does not match its SHA-256`);
    }
    execFileSync('tar', ['-xzf', path.join(dir, `fpabench-${size}.tar.gz`), '-C', dir]);
    fs.rmSync(path.join(dir, `fpabench-${size}.tar.gz`));
    // Last, so a download that stopped half way is done again next time.
    fs.writeFileSync(kept, text);
    return { dataset, expected };
}

const args = process.argv.slice(2);
const opt = (name, dflt = null) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : dflt);
const entry = opt('entry');
if (!entry || !opt('dataset') || !opt('work') || !opt('out') || !(opt('record') || opt('expected') || SIZES.includes(opt('dataset')))) {
    console.error(`usage:
  node runner/run.mjs --entry <entry> --dataset <10m|100m|1b|10b> --work <dir> --out <dir>          downloads the size and its expected answers
  node runner/run.mjs --entry <entry> --dataset <dir> --work <dir> --out <dir> --expected <file>
  node runner/run.mjs --entry rama --dataset <dir> --work <dir> --out <dir> --record <file>
  options: [--tests L1,W3] [--machine <name>] [--quick]`);
    process.exit(2);
}
const work = path.resolve(opt('work'));
let dataset = path.resolve(opt('dataset'));
let expected = null;
if (SIZES.includes(opt('dataset'))) ({ dataset, expected } = await download(opt('dataset'), path.join(work, 'datasets', opt('dataset'))));
const out = path.resolve(opt('out'));
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const log = (...a) => {
    const line = `${new Date().toISOString()} ${a.join(' ')}`;
    console.log(line);
    fs.appendFileSync(path.join(out, `${entry}.log`), line + '\n');
};

// Everything kept in --work belongs to one dataset, named by the SHA-256 of its manifest.
const manifestText = fs.readFileSync(path.join(dataset, 'manifest.json'), 'utf8');
const manifest = JSON.parse(manifestText);
const datasetId = createHash('sha256').update(manifestText).digest('hex').slice(0, 16);
const cellsOf = (src, name) => {
    const dir = path.join(work, `cells-${datasetId}-${name}`);
    if (!fs.existsSync(path.join(dir, 'summary.json'))) execFileSync(process.execPath, [path.join(root, 'data', 'cells.mjs'), src, dir], { stdio: 'ignore' });
    return dir;
};
const baseCells = cellsOf(dataset, 'base');
const closeCells = cellsOf(path.join(dataset, 'increments', 'close-2026-07'), 'close-2026-07');
// The tests keep their system's files here.
const testWork = path.join(work, `${entry}-${datasetId}`);
fs.mkdirSync(testWork, { recursive: true });
const spec = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'tests.json'), 'utf8'));
const record = opt('record') ? path.resolve(opt('record')) : null;
const quick = args.includes('--quick');
const only = opt('tests') ? opt('tests').split(',') : null;
let picks;
if (record) {
    picks = { dataset: datasetId, reference: entry, quick, ...JSON.parse(fs.readFileSync(path.join(dataset, 'picks.json'), 'utf8')) };
    // --quick: one run of each load, bulk write, model change and read, and three writes per write test. Not for results.
    if (quick) {
        for (const [id, p] of Object.entries(picks)) {
            if (Array.isArray(p)) picks[id] = p.slice(0, 3);
            else if (p?.repeats) p.repeats = 1;
            else if (p?.warm) p.warm = 1;
        }
    }
    // With --tests, an expected file already there keeps the answers of every other test.
    if (only && fs.existsSync(record)) {
        const old = JSON.parse(fs.readFileSync(record, 'utf8'));
        if (old.dataset !== datasetId || old.quick !== quick) throw new Error(`${record} is for another dataset or another --quick, so it cannot take only ${only.join(', ')}`);
        for (const id of only) old[id] = picks[id];
        picks = old;
    }
} else {
    // A downloaded size brings RAMA's expected answers. --expected overrides them.
    const file = opt('expected') ? path.resolve(opt('expected')) : expected;
    if (!file) throw new Error('--expected is needed with a dataset folder');
    picks = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (picks.dataset !== datasetId) throw new Error(`the expected file is for dataset ${picks.dataset}, not ${datasetId}`);
    if (picks.quick !== quick) throw new Error(`the expected file was recorded ${picks.quick ? 'with' : 'without'} --quick, so this run must be too`);
}
const tol = spec.defaults.tolerance;
const system = (await import(path.join(root, 'systems', entry, 'db.mjs'))).system;

// The FPABench commit, with a + when the working tree has changes of its own.
const commit = (() => {
    try {
        const head = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
        const dirty = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
        return dirty ? `${head}+` : head;
    } catch {
        return 'unknown';
    }
})();
// What recorded the expected answers. An answer recorded with other tests, or by another version of the
// reference system, may not fit this run, so the run says so. A commit alone may differ: every system runs
// later than RAMA records.
if (record) picks.recorded = { system: system.name, version: system.version, commit, testsVersion: spec.version, date: new Date().toISOString().slice(0, 10) };
else if (picks.recorded) {
    const r = picks.recorded;
    if (r.testsVersion !== spec.version) console.error(`warning: the expected answers were recorded with tests ${r.testsVersion}, and these are tests ${spec.version}`);
    if (entry === picks.reference && r.version !== system.version) console.error(`warning: the expected answers were recorded on ${r.system} ${r.version}, and this is ${system.version}`);
}

// --- comparing answers --------------------------------------------------------------------------------------

const keyOf = (k) => JSON.stringify(Object.keys(k).sort().map((d) => [d, k[d]]));
// Amounts match within 0.01 or a relative 1e-9, whichever is larger. A ratio, such as R4's gross margin %,
// is small, so 0.01 would hide a real error. Ratios match within a relative 1e-6, with a floor of 1e-12 so
// 0 against 5e-19 is no difference.
const near = (a, b, ratio = false) => {
    const diff = Math.abs((a ?? 0) - (b ?? 0));
    const size = Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0));
    return ratio ? diff <= Math.max(1e-12, tol.ratioRelative * size) : diff <= Math.max(tol.amountAbsolute, tol.amountRelative * size);
};

/** The rows of `got` that differ from `expected`, as problems. Both must have the same rows: a missing row is no value, not 0. */
function compare(expected, got, ratio = false) {
    const a = new Map(expected.map((r) => [keyOf(r.key), r.value]));
    const b = new Map(got.map((r) => [keyOf(r.key), r.value]));
    const problems = [];
    for (const k of new Set([...a.keys(), ...b.keys()])) {
        if (!b.has(k)) problems.push(`${k}: expected ${a.get(k)}, got no row`);
        else if (!a.has(k)) problems.push(`${k}: expected no row, got ${b.get(k)}`);
        else if (!near(a.get(k), b.get(k), ratio)) problems.push(`${k}: expected ${a.get(k)}, got ${b.get(k)}`);
    }
    return problems;
}

/** The rows of `got` that are not 0, as problems. For what must be 0, where a missing row is fine. */
const nonZero = (got) => got.filter((r) => !near(r.value, 0)).map((r) => `${keyOf(r.key)}: expected 0, got ${r.value}`);

/** Whether a pick says this must be 0: 'answer', a check's name, or 'every check'. Those are never recorded. */
const mustBeZero = (want, name) => (want.zero ?? []).includes(name) || (name !== 'answer' && (want.zero ?? []).includes('every check'));

// What every test gets: the folder it keeps its database in, and the input cells.
const base = { work: testWork, cells: { base: baseCells, close: closeCells } };

// --- summaries, as tests/method.md reports them. The website reads this format. -----------------------------

const round = (x) => Number(x.toPrecision(4));
const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const p95 = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
};

/** A write test: a warm-up, then timed writes. Each run is { ms, warmup }. */
function writeSummary(runs, problems, extra = {}) {
    const timed = runs.filter((r) => !r.warmup);
    const times = timed.map((r) => r.ms / 1000);
    return {
        check: problems.length ? 'wrong' : 'ok',
        time: round(median(times)),
        p95: round(p95(times)),
        warmup: runs.filter((r) => r.warmup).map((r) => round(r.ms / 1000)),
        runs: timed.map((r) => round(r.ms / 1000)),
        ...(problems.length ? { problems } : {}),
        ...extra,
    };
}

/** A read, a load, a bulk write or a model change: a few runs, each { ms }. */
function onceSummary(runs, problems, extra = {}) {
    return { check: problems.length ? 'wrong' : 'ok', time: round(median(runs.map((r) => r.ms / 1000))), runs: runs.map((r) => round(r.ms / 1000)), ...(problems.length ? { problems } : {}), ...extra };
}

// --- results ------------------------------------------------------------------------------------------------

// A run of some tests (--tests) adds to the results already in --out.
const prior = (name) => (only && fs.existsSync(path.join(out, name)) ? JSON.parse(fs.readFileSync(path.join(out, name), 'utf8')) : null);
const results = prior(`${entry}.json`)?.tests ?? {};
const answers = prior(`${entry}.answers.json`) ?? {};
function save() {
    const doc = {
        entry: entry,
        scale: manifest.size,
        machine: opt('machine', os.hostname()),
        date: new Date().toISOString().slice(0, 10),
        system,
        host: { platform: `${os.type()} ${os.release()}`, arch: os.arch(), cpus: os.cpus().length, cpu: os.cpus()[0]?.model, memoryGB: Math.round(os.totalmem() / 2 ** 30), node: process.version },
        testsVersion: spec.version,
        dataset: { sha256: datasetId },
        data: { generator: manifest.generator, size: manifest.size, seed: manifest.seed },
        seed: picks.seed,
        tests: results,
    };
    fs.writeFileSync(path.join(out, `${entry}.json`), JSON.stringify(doc, null, 1) + '\n');
    fs.writeFileSync(path.join(out, `${entry}.answers.json`), JSON.stringify(answers) + '\n');
}

// --- the tests ----------------------------------------------------------------------------------------------

const tests = [];
for (const t of spec.tests) {
    const file = path.join(root, 'systems', entry, 'tests', `${t.id.toLowerCase()}.mjs`);
    if (fs.existsSync(file) && (!only || only.includes(t.id))) tests.push({ ...t, ...(await import(file)).default });
}

/**
 * Runs a test.
 * A write test sets up once and runs once per pick, the first ones a warm-up.
 * A read sets up once and runs 5 times.
 * R8, a load, a bulk write, a model change or an untimed check sets up fresh for each of its repeats.
 * A test with open(), R8, has it inside the timer. A load's timer waits until the files are on disk.
 */
async function runTest(test, p) {
    const runs = [];
    const answers = {};
    const checks = {};
    const context = { ...base, picks: p, pick: Array.isArray(p) ? null : p };
    const once = async (run, pick) => {
        context.pick = pick;
        const t0 = performance.now();
        if (test.open) await test.open(context);
        answers[run] = await test.run(context);
        if (test.kind === 'load') execSync('sync');
        runs.push({ ms: performance.now() - t0, warmup: pick.warmup ?? false });
        if (test.check) checks[run] = await test.check(context);
    };
    // Setup, the runs, then teardown, which runs even when a step throws, so no server is left running. A
    // failed test's teardown gets context.failed, so L1 keeps no snapshot of a broken load. An error in that
    // teardown is logged, and the first error is the one reported.
    const guarded = async (runs) => {
        try {
            await test.setup(context);
            await runs();
        } catch (e) {
            context.failed = true;
            throw e;
        } finally {
            try {
                await test.teardown(context);
            } catch (e) {
                if (!context.failed) throw e;
                log(`${test.id} teardown after the error also failed: ${e?.message ?? e}`);
            }
        }
    };
    if (Array.isArray(p)) {
        await guarded(async () => {
            for (const [i, pick] of p.entries()) await once(i, pick);
        });
    } else if (p.warm) {
        await guarded(async () => {
            for (let i = 0; i < p.warm; i++) await once(i, p);
        });
    } else {
        for (let i = 0; i < p.repeats; i++) await guarded(() => once(i, p));
    }
    return { runs, answers, checks };
}

log(`entry ${entry}, ${system.name} ${system.version}, scale ${manifest.size}${record ? ', recording the expected results' : ''}`);
const started = performance.now();

// Every test but L1 starts from the snapshot L1 leaves. A run without L1 loads once first, untimed and not
// recorded, when the work folder has no snapshot of the current system files. snapshot.ok holds a SHA-256 of
// the files the snapshot is made from: the system's generated SQL or model JSON, its db.mjs and its L1.
const snapshotMark = path.join(testWork, 'snapshot.ok');
const systemHash = (() => {
    const hash = createHash('sha256');
    const dir = path.join(root, 'systems', entry);
    const walk = (rel) => {
        const full = path.join(dir, rel);
        if (!fs.existsSync(full)) return;
        if (fs.statSync(full).isDirectory()) for (const f of fs.readdirSync(full).sort()) walk(path.join(rel, f));
        else hash.update(`${rel}\n`).update(fs.readFileSync(full));
    };
    for (const rel of ['sql', 'model', 'db.mjs', path.join('tests', 'l1.mjs')]) walk(rel);
    return hash.digest('hex');
})();
const markOk = () => fs.existsSync(snapshotMark) && fs.readFileSync(snapshotMark, 'utf8').trim() === systemHash;
if (!tests.some((t) => t.id === 'L1') && !markOk()) {
    log('no snapshot of the current system files in this work folder: loading once to make one, untimed');
    const l1 = (await import(path.join(root, 'systems', entry, 'tests', 'l1.mjs'))).default;
    const context = { ...base };
    try {
        await l1.setup(context);
        await l1.run(context);
    } catch (e) {
        context.failed = true;
        throw e;
    } finally {
        await l1.teardown(context);
    }
    fs.writeFileSync(snapshotMark, systemHash + '\n');
}

// Whether the expected file has the answers of a test: every run has its expected answer, or must be 0.
const isRecorded = (p) => p !== undefined && (Array.isArray(p) ? p : [p]).every((w) => w.expect !== undefined || mustBeZero(w, 'answer'));

for (const test of tests) {
    // A test the expected file has no answers for is not run. It is "not recorded", not wrong.
    if (!record && !isRecorded(picks[test.id])) {
        results[test.id] = { check: 'not recorded', notes: 'the expected file has no answers for this test. Record it with --record --tests.' };
        log(`${test.id} not recorded`);
        save();
        continue;
    }
    log(`${test.id} start`);
    try {
        const p = picks[test.id];
        // L1 makes the snapshot again, so the mark goes until it has finished.
        if (test.id === 'L1') fs.rmSync(snapshotMark, { force: true });
        const result = await runTest(test, p);
        if (test.id === 'L1') fs.writeFileSync(snapshotMark, systemHash + '\n');

        // Each answer and each check against the expected results. When recording, the first answer is the
        // expected one, and later runs must give it again. What the pick says must be 0 is checked against 0.
        const problems = [];
        const ratio = test.expect?.some((e) => e.tolerance === 'ratioRelative');
        for (const [run, rows] of Object.entries(result.answers)) {
            const want = Array.isArray(p) ? p[run] : p;
            if (mustBeZero(want, 'answer')) for (const x of nonZero(rows)) problems.push(`run ${run}: ${x}`);
            else {
                if (record && want.expect === undefined) want.expect = rows;
                for (const x of compare(want.expect ?? [], rows, ratio)) problems.push(`run ${run}: ${x}`);
            }
            // Every check the expected results have, and every check the pick names as 0, must come back.
            // A pick whose every check must be 0, L1, keeps the names of the checks RAMA returned, so a system
            // that leaves one out fails.
            if (record && want.zero?.includes('every check') && want.checkNames === undefined) want.checkNames = Object.keys(result.checks[run] ?? {}).sort();
            const named = [...Object.keys(want.checks ?? {}), ...(want.zero ?? []).filter((n) => n !== 'answer' && n !== 'every check'), ...(want.checkNames ?? [])];
            for (const name of named) if (!(name in (result.checks[run] ?? {}))) problems.push(`run ${run}: check ${name} was not returned`);
            for (const [name, got] of Object.entries(result.checks[run] ?? {})) {
                if (mustBeZero(want, name)) for (const x of nonZero(got)) problems.push(`run ${run}: ${name} ${x}`);
                else {
                    if (record && want.checks?.[name] === undefined) (want.checks ??= {})[name] = got;
                    for (const x of compare(want.checks?.[name] ?? [], got)) problems.push(`run ${run}: ${name} ${x}`);
                }
            }
        }

        const extra = {
            ...(p.cells ? { cells: p.cells.length } : {}),
            ...(p.notChecked ? { notChecked: p.notChecked } : {}),
        };
        let summary;
        if (test.timed === false) summary = { check: problems.length ? 'wrong' : 'ok', timed: false, ...(problems.length ? { problems } : {}) };
        else if (test.kind === 'write' && test.runs !== 'bulk') summary = writeSummary(result.runs, problems, extra);
        else summary = onceSummary(result.runs, problems, extra);
        results[test.id] = summary;
        for (const [run, rows] of Object.entries(result.answers)) (answers[test.id] ??= {})[run] = [...rows].sort((a, b) => (keyOf(a.key) < keyOf(b.key) ? -1 : 1));
        log(`${test.id} ${summary.check}${summary.time !== undefined ? ` ${summary.time} s` : ''}${summary.p95 !== undefined ? ` p95 ${summary.p95} s` : ''}${problems.length ? ` ${problems.slice(0, 3).join(' | ')}` : ''}`);
    } catch (e) {
        results[test.id] = { check: 'error', error: String(e?.stack ?? e).split('\n').slice(0, 4).join(' ') };
        log(`${test.id} error ${String(e?.message ?? e)}`);
    }
    save();
}

// A record with a failed test writes nothing: the tests after it would have no answers to be held to.
const failed = tests.filter((t) => results[t.id]?.check !== 'ok').map((t) => t.id);
if (record && failed.length) {
    log(`expected results NOT written: ${failed.join(', ')} did not pass on ${entry}. Fix them and record again.`);
    process.exitCode = 1;
} else if (record) {
    fs.writeFileSync(record, JSON.stringify(picks, null, 1) + '\n');
    log(`expected results written to ${record}`);
}
log(`done in ${((performance.now() - started) / 60000).toFixed(1)} min`);
