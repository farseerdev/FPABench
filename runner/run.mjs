// The FPABench runner. It runs the tests of tests/tests.json against one system and writes the times,
// the checks and every answer. It is the same for every system. A system plugs in through an adapter
// in systems/<entry>/adapter.mjs: load, open, close, read, write, loadCells, changeModel, setModel.
//
//   node runner/run.mjs --entry <entry> --dataset <dataset dir> --work <dir> --out <dir>
//                       [--tests L1,W1,...] [--picks <file>] [--machine <name>] [--seed <n>] [--quick]
//
// tests/method.md says how each kind of test is timed, repeated and reset. In short:
//   - the timer runs on this side, from before the action to the end of the proving read
//   - L1 loads three times from empty. The state after it is the snapshot every other test starts from.
//   - a write test writes once to warm up, then 20 times, each to a fresh cell, and proves each write
//   - a bulk write, a later load and a model change run three times, each from the snapshot
//   - a read runs once cold, after a restart and an OS cache drop, then five times warm
//
// Picks come from the seed. The first system to run a test saves its picks to --picks, and every later
// system reuses them, so all systems write the same cells with the same values.
// A "value" expectation has no reference program yet. Its answer is saved, and runner/compare.mjs
// compares the answers of all systems. The other expectations are checked here.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadModel, MONTHS } from './lib/model.mjs';
import { changedModel } from './lib/changes.mjs';
import { Rng } from '../data/lib/rng.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt = null) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : dflt;
};
const entry = opt('entry');
const dataset = path.resolve(opt('dataset'));
const work = path.resolve(opt('work'));
const outDir = path.resolve(opt('out'));
const picksFile = opt('picks') && path.resolve(opt('picks'));
const machine = opt('machine', os.hostname());
const tests = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'tests.json'), 'utf8'));
const seed = Number(opt('seed', tests.defaults.seed));
let only = opt('tests') ? new Set(opt('tests').split(',')) : null;
const D = structuredClone(tests.defaults);
// --quick: one run of everything and two writes per group, to try the runner. Not for results.
if (args.includes('--quick')) {
    D.runs = { read: { cold: 1, warm: 1 }, write: { repeats: 2, warmup: 1 }, bulk: { repeats: 1 }, load: { repeats: 1 }, model: { repeats: 1 } };
    for (const t of tests.tests) if (t.runs?.repeats) t.runs.repeats = 2;
}
const FC = { Versions: D.version, Years: D.year };
const PLAN = D.planMonths;
const CLOSED = D.closedMonths;
const TOL = D.tolerance;

fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
const logFile = path.join(outDir, `${entry}.log`);
const log = (...a) => {
    const line = `${new Date().toISOString()} ${a.join(' ')}`;
    console.log(line);
    fs.appendFileSync(logFile, line + '\n');
};

// --- dataset --------------------------------------------------------------------------------------

// Which kinds of test run at which size. tests.json names the sizes, and until it uses the data's names
// (10m to 10b) the runner reads SF1 and SF10 as 10m and 100m, and SF100 and SF1000 as 1b and 10b.
const SIZE_OF = { SF1: '10m', SF10: '100m', SF100: '1b', SF1000: '10b' };
const sizesOf = (list) => list.map((x) => SIZE_OF[x] ?? x);
const manifestText = fs.readFileSync(path.join(dataset, 'manifest.json'), 'utf8');
const manifest = JSON.parse(manifestText);
const scale = manifest.size;
if (sizesOf(D.scales.loadsAndReadsOnly).includes(scale)) {
    const allowed = tests.tests.filter((t) => t.kind === 'load' || t.kind === 'read').map((t) => t.id);
    only = new Set((only ? [...only] : allowed).filter((id) => allowed.includes(id)));
} else if (!sizesOf(D.scales.everyTest).includes(scale)) throw new Error(`tests.json says nothing about size ${scale}`);
// Everything cached in --work (input cells, the system's files, the snapshot) and the picks belong to one
// dataset. They are keyed by the SHA-256 of its manifest, so another dataset never reuses them.
const datasetId = createHash('sha256').update(manifestText).digest('hex').slice(0, 16);
function cellsOf(src, name) {
    const out = path.join(work, `cells-${datasetId}-${name}`);
    if (!fs.existsSync(path.join(out, 'cells.csv'))) execFileSync(process.execPath, [path.join(root, 'data', 'cells.mjs'), src, out], { stdio: 'ignore' });
    return out;
}
const baseCells = cellsOf(dataset, 'base');
const closeCells = cellsOf(path.join(dataset, 'increments', 'close-2026-07'), 'close-2026-07');
const modelDir = path.join(root, 'model');
const base = loadModel(modelDir, baseCells);
let model = base;
const modelHash = createHash('sha256')
    .update(base.files.map((f) => fs.readFileSync(path.join(modelDir, f))).join('\n'))
    .digest('hex');

// --- the system -------------------------------------------------------------------------------------

const { create } = await import(path.join(root, 'systems', entry, 'adapter.mjs'));
const sysWork = path.join(work, `${entry}-${datasetId}`);
fs.mkdirSync(sysWork, { recursive: true });
const sys = await create({ work: sysWork, model: base });
const snapshotDir = path.join(work, `${entry}-${datasetId}-snapshot`);

