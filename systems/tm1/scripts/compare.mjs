// Compares the TM1 answers and checks with RAMA's recorded ones, the expected.json FPABench publishes with
// each dataset, as the FPABench runner compares every entry's.
//   node scripts/compare.mjs <expected.json> <answers dir> [L1,R1,...] [--quick]
// <answers dir> holds <test>_<run>.csv files, and <test>_<run>.csv.check for the checks, from the harness.
// Each line is "<tag>","<key>","<value>" with key "Dim=member;Dim=member".
// - Every run of every test needs its answer file. With --quick, as after Run-FPBench.ps1 -Quick, only the
//   runs that have one are compared, and each test needs at least one.
// - Amounts match within 0.01 or a relative 1e-9, whichever is larger. R4's ratios match within a relative 1e-6.
// - A missing row counts as a row with 0: TM1 cannot tell a stored 0 from no cell.
// - What the expected file lists under "zero" must be 0. Every other check it has must come back and match.
// Exits with 1 when anything differs or is missing.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const [expectedFile, dir, only] = args.filter((a) => a !== '--quick');
if (!expectedFile || !dir) {
  console.error('usage: node compare.mjs <expected.json> <answers dir> [L1,R1,...] [--quick]');
  process.exit(1);
}
const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));

// Which check each tag of a TM1 check file answers, per test.
const CHECKS = {
  W1: { VOLUME_CELL: 'Volume' },
  W2: { EBIT_OUT: 'EBIT OUT' },
  W8: { CHECK_GB_GROUP: 'CHECK Growth Bonus' },
  M2: { EBIT_OUT: 'EBIT OUT' },
  L2: { CHECK_IMPORT_TOTAL: 'CHECK Import Total by country' },
  M4: { CHECK_OPEX_IN_EBIT: 'CHECK OPEX in EBIT' },
};

function splitCsv(line) {
  const f = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      f.push(cur);
      cur = '';
    } else cur += c;
  }
  f.push(cur);
  return f;
}
const keyOf = (obj) => Object.keys(obj).sort().map((k) => `${k}=${obj[k]}`).join(';');
/** The rows of a TM1 file, each { tag, key, value }, or null when there is no file. */
function readTm1(file) {
  if (!fs.existsSync(file)) return null;
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [tag, key, value] = splitCsv(line);
    const obj = {};
    for (const part of (key || '').split(';').filter(Boolean)) {
      const i = part.indexOf('=');
      obj[part.slice(0, i)] = part.slice(i + 1);
    }
    rows.push({ tag, key: obj, value: Number(value) });
  }
  return rows;
}

const near = (a, b, ratio) => {
  const diff = Math.abs(a - b);
  const size = Math.max(Math.abs(a), Math.abs(b));
  return ratio ? diff <= Math.max(1e-12, 1e-6 * size) : diff <= Math.max(0.01, 1e-9 * size);
};
/** The differences between expected rows and TM1's rows, a missing row counting as 0. */
function compare(want, got, ratio = false) {
  // A single total: RAMA's key is {}, and TM1 may name the slice it read.
  if (want.length === 1 && Object.keys(want[0].key).length === 0 && got.length === 1) got = [{ ...got[0], key: {} }];
  const W = new Map(want.map((r) => [keyOf(r.key), r.value]));
  const G = new Map(got.map((r) => [keyOf(r.key), r.value]));
  const bad = [];
  for (const k of new Set([...W.keys(), ...G.keys()])) {
    const a = W.get(k) ?? 0;
    const b = G.get(k) ?? 0;
    if (!near(a, b, ratio)) bad.push(`${k || '(total)'}: expected ${W.has(k) ? a : 'no row'}, TM1 ${G.has(k) ? b : 'no row'}`);
  }
  return bad;
}
const nonZero = (rows) => rows.filter((r) => !near(r.value, 0, false)).map((r) => `${keyOf(r.key) || '(total)'}: expected 0, TM1 ${r.value}`);
const mustBeZero = (want, name) => (want.zero ?? []).includes(name) || (name !== 'answer' && (want.zero ?? []).includes('every check'));

const tests = only ? only.split(',') : Object.keys(expected).filter((k) => /^[LWRMC]\d/.test(k));
let failed = 0;
for (const test of tests) {
  const p = expected[test];
  if (!p) {
    console.log(`${test}: not in ${expectedFile}`);
    failed++;
    continue;
  }
  const runs = Array.isArray(p) ? p.map((_, i) => i) : Array.from({ length: p.warm ?? p.repeats ?? 1 }, (_, i) => i);
  const problems = [];
  let compared = 0;
  for (const run of runs) {
    const want = Array.isArray(p) ? p[run] : p;
    const file = path.join(dir, `${test}_${run}.csv`);
    let got = readTm1(file);
    if (got === null) {
      if (!quick) problems.push(`run ${run}: no answer file ${file}`);
      continue;
    }
    compared++;
    if (test === 'C2') got = got.concat(readTm1(file + '.cells') ?? []);
    if (test === 'R7') got = got.sort((a, b) => b.value - a.value || (a.key.Customer < b.key.Customer ? -1 : 1)).slice(0, 100);
    if (mustBeZero(want, 'answer')) for (const x of nonZero(got)) problems.push(`run ${run}: ${x}`);
    else for (const x of compare(want.expect ?? [], got, test === 'R4')) problems.push(`run ${run}: ${x}`);

    // The checks: every one the expected file has or names as 0 must come back.
    const rows = readTm1(file + '.check') ?? [];
    const byName = {};
    for (const r of rows) {
      const name = CHECKS[test]?.[r.tag];
      if (name) (byName[name] ??= []).push(r);
    }
    const names = new Set([...Object.keys(want.checks ?? {}), ...(want.zero ?? []).filter((n) => n !== 'answer' && n !== 'every check'), ...(want.checkNames ?? [])]);
    for (const name of names) {
      const mapped = Object.values(CHECKS[test] ?? {}).includes(name);
      if (!mapped) {
        problems.push(`run ${run}: check "${name}" is not returned by the TM1 harness`);
        continue;
      }
      const got = byName[name] ?? [];
      if (mustBeZero(want, name)) for (const x of nonZero(got)) problems.push(`run ${run}: ${name} ${x}`);
      else for (const x of compare(want.checks?.[name] ?? [], got)) problems.push(`run ${run}: ${name} ${x}`);
    }
  }
  if (!compared) problems.unshift(`no answer file for any run`);
  if (problems.length) failed++;
  console.log(`${test}: ${compared} of ${runs.length} runs compared, ${problems.length ? `${problems.length} problems` : 'ok'}`);
  for (const x of problems.slice(0, 5)) console.log(`   ${x}`);
}
console.log(failed ? `${failed} of ${tests.length} tests differ from RAMA's answers or are incomplete` : `every test matches RAMA's answers`);
process.exit(failed ? 1 : 0);
