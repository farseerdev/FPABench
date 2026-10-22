// M2 Add a customer, on DuckDB.
//
// A new customer joins a customer group, with one typed volume in M7. The customer is a new row in the
// customer dimension, and calculate.sql builds every calculated table again. Timed until the group's
// volume in M7 can be read.

import { restore, members, sqlFile } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const CALCULATE = sqlFile('calculate.sql');

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m, pick: { customer, group, region, sku, value } }) {
        await db.run(`INSERT INTO "dim Customer" ("Customer", name, "Customer Group", "Region")
                      SELECT max("Customer") + 1, '${customer}', ${m.id('Customer Group', group)}, ${m.id('Region', region)} FROM "dim Customer"`);
        await db.run(`INSERT OR REPLACE INTO "Volume Override IN" ("Customer", "SKU", "Versions", "Years", "Months", v)
                      SELECT "Customer", ${m.id('SKU', sku)}, ${m.id('Versions', 'FC 6+6')}, ${m.id('Years', 'Y2026')}, ${m.id('Months', 'M7')}, ${value}
                      FROM "dim Customer" WHERE name = '${customer}'`);
        await db.run(CALCULATE);

        const [volume] = await db.rows(`
            SELECT sum(s.v) AS v FROM "Volume" s JOIN "flat Customer" c ON c."Customer" = s."Customer"
            WHERE c."Customer Group" = ${m.id('Customer Group', group)} AND s."Versions" = ${m.id('Versions', 'FC 6+6')}
              AND s."Years" = ${m.id('Years', 'Y2026')} AND s."Months" = ${m.id('Months', 'M7')}`);
        return volume.v === null ? [] : [{ key: {}, value: volume.v }];
    },

    // The EBIT of the group's country, untimed.
    async check({ db, m, pick: { country } }) {
        const [ebit] = await db.rows(`
            SELECT sum(v) AS v FROM "EBIT OUT" WHERE "Country" = ${m.id('Country', country)} AND "Versions" = ${m.id('Versions', 'FC 6+6')} AND "Years" = ${m.id('Years', 'Y2026')}`);
        return { 'EBIT OUT': ebit.v === null ? [] : [{ key: {}, value: ebit.v }] };
    },

    teardown: ({ db }) => db.close(),
};
