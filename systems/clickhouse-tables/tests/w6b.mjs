// W6b Change the cost of an office, on ClickHouse.
//
// A planner raises one cost center's operating cost for one account and plan month. An office's cost is not
// allocated, so the write moves one total. The new cost is a newer version of its row in the input table, and
// every calculated table it reaches is built again. Timed until the country's EBIT for the month can be read.

import { restore, members, rebuild, now } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const REBUILD = rebuild('OPEX IN');

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m, pick: { at, country, value } }) {
        await db.run(`INSERT INTO "OPEX IN" ("Cost Center", "Account", "Versions", "Years", "Months", v, ver, is_deleted)
                      VALUES (${m.id('Cost Center', at['Cost Center'])}, ${m.id('Account', at.Account)}, ${m.id('Versions', at.Versions)}, ${m.id('Years', at.Years)}, ${m.id('Months', at.Months)}, ${value}, ${now}, 0)`);
        await db.run(REBUILD);

        const [ebit] = await db.rows(`
            SELECT sum(v) AS total FROM "EBIT OUT"
            WHERE "Country" = ${m.id('Country', country)} AND "Versions" = ${m.id('Versions', at.Versions)} AND "Years" = ${m.id('Years', at.Years)} AND "Months" = ${m.id('Months', at.Months)}`);
        return ebit.total === null ? [] : [{ key: {}, value: ebit.total }];
    },

    teardown: ({ db }) => db.close(),
};
