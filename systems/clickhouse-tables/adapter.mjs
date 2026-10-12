// ClickHouse, one server on the same machine, through @clickhouse/client over HTTP. Every calculated
// variable is a table. A write adds rows to an input table, then every calculated table is built again.
//
// The adapter starts and stops the server itself, so opening the model (R8) includes the server start.
// The input tables are ReplacingMergeTree: a write is a new row version, a delete is a row with
// is_deleted = 1, and every read of an input table uses FINAL. Every table forces new parts to disk
// (fsync_after_insert, fsync_part_directory), so writes are durable.
//
// Two settings are not defaults and are required: join_use_nulls = 1 and aggregate_functions_null_for_empty
// = 1. Without them an outer join fills the missing side with 0 and a sum over no rows gives 0, and
// "missing" silently turns into 0.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createClient, ClickHouseLogLevel } from '@clickhouse/client';
import { translate } from '../sql/translate.mjs';
import { readSql } from '../sql/reads.mjs';
import { readCells } from '../rama/payload.mjs';
import { MONTHS } from '../../runner/lib/model.mjs';
import { newDict, extendDict, dictFromRows, reverse, dimRows, SYSTEM_DIMS } from '../sql/dict.mjs';

const id = (s) => `"${String(s).replace(/"/g, '""')}"`;
const lit = (s) => `'${String(s).replace(/'/g, "''").replace(/\\/g, '\\\\')}'`;
const num = (x) => (Number.isFinite(x) ? String(x) : 'NULL');
const SETTINGS = { join_use_nulls: 1, aggregate_functions_null_for_empty: 1, mutations_sync: 2 };
const PORT = Number(process.env.FPABENCH_CLICKHOUSE_PORT ?? 18123);

const statements = (sql) =>
    sql
        .split(/;\s*\n/)
        .map((s) => s.replace(/^(--[^\n]*\n)+/, '').trim())
        .filter(Boolean);

function config(root) {
    return `<clickhouse>
    <logger><level>warning</level><log>${root}/log/server.log</log><errorlog>${root}/log/error.log</errorlog><console>0</console></logger>
    <http_port>${PORT}</http_port>
    <tcp_port>${PORT + 1}</tcp_port>
    <listen_host>127.0.0.1</listen_host>
    <path>${root}/data/</path>
    <tmp_path>${root}/tmp/</tmp_path>
    <user_files_path>/</user_files_path>
    <users><default><password></password><networks><ip>127.0.0.1</ip><ip>::1</ip></networks><profile>default</profile><quota>default</quota></default></users>
    <profiles><default></default></profiles>
    <quotas><default></default></quotas>
    <query_log><database>system</database><table>query_log</table><flush_interval_milliseconds>7500</flush_interval_milliseconds></query_log>
</clickhouse>
`;
}

