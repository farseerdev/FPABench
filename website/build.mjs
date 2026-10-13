// Builds the website from the repo's own docs and model, so the site never
// says anything the repo does not.
//
//   node website/build.mjs           writes website/dist/
//   node website/build.mjs --check   only checks, writes nothing
//
// The home page shows the results. There are no real results yet, so it shows
// random ones from demo.mjs, under a banner that says so. The about page
// comes from README.md. The model page comes from website/model.md, a short
// version of model/README.md for planners. Its version line, its hierarchies
// and its FML example are read from the model files, and its P&L table must
// list every line of the model's P&L. The build stops on a broken link, an
// unknown variable or a model file it cannot read.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFml, formulaNames } from '../scripts/fml.mjs';
import { renderMarkdown, escapeHtml } from './markdown.mjs';
import { demoResults, APPROACHES } from './demo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'website', 'dist');
const REPO_URL = 'https://github.com/farseerdev/FPABench';
const MODEL_PAGE = 'website/model.md';
const FML_EXAMPLE = 'Gross Margin';
const PAGES = { 'README.md': 'about.html', [MODEL_PAGE]: 'model.html', 'tests/README.md': 'tests.html', 'tests/method.md': 'method.html', 'data/README.md': 'data.html' };
const VERSIONED_DOCS = ['README.md', 'model/README.md', 'tests/README.md', 'tests/method.md'];
const TEST_KINDS = ['load', 'write', 'read', 'model'];
const ASSETS = ['style.css', 'site.js', 'results.js'];

const errors = [];
const fail = (msg) => errors.push(msg);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// --- the model ----------------------------------------------------------------------------

const modelFiles = fs.readdirSync(path.join(ROOT, 'model')).filter((f) => f.endsWith('.fml')).sort();
const variables = [];
const links = [];
for (const file of modelFiles) {
    const parsed = parseFml(read(`model/${file}`), `model/${file}`);
    for (const p of parsed.problems) (p.level === 'error' ? fail : console.warn)(`${p.where}: ${p.msg}`);
    variables.push(...parsed.variables.map((v) => ({ ...v, file })));
    links.push(...parsed.links.map((l) => ({ ...l, file })));
}

const byName = new Map();
for (const v of variables) {
    if (byName.has(v.name)) fail(`${v.where}: "${v.name}" is declared twice`);
    byName.set(v.name, v);
}

for (const v of variables) {
    if (!v.formula) continue;
    for (const ref of new Set(formulaNames(v.formula))) {
        if (!byName.has(ref)) fail(`${v.where}: "${v.name}" reads "${ref}", which is not a variable`);
    }
}

const fixedDimensions = fs
    .readdirSync(path.join(ROOT, 'model', 'dimensions'))
    .filter((f) => f.endsWith('.csv'))
    .sort()
    .map((f) => {
        const rel = `model/dimensions/${f}`;
        const [header, ...rows] = read(rel).trim().split(/\r?\n/);
        if (/"/.test(header + rows.join(''))) fail(`${rel}: quoted CSV fields are not supported`);
        const columns = header.split(',');
        const cells = rows.map((r) => r.split(','));
        cells.forEach((r, i) => r.length !== columns.length && fail(`${rel}:${i + 2}: ${r.length} fields, the header has ${columns.length}`));
        return { name: columns[0], columns, rows: cells };
    });

// --- links in the docs ----------------------------------------------------------------------

// A relative link that points at a rendered doc goes to its page. Any other
// relative link goes to the file or folder on GitHub, and it must exist.
function linker(docPath) {
    const dir = path.posix.dirname(docPath);
    return (href) => {
        if (/^[a-z]+:/i.test(href) || href.startsWith('#')) return href;
        const [target, hash] = href.split('#');
        const rel = path.posix.normalize(path.posix.join(dir, target)).replace(/\/$/, '');
        const anchor = hash ? `#${hash}` : '';
        if (PAGES[rel]) return PAGES[rel] + anchor;
        const abs = path.join(ROOT, rel);
        if (!fs.existsSync(abs)) {
            fail(`${docPath}: the link to ${href} points at nothing`);
            return href;
        }
        return `${REPO_URL}/${fs.statSync(abs).isDirectory() ? 'tree' : 'blob'}/main/${rel}${anchor}`;
    };
}

// Inline code that names a variable or a model file links to it on GitHub.
const codeLink = (code) => {
    const name = code.replace(/^"(.*)"$/, '$1');
    if (byName.has(name)) {
        const [file, line] = byName.get(name).where.split(':');
        return `${REPO_URL}/blob/main/${file}#L${line}`;
    }
    if (modelFiles.includes(code)) return `${REPO_URL}/blob/main/model/${code}`;
    return null;
};

function renderDoc(rel, src) {
    try {
        return renderMarkdown(src, { link: linker(rel), codeLink });
    } catch (e) {
        fail(`${rel}: ${e.message}`);
        return { html: '', headings: [] };
    }
}

// --- the model page -----------------------------------------------------------------------

const quoteName = (s) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `"${s}"`);
const grainText = (v) =>
    v.grain.length === 0 ? '{ }' : `{ ${v.grain.map((g) => (g.pin ? `${quoteName(g.dim)} = ${quoteName(g.pin)}` : quoteName(g.dim))).join(', ')} }`;

