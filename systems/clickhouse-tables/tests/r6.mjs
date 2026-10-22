// R6 Margin by product attributes, on ClickHouse.
//
// Gross margin by country, category and price tier, for the plan year. By country, so each value is in one
// currency.
// Setup puts the database back to the snapshot, builds every calculated table and reads the member ids.
// Each run reads by id, and turns the ids into names.

import { restore, members } from '../db.mjs';

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m }) {
        const rows = await db.rows(`
            SELECT c."Country" AS country, k."Category" AS category, k."Price Tier" AS tier, sum(s.v) AS total FROM "Gross Margin" s
            JOIN "flat Customer" c ON c."Customer" = s."Customer" JOIN "flat SKU" k ON k."SKU" = s."SKU"
            WHERE s."Versions" = ${m.id('Versions', 'FC 6+6')} AND s."Years" = ${m.id('Years', 'Y2026')}
            GROUP BY c."Country", k."Category", k."Price Tier"`);
        return rows
            .filter((r) => r.total !== null)
            .map((r) => ({ key: { Country: m.name('Country', r.country), Category: m.name('Category', r.category), 'Price Tier': m.name('Price Tier', r.tier) }, value: r.total }));
    },

    teardown: ({ db }) => db.close(),
};
