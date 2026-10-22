// W4 Raise a brand's price, on RAMA.
//
// A planner raises one brand's price increase for the plan year. updateCells writes it, and the commit
// recalculates every cell it reaches. Timed until the brand's gross sales can be read by country and plan
// month.

import { restore, cell } from '../db.mjs';

const MONTHS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12'];

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    async run({ db, pick: { brand, value, months } }) {
        db.rw((tx) => tx.updateCells([], [{ type: 'VARIABLE', formula: cell('Price Increase IN', { Brand: brand, Versions: 'FC 6+6', Years: 'Y2026' }), value }], [], false));

        return db.rows('Gross Sales', ['Country', 'Months'], { Brand: brand, Versions: 'FC 6+6', Years: 'Y2026', Months: months });
    },

    // The brand's gross sales in the closed months, untimed. They must not move.
    check: ({ db, pick: { brand, months } }) => ({
        'Gross Sales in closed months': db.rows('Gross Sales', ['Country', 'Months'], { Brand: brand, Versions: 'FC 6+6', Years: 'Y2026', Months: MONTHS.filter((m) => !months.includes(m)) }),
    }),

    teardown: ({ db }) => db.close(),
};
