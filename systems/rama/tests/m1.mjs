// M1 Change a formula, on RAMA.
//
// The modeller changes the formula of Handling KG. MODEL_IMPORT takes the changed variable, as when Farseer
// pushes a model, and its commit recalculates every cell that depends on it. Timed until logistics cost can
// be read by brand and country.

import { restore, modelFile, modelImportFile } from '../db.mjs';

// The JSON this test sends, read once when the file loads. Setup writes it to the file the command reads.
const CHANGE = modelFile('m1.json');

export default {
    async setup(context) {
        context.db = restore(context.work);
        context.change = modelImportFile(context.work, CHANGE);
    },

    async run({ db, change }) {
        await db.modelImport(change);

        return await db.rows('Logistics Cost', ['Brand', 'Country'], { Versions: 'FC 6+6', Years: 'Y2026' });
    },

    // Untimed: the change moves logistics cost between brands, so its total by country and EBIT do not move.
    check: async ({ db }) => ({
        'Logistics Cost by country and month': await db.rows('Logistics Cost', ['Country', 'Versions', 'Years', 'Months']),
        'EBIT OUT by country and month': await db.rows('EBIT OUT', ['Country', 'Versions', 'Years', 'Months']),
    }),

    teardown: ({ db }) => db.close(),
};
