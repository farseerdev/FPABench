// Stages an official FPABench dataset folder (or one of its increments) into the three TM1 load files
// FPB_Leaf.csv, FPB_Drivers.csv, FPB_FX.csv, in the layout z.FPB.Load.Leaf / Drivers / FX read.
//
//   node scripts/stage-official.mjs <dataset dir> <out dir>                      the base dataset
//   node scripts/stage-official.mjs <dataset dir> <out dir> close-2026-07        an increment (actuals only)
//
// Master data (customers, groups, materials, cost centers) always comes from <dataset dir>/master.
// Blank coordinates are written as the dimension-specific special members (NoCustomer, NoProduct,
// NoMaterial, NoChannel, NoCostCenter, NoAccount, Global, NoCurrency); months as 1..12 or Annual.
// An empty source field makes no row (FPABench: an empty field is no cell). Unknown materials keep an
// empty SKU, so z.FPB.Load.Leaf rejects them instead of loading them on NoProduct.
// Node 22+, no packages.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const [src, out, increment] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node stage-official.mjs <dataset dir> <out dir> [increment]'); process.exit(1); }
const dataDir = increment ? path.join(src, 'increments', increment) : src;
fs.mkdirSync(out, { recursive: true });

function splitCsv(line) {
  const f = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { f.push(cur); cur = ''; } else cur += c;
  }
  f.push(cur); return f;
}
async function* rows(dir, file) {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) return;
  const rl = readline.createInterface({ input: fs.createReadStream(full), crlfDelay: Infinity });
  let header = null;
  for await (const line of rl) {
    if (line === '') continue;
    const f = splitCsv(line);
    if (!header) header = f; else yield Object.fromEntries(header.map((h, i) => [h, f[i] ?? '']));
  }
}
async function readAll(dir, file) { const a = []; for await (const r of rows(dir, file)) a.push(r); return a; }
const q = (s) => (/[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s));
const ym = (month) => { const [y, m] = month.split('-'); return [y, String(Number(m))]; };

const groups = new Map((await readAll(src, 'master/customer_groups.csv')).map((r) => [r.customer_group, r]));
const customers = new Map((await readAll(src, 'master/customers.csv')).map((r) => [r.customer, r]));
const materials = new Map((await readAll(src, 'master/materials.csv')).map((r) => [r.material, r.sku]));
const costCenters = new Map((await readAll(src, 'master/cost_centers.csv')).map((r) => [r.cost_center, r]));
const countries = new Map((await readAll(src, 'master/countries.csv')).map((r) => [r.country, r]));
const custCh = (c) => groups.get(customers.get(c)?.customer_group)?.channel ?? '';
const custCtry = (c) => groups.get(customers.get(c)?.customer_group)?.country ?? '';

