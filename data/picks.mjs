// The picks of a dataset: for each test, the cells it writes, the values it writes, and how often it runs.
// They come from the dataset's input cells only, so no system is needed to make them. The answers each test
// must read back are not here. RAMA records them with runner/run.mjs --record.
//
//   node data/picks.mjs <dataset dir>
//
// It writes <dataset dir>/picks.json and adds it to manifest.json. generate.mjs runs it last. The same
// dataset always gives the same bytes.
//
// Plan volume, sales and rates are calculated by the model, so the rules use what they are calculated from.
// Plan-month volume is last year's volume times growth, so a cell with last year's volume has plan volume.
// The size of a customer group is its gross sales last year.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Rng } from './lib/rng.mjs';
import { splitCsv, readCsv } from './lib/csv.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataset = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
    console.error('usage: node data/picks.mjs <dataset dir>');
    process.exit(1);
}
const tests = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'tests.json'), 'utf8'));
const D = tests.defaults;
const FC = { Versions: D.version, Years: D.year };
const PLAN = D.planMonths;
const CLOSED = D.closedMonths;
const LY = `Y${Number(D.year.slice(1)) - 1}`;
const loads = D.runs.load.repeats;
const bulk = D.runs.bulk.repeats;
const models = D.runs.model.repeats;
const warm = D.runs.read.warm;
const writes = D.runs.write.warmup + D.runs.write.repeats;
const warmup = D.runs.write.warmup;

// The input cells, as data/cells.mjs reads them, in a folder that is deleted at the end.
// The input cells, as data/cells.mjs reads them. They go next to the dataset, on the same disk, since at 10b
// they are many GB, and are deleted when the script ends, also when a pick fails.
const cellsDir = `${dataset}.picks-cells`;
fs.rmSync(cellsDir, { recursive: true, force: true });
process.on('exit', () => fs.rmSync(cellsDir, { recursive: true, force: true }));
execFileSync(process.execPath, [path.join(root, 'data', 'cells.mjs'), dataset, cellsDir], { stdio: 'ignore' });

// Members and their parents, from the model's member files and the dataset's. parents.get(dim).get(member)
// is { parent dimension: parent member }. An empty parent is the parent's NULL member.
const parents = new Map();
for (const dir of [path.join(root, 'model', 'dimensions'), path.join(cellsDir, 'dimensions')]) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.csv'))) {
        const rows = readCsv(path.join(dir, file));
        const dim = file.slice(0, -'.csv'.length);
        if (!parents.has(dim)) parents.set(dim, new Map());
        for (const r of rows) parents.get(dim).set(r[dim], Object.fromEntries(Object.keys(r).filter((c) => c !== dim && c !== '@description').map((p) => [p, r[p] || `NULL (${p})`])));
    }
}

// --- helpers ------------------------------------------------------------------------------------------------

const rng = new Rng(D.seed);
const keyOf = (k) => JSON.stringify(Object.keys(k).sort().map((d) => [d, k[d]]));
// Sorted by member codes, each item's key made once.
const sorted = (list) =>
    list
        .map((x) => [keyOf(x.key ?? x), x])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map((p) => p[1]);
const between = (lo, hi, name, i) => lo + (hi - lo) * rng.u(name, i);
const choose = (list, name, i) => {
    if (!list.length) throw new Error(`${name}: nothing to pick`);
    return sorted(list)[rng.int(list.length, name, i)];
};
// Every item of `list` in an order from the seed, so repeated writes each take a fresh cell.
const order = (list, name) => {
    const pool = sorted(list);
    const out = [];
    for (let k = 0; pool.length; k++) out.push(pool.splice(rng.int(pool.length, name, k), 1)[0]);
    return out;
};
/** The member of dimension `a` above member `m` of dimension `d`, such as the country of a customer. */
function above(d, m, a) {
    if (d === a) return m;
    for (const [p, pm] of Object.entries(parents.get(d)?.get(m) ?? {})) {
        const found = above(p, pm, a);
        if (found !== null) return found;
    }
    return null;
}
/** The members of a dimension, as { name, parents }, without its NULL member. */
const membersOf = (d) => [...parents.get(d)].filter(([name]) => !name.startsWith('NULL (')).map(([name, ps]) => ({ name, parents: ps }));
const skuOf = (material) => above('Material', material, 'SKU');

