// Random results, so the results page can be designed before real ones exist.
// Nothing here is measured. The tests are examples, not the benchmark's tests.
// The page shows a banner whenever it uses this data.

const CATEGORIES = [
    { id: 'load', label: 'Loads' },
    { id: 'read', label: 'Reads' },
    { id: 'write', label: 'Writes' },
    { id: 'model', label: 'Model changes' },
];

const TESTS = [
    { id: 'L1', category: 'load', title: 'Initial load', what: 'Load the master data, three years of invoice lines and the plan, then calculate everything.' },
    { id: 'L2', category: 'load', title: 'Close a month', what: 'Load one month of actuals and move the forecast flags.' },
    { id: 'R1', category: 'read', title: 'Company P&L by month', what: 'Every P&L line for every month of one version and year.' },
    { id: 'R2', category: 'read', title: 'Customer ranking', what: 'Contribution margin of every customer for one year, sorted.' },
    { id: 'R3', category: 'read', title: 'Brand by country', what: 'Net sales and contribution margin % for every brand and country.' },
    { id: 'R4', category: 'read', title: 'One customer in detail', what: "One customer's gross-to-net by SKU and month." },
    { id: 'W1', category: 'write', title: 'Type one volume', what: 'Type the volume of one customer, SKU and month, then read the P&L.' },
    { id: 'W2', category: 'write', title: 'Change a price increase', what: 'Change the planned price increase of one brand, then read the P&L.' },
    { id: 'W3', category: 'write', title: 'Change a volume target', what: 'Change the target of one customer group and category. It cascades to every customer, SKU and plan month under it.' },
    { id: 'W4', category: 'write', title: 'Change a cost', what: 'Change one logistics cost. It is allocated again to every customer and brand in the country.' },
    { id: 'M1', category: 'model', title: 'Change a formula', what: 'Change how rebates are calculated, then read the P&L.' },
    { id: 'M2', category: 'model', title: 'Add a P&L line', what: 'Add a new deduction line and take it off net sales.' },
    { id: 'M3', category: 'model', title: 'Move customers', what: 'Move a tenth of the customers to another customer group.' },
];

const SCALES = ['SF1', 'SF10', 'SF100', 'SF1000'];
const MACHINES = ['c6a.4xlarge', 'c6a.metal'];

const APPROACHES = [
    { id: 'cells', label: 'Stored cells' },
    { id: 'ivm', label: 'Incremental views' },
    { id: 'views', label: 'Plain views' },
    { id: 'tables', label: 'Refreshed tables' },
];

const ENTRIES = [
    { id: 'farseer', name: 'Farseer', approach: 'cells', open: false },
    { id: 'duckdb', name: 'DuckDB', approach: 'views', open: true },
    { id: 'duckdb-tables', name: 'DuckDB (tables)', approach: 'tables', open: true },
    { id: 'clickhouse', name: 'ClickHouse', approach: 'views', open: true },
    { id: 'clickhouse-tables', name: 'ClickHouse (tables)', approach: 'tables', open: true },
    { id: 'feldera', name: 'Feldera', approach: 'ivm', open: true },
    { id: 'risingwave', name: 'RisingWave', approach: 'ivm', open: true },
];

// Seconds for one run at SF1 on the smaller machine, before the random factors.
const BASE = { load: 20, read: 0.05, write: 0.2, model: 2 };

function random(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function demoResults(seed = 20261006) {
    const rnd = random(seed);
    const gaussian = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    const spread = (sigma) => Math.exp(sigma * gaussian());
    const round = (x) => Number(x.toPrecision(3));
    const results = [];
    for (const entry of ENTRIES) {
        // Each entry gets its own random strength per category. No entry is favoured.
        const profile = Object.fromEntries(CATEGORIES.map((c) => [c.id, spread(1.2)]));
        for (const machine of MACHINES) {
            const machineFactor = machine === 'c6a.metal' ? 0.45 : 1;
            SCALES.forEach((scale, step) => {
                if (step >= 2 && rnd() < 0.25) return;
                const tests = {};
                for (const test of TESTS) {
                    const r = rnd();
                    if (test.category === 'model' && rnd() < 0.15) tests[test.id] = { runs: null, check: 'unsupported' };
                    else if (r < 0.02) tests[test.id] = { runs: null, check: 'error' };
                    else if (r < 0.035 && step >= 2) tests[test.id] = { runs: null, check: 'timeout' };
                    else {
                        const hot = BASE[test.category] * profile[test.category] * spread(0.5) * machineFactor * 10 ** (step * (test.category === 'read' ? 0.8 : 1));
                        const runs = [hot * (1.2 + 2 * rnd()), hot * (1 + 0.1 * rnd()), hot * (1 + 0.1 * rnd())].map(round);
                        tests[test.id] = { runs, check: r > 0.975 ? 'wrong' : 'ok' };
                    }
                }
                const day = String(1 + Math.floor(rnd() * 28)).padStart(2, '0');
                results.push({ entry: entry.id, machine, scale, date: `2026-09-${day}`, tests });
            });
        }
    }
    return {
        demo: true,
        categories: CATEGORIES,
        tests: TESTS,
        scales: SCALES,
        machines: MACHINES,
        approaches: APPROACHES,
        entries: ENTRIES,
        results,
    };
}
