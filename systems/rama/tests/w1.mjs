// W1 Type one volume, on RAMA.
//
// A planner types one customer's volume for one SKU and plan month, in the biggest customer group of its
// country. updateCells writes it, as when a user types into a Farseer sheet, and the commit recalculates
// every cell it reaches. Timed until the country's EBIT for the year can be read.

import { restore, cell } from '../db.mjs';

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    async run({ db, pick: { at, country, value } }) {
        db.rw((tx) => tx.updateCells([], [{ type: 'VARIABLE', formula: cell('Volume Override IN', at), value }], [], false));

        return db.rows('EBIT OUT', [], { Country: country, Versions: at.Versions, Years: at.Years });
    },

    // Untimed: the volume is the typed one, and no other country's EBIT moved.
    check: ({ db, pick: { at } }) => ({
        Volume: db.rows('Volume', [], at),
        'EBIT OUT by country': db.rows('EBIT OUT', ['Country'], { Versions: at.Versions, Years: at.Years }),
    }),

    teardown: ({ db }) => db.close(),
};
