// W3 Change a rebate rate, on RAMA.
//
// A planner changes one customer group's rebate rate for one plan month. UPDATE_CELLS writes it, and the
// commit recalculates every cell it reaches. Timed until the country's EBIT for the month can be read.

import { restore, cell } from '../db.mjs';

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    async run({ db, pick: { at, country, value } }) {
        await db.updateCells([{ type: 'VARIABLE', formula: cell('Rebate Rate IN', at), value }]);

        return await db.rows('EBIT OUT', [], { Country: country, Versions: at.Versions, Years: at.Years, Months: at.Months });
    },

    teardown: ({ db }) => db.close(),
};
