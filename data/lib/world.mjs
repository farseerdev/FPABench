// The company: calendar, products, customers, cost centers, prices and terms.
// Everything here is fixed before any sales are drawn.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng, Alias } from './rng.mjs';
import { exp, log, pow } from './detmath.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// --- small helpers ------------------------------------------------------------------------------

// Count of a level as base * (n / ref)^exponent, at least 1.
function scaled([base, exponent], n, ref) {
    return Math.max(1, Math.round(base * pow(n / ref, exponent)));
}

// Picks a key of a { key: weight } object with a uniform number.
function pickWeighted(weights, u) {
    const entries = Object.entries(weights);
    let total = 0;
    for (const [, w] of entries) total += w;
    let x = u * total;
    for (const [k, w] of entries) {
        if (x < w) return k;
        x -= w;
    }
    return entries[entries.length - 1][0];
}

function between([lo, hi], u) {
    return lo + (hi - lo) * u;
}

function pad(n, width) {
    return String(n).padStart(width, '0');
}

// A smooth step from 0 to 1 around z = 0, for the normal score of a customer's size.
function logistic(z) {
    return 1 / (1 + exp(-1.7 * z));
}

// --- calendar -----------------------------------------------------------------------------------

export function buildCalendar(time) {
    const [y0, m0] = time.firstMonth.split('-').map(Number);
    const months = [];
    for (let i = 0; i < 48; i++) {
        const y = y0 + Math.floor((m0 - 1 + i) / 12);
        const m = ((m0 - 1 + i) % 12) + 1;
        months.push({ t: i, key: `${y}-${pad(m, 2)}`, year: y, month: m });
    }
    const index = (key) => months.findIndex((x) => x.key === key);
    return {
        months,
        index,
        lastActual: index(time.lastActual),
        close: index(time.closeMonth),
        planYear: time.planYear,
        years: [...new Set(months.map((x) => x.year))],
    };
}

// --- ECB rates ----------------------------------------------------------------------------------

export function loadFx() {
    const text = fs.readFileSync(path.join(here, '..', 'sources', 'ecb-rates.csv'), 'utf8').trim().split('\n').slice(1);
    const rates = new Map();
    for (const line of text) {
        const [month, currency, rate] = line.split(',');
        rates.set(`${currency}|${month}`, { text: rate, value: Number(rate) });
    }
    return rates;
}

// --- names --------------------------------------------------------------------------------------

