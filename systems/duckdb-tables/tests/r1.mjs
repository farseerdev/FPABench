// R1 Company P&L, on DuckDB.
//
// The P&L in euros by line and month, for the plan year.
// Setup puts the database back to the snapshot, builds every calculated table and reads the member ids.
// Each run reads by id, and turns the ids into names.

import { restore, members } from '../db.mjs';

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m }) {
        const rows = await db.rows(`
            SELECT "PL Line" AS line, "Months" AS b, sum(v) AS v FROM "PL EUR OUT"
            WHERE "Versions" = ${m.id('Versions', 'FC 6+6')} AND "Years" = ${m.id('Years', 'Y2026')}
            GROUP BY "PL Line", "Months"`);
        return rows.filter((r) => r.v !== null).map((r) => ({ key: { 'PL Line': m.name('PL Line', r.line), Months: m.name('Months', r.b) }, value: r.v }));
    },

    teardown: ({ db }) => db.close(),
};
