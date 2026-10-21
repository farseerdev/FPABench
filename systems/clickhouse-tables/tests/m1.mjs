// M1 Change a formula, on ClickHouse.
//
// The modeller changes the formula of Handling KG. sql/m1.sql is the migration: the changed table and every
// table that reads it, built again. Timed until logistics cost can be read by brand and country.

import { restore, members, sqlFile } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const MIGRATION = sqlFile('m1.sql');

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m }) {
        await db.run(MIGRATION);

        const rows = await db.rows(`
            SELECT s."Brand" AS b, f."Country" AS c, sum(s.v) AS total FROM "Logistics Cost" s JOIN "flat Customer" f ON f."Customer" = s."Customer"
            WHERE s."Versions" = ${m.id('Versions', 'FC 6+6')} AND s."Years" = ${m.id('Years', 'Y2026')}
            GROUP BY s."Brand", f."Country"`);
        return rows.filter((r) => r.total !== null).map((r) => ({ key: { Brand: m.name('Brand', r.b), Country: m.name('Country', r.c) }, value: r.total }));
    },

    // Untimed: the change moves logistics cost between brands, so its total by country and EBIT do not move.
    async check({ db, m }) {
        const cost = await db.rows(`
            SELECT f."Country" AS c, s."Versions" AS ver, s."Years" AS y, s."Months" AS mo, sum(s.v) AS total
            FROM "Logistics Cost" s JOIN "flat Customer" f ON f."Customer" = s."Customer" GROUP BY ALL`);
        const ebit = await db.rows(`SELECT "Country" AS c, "Versions" AS ver, "Years" AS y, "Months" AS mo, sum(v) AS total FROM "EBIT OUT" GROUP BY ALL`);
        const key = (r) => ({ Country: m.name('Country', r.c), Versions: m.name('Versions', r.ver), Years: m.name('Years', r.y), Months: m.name('Months', r.mo) });
        return {
            'Logistics Cost by country and month': cost.filter((r) => r.total !== null).map((r) => ({ key: key(r), value: r.total })),
            'EBIT OUT by country and month': ebit.filter((r) => r.total !== null).map((r) => ({ key: key(r), value: r.total })),
        };
    },

    teardown: ({ db }) => db.close(),
};
