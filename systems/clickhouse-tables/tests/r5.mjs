// R5 Drill to the detail, on ClickHouse.
//
// Twelve lines of the P&L, from gross sales to gross margin, by customer and SKU, for one customer group in
// one plan month.
// Setup puts the database back to the snapshot, builds every calculated table and reads the member ids.
// Each run reads by id, and turns the ids into names.

import { restore, members } from '../db.mjs';

const VARIABLES = ['Gross Sales', 'Standard Discounts', 'Promo Discounts', 'Logistics Discounts', 'Invoice Sales', 'Rebates', 'Growth Bonus', 'Trade Fees', 'Promo Funding', 'Net Sales', 'COGS', 'Gross Margin'];

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m, pick: { group } }) {
        const out = [];
        for (const variable of VARIABLES) {
            const rows = await db.rows(`
                SELECT s."Customer" AS customer, s."SKU" AS sku, sum(s.v) AS total FROM "${variable}" s JOIN "flat Customer" c ON c."Customer" = s."Customer"
                WHERE c."Customer Group" = ${m.id('Customer Group', group)} AND s."Versions" = ${m.id('Versions', 'FC 6+6')} AND s."Years" = ${m.id('Years', 'Y2026')} AND s."Months" = ${m.id('Months', 'M7')}
                GROUP BY s."Customer", s."SKU"`);
            for (const r of rows) if (r.total !== null) out.push({ key: { Customer: m.name('Customer', r.customer), SKU: m.name('SKU', r.sku), variable }, value: r.total });
        }
        return out;
    },

    teardown: ({ db }) => db.close(),
};
