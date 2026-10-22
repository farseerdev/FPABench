// R2c P&L by country, in its own currency, on RAMA.
//
// The P&L in each country's own currency by line and country, for the plan year.
// Setup puts the database back to the snapshot and opens it. Each run reads.

import { restore } from '../db.mjs';

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    run: ({ db }) => db.rows('PL OUT', ['PL Line', 'Country'], { Versions: 'FC 6+6', Years: 'Y2026' }),

    teardown: ({ db }) => db.close(),
};
