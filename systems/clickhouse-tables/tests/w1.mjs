// W1 Type one volume, on ClickHouse.
//
// A planner types one customer's volume for one SKU and plan month, in the biggest customer group of its
// country. The typed volume is a newer version of its row in the table of overrides, and every calculated
// table it reaches is built again. Timed until the country's EBIT for the year can be read.

import { restore, members, rebuild, now } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const REBUILD = rebuild('Volume Override IN');

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m, pick: { at, country, value } }) {
        await db.run(`INSERT INTO "Volume Override IN" ("Customer", "SKU", "Versions", "Years", "Months", v, ver, is_deleted)
                      VALUES (${m.id('Customer', at.Customer)}, ${m.id('SKU', at.SKU)}, ${m.id('Versions', at.Versions)}, ${m.id('Years', at.Years)}, ${m.id('Months', at.Months)}, ${value}, ${now}, 0)`);
        await db.run(REBUILD);

        const [ebit] = await db.rows(`
            SELECT sum(v) AS total FROM "EBIT OUT"
            WHERE "Country" = ${m.id('Country', country)} AND "Versions" = ${m.id('Versions', at.Versions)} AND "Years" = ${m.id('Years', at.Years)}`);
        return ebit.total === null ? [] : [{ key: {}, value: ebit.total }];
    },

    // Untimed: the volume is the typed one, and no other country's EBIT moved.
    async check({ db, m, pick: { at } }) {
        const [volume] = await db.rows(`
            SELECT sum(v) AS total FROM "Volume"
            WHERE "Customer" = ${m.id('Customer', at.Customer)} AND "SKU" = ${m.id('SKU', at.SKU)} AND "Versions" = ${m.id('Versions', at.Versions)} AND "Years" = ${m.id('Years', at.Years)} AND "Months" = ${m.id('Months', at.Months)}`);
        const byCountry = await db.rows(`
            SELECT "Country" AS c, sum(v) AS total FROM "EBIT OUT" WHERE "Versions" = ${m.id('Versions', at.Versions)} AND "Years" = ${m.id('Years', at.Years)} GROUP BY "Country"`);
        return {
            Volume: volume.total === null ? [] : [{ key: {}, value: volume.total }],
            'EBIT OUT by country': byCountry.filter((r) => r.total !== null).map((r) => ({ key: { Country: m.name('Country', r.c) }, value: r.total })),
        };
    },

    teardown: ({ db }) => db.close(),
};
