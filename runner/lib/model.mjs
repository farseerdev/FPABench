// The model as the runner and the adapters see it: variables, dimensions, links and members.
//
// It reads the .fml files with scripts/fml.mjs and the member files in model/dimensions/ and in the
// dataset's dimensions/ folder (data/cells.mjs writes them). Every dimension gets a "NULL (<Dim>)"
// member, and a member without a parent points at the parent's NULL member, as Farseer's model push does.

import fs from 'node:fs';
import path from 'node:path';
import { parseFml, formulaNames, SYSTEM_DIMENSIONS } from '../../scripts/fml.mjs';
import { parseFormula, nodesOf } from './rql.mjs';

export { SYSTEM_DIMENSIONS };
export const nullMember = (dim) => `NULL (${dim})`;
export const MONTHS = Array.from({ length: 12 }, (_, i) => `M${i + 1}`);

const ROLLUP = { sum: 'SUM', average: 'AVERAGE', formula: 'FORMULA', last: 'CLOSING STATE', first: 'BEGINNING STATE', max: 'MAX', min: 'MIN' };

export function readCsv(file) {
    const text = fs.readFileSync(file, 'utf8');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') {
                field += '"';
                i++;
            } else if (c === '"') quoted = false;
            else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') {
            row.push(field);
            field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(field);
            if (row.length > 1 || row[0] !== '') rows.push(row);
            row = [];
            field = '';
        } else field += c;
    }
    if (field !== '' || row.length) {
        row.push(field);
        rows.push(row);
    }
    const [header, ...body] = rows;
    return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/** The model in `modelDir`. With `cellsDir`, members also come from that dataset. */
export function loadModel(modelDir, cellsDir = null) {
    const files = fs.readdirSync(modelDir).filter((f) => f.endsWith('.fml') && !f.startsWith('.')).sort();
    const variables = [];
    const links = [];
    for (const f of files) {
        const parsed = parseFml(fs.readFileSync(path.join(modelDir, f), 'utf8'), f);
        const errors = parsed.problems.filter((p) => p.level === 'error');
        if (errors.length) throw new Error(errors.map((p) => `${p.where}: ${p.msg}`).join('; '));
        links.push(...parsed.links);
        for (const v of parsed.variables) {
            const grain = v.grain.map((g) => ({ dimension: g.dim, ...(g.pin !== undefined ? { pinnedMember: g.pin } : {}) }));
            variables.push({
                name: v.name,
                file: f,
                grain,
                dims: grain.map((g) => g.dimension),
                open: grain.filter((g) => g.pinnedMember === undefined).map((g) => g.dimension),
                pins: Object.fromEntries(grain.filter((g) => g.pinnedMember !== undefined).map((g) => [g.dimension, g.pinnedMember])),
                formula: v.formula ?? null,
                props: v.props ?? {},
                rollupType: ROLLUP[v.props?.rollup ?? 'sum'] ?? 'SUM',
                measure: v.grain.length === 0,
            });
        }
    }
    const byName = new Map(variables.map((v) => [v.name.toLowerCase(), v]));
    const variable = (name) => {
        const v = byName.get(name.toLowerCase());
        if (!v) throw new Error(`unknown variable "${name}"`);
        return v;
    };

    // Links: from -> to means a member of `from` has one parent in `to`.
    const parents = new Map();
    const dims = new Set();
    for (const v of variables) for (const d of v.dims) dims.add(d);
    for (const l of links) {
        dims.add(l.from).add(l.to);
        if (!parents.has(l.from)) parents.set(l.from, []);
        parents.get(l.from).push(l.to);
    }
    const userDims = [...dims].filter((d) => !SYSTEM_DIMENSIONS.has(d)).sort();
    const parentsOf = (d) => (SYSTEM_DIMENSIONS.has(d) ? [] : parents.get(d) ?? []);
    const ancestorsOf = (d) => {
        const out = [];
        const seen = new Set([d]);
        const queue = [d];
        while (queue.length) {
            for (const p of parentsOf(queue.shift())) {
                if (seen.has(p)) continue;
                seen.add(p);
                out.push(p);
                queue.push(p);
            }
        }
        return out;
    };
    const isAncestor = (a, d) => a !== d && ancestorsOf(d).includes(a);

    // Dependency order: a variable after everything its formula reads.
    const order = [];
    const state = new Map();
    const visit = (v) => {
        if (state.get(v.name) === 2) return;
        if (state.get(v.name) === 1) throw new Error(`cycle at "${v.name}"`);
        state.set(v.name, 1);
        if (v.formula) for (const n of formulaNames(v.formula)) if (byName.has(n.toLowerCase())) visit(variable(n));
        state.set(v.name, 2);
        order.push(v);
    };
    variables.forEach(visit);

    // Members.
    const members = new Map(userDims.map((d) => [d, new Map()]));
    const add = (d, name, parentRow = {}) => {
        const m = members.get(d);
        if (!m || !name) return;
        const prev = m.get(name);
        const ps = prev?.parents ?? {};
        for (const p of parentsOf(d)) if (parentRow[p]) ps[p] = parentRow[p];
        m.set(name, { name, parents: ps });
    };
    const dirs = [path.join(modelDir, 'dimensions'), cellsDir && path.join(cellsDir, 'dimensions')].filter(Boolean);
    for (const d of userDims) {
        for (const dir of dirs) {
            const file = path.join(dir, `${d}.csv`);
            if (fs.existsSync(file)) for (const r of readCsv(file)) add(d, r[d], r);
        }
    }
    for (const v of variables) for (const [d, m] of Object.entries(v.pins)) add(d, m);
    for (const v of variables) if (v.formula) for (const n of nodesOf(parseFormula(v.formula))) if (n.type === 'member') add(n.dim, n.member);
    for (const d of userDims) {
        if (!members.get(d).has(nullMember(d))) add(d, nullMember(d));
        for (const m of members.get(d).values()) for (const p of parentsOf(d)) if (!m.parents[p]) m.parents[p] = nullMember(p);
        // A NULL member's parent is the parent's NULL member, also when the parent is named somewhere.
        for (const p of parentsOf(d)) add(p, nullMember(p));
    }

    /** The member of ancestor dimension `a` above member `m` of dimension `d`. */
    const above = (d, m, a) => {
        let path = [d];
        const prev = new Map([[d, null]]);
        const queue = [d];
        while (queue.length) {
            const x = queue.shift();
            if (x === a) break;
            for (const p of parentsOf(x)) {
                if (prev.has(p)) continue;
                prev.set(p, x);
                queue.push(p);
            }
        }
        if (!prev.has(a)) return null;
        path = [];
        for (let x = a; x !== null; x = prev.get(x)) path.unshift(x);
        let cur = m;
        for (let i = 1; i < path.length; i++) cur = members.get(path[i - 1])?.get(cur)?.parents[path[i]] ?? nullMember(path[i]);
        return cur;
    };

    return { dir: modelDir, files, variables, variable, byName, links, userDims, parentsOf, ancestorsOf, isAncestor, order, members, above, addMember: add };
}

/** Members of every user dimension in the order a cell file would list them, plus the system ones. */
export function memberList(model, d, system) {
    if (system[d]) return system[d];
    return [...(model.members.get(d)?.keys() ?? [])].sort();
}
