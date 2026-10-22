// R1 Company P&L, on RAMA.
//
// The P&L in euros by line and month, for the plan year.
// Setup puts the database back to the snapshot and opens it. Each run reads.

import { restore } from '../db.mjs';

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    run: ({ db }) => db.rows('PL EUR OUT', ['PL Line', 'Months'], { Versions: 'FC 6+6', Years: 'Y2026' }),

    teardown: ({ db }) => db.close(),
};
