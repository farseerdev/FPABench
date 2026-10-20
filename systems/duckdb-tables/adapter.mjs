// DuckDB, in process through @duckdb/node-api, with every calculated variable as a table.
//
// translate.mjs turns the model into SQL. A load creates the input tables and fills them from the same
// cells.csv RAMA reads, then builds every calculated table in dependency order. A write changes the
// input table in one transaction, then builds every calculated table again, one statement at a time.
// So a write is visible when the rebuild is done. DuckDB writes a database file and forces each commit
// to disk, so writes are durable.
//
// The rebuild is not inside the write's transaction. Inside one transaction DuckDB keeps every replaced
// table until the commit: at 10m one write then took 14.6 s and 19 GB instead of 5.9 s and 1 GB.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DuckDBInstance } from '@duckdb/node-api';
import { translate } from '../sql/translate.mjs';
import { readSql } from '../sql/reads.mjs';
import { MONTHS } from '../../runner/lib/model.mjs';
import { newDict, extendDict, dictFromRows, reverse, dimRow, dimRows, SYSTEM_DIMS } from '../sql/dict.mjs';

const id = (s) => `"${String(s).replace(/"/g, '""')}"`;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const num = (x) => (Number.isFinite(x) ? String(x) : 'NULL');

const statements = (sql) =>
    sql
        .split(/;\s*\n/)
        .map((s) => s.replace(/^(--[^\n]*\n)+/, '').trim())
        .filter(Boolean);