/** Each row of an input variable's cell file, as { member columns..., value }. */
async function forEach(variable, fn) {
    const file = path.join(cellsDir, 'cells', `${variable}.csv`);
    if (!fs.existsSync(file)) return;
    let head = null;
    for await (const line of readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })) {
        if (!line) continue;
        const f = splitCsv(line);
        if (!head) {
            head = f;
            continue;
        }
        const r = {};
        head.forEach((c, i) => (r[c] = c === 'value' ? Number(f[i]) : f[i]));
        fn(r);
    }
}
/** Sums `value` into map[key]. */
const add = (map, key, value) => map.set(key, (map.get(key) ?? 0) + value);

// --- what the rules need from the input cells -----------------------------------------------------------------

const groupOf = (customer) => above('Customer', customer, 'Customer Group');
const countryOf = (dim, m) => above(dim, m, 'Country');
/** Rows { key, value } of a map whose keys are keyOf(...) strings. */
const rowsOf = (map) => [...map].map(([k, value]) => ({ key: Object.fromEntries(JSON.parse(k)), value }));
/** Sums of rows by the member `fn` gives each. */
const totals = (rows, fn) => {
    const out = new Map();
    for (const r of rows) add(out, fn(r), r.value);
    return out;
};

// Last year's gross sales per customer and month. At 10b that is under 3 million entries.
const salesLY = new Map(); // keyOf({ Customer, Months }) -> gross sales
await forEach('IMPORT Gross Sales', (r) => {
    if (r.Years === LY) add(salesLY, keyOf({ Customer: r.Customer, Months: r.Months }), r.value);
});
const sales = rowsOf(salesLY);

// Volume, in two passes. One map of every customer, SKU and month would not fit at 10b, where it passes the
// largest size of one map. The first pass keeps small totals only, and the choices are made from them. The
// second keeps the cells of the chosen groups and the chosen country only.
const volumeLYByGroupCategory = new Map(); // keyOf({ Customer Group, Category }) -> last year's volume
const skusLY = new Set(); // SKUs with volume last year in the plan months
const groupsLY = new Set(); // groups with volume last year in the plan months
const countriesLY = new Set(); // countries with volume last year in the plan months
const groupsM7 = new Set(); // groups with volume last year in M7
const groupsClosed = new Set(); // groups with actual volume in this year's closed months
await forEach('IMPORT Volume', (r) => {
    const sku = skuOf(r.Material);
    const group = groupOf(r.Customer);
    if (r.Years === LY) add(volumeLYByGroupCategory, keyOf({ 'Customer Group': group, Category: above('SKU', sku, 'Category') }), r.value);
    if (r.value <= 0) return;
    if (r.Years === LY && PLAN.includes(r.Months)) {
        skusLY.add(sku);
        groupsLY.add(group);
        countriesLY.add(countryOf('Customer', r.Customer));
        if (r.Months === 'M7') groupsM7.add(group);
    }
    if (r.Years === D.year && CLOSED.includes(r.Months)) groupsClosed.add(group);
});

// The choices the second pass needs. W1 writes in the biggest group of each country, W2 in one country, M2
// adds a customer to one group, and C1 types into one group's closed month.
const biggest = {};
for (const [group, value] of totals(sales, (r) => groupOf(r.key.Customer))) {
    const country = countryOf('Customer Group', group);
    if (!biggest[country] || value > biggest[country].value) biggest[country] = { key: { Country: country, 'Customer Group': group }, value };
}
const w1Groups = Object.values(biggest).map((r) => r.key);
const w2Country = choose([...countriesLY], 'W2.country', 0);
const m2Group = choose([...groupsM7], 'M2.group', 0);
const c1Group = choose([...groupsClosed], 'C1.group', 0);

// Last year's volume per customer, SKU and plan month, and this year's per closed month, for those choices.
const keep = new Set(w1Groups.map((g) => g['Customer Group']));
const volumeLY = new Map(); // keyOf({ Customer, SKU, Months }) -> volume
const volumeClosed = new Map(); // keyOf({ Customer, SKU, Months }) -> volume
await forEach('IMPORT Volume', (r) => {
    const group = groupOf(r.Customer);
    if (r.Years === LY && PLAN.includes(r.Months) && (keep.has(group) || group === m2Group || countryOf('Customer', r.Customer) === w2Country)) {
        add(volumeLY, keyOf({ Customer: r.Customer, SKU: skuOf(r.Material), Months: r.Months }), r.value);
    }
    if (r.Years === D.year && CLOSED.includes(r.Months) && group === c1Group) add(volumeClosed, keyOf({ Customer: r.Customer, SKU: skuOf(r.Material), Months: r.Months }), r.value);
});
const ly = rowsOf(volumeLY).filter((r) => r.value > 0);
// Cells already typed in FC 6+6, which a write must not take.
const typed = new Set();
await forEach('Volume Override IN', (r) => {
    if (r.Versions === FC.Versions && r.Years === FC.Years) typed.add(keyOf({ Customer: r.Customer, SKU: r.SKU, Months: r.Months }));
});
const typedGroupCategory = new Set([...typed].map((k) => {
    const c = Object.fromEntries(JSON.parse(k));
    return keyOf({ 'Customer Group': groupOf(c.Customer), Category: above('SKU', c.SKU, 'Category') });
}));
const targets = new Set();
await forEach('Volume Target IN', (r) => {
    if (r.Versions === FC.Versions && r.Years === FC.Years) targets.add(keyOf({ 'Customer Group': r['Customer Group'], Category: r.Category }));
});

