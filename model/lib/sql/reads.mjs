// SQL for the reads of test R4, in DuckDB's or ClickHouse's dialect: measures computed at a slice from the
// sums they need. The other reads are written in each test.

import { parseFormula } from '../rql.mjs';

const id = (s) => `"${String(s).replace(/"/g, '""')}"`;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Several measures at once, by `by` where `where`: one row per measure and key, with the columns measure,
 * the `by` dimensions and v. Each variable is scanned once. A sum with a filter is a conditional sum in
 * that scan, sumIf in ClickHouse and FILTER in DuckDB, so a variable that many measures read is still read
 * once. `by` must not be empty.
 */
export function measuresSql(model, names, { by, where = {} }, dialect = 'duckdb', dict) {
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
        if (!joins.has(alias)) joins.set(alias, `JOIN ${id(`flat ${g}`)} ${alias} ON ${alias}.${id(g)} = s.${id(g)}`);
        return `${alias}.${id(d)}`;
    }
    function filterSql(x, f, joins) {
        if (f.type === 'paren') return filterSql(x, f.expr, joins);
        if (f.type === 'member') return `${dimExpr(x, f.dim, joins)} = ${mid(f.dim, f.member)}`;
        if (f.type === 'call' && f.name === 'not') return `(NOT ${filterSql(x, f.args[0], joins)})`;
        if (f.type === 'call' && (f.name === 'or' || f.name === 'and')) return `(${f.args.map((a) => filterSql(x, a, joins)).join(f.name === 'or' ? ' OR ' : ' AND ')})`;
        throw new Error(`cannot filter by ${f.type}`);
    }
    const scans = new Map(); // variable name -> { x, joins, cols: Map(condition -> column) }
    let n = 0;
    const sumOf = (x, filters) => {
        if (!scans.has(x.name)) scans.set(x.name, { x, joins: new Map(), cols: new Map() });
        const scan = scans.get(x.name);
        const cond = filters.map((f) => filterSql(x, f, scan.joins)).join(' AND ');
        if (!scan.cols.has(cond)) scan.cols.set(cond, `c${n++}`);
        return `k.${scan.cols.get(cond)}`;
    };
    // A measure's formula over the sums, with RAMA's rules for missing values.
    const walk = (v, e) => {
        switch (e.type) {
            case 'paren':
                return walk(v, e.expr);
            case 'num':
                return `CAST(${e.value} AS DOUBLE)`;
            case 'neg':
                return `(-${walk(v, e.expr)})`;
            case 'name':
                return sumOf(model.variable(e.name), []);
            case 'call':
                if (e.name !== 'sum') throw new Error(`${v.name}: ${e.fn} in a measure`);
                return sumOf(model.variable(e.args[0].name), e.args.slice(1));
            case 'bin': {
                const a = walk(v, e.left);
                const b = walk(v, e.right);
                if (e.op === '+' || e.op === '-') return `(CASE WHEN ${a} IS NULL AND ${b} IS NULL THEN NULL ELSE coalesce(${a}, 0) ${e.op} coalesce(${b}, 0) END)`;
                if (e.op === '*') return `(${a} * ${b})`;
                // Read as a measure, RAMA gives a missing numerator over a number as missing, not 0.
                return `(CASE WHEN ${b} IS NULL OR ${b} = 0 THEN NULL ELSE ${a} / ${b} END)`;
            }
            default:
                throw new Error(`${v.name}: ${e.type} in a measure`);
        }
    };
    const exprs = names.map((name) => [name, walk(model.variable(name), parseFormula(model.variable(name).formula))]);
    const keyCols = by.map(id);
    const all = [...scans.values()].flatMap((scan) => [...scan.cols.values()]);
    // One scan per variable. Each gives its own columns and NULL for the others, so the scans can be united
    // and one GROUP BY puts every sum of a key side by side.
    const parts = [...scans.values()].map(({ x, joins, cols }) => {
        const keys = by.map((d) => `${dimExpr(x, d, joins)} AS ${id(d)}`);
        const conds = Object.entries(where).map(([d, m]) => {
            const e = dimExpr(x, d, joins);
            return Array.isArray(m) ? `${e} IN (${m.map((x) => mid(d, x)).join(', ')})` : `${e} = ${mid(d, m)}`;
        });
        // A key whose rows match no condition would give only missing sums, so those rows are left out early.
        if (![...cols.keys()].includes('')) conds.push(`(${[...cols.keys()].join(' OR ')})`);
        const fn = x.rollupType === 'AVERAGE' ? 'avg' : 'sum';
        const own = new Map([...cols].map(([cond, c]) => [c, !cond ? `${fn}(s.v)` : CH ? `${fn}If(s.v, ${cond})` : `${fn}(s.v) FILTER (WHERE ${cond})`]));
        const none = CH ? 'CAST(NULL AS Nullable(Float64))' : 'CAST(NULL AS DOUBLE)';
        const sel = all.map((c) => `${own.get(c) ?? none} AS ${c}`);
        return `SELECT ${[...keys, ...sel].join(', ')} FROM ${from(x)} ${[...joins.values()].join(' ')}${conds.length ? ` WHERE ${conds.join(' AND ')}` : ''} GROUP BY ${by.map((_, i) => i + 1).join(', ')}`;
    });
    const k = `SELECT ${[...keyCols, ...all.map((c) => `max(${c}) AS ${c}`)].join(', ')} FROM (${parts.join(' UNION ALL ')}) u GROUP BY ${keyCols.join(', ')}`;
    const outKeys = by.map((d) => `k.${id(d)} AS ${id(d)}`);
    if (CH) {
        // ARRAY JOIN gives each key one row per measure, from one pass over the sums.
        const list = exprs.map(([name, e]) => `(${lit(name)}, ${e})`).join(', ');
        return `SELECT tupleElement(m, 1) AS measure, ${outKeys.join(', ')}, tupleElement(m, 2) AS v FROM (${k}) AS k ARRAY JOIN [${list}] AS m WHERE tupleElement(m, 2) IS NOT NULL`;
    }
    // DuckDB keeps a MATERIALIZED CTE once, so each measure reads the sums without scanning again.
    return `WITH k AS MATERIALIZED (${k})\n${exprs.map(([name, e]) => `SELECT ${lit(name)} AS measure, ${outKeys.join(', ')}, v FROM (SELECT ${outKeys.join(', ')}, ${e} AS v FROM k) k WHERE v IS NOT NULL`).join('\nUNION ALL\n')}`;
}
