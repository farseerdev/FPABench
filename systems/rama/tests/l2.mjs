// L2 Monthly close, on RAMA.
//
// Load the actuals of Y2026 M7 on top of the snapshot, then close M7 in the Actual version. Every file of the
// increment is an IMPORT variable, which is read-only, so its cells go in through RAMA's native cell import,
// as a data import in Farseer does. The two flags are typed with updateCells. Both commit in one
// transaction. Timed until EBIT of Actual Y2026 M7 can be read by country, and the files are on disk.

import fs from 'node:fs';
import path from 'node:path';
import { restore, cell, eachLine } from '../db.mjs';

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    async run({ db, work, cells, pick }) {
        // RAMA's CSV of the increment: value, variable gid and member gids, in the order RAMA keeps the
        // variable's dimensions. One file at a time: its cells are summed by their gids, two rows for one cell
        // adding up, and written out, so only one variable's cells are held at once.
        const file = path.join(work, 'import.csv');
        const fd = fs.openSync(file, 'w');
        for (const name of fs.readdirSync(path.join(cells.close, 'cells')).sort()) {
            const variable = name.slice(0, -'.csv'.length);
            const { gid, dims } = db.ro((tx) => {
                const h = tx.variableByName(variable);
                const dimName = new Map(Array.from(tx.dimensions()).map((i) => [tx.dimensionByID(i).gid(), tx.dimensionByID(i).name()]));
                return { gid: h.gid(), dims: Array.from(h.representation().tableGids).map((g) => dimName.get(g)) };
            });
            const gids = dims.map((d) => db.gids(d));
            const sums = new Map();
            let at = null;
            let value = 0;
            await eachLine(path.join(cells.close, 'cells', name), (f, header) => {
                if (!at) {
                    at = dims.map((d) => header.indexOf(d));
                    value = header.indexOf('value');
                }
                const key = dims
                    .map((d, i) => {
                        const g = gids[i].get(f[at[i]]);
                        if (g === undefined) throw new Error(`a cell of "${variable}" names ${f[at[i]]}, which ${d} does not have`);
                        return g;
                    })
                    .join(':');
                sums.set(key, (sums.get(key) ?? 0) + Number(f[value]));
            });
            let buf = '';
            for (const [key, v] of sums) {
                buf += `${v},${gid},${key}\n`;
                if (buf.length > 1 << 20) {
                    fs.writeSync(fd, buf);
                    buf = '';
                }
            }
            fs.writeSync(fd, buf);
        }
        fs.closeSync(fd);
        // overwrite = true: a July cell replaces the value already there. The flags go in the same transaction.
        db.rw((tx) => {
            tx.importCellsFromCsvFile(file, true);
            tx.updateCells([], pick.flags.map((f) => ({ type: 'VARIABLE', formula: cell(f.variable, f.at), value: f.value })), [], false);
        });
        fs.rmSync(file, { force: true });

        return db.rows('EBIT OUT', ['Country'], { Versions: 'Actual', Years: 'Y2026', Months: 'M7' });
    },

    // The import control totals of M7, by country, untimed.
    check: ({ db }) => ({ 'CHECK Import Total by country': db.rows('CHECK Import Total', ['Country'], { Years: 'Y2026', Months: 'M7' }) }),

    teardown: ({ db }) => db.close(),
};