const CATEGORY_NAMES = {
    Food: [
        ['Sauces and dressings', ['Ketchup', 'Mayonnaise', 'Mustard', 'Pasta sauce', 'Salad dressing']],
        ['Soups and meals', ['Instant soup', 'Bouillon', 'Ready meal', 'Noodles']],
        ['Sweets and snacks', ['Biscuits', 'Chocolate bar', 'Wafers', 'Crisps', 'Pretzels']],
        ['Breakfast', ['Cereal', 'Muesli', 'Sweet spread', 'Porridge']],
        ['Preserves', ['Jam', 'Pickles', 'Canned vegetables', 'Canned fish', 'Pate']],
        ['Coffee and tea', ['Ground coffee', 'Instant coffee', 'Tea bags', 'Cocoa']],
        ['Pasta and grains', ['Pasta', 'Rice', 'Flour', 'Semolina']],
        ['Herbs and spices', ['Seasoning mix', 'Pepper', 'Paprika', 'Herbs']],
        ['Frozen food', ['Frozen vegetables', 'Frozen pizza', 'Ice cream']],
        ['Dairy desserts', ['Pudding', 'Yoghurt dessert', 'Cream dessert']],
    ],
    Beverages: [
        ['Water', ['Mineral water', 'Flavoured water', 'Sparkling water']],
        ['Soft drinks', ['Cola', 'Lemonade', 'Iced tea', 'Energy drink', 'Tonic']],
        ['Juices', ['Orange juice', 'Apple juice', 'Nectar', 'Smoothie']],
        ['Beer', ['Lager', 'Radler', 'Alcohol-free beer']],
        ['Syrups', ['Fruit syrup', 'Cordial']],
    ],
    'Home Care': [
        ['Laundry', ['Washing powder', 'Liquid detergent', 'Fabric softener', 'Stain remover']],
        ['Dishwashing', ['Dish liquid', 'Dishwasher tablets', 'Rinse aid']],
        ['Cleaners', ['All-purpose cleaner', 'Toilet cleaner', 'Glass cleaner', 'Bathroom cleaner']],
        ['Paper', ['Kitchen towels', 'Toilet paper', 'Napkins']],
    ],
    'Personal Care': [
        ['Hair care', ['Shampoo', 'Conditioner', 'Hair spray']],
        ['Body care', ['Shower gel', 'Soap', 'Body lotion', 'Hand cream']],
        ['Oral care', ['Toothpaste', 'Toothbrush', 'Mouthwash']],
        ['Deodorants', ['Deodorant spray', 'Roll-on']],
    ],
};
const VARIANTS = [
    'Classic',
    'Light',
    'Extra',
    'Original',
    'Fresh',
    'Gold',
    'Bio',
    'Mild',
    'Strong',
    'Family',
    'Kids',
    'Sport',
    'Natural',
    'Premium',
    'Mini',
    'Max',
];
const SIZE_LABELS = {
    Food: { Small: '200 g', Medium: '500 g', Large: '1 kg', Bulk: '5 kg' },
    Beverages: { Small: '0.33 l', Medium: '0.5 l', Large: '1.5 l', Bulk: '5 l' },
    'Home Care': { Small: '500 ml', Medium: '1 l', Large: '2 l', Bulk: '10 l' },
    'Personal Care': { Small: '50 ml', Medium: '250 ml', Large: '500 ml', Bulk: '1 l' },
};
const PACK_LABELS = {
    Single: '',
    Multipack: ' 4-pack',
    'Family pack': ' family pack',
    'Catering pack': ' catering',
    'Display pack': ' display',
};
const WEIGHT_BY_SIZE = { Small: 0.4, Medium: 1, Large: 2.2, Bulk: 6 };

// --- products -----------------------------------------------------------------------------------

