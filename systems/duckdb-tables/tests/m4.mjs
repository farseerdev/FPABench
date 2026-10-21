// M4 Allocate one more cost, on DuckDB.
//
// The modeller adds a cost pool from the marketing staff's OPEX, allocates it to customers and brands, and
// subtracts it in contribution margin III. sql/m4.sql is the migration: the new and changed tables and every
// table that reads one of them. Timed until contribution margin III can be read by country.

import { restore, members, sqlFile } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const MIGRATION = sqlFile('m4.sql');

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m }) {
        await db.run(MIGRATION);

        const rows = await db.rows(`
            SELECT "Country" AS c, sum(v) AS v FROM "Contribution Margin III by Country"
            WHERE "Versions" = ${m.id('Versions', 'FC 6+6')} AND "Years" = ${m.id('Years', 'Y2026')} GROUP BY "Country"`);
        return rows.filter((r) => r.v !== null).map((r) => ({ key: { Country: m.name('Country', r.c) }, value: r.v }));
    },

    // Untimed: the new cost and the overheads by country, the OPEX check, and EBIT, which must not move.
    async check({ db, m }) {
        const fc = `"Versions" = ${m.id('Versions', 'FC 6+6')} AND "Years" = ${m.id('Years', 'Y2026')}`;
        const cost = await db.rows(`SELECT f."Country" AS c, sum(s.v) AS v FROM "Marketing Staff Cost" s JOIN "flat Customer" f ON f."Customer" = s."Customer" WHERE ${fc} GROUP BY f."Country"`);
        const overheads = await db.rows(`SELECT "Country" AS c, sum(v) AS v FROM "Overheads" WHERE ${fc} GROUP BY "Country"`);
        const check = await db.rows(`SELECT "Country" AS c, "Versions" AS ver, "Years" AS y, "Months" AS mo, sum(v) AS v FROM "CHECK OPEX in EBIT" GROUP BY ALL`);
        const ebit = await db.rows(`SELECT "Country" AS c, "Versions" AS ver, "Years" AS y, "Months" AS mo, sum(v) AS v FROM "EBIT OUT" GROUP BY ALL`);
        const byCountry = (rows) => rows.filter((r) => r.v !== null).map((r) => ({ key: { Country: m.name('Country', r.c) }, value: r.v }));
        const all4 = (rows) =>
            rows.filter((r) => r.v !== null).map((r) => ({ key: { Country: m.name('Country', r.c), Versions: m.name('Versions', r.ver), Years: m.name('Years', r.y), Months: m.name('Months', r.mo) }, value: r.v }));
        return {
            'Marketing Staff Cost by country': byCountry(cost),
            'Overheads by country': byCountry(overheads),
            'CHECK OPEX in EBIT': all4(check),
            'EBIT OUT by country and month': all4(ebit),
        };
    },

    teardown: ({ db }) => db.close(),
};
