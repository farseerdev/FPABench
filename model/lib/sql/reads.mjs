// SQL for the runner's reads, in DuckDB's or ClickHouse's dialect: one stored variable summed over a
// slice, or a measure computed at a slice from the sums it needs.

import { parseFormula } from '../rql.mjs';

const id = (s) => `"${String(s).replace(/"/g, '""')}"`;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function readSql(model, { variable, by = [], where = {} }, dialect = 'duckdb', dict) {
    const CH = dialect === 'clickhouse';
    // Members are stored as integer ids (see translate.mjs). The caller maps the ids of the result back to names.
    const mid = (dim, name) => {
        const v = dict.get(dim)?.get(name);
        if (v === undefined) throw new Error(`no id for member ${name} of ${dim}`);
        return String(v);
    };
    const from = (x) => (CH && !x.formula ? `${id(x.name)} AS s FINAL` : `${id(x.name)} s`);
    // The column expression for dimension d of a read on variable x, and the joins it needs.
    function dimExpr(x, d, joins) {
        if (x.dims.includes(d)) return `s.${id(d)}`;
        const g = x.dims.find((g) => model.isAncestor(d, g));
        if (!g) throw new Error(`"${x.name}" cannot be read by ${d}`);
        const alias = `f_${x.dims.indexOf(g)}`;
        if (!joins.has(alias)) joins.set(alias, `LEFT JOIN ${id(`flat ${g}`)} ${alias} ON ${alias}.${id(g)} = s.${id(g)}`);
        return `${alias}.${id(d)}`;
    }
    function filterSql(x, f, joins) {
        if (f.type === 'paren') return filterSql(x, f.expr, joins);
        if (f.type === 'member') return `${dimExpr(x, f.dim, joins)} = ${mid(f.dim, f.member)}`;
        if (f.type === 'call' && f.name === 'not') return `(NOT ${filterSql(x, f.args[0], joins)})`;
        if (f.type === 'call' && (f.name === 'or' || f.name === 'and')) return `(${f.args.map((a) => filterSql(x, a, joins)).join(f.name === 'or' ? ' OR ' : ' AND ')})`;
        throw new Error(`cannot filter by ${f.type}`);
    }
    // One stored variable, summed (or averaged, by its rollup) over `by`.
    function aggregateSql(x, by, where, extra = []) {
        const joins = new Map();
        const keys = by.map((d) => `${dimExpr(x, d, joins)} AS ${id(d)}`);
        const conds = Object.entries(where).map(([d, m]) => {
            const e = dimExpr(x, d, joins);
            return Array.isArray(m) ? `${e} IN (${m.map((x) => mid(d, x)).join(', ')})` : `${e} = ${mid(d, m)}`;
        });
        for (const f of extra) conds.push(filterSql(x, f, joins));
        const fn = x.rollupType === 'AVERAGE' ? 'avg' : 'sum';
        return `SELECT ${[...keys, `${fn}(s.v) AS v`].join(', ')} FROM ${from(x)} ${[...joins.values()].join(' ')}${conds.length ? ` WHERE ${conds.join(' AND ')}` : ''}${keys.length ? ` GROUP BY ${by.map((_, i) => i + 1).join(', ')}` : ''}`;
    }
    // A measure: its formula over sums at the read's slice, with RAMA's rules for missing values.
    function measureSql(v, by, where) {
        const parts = [];
        // With `by`, sum i is column v<i> of the row k. Else it is column v of t<i>.
        const onePass = by.length > 0;
        const ref = (i) => (onePass ? `k.v${i}` : `t${i}.v`);
        const walk = (n) => {
            switch (n.type) {
                case 'paren':
                    return walk(n.expr);
                case 'num':
                    return `CAST(${n.value} AS DOUBLE)`;
                case 'neg':
                    return `(-${walk(n.expr)})`;
                case 'name':
                    parts.push(aggregateSql(model.variable(n.name), by, where));
                    return ref(parts.length - 1);
                case 'call':
                    if (n.name !== 'sum') throw new Error(`${v.name}: ${n.fn} in a measure`);
                    parts.push(aggregateSql(model.variable(n.args[0].name), by, where, n.args.slice(1)));
                    return ref(parts.length - 1);
                case 'bin': {
                    const a = walk(n.left);
                    const b = walk(n.right);
                    if (n.op === '+' || n.op === '-') return `(CASE WHEN ${a} IS NULL AND ${b} IS NULL THEN NULL ELSE coalesce(${a}, 0) ${n.op} coalesce(${b}, 0) END)`;
                    if (n.op === '*') return `(${a} * ${b})`;
                    // Read as a measure, RAMA gives a missing numerator over a number as missing, not 0.
                    return `(CASE WHEN ${b} IS NULL OR ${b} = 0 THEN NULL ELSE ${a} / ${b} END)`;
                }
                default:
                    throw new Error(`${v.name}: ${n.type} in a measure`);
            }
        };
        const expr = walk(parseFormula(v.formula));
        const keyCols = by.map(id);
        const outer = by.map((d) => `k.${id(d)} AS ${id(d)}`);
        // The sums are tagged with their index and united, and one GROUP BY puts the sums of each key side by
        // side, so each sum runs once and no list of keys is joined back to them. Each sum has one row per
        // key. A key is there when any sum has a row for it, and a sum without a row for it is NULL, as with
        // the LEFT JOINs below.
        if (onePass) {
            const tagged = parts.map((p, i) => `SELECT ${i} AS part, ${keyCols.join(', ')}, v FROM (${p}) t${i}`).join(' UNION ALL ');
            const sums = parts.map((_, i) => `max(CASE WHEN part = ${i} THEN v END) AS v${i}`);
            return `SELECT * FROM (SELECT ${[...outer, `${expr} AS v`].join(', ')} FROM (SELECT ${[...keyCols, ...sums].join(', ')} FROM (${tagged}) u GROUP BY ${keyCols.join(', ')}) k) WHERE v IS NOT NULL`;
        }
        const ctes = parts.map((p, i) => `t${i} AS (${p})`);
        const keys = by.length ? `(${parts.map((_, i) => `SELECT ${keyCols.join(', ')} FROM t${i}`).join(CH ? ' UNION DISTINCT ' : ' UNION ')})` : '(SELECT 1 AS one)';
        const joins = parts.map((_, i) => (by.length ? `LEFT JOIN t${i} ON ${by.map((d) => `t${i}.${id(d)} = k.${id(d)}`).join(' AND ')}` : `CROSS JOIN t${i}`));
        return `WITH ${ctes.join(', ')} SELECT * FROM (SELECT ${[...outer, `${expr} AS v`].join(', ')} FROM ${keys} k ${joins.join(' ')}) WHERE v IS NOT NULL`;
    }


    const x = model.variable(variable);
    return x.measure ? measureSql(x, by, where) : `SELECT * FROM (${aggregateSql(x, by, where)}) WHERE v IS NOT NULL`;
}
