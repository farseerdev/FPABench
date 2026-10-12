// RAMA, Farseer's engine, through its Node addon. These are the calls the Farseer backend makes:
// modelImport to load a model and its cells, updateCells and commit to write, query to read.
//
// RAMA recalculates the cells a write reaches when the write commits, so a write is visible as soon
// as commit returns. Commits are durable, as in the backend: commit forces the write to disk.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildPayload, variablePayload, tablePayload, readCells } from './payload.mjs';
import { MONTHS } from '../../runner/lib/model.mjs';

const NO_DELETE = { rows: false, tables: false, columns: false, variables: false };
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function loadAddon() {
    const req = createRequire(import.meta.url);
    const pkgDir = process.env.RAMA_PATH ? path.resolve(process.env.RAMA_PATH) : path.dirname(req.resolve('@farseer/rama/package.json'));
    // The package loads its assertion-heavy dev binary unless told otherwise.
    if (!process.env.RAMA_NODE_ADDON_BINARY) process.env.RAMA_NODE_ADDON_BINARY = path.join(pkgDir, 'rama.node');
    const rama = req(pkgDir);
    const version = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
    return { rama, version };
}

export async function create({ work, model }) {
    const { rama, version } = loadAddon();
    const dbPath = path.join(work, 'rama-db');
    let db = null;
    let commandId = 0;
    const checksum = () => (++commandId).toString(16).padStart(64, '0');

    const rw = (fn) => {
        const tx = db.beginRWTransaction(commandId + 1);
        let out;
        try {
            out = fn(tx);
        } catch (e) {
            tx.cancel();
            throw e;
        }
        tx.commit(checksum(), true);
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

    // A filter for one dimension: one member, or any of several.
    const filter = (d, m) => (Array.isArray(m) ? (m.length === 1 ? `${q(d)}>${q(m[0])}` : `or(${m.map((x) => `${q(d)}>${q(x)}`).join(', ')})`) : `${q(d)}>${q(m)}`);
    const cellFormula = (variable, at) => `sum(${[q(variable), ...Object.entries(at).map(([d, m]) => filter(d, m))].join(', ')})`;

    // Gids for the native cell import: one map of member name to gid per dimension.
    let gids = new Map();
    const memberGid = (tx, d, m) => {
        if (!gids.has(d)) {
            const data = tx.dimensionByName(d).data(false, null);
            const names = Array.from(data[2]);
            const g = Array.from(data[1]);
            gids.set(d, new Map(names.map((n, i) => [n, g[i]])));
        }
        const gid = gids.get(d).get(m);
        if (gid === undefined) throw new Error(`no member ${m} in ${d}`);
        return gid;
    };
    // The other way round: member gid to name, per dimension.
    let names = new Map();
    const memberNames = (tx, d) => {
        if (!names.has(d)) {
            const data = tx.dimensionByName(d).data(false, null);
            const g = Array.from(data[1]);
            names.set(d, new Map(Array.from(data[2]).map((n, i) => [g[i], n])));
        }
        return names.get(d);
    };
    // Cells of read-only variables (the IMPORT ones) go in through RAMA's native cell import, as a data
    // import in Farseer does. updateCells refuses them, as it refuses a user typing into a locked cell.
    function importCells(tx, cells) {
        if (!cells.length) return;
        const file = path.join(work, 'import.csv');
        // Members go in the order RAMA keeps the variable's dimensions, which need not be the model's.
        const dimName = new Map(Array.from(tx.dimensions()).map((i) => [tx.dimensionByID(i).gid(), tx.dimensionByID(i).name()]));
        const layout = new Map();
        const lines = cells.map((c) => {
            if (!layout.has(c.variable)) {
                const h = tx.variableByName(c.variable);
                layout.set(c.variable, { gid: h.gid(), dims: Array.from(h.representation().tableGids).map((g) => dimName.get(g)) });
            }
            const { gid, dims } = layout.get(c.variable);
            return `${c.value},${gid},${dims.map((d) => memberGid(tx, d, c.at[d])).join(':')}`;
        });
        fs.writeFileSync(file, lines.join('\n') + '\n');
        tx.importCellsFromCsvFile(file, true);
    }
    const isLocked = (c) => model.variable(c.variable).props.readonly === true;
    function writeCells(tx, cells) {
        importCells(tx, cells.filter(isLocked));
        const typed = cells.filter((c) => !isLocked(c));
        if (typed.length) tx.updateCells([], typed.map((c) => ({ type: 'VARIABLE', formula: cellFormula(c.variable, c.at), value: c.value })), [], false);
    }

    // Members of `by` dimensions that a read must ask for, given its filters.
    function candidates(d, where, system) {
        if (where[d] !== undefined) return [].concat(where[d]);
        let list = system[d] ?? [...model.members.get(d).keys()];
        for (const [w, m] of Object.entries(where)) {
            if (!model.isAncestor(w, d)) continue;
            const want = new Set([].concat(m));
            list = list.filter((x) => want.has(model.above(d, x, w)));
        }
        return list;
    }

    const adapter = {
        name: 'RAMA',
        version,
        settings: { binary: 'rama.node (release)', durableCommits: true, abakus: true, threads: 'default' },
        system: null,

        async load(cellsDir) {
            gids = new Map();
            names = new Map();
            const payload = await buildPayload(model, path.join(cellsDir, 'cells.csv'));
            adapter.system = { Versions: payload.versions, Years: payload.years, Months: MONTHS };
            fs.mkdirSync(work, { recursive: true });
            fs.writeFileSync(path.join(work, 'system.json'), JSON.stringify(adapter.system));
            rama.dropDB(dbPath);
            db = rama.createDB(dbPath, true);
            db.enableAbakus(true);
            // RAMA seeds Versions Plan and Actual and Years Y2023 to Y2025. Keep exactly the data's own.
            rw((tx) => {
                for (const [dim, want] of Object.entries({ Versions: payload.versions, Years: payload.years })) {
                    const t = tx.dimensionByName(dim);
                    const data = t.data(false, null);
                    const names = Array.from(data[2]);
                    const gids = Array.from(data[1]);
                    const extra = want.filter((m) => !names.includes(m));
                    if (extra.length) tx.modelImport(JSON.stringify({ tables: [{ name: dim, columns: [{ type: 'PRIMARY_KEY' }], rows: extra.map((m) => [m]) }], variables: [] }), { dryRun: false, deleteEnabled: NO_DELETE });
                    const drop = names.filter((m) => !want.includes(m));
                    if (drop.length) tx.dimensionByName(dim).deleteDMembers(drop.map((m) => gids[names.indexOf(m)]));
                }
            });
            rw((tx) => tx.modelImport(JSON.stringify({ tables: payload.tables, variables: [] }), { dryRun: false, deleteEnabled: NO_DELETE }));
            rw((tx) => tx.modelImport(JSON.stringify({ tables: [], variables: payload.variables }), { dryRun: false, deleteEnabled: NO_DELETE }));
            rw((tx) => tx.recalc());
        },

        async open() {
            gids = new Map();
            names = new Map();
            if (!db) {
            if (!adapter.system) adapter.system = JSON.parse(fs.readFileSync(path.join(work, 'system.json'), 'utf8'));
                db = rama.openDB(dbPath);
                db.enableAbakus(true);
            }
        },
        async close() {
            if (db) db.close();
            db = null;
        },
        dataDirs: () => [dbPath],

        /** Rows { key: { dim: member }, value } of `variable` summed (or averaged, by its rollup) over `by`. */
        /**
         * Rows { key, value } of `variable` summed (or averaged, by its rollup) over `by`. RAMA lists the
         * combinations of `by` members that have a value (generateCombinations, what a Farseer sheet uses for
         * rows with data), and one query call reads them. A measure has no stored cells to list, so a measure
         * read asks for every combination the filters allow.
         */
        async read({ variable, by = [], where = {} }) {
            const rest = Object.fromEntries(Object.entries(where).filter(([d]) => !by.includes(d)));
            return ro((tx) => {
                let combos;
                if (by.length && !model.variable(variable).measure) {
                    const found = tx.generateCombinations(by.map((d) => tx.dimensionByName(d).gid()), [], cellFormula(variable, where), [], false);
                    const names = by.map((d) => memberNames(tx, d));
                    combos = found.memberGids.map((g) => Object.fromEntries(by.map((d, i) => [d, names[i].get(g[i])])));
                } else {
                    const lists = by.map((d) => candidates(d, where, adapter.system));
                    combos = [];
                    const walk = (i, key) => {
                        if (i === by.length) return combos.push({ ...key });
                        for (const m of lists[i]) walk(i + 1, { ...key, [by[i]]: m });
                    };
                    walk(0, {});
                }
                const values = tx.query([], combos.map((key) => ({ type: 'VARIABLE', formula: cellFormula(variable, { ...rest, ...key }) })), []);
                const rows = [];
                combos.forEach((key, i) => {
                    const v = values[i].value;
                    if (v !== null && v !== undefined) rows.push({ key, value: v });
                });
                return rows;
            });
        },

        /** Every stored cell of a variable, as rows { key, value }. For checks, not timed. */
        async cells(variable) {
            const v = model.variable(variable);
            return ro((tx) => {
                const dims = new Map();
                for (const i of Array.from(tx.dimensions())) {
                    const d = tx.dimensionByID(i);
                    const data = d.data(false, null);
                    const ids = Array.from(data[0]);
                    const names = Array.from(data[2]);
                    dims.set(d.gid(), { name: d.name(), members: new Map(ids.map((x, k) => [x, names[k]])) });
                }
                const h = tx.variableByName(v.name);
                const layout = Array.from(h.representation().tableGids).map((g) => dims.get(g));
                const buf = new Uint32Array(layout.length);
                const out = [];
                for (const r of h.rows()) {
                    const row = h.row(r);
                    h.members(r, buf);
                    const key = { ...v.pins };
                    layout.forEach((d, k) => (key[d.name] = d.members.get(buf[k])));
                    out.push({ key, value: row[0] });
                }
                return out;
            });
        },

        /** Writes cells in one transaction. Each cell is { variable, at: { dim: member }, value }. value null deletes. */
        async write(cells) {
            rw((tx) => writeCells(tx, cells));
        },

        /** Loads a file of input cells (data/cells.mjs output) on top of what is there, and `cells` with it. */
        async loadCells(cellsDir, { cells: extra = [] } = {}) {
            const { cells } = await readCells(model, path.join(cellsDir, 'cells.csv'));
            const list = [];
            for (const [name, byKey] of cells) {
                const v = model.variable(name);
                for (const c of byKey.values()) list.push({ variable: name, at: Object.fromEntries(v.open.map((d, i) => [d, c.members[i]])), value: c.value });
            }
            rw((tx) => writeCells(tx, [...list, ...extra]));
        },

        setModel(next) {
            model = next;
        },

        /** New or changed members (model.members must already hold them), then changed or new variables. */
        async changeModel({ model: next, members = [], variables = [], cells = [] }) {
            if (next) model = next;
            rw((tx) => {
                if (members.length) {
                    const byDim = new Map();
                    for (const { dim, name } of members) {
                        if (!byDim.has(dim)) byDim.set(dim, new Set());
                        byDim.get(dim).add(name);
                    }
                    tx.modelImport(JSON.stringify({ tables: [...byDim].map(([d, names]) => tablePayload(model, d, names)), variables: [] }), { dryRun: false, deleteEnabled: NO_DELETE });
                }
                if (variables.length) tx.modelImport(JSON.stringify({ tables: [], variables: variables.map((v) => ({ ...variablePayload(v), cells: undefined })) }), { dryRun: false, deleteEnabled: NO_DELETE });
                gids = new Map();
                names = new Map();
                if (cells.length) writeCells(tx, cells);
                if (variables.length) tx.recalc();
            });
        },
    };
    return adapter;
}