// ---------------------------------------------------------------- FPB_Leaf.csv
const leaf = fs.createWriteStream(path.join(out, 'FPB_Leaf.csv'));
leaf.write('Source,Version,Year,Month,Customer,CustomerGroup,SKU,Material,Brand,Channel,CostCenter,Account,Country,Currency,Measure,Value\n');
let nLeaf = 0;
function L(source, version, y, m, o, measure, value) {
  if (value === '' || value === undefined) return;
  const r = [source, version, y, m, o.customer || 'NoCustomer', o.group || 'NoCustomer', o.sku ?? 'NoProduct', o.material || 'NoMaterial',
    o.brand || 'NoProduct', o.channel || 'NoChannel', o.cc || 'NoCostCenter', o.account || 'NoAccount', o.country || 'Global',
    o.currency || 'NoCurrency', measure, value];
  leaf.write(r.map(q).join(',') + '\n'); nLeaf++;
}
for await (const r of rows(dataDir, 'actuals/sales.csv')) {
  const [y, m] = ym(r.month);
  const c = customers.get(r.customer);
  const o = { customer: r.customer, group: c?.customer_group ?? '', sku: materials.get(r.material) ?? '', material: r.material,
    channel: custCh(r.customer), country: custCtry(r.customer), currency: r.currency };
  const s = 'actuals/sales.csv';
  L(s, 'Actual', y, m, o, 'IMPORT Volume', r.units);
  L(s, 'Actual', y, m, o, 'IMPORT Gross Sales', r.gross_sales);
  L(s, 'Actual', y, m, o, 'IMPORT Standard Discounts', r.standard_discount);
  L(s, 'Actual', y, m, o, 'IMPORT Promo Discounts', r.promo_discount);
  L(s, 'Actual', y, m, o, 'IMPORT Logistics Discounts', r.logistics_discount);
  L(s, 'Actual', y, m, o, 'IMPORT Promo Funding', r.promo_funding);
}
for await (const r of rows(dataDir, 'actuals/rebates.csv')) {
  const [y, m] = ym(r.month); const g = groups.get(r.customer_group);
  const o = { group: r.customer_group, channel: g?.channel, country: g?.country };
  L('actuals/rebates.csv', 'Actual', y, m, o, 'IMPORT Rebates', r.accrual);
  L('actuals/rebates.csv', 'Actual', y, m, o, 'IMPORT Rebate True-ups', r.true_up);
}
for await (const r of rows(dataDir, 'actuals/growth_bonus.csv')) {
  const [y, m] = ym(r.month); const g = groups.get(r.customer_group);
  L('actuals/growth_bonus.csv', 'Actual', y, m, { group: r.customer_group, channel: g?.channel, country: g?.country }, 'IMPORT Growth Bonus', r.amount);
}
for await (const r of rows(dataDir, 'actuals/trade_fees.csv')) {
  const [y, m] = ym(r.month); const g = groups.get(r.customer_group);
  L('actuals/trade_fees.csv', 'Actual', y, m, { group: r.customer_group, brand: r.brand, channel: g?.channel, country: g?.country }, 'IMPORT Trade Fees', r.amount);
}
for await (const r of rows(dataDir, 'actuals/opex.csv')) {
  const [y, m] = ym(r.month); const cc = costCenters.get(r.cost_center);
  L('actuals/opex.csv', 'Actual', y, m, { cc: r.cost_center, account: r.account, channel: cc?.channel, country: cc?.country }, 'IMPORT OPEX', r.amount);
}
for await (const r of rows(dataDir, 'actuals/marketing.csv')) {
  const [y, m] = ym(r.month);
  L('actuals/marketing.csv', 'Actual', y, m, { brand: r.brand, country: r.country }, 'IMPORT Marketing', r.amount);
}
for await (const r of rows(dataDir, 'actuals/list_prices.csv')) {
  const [y, m] = ym(r.month);
  L('actuals/list_prices.csv', 'Actual', y, m, { sku: r.sku, country: r.country }, 'IMPORT List Price', r.list_price);
}
for await (const r of rows(dataDir, 'actuals/standard_costs.csv'))
  L('actuals/standard_costs.csv', 'Actual', r.year, 'Annual', { sku: r.sku }, 'IMPORT Standard Cost', r.standard_cost_eur);
for await (const r of rows(dataDir, 'actuals/control_totals.csv')) {
  const [y, m] = ym(r.month);
  L('actuals/control_totals.csv', 'Actual', y, m, { country: r.country }, 'IMPORT Control Total', r.gross_sales);
}
for await (const r of rows(dataDir, 'plan/volume_override.csv')) {
  const [y, m] = ym(r.month);
  L('plan/volume_override.csv', r.version, y, m, { customer: r.customer, group: customers.get(r.customer)?.customer_group, sku: r.sku, channel: custCh(r.customer), country: custCtry(r.customer) }, 'Volume Override IN', r.units);
}
for await (const r of rows(dataDir, 'plan/promo_funding.csv')) {
  const [y, m] = ym(r.month);
  L('plan/promo_funding.csv', r.version, y, m, { customer: r.customer, group: customers.get(r.customer)?.customer_group, sku: r.sku, channel: custCh(r.customer), country: custCtry(r.customer) }, 'Promo Funding IN', r.amount);
}
for await (const r of rows(dataDir, 'plan/standard_cost.csv'))
  L('plan/standard_cost.csv', r.version, r.year, 'Annual', { sku: r.sku }, 'Standard Cost IN', r.standard_cost_eur);
for await (const r of rows(dataDir, 'plan/opex.csv')) {
  const [y, m] = ym(r.month); const cc = costCenters.get(r.cost_center);
  L('plan/opex.csv', r.version, y, m, { cc: r.cost_center, account: r.account, channel: cc?.channel, country: cc?.country }, 'OPEX IN', r.amount);
}
const pLeaf = new Promise((res) => leaf.end(res));

