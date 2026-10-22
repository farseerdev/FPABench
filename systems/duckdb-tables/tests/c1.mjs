// C1 A write that changes nothing, on DuckDB. Untimed.
//
// A planner types a volume into a closed month. Closed months hold the actuals, so the country's EBIT and
// the volume itself must not move.

import { restore, members, rebuild } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const REBUILD = rebuild('Volume Override IN');

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m, pick: { at, country, value } }) {
        await db.run(`INSERT OR REPLACE INTO "Volume Override IN" ("Customer", "SKU", "Versions", "Years", "Months", v)
                      VALUES (${m.id('Customer', at.Customer)}, ${m.id('SKU', at.SKU)}, ${m.id('Versions', at.Versions)}, ${m.id('Years', at.Years)}, ${m.id('Months', at.Months)}, ${value})`);
        await db.run(REBUILD);

        const [ebit] = await db.rows(`
            SELECT sum(v) AS v FROM "EBIT OUT" WHERE "Country" = ${m.id('Country', country)} AND "Versions" = ${m.id('Versions', at.Versions)} AND "Years" = ${m.id('Years', at.Years)}`);
        return ebit.v === null ? [] : [{ key: {}, value: ebit.v }];
    },

    async check({ db, m, pick: { at } }) {
        const [volume] = await db.rows(`
            SELECT sum(v) AS v FROM "Volume"
            WHERE "Customer" = ${m.id('Customer', at.Customer)} AND "SKU" = ${m.id('SKU', at.SKU)} AND "Versions" = ${m.id('Versions', at.Versions)} AND "Years" = ${m.id('Years', at.Years)} AND "Months" = ${m.id('Months', at.Months)}`);
        return { Volume: volume.v === null ? [] : [{ key: {}, value: volume.v }] };
    },

    teardown: ({ db }) => db.close(),
};
