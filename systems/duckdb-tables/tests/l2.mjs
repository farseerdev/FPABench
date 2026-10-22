// L2 Monthly close, on DuckDB.
//
// Load the actuals of Y2026 M7 on top of the snapshot, then close M7 in the Actual version. Each input
// variable's file of the increment goes into its table with sql/import/<Variable>.sql, the two flags are
// written, and every calculated table is built again. Timed until EBIT of Actual Y2026 M7 can be
// read by country, and the file is on disk.

import fs from 'node:fs';
import path from 'node:path';
import { sqlFile, restore, members, sqlFolder } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const CALCULATE = sqlFile('calculate.sql');
const IMPORTS = sqlFolder('import');

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m, cells, pick }) {
        // The SQL reads the CSVs by paths relative to the folder of the increment's input cells.
        await db.run(`SET file_search_path = '${cells.close.replace(/'/g, "''")}'`);
        const loaded = fs.readdirSync(path.join(cells.close, 'cells')).map((f) => f.replace(/\.csv$/, ''));
        await db.run('BEGIN');
        for (const variable of loaded) await db.run(IMPORTS.get(variable));
        for (const { variable, at, value } of pick.flags) {
            await db.run(`INSERT OR REPLACE INTO "${variable}" ("Versions", "Years", "Months", v) VALUES (${m.id('Versions', at.Versions)}, ${m.id('Years', at.Years)}, ${m.id('Months', at.Months)}, ${value})`);
        }
        await db.run('COMMIT');
        // The increment reaches 165 of the 167 calculated tables, so all of them are built again.
        await db.run(CALCULATE);

        const rows = await db.rows(`
            SELECT c.name AS "Country", sum(s.v) AS v FROM "EBIT OUT" s JOIN "dim Country" c ON c."Country" = s."Country"
            WHERE s."Versions" = ${m.id('Versions', 'Actual')} AND s."Years" = ${m.id('Years', 'Y2026')} AND s."Months" = ${m.id('Months', 'M7')}
            GROUP BY c.name`);
        return rows.filter((r) => r.v !== null).map((r) => ({ key: { Country: r.Country }, value: r.v }));
    },

    // The import control totals of M7, by country, untimed.
    async check({ db, m }) {
        const rows = await db.rows(`
            SELECT c.name AS "Country", sum(s.v) AS v FROM "CHECK Import Total" s JOIN "dim Country" c ON c."Country" = s."Country"
            WHERE s."Years" = ${m.id('Years', 'Y2026')} AND s."Months" = ${m.id('Months', 'M7')} GROUP BY c.name`);
        return { 'CHECK Import Total by country': rows.filter((r) => r.v !== null).map((r) => ({ key: { Country: r.Country }, value: r.v })) };
    },

    teardown: ({ db }) => db.close(),
};
