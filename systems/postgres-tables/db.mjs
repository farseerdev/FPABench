// What the PostgreSQL tests share, in plain PostgreSQL: the server, connecting to it, putting its data back
// to the snapshot, loading CSVs, and member ids. The SQL comes from the files in sql/.
//
// One server runs on the same machine, with its own data folder in the work folder, and the tests talk to it
// over TCP with node-postgres. The input tables are ordinary tables. The calculated tables are UNLOGGED
// tables. A clean stop keeps them, and a start after crash recovery builds them again from the inputs.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// The server's programs: POSTGRES_BIN, else the folder the PostgreSQL 18 packages install them in, else the PATH.
// An empty POSTGRES_BIN counts as unset.
const BIN_DIR = process.env.POSTGRES_BIN || ['/usr/lib/postgresql/18/bin', '/opt/homebrew/opt/postgresql@18/bin', '/usr/local/opt/postgresql@18/bin'].find((d) => fs.existsSync(path.join(d, 'postgres'))) || '';
const bin = (name) => (BIN_DIR ? path.join(BIN_DIR, name) : name);
const PORT = Number(process.env.FPABENCH_POSTGRES_PORT ?? 15432);

// A postgres on the PATH can be any version, and the SQL needs PostgreSQL 16 or later.
const VERSION = execFileSync(bin('postgres'), ['--version'], { encoding: 'utf8' }).trim();
if (!(Number(VERSION.match(/PostgreSQL\) (\d+)/)?.[1]) >= 16)) {
    throw new Error(`${bin('postgres')} is "${VERSION}", and the SQL needs PostgreSQL 16 or later. Run install.sh, or set POSTGRES_BIN to the bin folder of PostgreSQL 18.`);
}

// Only where the server listens is set, on its command line. Every other setting is the default that initdb
// writes, so writes are durable: fsync = on and synchronous_commit = on.
const LISTEN = ['-c', `port=${PORT}`, '-c', 'listen_addresses=127.0.0.1', '-c', 'unix_socket_directories='];

// node-postgres sends PGOPTIONS from the environment with every connection, and with it settings the results
// would not list. A config cannot turn it off, so it is removed here. The config below pins what PGSSLMODE and
// PGCLIENTENCODING would set.
delete process.env.PGOPTIONS;

/** What goes in the results about the system. */
export const system = {
    name: 'PostgreSQL',
    version: VERSION.match(/(\d+\.\d+)/)?.[1] ?? 'unknown',
    settings: {
        approach: 'one table per calculated variable, the tables a change reaches rebuilt after it',
        server: 'single server on the same machine, TCP',
        nonDefault: 'none. initdb with UTF8 and the C locale.',
        inputs: 'tables, durable',
        calculated: 'UNLOGGED tables without autovacuum, kept over a clean restart, rebuilt after a crash',
        durable: true,
        keys: 'integer member ids',
        threads: 'default',
    },
};

/** One of PostgreSQL's SQL files in sql/, generated from the model by model/lib/sql/generate.mjs. */
export const sqlFile = (name) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', name), 'utf8');

