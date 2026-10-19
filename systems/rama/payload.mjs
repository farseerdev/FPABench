// The FPABench model and a dataset of input cells, as the payload RAMA's modelImport takes. This is the
// same JSON the Farseer backend sends to RAMA when a model is pushed (POST /model/load).
//
// Variables keep their formulas as written. RAMA resolves the names itself. Open grain dimensions go in
// `tables` and pins in `members`. Members come from the model and the dataset (runner/lib/model.mjs),
// with a "NULL (<Dim>)" member in every dimension. Versions and Years are the ones the cells use, so
// RAMA's builtin Plan version is dropped. Two rows for the same cell add up, as an import does.

import fs from 'node:fs';
import readline from 'node:readline';
import { SYSTEM_DIMENSIONS } from '../../runner/lib/model.mjs';

const FORMAT = { type: 'NUMBER', unit: 'ONES', negatives: 'SIGNED', polarity: 'POSITIVE', currency: 'EUR', decimals: 2, formatString: '#,##0.00', custom: false };
const PERCENT = { ...FORMAT, type: 'PERCENTAGE', formatString: '#,##0.00%' };

export function variablePayload(v) {
    return {
        name: v.name,
        description: null,
        notes: v.props.notes ?? null,
        formula: v.formula,
        tables: v.open,
        members: Object.entries(v.pins),
        cells: [],
        rollupType: v.rollupType,
        dataType: v.props.type === 'integer' ? 'INTEGER' : 'DECIMAL',
        numberFormat: v.props.format === 'percentage' ? PERCENT : FORMAT,
        numberValidation: { min: null, max: null },
        topDownMapping: null,
        readonly: v.props.readonly === true,
        calculateOnDemand: false,
        zConstraint: false,
        active: true,
        optimizeCalculation: v.props.optimizeCalculation !== false,
        useHierarchy: true,
        folderPath: ['Variables', ...(v.props.folder ? [v.props.folder] : [])],
    };
}

/** One dimension table: its members, and one foreign key column per link. */
export function tablePayload(model, d, names = null) {
    const fks = model.parentsOf(d);
    const rows = [];
    for (const m of model.members.get(d).values()) {
        if (names && !names.has(m.name)) continue;
        rows.push([m.name, ...fks.map((p) => [m.parents[p]])]);
    }
    return { name: d, columns: [{ type: 'PRIMARY_KEY' }, ...fks.map((p) => ({ type: 'FOREIGN_KEY', foreignKeyTableName: p }))], rows };
}

/** Calls fn(variable, value, members) for each row of cells.csv, members in the order of variable.open. */
export async function forEachCell(model, file, fn) {
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    let cols = null;
    for await (const line of rl) {
        if (!line) continue;
        const f = line.split(',');
        if (!cols) {
            cols = new Map(f.map((h, i) => [h, i]));
            continue;
        }
        const v = model.variable(f[0]);
        const members = v.open.map((d) => f[cols.get(d)]);
        if (members.some((m) => m === undefined || m === '')) throw new Error(`${file}: a cell of "${v.name}" lacks a member: ${line}`);
        fn(v, Number(f[1]), members);
    }
}

/** Reads cells.csv into { variable name: Map(key -> { value, members }) } and the system members it uses. */
export async function readCells(model, file) {
    const cells = new Map();
    const system = { Versions: new Set(), Years: new Set() };
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    let header = null;
    let cols = null;
    for await (const line of rl) {
        if (!line) continue;
        const f = line.split(',');
        if (!header) {
            header = f;
            cols = new Map(header.map((h, i) => [h, i]));
            continue;
        }
        const v = model.variable(f[0]);
        const members = v.open.map((d) => f[cols.get(d)]);
        if (members.some((m) => m === undefined || m === '')) throw new Error(`${file}: a cell of "${v.name}" lacks a member: ${line}`);
        if (cols.has('Versions') && f[cols.get('Versions')]) system.Versions.add(f[cols.get('Versions')]);
        if (cols.has('Years') && f[cols.get('Years')]) system.Years.add(f[cols.get('Years')]);
        if (!cells.has(v.name)) cells.set(v.name, new Map());
        const key = members.join('\u0000');
        const prev = cells.get(v.name).get(key);
        cells.get(v.name).set(key, { value: (prev?.value ?? 0) + Number(f[1]), members });
    }
    return { cells, system };
}

export async function buildPayload(model, cellsFile) {
    const { cells, system } = await readCells(model, cellsFile);
    const tables = model.userDims.map((d) => tablePayload(model, d));
    const variables = model.order.map((v) => {
        const p = variablePayload(v);
        p.cells = cells.has(v.name) ? [...cells.get(v.name).values()] : [];
        return p;
    });
    return { tables, variables, versions: [...system.Versions].sort(), years: [...system.Years].sort() };
}

export { SYSTEM_DIMENSIONS };
