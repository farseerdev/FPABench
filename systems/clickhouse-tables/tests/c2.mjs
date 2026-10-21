// C2 All checks, on ClickHouse. Untimed.
//
// Every CHECK variable of the model is 0 in every cell of the snapshot. Returns each cell that is not 0, so
// errors of opposite sign cannot cancel out in a total.

import { restore } from '../db.mjs';

export default {
    async setup(context) {
        context.db = await restore(context.work);
    },

    async run({ db }) {
        const out = [];
        const tables = (await db.rows(`SELECT name AS t FROM system.tables WHERE database = currentDatabase() AND name LIKE 'CHECK %'`)).map((r) => r.t);
        for (const name of tables) {
            const rows = await db.rows(`SELECT v FROM "${name}" WHERE v <> 0`);
            for (const [k, r] of rows.entries()) out.push({ key: { check: name, row: String(k) }, value: r.v });
        }
        return out;
    },

    teardown: ({ db }) => db.close(),
};