function buildProducts(p, size, rng, cal) {
    const n = size.skus;
    const H = p.hierarchy;
    const divisions = Object.keys(p.divisions);

    // Categories per division, by division weight, at least one each.
    const nCat = Math.max(divisions.length, scaled(H.categories, n, 1000));
    const categories = [];
    const catCount = {};
    divisions.forEach((d) => (catCount[d] = 1));
    for (let i = divisions.length; i < nCat; i++) catCount[pickWeighted(p.divisions, rng.u('cat-division', i))]++;
    for (const d of divisions) {
        const pool = CATEGORY_NAMES[d];
        for (let j = 0; j < catCount[d]; j++) {
            const [name, subs] = pool[j % pool.length];
            const suffix = j >= pool.length ? ` ${Math.floor(j / pool.length) + 1}` : '';
            categories.push({
                code: `CAT${pad(categories.length + 1, 2)}`,
                name: name + suffix,
                division: d,
                subNames: subs,
                subs: [],
            });
        }
    }

    // Subcategories, spread over categories by division weight.
    const nSub = Math.max(categories.length, scaled(H.subcategories, n, 1000));
    const subcategories = [];
    const catWeights = Object.fromEntries(
        categories.map((c) => [c.code, p.divisions[c.division] / catCount[c.division]])
    );
    const subCount = Object.fromEntries(categories.map((c) => [c.code, 1]));
    for (let i = categories.length; i < nSub; i++) subCount[pickWeighted(catWeights, rng.u('sub-category', i))]++;
    for (const c of categories) {
        for (let j = 0; j < subCount[c.code]; j++) {
            const base = c.subNames[j % c.subNames.length];
            const suffix = j >= c.subNames.length ? ` ${Math.floor(j / c.subNames.length) + 1}` : '';
            const s = {
                code: `SUB${pad(subcategories.length + 1, 3)}`,
                name: base + suffix,
                base,
                category: c.code,
                division: c.division,
            };
            subcategories.push(s);
            c.subs.push(s);
        }
    }

    // Brand groups and brands. A brand lives in one division.
    const nBg = scaled(H.brandGroups, n, 1000);
    const brandGroups = Array.from({ length: nBg }, (_, i) => ({
        code: `BG${pad(i + 1, 2)}`,
        name: `Brand group ${pad(i + 1, 2)}`,
    }));
    const nBrand = Math.max(divisions.length, scaled(H.brands, n, 1000));
    const brands = [];
    for (let i = 0; i < nBrand; i++) {
        const division = i < divisions.length ? divisions[i] : pickWeighted(p.divisions, rng.u('brand-division', i));
        brands.push({
            code: `B${pad(i + 1, 3)}`,
            name: `Brand ${pad(i + 1, 3)}`,
            division,
            brandGroup: brandGroups[rng.int(nBg, 'brand-group', i)].code,
            brandType: i < divisions.length ? 'Own brand' : pickWeighted(p.brandTypes, rng.u('brand-type', i)),
            owner: null,
        });
    }

    // Product lines: one subcategory and one brand of the same division.
    const nLine = Math.max(subcategories.length, scaled(H.productLines, n, 1000));
    const productLines = [];
    const brandsByDivision = Object.fromEntries(divisions.map((d) => [d, brands.filter((b) => b.division === d)]));
    const subsByDivision = Object.fromEntries(divisions.map((d) => [d, subcategories.filter((s) => s.division === d)]));
    for (let i = 0; i < nLine; i++) {
        const sub =
            i < subcategories.length
                ? subcategories[i]
                : (() => {
                      const d = pickWeighted(p.divisions, rng.u('line-division', i));
                      const list = subsByDivision[d];
                      return list[rng.int(list.length, 'line-sub', i)];
                  })();
        const bl = brandsByDivision[sub.division];
        const brand = bl[rng.int(bl.length, 'line-brand', i)];
        const variant = VARIANTS[rng.int(VARIANTS.length, 'line-variant', i)];
        productLines.push({
            code: `LN${pad(i + 1, 4)}`,
            name: `${sub.base} ${variant}`,
            subcategory: sub.code,
            brand: brand.code,
            division: sub.division,
            weight: rng.lognormal(1, 0.8, 'line-weight', i),
        });
    }

    // Plants by supply type.
    const nPlant = scaled(H.plants, n, 1000);
    const plants = Array.from({ length: nPlant }, (_, i) => ({
        code: `PLT${pad(i + 1, 2)}`,
        name: `Plant ${pad(i + 1, 2)}`,
        supplyType: i < Math.ceil(nPlant * 0.6) ? 'Own plant' : 'Co-packer',
    }));

    // SKUs.
    const lineAlias = new Alias(productLines.map((l) => l.weight));
    const last = cal.lastActual;
    const skus = [];
    for (let i = 0; i < n; i++) {
        const line =
            productLines[
                i < productLines.length ? i : lineAlias.sample(rng.u('sku-line-a', i), rng.u('sku-line-b', i))
            ];
        const d = line.division;
        const brand = brands.find((b) => b.code === line.brand);
        const packFormat = pickWeighted(p.packFormats, rng.u('sku-pack', i));
        const sizeBand = pickWeighted(p.sizeBands, rng.u('sku-size', i));
        const priceTier = pickWeighted(p.priceTiers, rng.u('sku-tier', i));
        const temperatureZone = pickWeighted(p.temperatureZones[d], rng.u('sku-temp', i));
        const plant = plants[rng.int(plants.length, 'sku-plant', i)].code;
        // Launch and end inside the window, so that about skuTurnover start and stop each year.
        const years = (last + 1) / 12;
        const launch = rng.chance((p.skuTurnover * years) / (1 + p.skuTurnover * years), 'sku-launch?', i)
            ? 1 + rng.int(last, 'sku-launch', i)
            : -1000;
        let end = rng.chance((p.skuTurnover * years) / (1 + p.skuTurnover * years), 'sku-end?', i)
            ? 1 + rng.int(last, 'sku-end', i)
            : 1000;
        if (end < launch + 6) end = 1000;
        const lifecycleStatus = end <= last + 6 ? 'Phase-out' : launch >= last - 11 ? 'New' : 'Core';
        const [med, sig] = p.basePrice[d];
        const priceEur =
            rng.lognormal(med, sig, 'sku-price', i) *
            p.priceTierFactor[priceTier] *
            p.sizeBandFactor[sizeBand] *
            p.packFactor[packFormat];
        const weightKg = p.unitWeight[d] * WEIGHT_BY_SIZE[sizeBand] * p.packFactor[packFormat];
        const everywhere = rng.chance(p.skuEverywhere, 'sku-everywhere', i);
        const nCountries = 1 + rng.int(3, 'sku-ncountries', i);
        const countryMask = everywhere
            ? 0b111111
            : (() => {
                  let m = 0;
                  for (let k = 0; k < nCountries; k++) m |= 1 << rng.int(6, 'sku-country', i, k);
                  return m;
              })();
        const name = `${line.name} ${SIZE_LABELS[d][sizeBand]}${PACK_LABELS[packFormat]}`;
        skus.push({
            index: i,
            code: `SKU${pad(i + 1, 5)}`,
            name,
            line: line.code,
            brand: brand.code,
            brandIndex: brands.indexOf(brand),
            subcategory: line.subcategory,
            category: subcategories.find((s) => s.code === line.subcategory).category,
            division: d,
            packFormat,
            sizeBand,
            priceTier,
            temperatureZone,
            lifecycleStatus,
            plant,
            launch,
            end,
            popularity: rng.lognormal(1, p.skuPopularity, 'sku-pop', i),
            priceEur,
            weightKg: Math.round(weightKg * 1000) / 1000,
            caseSize: p.caseSize[packFormat],
            countryMask,
            materials: [],
        });
    }

    // Private label brands belong to one chain, chosen once the chains exist.
    return { divisions, categories, subcategories, brandGroups, brands, productLines, plants, skus };
}

