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

    run: ({ db, pick: { group } }) =>
        VARIABLES.flatMap((variable) =>
            db.rows(variable, ['Customer', 'SKU'], { 'Customer Group': group, Versions: 'FC 6+6', Years: 'Y2026', Months: 'M7' }).map((r) => ({ key: { ...r.key, variable }, value: r.value }))
        ),

    teardown: ({ db }) => db.close(),
};
