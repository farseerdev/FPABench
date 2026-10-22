// W8 Flip a yearly bonus, on ClickHouse.
//
// A planner moves one customer group's growth threshold just across the group's growth, so its yearly bonus
// switches on or off. The threshold is a newer version of its row in the input table, and every calculated
// table it reaches is built again. Timed until the group's growth bonus for the year can be read.

import { restore, members, rebuild, now } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const REBUILD = rebuild('Growth Bonus Threshold IN');

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m, pick: { group, value } }) {
        await db.run(`INSERT INTO "Growth Bonus Threshold IN" ("Customer Group", "Versions", "Years", v, ver, is_deleted)
                      VALUES (${m.id('Customer Group', group)}, ${m.id('Versions', 'FC 6+6')}, ${m.id('Years', 'Y2026')}, ${value}, ${now}, 0)`);
        await db.run(REBUILD);

        const [bonus] = await db.rows(`
            SELECT sum(s.v) AS total FROM "Growth Bonus" s JOIN "flat Customer" c ON c."Customer" = s."Customer"
            WHERE c."Customer Group" = ${m.id('Customer Group', group)} AND s."Versions" = ${m.id('Versions', 'FC 6+6')} AND s."Years" = ${m.id('Years', 'Y2026')}`);
        return bonus.total === null ? [] : [{ key: {}, value: bonus.total }];
    },

    // The bonus check of the group, untimed. It must stay 0.
    async check({ db, m, pick: { group } }) {
        const [check] = await db.rows(`
            SELECT sum(v) AS total FROM "CHECK Growth Bonus"
            WHERE "Customer Group" = ${m.id('Customer Group', group)} AND "Versions" = ${m.id('Versions', 'FC 6+6')} AND "Years" = ${m.id('Years', 'Y2026')}`);
        return { 'CHECK Growth Bonus': check.total === null ? [] : [{ key: {}, value: check.total }] };
    },

    teardown: ({ db }) => db.close(),
};
