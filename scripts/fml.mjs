// Reads FML, the Financial Modeling Language the model is written in.
//
// It reads variable blocks, grains with pins, formulas (also wrapped over
// several lines), @properties and link statements. It checks what the website
// needs and is not a full validator.

export const SYSTEM_DIMENSIONS = new Set(['Years', 'Months', 'Versions', 'Quarters', 'Half years', 'Year to date']);

function stripComment(line) {
    let inString = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '\\' && inString) i++;
        else if (c === '"') inString = !inString;
        else if (c === '#' && !inString) return line.slice(0, i);
    }
    return line;
}

export function unquote(s) {
    s = s.trim();
    if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return s.slice(1, -1).replace(/\\(.)/g, '$1');
    return s;
}

// The index of the quote that closes the string opening at `start`, or -1.
function closingQuote(text, start) {
    for (let i = start + 1; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === '"') return i;
    }
    return -1;
}

// Splits a grain entry such as `"PL Line" = P100` at its first '=' outside quotes.
function splitPin(entry) {
    for (let i = 0; i < entry.length; i++) {
        if (entry[i] === '"') {
            const close = closingQuote(entry, i);
            if (close < 0) break;
            i = close;
        } else if (entry[i] === '=') return [entry.slice(0, i), entry.slice(i + 1)];
    }
    return [entry];
}

// Counts brackets outside strings. A positive result means the text is still open.
function openDepth(text) {
    let depth = 0;
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '\\' && inString) i++;
        else if (c === '"') inString = !inString;
        else if (!inString && (c === '{' || c === '(')) depth++;
        else if (!inString && (c === '}' || c === ')')) depth--;
    }
    return inString ? depth + 1 : depth;
}

const startsStatement = (line) => line === '' || line.startsWith('@') || line.startsWith('link ');
const continuesFormula = (next) => /^([+*/,)]|-(?!\d)|- )/.test(next) || next.startsWith('=');
const endsWithOperator = (text) => /[+\-*/,(=]$/.test(text.trimEnd());

// Splits "a, b, c" at the top level, ignoring commas inside quotes or brackets.
function splitTopLevel(text) {
    const parts = [];
    let depth = 0;
    let inString = false;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '\\' && inString) i++;
        else if (c === '"') inString = !inString;
        else if (!inString && (c === '(' || c === '{')) depth++;
        else if (!inString && (c === ')' || c === '}')) depth--;
        else if (!inString && depth === 0 && c === ',') {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts.map((p) => p.trim()).filter((p) => p !== '');
}

function parseProperty(text, variable, where, problems) {
    const m = text.trim().match(/^@([A-Za-z]+)\s*([\s\S]*)$/);
    if (!m) return problems.push({ level: 'error', where, msg: `cannot read property "${text.trim()}"` });
    const [, key, raw] = m;
    let value = raw.trim();
    if (value.startsWith('"')) value = unquote(value);
    else if (value === 'true' || value === 'false') value = value === 'true';
    else if (value !== '' && !Number.isNaN(Number(value))) value = Number(value);
    variable.props[key] = value;
}

function parseHeader(text, where, problems) {
    let rest = text.trim();
    let name;
    if (rest.startsWith('"')) {
        const end = closingQuote(rest, 0);
        if (end < 0) return problems.push({ level: 'error', where, msg: `unclosed quote in "${text.trim().slice(0, 60)}"` }) && null;
        name = unquote(rest.slice(0, end + 1));
        rest = rest.slice(end + 1).trim();
    } else {
        const m = rest.match(/^([^\s{]+)\s*/);
        if (!m) return problems.push({ level: 'error', where, msg: `cannot read a variable name in "${text.trim().slice(0, 60)}"` }) && null;
        name = m[1];
        rest = rest.slice(m[0].length);
    }
    if (!rest.startsWith('{')) return problems.push({ level: 'error', where, msg: `"${name}" has no grain` }) && null;
    let depth = 0;
    let end = -1;
    for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '"') {
            const close = closingQuote(rest, i);
            if (close < 0) break;
            i = close;
        } else if (rest[i] === '{') depth++;
        else if (rest[i] === '}' && --depth === 0) {
            end = i;
            break;
        }
    }
    if (end < 0) return problems.push({ level: 'error', where, msg: `"${name}" has an unclosed grain` }) && null;
    const grain = [];
    for (const entry of splitTopLevel(rest.slice(1, end))) {
        const [dim, pin] = splitPin(entry).map((s) => unquote(s));
        if (pin === '') problems.push({ level: 'error', where, msg: `"${name}" pins ${dim} to no member` });
        grain.push(pin ? { dim, pin } : { dim });
    }
    const variable = { name, grain, formula: null, props: {}, where };
    const tail = rest.slice(end + 1).trim();
    if (tail.startsWith('=')) {
        variable.formula = tail.slice(1).replace(/\s+/g, ' ').trim();
    } else if (tail.startsWith('@')) {
        for (const prop of tail.split(/\s(?=@)/)) parseProperty(prop, variable, where, problems);
    } else if (tail !== '') {
        problems.push({ level: 'error', where, msg: `unexpected text after the grain of "${name}": ${tail}` });
    }
    return variable;
}

