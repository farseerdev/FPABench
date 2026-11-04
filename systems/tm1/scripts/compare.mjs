// Compares TM1 answers (files written by z.FPB.Read through the harness) with reference answers
// (the runner's <entry>.answers.json, written by the installer).
//   node scripts/compare.mjs <reference answers.json> <answers dir> [tests]
// <answers dir> holds <test>_<run>.csv files: "<test>","<key>","<value>" with key "Dim=member;Dim=member".
// Tolerances as FPABench: amounts 0.01 absolute or 1e-9 relative, whichever is larger; R4 ratios 1e-6 relative.
// TM1 cannot tell a stored 0 from no cell, so a reference row of value 0 matches a missing TM1 row.
import fs from 'node:fs';
import path from 'node:path';

const [refFile, dir, only] = process.argv.slice(2);
if (!refFile || !dir) { console.error('usage: node compare.mjs <answers.json> <answers dir> [L1,R1,...]'); process.exit(1); }
const ref = JSON.parse(fs.readFileSync(refFile, 'utf8'));

function splitCsv(line) {
  const f = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { f.push(cur); cur = ''; } else cur += c;
  }
  f.push(cur); return f;
}
const keyOf = (obj) => Object.keys(obj).sort().map((k) => `${k}=${obj[k]}`).join(';');
function readTm1(file) {
  const rows = [];
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [, key, value] = splitCsv(line);
    const obj = {};
    for (const part of (key || '').split(';').filter(Boolean)) { const i = part.indexOf('='); obj[part.slice(0, i)] = part.slice(i + 1); }
    rows.push({ key: obj, value: Number(value) });
  }
  return rows;
}

const tests = only ? only.split(',') : Object.keys(ref);
let failed = 0;
for (const test of tests) {
  const runs = ref[test];
  if (!runs) { console.log(`${test}: no reference`); continue; }
  for (const run of Object.keys(runs)) {
    const file = path.join(dir, `${test}_${run}.csv`);
    let got = readTm1(file);
    if (got === null) continue;
    if (test === 'C2') got = got.concat(readTm1(file + '.cells') ?? []);   // every check row must be 0
    let want = runs[run];
    if (test === 'R7') got = got.sort((a, b) => b.value - a.value || (a.key.Customer < b.key.Customer ? -1 : 1)).slice(0, 100);
    // single-value answers: the reference key is {}, TM1 may name the country
    if (want.length === 1 && Object.keys(want[0].key).length === 0 && got.length === 1) got[0].key = {};
    const W = new Map(want.map((r) => [keyOf(r.key), r.value]));
    const G = new Map(got.map((r) => [keyOf(r.key), r.value]));
    const bad = [];
    for (const k of new Set([...W.keys(), ...G.keys()])) {
      const a = W.get(k) ?? 0, b = G.get(k) ?? 0;
      const tol = test === 'R4' ? 1e-6 * Math.abs(a) : Math.max(0.01, 1e-9 * Math.abs(a));
      if (test === 'C2') { if (Math.abs(b) > 0.01) bad.push([k, 0, b]); continue; }
      if (Math.abs(a - b) > tol && !(test === 'R4' && Math.abs(a) < 1e-12 && Math.abs(b) < 1e-12)) bad.push([k, a, b]);
    }
    if (bad.length) failed++;
    console.log(`${test} run ${run}: reference ${W.size} rows, TM1 ${G.size} rows, ${bad.length ? bad.length + ' DIFFERENT' : 'ok'}`);
    for (const [k, a, b] of bad.slice(0, 5)) console.log(`   ${k}: reference ${a}  TM1 ${b}`);
  }
}
process.exit(failed ? 1 : 0);
