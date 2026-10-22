// C1 A write that changes nothing, on RAMA. Untimed.
//
// A planner types a volume into a closed month. Closed months hold the actuals, so the country's EBIT and
// the volume itself must not move.

import { restore, cell } from '../db.mjs';

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    async run({ db, pick: { at, country, value } }) {
        db.rw((tx) => tx.updateCells([], [{ type: 'VARIABLE', formula: cell('Volume Override IN', at), value }], [], false));

        return db.rows('EBIT OUT', [], { Country: country, Versions: at.Versions, Years: at.Years });
    },

    check: ({ db, pick: { at } }) => ({ Volume: db.rows('Volume', [], at) }),

    teardown: ({ db }) => db.close(),
};
