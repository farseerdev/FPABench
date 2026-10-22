// C3 A read the last write cannot reach, on RAMA. Untimed.
//
// After W1's first write, a typed volume in one country, the EBIT of another country must not move.

import { restore, cell } from '../db.mjs';

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    async run({ db, pick: { at, country, value } }) {
        db.rw((tx) => tx.updateCells([], [{ type: 'VARIABLE', formula: cell('Volume Override IN', at), value }], [], false));

        return db.rows('EBIT OUT', [], { Country: country, Versions: at.Versions, Years: at.Years });
    },

    teardown: ({ db }) => db.close(),
};