// An adapter whose data is not plain files (a Docker volume, say) saves and loads its snapshot itself.
async function snapshot() {
    if (sys.saveSnapshot) {
        await sys.close();
        await sys.saveSnapshot(datasetId);
        fs.mkdirSync(snapshotDir, { recursive: true });
        await sys.open();
        return;
    }
    await sys.close();
    fs.rmSync(snapshotDir, { recursive: true, force: true });
    fs.mkdirSync(snapshotDir, { recursive: true });
    for (const p of sys.dataDirs()) fs.cpSync(p, path.join(snapshotDir, path.basename(p)), { recursive: true });
    await sys.open();
}
async function restore() {
    if (sys.loadSnapshot) {
        await sys.close();
        await sys.loadSnapshot(datasetId);
        model = base;
        sys.setModel(base);
        await sys.open();
        await settle();
        return;
    }
    await sys.close();
    for (const p of sys.stale?.() ?? []) fs.rmSync(p, { force: true });
    for (const p of sys.dataDirs()) {
        fs.rmSync(p, { recursive: true, force: true });
        fs.cpSync(path.join(snapshotDir, path.basename(p)), p, { recursive: true });
    }
    model = base;
    sys.setModel(base);
    await sys.open();
    await settle();
}
// Waits, untimed, until the system has finished the background work it started, such as compiling the
// plans of new statements. Called after a restore and after the cold run of R1 to R7, and just before a
// later load, a bulk write, a model change or the first timed write of a write test. An adapter whose
// system has no background work has no settle().
async function settle() {
    if (sys.settle) await sys.settle();
}
function dropCaches() {
    try {
        execSync('sync');
        if (process.platform === 'linux') execSync('sudo -n sh -c "echo 3 > /proc/sys/vm/drop_caches"');
        else if (process.platform === 'darwin') execSync('sudo -n purge');
        return true;
    } catch {
        return false;
    }
}

// --- helpers ------------------------------------------------------------------------------------------

const now = () => process.hrtime.bigint();
const ms = (t0, t1 = now()) => Number(t1 - t0) / 1e6;
const rng = new Rng(seed);
const total = (rows) => rows.reduce((a, r) => a + r.value, 0);
const keyOf = (k) => JSON.stringify(Object.keys(k).sort().map((d) => [d, k[d]]));
const asMap = (rows) => new Map(rows.map((r) => [keyOf(r.key), r.value]));
const moneyTol = (x) => Math.max(TOL.amountAbsolute, TOL.amountRelative * Math.abs(x));
const near = (a, b, tol = moneyTol(Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0)))) => Math.abs((a ?? 0) - (b ?? 0)) <= tol;
const read = (variable, where = {}, by = []) => sys.read({ variable, by, where });
const one = async (variable, where) => (await read(variable, where))[0]?.value ?? null;
const sortRows = (rows) => [...rows].sort((a, b) => (keyOf(a.key) < keyOf(b.key) ? -1 : 1));
const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const pct = (xs, p) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null;
};
const round = (x) => Number(x.toPrecision(4));
const countryOf = (dim, m) => base.above(dim, m, 'Country');
const between = (lo, hi, name, ...k) => lo + (hi - lo) * rng.u(name, ...k);

/** Same rows on both sides, each unchanged within the money tolerance. */
function sameRows(before, after) {
    const a = asMap(before);
    const b = asMap(after);
    const bad = [];
    for (const k of new Set([...a.keys(), ...b.keys()])) if (!near(a.get(k), b.get(k))) bad.push(`${k}: ${a.get(k)} -> ${b.get(k)}`);
    return bad;
}

// Picks: the first system saves them, every later system uses the same ones.
const picks = picksFile && fs.existsSync(picksFile) ? JSON.parse(fs.readFileSync(picksFile, 'utf8')) : { dataset: datasetId, seed };
if (picks.dataset !== datasetId || picks.seed !== seed) {
    throw new Error(`${picksFile} holds picks for dataset ${picks.dataset} and seed ${picks.seed}, not ${datasetId} and ${seed}. Use another --picks file.`);
}
const savePicks = () => picksFile && fs.writeFileSync(picksFile, JSON.stringify(picks, null, 1));
async function pick(name, make) {
    if (picks[name] === undefined) {
        picks[name] = await make();
        savePicks();
    }
    return picks[name];
}
/** One of `list`, chosen by the seed, sorted by member codes first so the choice does not depend on read order. */
function choose(list, name, i) {
    const sorted = [...list].sort((a, b) => (keyOf(a.key ?? a) < keyOf(b.key ?? b) ? -1 : 1));
    if (!sorted.length) throw new Error(`${name}: nothing to pick`);
    return sorted[rng.int(sorted.length, name, i)];
}

/** All of `list` in an order chosen by the seed. Repeated writes take cells from it in turn, so each is fresh. */
function order(list, name) {
    const pool = [...list].sort((a, b) => (keyOf(a.key ?? a) < keyOf(b.key ?? b) ? -1 : 1));
    const out = [];
    for (let k = 0; pool.length; k++) out.push(pool.splice(rng.int(pool.length, name, k), 1)[0]);
    return out;
}

// --- results ------------------------------------------------------------------------------------------

// A run of some tests (--tests) adds to the results and answers already in --out.
const prior = (name) => {
    const f = path.join(outDir, name);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};
const results = (only && prior(`${entry}.json`)?.tests) || {};
const answers = (only && prior(`${entry}.answers.json`)) || {};
function record(id, r) {
    results[id] = r;
    log(`${id} ${r.check}${r.time !== undefined ? ` ${r.time} s` : ''}${r.p95 !== undefined ? ` p95 ${r.p95} s` : ''}${r.cold !== undefined ? ` cold ${r.cold} s` : ''}${r.problems?.length ? ` ${r.problems.slice(0, 3).join(' | ')}` : ''}`);
    writeOut();
}
function answer(id, run, rows) {
    (answers[id] ??= {})[run] = sortRows(rows);
}
function writeOut() {
    const doc = {
        entry,
        scale,
        machine,
        date: new Date().toISOString().slice(0, 10),
        system: { name: sys.name, version: sys.version, settings: sys.settings },
        host: { platform: `${os.type()} ${os.release()}`, arch: os.arch(), cpus: os.cpus().length, cpu: os.cpus()[0]?.model, memoryGB: Math.round(os.totalmem() / 2 ** 30), node: process.version },
        model: { sha256: modelHash },
        testsVersion: tests.version,
        dataset: { sha256: datasetId },
        data: { generator: manifest.generator, size: manifest.size, seed: manifest.seed },
        seed,
        tests: results,
    };
    fs.writeFileSync(path.join(outDir, `${entry}.json`), JSON.stringify(doc, null, 1) + '\n');
    fs.writeFileSync(path.join(outDir, `${entry}.answers.json`), JSON.stringify(answers) + '\n');
}

