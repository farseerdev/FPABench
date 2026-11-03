// What the PostgreSQL tests share, in plain PostgreSQL: the server, connecting to it, putting its data back
// to the snapshot, loading CSVs, and member ids. The SQL comes from the files in sql/.
//
// One server runs on the same machine, with its own data folder in the work folder, and the tests talk to it
// over TCP with node-postgres. The input tables are ordinary tables. The calculated tables are UNLOGGED
// tables, and a start builds them again from the inputs.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// The server's programs: POSTGRES_BIN, else the folder the PostgreSQL 18 packages install them in, else the PATH.
const BIN_DIR = process.env.POSTGRES_BIN ?? ['/usr/lib/postgresql/18/bin', '/opt/homebrew/opt/postgresql@18/bin', '/usr/local/opt/postgresql@18/bin'].find((d) => fs.existsSync(path.join(d, 'postgres'))) ?? '';
const bin = (name) => (BIN_DIR ? path.join(BIN_DIR, name) : name);
const PORT = Number(process.env.FPABENCH_POSTGRES_PORT ?? 15432);

// Only where the server listens is set, on its command line. Every other setting is the default that initdb
// writes, so writes are durable: fsync = on and synchronous_commit = on.
const LISTEN = ['-c', `port=${PORT}`, '-c', 'listen_addresses=127.0.0.1', '-c', 'unix_socket_directories='];

/** What goes in the results about the system. */
export const system = {
    name: 'PostgreSQL',
    version: execFileSync(bin('postgres'), ['--version'], { encoding: 'utf8' }).match(/(\d+\.\d+)/)?.[1] ?? 'unknown',
    settings: {
        approach: 'one table per calculated variable, the tables a change reaches rebuilt after it',
        server: 'single server on the same machine, TCP',
        nonDefault: 'none. initdb with UTF8 and the C locale.',
        inputs: 'tables, durable',
        calculated: 'UNLOGGED tables, rebuilt on start',
        durable: true,
        keys: 'integer member ids',
        threads: 'default',
    },
};

/** One of PostgreSQL's SQL files in sql/, generated from the model by model/lib/sql/generate.mjs. */
export const sqlFile = (name) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', name), 'utf8');

/** Every SQL file of a folder in sql/, by its name without .sql, such as the import files by input variable. */
export const sqlFolder = (folder) => new Map(fs.readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', folder)).map((f) => [f.slice(0, -'.sql'.length), sqlFile(`${folder}/${f}`)]));

// Every calculated table, built on each start. Read once when the file loads, so no file read is timed.
const CALCULATE = sqlFile('calculate.sql');

/** The server's data folder in a work folder, and the snapshot of it L1 leaves next to it. */
export const dataOf = (work) => path.join(work, 'postgres');
export const snapshotOf = (work) => path.join(work, 'postgres.snapshot');

/** Makes an empty data folder with initdb: UTF8, the C locale, and the default settings. */
export function init(work) {
    fs.rmSync(dataOf(work), { recursive: true, force: true });
    execFileSync(bin('initdb'), ['-D', dataOf(work), '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-locale', '--no-instructions'], { stdio: 'ignore' });
}

/** Starts the server on the work folder's data as it is. Returns { run, rows, close }. A run may hold several statements. */
export async function connect(work) {
    const config = { host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres' };
    // A server left running from before would answer below, with its own data. So none may answer yet.
    const old = new pg.Client(config);
    const running = await old.connect().then(() => true, () => false);
    await old.end().catch(() => {});
    if (running) throw new Error(`a PostgreSQL server already answers on port ${PORT}. Stop it first.`);
    const log = path.join(work, 'postgres.log');
    const server = spawn(bin('postgres'), ['-D', dataOf(work), ...LISTEN], { stdio: ['ignore', 'ignore', fs.openSync(log, 'a')] });
    let client;
    for (let i = 0; ; i++) {
        client = new pg.Client(config);
        try {
            await client.connect();
            break;
        } catch {
            // not up yet
            await client.end().catch(() => {});
        }
        if (server.exitCode !== null) throw new Error(`postgres exited with ${server.exitCode}, see ${log}`);
        if (i > 6000) {
            server.kill('SIGINT');
            throw new Error('postgres did not start in 60 s');
        }
        await new Promise((r) => setTimeout(r, 10));
    }
    return {
        // Several statements in one call run as one transaction, unless they hold their own BEGIN and COMMIT.
        run: (sql) => client.query(sql),
        rows: async (sql) => (await client.query(sql)).rows,
        // Stops the server with a fast shutdown and waits until it has exited. One that does not stop in 60 s is killed.
        async close() {
            await client.end().catch(() => {});
            if (server.exitCode !== null || server.signalCode !== null) return;
            const exited = new Promise((r) => server.once('exit', r));
            server.kill('SIGINT');
            const timer = setTimeout(() => server.kill('SIGKILL'), 60_000);
            await exited;
            clearTimeout(timer);
        },
    };
}

/** The column names in the header line of a CSV file. */
function header(file) {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const line = buf.toString('utf8', 0, n).split(/\r?\n/)[0];
    const cols = [];
    for (let i = 0; i < line.length; ) {
        let col = '';
        if (line[i] === '"') {
            for (i++; i < line.length; i++) {
                if (line[i] === '"' && line[i + 1] === '"') col += line[i++];
                else if (line[i] === '"') break;
                else col += line[i];
            }
            i++;
        } else while (i < line.length && line[i] !== ',') col += line[i++];
        cols.push(col);
        i++;
    }
    return cols;
}

/**
 * Runs load SQL that reads CSVs. Each statement after a line "-- @csv <file>" reads the temporary table "csv",
 * which first gets that file of the folder `dir`, every column as text, with COPY on the server.
 */
export async function load(db, sql, dir) {
    const id = (s) => `"${s.replace(/"/g, '""')}"`;
    for (const part of sql.split(/^-- @csv /m).slice(1)) {
        const nl = part.indexOf('\n');
        const file = path.join(dir, part.slice(0, nl).trim());
        await db.run(
            `DROP TABLE IF EXISTS csv; CREATE TEMP TABLE csv (${header(file).map((c) => `${id(c)} TEXT`).join(', ')});\n` +
                `COPY csv FROM '${file.replace(/'/g, "''")}' WITH (FORMAT csv, HEADER MATCH);\n${part.slice(nl + 1)}`
        );
    }
    await db.run('DROP TABLE IF EXISTS csv');
}

/** Puts the server's data back to the snapshot, without starting it. */
export function reset(work) {
    fs.rmSync(dataOf(work), { recursive: true, force: true });
    fs.cpSync(snapshotOf(work), dataOf(work), { recursive: true });
    // The server only starts on a data folder that only its owner can read.
    fs.chmodSync(dataOf(work), 0o700);
}

/** Starts the server and builds every calculated table. */
export async function start(work) {
    const db = await connect(work);
    try {
        await db.run(CALCULATE);
    } catch (e) {
        await db.close();
        throw e;
    }
    return db;
}

/** Puts the server's data back to the snapshot and starts it. */
export async function restore(work) {
    reset(work);
    return start(work);
}

/** Every member's id, from the dimension tables: id(dim, name) and name(dim, id). */
export async function members(db) {
    const toId = new Map();
    const toName = new Map();
    const dims = (await db.rows(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'dim %'`)).map((r) => r.t.slice(4));
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

