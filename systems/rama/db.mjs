// What the RAMA tests share: the addon, the database folder, opening it, putting it back to the snapshot,
// and the commands. Every call on a database is one command: the JSON body the Farseer backend sends, run
// through Database.runCommand, which is the entry newer RAMA builds have.
//
// A write command runs in a transaction of its own. RAMA recalculates the cells the write reaches and commits
// to disk before the command answers, so a write is visible, and durable, as soon as it returns.
//
// The tests only use what session() returns, and session() only needs a function that runs one command body.
// Another way to reach RAMA, such as a server, needs another such function and nothing else.

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

/** A model import only adds and changes. It never deletes rows, tables, columns or variables. */
export const NO_DELETE = { rows: false, tables: false, columns: false, variables: false };

// A command id for each write command, and its checksum, as the backend gives them.
let commandId = 0;

/** A name in a RAMA formula, quoted. */
export const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** One dimension filter in a RAMA formula: one member, or any of several. */
const filter = (d, m) => (Array.isArray(m) ? (m.length === 1 ? `${q(d)}>${q(m[0])}` : `or(${m.map((x) => `${q(d)}>${q(x)}`).join(', ')})`) : `${q(d)}>${q(m)}`);

/** The RAMA formula for the sum of a variable over a slice, such as sum("Volume", "Country">"DE"). */
export const cell = (variable, where) => `sum(${[q(variable), ...Object.entries(where).map(([d, m]) => filter(d, m))].join(', ')})`;

/** A file path as a command body takes it: with forward slashes. */
const wirePath = (file) => file.replace(/\\/g, '/');

/** Opens a database folder. Returns what session() returns. */
export function open(work) {
    return session(...addon(rama.openDB(dbOf(work))));
}

/** Creates an empty database folder, with RAMA's builtin dimensions. */
export function create(work) {
    rama.dropDB(dbOf(work));
    return session(...addon(rama.createDB(dbOf(work), true)));
}

/**
 * RAMA in process, through the Node addon: a function that runs one command body and gives its answer, and
 * one that closes the database.
 */
function addon(db) {
    const send = async (body) => {
        const outcome = await db.runCommand(Buffer.from(JSON.stringify(body), 'utf8'));
        if (outcome.status !== 'executed') throw new Error(`${body.type} was not executed: ${outcome.status}`);
        const bytes = Buffer.from(outcome.result.buffer, outcome.result.byteOffset, outcome.result.byteLength);
        if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0xfd2fb528) throw new Error(`${body.type} answered compressed, which this entry never asks for`);
        return bytes.length ? JSON.parse(bytes.toString('utf8')) : {};
    };
    return [send, () => db.close()];
}

/**
 * The calls the tests make, over `send`, which runs one command body and gives its answer.
 * Returns { read, write, modelImport, importCsv, updateCells, evaluate, rows, storedValues, variable, gids,
 * memberNames, close }.
 */
