// Reads the results of tools/ab.sh and prints, per test, each arm's median over its legs, the spread of
// the legs, and whether the arms differ by more than that spread.
//
//   node tools/summarize-ab.mjs <out folder of ab.sh> [--csv]
//
// A test's value in one leg is the `time` the runner wrote for it, itself a median of the leg's runs. An
// arm's value is the median of its legs, and its spread is (max - min) / median over the legs.
// Two arms differ "beyond spread" only when, with at least 5 legs in each, all of these hold:
//   1. the ranges [min, max] of their legs do not overlap,
//   2. |median difference| is larger than the range (max - min) of each of the two arms, and
//   3. |median difference| is at least 1% of the first arm's median.
// If the arms were the same build, rule 1 alone fires with probability 2 / C(2n, n) per test: 0.8% at 5
// legs each, 0.2% at 6; rules 2 and 3 only lower it (simulated with normal noise: 0.2% at 5 legs,
// 0.04% at 6). Over m tests the chance of at least one false flag is
// 1 - (1 - p)^m. A test that is not `ok` in some leg has no value, and no verdict.
// It refuses to compare results from different machines.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const MIN_LEGS = 5;
const MIN_EFFECT_PCT = 1;
const csv = args.includes('--csv');
if (!dir) {
    console.error('usage: node tools/summarize-ab.mjs <out folder of ab.sh> [--csv]');
    process.exit(2);
}

const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
/** The key=value lines of a leg's leg.txt. */
const keyValues = (file) => (fs.existsSync(file) ? Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {});

// --- the legs: <arm>-L<n>, in the folder -----------------------------------------------------------------------

const legs = [];
for (const name of fs.readdirSync(dir)) {
    const m = /^(.+)-L(\d+)$/.exec(name);
    if (!m || !fs.statSync(path.join(dir, name)).isDirectory()) continue;
    const results = fs.readdirSync(path.join(dir, name)).filter((f) => f.endsWith('.json') && !f.endsWith('.answers.json'));
    const info = keyValues(path.join(dir, name, 'leg.txt'));
    if (results.length !== 1) {
        console.error(`${name}: ${results.length ? 'more than one result file' : 'no result file'}, rc=${info.rc ?? '?'}: the leg is left out`);
        continue;
    }
    legs.push({ arm: m[1], n: Number(m[2]), info, result: JSON.parse(fs.readFileSync(path.join(dir, name, results[0]), 'utf8')) });
}
if (!legs.length) {
    console.error(`${dir}: no <arm>-L<n> folder with a result`);
    process.exit(1);
}
legs.sort((a, b) => a.n - b.n);
const arms = [...new Set(legs.map((l) => l.arm))].sort((a, b) => legs.findIndex((l) => l.arm === a) - legs.findIndex((l) => l.arm === b));

// --- one machine only ------------------------------------------------------------------------------------------

const machineOf = (r) => ({ entry: r.entry, scale: r.scale, machine: r.machine, platform: r.host?.platform, arch: r.host?.arch, cpus: r.host?.cpus, cpu: r.host?.cpu, memoryGB: r.host?.memoryGB, node: r.host?.node, testsVersion: r.testsVersion, dataset: r.dataset?.sha256 });
const first = machineOf(legs[0].result);
for (const l of legs) {
    const differs = Object.entries(machineOf(l.result)).filter(([k, v]) => v !== first[k]);
    if (differs.length) {
        console.error(`not comparable: ${l.arm}-L${l.n} differs from ${legs[0].arm}-L${legs[0].n} in ${differs.map(([k, v]) => `${k} (${first[k]} against ${v})`).join(', ')}`);
        process.exit(1);
    }
}
const fingerprints = new Set(legs.map((l) => l.info.host).filter(Boolean));
if (fingerprints.size > 1) {
    console.error(`not comparable: the legs ran on ${fingerprints.size} different hosts or boots`);
    process.exit(1);
}

// --- the numbers -----------------------------------------------------------------------------------------------

