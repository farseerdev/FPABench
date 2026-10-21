// R2a P&L by brand, on ClickHouse.
//
// The P&L in euros by line and brand, for the plan year. Setup puts the database back to the snapshot,
// builds every calculated table and reads the member ids. Each run reads by id.

import { restore, members } from '../db.mjs';

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m }) {
        const rows = await db.rows(`
            SELECT "PL Line" AS line, "Brand" AS b, sum(v) AS total FROM "PL EUR OUT"
            WHERE "Versions" = ${m.id('Versions', 'FC 6+6')} AND "Years" = ${m.id('Years', 'Y2026')}
            GROUP BY "PL Line", "Brand"`);
        return rows.filter((r) => r.total !== null).map((r) => ({ key: { 'PL Line': m.name('PL Line', r.line), Brand: m.name('Brand', r.b) }, value: r.total }));
    },

    teardown: ({ db }) => db.close(),
};
