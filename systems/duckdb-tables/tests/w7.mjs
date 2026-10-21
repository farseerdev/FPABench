// W7 Set a yearly target, on DuckDB.
//
// A planner sets one customer group's volume target for one category and the plan year. The target replaces
// its row in the input table, and every calculated table it reaches is built again. The target is spread
// over the months like last year's volume. Timed until the group's volume in the category can be read for
// the plan months.

import { restore, members, rebuild } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const REBUILD = rebuild('Volume Target IN');

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m, pick: { group, category, months, value } }) {
        await db.run(`INSERT OR REPLACE INTO "Volume Target IN" ("Customer Group", "Category", "Versions", "Years", v)
                      VALUES (${m.id('Customer Group', group)}, ${m.id('Category', category)}, ${m.id('Versions', 'FC 6+6')}, ${m.id('Years', 'Y2026')}, ${value})`);
        await db.run(REBUILD);

        const [volume] = await db.rows(`
            SELECT sum(s.v) AS v FROM "Volume" s
            JOIN "flat Customer" c ON c."Customer" = s."Customer" JOIN "flat SKU" k ON k."SKU" = s."SKU"
            WHERE c."Customer Group" = ${m.id('Customer Group', group)} AND k."Category" = ${m.id('Category', category)}
              AND s."Versions" = ${m.id('Versions', 'FC 6+6')} AND s."Years" = ${m.id('Years', 'Y2026')}
              AND s."Months" IN (${months.map((mo) => m.id('Months', mo)).join(', ')})`);
        return volume.v === null ? [] : [{ key: {}, value: volume.v }];
    },

    teardown: ({ db }) => db.close(),
};
