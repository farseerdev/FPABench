// R7 Top customers, on ClickHouse.
//
// The 100 customers of one country with the highest contribution margin III in the plan year, highest first.
// One country, so every value is in one currency. Setup puts the database back to the snapshot and builds
// every calculated table. Each run reads.

import { restore, members } from '../db.mjs';

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    // Every customer of the country, then the top 100 by value, ties by name, as RAMA's R7 sorts them.
    async run({ db, m, pick: { country } }) {
        const rows = await db.rows(`
            SELECT s."Customer" AS customer, sum(s.v) AS total FROM "Contribution Margin III" s JOIN "flat Customer" c ON c."Customer" = s."Customer"
            WHERE c."Country" = ${m.id('Country', country)} AND s."Versions" = ${m.id('Versions', 'FC 6+6')} AND s."Years" = ${m.id('Years', 'Y2026')}
            GROUP BY s."Customer"`);
        return rows
            .filter((r) => r.total !== null)
            .map((r) => ({ key: { Customer: m.name('Customer', r.customer) }, value: r.total }))
            .sort((a, b) => b.value - a.value || (a.key.Customer < b.key.Customer ? -1 : 1))
            .slice(0, 100);
    },

    teardown: ({ db }) => db.close(),
};
