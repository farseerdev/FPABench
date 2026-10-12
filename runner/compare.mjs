// Compares the answers of every entry in one results folder, test by test and run by run.
//
//   node runner/compare.mjs <results dir>
//
// There is no reference program for the "value" expectations yet (tests/method.md, section 7). Until
// there is, two systems that are built in different ways and give the same answer stand in for it.
// A test whose answers differ between entries is marked wrong in each entry, with the first differences.
// The other expectations were already checked by the runner.

import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2]);
const tests = JSON.parse(fs.readFileSync(new URL('../tests/tests.json', import.meta.url), 'utf8'));
const tol = tests.defaults.tolerance;
const RATIO_FLOOR = 1e-12;
const entries = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.answers.json'))
    .map((f) => f.replace('.answers.json', ''));
const answers = Object.fromEntries(entries.map((e) => [e, JSON.parse(fs.readFileSync(path.join(dir, `${e}.answers.json`), 'utf8'))]));
const results = Object.fromEntries(entries.map((e) => [e, JSON.parse(fs.readFileSync(path.join(dir, `${e}.json`), 'utf8'))]));

const keyOf = (k) => JSON.stringify(Object.keys(k).sort().map((d) => [d, k[d]]));
function same(a, b, ratio) {
    if (a === undefined || b === undefined) return false;
    // A ratio of 0 against 5e-19 is rounding, not a wrong answer, so ratios also get a tiny absolute floor.
    const limit = ratio ? Math.max(RATIO_FLOOR, tol.ratioRelative * Math.max(Math.abs(a), Math.abs(b))) : Math.max(tol.amountAbsolute, tol.amountRelative * Math.max(Math.abs(a), Math.abs(b)));
    return Math.abs(a - b) <= limit;
}

const report = {};
// Differences per test. A test can have several answers, such as M2 and M2.EBIT, and a difference in
// any of them counts.
const byTest = new Map();
const ids = new Set(entries.flatMap((e) => Object.keys(answers[e])));
for (const id of ids) {
    const have = entries.filter((e) => answers[e][id]);
    if (have.length < 2) {
        report[id] = { compared: have, status: 'one entry only' };
        continue;
    }
    const [ref, ...others] = have;
    const diffs = [];
    let rows = 0;
    for (const other of others) {
        for (const run of Object.keys(answers[ref][id])) {
            const a = new Map((answers[ref][id][run] ?? []).map((r) => [keyOf(r.key), r.value]));
            const b = new Map((answers[other][id][run] ?? []).map((r) => [keyOf(r.key), r.value]));
            for (const k of new Set([...a.keys(), ...b.keys()])) {
                rows++;
                if (!same(a.get(k), b.get(k), id === 'R4')) diffs.push(`${id} run ${run} ${k}: ${ref} ${a.get(k)}, ${other} ${b.get(k)}`);
            }
        }
    }
    report[id] = { compared: have, values: rows, differ: diffs.length, ...(diffs.length ? { first: diffs.slice(0, 10) } : {}) };
    const testId = id.split('.')[0];
    const t = byTest.get(testId) ?? { entries: new Set(), diffs: [] };
    for (const e of have) t.entries.add(e);
    t.diffs.push(...diffs);
    byTest.set(testId, t);
}
for (const [testId, t] of byTest) {
    for (const e of t.entries) {
        const r = results[e].tests[testId];
        if (!r) continue;
        // The runner's own verdict is kept apart, so running this again gives the same result.
        r.runnerCheck ??= r.check;
        r.runnerProblems ??= r.problems ?? [];
        r.confirmedBy = [...t.entries].filter((x) => x !== e).sort();
        r.check = r.runnerCheck;
        r.problems = [...r.runnerProblems];
        if (t.diffs.length && r.check === 'ok') {
            r.check = 'wrong';
            r.problems.push(`answers differ from ${r.confirmedBy.join(', ')}: ${t.diffs.slice(0, 3).join(' | ')}`);
        }
        if (!r.problems.length) delete r.problems;
    }
}
for (const e of entries) fs.writeFileSync(path.join(dir, `${e}.json`), JSON.stringify(results[e], null, 1) + '\n');
fs.writeFileSync(path.join(dir, 'compare.json'), JSON.stringify(report, null, 1) + '\n');
for (const [id, r] of Object.entries(report)) console.log(`${id.padEnd(8)} ${r.status ?? `${r.values} values, ${r.differ} differ`}${r.first ? `  ${r.first[0]}` : ''}`);
