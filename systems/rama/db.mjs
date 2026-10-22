// What the RAMA tests share, in plain RAMA calls: the addon, the database folder, opening it, putting it
// back to the snapshot, transactions, and reads. These are the calls the Farseer backend makes.
//
// RAMA recalculates the cells a write reaches when the write commits, so a write is visible as soon as
// commit returns. Commits are durable, as in the backend: commit forces the write to disk.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { splitCsv, readCsv } from '../../data/lib/csv.mjs';

export { readCsv };

const req = createRequire(import.meta.url);
const pkgDir = process.env.RAMA_PATH ? path.resolve(process.env.RAMA_PATH) : path.dirname(req.resolve('@farseer/rama/package.json'));
// The package loads its assertion-heavy dev binary unless told otherwise.
if (!process.env.RAMA_NODE_ADDON_BINARY) process.env.RAMA_NODE_ADDON_BINARY = path.join(pkgDir, 'rama.node');
export const rama = req(pkgDir);

/** What goes in the results about the system. */
export const system = {
    name: 'RAMA',
    version: JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version,
    settings: { binary: 'rama.node (release)', durableCommits: true, abakus: true, threads: 'default' },
};

/** The database folder of a work folder, and the snapshot L1 leaves next to it. */
export const dbOf = (work) => path.join(work, 'rama-db');
export const snapshotOf = (work) => path.join(work, 'rama-db.snapshot');

/** modelImport only adds and changes. It never deletes rows, tables, columns or variables. */
export const NO_DELETE = { rows: false, tables: false, columns: false, variables: false };

// A command id for each write transaction, and its checksum, as the backend gives them.
let commandId = 0;

/** A name in a RAMA formula, quoted. */
export const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** One dimension filter in a RAMA formula: one member, or any of several. */
const filter = (d, m) => (Array.isArray(m) ? (m.length === 1 ? `${q(d)}>${q(m[0])}` : `or(${m.map((x) => `${q(d)}>${q(x)}`).join(', ')})`) : `${q(d)}>${q(m)}`);

/** The RAMA formula for the sum of a variable over a slice, such as sum("Volume", "Country">"DE"). */
export const cell = (variable, where) => `sum(${[q(variable), ...Object.entries(where).map(([d, m]) => filter(d, m))].join(', ')})`;

/**
 * Opens a database folder. Returns { db, rw, ro, rows, gids, gid, close }.
 * rw(fn) runs fn(tx) in a write transaction and commits it to disk. ro(fn) runs fn(tx) in a read transaction.
 */
export function open(work) {
    const db = rama.openDB(dbOf(work));
    db.enableAbakus(true);
    return handles(db);
}

/** Creates an empty database folder, with RAMA's builtin dimensions. */
export function create(work) {
    rama.dropDB(dbOf(work));
    const db = rama.createDB(dbOf(work), true);
    db.enableAbakus(true);
    return handles(db);
}

