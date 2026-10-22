// Translates the FPABench model into SQL for DuckDB or ClickHouse: one table per input variable, and one
// table per calculated variable, built in dependency order. Running the model SQL again after a write
// rebuilds them all.
//
// Neither system can keep a derived table current by itself. DuckDB has no materialized views and no
// triggers. ClickHouse's materialized views react to inserts into one table only. Plain views give the
// same answers, but DuckDB unfolds every view below a view when it creates or reads it, and on this model
// a view deep in the P&L took 28 s just to create.
//
// The dialects differ in a few places only: how a list of members is turned into rows, UNION, the
// IGNORE NULLS syntax, table engines, and ClickHouse's FINAL on the input tables, which keep every write
// as a new row version (ReplacingMergeTree) instead of updating in place. ClickHouse must run with
// join_use_nulls = 1 and aggregate_functions_null_for_empty = 1, or a missing value turns into 0.
//
// Semantics follow RAMA:
//   - a missing cell is a missing row, never NULL in a table and never 0
//   - + and - treat a missing operand as 0. The result is missing only when every operand is missing.
//   - * is missing when any operand is missing. a / b is missing when b is missing or 0. A missing a counts as 0.
//   - an operand coarser than the target is copied down through the links, a finer one is rolled up
//     by its own rollup, and a dimension the target lacks is rolled up away
//   - a target dimension that no operand gives is filled with every member of that dimension
//   - cumsum(0, 0, X) holds the last value of X, from its first value to the end of the timeline
//   - delay(X, n) moves every cell n months later. Cells moved past the timeline drop.

import { parseFormula, nodesOf } from '../rql.mjs';

/** The SQL that creates the empty tables, the SQL of every calculated table, and what each table reads. */
/**
 * `dict` maps every dimension, Versions, Years and Months included, to a Map of member name to integer
 * id. Every key column holds ids, and every member the SQL names is written as its id. Integer keys made
 * the heavy statements two to three times faster than text keys.
 */
