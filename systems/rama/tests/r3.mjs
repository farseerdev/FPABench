// R3 Plan against last year, on RAMA.
//
// Three P&Ls in euros by line, side by side: the budget and the forecast of the plan year, and last year's
// actuals. Each row is tagged with the index of its read.
// Setup puts the database back to the snapshot and opens it. Each run reads.

import { restore } from '../db.mjs';

const READS = [
    { Versions: 'Budget', Years: 'Y2026' },
    { Versions: 'FC 6+6', Years: 'Y2026' },
    { Versions: 'Actual', Years: 'Y2025' },
];

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    run: ({ db }) => READS.flatMap((where, i) => db.rows('PL EUR OUT', ['PL Line'], where).map((r) => ({ key: { ...r.key, read: String(i) }, value: r.value }))),

    teardown: ({ db }) => db.close(),
};
