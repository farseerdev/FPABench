// The reference reading of a dataset: which column of which file feeds which IMPORT or IN variable.
//
//   node cells.mjs <dataset dir> <out dir>
//
// It writes the model's input cells to one long CSV, with a variable, a value and one column per
// dimension, and one member file per dimension in the format of model/dimensions/. Months like
// 2024-03 become Years Y2024 and Months M3. An empty field makes no cell. Codes stay text.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const [src, out] = process.argv.slice(2);
if (!src || !out) {
    console.error('usage: node cells.mjs <dataset dir> <out dir>');
    process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'dimensions'), { recursive: true });

const DIMS = [
    'Customer',
    'Material',
    'SKU',
    'Customer Group',
    'Brand',
    'Country',
    'Currency',
    'Cost Center',
    'Account',
    'Temperature Zone',
    'Category',
    'Channel',
    'Versions',
    'Years',
    'Months',
];
const cells = fs.openSync(path.join(out, 'cells.csv'), 'w');
let buf = 'variable,value,' + DIMS.map(q).join(',') + '\n';
let count = 0;

function q(s) {
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function emit(variable, value, coords) {
    if (value === '' || value === undefined) return;
    buf +=
        q(variable) +
        ',' +
        value +
        ',' +
        DIMS.map((d) => (coords[d] === undefined ? '' : q(coords[d]))).join(',') +
        '\n';
    count++;
    if (buf.length > 1 << 22) {
        fs.writeSync(cells, buf);
        buf = '';
    }
}
const ym = (month) => {
    const [y, m] = month.split('-');
    return { Years: `Y${y}`, Months: `M${Number(m)}` };
};

async function* rows(file) {
    const full = path.join(src, file);
    if (!fs.existsSync(full)) return;
    const rl = readline.createInterface({ input: fs.createReadStream(full), crlfDelay: Infinity });
    let header = null;
    for await (const line of rl) {
        const f = splitCsv(line);
        if (!header) header = f;
        else yield Object.fromEntries(header.map((h, i) => [h, f[i] ?? '']));
    }
}
function splitCsv(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
            if (c === '"' && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else if (c === '"') inQ = false;
            else cur += c;
        } else if (c === '"') inQ = true;
        else if (c === ',') {
            out.push(cur);
            cur = '';
        } else cur += c;
    }
    out.push(cur);
    return out;
}

// Members as in model/dimensions: the member, @description, then one column per parent.
async function dimension(name, file, key, parents) {
    let text = [name, '@description', ...parents.map(([dim]) => dim)].map(q).join(',') + '\n';
    for await (const r of rows(file))
        text += [r[key], r.name ?? '', ...parents.map(([, col]) => r[col] ?? '')].map(q).join(',') + '\n';
    fs.writeFileSync(path.join(out, 'dimensions', `${name}.csv`), text);
}

await dimension('Country', 'master/countries.csv', 'country', [['Currency', 'currency']]);
await dimension('Region', 'master/regions.csv', 'region', []);
await dimension('Customer Group', 'master/customer_groups.csv', 'customer_group', [
    ['Channel', 'channel'],
    ['Country', 'country'],
]);
await dimension('Customer', 'master/customers.csv', 'customer', [
    ['Customer Group', 'customer_group'],
    ['Region', 'region'],
]);
await dimension('Brand Group', 'master/brand_groups.csv', 'brand_group', []);
await dimension('Brand', 'master/brands.csv', 'brand', [
    ['Brand Group', 'brand_group'],
    ['Brand Type', 'brand_type'],
]);
await dimension('Category', 'master/categories.csv', 'category', [['Division', 'division']]);
await dimension('Subcategory', 'master/subcategories.csv', 'subcategory', [['Category', 'category']]);
await dimension('Product Line', 'master/product_lines.csv', 'product_line', [
    ['Subcategory', 'subcategory'],
    ['Brand', 'brand'],
]);
await dimension('Plant', 'master/plants.csv', 'plant', [['Supply Type', 'supply_type']]);
await dimension('SKU', 'master/skus.csv', 'sku', [
    ['Product Line', 'product_line'],
    ['Pack Format', 'pack_format'],
    ['Size Band', 'size_band'],
    ['Price Tier', 'price_tier'],
    ['Temperature Zone', 'temperature_zone'],
    ['Lifecycle Status', 'lifecycle_status'],
    ['Plant', 'plant'],
]);
await dimension('Material', 'master/materials.csv', 'material', [['SKU', 'sku']]);
await dimension('Cost Center', 'master/cost_centers.csv', 'cost_center', [
    ['Function', 'function'],
    ['Country', 'country'],
    ['Channel', 'channel'],
]);

// --- actuals -----------------------------------------------------------------------------------
for await (const r of rows('actuals/sales.csv')) {
    const k = { Customer: r.customer, Material: r.material, ...ym(r.month) };
    emit('IMPORT Volume', r.units, k);
    emit('IMPORT Gross Sales', r.gross_sales, k);
    emit('IMPORT Standard Discounts', r.standard_discount, k);
    emit('IMPORT Promo Discounts', r.promo_discount, k);
    emit('IMPORT Logistics Discounts', r.logistics_discount, k);
    emit('IMPORT Promo Funding', r.promo_funding, k);
}
for await (const r of rows('actuals/rebates.csv')) {
    emit('IMPORT Rebates', r.accrual, { 'Customer Group': r.customer_group, ...ym(r.month) });
    emit('IMPORT Rebate True-ups', r.true_up, { 'Customer Group': r.customer_group, ...ym(r.month) });
}
for await (const r of rows('actuals/growth_bonus.csv'))
    emit('IMPORT Growth Bonus', r.amount, { 'Customer Group': r.customer_group, ...ym(r.month) });