/** Runs `fn` and turns a throw into an error result. */
async function guarded(id, fn) {
    if (only && !only.has(id)) return;
    log(`${id} start`);
    try {
        await fn();
    } catch (e) {
        record(id, { check: 'error', error: String(e?.stack ?? e).split('\n').slice(0, 4).join(' ') });
        try {
            await restore();
        } catch {
            // the next test restores again
        }
    }
}

// Summaries as the method reports them.
function writeSummary(runs, problems, extra = {}) {
    const timed = runs.filter((r) => !r.warmup);
    const times = timed.map((r) => r.ms / 1000);
    return {
        check: problems.length ? 'wrong' : 'ok',
        time: round(median(times)),
        p95: round(pct(times, 0.95)),
        warmup: runs.filter((r) => r.warmup).map((r) => round(r.ms / 1000)),
        runs: timed.map((r) => ({ s: round(r.ms / 1000), ...(r.ackMs !== undefined ? { write: round(r.ackMs / 1000), read: round(r.readMs / 1000) } : {}) })),
        ...(problems.length ? { problems } : {}),
        ...extra,
    };
}
function onceSummary(runs, problems, extra = {}) {
    return { check: problems.length ? 'wrong' : 'ok', time: round(median(runs.map((r) => r.ms / 1000))), runs: runs.map((r) => round(r.ms / 1000)), ...(problems.length ? { problems } : {}), ...extra };
}

// --- invariants -------------------------------------------------------------------------------------

const checkVars = () => model.variables.filter((v) => v.name.startsWith('CHECK ') && v.formula);
async function invariantI1() {
    const bad = [];
    // Every stored cell of every check, so errors of opposite sign cannot cancel in a total.
    for (const v of checkVars()) {
        for (const r of await sys.cells(v.name)) if (!near(r.value, 0)) bad.push(`I1 ${v.name} ${keyOf(r.key)} = ${r.value}`);
    }
    return bad;
}
async function invariants(ids) {
    const bad = [];
    const notChecked = [];
    const by = ['Country', 'Versions', 'Years', 'Months'];
    if (ids.includes('I1')) bad.push(...(await invariantI1()));
    if (ids.includes('I2')) {
        const pl = asMap(await read('PL OUT', {}, by));
        const ebit = asMap(await read('EBIT OUT', {}, by));
        for (const k of new Set([...pl.keys(), ...ebit.keys()])) if (!near(pl.get(k), ebit.get(k))) bad.push(`I2 ${k}: PL ${pl.get(k)} EBIT ${ebit.get(k)}`);
    }
    if (ids.includes('I3')) notChecked.push('I3: no reference for the source amounts before allocation');
    if (ids.includes('I4')) {
        const pools = [
            ['Trade Fees Pool', 'Trade Fees', 'Trade Fees Unallocated'],
            ['Logistics Pool', 'Logistics Cost', 'Logistics Unallocated'],
            ['Sales Force Pool', 'Sales Force Cost', 'Sales Force Unallocated'],
            ['Marketing Pool', 'Marketing Cost', 'Marketing Unallocated'],
        ];
        const k3 = ['Country', 'Versions', 'Years'];
        for (const [pool, cost, rest] of pools) {
            const p = asMap(await read(pool, {}, k3));
            const c = asMap(await read(cost, {}, k3));
            const u = asMap(await read(rest, {}, k3));
            for (const k of new Set([...p.keys(), ...c.keys(), ...u.keys()])) if (!near(p.get(k), (c.get(k) ?? 0) + (u.get(k) ?? 0))) bad.push(`I4 ${pool} ${k}: ${p.get(k)} vs ${(c.get(k) ?? 0) + (u.get(k) ?? 0)}`);
        }
    }
    if (ids.includes('I5')) {
        const flags = await read('FC Actual', {}, ['Versions', 'Years', 'Months']);
        const closed = flags.filter((r) => r.value === 1).map((r) => r.key);
        for (const [merged, actual] of [
            ['Volume', 'Volume ACT'],
            ['Gross Sales', 'Gross Sales ACT'],
            ['COGS', 'COGS ACT'],
        ]) {
            const m = asMap(await read(merged, {}, ['Country', 'Versions', 'Years', 'Months']));
            const a = asMap(await read(actual, {}, ['Country', 'Years', 'Months']));
            for (const f of closed) {
                for (const c of base.members.get('Country').keys()) {
                    const mv = m.get(keyOf({ Country: c, ...f }));
                    const av = a.get(keyOf({ Country: c, Years: f.Years, Months: f.Months }));
                    if (!near(mv, av)) bad.push(`I5 ${merged} ${c} ${f.Versions} ${f.Years} ${f.Months}: ${mv} vs ${av}`);
                }
            }
        }
    }
    return { bad, notChecked };
}

// --- loads --------------------------------------------------------------------------------------------

const L1 = tests.tests.find((t) => t.id === 'L1');
async function testL1() {
    const runs = [];
    for (let i = 0; i < D.runs.load.repeats; i++) {
        await sys.close();
        const t0 = now();
        await sys.load(baseCells);
        const rows = await read(L1.prove.variable, {}, L1.prove.by);
        execSync('sync');
        runs.push({ ms: ms(t0) });
        answer('L1', i, rows);
        log(`L1 run ${i}: ${(runs.at(-1).ms / 1000).toFixed(2)} s`);
    }
    const { bad, notChecked } = await invariants(L1.expect.find((e) => e.kind === 'invariant').ids);
    record('L1', onceSummary(runs, bad, notChecked.length ? { notChecked } : {}));
    await snapshot();
}

async function testL2() {
    const t = tests.tests.find((x) => x.id === 'L2');
    const flags = t.action.then.map((w) => ({ variable: w.write, at: w.at, value: w.value }));
    const runs = [];
    const problems = [];
    for (let i = 0; i < D.runs.load.repeats; i++) {
        await restore();
        const t0 = now();
        await sys.loadCells(closeCells, { cells: flags });
        const rows = await read(t.prove.variable, t.prove.where, t.prove.by);
        execSync('sync');
        runs.push({ ms: ms(t0) });
        answer('L2', i, rows);
        for (const r of await read('CHECK Import Total', { Years: 'Y2026', Months: 'M7' }, ['Country'])) if (!near(r.value, 0)) problems.push(`CHECK Import Total ${r.key.Country} = ${r.value}`);
    }
    record('L2', onceSummary(runs, problems));
}

