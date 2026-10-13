// Counts what each generated dataset holds, for the website.
//
//   node sizes.mjs <dataset dir> [<dataset dir> ...]
//
// It reads the generated files, never the parameters, and writes data/sizes.json with one entry per
// size: the members of every dimension, the actual rows and their grain, and the planned rows of each
// version. Run it again whenever the generator changes.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORDER = ['10m', '100m', '1b', '10b'];

// Dimension, master file. The order is the order the website shows them in.
const MASTER = [
    ['Country', 'countries.csv'],
    ['Region', 'regions.csv'],
    ['Customer Group', 'customer_groups.csv'],
    ['Customer', 'customers.csv'],
    ['Category', 'categories.csv'],
    ['Subcategory', 'subcategories.csv'],
    ['Brand', 'brands.csv'],
    ['Brand Group', 'brand_groups.csv'],
    ['Product Line', 'product_lines.csv'],
    ['SKU', 'skus.csv'],
    ['Material', 'materials.csv'],
    ['Plant', 'plants.csv'],
    ['Cost Center', 'cost_centers.csv'],
];

async function rows(file, each) {
    let n = 0;
    let header = true;
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
        if (header) {
            header = false;
            continue;
        }
        if (line === '') continue;
        n++;
        if (each) each(line);
    }
    return n;
}

async function count(dir) {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const dimensions = {};
    for (const [name, file] of MASTER) dimensions[name] = await rows(path.join(dir, 'master', file));

    const months = new Set();
    const sales = await rows(path.join(dir, 'actuals', 'sales.csv'), (line) => months.add(line.slice(0, 7)));
    let otherActuals = 0;
    for (const f of fs.readdirSync(path.join(dir, 'actuals'))) {
        if (f !== 'sales.csv' && f.endsWith('.csv')) otherActuals += await rows(path.join(dir, 'actuals', f));
    }

    // Planned rows per version. The two version flag files are setup, not plan.
    const perVersion = {};
    for (const f of fs.readdirSync(path.join(dir, 'plan')).sort()) {
        if (!f.endsWith('.csv') || f.startsWith('fc_')) continue;
        await rows(path.join(dir, 'plan', f), (line) => {
            const v = line.slice(0, line.indexOf(','));
            perVersion[v] = (perVersion[v] || 0) + 1;
        });
    }
    const sortedMonths = [...months].sort();
    return {
        size: manifest.size,
        generator: manifest.generator,
        seed: manifest.seed,
        dimensions,
        actuals: {
            salesRows: sales,
            salesGrain: 'one row per customer, material and month',
            from: sortedMonths[0],
            to: sortedMonths[sortedMonths.length - 1],
            otherRows: otherActuals,
        },
        plan: perVersion,
    };
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
    console.error('usage: node sizes.mjs <dataset dir> [<dataset dir> ...]');
    process.exit(1);
}
const out = path.join(here, 'sizes.json');
const prior = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')).sizes : [];
const bySize = new Map(prior.map((s) => [s.size, s]));
for (const dir of dirs) {
    const c = await count(dir);
    bySize.set(c.size, c);
    console.log(`${c.size}: ${c.dimensions.Customer} customers, ${c.dimensions.SKU} SKUs, ${c.actuals.salesRows} sales rows`);
}
const sizes = ORDER.filter((s) => bySize.has(s)).map((s) => bySize.get(s));
fs.writeFileSync(out, JSON.stringify({ about: 'Counted from generated datasets by data/sizes.mjs.', sizes }, null, 2) + '\n');
