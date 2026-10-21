// W7 Set a yearly target, on RAMA.
//
// A planner sets one customer group's volume target for one category and the plan year. updateCells writes
// it, and the commit recalculates every cell it reaches. The target is spread over the months like last
// year's volume. Timed until the group's volume in the category can be read for the plan months.

import { restore, cell } from '../db.mjs';

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    async run({ db, pick: { group, category, months, value } }) {
        db.rw((tx) => tx.updateCells([], [{ type: 'VARIABLE', formula: cell('Volume Target IN', { 'Customer Group': group, Category: category, Versions: 'FC 6+6', Years: 'Y2026' }), value }], [], false));

        return db.rows('Volume', [], { 'Customer Group': group, Category: category, Versions: 'FC 6+6', Years: 'Y2026', Months: months });
    },

    teardown: ({ db }) => db.close(),
};
