// L3 Change a weight in master data, on RAMA.
//
// One SKU's unit weight, an imported master data value, goes up by a quarter. IMPORT Unit Weight is
// read-only, so the new weight goes in through RAMA's native cell import. The commit recalculates every cell
// it reaches. Timed until the brand's logistics cost can be read by country, and the files are on disk.

import { restore, importCells } from '../db.mjs';

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    async run({ db, work, pick }) {
        db.rw((tx) => importCells(db, tx, work, [{ variable: 'IMPORT Unit Weight', at: { SKU: pick.sku }, value: pick.value }]));

        return db.rows('Logistics Cost', ['Country'], { Brand: pick.brand, Versions: 'FC 6+6', Years: 'Y2026' });
    },

    // EBIT by country and month, untimed. A weight moves costs between customers, never the total.
    check: ({ db }) => ({ 'EBIT OUT by country and month': db.rows('EBIT OUT', ['Country', 'Versions', 'Years', 'Months']) }),

    teardown: ({ db }) => db.close(),
};