async function testL3() {
    await restore();
    const p = await pick('L3', async () => {
        const skus = await read('Volume', { ...FC, Months: PLAN }, ['SKU']);
        const sku = choose(skus, 'L3', 0).key.SKU;
        const old = await one('IMPORT Unit Weight', { SKU: sku });
        return { sku, brand: base.above('SKU', sku, 'Brand'), old, value: old * 1.25 };
    });
    const runs = [];
    const problems = [];
    const by = ['Country', 'Versions', 'Years', 'Months'];
    for (let i = 0; i < D.runs.load.repeats; i++) {
        await restore();
        const before = await read('EBIT OUT', {}, by);
        await settle();
        const t0 = now();
        await sys.write([{ variable: 'IMPORT Unit Weight', at: { SKU: p.sku }, value: p.value }]);
        const rows = await read('Logistics Cost', { Brand: p.brand, ...FC }, ['Country']);
        execSync('sync');
        runs.push({ ms: ms(t0) });
        answer('L3', i, rows);
        problems.push(...sameRows(before, await read('EBIT OUT', {}, by)).map((s) => `EBIT OUT moved ${s}`));
    }
    record('L3', onceSummary(runs, problems));
}

// --- writes -------------------------------------------------------------------------------------------

/**
 * A write group: restore, then a warm-up and `repeats` writes, each with its own pick.
 * `prepare(i)` returns { cells, prove: () => rows, check: (rows) => problems, before? }.
 */
async function writeGroup(id, prepare, { repeats = D.runs.write.repeats, warmup = D.runs.write.warmup, available = Infinity } = {}) {
    await restore();
    const runs = [];
    const problems = [];
    // Each write takes a fresh cell. With fewer cells than writes, the group has fewer writes (method, section 2).
    const total = Math.min(warmup + repeats, available);
    if (total <= warmup) throw new Error(`${id}: only ${available} cells to write`);
    for (let i = 0; i < total; i++) {
        const step = await prepare(i);
        if (i === warmup) await settle();
        const t0 = now();
        await sys.write(step.cells);
        const t1 = now();
        const rows = await step.prove();
        const t2 = now();
        runs.push({ ms: ms(t0, t2), ackMs: ms(t0, t1), readMs: ms(t1, t2), warmup: i < warmup });
        answer(id, i, rows);
        for (const p of await step.check(rows)) problems.push(`run ${i}: ${p}`);
    }
    const extra = total < warmup + repeats ? { repeats: total - warmup, notes: `${available} cells fit the pick rule, so ${total - warmup} writes instead of ${repeats}` } : {};
    return { runs, problems, extra };
}

async function testW1() {
    await restore();
    const t = tests.tests.find((x) => x.id === 'W1');
    const tops = await pick('W1.groups', async () => {
        const rows = await read('Invoice Sales', FC, ['Country', 'Customer Group']);
        const best = {};
        for (const r of rows) if (!best[r.key.Country] || r.value > best[r.key.Country].value) best[r.key.Country] = r;
        return Object.values(best).map((r) => r.key);
    });
    const used = new Set();
    const c3 = [];
    const { runs, problems } = await writeGroup('W1', async (i) => {
        const p = await pick(`W1.${i}`, async () => {
            const g = choose(tops, 'W1.group', i);
            const where = { ...FC, 'Customer Group': g['Customer Group'], Months: PLAN };
            const typed = asMap(await read('Volume Override IN', where, ['Customer', 'SKU', 'Months']));
            const cells = (await read('Volume', where, ['Customer', 'SKU', 'Months'])).filter((r) => !typed.has(keyOf(r.key)) && !used.has(keyOf(r.key)));
            const c = choose(cells, 'W1.cell', i);
            let value = Math.round(c.value * between(0.5, 1.5, 'W1.value', i));
            if (value === c.value) value += 1;
            return { at: { ...c.key, ...FC }, country: g.Country, old: c.value, value };
        });
        used.add(keyOf({ Customer: p.at.Customer, SKU: p.at.SKU, Months: p.at.Months }));
        const others = await read('EBIT OUT', FC, ['Country']);
        return {
            cells: [{ variable: t.action.write, at: p.at, value: p.value }],
            prove: () => read('EBIT OUT', { Country: p.country, ...FC }),
            check: async () => {
                const out = [];
                const v = await one('Volume', p.at);
                if (!near(v, p.value)) out.push(`Volume ${v}, typed ${p.value}`);
                const after = await read('EBIT OUT', FC, ['Country']);
                const moved = sameRows(
                    others.filter((r) => r.key.Country !== p.country),
                    after.filter((r) => r.key.Country !== p.country)
                );
                if (moved.length) {
                    c3.push(...moved);
                    out.push(...moved.map((m) => `another country moved: ${m}`));
                }
                return out;
            },
        };
    });
    record('W1', writeSummary(runs, problems));
    record('C3', { check: c3.length ? 'wrong' : 'ok', timed: false, ...(c3.length ? { problems: c3.slice(0, 20) } : {}) });
}

