// R8 Open the model, on RAMA.
//
// Each run opens the snapshot database with an empty OS cache, then reads EBIT in euros for the plan year.
// Timed from openDB until the read returns.

import { reset, open } from '../db.mjs';

export default {
    setup: ({ work }) => reset(work),

    async open(context) {
        context.db = open(context.work);
    },

    run: ({ db }) => db.rows('EBIT EUR OUT', [], { Versions: 'FC 6+6', Years: 'Y2026' }),

    teardown: ({ db }) => db.close(),
};
