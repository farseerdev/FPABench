// Random results on the real test list, so the results page can be designed
// before real ones exist. Nothing here is measured. The page shows a banner
// whenever it uses this data.
//
// It follows tests/method.md where the method shapes the page: one machine,
// every test at 10m and 100m but only loads and reads above that, and the
// summary numbers the method reports for each kind of test.

const MACHINE = 'n2d-standard-4';
const SCALES = ['10m', '100m', '1b', '10b'];
const EVERY_TEST = ['10m', '100m'];

const KINDS = [
    { id: 'load', label: 'Loads' },
    { id: 'write', label: 'Writes' },
    { id: 'read', label: 'Reads' },
    { id: 'model', label: 'Model changes' },
];

export const APPROACHES = [
    { id: 'cells', label: 'Stored cells' },
    { id: 'ivm', label: 'Incremental views' },
    { id: 'views', label: 'Plain views' },
    { id: 'tables', label: 'Refreshed tables' },
];

const ENTRIES = [
    { id: 'rama', name: 'RAMA', approach: 'cells', open: false },
    { id: 'duckdb', name: 'DuckDB', approach: 'views', open: true },
    { id: 'duckdb-tables', name: 'DuckDB (tables)', approach: 'tables', open: true },
    { id: 'clickhouse', name: 'ClickHouse', approach: 'views', open: true },
    { id: 'clickhouse-tables', name: 'ClickHouse (tables)', approach: 'tables', open: true },
    { id: 'feldera', name: 'Feldera', approach: 'ivm', open: true },
    { id: 'risingwave', name: 'RisingWave', approach: 'ivm', open: true },
];

// Seconds at 10m, before the random factors.
const BASE = { load: 20, write: 0.2, read: 0.05, model: 2 };

function random(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// `tests` is the list from tests/tests.json. Only tests that are ready get times.
export function demoResults(tests, seed = 20261011) {
    const rnd = random(seed);
    const gaussian = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    const spread = (sigma) => Math.exp(sigma * gaussian());
    const round = (x) => Number(x.toPrecision(3));
    const results = [];
    for (const entry of ENTRIES) {
        // Each entry gets its own random strength per kind of test. No entry is favoured.
        const profile = Object.fromEntries(KINDS.map((k) => [k.id, spread(1.2)]));
        SCALES.forEach((scale, step) => {
            if (step >= 2 && rnd() < 0.25) return;
            const times = {};
            for (const test of tests) {
                if (test.status !== 'ready') continue;
                if (!EVERY_TEST.includes(scale) && (test.kind === 'write' || test.kind === 'model')) continue;
                const r = rnd();
                if (test.kind === 'model' && rnd() < 0.15) times[test.id] = { check: 'unsupported' };
                else if (r < 0.02) times[test.id] = { check: 'error' };
                else if (r < 0.035 && step >= 2) times[test.id] = { check: 'timeout' };
                else {
                    const time = BASE[test.kind] * profile[test.kind] * spread(0.5) * 10 ** (step * (test.kind === 'read' ? 0.8 : 1));
                    const result = { check: r > 0.975 ? 'wrong' : 'ok', time: round(time) };
                    if (test.kind === 'read') result.cold = round(time * (1.2 + 2 * rnd()));
                    if (test.kind === 'write') result.p95 = round(time * (1.1 + rnd()));
                    times[test.id] = result;
                }
            }
            results.push({ entry: entry.id, scale, tests: times });
        });
    }
    return {
        demo: true,
        machine: MACHINE,
        kinds: KINDS,
        tests: tests.map(({ id, name, kind, status }) => ({ id, name, kind, status })),
        scales: SCALES,
        approaches: APPROACHES,
        entries: ENTRIES,
        results,
    };
}
