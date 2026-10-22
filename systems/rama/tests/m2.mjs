// M2 Add a customer, on RAMA.
//
// A new customer joins a customer group, with one typed volume in M7. modelImport adds the customer to the
// Customer table, and updateCells types the volume, in one transaction. Timed until the group's volume in
// M7 can be read.

import { restore, cell, NO_DELETE } from '../db.mjs';

// The Customer table with one row: a customer, its group and its region, as model/model.json lays it out.
const customerTable = (customer, group, region) => ({
    name: 'Customer',
    columns: [{ type: 'PRIMARY_KEY' }, { type: 'FOREIGN_KEY', foreignKeyTableName: 'Customer Group' }, { type: 'FOREIGN_KEY', foreignKeyTableName: 'Region' }],
    rows: [[customer, [group], [region]]],
});

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    async run({ db, pick: { customer, group, region, sku, value } }) {
        db.rw((tx) => {
            tx.modelImport(JSON.stringify({ tables: [customerTable(customer, group, region)], variables: [] }), { dryRun: false, deleteEnabled: NO_DELETE });
            tx.updateCells([], [{ type: 'VARIABLE', formula: cell('Volume Override IN', { Customer: customer, SKU: sku, Versions: 'FC 6+6', Years: 'Y2026', Months: 'M7' }), value }], [], false);
        });

        return db.rows('Volume', [], { 'Customer Group': group, Versions: 'FC 6+6', Years: 'Y2026', Months: 'M7' });
    },

    // The EBIT of the group's country, untimed.
    check: ({ db, pick: { country } }) => ({ 'EBIT OUT': db.rows('EBIT OUT', [], { Country: country, Versions: 'FC 6+6', Years: 'Y2026' }) }),

    teardown: ({ db }) => db.close(),
};