/** Every SQL file of a folder in sql/, by its name without .sql, such as the import files by input variable. */
export const sqlFolder = (folder) => new Map(fs.readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', folder)).map((f) => [f.slice(0, -'.sql'.length), sqlFile(`${folder}/${f}`)]));

// Every calculated table, built on a start after crash recovery. Read once when the file loads, so no file read is timed.
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
    const config = { host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', ssl: false, client_encoding: 'UTF8' };
    // A server left running from before would answer below, with its own data. So nothing may listen on the port
    // yet. The probe gives up after 1 s, since a suspended process holds the port and never answers.
    const old = new pg.Client({ ...config, connectionTimeoutMillis: 1000 });
    const free = await old.connect().then(
        () => false,
        (e) => e.code === 'ECONNREFUSED'
    );
    await old.end().catch(() => {});
    if (!free) throw new Error(`something already listens on port ${PORT}, such as a PostgreSQL server from an earlier run. Stop it first.`);
    const log = path.join(work, 'postgres.log');
    // The server writes the log through its own copy of the file, so this one is closed at once.
    const out = fs.openSync(log, 'a');
    const server = spawn(bin('postgres'), ['-D', dataOf(work), ...LISTEN], { stdio: ['ignore', 'ignore', out] });
    fs.closeSync(out);
    const exited = new Promise((r) => server.once('exit', r));
    const ended = () => server.exitCode !== null || server.signalCode !== null;
    const how = () => (server.signalCode ? `was stopped by ${server.signalCode}` : `exited with ${server.exitCode}`);
    // Stops the server with a fast shutdown and waits until it has exited. One that has not stopped in 60 s gets an
    // immediate shutdown, which stops every server process at once, without a checkpoint. One that still runs at
    // 90 s, such as a suspended one, is killed. Returns why the stop was not clean, or null when it was.
    const stop = async () => {
        if (!ended()) {
            let slow = false;
            const quit = setTimeout(() => ((slow = true), server.kill('SIGQUIT')), 60_000);
            const kill = setTimeout(() => server.kill('SIGKILL'), 90_000);
            server.kill('SIGINT');
            await exited;
            clearTimeout(quit);
            clearTimeout(kill);
            if (slow) return 'did not stop in 60 s, so it was stopped without a checkpoint';
        }
        return server.exitCode === 0 ? null : how();
    };
    let client;
    for (let i = 0; ; i++) {
        client = new pg.Client(config);
        try {
            await client.connect();
            break;
        } catch (e) {
            await client.end().catch(() => {});
            // Not up yet: nothing listens yet, or the server is still starting or recovering (57P03). Any other
            // error is real, such as one from a setting in the environment.
            if (e.code !== 'ECONNREFUSED' && e.code !== '57P03') {
                await stop();
                throw e;
            }
        }
        if (ended()) throw new Error(`postgres ${how()} while it started, see ${log}`);
        if (i > 6000) {
            await stop();
            throw new Error('postgres did not start in 60 s');
        }
        await new Promise((r) => setTimeout(r, 10));
    }
    // A lost connection, such as a backend the OOM killer ends, fails the query that is running. node-postgres
    // also emits 'error' on the client, and with no listener that ends the whole runner. So the error is kept,
    // and every later query fails with it, which fails the test and lets its teardown stop the server.
    let lost = null;
    client.on('error', (e) => (lost = e));
    const query = (sql) => (lost ? Promise.reject(lost) : client.query(sql));
    return {
        // Several statements in one call run as one transaction, unless they hold their own BEGIN and COMMIT.
        run: (sql) => query(sql),
        rows: async (sql) => (await query(sql)).rows,
        // Stops the server and waits until it has exited. Throws when the stop was not a clean fast shutdown,
        // since the data folder then needs crash recovery, and L1 must not keep it as the snapshot.
        async close() {
            await client.end().catch(() => {});
            const why = await stop();
            if (why) throw new Error(`postgres ${why}, see ${log}`);
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

/**
 * Starts the server, and builds every calculated table if they are not all there. A clean stop keeps UNLOGGED
 * tables, so a start from the snapshot only checks them. Crash recovery empties every UNLOGGED table, and then
 * a start builds them all again.
 */
export async function start(work) {
    const db = await connect(work);
    try {
        if (!(await whole(db))) await db.run(CALCULATE);
    } catch (e) {
        // The first error is the one to report, so an error of the stop does not replace it.
        await db.close().catch(() => {});
        throw e;
    }
    return db;
}

// Whether the calculated tables are all there: calculate.sql ends with one row in the UNLOGGED table
// fpabench_calculated. The row is gone after crash recovery, and the table is missing in a data folder from
// before it.
async function whole(db) {
    const [{ found }] = await db.rows(`SELECT to_regclass('fpabench_calculated') IS NOT NULL AS found`);
    return found && (await db.rows('SELECT 1 FROM fpabench_calculated')).length > 0;
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