const picks = { seed: D.seed };

// --- L1 to L3 Loads -------------------------------------------------------------------------------------------

picks.L1 = { repeats: loads, notChecked: ['I3: no reference for the source amounts before allocation'], zero: ['every check'] };
{
    const t = tests.tests.find((x) => x.id === 'L2');
    picks.L2 = { repeats: loads, flags: t.action.then.map((w) => ({ variable: w.write, at: w.at, value: w.value })), zero: ['CHECK Import Total by country'] };
}
{
    // A SKU with a unit weight and last year's volume in the plan months. Its weight goes up by a quarter.
    const weights = new Map();
    await forEach('IMPORT Unit Weight', (r) => {
        if (r.value > 0) weights.set(r.SKU, r.value);
    });
    const sku = choose([...skusLY].filter((x) => weights.has(x)), 'L3', 0);
    picks.L3 = { repeats: loads, sku, brand: above('SKU', sku, 'Brand'), value: weights.get(sku) * 1.25 };
}

// --- W1 Type one volume, in the biggest customer group of each country --------------------------------------
{
    // The cells of each group, once.
    const cellsOf = new Map(w1Groups.map((g) => [g['Customer Group'], ly.filter((r) => groupOf(r.key.Customer) === g['Customer Group'] && !typed.has(keyOf(r.key)))]));
    const used = new Set();
    picks.W1 = [];
    for (let i = 0; i < writes; i++) {
        const g = choose(w1Groups, 'W1.group', i);
        const cells = cellsOf.get(g['Customer Group']).filter((r) => !used.has(keyOf(r.key)));
        const c = choose(cells, 'W1.cell', i);
        used.add(keyOf(c.key));
        const value = Math.round(c.value * between(0.5, 1.5, 'W1.value', i));
        picks.W1.push({ warmup: i < warmup, at: { ...c.key, ...FC }, country: g.Country, value });
    }
}

// --- W2 Paste 1,000 volumes at once, in the plan months of one country --------------------------------------
{
    const country = w2Country;
    const pool = sorted(ly.filter((r) => countryOf('Customer', r.key.Customer) === country));
    const cells = [];
    for (let k = 0; k < 1000 && pool.length; k++) {
        const c = pool.splice(rng.int(pool.length, 'W2.cell', k), 1)[0];
        cells.push({ at: { ...c.key, ...FC }, value: Math.round(c.value * between(0.5, 1.5, 'W2.value', k)) });
    }
    picks.W2 = { repeats: bulk, country, months: PLAN, cells };
}

// --- W3 Change a rebate rate ----------------------------------------------------------------------------------
{
    // A customer group with last year's sales in a plan month. The new rate is from 1 % to 5 %.
    const byGroupMonth = totals(
        sales.filter((r) => PLAN.includes(r.key.Months)),
        (r) => keyOf({ 'Customer Group': groupOf(r.key.Customer), Months: r.key.Months })
    );
    const cells = order(
        rowsOf(byGroupMonth)
            .filter((r) => r.value > 0)
            .map((r) => r.key),
        'W3.cell'
    );
    picks.W3 = [];
    for (let i = 0; i < Math.min(writes, cells.length); i++) {
        const at = { 'Customer Group': cells[i]['Customer Group'], ...FC, Months: cells[i].Months };
        picks.W3.push({ warmup: i < warmup, at, country: countryOf('Customer Group', at['Customer Group']), value: between(0.01, 0.05, 'W3.value', i) });
    }
}