export async function create({ work, model }) {
    const bin = process.env.CLICKHOUSE_BIN ?? 'clickhouse';
    const version = execFileSync(bin, ['--version'], { encoding: 'utf8' }).match(/version ([\d.]+)/)?.[1] ?? 'unknown';
    const root = path.resolve(work, 'clickhouse');
    const dataDir = path.join(root, 'data');
    let server = null;
    let client = null;
    let sql = null;
    let ver = Date.now() * 1000;
    let dict = null; // dimension -> Map(member name -> id), see ../sql/dict.mjs
    let names = null;
    const allDims = () => [...model.userDims, ...SYSTEM_DIMS];
    const retranslate = () => {
        names = reverse(dict);
        sql = translate(model, { versions: adapter.system.Versions, years: adapter.system.Years, dialect: 'clickhouse', dict });
    };
    const idOf = (d, m) => {
        const v = dict.get(d)?.get(m);
        if (v === undefined) throw new Error(`no member ${m} in ${d}`);
        return v;
    };
    const nameOf = (d, v) => names.get(d)?.get(Number(v)) ?? (v === null ? null : `#${v}`);

    const run = (query) => client.command({ query, clickhouse_settings: SETTINGS });
    const rows = async (query) => (await client.query({ query, format: 'JSONEachRow', clickhouse_settings: SETTINGS })).json();
    // Builds again the calculated tables a change reaches: the ones that read a changed variable, directly
    // or through other tables. Without `changed`, every table and the dimension lookups.
    const rebuild = async (changed = null) => {
        for (const chunk of sql.rebuildSql(changed)) for (const s of statements(chunk)) await run(s);
    };

    async function start() {
        fs.mkdirSync(path.join(root, 'log'), { recursive: true });
        fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
        fs.writeFileSync(path.join(root, 'config.xml'), config(root));
        server = spawn(bin, ['server', `--config-file=${path.join(root, 'config.xml')}`], { stdio: 'ignore', detached: false });
        // The client logs every failed ping while the server starts. Those are expected, so its log is off.
        client = createClient({ url: `http://127.0.0.1:${PORT}`, request_timeout: 3600_000, log: { level: ClickHouseLogLevel.OFF } });
        for (let i = 0; ; i++) {
            try {
                if ((await client.ping()).success) return;
            } catch {
                // not up yet
            }
            if (server.exitCode !== null) throw new Error(`clickhouse server exited with ${server.exitCode}, see ${root}/log/error.log`);
            if (i > 6000) throw new Error('clickhouse server did not start in 60 s');
            await new Promise((r) => setTimeout(r, 10));
        }
    }
    async function stop() {
        if (!server) return;
        await client.close();
        const exited = new Promise((r) => server.once('exit', r));
        server.kill('SIGTERM');
        await exited;
        server = null;
        client = null;
    }

    async function upsert(cells) {
        const byVar = new Map();
        for (const c of cells) {
            if (!byVar.has(c.variable)) byVar.set(c.variable, []);
            byVar.get(c.variable).push(c);
        }
        ver++;
        for (const [name, list] of byVar) {
            const x = model.variable(name);
            const cols = [...x.dims.map(id), 'v', 'ver', 'is_deleted'];
            for (let i = 0; i < list.length; i += 5000) {
                const vals = list.slice(i, i + 5000).map((c) => `(${[...x.dims.map((d) => idOf(d, c.at[d])), c.value === null ? '0' : num(c.value), String(ver), c.value === null ? '1' : '0'].join(', ')})`);
                await run(`INSERT INTO ${id(name)} (${cols.join(', ')}) VALUES ${vals.join(', ')}`);
            }
        }
    }
    async function fillDimension(d) {
        await run(`TRUNCATE TABLE ${id(`dim ${d}`)}`);
        const vals = dimRows(model, dict, d).map((r) => `(${r.map((x, i) => (i === 1 ? lit(x) : x)).join(', ')})`);
        for (let i = 0; i < vals.length; i += 5000) await run(`INSERT INTO ${id(`dim ${d}`)} VALUES ${vals.slice(i, i + 5000).join(', ')}`);
    }

    const adapter = {
        name: 'ClickHouse',
        version,
        settings: {
            approach: 'one table per calculated variable, the tables a change reaches rebuilt after it',
            server: 'single node on the same machine, HTTP',
            nonDefault: SETTINGS,
            tables: 'inputs ReplacingMergeTree read with FINAL, fsync_after_insert = 1, fsync_part_directory = 1. Calculated tables Memory, rebuilt on start.',
            durable: true,
            keys: 'integer member ids',
            threads: 'default',
        },
        system: null,

        async load(cellsDir) {
            const { system } = await readCells(model, path.join(cellsDir, 'cells.csv'));
            adapter.system = { Versions: [...system.Versions].sort(), Years: [...system.Years].sort(), Months: MONTHS };
            fs.mkdirSync(work, { recursive: true });
            fs.writeFileSync(path.join(work, 'system.json'), JSON.stringify(adapter.system));
            dict = newDict(model, adapter.system);
            retranslate();
            await stop();
            fs.rmSync(root, { recursive: true, force: true });
            await start();
            for (const s of statements(sql.schema)) await run(s);
            for (const d of allDims()) await fillDimension(d);
            await adapter.loadCells(cellsDir, { rebuild: false });
            await rebuild();
        },

        /** Starts the server. The calculated tables are Memory tables, so a start builds them again from the inputs. */
        async open() {
            if (!adapter.system) adapter.system = JSON.parse(fs.readFileSync(path.join(work, 'system.json'), 'utf8'));
            if (server) return;
            await start();
            // The ids are in the dimension tables.
            const byDim = {};
            for (const d of allDims()) byDim[d] = await rows(`SELECT ${id(d)} AS id, name FROM ${id(`dim ${d}`)}`);
            dict = dictFromRows(byDim);
            if (extendDict(dict, model).length) throw new Error('the model has members the database does not');
            retranslate();
            await rebuild();
        },
        async close() {
            await stop();
        },
        dataDirs: () => [root],

        async read(q) {
            const out = await rows(readSql(model, q, 'clickhouse', dict));
            return out.map((r) => ({ key: Object.fromEntries((q.by ?? []).map((d) => [d, nameOf(d, r[d])])), value: Number(r.v) }));
        },

        /** Every stored cell of a variable, as rows { key, value }. For checks, not timed. */
        async cells(variable) {
            const x = model.variable(variable);
            const out = await rows(`SELECT ${[...x.dims.map((d) => `${id(d)} AS ${id(d)}`), 'v'].join(', ')} FROM ${id(x.name)}${x.formula ? '' : ' FINAL'}`);
            return out.map((r) => ({ key: Object.fromEntries(x.dims.map((d) => [d, nameOf(d, r[d])])), value: Number(r.v) }));
        },

        async write(cells) {
            await upsert(cells);
            await rebuild(new Set(cells.map((c) => c.variable)));
        },

        async loadCells(cellsDir, { rebuild: again = true, cells: extra = [] } = {}) {
            const file = path.resolve(path.join(cellsDir, 'cells.csv'));
            const header = fs.readFileSync(file, 'utf8').split('\n', 1)[0].split(',');
            const structure = header.map((h) => `${id(h)} String`).join(', ');
            ver++;
            await run(`CREATE OR REPLACE TABLE cells ENGINE = Memory AS SELECT * FROM file(${lit(file)}, 'CSVWithNames', ${lit(structure)})`);
            // Every member a cell names must have an id. A cell with an unknown member is an error, not a silent drop.
            for (const d of allDims().filter((d) => header.includes(d))) {
                const bad = await rows(`SELECT DISTINCT c.${id(d)} AS m FROM cells AS c WHERE c.${id(d)} <> '' AND c.${id(d)} NOT IN (SELECT name FROM ${id(`dim ${d}`)}) LIMIT 5`);
                if (bad.length) throw new Error(`cells name members ${d} does not have: ${bad.map((r) => r.m).join(', ')}`);
            }
            for (const x of model.variables.filter((v) => !v.formula)) {
                const cols = x.dims.map(id);
                const keys = x.dims.map((d, i) => `k${i}.${id(d)}`);
                const joins = x.dims.map((d, i) => `JOIN ${id(`dim ${d}`)} AS k${i} ON k${i}.name = c.${id(d)}`);
                await run(
                    `INSERT INTO ${id(x.name)} (${[...cols, 'v', 'ver', 'is_deleted'].join(', ')}) SELECT ${[...keys, 'sum(toFloat64(c.value))', String(ver), '0'].join(', ')} FROM cells AS c ${joins.join(' ')} WHERE c.variable = ${lit(x.name)}${keys.length ? ` GROUP BY ${keys.join(', ')}` : ''}`
                );
            }
            const loaded = (await rows('SELECT DISTINCT variable FROM cells')).map((r) => r.variable);
            await run('DROP TABLE cells');
            await upsert(extra);
            if (again) await rebuild(new Set([...loaded, ...extra.map((c) => c.variable)]));
        },

        setModel(next) {
            model = next;
            if (dict && server) {
                extendDict(dict, model);
                retranslate();
            }
        },

        async changeModel({ model: next, members = [], variables = [], cells = [] }) {
            model = next;
            extendDict(dict, model);
            retranslate();
            for (const d of new Set(members.map((m) => m.dim))) await fillDimension(d);
            await upsert(cells);
            // New or moved members change the dimension lookups, so everything is built again.
            await rebuild(members.length ? null : new Set([...variables.map((v) => v.name), ...cells.map((c) => c.variable)]));
        },
    };
    return adapter;
}