// Material codes: eight digits, about a third with a leading zero, unique and increasing.
function materialCode(i, rng) {
    return pad(100000 + i * 199 + rng.int(199, 'material-code', i), 8);
}

function buildMaterials(p, products, rng, cal) {
    const materials = [];
    const unknownMaterials = [];
    const last = cal.lastActual;
    for (const s of products.skus) {
        const main = { code: null, sku: s.code, name: s.name, from: -1000, to: 1000, promo: false };
        s.materials.push(main);
        materials.push(main);
        if (rng.chance(p.materials.artworkChange, 'artwork?', s.index)) {
            const from = Math.max(s.launch, 0) + 3 + rng.int(36, 'artwork-month', s.index);
            if (from < Math.min(s.end, cal.close) - 1) {
                main.to = from + p.materials.overlapMonths - 1;
                const next = { code: null, sku: s.code, name: `${s.name} new artwork`, from, to: 1000, promo: false };
                s.materials.push(next);
                materials.push(next);
            }
        }
        if (rng.chance(p.materials.promoPackShare, 'promo-pack?', s.index)) {
            const promo = { code: null, sku: s.code, name: `${s.name} promo pack`, from: -1000, to: 1000, promo: true };
            s.materials.push(promo);
            materials.push(promo);
        }
        // A new code in the last actual month that the master data export does not know yet.
        if (rng.chance(p.unknown.newMaterialsShare, 'unknown-material?', s.index) && s.end > last) {
            const regular = s.materials.filter((m) => !m.promo);
            const cur = regular[regular.length - 1];
            cur.to = last - 1;
            const next = {
                code: null,
                sku: s.code,
                name: `${s.name} new code`,
                from: last,
                to: 1000,
                promo: false,
                unknown: true,
            };
            s.materials.push(next);
            unknownMaterials.push(next);
        }
    }
    // Codes in a stable order: known materials first, then the unknown ones, which are newer.
    [...materials, ...unknownMaterials].forEach((m, i) => (m.code = materialCode(i, rng)));
    return { materials, unknownMaterials };
}