// --- W4 Raise a brand's price ---------------------------------------------------------------------------------
{
    const brands = order([...new Set([...skusLY].map((sku) => above('SKU', sku, 'Brand')))], 'W4.brand');
    const increase = new Map();
    await forEach('Price Increase IN', (r) => {
        if (r.Versions === FC.Versions && r.Years === FC.Years) increase.set(r.Brand, r.value);
    });
    picks.W4 = [];
    for (let i = 0; i < Math.min(writes, brands.length); i++) {
        picks.W4.push({ warmup: i < warmup, brand: brands[i], months: PLAN, value: (increase.get(brands[i]) ?? 0) + between(0.01, 0.05, 'W4.value', i) });
    }
}

// --- W5 Change a planning exchange rate: the last actual rate, moved up to 5 % --------------------------------
{
    const t = tests.tests.find((x) => x.id === 'W5');
    const last = new Map();
    await forEach('IMPORT FX Rate', (r) => {
        if (r.Years === D.year && r.Months === CLOSED.at(-1)) last.set(r.Currency, r.value);
    });
    // A currency other than EUR, with a country that uses it and a last actual rate.
    const countryOfCurrency = new Map(membersOf('Country').map((m) => [m.parents.Currency, m.name]));
    const currencies = membersOf('Currency')
        .map((m) => m.name)
        .filter((c) => c !== 'EUR' && countryOfCurrency.has(c) && last.get(c) > 0)
        .sort();
    const pool = [];
    for (const c of currencies) for (const m of PLAN) pool.push({ Currency: c, Months: m });
    const cells = [];
    for (let k = 0; pool.length; k++) cells.push(pool.splice(rng.int(pool.length, 'W5.order', k), 1)[0]);
    picks.W5 = [];
    for (let i = 0; i < Math.min(t.runs.warmup + t.runs.repeats, cells.length); i++) {
        const at = { Currency: cells[i].Currency, ...FC, Months: cells[i].Months };
        const country = countryOfCurrency.get(at.Currency);
        picks.W5.push({ warmup: i < t.runs.warmup, at, country, value: last.get(at.Currency) * between(0.95, 1.05, 'W5.value', i) });
    }
}

// --- W6a and W6b Change the cost of a warehouse (allocated) and of an office (not allocated) -----------------
for (const [id, fn] of [
    ['W6a', 'Logistics'],
    ['W6b', 'Administration'],
]) {
    const opex = [];
    await forEach('OPEX IN', (r) => {
        if (r.Versions === FC.Versions && r.Years === FC.Years && PLAN.includes(r.Months) && above('Cost Center', r['Cost Center'], 'Function') === fn) {
            opex.push({ key: { 'Cost Center': r['Cost Center'], Account: r.Account, Months: r.Months }, value: r.value });
        }
    });
    const cells = order(opex, `${id}.cell`);
    picks[id] = [];
    for (let i = 0; i < Math.min(writes, cells.length); i++) {
        const at = { 'Cost Center': cells[i].key['Cost Center'], Account: cells[i].key.Account, ...FC, Months: cells[i].key.Months };
        const value = cells[i].value + Math.round(between(1000, 100000, `${id}.value`, i));
        picks[id].push({ warmup: i < warmup, at, country: countryOf('Cost Center', at['Cost Center']), value });
    }
}

// --- W7 Set a yearly target, for one customer group and category ---------------------------------------------
{
    const cells = order(
        rowsOf(volumeLYByGroupCategory)
            .filter((r) => r.value > 0 && !typedGroupCategory.has(keyOf(r.key)) && !targets.has(keyOf(r.key)))
            .map((r) => r.key),
        'W7.cell'
    );
    picks.W7 = [];
    for (let i = 0; i < Math.min(writes, cells.length); i++) {
        const { 'Customer Group': group, Category: category } = cells[i];
        const value = Math.round(volumeLYByGroupCategory.get(keyOf(cells[i])) * between(0.9, 1.2, 'W7.value', i));
        picks.W7.push({ warmup: i < warmup, group, category, months: PLAN, value });
    }
}

// --- W8 Flip a yearly bonus ------------------------------------------------------------------------------------
// The threshold goes just across the group's planned growth, which the model calculates. So the value is not
// here: RAMA's W8 works it out in its untimed setup, and runner/run.mjs --record saves it with the answers.
{
    const rates = [];
    await forEach('Growth Bonus Rate IN', (r) => {
        if (r.Versions === FC.Versions && r.Years === FC.Years && r.value > 0) rates.push(r['Customer Group']);
    });
    const salesByGroup = totals(sales, (r) => groupOf(r.key.Customer));
    const groups = order(rates.filter((g) => salesByGroup.get(g) > 0 && groupsLY.has(g)), 'W8.group');
    picks.W8 = [];
    for (let i = 0; i < Math.min(writes, groups.length); i++) picks.W8.push({ warmup: i < warmup, group: groups[i], zero: ['CHECK Growth Bonus'] });
}

