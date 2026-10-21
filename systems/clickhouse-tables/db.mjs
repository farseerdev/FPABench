// What the ClickHouse tests share, in plain ClickHouse: the server, connecting to it, putting its data back
// to the snapshot, and member ids. The SQL comes from the files in sql/.
//
// One server runs on the same machine, and the tests talk to it over HTTP with @clickhouse/client. The input
// tables live in its data folder. The calculated tables are Memory tables, so a start builds them again from
// the inputs.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient, ClickHouseLogLevel } from '@clickhouse/client';

const BIN = process.env.CLICKHOUSE_BIN ?? 'clickhouse';
const PORT = Number(process.env.FPABENCH_CLICKHOUSE_PORT ?? 18123);

// Two settings are not defaults and are required: join_use_nulls = 1 and aggregate_functions_null_for_empty
// = 1. Without them an outer join fills the missing side with 0 and a sum over no rows gives 0, and
// "missing" silently turns into 0. mutations_sync = 2 makes an ALTER TABLE ... UPDATE wait until it is done.
// query_plan_optimize_join_order_limit = 0 keeps the join order the SQL is written in. At 100m ClickHouse
// 26.9 reordered one table's joins and the statement ran for more than 15 minutes instead of 0.04 s.
export const SETTINGS = { join_use_nulls: 1, aggregate_functions_null_for_empty: 1, mutations_sync: 2, query_plan_optimize_join_order_limit: 0 };

/** What goes in the results about the system. */
export const system = {
    name: 'ClickHouse',
    version: execFileSync(BIN, ['--version'], { encoding: 'utf8' }).match(/version ([\d.]+)/)?.[1] ?? 'unknown',
    settings: {
        approach: 'one table per calculated variable, the tables a change reaches rebuilt after it',
        server: 'single node on the same machine, HTTP',
        nonDefault: SETTINGS,
        tables: 'inputs ReplacingMergeTree read with FINAL, fsync_after_insert = 1, fsync_part_directory = 1. Calculated tables Memory, rebuilt on start.',
        durable: true,
        keys: 'integer member ids',
        threads: 'default',
    },
};

/** One of ClickHouse's SQL files in sql/, generated from the model by model/lib/sql/generate.mjs. */
export const sqlFile = (name) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', name), 'utf8');

/** Every SQL file of a folder in sql/, by its name without .sql, such as the import files by input variable. */
export const sqlFolder = (folder) => new Map(fs.readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql', folder)).map((f) => [f.slice(0, -'.sql'.length), sqlFile(`${folder}/${f}`)]));

// Every calculated table, built on each start. Read once when the file loads, so no file read is timed.
const CALCULATE = sqlFile('calculate.sql');

/** The server's folder in a work folder, its data, and the snapshot of the data L1 leaves next to it. */
export const rootOf = (work) => path.join(work, 'clickhouse');
export const dataOf = (work) => path.join(rootOf(work), 'data');
export const snapshotOf = (work) => path.join(work, 'clickhouse.snapshot');

function config(root) {
    return `<clickhouse>
    <logger><level>warning</level><log>${root}/log/server.log</log><errorlog>${root}/log/error.log</errorlog><console>0</console></logger>
    <http_port>${PORT}</http_port>
    <tcp_port>${PORT + 1}</tcp_port>
    <listen_host>127.0.0.1</listen_host>
    <path>${root}/data/</path>
    <tmp_path>${root}/tmp/</tmp_path>
    <user_files_path>${root}/files/</user_files_path>
    <users><default><password></password><networks><ip>127.0.0.1</ip><ip>::1</ip></networks><profile>default</profile><quota>default</quota></default></users>
    <profiles><default></default></profiles>
    <quotas><default></default></quotas>
</clickhouse>
`;
}

/** The statements of a SQL file, one by one. ClickHouse takes one statement per request. */
const statements = (sql) =>
    sql
        .split(/;\s*\n/)
        .map((s) => s.replace(/^(--[^\n]*\n|\s*\n)+/, '').trim())
        .filter((s) => s && !s.startsWith('--'));

/** Starts the server on the work folder's data as it is. Returns { run, rows, close }. A run may hold several statements. */
export async function connect(work) {
    const root = rootOf(work);
    for (const dir of ['log', 'tmp', 'files']) fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, 'config.xml'), config(root));
    // A server left running from before would answer the pings below, with its own data. So none may answer yet.
    const old = createClient({ url: `http://127.0.0.1:${PORT}`, request_timeout: 1000, log: { level: ClickHouseLogLevel.OFF } });
    const running = await old.ping().then((r) => r.success, () => false);
    await old.close();
    if (running) throw new Error(`a ClickHouse server already answers on port ${PORT}. Stop it first.`);
    const server = spawn(BIN, ['server', `--config-file=${path.join(root, 'config.xml')}`], { stdio: 'ignore' });
    // The client logs every failed ping while the server starts. Those are expected, so its log is off.
    const client = createClient({ url: `http://127.0.0.1:${PORT}`, request_timeout: 3600_000, log: { level: ClickHouseLogLevel.OFF } });
    for (let i = 0; ; i++) {
        try {
            if ((await client.ping()).success) break;
        } catch {
            // not up yet
        }
        if (server.exitCode !== null) throw new Error(`clickhouse server exited with ${server.exitCode}, see ${root}/log/error.log`);
        if (i > 6000) {
            server.kill('SIGTERM');
            throw new Error('clickhouse server did not start in 60 s');
        }
        await new Promise((r) => setTimeout(r, 10));
    }
    return {
        async run(sql) {
            for (const query of statements(sql)) await client.command({ query, clickhouse_settings: SETTINGS });
        },
        rows: async (query) => (await client.query({ query, format: 'JSONEachRow', clickhouse_settings: SETTINGS })).json(),
        // Stops the server and waits until it has exited. A server that has already exited, such as after a
        // crash, has nothing to wait for. One that does not stop in 60 s is killed.
        async close() {
            await client.close();
            if (server.exitCode !== null || server.signalCode !== null) return;
            const exited = new Promise((r) => server.once('exit', r));
            server.kill('SIGTERM');
            const timer = setTimeout(() => server.kill('SIGKILL'), 60_000);
            await exited;
            clearTimeout(timer);
        },
    };
}

/**
 * Points the server's user_files_path at a folder of input cells, so the SQL reads cells/<Variable>.csv and
 * dimensions/<Dimension>.csv by paths relative to it.
 */
export function useCells(work, cellsDir) {
    for (const name of ['cells', 'dimensions']) {
        const link = path.join(rootOf(work), 'files', name);
        fs.rmSync(link, { force: true });
        fs.symlinkSync(path.join(cellsDir, name), link);
    }
}

/** Puts the server's data back to the snapshot, without starting it. */
export function reset(work) {
    fs.rmSync(dataOf(work), { recursive: true, force: true });
    fs.cpSync(snapshotOf(work), dataOf(work), { recursive: true });
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
    const dims = (await db.rows(`SELECT name AS t FROM system.tables WHERE database = currentDatabase() AND name LIKE 'dim %'`)).map((r) => r.t.slice(4));
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

/**
 * The version of a row written now. The input tables are ReplacingMergeTree, so the row with the highest
 * version of a key is the one that counts. The SQL import uses the same clock: microseconds since 1970.
 */
export const now = 'toUnixTimestamp64Micro(now64(6))';