for await (const r of rows('actuals/trade_fees.csv'))
    emit('IMPORT Trade Fees', r.amount, { 'Customer Group': r.customer_group, Brand: r.brand, ...ym(r.month) });
for await (const r of rows('actuals/opex.csv'))
    emit('IMPORT OPEX', r.amount, { 'Cost Center': r.cost_center, Account: r.account, ...ym(r.month) });
for await (const r of rows('actuals/marketing.csv'))
    emit('IMPORT Marketing', r.amount, { Brand: r.brand, Country: r.country, ...ym(r.month) });
for await (const r of rows('actuals/list_prices.csv'))
    emit('IMPORT List Price', r.list_price, { SKU: r.sku, Country: r.country, ...ym(r.month) });
for await (const r of rows('actuals/standard_costs.csv'))
    emit('IMPORT Standard Cost', r.standard_cost_eur, { SKU: r.sku, Years: `Y${r.year}` });
for await (const r of rows('actuals/fx_rates.csv'))
    emit('IMPORT FX Rate', r.rate_per_eur, { Currency: r.currency, ...ym(r.month) });
for await (const r of rows('actuals/control_totals.csv'))
    emit('IMPORT Control Total', r.gross_sales, { Country: r.country, ...ym(r.month) });
for await (const r of rows('master/skus.csv')) emit('IMPORT Unit Weight', r.unit_weight_kg, { SKU: r.sku });
for await (const r of rows('master/handling_factors.csv'))
    emit('IMPORT Handling Factor', r.factor, { 'Temperature Zone': r.temperature_zone });

// --- plan ------------------------------------------------------------------------------------
const plan = [
    ['fc_closed.csv', 'FC Closed IN', 'flag', []],
    ['fc_horizon.csv', 'FC Horizon IN', 'flag', []],
    [
        'volume_target.csv',
        'Volume Target IN',
        'units',
        [
            ['Customer Group', 'customer_group'],
            ['Category', 'category'],
        ],
    ],
    [
        'volume_growth.csv',
        'Volume Growth IN',
        'growth',
        [
            ['Brand', 'brand'],
            ['Channel', 'channel'],
        ],
    ],
    [
        'volume_override.csv',
        'Volume Override IN',
        'units',
        [
            ['Customer', 'customer'],
            ['SKU', 'sku'],
        ],
    ],
    ['price_increase.csv', 'Price Increase IN', 'increase', [['Brand', 'brand']]],
    [
        'standard_discount.csv',
        'Standard Discount IN',
        'rate',
        [
            ['Customer Group', 'customer_group'],
            ['Brand', 'brand'],
        ],
    ],
    [
        'promo_discount.csv',
        'Promo Discount IN',
        'rate',
        [
            ['Customer Group', 'customer_group'],
            ['Brand', 'brand'],
        ],
    ],
    ['logistics_discount.csv', 'Logistics Discount IN', 'rate', [['Customer Group', 'customer_group']]],
    ['rebate_rate.csv', 'Rebate Rate IN', 'rate', [['Customer Group', 'customer_group']]],
    ['growth_bonus_rate.csv', 'Growth Bonus Rate IN', 'rate', [['Customer Group', 'customer_group']]],
    ['growth_bonus_threshold.csv', 'Growth Bonus Threshold IN', 'threshold', [['Customer Group', 'customer_group']]],
    [
        'trade_fees.csv',
        'Trade Fees IN',
        'amount',
        [
            ['Customer Group', 'customer_group'],
            ['Brand', 'brand'],
        ],
    ],
    [
        'promo_funding.csv',
        'Promo Funding IN',
        'amount',
        [
            ['Customer', 'customer'],
            ['SKU', 'sku'],
        ],
    ],
    ['standard_cost.csv', 'Standard Cost IN', 'standard_cost_eur', [['SKU', 'sku']]],
    ['fx_rate.csv', 'FX Rate IN', 'rate_per_eur', [['Currency', 'currency']]],
    ['marketing_spend.csv', 'Marketing Spend IN', 'amount_eur', [['Brand', 'brand']]],
    [
        'marketing_split.csv',
        'Marketing Split IN',
        'share',
        [
            ['Brand', 'brand'],
            ['Country', 'country'],
        ],
    ],
    [
        'opex.csv',
        'OPEX IN',
        'amount',
        [
            ['Cost Center', 'cost_center'],
            ['Account', 'account'],
        ],
    ],
];
for (const [file, variable, col, dims] of plan) {
    for await (const r of rows(`plan/${file}`)) {
        const k = { Versions: r.version };
        if (r.month) Object.assign(k, ym(r.month));
        else k.Years = `Y${r.year}`;
        for (const [d, c] of dims) k[d] = r[c];
        emit(variable, r[col], k);
    }
}

fs.writeSync(cells, buf);
fs.closeSync(cells);
console.log(`${count} input cells written to ${path.join(out, 'cells.csv')}`);
