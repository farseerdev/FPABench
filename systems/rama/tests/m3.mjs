// M3 Move a customer to another group, on RAMA.
//
// One customer moves to another customer group of the same country and channel. modelImport gives its row
// in the Customer table the new group, and the commit recalculates every cell that depends on it. Timed
// until gross sales of the old and the new group can be read.

import path from 'node:path';
import { restore, NO_DELETE, readCsv } from '../db.mjs';

// The Customer table with one row: a customer, its group and its region, as model/model.json lays it out.
const customerTable = (customer, group, region) => ({
    name: 'Customer',
    columns: [{ type: 'PRIMARY_KEY' }, { type: 'FOREIGN_KEY', foreignKeyTableName: 'Customer Group' }, { type: 'FOREIGN_KEY', foreignKeyTableName: 'Region' }],
    rows: [[customer, [group], [region]]],
});

export default {
    // The customer's region, from the dataset, untimed. Its row goes in whole, with the new group.
    async setup(context) {
        context.db = restore(context.work);
        const row = readCsv(path.join(context.cells.base, 'dimensions', 'Customer.csv')).find((r) => r.Customer === context.pick.customer);
        context.region = row.Region || 'NULL (Region)';
    },

    async run({ db, region, pick: { customer, group, target } }) {
        db.rw((tx) => tx.modelImport(JSON.stringify({ tables: [customerTable(customer, target, region)], variables: [] }), { dryRun: false, deleteEnabled: NO_DELETE }));

        return db.rows('Gross Sales', ['Customer Group'], { 'Customer Group': [group, target], Versions: 'FC 6+6', Years: 'Y2026' });
    },

    // Actual EBIT by country and month, untimed. The past does not move.
    check: ({ db }) => ({ 'Actual EBIT OUT by country and month': db.rows('EBIT OUT', ['Country', 'Years', 'Months'], { Versions: 'Actual' }) }),

    teardown: ({ db }) => db.close(),
};