// The hierarchies, one line per path, read from the link statements. A
// dimension's deepest parent continues its line. Parents that have no parents
// of their own are listed together.
function hierarchies() {
    const parents = new Map();
    for (const l of links) {
        if (!parents.has(l.from)) parents.set(l.from, []);
        parents.get(l.from).push(l.to);
    }
    const depths = new Map();
    let loops = false;
    const depth = (d, seen = []) => {
        if (seen.includes(d)) {
            fail(`model/relations.fml: the links loop through ${[...seen, d].join(' → ')}`);
            loops = true;
            return 0;
        }
        if (!depths.has(d)) depths.set(d, Math.max(0, ...(parents.get(d) || []).map((p) => 1 + depth(p, [...seen, d]))));
        return depths.get(d);
    };
    for (const d of parents.keys()) depth(d);
    if (loops) return '';
    const paths = (d) => {
        const above = parents.get(d);
        const ends = above.filter((p) => !parents.has(p));
        const deep = above.filter((p) => parents.has(p));
        if (deep.length === 0) return [[d, ends.join(', ')]];
        const main = deep.reduce((a, b) => (depth(b) > depth(a) ? b : a));
        const [first, ...rest] = paths(main);
        const out = [[d, ...first], ...rest];
        if (ends.length > 0) out.push([d, ends.join(', ')]);
        for (const p of deep.filter((p) => p !== main)) {
            const [line, ...more] = paths(p);
            out.push([d, ...line], ...more);
        }
        return out;
    };
    const tops = new Set(links.map((l) => l.to));
    const bottoms = [...parents.keys()].filter((d) => !tops.has(d));
    return bottoms
        .flatMap(paths)
        .map((p) => `- ${p.join(' → ')}`)
        .join('\n');
}

// The FML example is read from the model, so it is always a real variable.
function fmlExample() {
    const v = byName.get(FML_EXAMPLE);
    if (!v || !v.formula || v.grain.length === 0) {
        fail(`${MODEL_PAGE}: the FML example "${FML_EXAMPLE}" is not a stored calculation of the model`);
        return '';
    }
    const word = (d) => ({ Versions: 'version', Years: 'year', Months: 'month' })[d] || (d === d.toUpperCase() ? d : d.toLowerCase());
    const dims = v.grain.map((g) => word(g.dim));
    const list = dims.length > 1 ? `${dims.slice(0, -1).join(', ')} and ${dims.at(-1)}` : dims[0];
    return ['```', `${quoteName(v.name)} ${grainText(v)} = ${v.formula}`, '```', '', `${v.name} holds one number per ${list}.`].join('\n');
}

// Every line of the model's P&L must be in the page's P&L table, and the table
// may not list a line the model lacks. Subtotal rows start with "=", in bold,
// and are not checked.
function checkPnl(src) {
    const section = src.split(/^## /m).find((s) => s.startsWith('The P&L\n'));
    const lines = fixedDimensions.find((d) => d.name === 'PL Line');
    if (!section || !lines) {
        fail(`${MODEL_PAGE}: it needs a "## The P&L" section, and model/dimensions needs PL Line.csv`);
        return;
    }
    const label = lines.columns.indexOf('@description');
    const modelLines = new Map(lines.rows.map((r) => [r[label], r[0]]));
    const shown = section
        .split('\n')
        .filter((l) => l.startsWith('|'))
        .slice(2)
        .map((row) => row.split('|')[1].replace(/\*\*/g, '').trim())
        .filter((name) => !name.startsWith('='))
        .map((name) => name.replace(/^[−-]\s*/, ''));
    for (const name of shown) {
        if (!modelLines.has(name)) fail(`${MODEL_PAGE}: "${name}" in the P&L table is not a line in model/dimensions/PL Line.csv`);
    }
    for (const [name, member] of modelLines) {
        if (!shown.includes(name)) fail(`${MODEL_PAGE}: the P&L table has no row for ${member} ${name}`);
    }
}

function modelPage() {
    let src = read(MODEL_PAGE);
    checkPnl(src);
    const parts = {
        version: `Version ${version}.${/draft/.test(version) ? ' The model can still change before version 1.' : ''} Every change is in the [changelog](../CHANGELOG.md).`,
        hierarchies: hierarchies(),
        'fml-example': fmlExample(),
    };
    for (const [key, text] of Object.entries(parts)) {
        const count = src.split(`{{${key}}}`).length - 1;
        if (count !== 1) fail(`${MODEL_PAGE}: {{${key}}} must appear once, it appears ${count} times`);
        src = src.replace(`{{${key}}}`, () => text);
    }
    for (const left of src.match(/\{\{[^}]*\}\}/g) || []) fail(`${MODEL_PAGE}: unknown placeholder ${left}`);
    return renderDoc(MODEL_PAGE, src).html;
}

