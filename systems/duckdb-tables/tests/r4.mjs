// R4 Ratios, on DuckDB.
//
// Every KPI measure of the report, such as gross margin %, by country and version for the plan year. A
// measure has no table: sql/reads/R4.sql computes each one from the sums it needs, in one query.
// Setup puts the database back to the snapshot, builds every calculated table and reads the member ids.
// Each run reads by id, and turns the ids into names.

import { restore, members, sqlFile } from '../db.mjs';

// The SQL this test runs, read once when the file loads, so no file read is timed.
const QUERY = sqlFile('reads/R4.sql');

export default {
    async setup(context) {
        context.db = await restore(context.work);
        context.m = await members(context.db);
    },

    async run({ db, m }) {
        const rows = await db.rows(QUERY);
        return rows.map((r) => ({ key: { Country: m.name('Country', r.Country), Versions: m.name('Versions', r.Versions), measure: r.measure }, value: r.v }));
    },

    teardown: ({ db }) => db.close(),
};
