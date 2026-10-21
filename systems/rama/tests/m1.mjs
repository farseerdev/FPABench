// M1 Change a formula, on RAMA.
//
// The modeller changes the formula of Handling KG. modelImport takes the changed variable, as when Farseer
// pushes a model, and the commit recalculates every cell that depends on it. Timed until logistics cost can
// be read by brand and country.

import { restore, NO_DELETE, modelFile } from '../db.mjs';

// The JSON this test sends, read once when the file loads, so no file read is timed.
const CHANGE = modelFile('m1.json');

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    async run({ db }) {
        db.rw((tx) => tx.modelImport(CHANGE, { dryRun: false, deleteEnabled: NO_DELETE }));

        return db.rows('Logistics Cost', ['Brand', 'Country'], { Versions: 'FC 6+6', Years: 'Y2026' });
    },

    // Untimed: the change moves logistics cost between brands, so its total by country and EBIT do not move.
    check: ({ db }) => ({
        'Logistics Cost by country and month': db.rows('Logistics Cost', ['Country', 'Versions', 'Years', 'Months']),
        'EBIT OUT by country and month': db.rows('EBIT OUT', ['Country', 'Versions', 'Years', 'Months']),
    }),

    teardown: ({ db }) => db.close(),
};
