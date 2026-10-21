// W4 Raise a brand's price, on DuckDB.
//
// A planner raises one brand's price increase for the plan year. The new value replaces its row in the input
// table, and every calculated table it reaches is built again. Timed until the brand's gross sales can be
// read by country and plan month.

import { restore, members, rebuild } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const REBUILD = rebuild('Price Increase IN');

const salesOfBrand = (m, brand, months, sign) => `
    SELECT c."Country" AS c, s."Months" AS mo, sum(s.v) AS v FROM "Gross Sales" s
    JOIN "flat Customer" c ON c."Customer" = s."Customer" JOIN "flat SKU" k ON k."SKU" = s."SKU"
    WHERE k."Brand" = ${m.id('Brand', brand)} AND s."Versions" = ${m.id('Versions', 'FC 6+6')} AND s."Years" = ${m.id('Years', 'Y2026')}
      AND s."Months" ${sign} (${months.map((mo) => m.id('Months', mo)).join(', ')})
    GROUP BY c."Country", s."Months"`;

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m, pick: { brand, value, months } }) {
        await db.run(`INSERT OR REPLACE INTO "Price Increase IN" ("Brand", "Versions", "Years", v) VALUES (${m.id('Brand', brand)}, ${m.id('Versions', 'FC 6+6')}, ${m.id('Years', 'Y2026')}, ${value})`);
        await db.run(REBUILD);

        const rows = await db.rows(salesOfBrand(m, brand, months, 'IN'));
        return rows.filter((r) => r.v !== null).map((r) => ({ key: { Country: m.name('Country', r.c), Months: m.name('Months', r.mo) }, value: r.v }));
    },

    // The brand's gross sales in the closed months, untimed. They must not move.
    async check({ db, m, pick: { brand, months } }) {
        const rows = await db.rows(salesOfBrand(m, brand, months, 'NOT IN'));
        return { 'Gross Sales in closed months': rows.filter((r) => r.v !== null).map((r) => ({ key: { Country: m.name('Country', r.c), Months: m.name('Months', r.mo) }, value: r.v })) };
    },

    teardown: ({ db }) => db.close(),
};
