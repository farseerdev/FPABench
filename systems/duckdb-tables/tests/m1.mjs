// M1 Change a formula, on DuckDB.
//
// The modeller changes the formula of Handling KG. sql/m1.sql is the migration: the new input tables, if any, then
// every calculated table is built again. Timed until logistics cost can be read by brand and country.

import { restore, members } from '../db.mjs';

export default {
    // DuckDB has no incremental calculation: this test recalculates every calculated table.
    recalc: 'full',

    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m }) {
        await db.migrate('m1');

        const rows = await db.rows(`
            SELECT s."Brand" AS b, f."Country" AS c, sum(s.v) AS v FROM "Logistics Cost" s JOIN "flat Customer" f ON f."Customer" = s."Customer"
            WHERE s."Versions" = ${m.id('Versions', 'FC 6+6')} AND s."Years" = ${m.id('Years', 'Y2026')}
            GROUP BY s."Brand", f."Country"`);
        return rows.filter((r) => r.v !== null).map((r) => ({ key: { Brand: m.name('Brand', r.b), Country: m.name('Country', r.c) }, value: r.v }));
    },

    // Untimed: the change moves logistics cost between brands, so its total by country and EBIT do not move.
    async check({ db, m }) {
        const cost = await db.rows(`
            SELECT f."Country" AS c, s."Versions" AS ver, s."Years" AS y, s."Months" AS mo, sum(s.v) AS v
            FROM "Logistics Cost" s JOIN "flat Customer" f ON f."Customer" = s."Customer" GROUP BY ALL`);
        const ebit = await db.rows(`SELECT "Country" AS c, "Versions" AS ver, "Years" AS y, "Months" AS mo, sum(v) AS v FROM "EBIT OUT" GROUP BY ALL`);
        const key = (r) => ({ Country: m.name('Country', r.c), Versions: m.name('Versions', r.ver), Years: m.name('Years', r.y), Months: m.name('Months', r.mo) });
        return {
            'Logistics Cost by country and month': cost.filter((r) => r.v !== null).map((r) => ({ key: key(r), value: r.v })),
            'EBIT OUT by country and month': ebit.filter((r) => r.v !== null).map((r) => ({ key: key(r), value: r.v })),
        };
    },

    teardown: ({ db }) => db.close(),
};
