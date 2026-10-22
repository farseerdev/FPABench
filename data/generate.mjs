// Writes one FPABench dataset.
//
//   node generate.mjs --size 10m [--out <dir>]
//
// Sizes: 10m, 100m, 1b, 10b. The output folder gets master/, actuals/, plan/, increments/, schema.json,
// manifest.json, README.md and picks.json, the picks of the tests (see picks.mjs). The same size and
// version always give the same bytes.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { params } from './params.mjs';
import { CsvWriter, money, fixed } from './lib/csv.mjs';
import { buildWorld } from './lib/world.mjs';
import { simulateSales } from './lib/sales.mjs';
import {
    SalesTotals,
    writeRebates,
    writeGrowthBonus,
    writeTradeFees,
    writeMarketing,
    writeOpex,
    writeListPrices,
    writeStandardCosts,
    writeFx,
    writeControlTotals,
} from './lib/actuals.mjs';
import { writeFlags, writePlan } from './lib/plan.mjs';

export const GENERATOR_VERSION = '0.6-draft';

function args() {
    const a = process.argv.slice(2);
    const get = (name, dflt) => {
        const i = a.indexOf(name);
        return i >= 0 ? a[i + 1] : dflt;
    };
    const size = get('--size', '10m');
    return { size, out: get('--out', path.join(process.cwd(), `fpabench-${size}`)) };
}

const SALES_COLUMNS = [
    'month',
    'customer',
    'material',
    'currency',
    'units',
    'gross_sales',
    'standard_discount',
    'promo_discount',
    'logistics_discount',
    'promo_funding',
];

