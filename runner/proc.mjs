// What a test costs besides time: memory, CPU, threads, disk and IO of the runner and of the processes it
// started, read from /proc. Linux only. Elsewhere the readings are left out, never guessed.
//
// A system that runs in the runner's process, such as RAMA and DuckDB, shows up as the runner. A server it
// starts, such as PostgreSQL and ClickHouse, shows up as a descendant of the runner.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const available = fs.existsSync('/proc/self/stat');
const read = (file) => {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return null;
    }
};
const MB = 2 ** 20;
const mb = (bytes) => Number((bytes / MB).toFixed(1));
const ticksPerSecond = (() => {
    if (!available) return 100;
    try {
        return Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim()) || 100;
    } catch {
        return 100;
    }
})();

// --- parsing /proc, apart from reading it, so it can be checked on a fixed text ------------------------------

/**
 * /proc/<pid>/status: { rssKB, hwmKB, threads, anonKB, fileKB, shmemKB }. hwm is the peak resident size since the last reset.
 * The resident size is the sum of anon (heap, stack), file (mapped files, a database file mmap'd included) and shmem.
 */
export function parseStatus(text) {
    const n = (name) => Number(new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? 0);
    return { rssKB: n('VmRSS'), hwmKB: n('VmHWM'), threads: n('Threads'), anonKB: n('RssAnon'), fileKB: n('RssFile'), shmemKB: n('RssShmem') };
}

/** /proc/<pid>/io: the bytes this process had its storage read and written. Not the bytes of read() calls that the page cache served. */
export function parseIo(text) {
    const n = (name) => Number(new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(text)?.[1]);
    const readBytes = n('read_bytes');
    return Number.isNaN(readBytes) ? null : { readBytes, writeBytes: n('write_bytes') };
}

/** /proc/<pid>/stat: { ppid, user, sys, start } in clock ticks. The name in it may hold spaces and brackets, so the fields count from the last ')'. */
export function parseStat(text) {
    const f = text.slice(text.lastIndexOf(')') + 2).split(' ');
    return { ppid: Number(f[1]), user: Number(f[11]), sys: Number(f[12]), start: f[19] };
}

/** The kernel writes a space, tab, newline and backslash in a mount point as \040, \011, \012 and \134. */
const unescapeMount = (s) => s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));

/** /proc/self/mountinfo: the file system holding `target`, { type, source, mount }, from the longest mount point that contains it. */
export function parseMountInfo(text, target) {
    let best = null;
    for (const line of text.split('\n')) {
        const [left, right] = line.split(' - ');
        if (!right) continue;
        const mount = unescapeMount(left.split(' ')[4]);
        if (target !== mount && !target.startsWith(mount.endsWith('/') ? mount : mount + '/')) continue;
        if (!best || mount.length > best.mount.length) best = { type: right.split(' ')[0], source: right.split(' ')[1], mount };
    }
    return best;
}

// --- the processes -------------------------------------------------------------------------------------------

/** `root` and all its descendants, now. */
function tree(root) {
    const children = new Map();
    for (const name of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(name)) continue;
        const stat = read(`/proc/${name}/stat`);
        if (!stat) continue;
        const { ppid } = parseStat(stat);
        if (!children.has(ppid)) children.set(ppid, []);
        children.get(ppid).push(Number(name));
    }
    const all = [root];
    for (let i = 0; i < all.length; i++) all.push(...(children.get(all[i]) ?? []));
    return all;
}

/** Whether the readings are taken after run `index` of `total`: the first and the last. */
export const samplesAfterRun = (index, total) => index === 0 || index === total - 1;

/**
 * Measures one stretch of work, such as a test. sample() reads the runner and every process below it, and
 * remembers the last reading of a process that has ended since. So what ended between two samples is
 * counted up to its last sample: a server stopped in a test's teardown, up to the end of the test's last run.
 */
export class Meter {
    constructor(root = process.pid) {
        this.root = root;
        this.seen = new Map(); // `${pid}:${start time}` -> { base, last }
        this.marks = {};
        this.threads = 0;
        this.peak = { hwm: 0, rss: 0, anon: 0, file: 0, shmem: 0 };
        this.clearOk = false;
        this.ctx = process.resourceUsage().involuntaryContextSwitches;
        this.sample(true);
    }

    /** Sets every process's peak resident size to its current one, so the peak that follows belongs to what follows. */
    resetPeak() {
        this.clearOk = true;
        for (const pid of tree(this.root)) {
            try {
                fs.writeFileSync(`/proc/${pid}/clear_refs`, '5');
            } catch {
                this.clearOk = false;
            }
        }
        this.peak = { hwm: 0, rss: 0, anon: 0, file: 0, shmem: 0 };
        this.sample();
    }

    /** Reads the tree. Returns its resident memory, in KB. */
    sample(first = false) {
        let rss = 0;
        let hwm = 0;
        let threads = 0;
        let anon = 0;
        let file = 0;
        let shmem = 0;
        for (const pid of tree(this.root)) {
            const stat = read(`/proc/${pid}/stat`);
            const status = read(`/proc/${pid}/status`);
            if (!stat || !status) continue;
            const s = parseStat(stat);
            const m = parseStatus(status);
            const io = parseIo(read(`/proc/${pid}/io`) ?? '');
            rss += m.rssKB;
            hwm += m.hwmKB;
            threads += m.threads;
            anon += m.anonKB;
            file += m.fileKB;
            shmem += m.shmemKB;
            const now = { user: s.user, sys: s.sys, readBytes: io?.readBytes ?? 0, writeBytes: io?.writeBytes ?? 0, io: io !== null };
            const key = `${pid}:${s.start}`;
            // What was there at the start is measured from then. A process started since counts from 0.
            if (!this.seen.has(key)) this.seen.set(key, { base: first ? now : { user: 0, sys: 0, readBytes: 0, writeBytes: 0 }, last: now });
            this.seen.get(key).last = now;
        }
        this.threads = Math.max(this.threads, threads);
        this.peak.hwm = Math.max(this.peak.hwm, hwm);
        // The split is that of the sample with the most resident memory: a reading, not a peak of its own.
        if (rss > this.peak.rss) Object.assign(this.peak, { rss, anon, file, shmem });
        return rss;
    }

