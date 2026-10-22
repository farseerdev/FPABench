// M4 Allocate one more cost, on RAMA.
//
// The modeller adds a cost pool from the marketing staff's OPEX, allocates it to customers and brands, and
// subtracts it in contribution margin III. modelImport takes the new and changed variables, in dependency
// order, and the commit recalculates every cell that depends on them. Timed until contribution margin III
// can be read by country.

import { restore, NO_DELETE, modelFile } from '../db.mjs';

// The JSON this test sends, read once when the file loads, so no file read is timed.
const CHANGE = modelFile('m4.json');

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    async run({ db }) {
        db.rw((tx) => tx.modelImport(CHANGE, { dryRun: false, deleteEnabled: NO_DELETE }));

        return db.rows('Contribution Margin III by Country', ['Country'], { Versions: 'FC 6+6', Years: 'Y2026' });
    },

    // Untimed: the new cost and the overheads by country, the OPEX check, and EBIT, which must not move.
    check: ({ db }) => ({
        'Marketing Staff Cost by country': db.rows('Marketing Staff Cost', ['Country'], { Versions: 'FC 6+6', Years: 'Y2026' }),
        'Overheads by country': db.rows('Overheads', ['Country'], { Versions: 'FC 6+6', Years: 'Y2026' }),
        'CHECK OPEX in EBIT': db.rows('CHECK OPEX in EBIT', ['Country', 'Versions', 'Years', 'Months']),
        'EBIT OUT by country and month': db.rows('EBIT OUT', ['Country', 'Versions', 'Years', 'Months']),
    }),

    teardown: ({ db }) => db.close(),
};
