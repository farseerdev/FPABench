// W5 Change a planning exchange rate, on ClickHouse.
//
// A planner changes one currency's exchange rate for one plan month. The new rate is a newer version of its
// row in the input table, and every calculated table it reaches is built again. Timed until the cost of goods
// of the country with that currency can be read for the month.

import { restore, members, rebuild, now } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const REBUILD = rebuild('FX Rate IN');

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m, pick: { at, country, value } }) {
        await db.run(`INSERT INTO "FX Rate IN" ("Currency", "Versions", "Years", "Months", v, ver, is_deleted)
                      VALUES (${m.id('Currency', at.Currency)}, ${m.id('Versions', at.Versions)}, ${m.id('Years', at.Years)}, ${m.id('Months', at.Months)}, ${value}, ${now}, 0)`);
        await db.run(REBUILD);

        const [cogs] = await db.rows(`
            SELECT sum(s.v) AS total FROM "COGS" s JOIN "flat Customer" f ON f."Customer" = s."Customer"
            WHERE f."Country" = ${m.id('Country', country)} AND s."Versions" = ${m.id('Versions', at.Versions)} AND s."Years" = ${m.id('Years', at.Years)} AND s."Months" = ${m.id('Months', at.Months)}`);
        return cogs.total === null ? [] : [{ key: {}, value: cogs.total }];
    },

    // The cost of goods of every country that month, untimed. Only one may move.
    async check({ db, m, pick: { at } }) {
        const rows = await db.rows(`
            SELECT f."Country" AS c, sum(s.v) AS total FROM "COGS" s JOIN "flat Customer" f ON f."Customer" = s."Customer"
            WHERE s."Versions" = ${m.id('Versions', at.Versions)} AND s."Years" = ${m.id('Years', at.Years)} AND s."Months" = ${m.id('Months', at.Months)}
            GROUP BY f."Country"`);
        return { 'COGS by country': rows.filter((r) => r.total !== null).map((r) => ({ key: { Country: m.name('Country', r.c) }, value: r.total })) };
    },

    teardown: ({ db }) => db.close(),
};