// --- customers ----------------------------------------------------------------------------------

function buildCustomers(p, size, rng, cal) {
    const n = size.customers;
    const ref = 270;
    const countries = p.countries;
    const groups = [];
    const customers = [];
    const regions = [];

    // Regions: about two per country at the smallest size.
    const regionsPerCountry = Math.max(2, Math.round(2 * pow(n / ref, 0.33)));
    for (const c of countries) {
        for (let j = 0; j < regionsPerCountry; j++)
            regions.push({ code: `${c.code}-R${pad(j + 1, 2)}`, name: `${c.name} region ${j + 1}`, country: c.code });
    }
    const regionsOf = (country) => regions.filter((r) => r.country === country);

    // Groups per country and channel.
    for (const c of countries) {
        for (const [ch, cp] of Object.entries(p.channels)) {
            const count = scaled(cp.groupsPerCountry, n, ref);
            for (let j = 0; j < count; j++) {
                const label = {
                    MT: 'Retail chain',
                    WS: 'Wholesaler',
                    EC: 'Web shop',
                    TT: 'Independent shops cluster',
                    HC: 'HoReCa cluster',
                }[ch];
                groups.push({
                    code: `${c.code}-${ch}-${pad(j + 1, 2)}`,
                    name: `${label} ${pad(j + 1, 2)} ${c.code}`,
                    channel: ch,
                    country: c.code,
                    index: groups.length,
                });
            }
        }
    }

    // Chains, wholesalers and web shops: a few customers per group.
    const draft = [];
    for (const g of groups) {
        const cp = p.channels[g.channel];
        if (!cp.customersPerGroup) continue;
        const [lo, hi] = cp.customersPerGroup;
        const k = lo + rng.int(hi - lo + 1, 'customers-per-group', g.index);
        for (let j = 0; j < k; j++) {
            const label = { MT: 'company', WS: 'branch', EC: 'shop' }[g.channel];
            draft.push({ group: g, name: `${g.name} ${label} ${j + 1}` });
        }
    }
    // Shops and restaurants: the rest, by country weight, split by the country's channel sizes.
    const rest = Math.max(0, n - draft.length);
    const totalWeight = countries.reduce((a, c) => a + c.weight, 0);
    let made = 0;
    countries.forEach((c, ci) => {
        const count = ci === countries.length - 1 ? rest - made : Math.round((rest * c.weight) / totalWeight);
        made += count;
        const ttShare = c.traditionalTrade / (c.traditionalTrade + c.horeca);
        const tt = groups.filter((g) => g.country === c.code && g.channel === 'TT');
        const hc = groups.filter((g) => g.country === c.code && g.channel === 'HC');
        for (let j = 0; j < count; j++) {
            const isTT = rng.chance(ttShare, 'small-channel', ci, j);
            const list = isTT ? tt : hc;
            const g = list[rng.int(list.length, 'small-group', ci, j)];
            const kind = isTT ? 'Shop' : ['Restaurant', 'Hotel', 'Cafe'][rng.int(3, 'horeca-kind', ci, j)];
            draft.push({ group: g, name: `${kind} ${c.code} ${pad(j + 1, 6)}` });
        }
    });

    // Customer codes are ten digits with leading zeros, as an ERP pads them.
    draft.forEach((d, i) => {
        const g = d.group;
        const cp = p.channels[g.channel];
        const growth = pow(n / ref, cp.sizeGrowth);
        const [median, sigma] = cp.size;
        const z = rng.normal('customer-size', i);
        const sizeEur = median * growth * exp(sigma * z);
        const q = logistic(z);
        const activity = cp.activity[0] + (cp.activity[1] - cp.activity[0]) * q;
        const stable = p.customerTurnover.stableChannels.includes(g.channel);
        const last = cal.lastActual;
        let start = -1000;
        let end = 1000;
        if (!stable && rng.chance(p.customerTurnover.startShare, 'customer-start?', i))
            start = rng.int(last + 1, 'customer-start', i);
        if (!stable && rng.chance(p.customerTurnover.endShare, 'customer-end?', i))
            end = rng.int(last + 1, 'customer-end', i);
        if (end < start + 3) end = 1000;
        const regs = regionsOf(g.country);
        customers.push({
            index: i,
            code: pad(100000 + i * 7 + rng.int(7, 'customer-code', i), 10),
            name: d.name,
            group: g,
            channel: g.channel,
            country: g.country,
            region: regs[rng.int(regs.length, 'customer-region', i)].code,
            sizeEur,
            z,
            activity,
            start,
            end,
            known: true,
        });
    });

    // New customers of the last months that the master data export does not know yet.
    const unknownCustomers = [];
    const perMonth = Math.round(p.unknown.newCustomersPerMonth * n);
    for (let k = 0; k < p.unknown.months; k++) {
        const t = cal.lastActual - p.unknown.months + 1 + k;
        for (let j = 0; j < perMonth; j++) {
            const i = customers.length + unknownCustomers.length;
            const c = countries[rng.int(countries.length, 'unknown-customer-country', k, j)];
            const ch = 'TT';
            const cp = p.channels[ch];
            const z = rng.normal('customer-size', i);
            const g = groups.find((x) => x.country === c.code && x.channel === ch);
            unknownCustomers.push({
                index: i,
                code: pad(100000 + i * 7 + rng.int(7, 'customer-code', i), 10),
                name: `Shop ${c.code} new ${pad(i, 6)}`,
                // The real group, for the master data that comes later. The model sees none.
                group: g,
                channel: ch,
                country: c.code,
                region: regionsOf(c.code)[0].code,
                sizeEur: cp.size[0] * pow(n / ref, cp.sizeGrowth) * exp(cp.size[1] * z),
                z,
                activity: 0.9,
                start: t,
                end: 1000,
                known: false,
            });
        }
    }
    return { groups, customers, unknownCustomers, regions };
}

