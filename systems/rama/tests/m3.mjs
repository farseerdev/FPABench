// M3 Move a customer to another group, on RAMA.
//
// One customer moves to another customer group of the same country and channel. MODEL_IMPORT gives its row
// in the Customer table the new group, and its commit recalculates every cell that depends on it. Timed
// until gross sales of the old and the new group can be read.

import path from 'node:path';
import { restore, modelImportFile, readCsv } from '../db.mjs';

// The Customer table with one row: a customer, its group and its region, as model/model.json lays it out.
const customerTable = (customer, group, region) => ({
    name: 'Customer',
    columns: [{ type: 'PRIMARY_KEY' }, { type: 'FOREIGN_KEY', foreignKeyTableName: 'Customer Group' }, { type: 'FOREIGN_KEY', foreignKeyTableName: 'Region' }],
    rows: [[customer, [group], [region]]],
});

export default {
    // The customer's region, from the dataset, untimed. Its row goes in whole, with the new group, as the JSON
    // file the command reads.
    async setup(context) {
        context.db = restore(context.work);
        const row = readCsv(path.join(context.cells.base, 'dimensions', 'Customer.csv')).find((r) => r.Customer === context.pick.customer);
        const { customer, target } = context.pick;
        context.change = modelImportFile(context.work, JSON.stringify({ tables: [customerTable(customer, target, row.Region || 'NULL (Region)')], variables: [] }));
    },

    async run({ db, change, pick: { group, target } }) {
        await db.modelImport(change);

        return await db.rows('Gross Sales', ['Customer Group'], { 'Customer Group': [group, target], Versions: 'FC 6+6', Years: 'Y2026' });
    },

    // Actual EBIT by country and month, untimed. The past does not move.
    check: async ({ db }) => ({ 'Actual EBIT OUT by country and month': await db.rows('EBIT OUT', ['Country', 'Years', 'Months'], { Versions: 'Actual' }) }),

    teardown: ({ db }) => db.close(),
};