function main() {
    const { size, out } = args();
    const started = Date.now();
    // Calibration only: try another customer count for a size. A published dataset never sets it.
    if (process.env.FPABENCH_CUSTOMERS) params.sizes[size].customers = Number(process.env.FPABENCH_CUSTOMERS);
    const world = buildWorld(params, size);
    const { p, cal, rng } = world;
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });

    const files = [];
    const open = (rel, columns) => {
        const w = new CsvWriter(path.join(out, rel), columns);
        files.push({ rel, w });
        return w;
    };
    const currencyOf = Object.fromEntries(p.countries.map((c) => [c.code, c.currency]));

    // --- master data ---------------------------------------------------------------------------
    const mw = (rel, columns, rows) => {
        const w = open(rel, columns);
        for (const r of rows) w.row(r);
    };
    mw(
        'master/countries.csv',
        ['country', 'name', 'currency'],
        p.countries.map((c) => [c.code, c.name, c.currency])
    );
    mw(
        'master/regions.csv',
        ['region', 'name'],
        world.regions.map((r) => [r.code, r.name])
    );
    mw(
        'master/customer_groups.csv',
        ['customer_group', 'name', 'channel', 'country'],
        world.groups.map((g) => [g.code, g.name, g.channel, g.country])
    );
    mw(
        'master/customers.csv',
        ['customer', 'name', 'customer_group', 'region'],
        world.customers.map((c) => [c.code, c.name, c.group.code, c.region])
    );
    mw(
        'master/brand_groups.csv',
        ['brand_group', 'name'],
        world.brandGroups.map((b) => [b.code, b.name])
    );
    mw(
        'master/brands.csv',
        ['brand', 'name', 'brand_group', 'brand_type'],
        world.brands.map((b) => [b.code, b.name, b.brandGroup, b.brandType])
    );
    mw(
        'master/categories.csv',
        ['category', 'name', 'division'],
        world.categories.map((c) => [c.code, c.name, c.division])
    );
    mw(
        'master/subcategories.csv',
        ['subcategory', 'name', 'category'],
        world.subcategories.map((s) => [s.code, s.name, s.category])
    );
    mw(
        'master/product_lines.csv',
        ['product_line', 'name', 'subcategory', 'brand'],
        world.productLines.map((l) => [l.code, l.name, l.subcategory, l.brand])
    );
    mw(
        'master/plants.csv',
        ['plant', 'name', 'supply_type'],
        world.plants.map((x) => [x.code, x.name, x.supplyType])
    );
    mw(
        'master/skus.csv',
        [
            'sku',
            'name',
            'product_line',
            'pack_format',
            'size_band',
            'price_tier',
            'temperature_zone',
            'lifecycle_status',
            'plant',
            'unit_weight_kg',
        ],
        world.skus.map((s) => [
            s.code,
            s.name,
            s.line,
            s.packFormat,
            s.sizeBand,
            s.priceTier,
            s.temperatureZone,
            s.lifecycleStatus,
            s.plant,
            fixed(s.weightKg, 3),
        ])
    );
    mw(
        'master/materials.csv',
        ['material', 'name', 'sku'],
        world.materials.map((m) => [m.code, m.name, m.sku])
    );
    mw(
        'master/cost_centers.csv',
        ['cost_center', 'name', 'function', 'country', 'channel'],
        world.costCenters.map((c) => [c.code, c.name, c.function, c.country, c.channel])
    );
    mw(
        'master/handling_factors.csv',
        ['temperature_zone', 'factor'],
        Object.entries(p.handlingFactor).map(([z, f]) => [z, fixed(f, 2)])
    );

    // --- sales -----------------------------------------------------------------------------------
    const sales = open('actuals/sales.csv', SALES_COLUMNS);
    const closeSales = open('increments/close-2026-07/actuals/sales.csv', SALES_COLUMNS);
    const correctionMonth = cal.index('2026-03');
    const corrected = [];
    // Change of gross sales per country from the restated rows, for the restated control totals.
    const correctionDelta = new Map();
    const totals = new SalesTotals(world);
    const row = (t, c, r) => [
        cal.months[t].key,
        c.code,
        r.mat.code,
        currencyOf[c.country],
        String(r.units),
        money(r.gross),
        r.sd === null ? null : money(r.sd),
        r.pd === null ? null : money(r.pd),
        r.ld === null ? null : money(r.ld),
        r.pf === null ? null : money(r.pf),
    ];
    simulateSales(world, {
        agg: totals,
        row(t, c, r) {
            if (t <= cal.lastActual) sales.row(row(t, c, r));
            else if (t === cal.close) closeSales.row(row(t, c, r));
            // The correction load restates some rows of an old month: a few customers' units were wrong.
            if (
                t === correctionMonth &&
                c.known &&
                rng.chance(c.channel === 'MT' || c.channel === 'WS' ? 0.25 : 0.02, 'correction-customer', c.index)
            ) {
                const f = 1 + 0.1 * rng.normal('correction-units', c.index, r.sku.index);
                const units = Math.round(r.units * f);
                if (units !== 0 && units !== r.units) {
                    const k = units / r.units;
                    const gross = Math.round(r.gross * k);
                    correctionDelta.set(c.country, (correctionDelta.get(c.country) || 0) + gross - r.gross);
                    const scale = (v) => (v === null ? null : Math.round(v * k));
                    corrected.push(
                        row(t, c, {
                            ...r,
                            units,
                            gross,
                            sd: scale(r.sd),
                            pd: scale(r.pd),
                            ld: scale(r.ld),
                            pf: scale(r.pf),
                        })
                    );
                }
            }
        },
    });

    // --- other actuals ---------------------------------------------------------------------------
    for (const [base, which] of [
        ['actuals', 'actual'],
        ['increments/close-2026-07/actuals', 'close'],
    ]) {
        writeRebates(
            world,
            totals,
            open(`${base}/rebates.csv`, ['month', 'customer_group', 'accrual', 'true_up']),
            which
        );
        writeGrowthBonus(world, totals, open(`${base}/growth_bonus.csv`, ['month', 'customer_group', 'amount']), which);
        writeTradeFees(
            world,
            totals,
            open(`${base}/trade_fees.csv`, ['month', 'customer_group', 'brand', 'amount']),
            which
        );
        writeOpex(world, totals, open(`${base}/opex.csv`, ['month', 'cost_center', 'account', 'amount']), which);
        writeMarketing(world, totals, open(`${base}/marketing.csv`, ['month', 'brand', 'country', 'amount']), which);
        writeListPrices(world, open(`${base}/list_prices.csv`, ['month', 'sku', 'country', 'list_price']), which);
        writeFx(world, open(`${base}/fx_rates.csv`, ['month', 'currency', 'rate_per_eur']), which);
        writeControlTotals(
            world,
            totals,
            open(`${base}/control_totals.csv`, ['month', 'country', 'gross_sales']),
            which
        );
    }
    writeStandardCosts(world, open('actuals/standard_costs.csv', ['year', 'sku', 'standard_cost_eur']));

    // --- plan ------------------------------------------------------------------------------------
    writeFlags(
        world,
        open('plan/fc_closed.csv', ['version', 'month', 'flag']),
        open('plan/fc_horizon.csv', ['version', 'month', 'flag'])
    );
    writePlan(world, totals, open);

    // --- increments ------------------------------------------------------------------------------
    // Correction: restated sales rows and rebate bookings of an old month. They replace the old values.
    const cs = open('increments/correction/actuals/sales.csv', SALES_COLUMNS);
    for (const r of corrected) cs.row(r);
    // The export restates its control totals for the countries the correction touches.
    const cc = open('increments/correction/actuals/control_totals.csv', ['month', 'country', 'gross_sales']);
    for (const c of p.countries) {
        const delta = correctionDelta.get(c.code);
        if (!delta) continue;
        const old = totals.countryGross.get(`${c.code}|${correctionMonth}`) || 0;
        cc.row([cal.months[correctionMonth].key, c.code, money(old + delta)]);
    }
    const cr = open('increments/correction/actuals/rebates.csv', ['month', 'customer_group', 'accrual', 'true_up']);
    world.termsBook.terms.forEach((term, gi) => {
        if (term.rebate <= 0 || !rng.chance(0.2, 'correction-rebate', gi)) return;
        const inv = totals.groupInvoice.get(`${gi}|${correctionMonth}`) || 0;
        const accrual = Math.round(inv * term.rebate);
        const trueUp = Math.round(accrual * 0.1 * rng.normal('correction-trueup', gi));
        if (accrual === 0 && trueUp === 0) return;
        cr.row([
            '2026-03',
            term.group.code,
            accrual === 0 ? null : money(accrual),
            trueUp === 0 ? null : money(trueUp),
        ]);
    });

    // Master changes: the customers and materials the export missed, and customers that changed group.
    const mc = open('increments/master-changes/master/customers.csv', ['customer', 'name', 'customer_group', 'region']);
    const moved = [];
    for (const c of world.customers) {
        if (c.channel !== 'TT' && c.channel !== 'HC') continue;
        if (!rng.chance(0.01, 'customer-moves', c.index)) continue;
        const others = world.groups.filter(
            (g) => g.country === c.country && g.channel === c.channel && g.code !== c.group.code
        );
        if (!others.length) continue;
        moved.push([c.code, c.name, others[rng.int(others.length, 'customer-new-group', c.index)].code, c.region]);
    }
    for (const c of world.unknownCustomers) moved.push([c.code, c.name, c.group.code, c.region]);
    moved.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    for (const r of moved) mc.row(r);
    const mm = open('increments/master-changes/master/materials.csv', ['material', 'name', 'sku']);
    for (const m of world.unknownMaterials) mm.row([m.code, m.name, m.sku]);

    // Price list: new list prices for the last closed month, for some SKUs and countries. They replace the old.
    const pl = open('increments/price-list/actuals/list_prices.csv', ['month', 'sku', 'country', 'list_price']);
    const lastKey = cal.months[cal.lastActual].key;
    for (const s of world.skus) {
        if (s.launch > cal.lastActual || s.end < cal.lastActual) continue;
        for (const c of p.countries) {
            if (!(s.countryMask & (1 << world.countryIndex[c.code]))) continue;
            if (!rng.chance(0.1, 'new-price', s.index, world.countryIndex[c.code])) continue;
            const old = world.listPrice(s, c.code, cal.lastActual);
            const whole = p.wholeUnitCurrencies.includes(c.currency);
            const raw = old * (1.02 + 0.04 * rng.u('new-price-step', s.index, world.countryIndex[c.code]));
            pl.row([lastKey, s.code, c.code, money(whole ? Math.round(raw / 100) * 100 : Math.round(raw))]);
        }
    }

    // --- schema, manifest, readme --------------------------------------------------------------
    const results = files.map(({ rel, w }) => ({ path: rel, columns: w.columns, ...w.close() }));
    fs.writeFileSync(path.join(out, 'schema.json'), JSON.stringify(schema(results), null, 2) + '\n');
    const manifest = {
        benchmark: 'FPABench',
        generator: GENERATOR_VERSION,
        size,
        seed: p.seed,
        files: results.map(({ path: rel, rows, bytes, sha256 }) => ({ path: rel, rows, bytes, sha256 })),
    };
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'README.md'), readme(world, results));
    // The picks of the tests, from the files just written. It adds picks.json to the manifest.
    execFileSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'picks.mjs'), out], { stdio: 'inherit' });

    const total = (rel) => results.find((r) => r.path === rel).rows;
    console.log(
        `${size}: ${world.customers.length} customers, ${world.skus.length} SKUs, ${
            world.materials.length
        } materials, ${total('actuals/sales.csv')} sales rows, ${results.length} files, ${(
            (Date.now() - started) /
            1000
        ).toFixed(1)} s`
    );
}