// --- cost centers -------------------------------------------------------------------------------

const COST_CENTERS = [
    ['LOG-WH', 'Warehouse', 'Logistics', null, 0.6],
    ['LOG-TR', 'Transport', 'Logistics', null, 0.4],
    ['SAL-MT', 'Sales modern trade', 'Sales', 'MT', null],
    ['SAL-TT', 'Sales traditional trade', 'Sales', 'TT', null],
    ['SAL-WS', 'Sales wholesale', 'Sales', 'WS', null],
    ['SAL-HC', 'Sales HoReCa', 'Sales', 'HC', null],
    ['SAL-EC', 'Sales e-commerce', 'Sales', 'EC', null],
    ['MKT', 'Marketing', 'Marketing', null, 1],
    ['ADM-FIN', 'Finance', 'Administration', null, 0.3],
    ['ADM-HR', 'Human resources', 'Administration', null, 0.2],
    ['ADM-IT', 'IT', 'Administration', null, 0.25],
    ['ADM-MGT', 'Management', 'Administration', null, 0.25],
];

// Share of a function's cost per account. Assumption.
export const ACCOUNT_PROFILE = {
    Logistics: {
        6100: 0.22,
        6110: 0.05,
        6200: 0.12,
        6210: 0.04,
        6220: 0.03,
        6300: 0.32,
        6310: 0.1,
        6320: 0.08,
        6520: 0.02,
        6900: 0.02,
    },
    Sales: { 6100: 0.45, 6110: 0.1, 6120: 0.1, 6320: 0.1, 6310: 0.06, 6600: 0.08, 6610: 0.03, 6400: 0.03, 6900: 0.05 },
    Marketing: { 6100: 0.55, 6110: 0.12, 6120: 0.08, 6500: 0.1, 6600: 0.08, 6610: 0.03, 6900: 0.04 },
    Administration: {
        6100: 0.35,
        6110: 0.08,
        6120: 0.05,
        6200: 0.08,
        6210: 0.03,
        6400: 0.1,
        6410: 0.04,
        6500: 0.08,
        6510: 0.06,
        6520: 0.05,
        6600: 0.03,
        6610: 0.02,
        6900: 0.03,
    },
};

