// R5 Drill to the detail, on RAMA.
//
// Twelve lines of the P&L, from gross sales to gross margin, by customer and SKU, for one customer group in
// one plan month.
// Setup puts the database back to the snapshot and opens it. Each run reads.

import { restore } from '../db.mjs';

const VARIABLES = ['Gross Sales', 'Standard Discounts', 'Promo Discounts', 'Logistics Discounts', 'Invoice Sales', 'Rebates', 'Growth Bonus', 'Trade Fees', 'Promo Funding', 'Net Sales', 'COGS', 'Gross Margin'];

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    async run({ db, pick: { group } }) {
        const out = [];
        for (const variable of VARIABLES) {
            for (const r of await db.rows(variable, ['Customer', 'SKU'], { 'Customer Group': group, Versions: 'FC 6+6', Years: 'Y2026', Months: 'M7' })) out.push({ key: { ...r.key, variable }, value: r.value });
        }
        return out;
    },

    teardown: ({ db }) => db.close(),
};
