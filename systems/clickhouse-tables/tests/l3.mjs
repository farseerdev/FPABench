// L3 Change a weight in master data, on ClickHouse.
//
// One SKU's unit weight, an imported master data value, goes up by a quarter. The new weight is a newer
// version of its row in the input table, and every calculated table it reaches is built again. Timed until
// the brand's logistics cost can be read by country, and the data is on disk.

import { restore, members, rebuild, now } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const REBUILD = rebuild('IMPORT Unit Weight');

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m, pick }) {
        await db.run(`INSERT INTO "IMPORT Unit Weight" ("SKU", v, ver, is_deleted) VALUES (${m.id('SKU', pick.sku)}, ${pick.value}, ${now}, 0)`);
        await db.run(REBUILD);

        const rows = await db.rows(`
            SELECT f."Country" AS c, sum(s.v) AS total FROM "Logistics Cost" s JOIN "flat Customer" f ON f."Customer" = s."Customer"
            WHERE s."Brand" = ${m.id('Brand', pick.brand)} AND s."Versions" = ${m.id('Versions', 'FC 6+6')} AND s."Years" = ${m.id('Years', 'Y2026')}
            GROUP BY f."Country"`);
        return rows.filter((r) => r.total !== null).map((r) => ({ key: { Country: m.name('Country', r.c) }, value: r.total }));
    },

    // EBIT by country and month, untimed. A weight moves costs between customers, never the total.
    async check({ db, m }) {
        const rows = await db.rows(`SELECT "Country" AS c, "Versions" AS ver, "Years" AS y, "Months" AS mo, sum(v) AS total FROM "EBIT OUT" GROUP BY ALL`);
        return {
            'EBIT OUT by country and month': rows
                .filter((r) => r.total !== null)
                .map((r) => ({ key: { Country: m.name('Country', r.c), Versions: m.name('Versions', r.ver), Years: m.name('Years', r.y), Months: m.name('Months', r.mo) }, value: r.total })),
        };
    },

    teardown: ({ db }) => db.close(),
};