function buildCostCenters(countries) {
    const list = [];
    for (const c of countries) {
        for (const [suffix, name, fn, channel, share] of COST_CENTERS) {
            list.push({
                code: `${c.code}-${suffix}`,
                name: `${name} ${c.code}`,
                function: fn,
                country: c.code,
                channel,
                share,
            });
        }
    }
    return list;
}

// --- prices -------------------------------------------------------------------------------------

// The list price index of a country, step by step: January every year, July in years of high inflation.
function priceSteps(p, cal, country) {
    const steps = new Float64Array(cal.months.length);
    let idx = 1;
    for (const m of cal.months) {
        const infl = country.foodInflation[m.year] ?? country.foodInflation[cal.planYear];
        const pass = Math.max(0, infl * p.priceChanges.passThrough);
        if (m.t > 0 && m.month === 1) idx *= 1 + (infl > p.priceChanges.midYearAbove ? pass / 2 : pass);
        if (m.month === 7 && infl > p.priceChanges.midYearAbove) idx *= 1 + pass / 2;
        steps[m.t] = idx;
    }
    return steps;
}

// --- terms --------------------------------------------------------------------------------------

function buildTerms(p, rng, cal, groups, brands) {
    const nb = brands.length;
    const terms = groups.map((g) => {
        const tp = p.terms[g.channel];
        const i = g.index;
        const standardBase = between(tp.standard, rng.u('std-base', i));
        const logistics = between(tp.logistics, rng.u('log-rate', i));
        let rebate = between(tp.rebate, rng.u('rebate-rate', i));
        if ((g.channel === 'TT' || g.channel === 'HC') && !rng.chance(0.3, 'rebate-has', i)) rebate = 0;
        const bonus = rng.chance(tp.bonusShare, 'bonus-has', i)
            ? {
                  rate: between(p.growthBonus.rate, rng.u('bonus-rate', i)),
                  threshold: between(p.growthBonus.threshold, rng.u('bonus-threshold', i)),
              }
            : null;
        return {
            group: g,
            standardBase,
            logistics: Math.round(logistics * 10000) / 10000,
            rebate: Math.round(rebate * 10000) / 10000,
            bonus,
        };
    });

    // Standard discount per group and brand. It changes for some pairs in January 2025.
    function standardRate(gi, bi, t) {
        const base = terms[gi].standardBase;
        if (base === 0) return 0;
        let r = base + 0.015 * (2 * rng.u('std-brand', gi, bi) - 1);
        if (cal.months[t].year >= 2025 && rng.chance(0.3, 'std-change?', gi, bi))
            r += 0.01 * (2 * rng.u('std-change', gi, bi) - 1);
        return Math.max(0, Math.round(r * 10000) / 10000);
    }

    // Promotion months per group, brand and year. Rates and uplift per promotion.
    const promoCache = new Map();
    function promo(gi, bi, t) {
        const m = cal.months[t];
        const key = gi * 100000 + bi * 10 + (m.year - 2023);
        let set = promoCache.get(key);
        if (set === undefined) {
            const [lo, hi] = p.terms[groups[gi].channel].promoMonths;
            const k = lo + rng.int(hi - lo + 1, 'promo-count', gi, bi, m.year);
            set = new Set();
            for (let j = 0; j < k * 3 && set.size < k; j++)
                set.add(1 + rng.int(12, 'promo-month', gi, bi, m.year * 100 + j));
            promoCache.set(key, set);
        }
        if (!set.has(m.month)) return null;
        return {
            discount: Math.round(between(p.promo.discount, rng.u('promo-discount', gi, bi, t)) * 10000) / 10000,
            uplift: between(p.promo.uplift, rng.u('promo-uplift', gi, bi, t)),
            funding: Math.round(between(p.promo.funding, rng.u('promo-funding', gi, bi, t)) * 10000) / 10000,
        };
    }

    return { terms, standardRate, promo, brands: nb };
}

