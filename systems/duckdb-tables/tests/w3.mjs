// W3 Change a rebate rate, on DuckDB.
//
// A planner raises one customer group's rebate rate in a plan month. The new rate replaces its row in the
// input table, and every calculated table is built again. Timed until the country's EBIT
// for that month can be read.

import { restore, members } from '../db.mjs';

export default {
    // DuckDB has no incremental calculation: this test recalculates every calculated table.
    recalc: 'full',

    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m, pick: { at, country, value } }) {
        await db.write(async () => {
            await db.run(`INSERT OR REPLACE INTO "Rebate Rate IN" ("Customer Group", "Versions", "Years", "Months", v)
                          VALUES (${m.id('Customer Group', at['Customer Group'])}, ${m.id('Versions', at.Versions)}, ${m.id('Years', at.Years)}, ${m.id('Months', at.Months)}, ${value})`);
        });

        const [ebit] = await db.rows(`
            SELECT sum(v) AS v FROM "EBIT OUT"
            WHERE "Country" = ${m.id('Country', country)} AND "Versions" = ${m.id('Versions', at.Versions)} AND "Years" = ${m.id('Years', at.Years)} AND "Months" = ${m.id('Months', at.Months)}`);
        return ebit.v === null ? [] : [{ key: {}, value: ebit.v }];
    },

    teardown: ({ db }) => db.close(),
};
