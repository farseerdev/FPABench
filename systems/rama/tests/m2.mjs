// M2 Add a customer, on RAMA.
//
// A new customer joins a customer group, with one typed volume in M7. MODEL_IMPORT adds the customer to the
// Customer table, and UPDATE_CELLS types the volume. They are two commands, and each commits. Timed until the
// group's volume in M7 can be read.

import { restore, cell, modelImportFile } from '../db.mjs';

// The Customer table with one row: a customer, its group and its region, as model/model.json lays it out.
const customerTable = (customer, group, region) => ({
    name: 'Customer',
    columns: [{ type: 'PRIMARY_KEY' }, { type: 'FOREIGN_KEY', foreignKeyTableName: 'Customer Group' }, { type: 'FOREIGN_KEY', foreignKeyTableName: 'Region' }],
    rows: [[customer, [group], [region]]],
});

export default {
    // Setup writes the JSON of the new customer to the file the command reads.
    async setup(context) {
        context.db = restore(context.work);
        const { customer, group, region } = context.pick;
        context.change = modelImportFile(context.work, JSON.stringify({ tables: [customerTable(customer, group, region)], variables: [] }));
    },

    async run({ db, change, pick: { customer, group, sku, value } }) {
        await db.modelImport(change);
        await db.updateCells([{ type: 'VARIABLE', formula: cell('Volume Override IN', { Customer: customer, SKU: sku, Versions: 'FC 6+6', Years: 'Y2026', Months: 'M7' }), value }]);

        return await db.rows('Volume', [], { 'Customer Group': group, Versions: 'FC 6+6', Years: 'Y2026', Months: 'M7' });
    },

    // The EBIT of the group's country, untimed.
    check: async ({ db, pick: { country } }) => ({ 'EBIT OUT': await db.rows('EBIT OUT', [], { Country: country, Versions: 'FC 6+6', Years: 'Y2026' }) }),

    teardown: ({ db }) => db.close(),
};
