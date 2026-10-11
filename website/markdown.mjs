// Renders the Markdown the repo's docs use. That is headings, paragraphs,
// flat lists, tables, block quotes, fenced code, inline code, bold and links.
// It throws on an unclosed code fence or a table row with the wrong number of
// cells, so the docs stay inside this subset.

export const escapeHtml = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const slug = (text) =>
    text.toLowerCase().replace(/%/g, ' pct').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const bold = (s) => s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

// opts.link(href) gives the URL for a Markdown link.
// opts.codeLink(text) gives a URL for an inline code span, or null.
export function renderInline(text, opts = {}) {
    const { link = (href) => href, codeLink = () => null } = opts;
    const codes = [];
    const links = [];
    let s = text.replace(/`([^`]+)`/g, (_, code) => `\u0001${codes.push(code) - 1}\u0001`);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `\u0002${links.push({ label, href }) - 1}\u0002`);
    s = bold(escapeHtml(s));
    s = s.replace(/\u0002(\d+)\u0002/g, (_, i) => {
        const { label, href } = links[i];
        const inner = bold(escapeHtml(label)).replace(/\u0001(\d+)\u0001/g, (_, j) => `<code>${escapeHtml(codes[j])}</code>`);
        return `<a href="${escapeHtml(link(href))}">${inner}</a>`;
    });
    return s.replace(/\u0001(\d+)\u0001/g, (_, i) => {
        const code = `<code>${escapeHtml(codes[i])}</code>`;
        const href = codeLink(codes[i]);
        return href ? `<a href="${escapeHtml(href)}">${code}</a>` : code;
    });
}

const isBlank = (line) => line.trim() === '';
const isFence = (line) => line.startsWith('```');
const isHeading = (line) => /^#{1,6}\s/.test(line);
const isQuote = (line) => line.startsWith('>');
const isItem = (line) => /^([-*]|\d+\.)\s+/.test(line);
const isSeparator = (line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line ?? '');
const cellsOf = (row) =>
    row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

// Returns { html, headings }. Each heading has a level, its text and its id.
export function renderMarkdown(src, opts = {}) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const inline = (text) => renderInline(text, opts);
    const isTable = (i) => lines[i].startsWith('|') && isSeparator(lines[i + 1]);
    const html = [];
    const headings = [];
    const used = new Set();
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (isBlank(line)) {
            i++;
        } else if (isFence(line)) {
            const start = i++;
            const body = [];
            while (i < lines.length && !isFence(lines[i])) body.push(lines[i++]);
            if (i === lines.length) throw new Error(`code fence opened on line ${start + 1} is never closed`);
            i++;
            html.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
        } else if (isHeading(line)) {
            const [, hashes, text] = line.match(/^(#{1,6})\s+(.*)$/);
            const base = slug(text.replace(/`/g, ''));
            let id = base;
            for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
            used.add(id);
            headings.push({ level: hashes.length, text, id });
            html.push(`<h${hashes.length} id="${id}">${inline(text.trim())}</h${hashes.length}>`);
            i++;
        } else if (isTable(i)) {
            const head = cellsOf(lines[i]);
            const rows = [];
            for (i += 2; i < lines.length && lines[i].startsWith('|'); i++) {
                const cells = cellsOf(lines[i]);
                if (cells.length !== head.length) throw new Error(`table row on line ${i + 1} has ${cells.length} cells, the header has ${head.length}`);
                rows.push(cells);
            }
            const tr = (cells, tag) => `<tr>${cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join('')}</tr>`;
            html.push(`<div class="table-wrap"><table><thead>${tr(head, 'th')}</thead><tbody>${rows.map((r) => tr(r, 'td')).join('')}</tbody></table></div>`);
        } else if (isQuote(line)) {
            const body = [];
            while (i < lines.length && isQuote(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
            html.push(`<blockquote>${renderMarkdown(body.join('\n'), opts).html}</blockquote>`);
        } else if (isItem(line)) {
            const tag = /^\d/.test(line) ? 'ol' : 'ul';
            const items = [];
            while (i < lines.length && (isItem(lines[i]) || (items.length > 0 && /^\s{2,}\S/.test(lines[i])))) {
                if (isItem(lines[i])) items.push(lines[i].replace(/^([-*]|\d+\.)\s+/, ''));
                else items[items.length - 1] += ' ' + lines[i].trim();
                i++;
            }
            html.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`);
        } else {
            const body = [];
            while (i < lines.length && !isBlank(lines[i]) && !isFence(lines[i]) && !isHeading(lines[i]) && !isQuote(lines[i]) && !isItem(lines[i]) && !isTable(i)) {
                body.push(lines[i++].trim());
            }
            html.push(`<p>${inline(body.join(' '))}</p>`);
        }
    }
    return { html: html.join('\n'), headings };
}