export async function create({ work, model }) {
    const req = createRequire(import.meta.url);
    const version = JSON.parse(fs.readFileSync(path.join(path.dirname(req.resolve('@duckdb/node-api')), '..', 'package.json'), 'utf8')).version;
    const file = path.join(work, 'duckdb.db');
    let instance = null;
    let conn = null;
    let sql = null;
    let dict = null; // dimension -> Map(member name -> id), see ../sql/dict.mjs
    let names = null; // the other way round

    const run = (s) => conn.run(s);
    const rows = async (s) => (await conn.runAndReadAll(s)).getRowObjectsJS();
    const allDims = () => [...model.userDims, ...SYSTEM_DIMS];
    const retranslate = () => {
        names = reverse(dict);
        sql = translate(model, { versions: adapter.system.Versions, years: adapter.system.Years, dict });
    };
    const idOf = (d, m) => {
        const v = dict.get(d)?.get(m);
        if (v === undefined) throw new Error(`no member ${m} in ${d}`);
        return v;
    };
    const nameOf = (d, v) => names.get(d)?.get(Number(v)) ?? (v === null ? null : `#${v}`);
    // Builds again the calculated tables a change reaches: the ones that read a changed variable, directly
    // or through other tables. Without `changed`, every table and the dimension lookups.
    const rebuild = async (changed = null) => {
        for (const chunk of sql.rebuildSql(changed)) for (const s of statements(chunk)) await run(s);
    };

    // The distinct members of one column of cells.csv, sorted.
    const distinct = async (cellsDir, col) =>
        (await rows(`SELECT DISTINCT ${id(col)} AS m FROM read_csv(${lit(path.resolve(path.join(cellsDir, 'cells.csv')))}, header = true, all_varchar = true) WHERE ${id(col)} <> '' ORDER BY m`)).map((r) => r.m);

    async function upsert(cells, { transaction = true } = {}) {
        const byVar = new Map();
        for (const c of cells) {
            if (!byVar.has(c.variable)) byVar.set(c.variable, []);
            byVar.get(c.variable).push(c);
        }
        if (transaction) await run('BEGIN');
        try {
            for (const [name, list] of byVar) {
                const x = model.variable(name);
                const cols = x.dims.map(id);
                const put = list.filter((c) => c.value !== null);
                const del = list.filter((c) => c.value === null);
                for (let i = 0; i < put.length; i += 5000) {
                    const vals = put.slice(i, i + 5000).map((c) => `(${[...x.dims.map((d) => idOf(d, c.at[d])), num(c.value)].join(', ')})`);
                    await run(`INSERT OR REPLACE INTO ${id(name)} (${[...cols, 'v'].join(', ')}) VALUES ${vals.join(', ')}`);
                }
                for (const c of del) await run(`DELETE FROM ${id(name)} WHERE ${x.dims.map((d) => `${id(d)} = ${idOf(d, c.at[d])}`).join(' AND ')}`);
            }
            if (transaction) await run('COMMIT');
        } catch (e) {
            if (transaction) await run('ROLLBACK');
            throw e;
        }
    }

    const adapter = {
        name: 'DuckDB',
        version,
        settings: {
            approach: 'one table per calculated variable, the tables a change reaches rebuilt after it',
            inputs: 'duckdb.db, durable',
            calculated: 'TEMP tables in memory, rebuilt on start',
            keys: 'integer member ids',
            threads: 'default',
        },
        system: null,

        async load(cellsDir) {
            fs.mkdirSync(work, { recursive: true });
            fs.rmSync(file, { force: true });
            fs.rmSync(`${file}.wal`, { force: true });
            await adapter.open({ build: false });
            // DuckDB reads the Versions and Years the cells use straight from cells.csv.
            adapter.system = { Versions: await distinct(cellsDir, 'Versions'), Years: await distinct(cellsDir, 'Years'), Months: MONTHS };
            fs.writeFileSync(path.join(work, 'system.json'), JSON.stringify(adapter.system));
            dict = newDict(model, adapter.system);
            retranslate();
            for (const s of statements(sql.schema)) await run(s);
            for (const d of allDims()) {
                const vals = dimRows(model, dict, d).map((r) => `(${r.map((x, i) => (i === 1 ? lit(x) : x)).join(', ')})`);
                for (let i = 0; i < vals.length; i += 5000) await run(`INSERT INTO ${id(`dim ${d}`)} VALUES ${vals.slice(i, i + 5000).join(', ')}`);
            }
            await adapter.loadCells(cellsDir, { rebuild: false });
            await rebuild();
            await run('CHECKPOINT');
        },

        /** Opens the file. The calculated tables live in memory, so a start builds them again from the inputs. */
        async open({ build = true } = {}) {
            if (conn) return;
            if (build && !adapter.system) adapter.system = JSON.parse(fs.readFileSync(path.join(work, 'system.json'), 'utf8'));
            instance = await DuckDBInstance.create(file);
            conn = await instance.connect();
            if (!build) return;
            // The ids are in the dimension tables.
            const byDim = {};
            for (const d of allDims()) byDim[d] = await rows(`SELECT ${id(d)} AS id, name FROM ${id(`dim ${d}`)}`);
            dict = dictFromRows(byDim);
            if (extendDict(dict, model).length) throw new Error('the model has members the database does not');
            retranslate();
            await rebuild();
        },
        async close() {
            if (!conn) return;
            await run('CHECKPOINT');
            conn.closeSync();
            instance.closeSync?.();
            conn = null;
            instance = null;
        },
        dataDirs: () => [file],
        /** Files a restore must remove: DuckDB's write-ahead log. */
        stale: () => [`${file}.wal`],

        async read({ variable, by = [], where = {} }) {
            const out = await rows(readSql(model, { variable, by, where }, 'duckdb', dict));
            return out.map((r) => ({ key: Object.fromEntries(by.map((d) => [d, nameOf(d, r[d])])), value: r.v }));
        },

        /** Every stored cell of a variable, as rows { key, value }. For checks, not timed. */
        async cells(variable) {
            const x = model.variable(variable);
            const out = await rows(`SELECT * FROM ${id(x.name)}`);
            return out.map((r) => ({ key: Object.fromEntries(x.dims.map((d) => [d, nameOf(d, r[d])])), value: r.v }));
        },

        async write(cells) {
            await upsert(cells);
            await rebuild(new Set(cells.map((c) => c.variable)));
        },

        async loadCells(cellsDir, { rebuild: again = true, cells: extra = [] } = {}) {
            const csv = lit(path.resolve(path.join(cellsDir, 'cells.csv')));
            await run('BEGIN');
            await run(`CREATE OR REPLACE TEMP TABLE cells AS SELECT * FROM read_csv(${csv}, header = true, all_varchar = true)`);
            // Every member a cell names must have an id. A cell with an unknown member is an error, not a silent drop.
            const header = (await rows('SELECT column_name AS c FROM duckdb_columns() WHERE table_name = \'cells\'')).map((r) => r.c);
            for (const d of allDims().filter((d) => header.includes(d))) {
                const bad = await rows(`SELECT DISTINCT c.${id(d)} AS m FROM cells c LEFT JOIN ${id(`dim ${d}`)} k ON k.name = c.${id(d)} WHERE c.${id(d)} IS NOT NULL AND c.${id(d)} <> '' AND k.name IS NULL LIMIT 5`);
                if (bad.length) throw new Error(`cells name members ${d} does not have: ${bad.map((r) => r.m).join(', ')}`);
            }
            for (const x of model.variables.filter((v) => !v.formula)) {
                const keys = x.dims.map((d, i) => `k${i}.${id(d)}`);
                const joins = x.dims.map((d, i) => `JOIN ${id(`dim ${d}`)} k${i} ON k${i}.name = c.${id(d)}`);
                await run(
                    `INSERT OR REPLACE INTO ${id(x.name)} SELECT ${[...keys, 'sum(c.value::DOUBLE)'].join(', ')} FROM cells c ${joins.join(' ')} WHERE c.variable = ${lit(x.name)}${keys.length ? ` GROUP BY ${keys.join(', ')}` : ''}`
                );
            }
            const loaded = (await rows('SELECT DISTINCT variable FROM cells')).map((r) => r.variable);
            await run('DROP TABLE cells');
            await upsert(extra, { transaction: false });
            await run('COMMIT');
            if (again) await rebuild(new Set([...loaded, ...extra.map((c) => c.variable)]));
        },

        setModel(next) {
            model = next;
            if (dict && conn) {
                extendDict(dict, model);
                retranslate();
            }
        },

        async changeModel({ model: next, members = [], variables = [], cells = [] }) {
            model = next;
            extendDict(dict, model);
            retranslate();
            await run('BEGIN');
            for (const { dim, name } of members) {
                const r = dimRow(model, dict, dim, name);
                await run(`INSERT OR REPLACE INTO ${id(`dim ${dim}`)} VALUES (${r.map((x, i) => (i === 1 ? lit(x) : x)).join(', ')})`);
            }
            await upsert(cells, { transaction: false });
            await run('COMMIT');
            // New or moved members change the dimension lookups, so everything is built again.
            await rebuild(members.length ? null : new Set([...variables.map((v) => v.name), ...cells.map((c) => c.variable)]));
        },
    };
    return adapter;
}
