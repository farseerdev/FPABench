// W5 Change a planning exchange rate, on RAMA.
//
// A planner changes one currency's exchange rate for one plan month. updateCells writes it, and the commit
// recalculates every cell it reaches. Timed until the cost of goods of the country with that currency can
// be read for the month.

import { restore, cell } from '../db.mjs';

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    async run({ db, pick: { at, country, value } }) {
        db.rw((tx) => tx.updateCells([], [{ type: 'VARIABLE', formula: cell('FX Rate IN', at), value }], [], false));

        return db.rows('COGS', [], { Country: country, Versions: at.Versions, Years: at.Years, Months: at.Months });
    },

    // The cost of goods of every country that month, untimed. Only one may move.
    check: ({ db, pick: { at } }) => ({ 'COGS by country': db.rows('COGS', ['Country'], { Versions: at.Versions, Years: at.Years, Months: at.Months }) }),

    teardown: ({ db }) => db.close(),
};