// --- the whole company --------------------------------------------------------------------------

export function buildWorld(p, sizeName) {
    const size = p.sizes[sizeName];
    if (!size) throw new Error(`unknown size ${sizeName}. Sizes: ${Object.keys(p.sizes).join(', ')}`);
    const rng = new Rng(p.seed);
    const cal = buildCalendar(p.time);
    const fx = loadFx();
    const products = buildProducts(p, size, rng, cal);
    const { materials, unknownMaterials } = buildMaterials(p, products, rng, cal);
    const people = buildCustomers(p, size, rng, cal);
    const costCenters = buildCostCenters(p.countries);
    const termsBook = buildTerms(p, rng, cal, people.groups, products.brands);

    // Each private label brand belongs to one chain.
    const chains = people.groups.filter((g) => g.channel === 'MT');
    products.brands.forEach((b, i) => {
        if (b.brandType === 'Private label' && chains.length)
            b.owner = chains[rng.int(chains.length, 'private-label-owner', i)].code;
    });

    const countryIndex = Object.fromEntries(p.countries.map((c, i) => [c.code, i]));
    const steps = Object.fromEntries(p.countries.map((c) => [c.code, priceSteps(p, cal, c)]));
    const firstMonth = cal.months[0].key;
    const fxStart = Object.fromEntries(
        p.countries.map((c) => [c.code, c.currency === 'EUR' ? 1 : fx.get(`${c.currency}|${firstMonth}`).value])
    );

    // List price of a SKU in a country and month, in hundredths of the local currency.
    const priceCache = new Map();
    function listPrice(sku, country, t) {
        const key = (sku.index * 8 + countryIndex[country]) * 64 + t;
        let v = priceCache.get(key);
        if (v !== undefined) return v;
        const c = p.countries[countryIndex[country]];
        const own = 1 + 0.3 * rng.normal('price-own', sku.index, countryIndex[country]);
        const step = steps[country][t];
        // The SKU's own change follows the country's steps with its own strength.
        const idx = 1 + (step - 1) * Math.max(0, own);
        let local = sku.priceEur * c.priceLevel * fxStart[country] * idx;
        const whole = p.wholeUnitCurrencies.includes(c.currency);
        v = whole ? Math.max(1, Math.round(local)) * 100 : Math.max(1, Math.round(local * 100));
        priceCache.set(key, v);
        return v;
    }

    // Who may buy a SKU: its countries, pack formats by channel, private label only by its chain.
    const brandOwner = products.brands.map((b) => b.owner);
    function available(sku, customer) {
        if (!(sku.countryMask & (1 << countryIndex[customer.country]))) return false;
        if (sku.packFormat === 'Catering pack' && customer.channel !== 'HC' && customer.channel !== 'WS') return false;
        if (sku.packFormat === 'Display pack' && customer.channel !== 'MT') return false;
        const owner = brandOwner[sku.brandIndex];
        if (owner && owner !== customer.group.code) return false;
        return true;
    }

    // Popularity tables per country and channel, and per private label chain.
    const aliasCache = new Map();
    function skuTable(customer) {
        const owner = customer.channel === 'MT' ? customer.group.code : '';
        const key = `${customer.country}|${customer.channel}|${owner}`;
        let entry = aliasCache.get(key);
        if (!entry) {
            const list = products.skus.filter((s) => available(s, customer));
            entry = { list, alias: new Alias(list.map((s) => s.popularity)) };
            aliasCache.set(key, entry);
        }
        return entry;
    }

    return {
        p,
        sizeName,
        size,
        rng,
        cal,
        fx,
        ...products,
        materials,
        unknownMaterials,
        ...people,
        costCenters,
        termsBook,
        countryIndex,
        listPrice,
        available,
        skuTable,
    };
}