function handles(db) {
    // Member gids and names per dimension, read from RAMA once per open. A member added later, as in M2,
    // is not in them, and no test reads one by name.
    const byName = new Map();
    const byGid = new Map();
    const dimension = (tx, d) => {
        if (!byName.has(d)) {
            const data = tx.dimensionByName(d).data(false, null);
            const gids = Array.from(data[1]);
            const names = Array.from(data[2]);
            byName.set(d, new Map(names.map((n, i) => [n, gids[i]])));
            byGid.set(d, new Map(gids.map((g, i) => [g, names[i]])));
        }
        return { byName: byName.get(d), byGid: byGid.get(d) };
    };
    const rw = (fn) => {
        const tx = db.beginRWTransaction(commandId + 1);
        let out;
        try {
            out = fn(tx);
        } catch (e) {
            tx.cancel();
            throw e;
        }
        tx.commit((++commandId).toString(16).padStart(64, '0'), true);
        return out;
    };
    const ro = (fn) => {
        const tx = db.beginROTransaction();
        try {
            return fn(tx);
        } finally {
            tx.finish();
        }
    };
    return {
        db,
        rw,
        ro,
        /** Member name -> gid, for one dimension. */
        gids: (d) => ro((tx) => dimension(tx, d).byName),
        /** The gid of a member, for the native cell import. */
        gid(tx, d, m) {
            const g = dimension(tx, d).byName.get(m);
            if (g === undefined) throw new Error(`no member ${m} in ${d}`);
            return g;
        },
        /**
         * Rows { key, value } of a stored variable summed over `by`, where the filters hold. RAMA lists the
         * combinations of `by` members that have a value (generateCombinations, what a Farseer sheet uses for
         * rows with data), and one query call reads them all.
         */
        rows(variable, by = [], where = {}) {
            const rest = Object.fromEntries(Object.entries(where).filter(([d]) => !by.includes(d)));
            return ro((tx) => {
                let combos = [{}];
                if (by.length) {
                    const found = tx.generateCombinations(by.map((d) => tx.dimensionByName(d).gid()), [], cell(variable, where), [], false);
                    const names = by.map((d) => dimension(tx, d).byGid);
                    combos = found.memberGids.map((g) => Object.fromEntries(by.map((d, i) => [d, names[i].get(g[i])])));
                }
                // The filters every combination shares are one named filter, defined once for the query call and
                // named in each formula, instead of written out in each (#32). RAMA parses that body once and
                // caches its result for every formula.
                const shared = Object.entries(rest).map(([d, m]) => filter(d, m));
                const named = shared.length ? [['shared', `and(${shared.join(', ')})`]] : [];
                const formula = (key) => `sum(${[q(variable), ...(shared.length ? ['shared'] : []), ...Object.entries(key).map(([d, m]) => filter(d, m))].join(', ')})`;
                const values = tx.query(named, combos.map((key) => ({ type: 'VARIABLE', formula: formula(key) })), []);
                const out = [];
                combos.forEach((key, i) => {
                    const v = values[i].value;
                    if (v !== null && v !== undefined) out.push({ key, value: v });
                });
                return out;
            });
        },
        close: () => db.close(),
    };
}

/** Puts the database folder back to the snapshot, without opening it. */
export function reset(work) {
    fs.rmSync(dbOf(work), { recursive: true, force: true });
    fs.cpSync(snapshotOf(work), dbOf(work), { recursive: true });
}

/** Puts the database folder back to the snapshot and opens it. */
export function restore(work) {
    reset(work);
    return open(work);
}

/**
 * Writes cells of read-only variables, such as IMPORT Unit Weight, through RAMA's native cell import, as a
 * data import in Farseer does. updateCells refuses them, as it refuses a user typing into a locked cell.
 * Each cell is { variable, at: { dim: member }, value }.
 */
export function importCells(db, tx, work, cells) {
    if (!cells.length) return;
    // Members go in the order RAMA keeps the variable's dimensions, which need not be the model's.
    const dimName = new Map(Array.from(tx.dimensions()).map((i) => [tx.dimensionByID(i).gid(), tx.dimensionByID(i).name()]));
    const lines = cells.map((c) => {
        const h = tx.variableByName(c.variable);
        const dims = Array.from(h.representation().tableGids).map((g) => dimName.get(g));
        return `${c.value},${h.gid()},${dims.map((d) => db.gid(tx, d, c.at[d])).join(':')}`;
    });
    const file = path.join(work, 'import.csv');
    fs.writeFileSync(file, lines.join('\n') + '\n');
    tx.importCellsFromCsvFile(file, true);
}

/** One of the JSON files in model/, made by model/lib/rama/generate.mjs from the model. It is the text modelImport takes. */
export const modelFile = (name) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'model', name), 'utf8');

/** Each line of a CSV file after the header, as fields. Calls fn(fields, header). The file is streamed. */
export async function eachLine(file, fn) {
    let header = null;
    for await (const line of readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })) {
        if (!line) continue;
        const fields = splitCsv(line);
        if (!header) header = fields;
        else fn(fields, header);
    }
}