// Returns { variables, links, problems }. Each problem has a level, where and msg.
export function parseFml(text, file) {
    const problems = [];
    const lines = text.split(/\r?\n/).map((l) => stripComment(l));
    const variables = [];
    const links = [];
    let current = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const where = `${file}:${i + 1}`;
        if (line === '') continue;
        if (line.startsWith('link ')) {
            const m = line.match(/^link\s+("[^"]+"|\S+)\s*->\s*("[^"]+"|[^\s:]+)\s*(?::\s*(\S+))?$/);
            if (!m) problems.push({ level: 'error', where, msg: `cannot read link "${line}"` });
            else links.push({ from: unquote(m[1]), to: unquote(m[2]), cardinality: m[3] || null, where });
            current = null;
            continue;
        }
        if (line.startsWith('@')) {
            let chunk = line;
            while (openDepth(chunk) > 0 && i + 1 < lines.length) chunk += '\n' + lines[++i];
            if (line.startsWith('@defaults')) {
                problems.push({ level: 'warning', where, msg: '@defaults is ignored, set properties per variable' });
                current = { props: {} };
            } else if (!current) problems.push({ level: 'error', where, msg: 'property without a variable above it' });
            else parseProperty(chunk, current, where, problems);
            continue;
        }
        // A variable block. Keep reading lines while the grain or a bracket is
        // open, or while the formula visibly continues on the next line.
        let chunk = line;
        for (;;) {
            const next = i + 1 < lines.length ? lines[i + 1].trim() : null;
            if (next === null) break;
            const needMore = openDepth(chunk) > 0 || !chunk.includes('{') || endsWithOperator(chunk);
            if (needMore ? next === '' && openDepth(chunk) <= 0 : startsStatement(next) || !continuesFormula(next)) break;
            chunk += ' ' + next;
            i++;
        }
        current = parseHeader(chunk, where, problems);
        if (current) variables.push(current);
    }
    return { variables, links, problems };
}

// Splits a formula into parts that keep every character. A part that names
// a variable has a `ref`. Function names, numbers and the two sides of a
// Dimension>Member filter are not names.
export function formulaParts(formula) {
    const tokens = [...formula.matchAll(/"(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z0-9_%.]*|>|\(|\S/g)];
    const parts = [];
    let pos = 0;
    tokens.forEach((m, i) => {
        if (m.index > pos) parts.push({ text: formula.slice(pos, m.index) });
        const t = m[0];
        const next = tokens[i + 1]?.[0];
        const prev = tokens[i - 1]?.[0];
        const isName = (t.startsWith('"') || /^[A-Za-z_]/.test(t)) && next !== '(' && next !== '>' && prev !== '>';
        parts.push(isName ? { text: t, ref: unquote(t) } : { text: t });
        pos = m.index + t.length;
    });
    if (pos < formula.length) parts.push({ text: formula.slice(pos) });
    return parts;
}

export const formulaNames = (formula) => formulaParts(formula).filter((p) => p.ref).map((p) => p.ref);
