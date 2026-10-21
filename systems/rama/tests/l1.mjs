// L1 Initial load, on RAMA.
//
// Load the whole model and every input cell into an empty database. The model goes in through modelImport,
// as when Farseer pushes a model. The input cells go in through RAMA's native cell import, streamed from the
// cell files. Their commit calculates every formula they reach, as every write in RAMA does. Timed until EBIT in euros can be read for every
// country, version, year and month, and the files are on disk. The database after the last load is the
// snapshot every other test starts from.

import fs from 'node:fs';
import path from 'node:path';
import { create, dbOf, snapshotOf, NO_DELETE, modelFile, eachLine, readCsv } from '../db.mjs';

// The JSON this test sends, read once when the file loads, so no file read is timed.
const MODEL = modelFile('model.json');
const CHECKS = JSON.parse(MODEL).variables.filter((v) => v.name.startsWith('CHECK ') && v.formula);

export default {
    // No database yet: the load starts from an empty folder.
    async setup(context) {
        fs.rmSync(dbOf(context.work), { recursive: true, force: true });
    },

    async run(context) {
        const { work, cells } = context;

        // 1. Create the database, with RAMA's built-in Versions, Years and Months.
        const db = create(work);
        context.db = db;

        // 2. Import the model in one modelImport, as when Farseer pushes a model. model/model.json holds every
        // dimension table with the members the model brings, Versions and Years included, and every variable
        // and formula. The data's own members, such as customers, are added from its dimensions/ files, each
        // with its parents. An empty parent is the parent's NULL member.
        const model = JSON.parse(MODEL);
        for (const table of model.tables) {
            const file = path.join(cells.base, 'dimensions', `${table.name}.csv`);
            if (!fs.existsSync(file) || table.name === 'Versions' || table.name === 'Years') continue;
            const parents = table.columns.filter((c) => c.type === 'FOREIGN_KEY').map((c) => c.foreignKeyTableName);
            for (const r of readCsv(file)) table.rows.push([r[table.name], ...parents.map((p) => [r[p] || `NULL (${p})`])]);
        }
        db.rw((tx) => tx.modelImport(JSON.stringify(model), { dryRun: false, deleteEnabled: NO_DELETE }));

        // 3. Import the input cells, one file per input variable. RAMA's CSV holds value, variable gid and member
        // gids, in the order RAMA keeps the variable's dimensions. The cell files are streamed into it.
        const file = path.join(work, 'import.csv');
        const fd = fs.openSync(file, 'w');
        let buf = '';
        for (const name of fs.readdirSync(path.join(cells.base, 'cells')).sort()) {
            const variable = name.slice(0, -'.csv'.length);
            const { gid, dims } = db.ro((tx) => {
                const h = tx.variableByName(variable);
                const dimName = new Map(Array.from(tx.dimensions()).map((i) => [tx.dimensionByID(i).gid(), tx.dimensionByID(i).name()]));
                return { gid: h.gid(), dims: Array.from(h.representation().tableGids).map((g) => dimName.get(g)) };
            });
            const gids = dims.map((d) => db.gids(d));
            let at = null;
            let value = 0;
            await eachLine(path.join(cells.base, 'cells', name), (f, header) => {
                if (!at) {
                    at = dims.map((d) => header.indexOf(d));
                    value = header.indexOf('value');
                }
                const key = dims.map((d, i) => {
                    const g = gids[i].get(f[at[i]]);
                    if (g === undefined) throw new Error(`a cell of "${variable}" names ${f[at[i]]}, which ${d} does not have`);
                    return g;
                });
                buf += `${f[value]},${gid},${key.join(':')}\n`;
                if (buf.length > 1 << 20) {
                    fs.writeSync(fd, buf);
                    buf = '';
                }
            });
        }
        fs.writeSync(fd, buf);
        fs.closeSync(fd);
        // overwrite = false: a second row for a cell already loaded throws, so a repeat fails instead of loading wrong.
        // The commit calculates every cell the input cells reach, which is the whole model. A recalc() after it
        // would calculate the whole model again: at 100m that took the load from 28 s to 40 s, with the same answers.
        db.rw((tx) => tx.importCellsFromCsvFile(file, false));
        fs.rmSync(file, { force: true });

        // 4. Read EBIT in euros for every country, version, year and month.
        return db.rows('EBIT EUR OUT', ['Country', 'Versions', 'Years', 'Months']);
    },

    // The invariants of the loaded model, untimed. Every row they return must be 0.
    async check({ db }) {
        const zero = {};
        const all4 = ['Country', 'Versions', 'Years', 'Months'];
        const keyOf = (k) => JSON.stringify(k);
        // Each key of `plus` minus the same key of each of `minus`. A missing row counts as 0.
        const difference = (plus, ...minus) => {
            const out = new Map(plus.map((r) => [keyOf(r.key), { key: r.key, value: r.value }]));
            for (const rows of minus) {
                for (const r of rows) {
                    const k = keyOf(r.key);
                    if (!out.has(k)) out.set(k, { key: r.key, value: 0 });
                    out.get(k).value -= r.value;
                }
            }
            return [...out.values()];
        };
        // Every CHECK variable is 0 in every stored cell.
        for (const v of CHECKS) {
            zero[v.name] = db.ro((tx) => {
                const h = tx.variableByName(v.name);
                let total = 0;
                for (const r of h.rows()) total += Math.abs(h.row(r)[0] ?? 0);
                return [{ key: {}, value: total }];
            });
        }
        // The P&L adds up to EBIT, per country, version, year and month.
        zero['PL OUT - EBIT OUT'] = difference(db.rows('PL OUT', all4), db.rows('EBIT OUT', all4));
        // Every allocation pool is spread in full: pool = allocated cost + unallocated, per country, version and year.
        const by = ['Country', 'Versions', 'Years'];
        for (const [pool, cost, rest] of [
            ['Trade Fees Pool', 'Trade Fees', 'Trade Fees Unallocated'],
            ['Logistics Pool', 'Logistics Cost', 'Logistics Unallocated'],
            ['Sales Force Pool', 'Sales Force Cost', 'Sales Force Unallocated'],
            ['Marketing Pool', 'Marketing Cost', 'Marketing Unallocated'],
        ]) {
            zero[`${pool} - ${cost} - ${rest}`] = difference(db.rows(pool, by), db.rows(cost, by), db.rows(rest, by));
        }
        // Closed months hold the actuals: Volume, Gross Sales and COGS equal their ACT, where FC Actual is 1.
        const closed = db.rows('FC Actual', ['Versions', 'Years', 'Months']).filter((r) => r.value === 1);
        for (const [merged, actual] of [
            ['Volume', 'Volume ACT'],
            ['Gross Sales', 'Gross Sales ACT'],
            ['COGS', 'COGS ACT'],
        ]) {
            const acts = new Map(db.rows(actual, ['Country', 'Years', 'Months']).map((r) => [keyOf([r.key.Country, r.key.Years, r.key.Months]), r.value]));
            const rows = [];
            for (const r of db.rows(merged, all4)) {
                if (!closed.some((f) => f.key.Versions === r.key.Versions && f.key.Years === r.key.Years && f.key.Months === r.key.Months)) continue;
                rows.push({ key: r.key, value: r.value - (acts.get(keyOf([r.key.Country, r.key.Years, r.key.Months])) ?? 0) });
            }
            zero[`${merged} - ${actual}`] = rows;
        }
        return zero;
    },

    // The database after the last load is the snapshot.
    async teardown({ db, work, failed }) {
        db?.close();
        if (failed) return;
        fs.rmSync(snapshotOf(work), { recursive: true, force: true });
        fs.cpSync(dbOf(work), snapshotOf(work), { recursive: true });
    },
};