async function testW2() {
    await restore();
    const runs = [];
    const problems = [];
    const p = await pick('W2', async () => {
        const countries = (await read('Volume', { ...FC, Months: PLAN }, ['Country'])).map((r) => r.key.Country);
        const country = choose(countries, 'W2.country', 0);
        const cells = await read('Volume', { ...FC, Country: country, Months: PLAN }, ['Customer', 'SKU', 'Months']);
        const chosen = [];
        const pool = sortRows(cells);
        for (let k = 0; k < 1000 && pool.length; k++) chosen.push(pool.splice(rng.int(pool.length, 'W2.cell', k), 1)[0]);
        return {
            country,
            cells: chosen.map((c, k) => {
                let value = Math.round(c.value * between(0.5, 1.5, 'W2.value', k));
                if (value === c.value) value += 1;
                return { at: { ...c.key, ...FC }, old: c.value, value };
            }),
        };
    });
    const change = p.cells.reduce((a, c) => a + c.value - c.old, 0);
    for (let i = 0; i < D.runs.bulk.repeats; i++) {
        await restore();
        const before = await one('Volume', { Country: p.country, ...FC, Months: PLAN });
        await settle();
        const t0 = now();
        await sys.write(p.cells.map((c) => ({ variable: 'Volume Override IN', at: c.at, value: c.value })));
        const after = await one('Volume', { Country: p.country, ...FC, Months: PLAN });
        runs.push({ ms: ms(t0) });
        answer('W2', i, await read('EBIT OUT', { Country: p.country, ...FC }));
        if (!near(after - before, change)) problems.push(`Volume moved ${after - before}, expected ${change}`);
    }
    record('W2', onceSummary(runs, problems, { cells: p.cells.length }));
}

async function testW3() {
    await restore();
    const cands = await pick('W3.cands', async () => (await read('Invoice Sales', { ...FC, Months: PLAN }, ['Customer Group', 'Months'])).map((r) => r.key));
    const seq = order(cands, 'W3.cell');
    const { runs, problems, extra } = await writeGroup('W3', async (i) => {
        const p = await pick(`W3.${i}`, async () => {
            const k = seq[i];
            const at = { 'Customer Group': k['Customer Group'], ...FC, Months: k.Months };
            const old = (await one('Rebate Rate', at)) ?? 0;
            return { at, country: countryOf('Customer Group', k['Customer Group']), old, value: old + between(0.005, 0.02, 'W3.value', i) };
        });
        const where = { Country: p.country, ...FC, Months: p.at.Months };
        const old = (await one('Rebate Rate', p.at)) ?? 0;
        const sales = await one('Invoice Sales', p.at);
        const before = await one('EBIT OUT', where);
        return {
            cells: [{ variable: 'Rebate Rate IN', at: p.at, value: p.value }],
            prove: () => read('EBIT OUT', where),
            check: async (rows) => {
                const want = before - (p.value - old) * sales;
                return near(rows[0]?.value, want) ? [] : [`EBIT ${rows[0]?.value}, expected ${want}`];
            },
        };
    }, { available: seq.length });
    record('W3', writeSummary(runs, problems, extra));
}

async function testW4() {
    await restore();
    const brands = await pick('W4.cands', async () => (await read('Gross Sales', FC, ['Brand'])).map((r) => r.key.Brand));
    const seq = order(brands, 'W4.brand');
    const { runs, problems, extra } = await writeGroup('W4', async (i) => {
        const brand = await pick(`W4.${i}`, async () => seq[i]);
        const at = { Brand: brand, ...FC };
        const old = (await one('Price Increase IN', at)) ?? 0;
        const value = old + between(0.01, 0.05, 'W4.value', i);
        const before = await read('Gross Sales', { ...at, Months: PLAN }, ['Country', 'Months']);
        const closed = await read('Gross Sales', { ...at, Months: CLOSED }, ['Country', 'Months']);
        return {
            cells: [{ variable: 'Price Increase IN', at, value }],
            prove: () => read('Gross Sales', { ...at, Months: PLAN }, ['Country', 'Months']),
            check: async (rows) => {
                const f = (1 + value) / (1 + old);
                const want = before.map((r) => ({ key: r.key, value: r.value * f }));
                return [...sameRows(want, rows), ...sameRows(closed, await read('Gross Sales', { ...at, Months: CLOSED }, ['Country', 'Months'])).map((s) => `closed month moved ${s}`)];
            },
        };
    }, { available: seq.length });
    record('W4', writeSummary(runs, problems, extra));
}

async function testW5() {
    await restore();
    const t = tests.tests.find((x) => x.id === 'W5');
    const currencies = [...base.members.get('Currency').keys()].filter((c) => c !== 'EUR' && !c.startsWith('NULL ')).sort();
    const cells = [];
    for (const c of currencies) for (const m of PLAN) cells.push({ Currency: c, Months: m });
    const order = await pick('W5.order', async () => {
        const pool = [...cells];
        const out = [];
        for (let k = 0; pool.length; k++) out.push(pool.splice(rng.int(pool.length, 'W5.order', k), 1)[0]);
        return out;
    });
    const countryFor = (cur) => [...base.members.get('Country').values()].find((m) => m.parents.Currency === cur).name;
    const { runs, problems } = await writeGroup(
        'W5',
        async (i) => {
            const c = order[i];
            const at = { Currency: c.Currency, ...FC, Months: c.Months };
            const old = await one('FX Rate', at);
            const value = old * between(0.95, 1.05, 'W5.value', i);
            const country = countryFor(c.Currency);
            const before = await one('COGS', { Country: country, ...FC, Months: c.Months });
            const others = (await read('COGS', { ...FC, Months: c.Months }, ['Country'])).filter((r) => r.key.Country !== country);
            return {
                cells: [{ variable: 'FX Rate IN', at, value }],
                prove: () => read('COGS', { Country: country, ...FC, Months: c.Months }),
                check: async (rows) => {
                    const out = near(rows[0]?.value, before * (value / old)) ? [] : [`COGS ${rows[0]?.value}, expected ${before * (value / old)}`];
                    const after = (await read('COGS', { ...FC, Months: c.Months }, ['Country'])).filter((r) => r.key.Country !== country);
                    return [...out, ...sameRows(others, after).map((s) => `other country moved ${s}`)];
                },
            };
        },
        { repeats: t.runs.repeats, warmup: t.runs.warmup, available: order.length }
    );
    record('W5', writeSummary(runs, problems));
}

