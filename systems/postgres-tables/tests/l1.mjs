// L1 Initial load, on PostgreSQL.
//
// Load the whole model and every input cell into an empty server. Timed until EBIT in euros can be read for
// every country, version, year and month, and the data is on disk. The data folder after the last load is
// the snapshot every other test starts from.

import fs from 'node:fs';
import path from 'node:path';
import { sqlFile, connect, init, load, dataOf, snapshotOf, sqlFolder } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const SCHEMA = sqlFile('schema.sql');
const MEMBERS = sqlFile('members.sql');
const DIMENSIONS = sqlFile('dimensions.sql');
const CALCULATE = sqlFile('calculate.sql');
// Every table is empty, so each input variable's file goes in with load/<Variable>.sql, a plain INSERT.
const LOADS = sqlFolder('load');

export default {
    // No data yet: the load starts from an empty data folder, made by initdb.
    async setup({ work }) {
        init(work);
    },

    async run(context) {
        const { work, cells } = context;

        // 1. Start the server.
        const db = await connect(work);
        context.db = db;

        // 2. Create the model: the tables, and the members the model itself brings.
        await db.run(SCHEMA);
        await db.run(MEMBERS);

        // 3. Import the CSVs: the data's own members of each dimension, then each input variable's cells. The
        // SQL names each CSV by its path in the folder of input cells.
        await load(db, DIMENSIONS, cells.base);
        await db.run('BEGIN');
        for (const file of fs.readdirSync(path.join(cells.base, 'cells'))) await load(db, LOADS.get(file.replace(/\.csv$/, '')), cells.base);
        await db.run('COMMIT');
        // Every calculated table, in dependency order, and the data to disk.
        await db.run(CALCULATE);
        await db.run('CHECKPOINT');

        // 4. Read EBIT in euros for every country, version, year and month.
        const rows = await db.rows(`
            SELECT c.name AS "Country", v.name AS "Versions", y.name AS "Years", m.name AS "Months", sum(s.v) AS v
            FROM "EBIT EUR OUT" s
            JOIN "dim Country" c ON c."Country" = s."Country" JOIN "dim Versions" v ON v."Versions" = s."Versions"
            JOIN "dim Years" y ON y."Years" = s."Years" JOIN "dim Months" m ON m."Months" = s."Months"
            GROUP BY 1, 2, 3, 4`);

        // 5. Return it.
        return rows.filter((r) => r.v !== null).map((r) => ({ key: { Country: r.Country, Versions: r.Versions, Years: r.Years, Months: r.Months }, value: r.v }));
    },

    // The invariants of the loaded model, untimed. Every row they return must be 0.
    async check({ db }) {
        const zero = {};
        // Every CHECK variable is 0 everywhere.
        const tables = (await db.rows(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'CHECK %'`)).map((r) => r.t);
        for (const name of tables) {
            zero[name] = await db.rows(`SELECT coalesce(sum(abs(v)), 0) AS v FROM "${name}"`);
        }
        // The P&L adds up to EBIT, per country, version, year and month.
        zero['PL OUT - EBIT OUT'] = await db.rows(`
            SELECT coalesce(p.v, 0) - coalesce(e.v, 0) AS v
            FROM (SELECT "Country", "Versions", "Years", "Months", sum(v) AS v FROM "PL OUT" GROUP BY 1, 2, 3, 4) p
            FULL JOIN (SELECT "Country", "Versions", "Years", "Months", sum(v) AS v FROM "EBIT OUT" GROUP BY 1, 2, 3, 4) e USING ("Country", "Versions", "Years", "Months")`);
        // Every allocation pool is spread in full: pool = allocated cost + unallocated, per country, version and year.
        const country = {
            Customer: 'JOIN "flat Customer" f ON f."Customer" = s."Customer"',
            'Customer Group': 'JOIN "flat Customer Group" f ON f."Customer Group" = s."Customer Group"',
            Country: 'JOIN "dim Country" f ON f."Country" = s."Country"',
        };
        const byCountry = (table, via) => `SELECT f."Country", s."Versions", s."Years", sum(s.v) AS v FROM "${table}" s ${country[via]} GROUP BY 1, 2, 3`;
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
                FROM (SELECT f."Country", s."Versions", s."Years", s."Months", sum(s.v) AS v FROM "${merged}" s JOIN "flat Customer" f ON f."Customer" = s."Customer" GROUP BY 1, 2, 3, 4) m
                JOIN "FC Actual" fa ON fa."Versions" = m."Versions" AND fa."Years" = m."Years" AND fa."Months" = m."Months" AND fa.v = 1
                LEFT JOIN (SELECT f."Country", s."Years", s."Months", sum(s.v) AS v FROM "${actual}" s JOIN "flat Customer" f ON f."Customer" = s."Customer" GROUP BY 1, 2, 3) a
                  ON a."Country" = m."Country" AND a."Years" = m."Years" AND a."Months" = m."Months"`);
        }
        // As rows with a key each, so the runner compares every row with 0.
        return Object.fromEntries(Object.entries(zero).map(([name, rows]) => [name, rows.map((r, k) => ({ key: { row: k }, value: r.v }))]));
    },

    // The data folder after the last load, with the server stopped, is the snapshot. A clean stop keeps the
    // UNLOGGED calculated tables, so a start from the snapshot does not build them again.
    async teardown({ db, work, failed }) {
        await db?.close();
        if (failed) return;
        fs.rmSync(snapshotOf(work), { recursive: true, force: true });
        fs.cpSync(dataOf(work), snapshotOf(work), { recursive: true });
    },
};
