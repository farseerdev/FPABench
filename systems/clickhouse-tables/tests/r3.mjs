// R3 Plan against last year, on ClickHouse.
//
// Three P&Ls in euros by line, side by side: the budget and the forecast of the plan year, and last year's
// actuals. Each row is tagged with the index of its read.
// Setup puts the database back to the snapshot, builds every calculated table and reads the member ids.
// Each run reads by id, and turns the ids into names.

import { restore, members } from '../db.mjs';

const READS = [
    ['Budget', 'Y2026'],
    ['FC 6+6', 'Y2026'],
    ['Actual', 'Y2025'],
];

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m }) {
        const out = [];
        for (const [i, [version, year]] of READS.entries()) {
            const rows = await db.rows(`
                SELECT "PL Line" AS line, sum(v) AS total FROM "PL EUR OUT"
                WHERE "Versions" = ${m.id('Versions', version)} AND "Years" = ${m.id('Years', year)}
                GROUP BY "PL Line"`);
            for (const r of rows) if (r.total !== null) out.push({ key: { 'PL Line': m.name('PL Line', r.line), read: String(i) }, value: r.total });
        }
        return out;
    },

    teardown: ({ db }) => db.close(),
};
