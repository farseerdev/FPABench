// L2 Monthly close, on RAMA.
//
// Load the actuals of Y2026 M7 on top of the snapshot, then close M7 in the Actual version. Every file of the
// increment is an IMPORT variable, which is read-only, so its cells go in through RAMA's native cell import,
// as a data import in Farseer does. The two flags are typed with updateCells. Both commit in one
// transaction. Timed until EBIT of Actual Y2026 M7 can be read by country, and the files are on disk.

import fs from 'node:fs';
import path from 'node:path';
import { restore, cell, importCells, eachLine } from '../db.mjs';

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    async run({ db, work, cells, pick }) {
        // The increment's cells, one file per variable, with two rows for one cell added up.
        const list = [];
        for (const name of fs.readdirSync(path.join(cells.close, 'cells')).sort()) {
            const byKey = new Map();
            await eachLine(path.join(cells.close, 'cells', name), (f, header) => {
                const key = f.slice(0, -1).join(',');
                const prev = byKey.get(key);
                const at = Object.fromEntries(header.slice(0, -1).map((d, i) => [d, f[i]]));
                byKey.set(key, { variable: name.slice(0, -'.csv'.length), at, value: (prev?.value ?? 0) + Number(f[f.length - 1]) });
            });
            // One at a time: at 1b a file has hundreds of thousands of cells, too many to pass to push at once.
            for (const c of byKey.values()) list.push(c);
        }
        db.rw((tx) => {
            importCells(db, tx, work, list);
            tx.updateCells([], pick.flags.map((f) => ({ type: 'VARIABLE', formula: cell(f.variable, f.at), value: f.value })), [], false);
        });

        return db.rows('EBIT OUT', ['Country'], { Versions: 'Actual', Years: 'Y2026', Months: 'M7' });
    },

    // The import control totals of M7, by country, untimed.
    check: ({ db }) => ({ 'CHECK Import Total by country': db.rows('CHECK Import Total', ['Country'], { Years: 'Y2026', Months: 'M7' }) }),

    teardown: ({ db }) => db.close(),
};
