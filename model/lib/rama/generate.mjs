// Writes the JSON RAMA's tests send to modelImport into systems/rama/model/, so it can be read and reviewed
// without running anything. It is the same JSON the Farseer backend sends when a model is pushed.
//
//   node model/lib/rama/generate.mjs            writes the files
//   node model/lib/rama/generate.mjs --check    fails when a file is out of date
//
// model.json holds every dimension table with the members the model itself brings, Versions and Years
// included, and every variable in calculation order. L1 adds the data's own members, such as customers, from
// the dataset's dimensions/ files, and sends it in one modelImport. m1.json and m4.json hold only the variables tests M1 and M4 change or add.
// reads/R4.json names the KPI measures test R4 reads.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModel } from '../model.mjs';
import { changedModel } from '../changes.mjs';
import { params } from '../../../data/params.mjs';

const FORMAT = { type: 'NUMBER', unit: 'ONES', negatives: 'SIGNED', polarity: 'POSITIVE', currency: 'EUR', decimals: 2, formatString: '#,##0.00', custom: false };
const PERCENT = { ...FORMAT, type: 'PERCENTAGE', formatString: '#,##0.00%' };

/** One variable, with its formula as written. RAMA resolves the names itself. Pins go in `members`. */
function variablePayload(v) {
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
function tablePayload(model, d) {
    const fks = model.parentsOf(d);
    const rows = [];
    for (const m of model.members.get(d).values()) {
        rows.push([m.name, ...fks.map((p) => [m.parents[p]])]);
    }
    return { name: d, columns: [{ type: 'PRIMARY_KEY' }, ...fks.map((p) => ({ type: 'FOREIGN_KEY', foreignKeyTableName: p }))], rows };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const modelDir = path.join(root, 'model');
// The files go next to RAMA's tests.
const outDir = path.join(root, 'systems', 'rama', 'model');
const check = process.argv.includes('--check');
const json = (x) => JSON.stringify(x, null, 1) + '\n';
// A variable as a model change sends it: no cells.
const changed = (v) => {
    const out = variablePayload(v);
    delete out.cells;
    return out;
};

const model = loadModel(modelDir);
const files = new Map();
// Versions and Years come from the data generator's settings, the same for every dataset. RAMA has them
// built in, with Plan and Actual and three years. The import adds the others. Plan stays, with no cells.
const t = params.time;
const firstYear = Number(t.firstMonth.slice(0, 4));
const versions = Object.keys(t.versions).sort();
const years = Array.from({ length: t.planYear - firstYear + 1 }, (_, i) => `Y${firstYear + i}`);
const system = [
    { name: 'Versions', columns: [{ type: 'PRIMARY_KEY' }], rows: versions.map((m) => [m]) },
    { name: 'Years', columns: [{ type: 'PRIMARY_KEY' }], rows: years.map((m) => [m]) },
];
files.set('model.json', json({ tables: [...system, ...model.userDims.map((d) => tablePayload(model, d))], variables: model.order.map((v) => variablePayload(v)) }));
files.set('reads/R4.json', json({ measures: model.variables.filter((v) => v.measure && v.file === '8-report.fml').map((v) => v.name) }));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fpabench-rama-'));
for (const test of ['M1', 'M4']) {
    const dir = path.join(tmp, test);
    const change = changedModel(modelDir, dir, test);
    const next = loadModel(dir);
    const names = new Set([...change.changed, ...(change.added ?? [])]);
    files.set(`${test.toLowerCase()}.json`, json({ tables: [], variables: next.order.filter((v) => names.has(v.name)).map(changed) }));
}
fs.rmSync(tmp, { recursive: true, force: true });

let stale = 0;
for (const [rel, text] of files) {
    const file = path.join(outDir, rel);
    const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (now === text) continue;
    if (check) {
        console.error(`systems/rama/model/${rel} is out of date. Run: node model/lib/rama/generate.mjs`);
        stale++;
        continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}
if (stale) process.exit(1);
if (!check) console.log(`Wrote ${files.size} files to systems/rama/model/`);
