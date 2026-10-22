// R2c P&L by country, in its own currency, on ClickHouse.
//
// The P&L in each country's own currency by line and country, for the plan year.
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
            SELECT "PL Line" AS line, "Country" AS b, sum(v) AS total FROM "PL OUT"
            WHERE "Versions" = ${m.id('Versions', 'FC 6+6')} AND "Years" = ${m.id('Years', 'Y2026')}
            GROUP BY "PL Line", "Country"`);
        return rows.filter((r) => r.total !== null).map((r) => ({ key: { 'PL Line': m.name('PL Line', r.line), Country: m.name('Country', r.b) }, value: r.total }));
    },

    teardown: ({ db }) => db.close(),
};
