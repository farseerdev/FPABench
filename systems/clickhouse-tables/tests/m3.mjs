// M3 Move a customer to another group, on ClickHouse.
//
// One customer moves to another customer group of the same country and channel. Its row in the customer
// dimension gets the new group, and calculate.sql builds every calculated table again. Timed until gross
// sales of the old and the new group can be read.

import { restore, members, sqlFile } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const CALCULATE = sqlFile('calculate.sql');

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m, pick: { customer, group, target } }) {
        await db.run(`ALTER TABLE "dim Customer" UPDATE "Customer Group" = ${m.id('Customer Group', target)} WHERE "Customer" = ${m.id('Customer', customer)}`);
        await db.run(CALCULATE);

        const rows = await db.rows(`
            SELECT c."Customer Group" AS g, sum(s.v) AS total FROM "Gross Sales" s JOIN "flat Customer" c ON c."Customer" = s."Customer"
            WHERE c."Customer Group" IN (${m.id('Customer Group', group)}, ${m.id('Customer Group', target)})
              AND s."Versions" = ${m.id('Versions', 'FC 6+6')} AND s."Years" = ${m.id('Years', 'Y2026')}
            GROUP BY c."Customer Group"`);
        return rows.filter((r) => r.total !== null).map((r) => ({ key: { 'Customer Group': m.name('Customer Group', r.g) }, value: r.total }));
    },

    // Actual EBIT by country and month, untimed. The past does not move.
    async check({ db, m }) {
        const rows = await db.rows(`
            SELECT "Country" AS c, "Years" AS y, "Months" AS mo, sum(v) AS total FROM "EBIT OUT" WHERE "Versions" = ${m.id('Versions', 'Actual')} GROUP BY ALL`);
        return {
            'Actual EBIT OUT by country and month': rows
                .filter((r) => r.total !== null)
                .map((r) => ({ key: { Country: m.name('Country', r.c), Years: m.name('Years', r.y), Months: m.name('Months', r.mo) }, value: r.total })),
        };
    },

    teardown: ({ db }) => db.close(),
};
