// R6 Margin by product attributes, on RAMA.
//
// Gross margin by country, category and price tier, for the plan year. By country, so each value is in one
// currency.
// Setup puts the database back to the snapshot and opens it. Each run reads.

import { restore } from '../db.mjs';

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    run: ({ db }) => db.rows('Gross Margin', ['Country', 'Category', 'Price Tier'], { Versions: 'FC 6+6', Years: 'Y2026' }),

    teardown: ({ db }) => db.close(),
};