async function testW6(id, fn) {
    await restore();
    const cands = await pick(`${id}.cands`, async () => (await read('OPEX', { Function: fn, ...FC, Months: PLAN }, ['Cost Center', 'Account', 'Months'])).map((r) => r.key));
    const seq = order(cands, `${id}.cell`);
    const { runs, problems, extra } = await writeGroup(id, async (i) => {
        const k = await pick(`${id}.${i}`, async () => seq[i]);
        const at = { 'Cost Center': k['Cost Center'], Account: k.Account, ...FC, Months: k.Months };
        const old = (await one('OPEX IN', at)) ?? 0;
        const value = old + Math.round(between(1000, 100000, `${id}.value`, i));
        const where = { Country: countryOf('Cost Center', k['Cost Center']), ...FC, Months: k.Months };
        const before = await one('EBIT OUT', where);
        return {
            cells: [{ variable: 'OPEX IN', at, value }],
            prove: () => read('EBIT OUT', where),
            check: async (rows) => (near(rows[0]?.value, before - (value - old)) ? [] : [`EBIT ${rows[0]?.value}, expected ${before - (value - old)}`]),
        };
    }, { available: seq.length });
    record(id, writeSummary(runs, problems, extra));
}

async function testW7() {
    await restore();
    const cands = await pick('W7.cands', async () => {
        const ly = await read('Volume', { Versions: 'Actual', Years: 'Y2025' }, ['Customer Group', 'Category']);
        const typed = asMap(await read('Volume Override IN', FC, ['Customer Group', 'Category']));
        const target = asMap(await read('Volume Target IN', FC, ['Customer Group', 'Category']));
        return ly.filter((r) => r.value > 0 && !typed.has(keyOf(r.key)) && !target.has(keyOf(r.key))).map((r) => r.key);
    });
    const seq = order(cands, 'W7.cell');
    const { runs, problems, extra } = await writeGroup('W7', async (i) => {
        const k = await pick(`W7.${i}`, async () => seq[i]);
        const months = await read('Volume', { 'Customer Group': k['Customer Group'], Category: k.Category, Versions: 'Actual', Years: 'Y2025' }, ['Months']);
        const all = total(months);
        const share = total(months.filter((r) => PLAN.includes(r.key.Months))) / all;
        const value = Math.round(all * between(0.9, 1.2, 'W7.value', i));
        const where = { 'Customer Group': k['Customer Group'], Category: k.Category, ...FC, Months: PLAN };
        return {
            cells: [{ variable: 'Volume Target IN', at: { 'Customer Group': k['Customer Group'], Category: k.Category, ...FC }, value }],
            prove: () => read('Volume', where),
            check: async (rows) => (near(rows[0]?.value, value * share) ? [] : [`Volume ${rows[0]?.value}, expected ${value * share}`]),
        };
    }, { available: seq.length });
    record('W7', writeSummary(runs, problems, extra));
}

async function testW8() {
    await restore();
    const cands = await pick('W8.cands', async () => {
        const rates = await read('Growth Bonus Rate IN', FC, ['Customer Group']);
        const ly = asMap(await read('Invoice Sales LY by Group', { Years: FC.Years }, ['Customer Group']));
        const plan = asMap(await read('Invoice Sales Plan by Group Year', FC, ['Customer Group']));
        return rates.filter((r) => r.value > 0 && ly.get(keyOf(r.key)) > 0 && plan.get(keyOf(r.key)) > 0).map((r) => r.key['Customer Group']);
    });
    if (!cands.length) {
        record('W8', { check: 'skipped', notes: `No customer group fits the pick rule: no ${FC.Versions} growth bonus rate above 0 in this dataset.` });
        return;
    }
    const seq = order(cands, 'W8.group');
    const { runs, problems, extra } = await writeGroup('W8', async (i) => {
        const g = await pick(`W8.${i}`, async () => seq[i]);
        const at = { 'Customer Group': g, ...FC };
        const rate = await one('Growth Bonus Rate IN', at);
        const year = await one('Invoice Sales by Group Year', at);
        const ly = await one('Invoice Sales LY by Group', { 'Customer Group': g, Years: FC.Years });
        const growth = year / ly - 1;
        const on = ((await one('Growth Bonus Rate', at)) ?? 0) > 0;
        const value = on ? growth + 0.001 : growth - 0.001;
        const before = (await one('Growth Bonus', at)) ?? 0;
        return {
            cells: [{ variable: 'Growth Bonus Threshold IN', at, value }],
            prove: () => read('Growth Bonus', at),
            check: async (rows) => {
                const want = before + (on ? -1 : 1) * rate * year;
                const out = near(rows[0]?.value ?? 0, want) ? [] : [`Growth Bonus ${rows[0]?.value}, expected ${want}`];
                const c = (await one('CHECK Growth Bonus', at)) ?? 0;
                return near(c, 0) ? out : [...out, `CHECK Growth Bonus ${c}`];
            },
        };
    }, { available: seq.length });
    record('W8', writeSummary(runs, problems, extra));
}

// --- reads --------------------------------------------------------------------------------------------

async function readTest(id, fn) {
    await sys.close();
    const dropped = dropCaches();
    const t0 = now();
    await sys.open();
    const cold = await fn();
    const coldMs = ms(t0);
    answer(id, 'cold', cold);
    await settle();
    const warm = [];
    for (let i = 0; i < D.runs.read.warm; i++) {
        const t = now();
        const rows = await fn();
        warm.push(ms(t));
        answer(id, i, rows);
    }
    record(id, {
        check: 'ok',
        time: round(median(warm) / 1000),
        cold: round(coldMs / 1000),
        runs: warm.map((x) => round(x / 1000)),
        coldIncludesOpen: true,
        ...(dropped ? {} : { notes: 'OS cache not dropped: no passwordless sudo' }),
    });
}

