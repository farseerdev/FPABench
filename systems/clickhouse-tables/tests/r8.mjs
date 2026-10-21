// R8 Open the model, on ClickHouse.
//
// Each run starts the server on the snapshot's data with an empty OS cache, which builds every calculated
// table, then reads EBIT in euros for the plan year. Timed from the start until the read returns.

import { reset, start, members } from '../db.mjs';

export default {
    setup: ({ work }) => reset(work),

    // Timed: the start, and the member ids the read needs.
    async open(context) {
        context.db = await start(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m }) {
        const [ebit] = await db.rows(`SELECT sum(v) AS total FROM "EBIT EUR OUT" WHERE "Versions" = ${m.id('Versions', 'FC 6+6')} AND "Years" = ${m.id('Years', 'Y2026')}`);
        return ebit.total === null ? [] : [{ key: {}, value: ebit.total }];
    },

    teardown: ({ db }) => db.close(),
};