function session(send, close) {
    /** Runs a read command and gives its data. */
    const read = async (body) => (await send(body)).data;
    /** Runs a write command, with the next command id. It has committed to disk when it returns. */
    const write = (body) => {
        const id = ++commandId;
        return send({ ...body, commandId: id, commandChecksumHex: id.toString(16).padStart(64, '0') });
    };

    // The tables, the variables, and the member gids and names per dimension, read from RAMA once per open, when
    // first needed. A member added later, as in M2, is not in them, and no test reads one by name.
    let tables = null;
    let variables = null;
    const members = new Map();
    const allTables = async () => (tables ??= new Map((await read({ type: 'GET_DTABLES', gids: null, includeMembers: false, columnIds: null })).map((t) => [t.name, t])));
    const table = async (d) => {
        const t = (await allTables()).get(d);
        if (!t) throw new Error(`no dimension ${d}`);
        return t;
    };
    /** The member gids and names of a dimension, in RAMA's order, read now. */
    const readMembers = async (d) => {
        const t = await table(d);
        const column = (name) => t.columns.find((c) => c.name === name).id;
        const [got] = await read({ type: 'GET_DTABLES', gids: [t.gid], includeMembers: true, columnIds: [column('gid'), column('name')] });
        const at = (name) => got.data[got.columns.findIndex((c) => c.name === name)];
        return { gids: at('gid'), names: at('name') };
    };
    const dimension = async (d) => {
        if (!members.has(d)) {
            const { gids, names } = await readMembers(d);
            members.set(d, { byName: new Map(names.map((n, i) => [n, gids[i]])), byGid: new Map(gids.map((g, i) => [g, names[i]])) });
        }
        return members.get(d);
    };
    /** A variable: its gid, the names of its dimensions in the order RAMA keeps them, and whether it is a measure. */
    const variable = async (name) => {
        if (!variables) {
            const gidName = new Map([...(await allTables()).values()].map((t) => [t.gid, t.name]));
            variables = new Map((await read({ type: 'GET_VARIABLES', gids: null })).map((v) => [v.name, { gid: v.gid, dims: v.tableGids.map((g) => gidName.get(g)), measure: v.measure }]));
        }
        const v = variables.get(name);
        if (!v) throw new Error(`no variable ${name}`);
        return v;
    };

    return {
        read,
        write,
        variable,
        /** Member name -> gid, for one dimension. */
        gids: async (d) => (await dimension(d)).byName,
        /** The names of a dimension's members, read from RAMA now. */
        memberNames: async (d) => (await readMembers(d)).names,
        /**
         * Imports a model, or a change to one, from a JSON file, as when Farseer pushes a model. The command names
         * its file by path, so the JSON is a file before the command runs.
         */
        modelImport: (file) => write({ type: 'MODEL_IMPORT', localFilePath: wirePath(file), options: { dryRun: false, deleteEnabled: NO_DELETE } }),
        /** Imports cells from a file in RAMA's CSV: value, variable gid and member gids. The native cell import. */
        importCsv: (file, overwrite) => write({ type: 'IMPORT_CELLS', localFilePath: wirePath(file), overwrite }),
        /** Writes cells, as when a user types into a Farseer sheet. Each update is { type: 'VARIABLE', formula, value }. */
        updateCells: (cellUpdates) => write({ type: 'UPDATE_CELLS', filters: [], cellUpdates, locks: [] }),
        /** The values of formulas, in one EVALUATE command. `named` holds [name, filter] pairs the formulas may name. */
        evaluate: async (formulas, named = []) => (await read({ type: 'EVALUATE', filters: named, queries: formulas.map((formula) => ({ type: 'VARIABLE', formula })), locks: [] })).map((r) => r.value),
        /**
         * Rows { key, value } of a stored variable summed over `by`, where the filters hold. With `by`, one
         * GROUPED_READ command gives the groups of `by` members that have a value, each folded by the variable's
         * rollup in one scan. Without `by`, one EVALUATE command reads the one cell.
         */
        async rows(name, by = [], where = {}) {
            if (by.length) {
                const groupTableGids = [];
                const names = [];
                for (const d of by) {
                    groupTableGids.push((await table(d)).gid);
                    names.push((await dimension(d)).byGid);
                }
                const { memberGids, values } = await read({ type: 'GROUPED_READ', groupTableGids, formulas: [cell(name, where)], filters: [] });
                const out = [];
                memberGids.forEach((g, i) => {
                    const v = values[0][i];
                    if (v !== null && v !== undefined) out.push({ key: Object.fromEntries(by.map((d, j) => [d, names[j].get(g[j])])), value: v });
                });
                return out;
            }
            // The filters are one named filter, defined once for the command and named in the formula.
            const shared = Object.entries(where).map(([d, m]) => filter(d, m));
            const named = shared.length ? [['shared', `and(${shared.join(', ')})`]] : [];
            const formula = `sum(${[q(name), ...(shared.length ? ['shared'] : [])].join(', ')})`;
            const [value] = await this.evaluate([formula], named);
            return value !== null && value !== undefined ? [{ key: {}, value }] : [];
        },
        /**
         * The value of every stored cell of a variable, for the untimed checks. EXPORT_CELLS writes the cells to
         * a CSV file with the value first, which is read line by line. A measure has no stored cells.
         */
        async storedValues(name) {
            if ((await variable(name)).measure) return [];
            const { filePath } = await read({ type: 'EXPORT_CELLS', formula: q(name), filters: [], tableGids: [], offset: 0, limit: 0 });
            const values = [];
            await eachLine(filePath, (fields) => values.push(fields[0] === '' ? null : Number(fields[0])));
            fs.rmSync(filePath, { force: true });
            return values;
        },
        close,
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
 * data import in Farseer does. UPDATE_CELLS refuses them, as it refuses a user typing into a locked cell.
 * Each cell is { variable, at: { dim: member }, value }.
 */
export async function importCells(db, work, cells) {
    if (!cells.length) return;
    // Members go in the order RAMA keeps the variable's dimensions, which need not be the model's.
    const lines = [];
    for (const c of cells) {
        const { gid, dims } = await db.variable(c.variable);
        const key = [];
        for (const d of dims) {
            const g = (await db.gids(d)).get(c.at[d]);
            if (g === undefined) throw new Error(`no member ${c.at[d]} in ${d}`);
            key.push(g);
        }
        lines.push(`${c.value},${gid},${key.join(':')}`);
    }
    const file = path.join(work, 'import.csv');
    fs.writeFileSync(file, lines.join('\n') + '\n');
    await db.importCsv(file, true);
}

/** One of the JSON files in model/, made by model/lib/rama/generate.mjs from the model. It is the JSON a model import takes. */
export const modelFile = (name) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'model', name), 'utf8');

/** The file in a work folder that a model import reads. Writes `json` to it and returns its path. */
export function modelImportFile(work, json) {
    const file = path.join(work, 'model-import.json');
    fs.writeFileSync(file, json);
    return file;
}

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
