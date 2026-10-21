// What the DuckDB tests share, in plain DuckDB: the database file, opening it, putting it back to the
// snapshot, and member ids. The SQL comes from the files in sql/.
//
// The input tables live in duckdb.db. The calculated tables are TEMP tables in memory, so opening the file
// builds them again from the inputs.

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
        approach: 'one table per calculated variable, the tables a change reaches rebuilt after it',
        inputs: 'duckdb.db, durable',
        calculated: 'TEMP tables in memory, rebuilt on start',
        keys: 'integer member ids',
        threads: 'default',
    },
};

/** One of DuckDB's SQL files in sql/, generated from the model by model/lib/sql/generate.mjs. */
export const sqlFile = (name) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', name), 'utf8');

/** Every SQL file of a folder in sql/, by its name without .sql, such as the import files by input variable. */
export const sqlFolder = (folder) => new Map(fs.readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', folder)).map((f) => [f.slice(0, -'.sql'.length), sqlFile(`${folder}/${f}`)]));

// Every calculated table, built on each start. Read once when the file loads, so no file read is timed.
const CALCULATE = sqlFile('calculate.sql');

/** The database file of a work folder, and the snapshot L1 leaves next to it. */
export const fileOf = (work) => path.join(work, 'duckdb.db');
export const snapshotOf = (work) => path.join(work, 'duckdb.snapshot.db');

/** Opens the database file as it is. Returns { run, rows, close }. A run may hold several statements. */
export async function connect(work) {
    const instance = await DuckDBInstance.create(fileOf(work));
    const conn = await instance.connect();
    return {
        run: (s) => conn.run(s),
        rows: async (s) => (await conn.runAndReadAll(s)).getRowObjectsJS(),
        close() {
            conn.closeSync();
            instance.closeSync?.();
        },
    };
}

/** Puts the database file back to the snapshot, without opening it. */
export function reset(work) {
    fs.rmSync(`${fileOf(work)}.wal`, { force: true });
    fs.copyFileSync(snapshotOf(work), fileOf(work));
}

/** Starts DuckDB on the database file and builds every calculated table. */
export async function start(work) {
    const db = await connect(work);
    try {
        await db.run(CALCULATE);
    } catch (e) {
        db.close();
        throw e;
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

/** The SQL a write to an input variable must run: every calculated table that reads it, directly or through other tables, in dependency order. */
export const rebuild = (variable) => sqlFile(`rebuild/${variable}.sql`);
