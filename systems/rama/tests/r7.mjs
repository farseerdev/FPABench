// R7 Top customers, on RAMA.
//
// The 100 customers of one country with the highest contribution margin III in the plan year, highest
// first. One country, so every value is in one currency.
// Setup puts the database back to the snapshot and opens it. Each run reads.

import { restore } from '../db.mjs';

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    run({ db, pick: { country } }) {
        const rows = db.rows('Contribution Margin III', ['Customer'], { Country: country, Versions: 'FC 6+6', Years: 'Y2026' });
        return rows.sort((a, b) => b.value - a.value || (a.key.Customer < b.key.Customer ? -1 : 1)).slice(0, 100);
    },

    teardown: ({ db }) => db.close(),
};
