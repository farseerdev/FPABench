// L1 Initial load, on DuckDB.
//
// Load the whole model and every input cell into an empty database file. Timed until EBIT in euros can be
// read for every country, version, year and month, and the file is on disk. The file after the last load
// is the snapshot every other test starts from.

import fs from 'node:fs';
import path from 'node:path';
import { sqlFile, connect, fileOf, snapshotOf, sqlFolder } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const SCHEMA = sqlFile('schema.sql');
const MEMBERS = sqlFile('members.sql');
const DIMENSIONS = sqlFile('dimensions.sql');
const CALCULATE = sqlFile('calculate.sql');
const IMPORTS = sqlFolder('import');

export default {
    // No database yet: the load starts from an empty file.
    async setup({ work }) {
        fs.rmSync(fileOf(work), { force: true });
        fs.rmSync(`${fileOf(work)}.wal`, { force: true });
    },

    async run(context) {
        const { work, cells } = context;

        // 1. Create the database. The SQL reads the CSVs by paths relative to the folder of input cells.
        const db = await connect(work);
        context.db = db;
        await db.run(`SET file_search_path = '${cells.base.replace(/'/g, "''")}'`);

        // 2. Create the model: the tables, and the members the model itself brings.
        await db.run(SCHEMA);
        await db.run(MEMBERS);

        // 3. Import the CSVs: the data's own members of each dimension, then each input variable's cells.
        await db.run(DIMENSIONS);
        await db.run('BEGIN');
        for (const file of fs.readdirSync(path.join(cells.base, 'cells'))) await db.run(IMPORTS.get(file.replace(/\.csv$/, '')));
        await db.run('COMMIT');
        // Every calculated table, in dependency order, and the file to disk.
        await db.run(CALCULATE);
        await db.run('CHECKPOINT');

        // 4. Read EBIT in euros for every country, version, year and month.
        const rows = await db.rows(`
            SELECT c.name AS "Country", v.name AS "Versions", y.name AS "Years", m.name AS "Months", sum(s.v) AS v
            FROM "EBIT EUR OUT" s
            JOIN "dim Country" c ON c."Country" = s."Country" JOIN "dim Versions" v ON v."Versions" = s."Versions"
            JOIN "dim Years" y ON y."Years" = s."Years" JOIN "dim Months" m ON m."Months" = s."Months"
            GROUP BY ALL`);

        // 5. Return it.
        return rows.filter((r) => r.v !== null).map((r) => ({ key: { Country: r.Country, Versions: r.Versions, Years: r.Years, Months: r.Months }, value: r.v }));
    },

    // The invariants of the loaded model, untimed. Every row they return must be 0.
    async check({ db }) {
        const zero = {};
        // Every CHECK variable is 0 everywhere.
        const tables = (await db.rows(`SELECT table_name AS t FROM duckdb_tables() WHERE table_name LIKE 'CHECK %'`)).map((r) => r.t);
        for (const name of tables) {
            zero[name] = await db.rows(`SELECT coalesce(sum(abs(v)), 0) AS v FROM "${name}"`);
        }
        // The P&L adds up to EBIT, per country, version, year and month.
        zero['PL OUT - EBIT OUT'] = await db.rows(`
            SELECT coalesce(p.v, 0) - coalesce(e.v, 0) AS v
            FROM (SELECT "Country", "Versions", "Years", "Months", sum(v) AS v FROM "PL OUT" GROUP BY ALL) p
            FULL JOIN (SELECT "Country", "Versions", "Years", "Months", sum(v) AS v FROM "EBIT OUT" GROUP BY ALL) e USING ("Country", "Versions", "Years", "Months")`);
        // Every allocation pool is spread in full: pool = allocated cost + unallocated, per country, version and year.
        const country = {
            Customer: 'JOIN "flat Customer" f ON f."Customer" = s."Customer"',
            'Customer Group': 'JOIN "flat Customer Group" f ON f."Customer Group" = s."Customer Group"',
            Country: 'JOIN "dim Country" f ON f."Country" = s."Country"',
        };
        const byCountry = (table, via) => `SELECT f."Country", s."Versions", s."Years", sum(s.v) AS v FROM "${table}" s ${country[via]} GROUP BY ALL`;
        for (const [pool, poolVia, cost, rest, restVia] of [
            ['Trade Fees Pool', 'Customer Group', 'Trade Fees', 'Trade Fees Unallocated', 'Customer Group'],
            ['Logistics Pool', 'Country', 'Logistics Cost', 'Logistics Unallocated', 'Country'],
            ['Sales Force Pool', 'Country', 'Sales Force Cost', 'Sales Force Unallocated', 'Country'],
            ['Marketing Pool', 'Country', 'Marketing Cost', 'Marketing Unallocated', 'Country'],
        ]) {
            zero[`${pool} - ${cost} - ${rest}`] = await db.rows(`
                SELECT coalesce(p.v, 0) - coalesce(c.v, 0) - coalesce(u.v, 0) AS v
                FROM (${byCountry(pool, poolVia)}) p
                FULL JOIN (${byCountry(cost, 'Customer')}) c USING ("Country", "Versions", "Years")
                FULL JOIN (${byCountry(rest, restVia)}) u USING ("Country", "Versions", "Years")`);
        }
        // Closed months hold the actuals: Volume, Gross Sales and COGS equal their ACT, where FC Actual is 1.
        for (const [merged, actual] of [
            ['Volume', 'Volume ACT'],
            ['Gross Sales', 'Gross Sales ACT'],
            ['COGS', 'COGS ACT'],
        ]) {
            zero[`${merged} - ${actual}`] = await db.rows(`
                SELECT m.v - coalesce(a.v, 0) AS v
                FROM (SELECT f."Country", s."Versions", s."Years", s."Months", sum(s.v) AS v FROM "${merged}" s JOIN "flat Customer" f ON f."Customer" = s."Customer" GROUP BY ALL) m
                JOIN "FC Actual" fa ON fa."Versions" = m."Versions" AND fa."Years" = m."Years" AND fa."Months" = m."Months" AND fa.v = 1
                LEFT JOIN (SELECT f."Country", s."Years", s."Months", sum(s.v) AS v FROM "${actual}" s JOIN "flat Customer" f ON f."Customer" = s."Customer" GROUP BY ALL) a
                  ON a."Country" = m."Country" AND a."Years" = m."Years" AND a."Months" = m."Months"`);
        }
        // As rows with a key each, so the runner compares every row with 0.
        return Object.fromEntries(Object.entries(zero).map(([name, rows]) => [name, rows.map((r, k) => ({ key: { row: k }, value: r.v }))]));
    },

    // The file after the last load is the snapshot.
    async teardown({ db, work, failed }) {
        db?.close();
        if (failed) return;
        fs.copyFileSync(fileOf(work), snapshotOf(work));
    },
};
