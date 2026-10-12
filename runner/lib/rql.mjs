// Reads one formula into a small syntax tree.
//
// The grammar is RAMA's: the operators are + - * / and unary minus. Comparisons are functions
// (eq, gt, gte, lt, lte). '>' only separates Dim>Member. A name is a run of letters, digits and '_',
// or a "quoted string". Function names ignore case.
//
// Nodes: num { value }, name { name }, member { dim, member }, neg { expr }, paren { expr },
// bin { op, left, right }, call { fn, name (lower case), args }.

function tokenize(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        const pos = i;
        if (c === '"') {
            let s = '';
            i++;
            while (i < src.length && src[i] !== '"') {
                if (src[i] === '\\') i++;
                s += src[i++];
            }
            if (src[i] !== '"') throw new Error(`unclosed quote at ${pos} in ${src}`);
            i++;
            toks.push({ t: 'name', v: s, quoted: true, pos });
        } else if (/[0-9.]/.test(c)) {
            const m = /^[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/.exec(src.slice(i));
            toks.push({ t: 'num', v: Number(m[0]), text: m[0], pos });
            i += m[0].length;
        } else if (/[A-Za-z_]/.test(c)) {
            const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
            toks.push({ t: 'name', v: m[0], quoted: false, pos });
            i += m[0].length;
        } else if ('+-*/(),>'.includes(c)) {
            toks.push({ t: c, pos });
            i++;
        } else throw new Error(`unexpected "${c}" at ${pos} in ${src}`);
    }
    toks.push({ t: 'eof', pos: src.length });
    return toks;
}

export function parseFormula(src) {
    const toks = tokenize(src);
    let k = 0;
    const peek = () => toks[k];
    const next = () => toks[k++];
    const fail = (tok, what) => {
        throw new Error(`expected ${what} at ${tok.pos} in ${src}`);
    };

    function expression() {
        let left = product();
        while (peek().t === '+' || peek().t === '-') left = { type: 'bin', op: next().t, left, right: product() };
        return left;
    }
    function product() {
        let left = unary();
        while (peek().t === '*' || peek().t === '/') left = { type: 'bin', op: next().t, left, right: unary() };
        return left;
    }
    function unary() {
        if (peek().t === '-') {
            next();
            return { type: 'neg', expr: unary() };
        }
        return primary();
    }
    function primary() {
        const tok = next();
        if (tok.t === 'num') return { type: 'num', value: tok.v };
        if (tok.t === '(') {
            const expr = expression();
            if (next().t !== ')') fail(toks[k - 1], "')'");
            return { type: 'paren', expr };
        }
        if (tok.t !== 'name') fail(tok, 'a value');
        if (!tok.quoted && peek().t === '(') {
            next();
            const args = [];
            if (peek().t !== ')') {
                for (;;) {
                    args.push(expression());
                    if (peek().t !== ',') break;
                    next();
                }
            }
            if (next().t !== ')') fail(toks[k - 1], "',' or ')'");
            return { type: 'call', fn: tok.v, name: tok.v.toLowerCase(), args };
        }
        if (peek().t === '>') {
            next();
            const m = next();
            if (m.t !== 'name' && m.t !== 'num') fail(m, 'a member');
            return { type: 'member', dim: tok.v, member: m.t === 'num' ? m.text : m.v };
        }
        return { type: 'name', name: tok.v };
    }

    const ast = expression();
    if (peek().t !== 'eof') fail(peek(), 'the end of the formula');
    return ast;
}

/** Every node of a tree, depth first. */
export function* nodesOf(node) {
    if (!node) return;
    yield node;
    if (node.type === 'bin') {
        yield* nodesOf(node.left);
        yield* nodesOf(node.right);
    } else if (node.type === 'neg' || node.type === 'paren') yield* nodesOf(node.expr);
    else if (node.type === 'call') for (const a of node.args) yield* nodesOf(a);
}
