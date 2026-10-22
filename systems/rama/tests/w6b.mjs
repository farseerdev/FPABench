// W6b Change the cost of an office, on RAMA.
//
// A planner raises one cost center's operating cost for one account and plan month. An office's cost is not allocated, so the write moves one total.
// updateCells writes it, and the commit recalculates every cell it reaches. Timed until the country's EBIT
// for the month can be read.

import { restore, cell } from '../db.mjs';

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    async run({ db, pick: { at, country, value } }) {
        db.rw((tx) => tx.updateCells([], [{ type: 'VARIABLE', formula: cell('OPEX IN', at), value }], [], false));

        return db.rows('EBIT OUT', [], { Country: country, Versions: at.Versions, Years: at.Years, Months: at.Months });
    },

    teardown: ({ db }) => db.close(),
};
