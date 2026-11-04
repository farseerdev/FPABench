// Turns a dataset's picks.json into the TM1 harness plan: for every test, the list of runs with the
// parameters of the TM1 test process, plus the W2 cell file.
//   node scripts/picks-to-tm1.mjs <picks.json> <out dir>
// Writes <out dir>/plan.json and <out dir>/W2_cells_<run>.csv
import fs from 'node:fs';
import path from 'node:path';

const [picksFile, out] = process.argv.slice(2);
if (!picksFile || !out) { console.error('usage: node picks-to-tm1.mjs <picks.json> <out dir>'); process.exit(1); }
const P = JSON.parse(fs.readFileSync(picksFile, 'utf8'));
fs.mkdirSync(out, { recursive: true });
const plan = { seed: P.seed, tests: {} };
const runs = (list, f) => list.map((p, i) => ({ warmup: !!p.warmup, index: i, params: f(p, i) }));

plan.tests.W1 = { process: 'z.FPB.Test.Write', runs: runs(P.W1, (p) => ({ pTest: 'W1', pCustomer: p.at.Customer, pSKU: p.at.SKU, pMonth: p.at.Months, pValue: p.value, pCountry: p.country, pVersion: p.at.Versions, pYear: p.at.Years })) };
plan.tests.W3 = { process: 'z.FPB.Test.Write', runs: runs(P.W3, (p) => ({ pTest: 'W3', pGroup: p.at['Customer Group'], pMonth: p.at.Months, pValue: p.value, pCountry: p.country, pVersion: p.at.Versions, pYear: p.at.Years })) };
plan.tests.W4 = { process: 'z.FPB.Test.Write', runs: runs(P.W4, (p) => ({ pTest: 'W4', pBrand: p.brand, pValue: p.value })) };
plan.tests.W5 = { process: 'z.FPB.Test.Write', runs: runs(P.W5, (p) => ({ pTest: 'W5', pCurrency: p.at.Currency, pMonth: p.at.Months, pValue: p.value, pCountry: p.country, pVersion: p.at.Versions, pYear: p.at.Years })) };
for (const t of ['W6a', 'W6b'])
  plan.tests[t] = { process: 'z.FPB.Test.Write', runs: runs(P[t], (p) => ({ pTest: 'W6', pCostCenter: p.at['Cost Center'], pAccount: p.at.Account, pMonth: p.at.Months, pValue: p.value, pCountry: p.country, pVersion: p.at.Versions, pYear: p.at.Years })) };
plan.tests.W7 = { process: 'z.FPB.Test.Write', runs: runs(P.W7, (p) => ({ pTest: 'W7', pGroup: p.group, pCategory: p.category, pValue: p.value })) };
plan.tests.W8 = { process: 'z.FPB.Test.Write', setup: 'z.FPB.Test.W8Setup', runs: runs(P.W8, (p) => ({ pTest: 'W8', pGroup: p.group })) };
plan.tests.L3 = { process: 'z.FPB.Test.Write', repeats: P.L3.repeats, runs: [{ warmup: false, index: 0, params: { pTest: 'L3', pSKU: P.L3.sku, pBrand: P.L3.brand, pValue: P.L3.value } }] };

// W2: one cell file (the same cells in every repeat, from the snapshot)
const w2 = path.join(out, 'W2_cells.csv');
fs.writeFileSync(w2, 'Customer,SKU,Month,Value\n' + P.W2.cells.map((c) => `${c.at.Customer},${c.at.SKU},${c.at.Months},${c.value}`).join('\n') + '\n');
plan.tests.W2 = { process: 'z.FPB.Test.W2', repeats: P.W2.repeats, runs: [{ warmup: false, index: 0, params: { pFile: '<OUT>\\W2_cells.csv', pCountry: P.W2.country } }] };

plan.tests.L1 = { process: 'z.FPB.Run.L1', repeats: P.L1.repeats };
plan.tests.L2 = { process: 'z.FPB.Test.L2', repeats: P.L2.repeats };
plan.tests.M1 = { process: 'z.FPB.Test.Rules', repeats: P.M1.repeats, runs: [{ warmup: false, index: 0, params: { pTest: 'M1' } }] };
plan.tests.M4 = { process: 'z.FPB.Test.Rules', repeats: P.M4.repeats, runs: [{ warmup: false, index: 0, params: { pTest: 'M4' } }] };
plan.tests.M2 = { process: 'z.FPB.Test.M2', repeats: P.M2.repeats, runs: [{ warmup: false, index: 0, params: { pCustomer: P.M2.customer, pGroup: P.M2.group, pRegion: P.M2.region, pSKU: P.M2.sku, pValue: P.M2.value, pMonth: 'M7' } }] };
plan.tests.M3 = { process: 'z.FPB.Test.M3', repeats: P.M3.repeats, runs: [{ warmup: false, index: 0, params: { pCustomer: P.M3.customer, pGroup: P.M3.group, pTarget: P.M3.target } }] };

for (const t of ['R1', 'R2a', 'R2b', 'R2c', 'R3', 'R4', 'R6'])
  plan.tests[t] = { process: 'z.FPB.Read', warm: P[t].warm, runs: [{ warmup: false, index: 0, params: { pTest: t } }] };
plan.tests.R5 = { process: 'z.FPB.Read', warm: P.R5.warm, runs: [{ warmup: false, index: 0, params: { pTest: 'R5', pGroup: P.R5.group, pMonth: 'M7' } }] };
plan.tests.R7 = { process: 'z.FPB.Read', warm: P.R7.warm, runs: [{ warmup: false, index: 0, params: { pTest: 'R7', pCountry: P.R7.country } }] };
plan.tests.R8 = { process: 'z.FPB.Read', repeats: P.R8.repeats, restart: true, runs: [{ warmup: false, index: 0, params: { pTest: 'R8' } }] };

plan.tests.C1 = { process: 'z.FPB.Test.Write', timed: false, runs: [{ warmup: false, index: 0, params: { pTest: 'C1', pCustomer: P.C1.at.Customer, pSKU: P.C1.at.SKU, pMonth: P.C1.at.Months, pValue: P.C1.value, pCountry: P.C1.country } }] };
plan.tests.C2 = { process: 'z.FPB.Check.Run', timed: false, runs: [{ warmup: false, index: 0, params: { pVariant: 'BASE', pTol: 0.01 } }] };
// C3: picks.json's country is the OTHER country, whose EBIT must not move after the W1-style write
plan.tests.C3 = { process: 'z.FPB.Test.Write', timed: false, runs: [{ warmup: false, index: 0, params: { pTest: 'C3', pCustomer: P.C3.at.Customer, pSKU: P.C3.at.SKU, pMonth: P.C3.at.Months, pValue: P.C3.value, pOtherCountry: P.C3.country } }] };

fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify(plan, null, 1));
console.log(`plan for ${Object.keys(plan.tests).length} tests -> ${out}`);
