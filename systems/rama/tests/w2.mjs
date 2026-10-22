// W2 Paste 1,000 volumes at once, on RAMA.
//
// A planner pastes 1,000 volumes into the plan months of one country. One updateCells call writes all of
// them, and the commit recalculates every cell they reach. Timed until the country's volume over the plan
// months can be read.

import { restore, cell } from '../db.mjs';

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    async run({ db, pick: { cells, country, months } }) {
        db.rw((tx) => tx.updateCells([], cells.map(({ at, value }) => ({ type: 'VARIABLE', formula: cell('Volume Override IN', at), value })), [], false));

        return db.rows('Volume', [], { Country: country, Versions: 'FC 6+6', Years: 'Y2026', Months: months });
    },

    // The country's EBIT for the year, untimed.
    check: ({ db, pick: { country } }) => ({ 'EBIT OUT': db.rows('EBIT OUT', [], { Country: country, Versions: 'FC 6+6', Years: 'Y2026' }) }),

    teardown: ({ db }) => db.close(),
};