const R = Object.fromEntries(tests.tests.filter((t) => t.kind === 'read').map((t) => [t.id, t]));
const readOne = (spec) => read(spec.variable, spec.where, spec.by);
const tagged = async (specs) => (await Promise.all(specs.map(async (s, i) => (await readOne(s)).map((r) => ({ key: { ...r.key, read: String(i) }, value: r.value }))))).flat();
const readers = {
    R1: () => readOne(R.R1.read),
    R2a: () => readOne(R.R2a.read),
    R2b: () => readOne(R.R2b.read),
    R2c: () => readOne(R.R2c.read),
    R3: () => tagged(R.R3.read),
    R4: async () => {
        const measures = model.variables.filter((v) => v.measure && v.file === '8-report.fml');
        const out = [];
        for (const v of measures) for (const r of await read(v.name, R.R4.read.where, R.R4.read.by)) out.push({ key: { ...r.key, measure: v.name }, value: r.value });
        return out;
    },
    R5: async () => {
        const g = picks['R5'];
        const out = [];
        for (const v of R.R5.read.variables) for (const r of await read(v, { ...R.R5.read.where, 'Customer Group': g }, R.R5.read.by)) out.push({ key: { ...r.key, variable: v }, value: r.value });
        return out;
    },
    R6: () => readOne(R.R6.read),
    R7: async () => {
        const rows = await read(R.R7.read.variable, { ...R.R7.read.where, Country: picks['R7'] }, R.R7.read.by);
        return rows.sort((a, b) => b.value - a.value || (a.key.Customer < b.key.Customer ? -1 : 1)).slice(0, R.R7.read.limit);
    },
};

async function testReads() {
    await pick('R5', async () => choose((await read('Invoice Sales', R.R5.pick.where, ['Customer Group'])).map((r) => r.key['Customer Group']), 'R5', 0));
    await pick('R7', async () => choose((await read('Invoice Sales', R.R7.pick.where, ['Country'])).map((r) => r.key.Country), 'R7', 0));
    const ids = Object.keys(readers).filter((id) => !only || only.has(id));
    // Random order from the seed, so no read always runs right after another.
    const order = [];
    const pool = [...ids].sort();
    for (let k = 0; pool.length; k++) order.push(pool.splice(rng.int(pool.length, 'read-order', k), 1)[0]);
    await restore();
    for (const id of order) await guarded(id, () => readTest(id, readers[id]));
}

async function testR8() {
    const runs = [];
    let dropped = true;
    for (let i = 0; i < 3; i++) {
        await sys.close();
        dropped = dropCaches() && dropped;
        const t0 = now();
        await sys.open();
        const rows = await read(R.R8.read.variable, R.R8.read.where);
        runs.push({ ms: ms(t0) });
        answer('R8', i, rows);
    }
    // Every R8 run starts from a stopped system and a dropped cache, so its time is its cold time too.
    const summary = onceSummary(runs, []);
    record('R8', { ...summary, cold: summary.time, ...(dropped ? {} : { notes: 'OS cache not dropped: no passwordless sudo' }) });
}

// --- model changes ------------------------------------------------------------------------------------

async function modelGroup(id, apply, prove, checks) {
    const runs = [];
    const problems = [];
    for (let i = 0; i < D.runs.model.repeats; i++) {
        await restore();
        const before = await checks.before();
        await settle();
        const t0 = now();
        await apply();
        const rows = await prove();
        runs.push({ ms: ms(t0) });
        answer(id, i, rows);
        problems.push(...(await checks.after(before, rows)));
    }
    record(id, onceSummary(runs, problems));
}

async function testM1() {
    const dir = path.join(work, 'model-M1');
    const change = changedModel(modelDir, dir, 'M1');
    const by = ['Country', 'Versions', 'Years', 'Months'];
    await modelGroup(
        'M1',
        async () => {
            model = loadModel(dir, baseCells);
            await sys.changeModel({ model, variables: change.changed.map((n) => model.variable(n)) });
        },
        () => read('Logistics Cost', FC, ['Brand', 'Country']),
        {
            before: async () => ({ cost: await read('Logistics Cost', {}, by), ebit: await read('EBIT OUT', {}, by) }),
            after: async (b) => [
                ...sameRows(b.cost, await read('Logistics Cost', {}, by)).map((s) => `Logistics Cost by country moved ${s}`),
                ...sameRows(b.ebit, await read('EBIT OUT', {}, by)).map((s) => `EBIT moved ${s}`),
            ],
        }
    );
}

async function testM2() {
    await restore();
    const p = await pick('M2', async () => {
        const groups = (await read('Volume', { ...FC, Months: 'M7' }, ['Customer Group'])).map((r) => r.key['Customer Group']);
        const g = choose(groups, 'M2.group', 0);
        const sku = choose((await read('Volume', { 'Customer Group': g, ...FC, Months: 'M7' }, ['SKU'])).map((r) => r.key.SKU), 'M2.sku', 0);
        const peer = [...base.members.get('Customer').values()].filter((m) => m.parents['Customer Group'] === g).sort((a, b) => (a.name < b.name ? -1 : 1))[0];
        return { group: g, sku, region: peer.parents.Region, country: countryOf('Customer Group', g), value: 1 + rng.int(1000, 'M2.value', 0) };
    });
    const name = 'NEW-CUST-1';
    await modelGroup(
        'M2',
        async () => {
            model = loadModel(modelDir, baseCells);
            model.addMember('Customer', name, { 'Customer Group': p.group, Region: p.region });
            await sys.changeModel({ model, members: [{ dim: 'Customer', name }], cells: [{ variable: 'Volume Override IN', at: { Customer: name, SKU: p.sku, ...FC, Months: 'M7' }, value: p.value }] });
        },
        () => read('Volume', { 'Customer Group': p.group, ...FC, Months: 'M7' }),
        {
            before: async () => one('Volume', { 'Customer Group': p.group, ...FC, Months: 'M7' }),
            after: async (b, rows) => {
                answer('M2.EBIT', 0, await read('EBIT OUT', { Country: p.country, ...FC }));
                return near(rows[0]?.value - b, p.value) ? [] : [`Volume moved ${rows[0]?.value - b}, expected ${p.value}`];
            },
        }
    );
}