    /** Samples, and keeps the resident memory under `name`. The first one of a name stays, unless `again`. */
    mark(name, again = false) {
        const rss = this.sample();
        if (again || !(name in this.marks)) this.marks[name] = mb(rss * 1024);
    }

    /**
     * After run `index` of `total`: reads /proc only after the first and the last run, and does nothing for the ones
     * between, so no scan lands between two timed runs. The peak between the two is held by each process's VmHWM.
     */
    afterRun(index, total) {
        if (!samplesAfterRun(index, total)) return;
        const rss = mb(this.sample() * 1024);
        if (index === 0) this.marks.afterFirstRun = rss;
        if (index === total - 1) this.marks.afterLastRun = rss;
    }

    /** The readings so far, as they go in the results. */
    result() {
        this.sample();
        let user = 0;
        let sys = 0;
        let readBytes = 0;
        let writeBytes = 0;
        for (const { base, last } of this.seen.values()) {
            user += last.user - base.user;
            sys += last.sys - base.sys;
            readBytes += last.readBytes - base.readBytes;
            writeBytes += last.writeBytes - base.writeBytes;
        }
        const ms = (ticks) => Math.round((ticks * 1000) / ticksPerSecond);
        const own = this.seen.get(`${this.root}:${parseStat(read(`/proc/${this.root}/stat`)).start}`);
        return {
            // An UPPER BOUND of the peak: the VmHWM of each process added up, though the processes peaked at different times.
            peakRssUpperBoundMB: mb((this.clearOk ? this.peak.hwm : this.peak.rss) * 1024),
            peakSource: this.clearOk ? 'sum of the VmHWM of each process since the start of the test' : 'largest resident memory at a sample',
            // What the resident memory was made of at the sample where it was largest. RssFile holds mapped files.
            rssSplitMB: { anon: mb(this.peak.anon * 1024), file: mb(this.peak.file * 1024), shmem: mb(this.peak.shmem * 1024) },
            rssMB: this.marks,
            cpuMs: { user: ms(user), sys: ms(sys) },
            involuntaryCtxSwitches: process.resourceUsage().involuntaryContextSwitches - this.ctx,
            threads: this.threads,
            ...(own?.last.io ? { io: { readBytes, writeBytes, source: 'proc-io:runner+children' } } : {}),
        };
    }
}

// --- the disk and the machine --------------------------------------------------------------------------------

/** The size of a folder in MB: the bytes of its files, and the bytes the file system gave them. A hard link counts once. */
export function diskUsage(dir) {
    let apparent = 0;
    let allocated = 0;
    const links = new Set();
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const file = path.join(d, e.name);
            if (e.isDirectory()) {
                walk(file);
                continue;
            }
            const st = fs.lstatSync(file);
            if (st.nlink > 1) {
                if (links.has(`${st.dev}:${st.ino}`)) continue;
                links.add(`${st.dev}:${st.ino}`);
            }
            apparent += st.size;
            allocated += st.blocks * 512;
        }
    };
    try {
        walk(dir);
    } catch {
        return null;
    }
    return { apparent: mb(apparent), allocated: mb(allocated) };
}

const cpuTimes = () => {
    const f = read('/proc/stat')?.split('\n')[0].split(/\s+/).slice(1).map(Number);
    // The first eight fields (user to steal). guest and guest_nice follow them and are already inside user and nice.
    return f && { total: f.slice(0, 8).reduce((a, b) => a + b, 0), steal: f[7] ?? 0 };
};

/**
 * What the machine was like: the kernel, the CPU governor, the load and the steal time (the share of time
 * a virtual machine's CPUs waited for the host), the file system of `work`, and how the runner was
 * scheduled. snapshot() reads the end of it again. Without /proc only the kernel is known.
 */
export function environment(work) {
    if (!available) return { snapshot: () => ({ source: 'unavailable', kernel: `${os.type()} ${os.release()}` }) };
    const start = { load: os.loadavg(), cpu: cpuTimes() };
    const governor = read('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor')?.trim() ?? null;
    const filesystem = parseMountInfo(read('/proc/self/mountinfo') ?? '', fs.realpathSync(work));
    let scheduling = null;
    try {
        scheduling = execFileSync('ps', ['-o', 'cls=,rtprio=', '-p', String(process.pid)], { encoding: 'utf8' }).trim().replace(/\s+/g, ' ');
    } catch {}
    return {
        snapshot() {
            const end = cpuTimes();
            const total = end && start.cpu ? end.total - start.cpu.total : 0;
            return {
                source: 'linux-proc',
                kernel: `${os.type()} ${os.release()}`,
                governor,
                filesystem: filesystem?.type ?? null,
                scheduling,
                load: { start: start.load.map((x) => Number(x.toFixed(2))), end: os.loadavg().map((x) => Number(x.toFixed(2))) },
                stealPercent: total > 0 ? Number((((end.steal - start.cpu.steal) / total) * 100).toFixed(2)) : null,
            };
        },
    };
}
