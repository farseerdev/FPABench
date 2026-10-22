// C3 A read the last write cannot reach, on DuckDB. Untimed.
//
// After W1's first write, a typed volume in one country, the EBIT of another country must not move.

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

    teardown: ({ db }) => db.close(),
};
