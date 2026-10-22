// W2 Paste 1,000 volumes at once, on DuckDB.
//
// A planner pastes 1,000 volumes into the plan months of one country. All 1,000 rows go into the table of
// overrides in one statement, and every calculated table they reach is built again. Timed until the
// country's volume over the plan months can be read.

import { restore, members, rebuild } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const REBUILD = rebuild('Volume Override IN');

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m, pick: { cells, country, months } }) {
        const values = cells.map(({ at, value }) => `(${m.id('Customer', at.Customer)}, ${m.id('SKU', at.SKU)}, ${m.id('Versions', at.Versions)}, ${m.id('Years', at.Years)}, ${m.id('Months', at.Months)}, ${value})`);
        await db.run(`INSERT OR REPLACE INTO "Volume Override IN" ("Customer", "SKU", "Versions", "Years", "Months", v) VALUES ${values.join(', ')}`);
        await db.run(REBUILD);

        const [volume] = await db.rows(`
            SELECT sum(s.v) AS v FROM "Volume" s JOIN "flat Customer" f ON f."Customer" = s."Customer"
            WHERE f."Country" = ${m.id('Country', country)} AND s."Versions" = ${m.id('Versions', 'FC 6+6')} AND s."Years" = ${m.id('Years', 'Y2026')}
              AND s."Months" IN (${months.map((mo) => m.id('Months', mo)).join(', ')})`);
        return volume.v === null ? [] : [{ key: {}, value: volume.v }];
    },

    // The country's EBIT for the year, untimed.
    async check({ db, m, pick: { country } }) {
        const [ebit] = await db.rows(`
            SELECT sum(v) AS v FROM "EBIT OUT" WHERE "Country" = ${m.id('Country', country)} AND "Versions" = ${m.id('Versions', 'FC 6+6')} AND "Years" = ${m.id('Years', 'Y2026')}`);
        return { 'EBIT OUT': ebit.v === null ? [] : [{ key: {}, value: ebit.v }] };
    },

    teardown: ({ db }) => db.close(),
};