async function testM3() {
    await restore();
    const p = await pick('M3', async () => {
        const customers = (await read('Invoice Sales', FC, ['Customer'])).map((r) => r.key.Customer).sort();
        const groups = [...base.members.get('Customer Group').values()];
        const options = [];
        for (const c of customers) {
            const g = base.members.get('Customer').get(c).parents['Customer Group'];
            const gm = base.members.get('Customer Group').get(g);
            const others = groups.filter((x) => x.name !== g && x.parents.Country === gm.parents.Country && x.parents.Channel === gm.parents.Channel).map((x) => x.name).sort();
            if (others.length) options.push({ customer: c, group: g, others });
        }
        const o = choose(options.map((x) => ({ key: { Customer: x.customer }, ...x })), 'M3.customer', 0);
        return { customer: o.customer, group: o.group, target: o.others[rng.int(o.others.length, 'M3.target', 0)] };
    });
    const by = ['Country', 'Years', 'Months'];
    await modelGroup(
        'M3',
        async () => {
            model = loadModel(modelDir, baseCells);
            model.members.get('Customer').get(p.customer).parents['Customer Group'] = p.target;
            await sys.changeModel({ model, members: [{ dim: 'Customer', name: p.customer }] });
        },
        () => read('Gross Sales', { 'Customer Group': [p.group, p.target], ...FC }, ['Customer Group']),
        {
            before: () => read('EBIT OUT', { Versions: 'Actual' }, by),
            after: async (b) => sameRows(b, await read('EBIT OUT', { Versions: 'Actual' }, by)).map((s) => `Actual EBIT moved ${s}`),
        }
    );
}

async function testM4() {
    const dir = path.join(work, 'model-M4');
    const change = changedModel(modelDir, dir, 'M4');
    const by = ['Country', 'Versions', 'Years', 'Months'];
    await modelGroup(
        'M4',
        async () => {
            model = loadModel(dir, baseCells);
            const names = new Set([...change.changed, ...change.added]);
            await sys.changeModel({ model, variables: model.order.filter((v) => names.has(v.name)) });
        },
        () => read('Contribution Margin III by Country', FC, ['Country']),
        {
            before: async () => ({ cm3: await read('Contribution Margin III by Country', FC, ['Country']), over: await read('Overheads', FC, ['Country']), ebit: await read('EBIT OUT', {}, by) }),
            after: async (b, rows) => {
                const out = [];
                const cost = asMap(await read('Marketing Staff Cost', FC, ['Country']));
                const pool = asMap(await read('Marketing Staff Pool', FC, ['Country']));
                const cm3 = asMap(rows);
                for (const r of b.cm3) if (!near(r.value - (cm3.get(keyOf(r.key)) ?? 0), cost.get(keyOf(r.key)) ?? 0)) out.push(`CM III ${r.key.Country} fell ${r.value - cm3.get(keyOf(r.key))}, allocated ${cost.get(keyOf(r.key))}`);
                const over = asMap(await read('Overheads', FC, ['Country']));
                for (const r of b.over) if (!near(r.value - (over.get(keyOf(r.key)) ?? 0), pool.get(keyOf(r.key)) ?? 0)) out.push(`Overheads ${r.key.Country} fell ${r.value - over.get(keyOf(r.key))}, pool ${pool.get(keyOf(r.key))}`);
                for (const r of await read('CHECK OPEX in EBIT', {}, by)) if (!near(r.value, 0)) out.push(`CHECK OPEX in EBIT ${keyOf(r.key)} = ${r.value}`);
                out.push(...sameRows(b.ebit, await read('EBIT OUT', {}, by)).map((s) => `EBIT moved ${s}`));
                return out;
            },
        }
    );
}

// --- checks without a timer ---------------------------------------------------------------------------

async function testC1() {
    await restore();
    const p = await pick('C1', async () => {
        const cells = await read('Volume', { ...FC, Months: CLOSED }, ['Customer', 'SKU', 'Months']);
        const c = choose(cells, 'C1', 0);
        let value = Math.round(c.value * between(0.5, 1.5, 'C1.value', 0));
        if (value === c.value) value += 1;
        return { at: { ...c.key, ...FC }, country: countryOf('Customer', c.key.Customer), value };
    });
    const ebit = await read('EBIT OUT', { Country: p.country, ...FC });
    const vol = await read('Volume', p.at);
    await sys.write([{ variable: 'Volume Override IN', at: p.at, value: p.value }]);
    const problems = [...sameRows(ebit, await read('EBIT OUT', { Country: p.country, ...FC })), ...sameRows(vol, await read('Volume', p.at))];
    record('C1', { check: problems.length ? 'wrong' : 'ok', timed: false, ...(problems.length ? { problems } : {}) });
}

async function testC2() {
    await restore();
    const problems = await invariantI1();
    record('C2', { check: problems.length ? 'wrong' : 'ok', timed: false, ...(problems.length ? { problems } : {}) });
}

// --- main ---------------------------------------------------------------------------------------------

log(`entry ${entry}, ${sys.name} ${sys.version}, scale ${scale}, seed ${seed}, machine ${machine}`);
const started = now();
if (!only || only.has('L1')) await guarded('L1', testL1);
else if (fs.existsSync(snapshotDir)) await restore();
else {
    // The other tests start from L1's snapshot. Without one, load once to make it. Not timed or recorded.
    log('no snapshot for this dataset: loading once to make one (not recorded)');
    await sys.load(baseCells);
    await snapshot();
}
await guarded('L2', testL2);
await guarded('L3', testL3);
await guarded('W1', testW1);
await guarded('W2', testW2);
await guarded('W3', testW3);
await guarded('W4', testW4);
await guarded('W5', testW5);
await guarded('W6a', () => testW6('W6a', 'Logistics'));
await guarded('W6b', () => testW6('W6b', 'Administration'));
await guarded('W7', testW7);
await guarded('W8', testW8);
for (const t of tests.tests.filter((t) => t.status !== 'ready')) if (!only || only.has(t.id)) record(t.id, { check: 'unsupported', notes: t.status });
await testReads();
await guarded('R8', testR8);
await guarded('M1', testM1);
await guarded('M2', testM2);
await guarded('M3', testM3);
await guarded('M4', testM4);
await guarded('C1', testC1);
await guarded('C2', testC2);
await sys.close();
log(`done in ${(ms(started) / 60000).toFixed(1)} min`);