const TYPES = {
    month: 'month, YYYY-MM',
    year: 'integer',
    units: 'integer',
    flag: 'integer',
    unit_weight_kg: 'decimal',
    factor: 'decimal',
    rate_per_eur: 'decimal',
    standard_cost_eur: 'decimal',
    growth: 'decimal',
    increase: 'decimal',
    rate: 'decimal',
    threshold: 'decimal',
    share: 'decimal',
};
const AMOUNTS = new Set([
    'gross_sales',
    'standard_discount',
    'promo_discount',
    'logistics_discount',
    'promo_funding',
    'accrual',
    'true_up',
    'amount',
    'amount_eur',
    'list_price',
]);

function schema(results) {
    const files = {};
    for (const r of results) {
        const key = r.path.replace(/^increments\/[^/]+\//, '');
        files[r.path] = {
            same_as: key !== r.path ? key : undefined,
            columns: r.columns.map((c) => ({
                name: c,
                type: AMOUNTS.has(c) ? 'decimal, two places' : TYPES[c] || 'text',
            })),
        };
    }
    return {
        format: 'UTF-8 CSV with a header row, comma separated, decimal point. An empty field means no value.',
        files,
    };
}

function readme(world, results) {
    const rows = (rel) => results.find((r) => r.path === rel)?.rows ?? 0;
    return `# FPABench dataset, size ${world.sizeName}

Made by the FPABench data generator ${GENERATOR_VERSION} with seed ${
        world.p.seed
    }. Every file and its SHA-256 are listed in \`manifest.json\`. Column types are in \`schema.json\`.

| | |
|---|---:|
| Customers | ${world.customers.length} |
| Customer groups | ${world.groups.length} |
| SKUs | ${world.skus.length} |
| Materials | ${world.materials.length} |
| Sales rows, January 2023 to June 2026 | ${rows('actuals/sales.csv')} |

The company and all its customers, brands and products are invented.

Licence: CC BY 4.0. Exchange rates are the euro reference rates of the European Central Bank, monthly averages. Source: ECB.
`;
}

main();
