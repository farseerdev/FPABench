// The results page: selectors, a summary of scores, and the time of every test.
//
// Scores follow ClickBench's method. Each time is divided by the fastest
// selected entry on that test, with 10 ms added to both, so that tiny times do
// not dominate. A failed test counts as twice the slowest time on that test.
// An entry's score is the geometric mean of its ratios. Lower is better.

const data = JSON.parse(document.getElementById('results-data').textContent);
const SHIFT = 0.01;
const FAILURES = { wrong: '✗ wrong', error: '☠ error', timeout: '☠ timeout', unsupported: '– not supported' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const entryById = new Map(data.entries.map((e) => [e.id, e]));

const GROUPS = [
    { key: 'scale', label: 'Scale', single: true, options: data.scales.map((s) => [s, s]) },
    { key: 'machine', label: 'Machine', options: data.machines.map((m) => [m, m]) },
    { key: 'system', label: 'System', options: data.entries.map((e) => [e.id, e.name]) },
    { key: 'approach', label: 'Approach', options: data.approaches.map((a) => [a.id, a.label]) },
    { key: 'open', label: 'Open source', options: [['yes', 'Yes'], ['no', 'No']] },
    { key: 'metric', label: 'Tests', single: true, options: [['all', 'All tests'], ...data.categories.map((c) => [c.id, c.label])] },
    { key: 'run', label: 'Run', single: true, options: [['hot', 'Hot'], ['cold', 'Cold']] },
];

const state = Object.fromEntries(GROUPS.map((g) => [g.key, new Set(g.single ? [g.options[0][0]] : g.options.map(([v]) => v))]));
state.machine = new Set([data.machines[0]]);
const excluded = new Set();

// --- selectors ------------------------------------------------------------------------------

function renderSelectors() {
    const chip = (group, value, label, on) =>
        `<button type="button" class="chip" data-key="${group}" data-value="${esc(value)}" aria-pressed="${on}">${esc(label)}</button>`;
    document.getElementById('selectors').innerHTML = GROUPS.map((g) => {
        const set = state[g.key];
        const all = g.single ? '' : chip(g.key, '*', 'All', set.size === g.options.length);
        return `<tr><th>${esc(g.label)}:</th><td>${all}${g.options.map(([v, label]) => chip(g.key, v, label, set.has(v))).join('')}</td></tr>`;
    }).join('');
}

document.getElementById('selectors').addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    const group = GROUPS.find((g) => g.key === chip.dataset.key);
    const set = state[group.key];
    const value = chip.dataset.value;
    if (group.single) {
        set.clear();
        set.add(value);
    } else if (value === '*') {
        if (set.size === group.options.length) set.clear();
        else for (const [v] of group.options) set.add(v);
    } else if (set.has(value)) set.delete(value);
    else set.add(value);
    render();
});

// --- scores ---------------------------------------------------------------------------------

const timeOf = (result, run) => {
    if (!result || result.check !== 'ok' || !result.runs) return null;
    return run === 'cold' ? result.runs[0] : Math.min(...result.runs.slice(1));
};

function selectedTests() {
    const metric = [...state.metric][0];
    return data.tests.filter((t) => metric === 'all' || t.category === metric);
}

function scoredRows() {
    const run = [...state.run][0];
    const rows = data.results
        .filter((r) => {
            const e = entryById.get(r.entry);
            return state.scale.has(r.scale) && state.machine.has(r.machine) && state.system.has(e.id) && state.approach.has(e.approach) && state.open.has(e.open ? 'yes' : 'no');
        })
        .map((r) => ({ ...r, entryInfo: entryById.get(r.entry), ratios: {} }));
    const counted = selectedTests().filter((t) => !excluded.has(t.id));
    for (const test of counted) {
        const times = rows.map((r) => timeOf(r.tests[test.id], run)).filter((t) => t !== null);
        if (times.length === 0) continue;
        const best = Math.min(...times);
        const slowest = Math.max(...times);
        for (const r of rows) {
            const time = timeOf(r.tests[test.id], run) ?? 2 * slowest;
            r.ratios[test.id] = (SHIFT + time) / (SHIFT + best);
        }
    }
    for (const r of rows) {
        const ratios = Object.values(r.ratios);
        r.score = ratios.length > 0 ? Math.exp(ratios.reduce((sum, x) => sum + Math.log(x), 0) / ratios.length) : null;
    }
    // Rows without a score stay, so the table and its tick boxes never vanish.
    const order = (r) => r.score ?? Infinity;
    return rows.sort((a, b) => (order(a) === order(b) ? 0 : order(a) - order(b)));
}

