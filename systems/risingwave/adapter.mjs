// RisingWave, one single_node server in Docker, through node-postgres. Every calculated variable is a
// materialized view, and RisingWave keeps every view up to date incrementally as the input tables change.
// So a write is an INSERT or DELETE on an input table, then FLUSH, which waits until every view has
// taken the change in. Nothing is rebuilt.
//
// The SQL comes from ../sql/translate.mjs in the 'risingwave' dialect: a streaming view has no cross join
// and no join on <, so those become equality joins (see the translator). The data lives on a Docker
// volume. FLUSH waits for a checkpoint, which RisingWave writes to its state store, so a flushed write
// survives a restart.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { translate } from '../sql/translate.mjs';
import { readSql } from '../sql/reads.mjs';
import { readCells } from '../rama/payload.mjs';
import { MONTHS } from '../../runner/lib/model.mjs';
import { newDict, extendDict, dictFromRows, reverse, dimRow, dimRows, SYSTEM_DIMS } from '../sql/dict.mjs';

const IMAGE = 'risingwavelabs/risingwave:v3.1.0';
const CONFIG = `[meta.developer]
actor_cnt_per_worker_parallelism_soft_limit = 4000
actor_cnt_per_worker_parallelism_hard_limit = 8000
`;
const PORT = Number(process.env.FPABENCH_RISINGWAVE_PORT ?? 24576);
// RisingWave sizes its caches from the machine's memory. Inside Docker Desktop, whose VM has less memory
// than the host, it can size them too large and be killed. FPABENCH_RISINGWAVE_MEMORY (bytes) tells it the
// real budget. Unset on the benchmark machine.
const MEMORY = process.env.FPABENCH_RISINGWAVE_MEMORY ? ['--total-memory-bytes', process.env.FPABENCH_RISINGWAVE_MEMORY] : [];
// Every stage of every view runs once per unit of parallelism, by default one per core. To try a run on a
// bigger machine with the benchmark machine's 4 cores, set FPABENCH_RISINGWAVE_PARALLELISM=4. Unset on the
// benchmark machine.
const PARALLELISM = process.env.FPABENCH_RISINGWAVE_PARALLELISM ? ['--parallelism', process.env.FPABENCH_RISINGWAVE_PARALLELISM] : [];
const id = (s) => `"${String(s).replace(/"/g, '""')}"`;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const num = (x) => (Number.isFinite(x) ? String(x) : 'NULL');
const docker = (...a) => execFileSync('docker', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const statements = (sql) =>
    sql
        .split(/;\s*\n/)
        .map((s) => s.replace(/^(--[^\n]*\n)+/, '').trim())
        .filter(Boolean);

export async function create({ work, model }) {
    // Container and volume names are tied to the work folder, so two runs never share them.
    const tag = Buffer.from(path.resolve(work)).toString('hex').slice(-12);
    const container = `fpabench-rw-${tag}`;
    const volume = `fpabench-rw-${tag}`;
    let client = null;
    let sql = null;
    let dict = null;
    let names = null;

    const run = (q) => client.query(q);
    const rows = async (q) => (await client.query(q)).rows;
    const allDims = () => [...model.userDims, ...SYSTEM_DIMS];
    const retranslate = () => {
        names = reverse(dict);
        sql = translate(model, { versions: adapter.system.Versions, years: adapter.system.Years, dialect: 'risingwave', kind: 'MV', dict });
    };
    const idOf = (d, m) => {
        const v = dict.get(d)?.get(m);
        if (v === undefined) throw new Error(`no member ${m} in ${d}`);
        return v;
    };
    const nameOf = (d, v) => names.get(d)?.get(Number(v)) ?? (v === null ? null : `#${v}`);

    async function start() {
        try {
            docker('start', container);
        } catch {
            // The model is 167 views of several stages each. RisingWave caps the stages ("actors") per unit of
            // parallelism, and the default cap refuses a model this size, so the config raises it.
            const cfg = path.join(path.resolve(work), 'risingwave.toml');
            fs.writeFileSync(cfg, CONFIG);
            // Telemetry off: a benchmark run sends nothing out.
            docker('run', '-d', '--name', container, '-e', 'RW_TELEMETRY_ENABLED=false', '-p', `${PORT}:4566`, '-v', `${volume}:/root/.risingwave`, '-v', `${cfg}:/risingwave.toml:ro`, IMAGE, 'single_node', '--config-path', '/risingwave.toml', ...MEMORY, ...PARALLELISM);
        }
        for (let i = 0; ; i++) {
            try {
                client = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'root', database: 'dev' });
                await client.connect();
                await client.query('SELECT 1');
                return;
            } catch {
                client = null;
                if (i > 3000) throw new Error('risingwave did not start in 5 minutes');
                await new Promise((r) => setTimeout(r, 100));
            }
        }
    }
    async function stop() {
        if (client) await client.end().catch(() => {});
        client = null;
        try {
            docker('stop', '-t', '60', container);
        } catch {
            // not running
        }
    }

    async function insertRows(table, cols, list) {
        for (let i = 0; i < list.length; i += 5000) await run(`INSERT INTO ${id(table)} (${cols.map(id).join(', ')}) VALUES ${list.slice(i, i + 5000).join(', ')}`);
    }
    // A table with a primary key overwrites the row with the same key, so an INSERT is an upsert.
    async function upsert(cells) {
        const byVar = new Map();
        for (const c of cells) {
            if (!byVar.has(c.variable)) byVar.set(c.variable, []);
            byVar.get(c.variable).push(c);
        }
        for (const [name, list] of byVar) {
            const x = model.variable(name);
            const put = list.filter((c) => c.value !== null).map((c) => `(${[...x.dims.map((d) => idOf(d, c.at[d])), num(c.value)].join(', ')})`);
            await insertRows(name, [...x.dims, 'v'], put);
            for (const c of list.filter((c) => c.value === null)) await run(`DELETE FROM ${id(name)} WHERE ${x.dims.map((d) => `${id(d)} = ${idOf(d, c.at[d])}`).join(' AND ')}`);
        }
    }
    const createViews = async (chunks) => {
        for (const chunk of chunks) for (const s of statements(chunk)) await run(s);
    };

    const adapter = {
        name: 'RisingWave',
        version: IMAGE.split(':')[1],
        settings: {
            approach: 'one materialized view per calculated variable, maintained incrementally',
            server: 'single_node in Docker, one container on the same machine',
            visible: 'FLUSH after every write',
            nonDefault: 'meta.developer.actor_cnt_per_worker_parallelism_soft_limit = 4000, hard_limit = 8000. The defaults refuse a model of 167 views.',
            keys: 'integer member ids',
            threads: 'default',
        },
        system: null,

        async load(cellsDir) {
            const { cells, system } = await readCells(model, path.join(cellsDir, 'cells.csv'));
            adapter.system = { Versions: [...system.Versions].sort(), Years: [...system.Years].sort(), Months: MONTHS };
            fs.mkdirSync(work, { recursive: true });
            fs.writeFileSync(path.join(work, 'system.json'), JSON.stringify(adapter.system));
            dict = newDict(model, adapter.system);
            retranslate();
            await stop();
            try {
                docker('rm', '-f', container);
            } catch {
                // none yet
            }
            try {
                docker('volume', 'rm', '-f', volume);
            } catch {
                // none yet
            }
            await start();
            for (const s of statements(sql.schema)) await run(s);
            for (const d of allDims()) {
                const cols = [d, 'name', ...(SYSTEM_DIMS.includes(d) ? [] : model.parentsOf(d))];
                await insertRows(`dim ${d}`, cols, dimRows(model, dict, d).map((r) => `(${r.map((x, i) => (i === 1 ? lit(x) : x)).join(', ')})`));
            }
            // The inputs go in before the views, so each view is built once from full tables.
            for (const [name, byKey] of cells) {
                const x = model.variable(name);
                const vals = [...byKey.values()].map((c) => `(${[...x.open.map((d, i) => idOf(d, c.members[i])), num(c.value)].join(', ')})`);
                await insertRows(name, [...x.open, 'v'], vals);
            }
            await run('FLUSH');
            await createViews(sql.rebuildSql());
            await run('FLUSH');
        },

        async open() {
            if (client) return;
            if (!adapter.system) adapter.system = JSON.parse(fs.readFileSync(path.join(work, 'system.json'), 'utf8'));
            await start();
            const byDim = {};
            for (const d of allDims()) byDim[d] = await rows(`SELECT ${id(d)} AS id, name FROM ${id(`dim ${d}`)}`);
            dict = dictFromRows(byDim);
            if (extendDict(dict, model).length) throw new Error('the model has members the database does not');
            retranslate();
        },
        async close() {
            await stop();
        },

        // The data is on a Docker volume. A snapshot is a copy of that volume, made while the server is stopped.
        async saveSnapshot(name) {
            docker('volume', 'create', `${volume}-${name}`);
            docker('run', '--rm', '-v', `${volume}:/from`, '-v', `${volume}-${name}:/to`, 'alpine:3.22', 'sh', '-c', 'rm -rf /to/* && cp -a /from/. /to/');
        },
        async loadSnapshot(name) {
            docker('run', '--rm', '-v', `${volume}-${name}:/from`, '-v', `${volume}:/to`, 'alpine:3.22', 'sh', '-c', 'rm -rf /to/* && cp -a /from/. /to/');
        },
        dataDirs: () => [],

        async read({ variable, by = [], where = {} }) {
            const out = await rows(readSql(model, { variable, by, where }, 'risingwave', dict));
            return out.map((r) => ({ key: Object.fromEntries(by.map((d) => [d, nameOf(d, r[d])])), value: Number(r.v) }));
        },

        /** Every stored cell of a variable, as rows { key, value }. For checks, not timed. */
        async cells(variable) {
            const x = model.variable(variable);
            const out = await rows(`SELECT * FROM ${id(x.name)}`);
            return out.map((r) => ({ key: Object.fromEntries(x.dims.map((d) => [d, nameOf(d, r[d])])), value: Number(r.v) }));
        },

        async write(cells) {
            await upsert(cells);
            await run('FLUSH');
        },

        async loadCells(cellsDir, { cells: extra = [] } = {}) {
            const { cells } = await readCells(model, path.join(cellsDir, 'cells.csv'));
            const list = [];
            for (const [name, byKey] of cells) {
                const x = model.variable(name);
                for (const c of byKey.values()) list.push({ variable: name, at: Object.fromEntries(x.open.map((d, i) => [d, c.members[i]])), value: c.value });
            }
            await upsert([...list, ...extra]);
            await run('FLUSH');
        },

        setModel(next) {
            model = next;
            if (dict && client) {
                extendDict(dict, model);
                retranslate();
            }
        },

        // New or moved members are rows of the dimension tables, and the views follow them. A changed formula
        // drops its view and every view that reads it, and creates them again from the changed model.
        async changeModel({ model: next, members = [], variables = [], cells = [] }) {
            const before = sql;
            model = next;
            extendDict(dict, model);
            retranslate();
            for (const { dim, name } of members) {
                const r = dimRow(model, dict, dim, name);
                const cols = [dim, 'name', ...model.parentsOf(dim)];
                await insertRows(`dim ${dim}`, cols, [`(${r.map((x, i) => (i === 1 ? lit(x) : x)).join(', ')})`]);
            }
            if (variables.length) {
                const changed = new Set(variables.map((v) => v.name));
                const recreate = sql.rebuildSql(changed);
                const drop = recreate.map((c) => c.match(/CREATE MATERIALIZED VIEW ("(?:[^"]|"")+")/)[1]).filter((n) => before.calculated.includes(n.slice(1, -1).replace(/""/g, '"')));
                for (const n of drop.reverse()) await run(`DROP MATERIALIZED VIEW IF EXISTS ${n} CASCADE`);
                await createViews(recreate);
            }
            await upsert(cells);
            await run('FLUSH');
        },
    };
    return adapter;
}