// ---------------------------------------------------------------- FPB_Drivers.csv
const drv = fs.createWriteStream(path.join(out, 'FPB_Drivers.csv'));
drv.write('Source,Version,Year,Month,InputCustomer,InputProduct,Channel,CostCenter,Account,Country,Measure,Value\n');
let nDrv = 0;
function D(source, version, y, m, o, measure, value) {
  if (value === '' || value === undefined) return;
  const r = [source, version, y, m, o.cust || 'NoCustomer', o.prod || 'NoProduct', o.channel || 'NoChannel', 'NoCostCenter', 'NoAccount', o.country || 'Global', measure, value];
  drv.write(r.map(q).join(',') + '\n'); nDrv++;
}
const g = (code) => groups.get(code)?.country;
const plan = [
  ['fc_closed.csv', 'FC Closed IN', 'flag', (r) => ({})],
  ['fc_horizon.csv', 'FC Horizon IN', 'flag', (r) => ({})],
  ['volume_target.csv', 'Volume Target IN', 'units', (r) => ({ cust: r.customer_group, prod: r.category, country: g(r.customer_group) })],
  ['volume_growth.csv', 'Volume Growth IN', 'growth', (r) => ({ prod: r.brand, channel: r.channel })],
  ['price_increase.csv', 'Price Increase IN', 'increase', (r) => ({ prod: r.brand })],
  ['standard_discount.csv', 'Standard Discount IN', 'rate', (r) => ({ cust: r.customer_group, prod: r.brand, country: g(r.customer_group) })],
  ['promo_discount.csv', 'Promo Discount IN', 'rate', (r) => ({ cust: r.customer_group, prod: r.brand, country: g(r.customer_group) })],
  ['logistics_discount.csv', 'Logistics Discount IN', 'rate', (r) => ({ cust: r.customer_group, country: g(r.customer_group) })],
  ['rebate_rate.csv', 'Rebate Rate IN', 'rate', (r) => ({ cust: r.customer_group, country: g(r.customer_group) })],
  ['growth_bonus_rate.csv', 'Growth Bonus Rate IN', 'rate', (r) => ({ cust: r.customer_group, country: g(r.customer_group) })],
  ['growth_bonus_threshold.csv', 'Growth Bonus Threshold IN', 'threshold', (r) => ({ cust: r.customer_group, country: g(r.customer_group) })],
  ['trade_fees.csv', 'Trade Fees IN', 'amount', (r) => ({ cust: r.customer_group, prod: r.brand, country: g(r.customer_group) })],
  ['marketing_spend.csv', 'Marketing Spend IN', 'amount_eur', (r) => ({ prod: r.brand })],
  ['marketing_split.csv', 'Marketing Split IN', 'share', (r) => ({ prod: r.brand, country: r.country })],
];
for (const [file, measure, col, coords] of plan) {
  for await (const r of rows(dataDir, 'plan/' + file)) {
    const [y, m] = r.month ? ym(r.month) : [r.year, 'Annual'];
    D('plan/' + file, r.version, y, m, coords(r), measure, r[col]);
  }
}
const pDrv = new Promise((res) => drv.end(res));

// ---------------------------------------------------------------- FPB_FX.csv
const fx = fs.createWriteStream(path.join(out, 'FPB_FX.csv'));
fx.write('Source,Version,Year,Month,FXType,FromCurrency,ToCurrency,Rate,Direction\n');
let nFx = 0;
function F(source, version, month, cur, rate) {
  if (rate === '') return;
  const [y, m] = ym(month);
  fx.write([source, version, y, m, 'Average', 'EUR', cur, rate, 'Source'].map(q).join(',') + '\n'); nFx++;
  if (cur !== 'EUR') { fx.write([source, version, y, m, 'Average', cur, 'EUR', String(1 / Number(rate)), 'Derived inverse'].map(q).join(',') + '\n'); nFx++; }
}
for await (const r of rows(dataDir, 'actuals/fx_rates.csv')) F('actuals/fx_rates.csv', 'Actual', r.month, r.currency, r.rate_per_eur);
for await (const r of rows(dataDir, 'plan/fx_rate.csv')) F('plan/fx_rate.csv', r.version, r.month, r.currency, r.rate_per_eur);
const pFx = new Promise((res) => fx.end(res));

await Promise.all([pLeaf, pDrv, pFx]);
console.log(`staged ${dataDir} -> ${out}: FPB_Leaf ${nLeaf}, FPB_Drivers ${nDrv}, FPB_FX ${nFx} rows`);