export function translate(model, { versions, years, dialect = 'duckdb', dict }) {
    const CH = dialect === 'clickhouse';
    const DOUBLE = 'DOUBLE';
    const KEY = CH ? 'Int32' : 'INTEGER';
    const mid = (dim, name) => {
        const v = dict.get(dim)?.get(name);
        if (v === undefined) throw new Error(`no id for member ${name} of ${dim}`);
        return String(v);
    };
    const UNION = CH ? ' UNION DISTINCT ' : ' UNION ';
    const list = (d, xs) => (CH ? `arrayJoin([${xs.map((x) => mid(d, x)).join(', ')}])` : `unnest([${xs.map((x) => mid(d, x)).join(', ')}])`);
    // ClickHouse forces every new part to disk, so writes are durable, as DuckDB's are by default.
    const DURABLE = "SETTINGS fsync_after_insert = 1, fsync_part_directory = 1";
    // Calculated tables live in memory: DuckDB TEMP tables, ClickHouse Memory tables. Only the inputs need
    // to survive a crash, since every calculated table can be built again from them. After a restart the
    // system builds them again on start, and that time counts in R8.
    const createAs = (name) => (CH ? `CREATE OR REPLACE TABLE ${name} ENGINE = Memory AS` : `CREATE OR REPLACE TEMP TABLE ${name} AS`);
    // An input table with an alias. In ClickHouse it keeps old row versions until a merge, so it is read FINAL.
    const from = (x, alias) => (CH && !x.formula ? `${rel(x)} AS ${alias} FINAL` : `${rel(x)} ${alias}`);
    const VERSIONS = versions;
    const YEARS = years;
    const MONTHS = Array.from({ length: 12 }, (_, i) => `M${i + 1}`);
    const SYSTEM = new Set(['Versions', 'Years', 'Months', 'Quarters', 'Half years', 'Year to date']);
    const TIME = new Set(['Years', 'Months']);

    // --- names ------------------------------------------------------------------------------------------

    const id = (s) => `"${s.replace(/"/g, '""')}"`;
    const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const dimTable = (d) => id(`dim ${d}`);
    const flatView = (d) => id(`flat ${d}`);

    // --- dimensions ---------------------------------------------------------------------------------------

    const parentsOf = (d) => model.parentsOf(d).filter((p) => !SYSTEM.has(p));
    /** Shortest link path from d up to a, as the list of dimensions after d. */
    function pathUp(d, a) {
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
        const out = [];
        for (let x = a; x !== d; x = prev.get(x)) out.unshift(x);
        return out;
    }
    const isAncestor = (a, d) => model.isAncestor(a, d);

    const userDims = model.userDims;

    // --- variables ----------------------------------------------------------------------------------------

    const varOf = (name) => model.variable(name);
    const grainOf = (v) => v.dims;
    const openOf = (v) => v.open;
    const pinsOf = (v) => v.pins;
    const isMeasure = (v) => v.measure;
    const isInput = (v) => !v.formula;
    const rel = (v) => id(v.name);

    // --- one calculated variable ----------------------------------------------------------------------------

    function translateVariable(v) {
        const T = openOf(v);
        const pins = pinsOf(v);
        const ast = parseFormula(v.formula);
        const top = ast.type === 'paren' ? ast.expr : ast;
        if (top.type === 'call' && top.name === 'cumsum') return carryView(v, T, pins, top);
        if (top.type === 'call' && top.name === 'delay') return delayView(v, T, pins, top);

        const refs = [];
        // An operand, aligned to the target grain. keys: direct target dims. via: [x, t] pairs, the operand's
        // dimension x is an ancestor of target dimension t, so the operand is copied down to t.
        function addRef(name, filter) {
            const x = varOf(name);
            if (isMeasure(x)) throw new Error(`${v.name}: reads measure ${x.name}`);
            const r = { i: refs.length, x, filter, keys: [], via: [], rollup: [], drop: [] };
            for (const d of grainOf(x)) {
                if (T.includes(d)) r.keys.push(d);
                else {
                    const up = T.filter((t) => isAncestor(t, d));
                    const down = T.filter((t) => isAncestor(d, t));
                    if (up.length) {
                        for (const t of up) {
                            r.rollup.push([d, t]);
                            if (!r.keys.includes(t)) r.keys.push(t);
                        }
                    } else if (down.length === 1) r.via.push([d, down[0]]);
                    else if (down.length > 1) throw new Error(`${v.name}: ${x.name}.${d} reaches ${down.join(' and ')}`);
                    else r.drop.push(d);
                }
            }
            r.sql = alignSql(r);
            refs.push(r);
            return r;
        }

        // --- value of a node, as SQL over the driver row `d` and the joined operands `r<i>` ---------
        // --- and its cell set: { u: true } (universe) | { join: [refs], terms } | { union: [sets] } -----
        function walk(n) {
            switch (n.type) {
                case 'paren':
                    return walk(n.expr);
                case 'num':
                    return { sql: `CAST(${Number(n.value)} AS ${DOUBLE})`, cells: { u: true } };
                case 'name': {
                    const r = addRef(n.name, null);
                    return { sql: `r${r.i}.v`, cells: { join: [r] } };
                }
                case 'neg': {
                    const a = walk(n.expr);
                    return { sql: `(-${a.sql})`, cells: a.cells };
                }
                case 'bin': {
                    if (n.op === '+' || n.op === '-') {
                        // A whole chain a + b - c ... at once, so no term is written more than twice.
                        const terms = [];
                        const collect = (m, sign) => {
                            if (m.type === 'bin' && (m.op === '+' || m.op === '-')) {
                                collect(m.left, sign);
                                collect(m.right, m.op === '-' ? -sign : sign);
                            } else terms.push({ sign, ...walk(m) });
                        };
                        collect(n, 1);
                        const sum = terms.map((t, i) => `${t.sign < 0 ? '- ' : i ? '+ ' : ''}coalesce(${t.sql}, 0)`).join(' ');
                        return {
                            sql: `(CASE WHEN ${terms.map((t) => `${t.sql} IS NULL`).join(' AND ')} THEN NULL ELSE ${sum} END)`,
                            cells: plusCells(terms.map((t) => t.cells)),
                        };
                    }
                    const a = walk(n.left);
                    const b = walk(n.right);
                    if (n.op === '*') return { sql: `(${a.sql} * ${b.sql})`, cells: joinCells([a.cells, b.cells]) };
                    return {
                        sql: `(CASE WHEN ${b.sql} IS NULL OR ${b.sql} = 0 THEN NULL ELSE coalesce(${a.sql}, 0) / ${b.sql} END)`,
                        cells: covers(b.cells) ? b.cells : joinCells([a.cells, b.cells]),
                    };
                }
                case 'call':
                    return call(n);
                default:
                    throw new Error(`${v.name}: cannot translate ${n.type}`);
            }
        }

        function call(n) {
            const a = n.args;
            switch (n.name) {
                case 'if': {
                    const c = cond(a[0]);
                    const t = walk(a[1]);
                    const e = a[2] ? walk(a[2]) : null;
                    return {
                        sql: `(CASE WHEN ${c.sql} THEN ${t.sql} ELSE ${e ? e.sql : 'NULL'} END)`,
                        cells: e ? unionCells([joinCells([c.cells, t.cells]), e.cells]) : joinCells([c.cells, t.cells]),
                    };
                }
                case 'abs': {
                    const x = walk(a[0]);
                    return { sql: `abs(${x.sql})`, cells: x.cells };
                }
                case 'sum': {
                    if (a[0].type !== 'name') throw new Error(`${v.name}: sum of an expression`);
                    const r = addRef(a[0].name, a.slice(1));
                    return { sql: `r${r.i}.v`, cells: { join: [r] } };
                }
                default:
                    throw new Error(`${v.name}: function ${n.fn} as a value`);
            }
        }

        function cond(n) {
            if (n.type === 'paren') return cond(n.expr);
            if (n.type !== 'call') {
                const x = walk(n);
                return { sql: `coalesce(${x.sql} <> 0, false)`, cells: x.cells };
            }
            const a = n.args;
            const cmp = { eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=', neq: '<>' }[n.name];
            if (cmp) {
                const x = walk(a[0]);
                const y = walk(a[1]);
                return { sql: `(coalesce(${x.sql}, 0) ${cmp} coalesce(${y.sql}, 0))`, cells: joinCells([x.cells, y.cells]) };
            }
            switch (n.name) {
                case 'hasvalue': {
                    const x = walk(a[0]);
                    return { sql: `(${x.sql} IS NOT NULL)`, cells: x.cells };
                }
                case 'not': {
                    const x = cond(a[0]);
                    return { sql: `(NOT ${x.sql})`, cells: { u: true } };
                }
                case 'and': {
                    const xs = a.map(cond);
                    return { sql: `(${xs.map((x) => x.sql).join(' AND ')})`, cells: joinCells(xs.map((x) => x.cells)) };
                }
                case 'or': {
                    const xs = a.map(cond);
                    return { sql: `(${xs.map((x) => x.sql).join(' OR ')})`, cells: unionCells(xs.map((x) => x.cells)) };
                }
                case 'hasdmember': {
                    const parts = a.map((m) => {
                        if (m.type !== 'member') throw new Error(`${v.name}: hasDMember needs Dim>Member`);
                        return `${memberCol(m.dim)} = ${mid(m.dim, m.member)}`;
                    });
                    return { sql: `(${parts.join(' OR ')})`, cells: { u: true } };
                }
                default:
                    throw new Error(`${v.name}: function ${n.fn} as a condition`);
            }
        }

        // A target or pinned dimension, or one above a target dimension, as seen from the driver row.
        const flats = new Map(); // target dim -> set of ancestor dims needed
        function memberCol(dim) {
            if (T.includes(dim)) return `d.${id(dim)}`;
            if (pins[dim] !== undefined) return mid(dim, pins[dim]);
            const t = T.find((t) => isAncestor(dim, t));
            if (!t) throw new Error(`${v.name}: ${dim} is not reachable`);
            if (!flats.has(t)) flats.set(t, new Set());
            flats.get(t).add(dim);
            return `f_${T.indexOf(t)}.${id(dim)}`;
        }

        // --- cell sets ------------------------------------------------------------------------------
        function dimsOf(c) {
            if (c.u) return new Set();
            if (c.join) return new Set(c.join.flatMap((r) => r.keys));
            const sets = c.union.map(dimsOf);
            return new Set([...sets[0]].filter((d) => sets.every((s) => s.has(d))));
        }
        function covers(c) {
            const ds = dimsOf(c);
            return T.every((t) => ds.has(t));
        }
        function joinCells(cs) {
            const parts = cs.filter((c) => !c.u);
            if (!parts.length) return { u: true };
            if (parts.length === 1) return parts[0];
            if (parts.every((c) => c.join)) return { join: parts.flatMap((c) => c.join) };
            // A join with a union: distribute.
            const i = parts.findIndex((c) => c.union);
            const rest = parts.filter((_, k) => k !== i);
            return unionCells(parts[i].union.map((s) => joinCells([s, ...rest])));
        }
        function unionCells(cs) {
            if (cs.some((c) => c.u)) return { u: true };
            return { union: cs.flatMap((c) => (c.union ? c.union : [c])) };
        }
        function plusCells(cs) {
            // An operand that has every target dimension places cells. The others only add to them.
            const flat = cs.flatMap((c) => (c.union ? c.union : [c]));
            const covering = flat.filter((c) => !c.u && covers(c));
            if (covering.length) return { union: covering };
            if (flat.some((c) => c.u)) return { u: true };
            return { union: flat };
        }

        const value = walk(top);
        // A sum whose every term is an operand that has exactly the target's dimensions: UNION ALL the
        // operands and add them up per coordinate. Same cells and values as the joins (a coordinate exists
        // where any term has a cell, and a missing term counts as 0), and much less work.
        const chain = [];
        const collect = (n, sign) => {
            if (n.type === 'paren') return collect(n.expr, sign);
            if (n.type === 'bin' && (n.op === '+' || n.op === '-')) {
                collect(n.left, sign);
                collect(n.right, n.op === '-' ? -sign : sign);
            } else chain.push({ n, sign });
        };
        collect(top, 1);
        const sameGrain = (r) => !r.via.length && r.keys.length === T.length && T.every((t) => r.keys.includes(t));
        if (chain.length > 1 && chain.length === refs.length && chain.every((c) => c.n.type === 'name' || (c.n.type === 'call' && c.n.name === 'sum')) && refs.every(sameGrain)) {
            const keys = T.map(id).join(', ');
            const parts = refs.map((r, k) => `SELECT ${keys}, ${chain[k].sign < 0 ? '-' : ''}v AS v FROM (${r.sql}) r${k}`);
            const cols = grainOf(v).map((g) => (pins[g] !== undefined ? `${mid(g, pins[g])} AS ${id(g)}` : `u.${id(g)} AS ${id(g)}`));
            return [createAs(rel(v)), `SELECT ${[...cols, 'sum(u.v) AS v'].join(', ')}`, `FROM (${parts.join(' UNION ALL ')}) u`, `GROUP BY ${T.map((t) => `u.${id(t)}`).join(', ')};`].join('\n');
        }
        let cells = value.cells;
        if (cells.u) cells = { join: [] };
        // When one operand alone gives every target cell, it is the driver itself: no distinct list of
        // coordinates, and no join back onto it. Its rows are unique, since every table and every rolled-up
        // operand has one row per coordinate.
        const sigOf = (r) => `${r.sql}|${JSON.stringify(r.via)}`;
        const only = cells.join && new Set(cells.join.map(sigOf)).size === 1 ? cells.join[0] : null;
        const direct = only && !only.via.length && T.every((t) => only.keys.includes(t)) && only.keys.every((k) => T.includes(k)) ? sigOf(only) : null;
        // When one chain of joins gives a table's cells, the chain also carries the value of each operand
        // in it, so each operand is joined once and the chain needs no DISTINCT. Tables whose cells are a union
        // of chains list the distinct coordinates and join every operand back onto them.
        const carried = new Map(); // operand signature -> alias of the operand in the chain
        const chained = !direct && cells.join?.length > 0;
        const driver = direct ? only.sql : chained ? termSql(cells, carried) : cellsSql(cells.union ?? [cells]);
        const inDriver = new Set(refs.filter((r) => (direct ? sigOf(r) === direct : carried.has(sigOf(r)))).map((r) => r.i));
        const driverCol = (r) => (direct ? 'd.v' : `d.${carried.get(sigOf(r))}_v`);
        value.sql = value.sql.replace(/\br(\d+)\.v\b/g, (m, i) => (inDriver.has(Number(i)) ? driverCol(refs[Number(i)]) : m));

        // --- the table ------------------------------------------------------------------------------
        const joins = [];
        for (const r of refs) {
            if (inDriver.has(r.i)) continue;
            const on = [...r.keys.map((k) => `r${r.i}.${id(k)} = d.${id(k)}`), ...r.via.map(([x, t]) => `r${r.i}.${id(x)} = ${memberColVia(x, t)}`)];
            joins.push(`LEFT JOIN (${r.sql}) r${r.i} ON ${on.length ? on.join(' AND ') : 'true'}`);
        }
        function memberColVia(x, t) {
            if (!flats.has(t)) flats.set(t, new Set());
            flats.get(t).add(x);
            return `f_${T.indexOf(t)}.${id(x)}`;
        }
        // memberColVia fills `flats`, so the flat joins are built after the operand joins.
        const flatJoins = [...flats].map(([t, _]) => `LEFT JOIN ${flatView(t)} f_${T.indexOf(t)} ON f_${T.indexOf(t)}.${id(t)} = d.${id(t)}`);
        const cols = grainOf(v).map((g) => (pins[g] !== undefined ? `${mid(g, pins[g])} AS ${id(g)}` : `d.${id(g)} AS ${id(g)}`));
        return [
            createAs(rel(v)),
            `SELECT * FROM (`,
            `    SELECT ${[...cols, `${value.sql} AS v`].join(', ')}`,
            `    FROM (${driver}) d`,
            ...flatJoins.map((j) => `    ${j}`),
            ...joins.map((j) => `    ${j}`),
            `) WHERE v IS NOT NULL;`,
        ].join('\n');

        // The distinct target coordinates of a list of cell sets, united.
        function cellsSql(sets) {
            return sets.map((s) => termSql(s)).join(UNION);
        }
        // The distinct target coordinates of one join of operands, as an explicit chain of joins. The
        // operand with the most target dimensions goes first, and each coarser operand joins through the
        // parent columns of what is already there. An operand that appears twice joins once. A target
        // dimension no operand gives is filled with every member, as late as possible.
        // With `carried`, the chain also selects each operand's value as <alias>_v, records each operand's
        // alias in `carried`, and needs no DISTINCT: each operand has at most one row per coordinate of its
        // own dimensions, so the chain has one row per target cell.
        function termSql(c, carried = null) {
            const seen = new Set();
            const pending = c.join
                .filter((r) => {
                    const sig = sigOf(r);
                    if (seen.has(sig)) return false;
                    seen.add(sig);
                    return true;
                })
                .sort((a, b) => b.keys.length - a.keys.length);
            const from = [];
            const have = new Map(); // target dim -> column expression
            const flatAlias = new Map(); // target dim -> alias of its flattened dimension table
            const flatOf = (t) => {
                if (!flatAlias.has(t)) {
                    const alias = `g_${T.indexOf(t)}`;
                    flatAlias.set(t, alias);
                    from.push(`JOIN ${flatView(t)} ${alias} ON ${alias}.${id(t)} = ${have.get(t)}`);
                }
                return flatAlias.get(t);
            };
            const first = (src, alias) => `${src} ${alias}`;
            const cross = (src, alias) => `CROSS JOIN ${src} ${alias}`;
            const addMembers = (t) => {
                const alias = `m_${T.indexOf(t)}`;
                from.push(from.length ? cross(membersOf(t), alias) : first(membersOf(t), alias));
                have.set(t, `${alias}.${id(t)}`);
            };
            let k = 0;
            while (pending.length) {
                let i = pending.findIndex((r) => r.via.every(([, t]) => have.has(t)));
                if (i < 0) {
                    addMembers(pending[0].via.find(([, t]) => !have.has(t))[1]);
                    continue;
                }
                const r = pending.splice(i, 1)[0];
                const alias = `p${k++}`;
                carried?.set(sigOf(r), alias);
                const on = [];
                for (const key of r.keys) if (have.has(key)) on.push(`${alias}.${id(key)} = ${have.get(key)}`);
                for (const [x, t] of r.via) on.push(`${alias}.${id(x)} = ${flatOf(t)}.${id(x)}`);
                if (!from.length) from.push(first(`(${r.sql})`, alias));
                else from.push(on.length ? `JOIN (${r.sql}) ${alias} ON ${on.join(' AND ')}` : cross(`(${r.sql})`, alias));
                for (const key of r.keys) if (!have.has(key)) have.set(key, `${alias}.${id(key)}`);
            }
            for (const t of T) if (!have.has(t)) addMembers(t);
            const sel = T.map((t) => `${have.get(t)} AS ${id(t)}`);
            if (carried) return `SELECT ${[...sel, ...[...carried.values()].map((a) => `${a}.v AS ${a}_v`)].join(', ')} FROM ${from.join(' ')}`;
            return `SELECT DISTINCT ${sel.length ? sel.join(', ') : '1 AS one'} FROM ${from.length ? from.join(' ') : '(SELECT 1) AS z'}`;
        }
    }

    function membersOf(d) {
        if (d === 'Versions') return `(SELECT ${list(d, VERSIONS)} AS ${id(d)})`;
        if (d === 'Years') return `(SELECT ${list(d, YEARS)} AS ${id(d)})`;
        if (d === 'Months') return `(SELECT ${list(d, MONTHS)} AS ${id(d)})`;
        return `(SELECT ${id(d)} FROM ${flatView(d)})`;
    }

    // The operand aligned to the target: rolled up, filtered, keyed by its direct and copied-down dimensions.
    function alignSql(r) {
        const { x, filter } = r;
        const src = from(x, 's');
        const joins = [];
        const flatFor = new Map();
        const flat = (d) => {
            if (!flatFor.has(d)) {
                flatFor.set(d, `u${flatFor.size}`);
                joins.push(`LEFT JOIN ${flatView(d)} ${flatFor.get(d)} ON ${flatFor.get(d)}.${id(d)} = s.${id(d)}`);
            }
            return flatFor.get(d);
        };
        const keyExpr = new Map();
        for (const k of r.keys) if (grainOf(x).includes(k)) keyExpr.set(k, `s.${id(k)}`);
        for (const [d, t] of r.rollup) keyExpr.set(t, `${flat(d)}.${id(t)}`);
        for (const [d] of r.via) keyExpr.set(d, `s.${id(d)}`);
        const where = filter?.length ? filter.map((f) => filterSql(f, x, flat)).join(' AND ') : null;
        const agg = r.rollup.length || r.drop.length;
        const fn = x.rollupType === 'AVERAGE' ? 'avg' : 'sum';
        const cols = [...keyExpr].map(([k, e]) => `${e} AS ${id(k)}`);
        if (!agg && !where) return `SELECT ${[...cols, 's.v AS v'].join(', ')} FROM ${src}`;
        const body = `FROM ${src}${joins.length ? ' ' + joins.join(' ') : ''}${where ? ` WHERE ${where}` : ''}`;
        if (!agg) return `SELECT ${[...cols, 's.v AS v'].join(', ')} ${body}`;
        return `SELECT ${[...cols, `${fn}(s.v) AS v`].join(', ')} ${body}${cols.length ? ` GROUP BY ${[...keyExpr.values()].join(', ')}` : ''}`;
    }

    function filterSql(f, x, flat) {
        if (f.type === 'paren') return filterSql(f.expr, x, flat);
        if (f.type === 'member') {
            const g = grainOf(x);
            if (g.includes(f.dim)) return `s.${id(f.dim)} = ${mid(f.dim, f.member)}`;
            const d = g.find((d) => isAncestor(f.dim, d));
            if (!d) throw new Error(`${x.name}: filter ${f.dim} is not reachable`);
            return `${flat(d)}.${id(f.dim)} = ${mid(f.dim, f.member)}`;
        }
        if (f.type === 'call' && f.name === 'not') return `(NOT ${filterSql(f.args[0], x, flat)})`;
        if (f.type === 'call' && f.name === 'or') return `(${f.args.map((a) => filterSql(a, x, flat)).join(' OR ')})`;
        if (f.type === 'call' && f.name === 'and') return `(${f.args.map((a) => filterSql(a, x, flat)).join(' AND ')})`;
        throw new Error(`${x.name}: cannot use ${f.type} as a filter`);
    }

    // cumsum(0, 0, X): from the first value of X, every later period holds the last value of X.
    function carryView(v, T, pins, n) {
        const [a, b, src] = n.args;
        if (a.type !== 'num' || b.type !== 'num' || Number(a.value) !== 0 || Number(b.value) !== 0 || src.type !== 'name')
            throw new Error(`${v.name}: only cumsum(0, 0, X) is supported`);
        const x = varOf(src.name);
        if (grainOf(x).join() !== grainOf(v).join()) throw new Error(`${v.name}: cumsum over another grain`);
        const other = T.filter((t) => !TIME.has(t)).map(id);
        const part = other.length ? `PARTITION BY ${other.map((o) => `g.${o}`).join(', ')} ` : '';
        return [
            createAs(rel(v)),
            `WITH s AS (SELECT ${[...grainOf(v).filter((d) => !TIME.has(d)).map((d) => `x.${id(d)} AS ${id(d)}`), 'x."Years" AS "Years"', 'x."Months" AS "Months"', 'x.v AS v', 'p.p AS p'].join(', ')} FROM ${rel(x)} x JOIN period p ON p."Years" = x."Years" AND p."Months" = x."Months"),`,
            `f0 AS (SELECT ${[...other, 'min(p) AS p0'].join(', ')} FROM s${other.length ? ` GROUP BY ${other.join(', ')}` : ''}),`,
            `g AS (SELECT ${[...other.map((o) => `f.${o} AS ${o}`), 'p."Years" AS "Years"', 'p."Months" AS "Months"', 'p.p AS p'].join(', ')} FROM f0 f CROSS JOIN period p WHERE p.p >= f.p0)`,
            `SELECT ${grainOf(v).map((d) => `g.${id(d)} AS ${id(d)}`).join(', ')}, ${CH ? 'last_value(s.v) IGNORE NULLS' : 'last_value(s.v IGNORE NULLS)'} OVER (${part}ORDER BY g.p ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS v`,
            `FROM g LEFT JOIN s ON ${[...other, '"Years"', '"Months"'].map((o) => `s.${o} = g.${o}`).join(' AND ')};`,
        ].join('\n');
    }

    // delay(X, n): every cell n months later.
    function delayView(v, T, pins, n) {
        const [src, k] = n.args;
        if (src.type !== 'name' || k.type !== 'num') throw new Error(`${v.name}: only delay(X, n) is supported`);
        const x = varOf(src.name);
        if (grainOf(x).join() !== grainOf(v).join()) throw new Error(`${v.name}: delay over another grain`);
        const other = grainOf(v).filter((t) => !TIME.has(t)).map((o) => `s.${id(o)} AS ${id(o)}`);
        return [
            createAs(rel(v)),
            `SELECT ${[...other, 'q."Years" AS "Years"', 'q."Months" AS "Months"', 's.v AS v'].join(', ')}`,
            `FROM ${rel(x)} s JOIN period p ON p."Years" = s."Years" AND p."Months" = s."Months" JOIN period q ON q.p = p.p + ${Number(k.value)};`,
        ].join('\n');
    }

    // --- schema: dimension tables, flattened dimension tables, input tables ------------------------------

    function schemaSql() {
        const out = [`-- Generated by translate.mjs (${dialect}). Dimension tables and input tables.`, ''];
        // The timeline: one row per year and month, with p counting months from the first.
        const periods = YEARS.flatMap((y, i) => MONTHS.map((m, k) => `(${mid('Years', y)}, ${mid('Months', m)}, ${i * 12 + k})`));
        out.push(
            CH
                ? `CREATE TABLE period ENGINE = MergeTree ORDER BY p ${DURABLE} AS SELECT * FROM values('"Years" Int32, "Months" Int32, p Int64', ${periods.join(', ')});`
                : `CREATE TABLE period AS SELECT * FROM (VALUES ${periods.join(', ')}) t("Years", "Months", p);`
        );
        // A dimension table holds each member's id, its name, and the ids of its parents.
        for (const d of [...userDims, 'Versions', 'Years', 'Months']) {
            const cols = [`${id(d)} ${KEY}`, `name ${CH ? 'String' : 'VARCHAR'}`, ...parentsOf(d).map((c) => `${id(c)} ${KEY}`)];
            out.push(CH ? `CREATE TABLE ${dimTable(d)} (${cols.join(', ')}) ENGINE = MergeTree ORDER BY ${id(d)} ${DURABLE};` : `CREATE TABLE ${dimTable(d)} (${cols.join(', ')}, PRIMARY KEY (${id(d)}));`);
        }
        for (const v of model.variables.filter(isInput)) {
            const keys = grainOf(v).map(id);
            if (CH) {
                // A write is a new row with a higher version. A delete is a row with is_deleted = 1. FINAL keeps the latest.
                const cols = [...keys.map((k) => `${k} ${KEY}`), 'v Float64', 'ver UInt64', 'is_deleted UInt8'];
                out.push(`CREATE TABLE ${rel(v)} (${cols.join(', ')}) ENGINE = ReplacingMergeTree(ver, is_deleted) ORDER BY ${keys.length ? `(${keys.join(', ')})` : 'tuple()'} ${DURABLE};`);
            } else {
                const cols = keys.map((k) => `${k} ${KEY}`);
                out.push(`CREATE TABLE ${rel(v)} (${[...cols, `v ${DOUBLE}`].join(', ')}${cols.length ? `, PRIMARY KEY (${keys.join(', ')})` : ''});`);
            }
        }
        return out.join('\n') + '\n';
    }

    function flatSql() {
        const out = [];
        for (const d of userDims) {
            const anc = model.ancestorsOf(d).filter((a) => !SYSTEM.has(a));
            const cols = [`t0.${id(d)} AS ${id(d)}`];
            const joins = [];
            const alias = new Map([[d, 't0']]);
            for (const a of anc) {
                const p = pathUp(d, a);
                let prev = d;
                for (const step of p) {
                    if (!alias.has(step)) {
                        alias.set(step, `t${alias.size}`);
                        joins.push(`LEFT JOIN ${dimTable(step)} ${alias.get(step)} ON ${alias.get(step)}.${id(step)} = ${alias.get(prev)}.${id(step)}`);
                    }
                    prev = step;
                }
                cols.push(`coalesce(${alias.get(a)}.${id(a)}, ${mid(a, `NULL (${a})`)}) AS ${id(a)}`);
            }
            // A small table per dimension, built once per rebuild, instead of a view joined again in every statement.
            out.push(`${createAs(flatView(d))} SELECT ${cols.join(', ')} FROM ${dimTable(d)} t0${joins.length ? ' ' + joins.join(' ') : ''};`);
        }
        return out.join('\n');
    }

    const calc = model.order.filter((v) => v.formula && !v.measure);
    const tables = calc.map((v) => `-- ${v.name} = ${v.formula.replace(/\s+/g, ' ')}\n${translateVariable(v)}`);
    // What each calculated table reads, so a write can rebuild only the tables it reaches.
    const reads = new Map(calc.map((v) => [v.name, new Set([...nodesOf(parseFormula(v.formula))].filter((n) => n.type === 'name').map((n) => model.variable(n.name).name))]));
    const flats = flatSql();
    /**
     * The SQL to run after a change, in dependency order. `changed` names the variables whose values or
     * formulas changed. Every calculated table that reads one of them, directly or through other tables,
     * is built again, and only those. Without `changed`, everything is built, the dimension lookups first.
     */
    const rebuildSql = (changed = null) => {
        if (!changed) return [flats, ...tables];
        const hit = new Set(changed);
        const out = [];
        calc.forEach((v, i) => {
            if (hit.has(v.name) || [...reads.get(v.name)].some((r) => hit.has(r))) {
                hit.add(v.name);
                out.push(tables[i]);
            }
        });
        return out;
    };
    return {
        rebuildSql,
        schema: schemaSql(),
        calculated: calc.map((v) => v.name),
        // Which variables each calculated table reads, by name.
        reads: Object.fromEntries([...reads].map(([n, r]) => [n, [...r].sort()])),
        // Each calculated table's statement, in dependency order, and the dimension lookups.
        tables,
        lookups: flats,
    };
}