// --- output ---------------------------------------------------------------------------------

const seconds = (t) => (t >= 100 ? `${Math.round(t)} s` : `${Number(t.toPrecision(3))} s`);
const ratioText = (x) => `×${x.toFixed(2)}`;
// Green at the fastest, through yellow, to red at 30 times slower and beyond.
const heat = (ratio) => {
    const x = Math.min(1, Math.log(ratio) / Math.log(30));
    return `hsla(${Math.round(120 * (1 - x))}, 75%, 50%, 0.3)`;
};
const label = (r) => `${esc(r.entryInfo.name)} <span class="machine">(${esc(r.machine)})</span>`;

function renderSummary(rows) {
    const el = document.getElementById('summary');
    const scored = rows.filter((r) => r.score !== null);
    if (scored.length === 0) {
        let why = 'No entry passed any of the counted tests.';
        if (rows.length === 0) why = 'No results for this selection.';
        else if (selectedTests().every((t) => excluded.has(t.id))) why = 'No test counts toward the score. Tick at least one test below.';
        el.innerHTML = `<p class="empty">${why}</p>`;
        return;
    }
    const worst = scored[scored.length - 1].score;
    const width = (score) => (worst > 1 ? 4 + (96 * Math.log(score)) / Math.log(worst) : 4);
    el.innerHTML =
        '<table class="summary"><tbody>' +
        scored
            .map(
                (r) =>
                    `<tr><td class="name">${label(r)}</td><td class="bar-cell"><span class="bar" style="width:${width(r.score).toFixed(1)}%"></span></td>` +
                    `<td class="date">${esc(r.date)}</td><td class="score">${ratioText(r.score)}</td></tr>`,
            )
            .join('') +
        '</tbody></table>';
}

function renderDetails(rows) {
    const el = document.getElementById('details');
    if (rows.length === 0) {
        el.innerHTML = '';
        return;
    }
    const run = [...state.run][0];
    const tests = selectedTests();
    const head = `<tr><th></th><th>Test</th>${rows.map((r) => `<th class="entry">${esc(r.entryInfo.name)}<span class="machine">${esc(r.machine)}</span></th>`).join('')}</tr>`;
    const body = [];
    for (const category of data.categories) {
        const inCategory = tests.filter((t) => t.category === category.id);
        if (inCategory.length === 0) continue;
        body.push(`<tr class="category"><th colspan="${rows.length + 2}">${esc(category.label)}</th></tr>`);
        for (const test of inCategory) {
            const cells = rows.map((r) => {
                const result = r.tests[test.id];
                const time = timeOf(result, run);
                if (time === null) return `<td class="fail">${esc(FAILURES[result?.check] || 'missing')}</td>`;
                const ratio = r.ratios[test.id];
                const style = ratio ? ` style="background:${heat(ratio)}"` : '';
                return `<td class="cell"${style}>${seconds(time)}${ratio ? `<span class="x">${ratioText(ratio)}</span>` : ''}</td>`;
            });
            const checked = excluded.has(test.id) ? '' : ' checked';
            body.push(
                `<tr><td><input type="checkbox" data-test="${esc(test.id)}"${checked} aria-label="Count ${esc(test.id)} in the score"></td>` +
                    `<th class="test" title="${esc(test.what)}">${esc(test.id)} ${esc(test.title)}</th>${cells.join('')}</tr>`,
            );
        }
    }
    el.innerHTML = `<div class="table-wrap wide"><table class="details"><thead>${head}</thead><tbody>${body.join('')}</tbody></table></div>`;
}

document.getElementById('details').addEventListener('change', (event) => {
    const box = event.target.closest('input[data-test]');
    if (!box) return;
    if (box.checked) excluded.delete(box.dataset.test);
    else excluded.add(box.dataset.test);
    render();
});

function render() {
    renderSelectors();
    const rows = scoredRows();
    renderSummary(rows);
    renderDetails(rows);
}

render();
