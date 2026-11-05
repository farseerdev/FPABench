// What the DuckDB tests share, in plain DuckDB: the database file, opening it, putting it back to the
// snapshot, and member ids. The SQL comes from the files in sql/.
//
// The input tables and the calculated tables are all ordinary tables in duckdb.db. DuckDB has no incremental
// calculation: a write or a model change that touches calculated data builds every calculated table again.
// One recalculation is about 167 statements, and inside one transaction together with the write it is very
// slow, so it runs outside any transaction, one commit per table. A one-row table, calc_state, says whether the
// calculated tables are current. A write commits its input change and calculated = false together, builds the
// tables, then commits calculated = true. A reader opens the file only after the write has returned, so it
// never reads a half-built state as valid. A start that finds calculated = false, because the process died in
// a recalculation, builds the calculated tables again before the first read.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DuckDBInstance } from '@duckdb/node-api';

/** What goes in the results about the system. */
export const system = {
    name: 'DuckDB',
    version: JSON.parse(fs.readFileSync(path.join(path.dirname(createRequire(import.meta.url).resolve('@duckdb/node-api')), '..', 'package.json'), 'utf8')).version,
    settings: {
        approach: 'one table per calculated variable, every table calculated again after a change',
        inputs: 'duckdb.db, durable',
        calculated: 'tables in duckdb.db, durable, all calculated again after a change; a marker row says whether they are current, and a start that finds them stale calculates them again',
        durable: true,
        keys: 'integer member ids',
        threads: 'default',
    },
};

/** One of DuckDB's SQL files in sql/, generated from the model by model/lib/sql/generate.mjs. */
export const sqlFile = (name) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', name), 'utf8');

/** Every SQL file of a folder in sql/, by its name without .sql, such as the import files by input variable. */
export const sqlFolder = (folder) => new Map(fs.readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', folder)).map((f) => [f.slice(0, -'.sql'.length), sqlFile(`${folder}/${f}`)]));

/**
 * The statements that build every calculated table, by name: calculate.sql, and what a migration runs after its
 * new input tables. Read once when the file loads, so no file read is timed.
 */
const RECALCULATE_FROM = '-- @recalculate';
const afterSchema = (text) => text.slice(text.indexOf(RECALCULATE_FROM));
const beforeSchema = (text) => text.slice(0, text.indexOf(RECALCULATE_FROM));
const MIGRATIONS = { m1: sqlFile('m1.sql'), m4: sqlFile('m4.sql') };
const RECALCULATE = { calculate: sqlFile('calculate.sql'), m1: afterSchema(MIGRATIONS.m1), m4: afterSchema(MIGRATIONS.m4) };

/** The database file of a work folder, and the snapshot L1 leaves next to it. */
export const fileOf = (work) => path.join(work, 'duckdb.db');
export const snapshotOf = (work) => path.join(work, 'duckdb.snapshot.db');

/**
 * Opens the database file as it is. Returns { run, rows, write, migrate, close }. A run may hold several statements.
 * The state table is not read here: start does that.
 */
export async function connect(work) {
    const instance = await DuckDBInstance.create(fileOf(work));
    const conn = await instance.connect();
    const db = {
        run: (s) => conn.run(s),
        rows: async (s) => (await conn.runAndReadAll(s)).getRowObjectsJS(),
        /**
         * A change of inputs and the recalculation it needs. The input change commits together with calculated = false.
         * The calculated tables are then built outside any transaction, and calculated = true is committed after them.
         */
        async write(inputs, script = 'calculate') {
            await conn.run('BEGIN');
            try {
                await inputs();
                await conn.run(`UPDATE calc_state SET calculated = false, script = '${script}'`);
            } catch (error) {
                await conn.run('ROLLBACK');
                throw error;
            }
            await conn.run('COMMIT');
            await recalculate(db);
        },
        /** A model change: its new input tables are the input change, and its recalculation builds the calculated tables for the changed model. */
        migrate(name) {
            return db.write(() => conn.run(beforeSchema(MIGRATIONS[name])), name);
        },
        close() {
            conn.closeSync();
            instance.closeSync?.();
        },
    };
    return db;
}

/** Builds the calculated tables the marker names, then commits calculated = true. */
async function recalculate(db) {
    const [state] = await db.rows('SELECT script FROM calc_state');
    await db.run(RECALCULATE[state.script]);
    await db.run('UPDATE calc_state SET calculated = true');
}

/** Creates the marker. A load leaves it false until the calculated tables are built. */
export const createState = (db) => db.run(`CREATE TABLE calc_state (calculated BOOLEAN NOT NULL, script VARCHAR NOT NULL); INSERT INTO calc_state VALUES (false, 'calculate')`);

/** Builds every calculated table of a load and commits calculated = true after them. */
export const calculate = (db) => recalculate(db);

/** Puts the database file back to the snapshot, without opening it. */
export function reset(work) {
    fs.rmSync(`${fileOf(work)}.wal`, { force: true });
    fs.copyFileSync(snapshotOf(work), fileOf(work));
}

/**
 * Starts DuckDB on the database file. The calculated tables are in it already, unless the process died in a
 * recalculation: then calculated is false, and they are built again before the first read. After a crash the
 * first start pays one full recalculation.
 */
export async function start(work) {
    const db = await connect(work);
    const [state] = await db.rows('SELECT calculated FROM calc_state');
    if (!state.calculated) {
        console.error('duckdb-tables: the last recalculation did not finish, calculating every table again');
        await recalculate(db);
    }
    return db;
}

/** Puts the database file back to the snapshot and opens it. */
export async function restore(work) {
    reset(work);
    return start(work);
}

/** Every member's id, from the dimension tables: id(dim, name) and name(dim, id). */
export async function members(db) {
    const toId = new Map();
    const toName = new Map();
    const dims = (await db.rows(`SELECT table_name AS t FROM duckdb_tables() WHERE table_name LIKE 'dim %'`)).map((r) => r.t.slice(4));
    for (const d of dims) {
        const list = await db.rows(`SELECT "${d}" AS id, name FROM "dim ${d}"`);
        toId.set(d, new Map(list.map((r) => [r.name, r.id])));
        toName.set(d, new Map(list.map((r) => [r.id, r.name])));
    }
    return {
        id: (d, name) => {
            const v = toId.get(d)?.get(name);
            if (v === undefined) throw new Error(`no member ${name} in ${d}`);
            return v;
        },
        name: (d, id) => toName.get(d)?.get(id) ?? null,
    };
}