const ids = [...new Set(legs.flatMap((l) => Object.keys(l.result.tests)))];
const stats = (id, arm) => {
    const of = legs.filter((l) => l.arm === arm);
    const ok = of.filter((l) => l.result.tests[id]?.check === 'ok' && l.result.tests[id].time !== undefined);
    const xs = ok.map((l) => l.result.tests[id].time);
    if (!xs.length) return { legs: of.length, ok: 0 };
    const med = median(xs);
    return { legs: of.length, ok: ok.length, median: med, min: Math.min(...xs), max: Math.max(...xs), spread: med ? ((Math.max(...xs) - Math.min(...xs)) / med) * 100 : 0 };
};
const verdict = (a, b) => {
    if (!a.ok || !b.ok) return 'no value';
    if (a.ok < a.legs || b.ok < b.legs) return 'check failed in a leg';
    if (a.legs < MIN_LEGS || b.legs < MIN_LEGS) return `fewer than ${MIN_LEGS} legs`;
    const apart = a.max < b.min || b.max < a.min;
    const delta = Math.abs(b.median - a.median);
    return apart && delta > a.max - a.min && delta > b.max - b.min && delta >= (a.median * MIN_EFFECT_PCT) / 100 ? 'beyond spread' : 'within spread';
};
const rows = [];
for (const id of ids) {
    if (legs.every((l) => l.result.tests[id]?.time === undefined)) continue;
    const s = Object.fromEntries(arms.map((a) => [a, stats(id, a)]));
    const rest = arms.slice(1).map((a) => ({ arm: a, delta: s[a].ok && s[arms[0]].ok ? ((s[a].median - s[arms[0]].median) / s[arms[0]].median) * 100 : null, verdict: verdict(s[arms[0]], s[a]) }));
    rows.push({ id, s, rest });
}

// --- output ----------------------------------------------------------------------------------------------------

if (csv) {
    console.log('test,arm,legs,ok,median_s,min_s,max_s,spread_pct,delta_vs_first_pct,verdict');
    for (const r of rows)
        for (const a of arms) {
            const v = r.s[a];
            const d = r.rest.find((x) => x.arm === a);
            console.log([r.id, a, v.legs, v.ok, v.median ?? '', v.min ?? '', v.max ?? '', v.spread?.toFixed(1) ?? '', d?.delta?.toFixed(1) ?? '', d?.verdict ?? ''].join(','));
        }
    process.exit(0);
}

const g = legs[0].result;
const rt = (arm) => legs.filter((l) => l.arm === arm).map((l) => l.info.sched ?? '?');
console.log(`${g.entry} ${g.scale}, machine ${g.machine}: ${g.host.cpu}, ${g.host.cpus} CPUs, ${g.host.memoryGB} GB, ${g.host.platform}`);
console.log(`arms: ${arms.map((a) => `${a} (${legs.filter((l) => l.arm === a).length} legs)`).join(', ')}; order of the runs ${[...legs].sort((a, b) => Number(a.info.run ?? 0) - Number(b.info.run ?? 0) || (a.info.start ?? '').localeCompare(b.info.start ?? '')).map((l) => l.arm).join(' ')}`);
for (const a of arms) {
    const r = rt(a);
    const bad = r.filter((x) => !/^FF \d+$/.test(x)).length;
    console.log(`${a}: scheduling ${bad ? `NOT realtime in ${bad} of ${r.length} legs (${[...new Set(r)].join('; ')})` : `${r[0]} in all ${r.length} legs`}; exit codes ${legs.filter((l) => l.arm === a).map((l) => l.info.rc ?? '?').join(' ')}`);
}
console.log('');
const w = Math.max(4, ...ids.map((i) => i.length));
const cell = (v) => (v.ok ? `${v.median.toPrecision(3)} s ±${v.spread.toFixed(0)}%` : '-');
console.log(['test'.padEnd(w), ...arms.map((a) => a.padStart(16)), ...arms.slice(1).map((a) => `${a} vs ${arms[0]}`.padStart(22))].join('  '));
for (const r of rows)
    console.log([r.id.padEnd(w), ...arms.map((a) => cell(r.s[a]).padStart(16)), ...r.rest.map((x) => `${x.delta === null ? '-' : `${x.delta >= 0 ? '+' : ''}${x.delta.toFixed(1)}%`} ${x.verdict}`.padStart(22))].join('  '));