// --- pages ----------------------------------------------------------------------------------

const version = (read('CHANGELOG.md').match(/^## ([^,\s]+)/m) || [])[1];
if (!version) fail('CHANGELOG.md: no version heading such as "## 0.1-draft, 2026-10-04"');
// A doc that names a version must name the one at the top of the changelog.
for (const doc of VERSIONED_DOCS) {
    for (const [, named] of read(doc).matchAll(/\b[Vv]ersion (\d+\.\d+[\w-]*)/g)) {
        if (named !== version) fail(`${doc}: it says version ${named}, the changelog says ${version}`);
    }
}

// The test list, as the runner reads it.
const testList = JSON.parse(read('tests/tests.json')).tests || [];
for (const t of testList) {
    if (!t.id || !t.name || !TEST_KINDS.includes(t.kind) || !t.status) fail(`tests/tests.json: test ${t.id || '?'} needs an id, a name, a kind (${TEST_KINDS.join(', ')}) and a status`);
}

// The first heading and the tagline of README.md become the title line.
const readme = read('README.md');
const [, siteName = 'FPABench', tagline = ''] = readme.match(/^# (.+)\n+(.+)\n/) || [];
if (!tagline) fail('README.md: it must start with "# <name>" and a one-line tagline');
const about = renderDoc('README.md', readme.replace(/^# .+\n+.+\n/, ''));

const modelHtml = modelPage();

const subtitle = tagline.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());
const NAV = [
    ['index.html', 'Results'],
    ['tests.html', 'Tests'],
    ['method.html', 'Method'],
    ['data.html', 'Data'],
    ['model.html', 'The model'],
    ['about.html', 'About'],
    [`${REPO_URL}/blob/main/CHANGELOG.md`, 'Changelog'],
    [REPO_URL, 'Source on GitHub'],
];

// Real results, from results/<size>/<entry>.json. Each entry describes itself in systems/<entry>/entry.json.
// The demo data is only used while there are no results at all.
function realResults(tests) {
    const dir = path.join(ROOT, 'results');
    if (!fs.existsSync(dir)) return null;
    const ids = new Set(tests.map((t) => t.id));
    const rows = [];
    const entries = new Map();
    const machines = new Set();
    const hosts = new Set();
    for (const size of fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort()) {
        for (const file of fs.readdirSync(path.join(dir, size)).filter((f) => f.endsWith('.json')).sort()) {
            const rel = `results/${size}/${file}`;
            const r = JSON.parse(read(rel));
            const metaFile = `systems/${r.entry}/entry.json`;
            if (!fs.existsSync(path.join(ROOT, metaFile))) {
                fail(`${rel}: there is no ${metaFile}`);
                continue;
            }
            const meta = JSON.parse(read(metaFile));
            entries.set(r.entry, { id: r.entry, name: meta.name, approach: meta.approach, open: meta.open });
            machines.add(r.machine);
            hosts.add(JSON.stringify({ cpus: r.host?.cpus, cpu: r.host?.cpu, memoryGB: r.host?.memoryGB }));
            const kept = {};
            for (const [id, t] of Object.entries(r.tests)) {
                if (!ids.has(id)) continue;
                kept[id] = { check: t.check, time: t.time, cold: t.cold, p95: t.p95 };
            }
            rows.push({ entry: r.entry, scale: r.scale, tests: kept });
        }
    }
    if (rows.length === 0) return null;
    if (machines.size !== 1) fail(`results/: one machine expected, found ${[...machines].join(', ')}`);
    if (hosts.size !== 1) fail(`results/: one kind of host expected, found ${[...hosts].join(', ')}`);
    const order = ['10m', '100m', '1b', '10b'];
    // Every size is listed. Sizes without results yet are shown but cannot be picked.
    const scales = order;
    const ready = order.filter((s) => rows.some((r) => r.scale === s));
    const approaches = APPROACHES;
    return {
        demo: false,
        machine: [...machines][0],
        host: JSON.parse([...hosts][0]),
        kinds: [
            { id: 'load', label: 'Loads' },
            { id: 'write', label: 'Writes' },
            { id: 'read', label: 'Reads' },
            { id: 'model', label: 'Model changes' },
        ],
        tests: tests.map(({ id, name, kind, status }) => ({ id, name, kind, status })),
        scales,
        ready,
        approaches: approaches.filter((a) => [...entries.values()].some((e) => e.approach === a.id)),
        entries: [...entries.values()],
        results: rows,
    };
}

// The results page. Its script draws everything from the data embedded here.
// The checks without a timer pass or fail. They are not timed or scored, so the results page leaves them out.
const timedTests = testList.filter((t) => t.timed !== false);
const results = realResults(timedTests) || demoResults(timedTests);

// What each size holds, counted from the generated data by data/sizes.mjs.
const generatorVersion = (read('data/generate.mjs').match(/GENERATOR_VERSION = '([^']+)'/) || [])[1];
const sizeFacts = fs.existsSync(path.join(ROOT, 'data', 'sizes.json')) ? JSON.parse(read('data/sizes.json')).sizes : [];
for (const f of sizeFacts) {
    if (f.generator !== generatorVersion) fail(`data/sizes.json: ${f.size} was counted with generator ${f.generator}, the generator is ${generatorVersion}. Run data/sizes.mjs again.`);
}
const resultsHtml = [
    results.demo
        ? '<blockquote class="demo"><p><strong>Demo data.</strong> The tests are the real ones, but every result and time on this page is random. It only shows how the page will work. There are no real results yet.</p></blockquote>'
        : `<blockquote class="demo"><p><strong>First draft results.</strong> ${results.entries.length} entries, one run each on one machine. <a href="${REPO_URL}/blob/main/results/README.md">The results notes</a> list what is still missing.</p></blockquote>`,
    '<table class="selectors" id="selectors"></table>',
    '<noscript><p>The results need JavaScript.</p></noscript>',
    '<p class="method">The scale is the size of the dataset. Each size is named by about how many cells the model stores, so 10m holds about 10 million cells and 10b about 10 billion. Every system loads the same files. <a href="data.html#sizes">The data page</a> lists what each size holds.</p>',
    `<p class="method">Lower is better. Every result comes from the same Google Cloud ${escapeHtml(results.machine)} machine${results.host ? `, with ${results.host.cpus} vCPUs on an ${escapeHtml(results.host.cpu)} and ${results.host.memoryGB} GB of memory` : ''}. No system is tuned for speed or limited to fewer threads. Each one uses as many cores as it can. Each time is divided by the fastest entry's time on that test, with 10 ms added to both. Hiding an entry does not change the others' scores. A failed test counts as twice the largest of 300 s, the entry's slowest time and the slowest success on that test. Loads, writes, reads and model changes each get their own score, with no combined score. <a href="method.html">The method</a> has the details.</p>`,
    '<div id="summary"></div>',
    '<h2 id="details-heading">Detailed comparison</h2>',
    '<p class="method">Untick a test to leave it out of the score. <a href="tests.html">The tests</a> page says what each one does.</p>',
    '<div id="details"></div>',
    `<script id="results-data" type="application/json">${JSON.stringify(results).replace(/</g, '\\u003c')}</script>`,
].join('\n');

// The data page. On the website the size table of data/README.md becomes one table with every
// count from data/sizes.json, and the commands to run the generator stay on GitHub.
function dataPage() {
    const rel = 'data/README.md';
    let src = read(rel).replace(/^# .+\n+/, '');
    const use = src.match(/\n## Use\n[\s\S]*?(?=\n## )/);
    if (use) src = src.replace(use[0], '');
    else fail(`${rel}: no "## Use" section to leave out of the website.`);
    const table = src.match(/(?<=\n## Sizes\n[\s\S]*?)(\|.*\|\n)+/);
    if (!table || sizeFacts.length === 0) {
        if (!table) fail(`${rel}: no table in the "## Sizes" section.`);
        return renderDoc(rel, src).html;
    }
    // Model and input cells come from a model run, so they stay in the README table.
    const [header, , ...lines] = table[0].trim().split('\n').map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
    const cells = Object.fromEntries(lines.map((l) => [l[0], l]));
    const column = (name) => header.indexOf(name);
    for (const name of ['Model cells', 'Input cells']) if (column(name) < 0) fail(`${rel}: the size table has no "${name}" column.`);
    const n = (x) => (typeof x === 'number' ? x.toLocaleString('en-US') : escapeHtml(x ?? '–'));
    const head = `<tr><th></th>${sizeFacts.map((f) => `<th class="num">${escapeHtml(f.size)}</th>`).join('')}</tr>`;
    const row = (label, get) => `<tr><td>${escapeHtml(label)}</td>${sizeFacts.map((f) => `<td class="num">${n(get(f))}</td>`).join('')}</tr>`;
    const html = [
        `<div class="table-wrap"><table><thead>${head}</thead><tbody>`,
        row('Model cells', (f) => cells[f.size]?.[column('Model cells')]),
        row('Input cells', (f) => cells[f.size]?.[column('Input cells')]),
        ...Object.keys(sizeFacts[0].dimensions).map((d) => row(d, (f) => f.dimensions[d])),
        row('Sales rows, actuals', (f) => f.actuals.salesRows),
        row('Other actual rows', (f) => f.actuals.otherRows),
        ...Object.keys(sizeFacts[0].plan).map((v) => row(`Plan rows typed, ${v}`, (f) => f.plan[v])),
        '</tbody></table></div>',
    ].join('\n');
    return renderDoc(rel, src.replace(table[0], 'SIZE-TABLE\n')).html.replace('<p>SIZE-TABLE</p>', html);
}

function page({ title, body, current, scripts = [], wide = false }) {
    const nav = NAV.map(([href, label]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a>`).join(' | ');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(siteName)}: ${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(tagline)}">
<link rel="stylesheet" href="style.css">
<script>try { const t = localStorage.getItem('fpabench-theme'); if (t) document.documentElement.dataset.theme = t; } catch {}</script>
<script src="site.js" defer></script>
<!-- Cloudflare Web Analytics: no cookies and no personal data. -->
<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "e5f613c4d0ca46aa95283ab1fbc50682"}'></script>
${scripts.map((s) => `<script src="${s}" defer></script>`).join('\n')}
</head>
<body>
<header class="site-header">
<div class="title-row">
<h1 class="site-title"><a href="index.html">${escapeHtml(siteName)}</a>: ${escapeHtml(title)}</h1>
<div class="theme-switch"><button type="button" data-theme-choice="dark" aria-label="Dark theme" title="Dark theme">☾</button><button type="button" data-theme-choice="light" aria-label="Light theme" title="Light theme">☀</button></div>
</div>
<nav class="nav">${nav}</nav>
</header>
<main${wide ? ' class="wide"' : ''}>
${body}
</main>
<footer class="site-footer">
<p>${escapeHtml(siteName)} ${escapeHtml(version || '')}. Made by Farseer. Code is licensed under Apache-2.0. The model, the data and the documentation are licensed under CC BY 4.0.</p>
</footer>
</body>
</html>
`;
}

const pages = {
    'index.html': page({ title: subtitle, body: resultsHtml, current: 'index.html', scripts: ['results.js'], wide: true }),
    'about.html': page({ title: 'about', body: about.html, current: 'about.html' }),
    'tests.html': page({ title: 'the tests', body: renderDoc('tests/README.md', read('tests/README.md').replace(/^# .+\n+/, '')).html, current: 'tests.html' }),
    'data.html': page({ title: 'the data', body: dataPage(), current: 'data.html' }),
    'method.html': page({ title: 'the method', body: renderDoc('tests/method.md', read('tests/method.md').replace(/^# .+\n+/, '')).html, current: 'method.html' }),
    'model.html': page({ title: 'the model', body: modelHtml, current: 'model.html' }),
};

if (errors.length > 0) {
    console.error(`The site was not built. ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
}
if (process.argv.includes('--check')) {
    console.log(`OK. ${Object.keys(pages).length} pages, ${variables.length} variables, ${links.length} links.`);
} else {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
    for (const [name, html] of Object.entries(pages)) fs.writeFileSync(path.join(OUT, name), html);
    for (const asset of ASSETS) fs.copyFileSync(path.join(ROOT, 'website', asset), path.join(OUT, asset));
    console.log(`Wrote ${Object.keys(pages).length} pages to ${path.relative(process.cwd(), OUT) || '.'}.`);
}
