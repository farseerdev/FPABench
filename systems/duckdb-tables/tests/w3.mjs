// W3 Change a rebate rate, on DuckDB.
//
// A planner raises one customer group's rebate rate in a plan month. The new rate replaces its row in the
// input table, and every calculated table the rate reaches is built again. Timed until the country's EBIT
// for that month can be read.

import { restore, members, rebuild } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const REBUILD = rebuild('Rebate Rate IN');

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m, pick: { at, country, value } }) {
        await db.run(`INSERT OR REPLACE INTO "Rebate Rate IN" ("Customer Group", "Versions", "Years", "Months", v)
                      VALUES (${m.id('Customer Group', at['Customer Group'])}, ${m.id('Versions', at.Versions)}, ${m.id('Years', at.Years)}, ${m.id('Months', at.Months)}, ${value})`);
        await db.run(REBUILD);

        const [ebit] = await db.rows(`
            SELECT sum(v) AS v FROM "EBIT OUT"
            WHERE "Country" = ${m.id('Country', country)} AND "Versions" = ${m.id('Versions', at.Versions)} AND "Years" = ${m.id('Years', at.Years)} AND "Months" = ${m.id('Months', at.Months)}`);
        return ebit.v === null ? [] : [{ key: {}, value: ebit.v }];
    },

    teardown: ({ db }) => db.close(),
};