// --- R1 to R8 Reads ------------------------------------------------------------------------------------------
for (const id of ['R1', 'R2a', 'R2b', 'R2c', 'R3', 'R4', 'R6']) picks[id] = { warm };
{
    // A customer group with last year's sales in M7, and a country with last year's sales.
    const groups = [...new Set(sales.filter((r) => r.value > 0 && r.key.Months === 'M7').map((r) => groupOf(r.key.Customer)))];
    picks.R5 = { warm, group: choose(groups, 'R5', 0) };
    const countries = [...new Set(sales.filter((r) => r.value > 0).map((r) => countryOf('Customer', r.key.Customer)))];
    picks.R7 = { warm, country: choose(countries, 'R7', 0) };
    picks.R8 = { repeats: 3 };
}

// --- M1 to M4 Model changes ------------------------------------------------------------------------------------
picks.M1 = { repeats: models };
{
    // A customer group with last year's volume in M7, and a SKU it bought then. The new customer joins the group.
    const group = m2Group;
    const sku = choose([...new Set(ly.filter((r) => r.key.Months === 'M7' && groupOf(r.key.Customer) === group).map((r) => r.key.SKU))], 'M2.sku', 0);
    const peer = membersOf('Customer').filter((m) => m.parents['Customer Group'] === group).sort((a, b) => (a.name < b.name ? -1 : 1))[0];
    picks.M2 = { repeats: models, customer: 'NEW-CUST-1', group, region: peer.parents.Region, sku, value: 1 + rng.int(1000, 'M2.value', 0), country: countryOf('Customer Group', group) };
}
{
    // A customer with last year's sales, and another group of the same country and channel.
    const customers = [...new Set(sales.filter((r) => r.value > 0).map((r) => r.key.Customer))].sort();
    // The groups of each country and channel, once.
    const sameKind = new Map();
    for (const m of membersOf('Customer Group')) {
        const k = `${m.parents.Country}|${m.parents.Channel}`;
        if (!sameKind.has(k)) sameKind.set(k, []);
        sameKind.get(k).push(m.name);
    }
    for (const list of sameKind.values()) list.sort();
    const options = [];
    for (const c of customers) {
        const g = groupOf(c);
        const gp = parents.get('Customer Group').get(g);
        const others = (sameKind.get(`${gp.Country}|${gp.Channel}`) ?? []).filter((x) => x !== g);
        if (others.length) options.push({ key: { Customer: c }, customer: c, group: g, others });
    }
    const o = choose(options, 'M3.customer', 0);
    picks.M3 = { repeats: models, customer: o.customer, group: o.group, target: o.others[rng.int(o.others.length, 'M3.target', 0)] };
}
picks.M4 = { repeats: models, zero: ['CHECK OPEX in EBIT'] };

// --- C1 to C3 Checks without a timer ---------------------------------------------------------------------------
{
    // A customer, SKU and closed month with actual volume, in the group chosen above. A typed volume there
    // changes nothing.
    const c = choose(rowsOf(volumeClosed).filter((r) => r.value > 0), 'C1', 0);
    let value = Math.round(c.value * between(0.5, 1.5, 'C1.value', 0));
    if (value === c.value) value += 1;
    picks.C1 = { repeats: 1, at: { ...c.key, ...FC }, country: countryOf('Customer', c.key.Customer), value };
}
picks.C2 = { repeats: 1, zero: ['answer'] };
{
    // W1's first write, then the EBIT of another country with sales, so a leaked write would show.
    const w = picks.W1[0];
    const withSales = new Set(sales.filter((r) => r.value > 0).map((r) => countryOf('Customer', r.key.Customer)));
    const others = membersOf('Country').map((m) => m.name).filter((c) => c !== w.country && withSales.has(c));
    picks.C3 = { repeats: 1, at: w.at, value: w.value, country: choose(others, 'C3', 0) };
}

// --- picks.json, and its line in the manifest ------------------------------------------------------------------
const text = JSON.stringify(picks, null, 1) + '\n';
fs.writeFileSync(path.join(dataset, 'picks.json'), text);
const manifestFile = path.join(dataset, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
manifest.files = manifest.files.filter((f) => f.path !== 'picks.json');
manifest.files.push({ path: 'picks.json', rows: null, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') });
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
