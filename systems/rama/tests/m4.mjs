// M4 Allocate one more cost, on RAMA.
//
// The modeller adds a cost pool from the marketing staff's OPEX, allocates it to customers and brands, and
// subtracts it in contribution margin III. MODEL_IMPORT takes the new and changed variables, in dependency
// order, and its commit recalculates every cell that depends on them. Timed until contribution margin III
// can be read by country.

import { restore, modelFile, modelImportFile } from '../db.mjs';

// The JSON this test sends, read once when the file loads. Setup writes it to the file the command reads.
const CHANGE = modelFile('m4.json');

export default {
    async setup(context) {
        context.db = restore(context.work);
        context.change = modelImportFile(context.work, CHANGE);
    },

    async run({ db, change }) {
        await db.modelImport(change);

        return await db.rows('Contribution Margin III by Country', ['Country'], { Versions: 'FC 6+6', Years: 'Y2026' });
    },

    // Untimed: the new cost and the overheads by country, the OPEX check, and EBIT, which must not move.
    check: async ({ db }) => ({
        'Marketing Staff Cost by country': await db.rows('Marketing Staff Cost', ['Country'], { Versions: 'FC 6+6', Years: 'Y2026' }),
        'Overheads by country': await db.rows('Overheads', ['Country'], { Versions: 'FC 6+6', Years: 'Y2026' }),
        'CHECK OPEX in EBIT': await db.rows('CHECK OPEX in EBIT', ['Country', 'Versions', 'Years', 'Months']),
        'EBIT OUT by country and month': await db.rows('EBIT OUT', ['Country', 'Versions', 'Years', 'Months']),
    }),

    teardown: ({ db }) => db.close(),
};
