// The results page: selectors, the scores of each entry, and the time of every test.
//
// Scores follow tests/method.md. Each time is divided by the fastest time of
// any entry at the selected scale on that test, with 10 ms added to both. A test that fails,
// times out or gives a wrong answer counts as twice the largest of 300 s, the
// entry's own slowest time and the slowest success on that test. Each kind of
// test gets its own score, the geometric mean of its tests' ratios. There is no
// combined score. Lower is better.

const data = JSON.parse(document.getElementById('results-data').textContent);
const SHIFT = 0.01;
const FLOOR = 300;
const FAILURES = { wrong: '✗ wrong', error: '☠ error', timeout: '☠ timeout', unsupported: '– not supported' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const entryById = new Map(data.entries.map((e) => [e.id, e]));

const GROUPS = [
    { key: 'scale', label: 'Scale', single: true, options: data.scales.map((s) => [s, s]) },
    { key: 'system', label: 'System', options: data.entries.map((e) => [e.id, e.name]) },
    { key: 'kind', label: 'Tests', single: true, options: data.kinds.map((k) => [k.id, k.label]) },
    { key: 'run', label: 'Read runs', single: true, options: [['warm', 'Median warm'], ['cold', 'Cold']], only: { kind: 'read' } },
];

// Sizes without results yet are shown, but cannot be picked.
const ready = new Set(data.ready ?? data.scales);
const blocked = (group, value) => group === 'scale' && !ready.has(value);

const state = Object.fromEntries(GROUPS.map((g) => [g.key, new Set(g.single ? [g.options[0][0]] : g.options.map(([v]) => v))]));
state.scale = new Set([data.scales.find((s) => ready.has(s))]);
state.kind = new Set(['write']);
const excluded = new Set();
const one = (key) => [...state[key]][0];

// --- selectors ------------------------------------------------------------------------------

function renderSelectors() {
    const chip = (group, value, label, on) =>
        blocked(group, value)
            ? `<button type="button" class="chip" data-key="${group}" data-value="${esc(value)}" aria-disabled="true" data-tip="Coming soon" title="Coming soon">${esc(label)}</button>`
            : `<button type="button" class="chip" data-key="${group}" data-value="${esc(value)}" aria-pressed="${on}">${esc(label)}</button>`;
    document.getElementById('selectors').innerHTML = GROUPS.filter((g) => !g.only || Object.entries(g.only).every(([k, v]) => state[k].has(v)))
        .map((g) => {
            const set = state[g.key];
            const all = g.single ? '' : chip(g.key, '*', 'All', set.size === g.options.length);
            return `<tr><th>${esc(g.label)}:</th><td>${all}${g.options.map(([v, label]) => chip(g.key, v, label, set.has(v))).join('')}</td></tr>`;
        })
        .join('');
}

document.getElementById('selectors').addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip || chip.getAttribute('aria-disabled') === 'true') return;
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

const testById = new Map(data.tests.map((t) => [t.id, t]));
const timeOf = (row, testId) => {
    const result = row.tests[testId];
    if (!result || result.check !== 'ok') return null;
    return testById.get(testId).kind === 'read' && one('run') === 'cold' ? result.cold : result.time;
};

// Every entry at the selected scale is scored, shown or not. The other filters
// only decide which rows are shown, so hiding a system never moves another's score.
function scoredRows() {
    const rows = data.results
        .filter((r) => state.scale.has(r.scale))
        .map((r) => {
            // The entry's own slowest time uses warm times only, so the read selector never moves it.
            const own = Object.values(r.tests).filter((x) => x.check === 'ok' && typeof x.time === 'number').map((x) => x.time);
            return { ...r, entryInfo: entryById.get(r.entry), ratios: {}, scores: {}, slowest: Math.max(0, ...own) };
        });
    for (const kind of data.kinds) {
        const counted = data.tests.filter((t) => t.kind === kind.id && t.status === 'ready' && !excluded.has(t.id));
        for (const test of counted) {
            const times = rows.map((r) => timeOf(r, test.id)).filter((t) => t !== null);
            if (times.length === 0) continue;
            const best = Math.min(...times);
            const slowestSuccess = Math.max(...times);
            for (const r of rows) {
                // An entry that has no result for this kind at this scale is not scored on it.
                if (!Object.keys(r.tests).some((id) => testById.get(id).kind === kind.id)) continue;
                // A failure never scores better than the slowest success on the same test.
                const penalty = 2 * Math.max(FLOOR, r.slowest, slowestSuccess);
                r.ratios[test.id] = (SHIFT + (timeOf(r, test.id) ?? penalty)) / (SHIFT + best);
            }
        }
        for (const r of rows) {
            const ratios = counted.map((t) => r.ratios[t.id]).filter((x) => x !== undefined);
            r.scores[kind.id] = ratios.length > 0 ? Math.exp(ratios.reduce((sum, x) => sum + Math.log(x), 0) / ratios.length) : null;
        }
    }
    const shown = rows.filter((r) => state.system.has(r.entry));
    // Rows without a score stay, so the table and its tick boxes never vanish.
    const order = (r) => r.scores[one('kind')] ?? Infinity;
    return shown.sort((a, b) => (order(a) === order(b) ? 0 : order(a) - order(b)));
}

// --- output ---------------------------------------------------------------------------------

const seconds = (t) => (t >= 100 ? `${Math.round(t)} s` : `${Number(t.toPrecision(3))} s`);
const ratioText = (x) => `×${x.toFixed(2)}`;
// Green at the fastest, through yellow, to red at 30 times slower and beyond.
const heat = (ratio) => {
    const x = Math.min(1, Math.log(ratio) / Math.log(30));
    return `hsla(${Math.round(120 * (1 - x))}, 75%, 50%, 0.3)`;
};

function renderSummary(rows) {
    const el = document.getElementById('summary');
    const kind = one('kind');
    const scored = rows.filter((r) => r.scores[kind] !== null);
    if (scored.length === 0) {
        const kindTests = data.tests.filter((t) => t.kind === kind && t.status === 'ready');
        let why = 'No entry passed any of the counted tests.';
        if (rows.length === 0) why = 'No results for this selection.';
        else if (kindTests.length > 0 && kindTests.every((t) => excluded.has(t.id))) why = 'No test counts toward the score. Tick at least one test below.';
        else if (rows.every((r) => !Object.keys(r.tests).some((id) => testById.get(id).kind === kind))) why = 'These tests do not run at this scale.';
        el.innerHTML = `<p class="empty">${why}</p>`;
        return;
    }
    const worst = scored[scored.length - 1].scores[kind];
    const width = (score) => (worst > 1 ? 4 + (96 * Math.log(score)) / Math.log(worst) : 4);
    const head = data.kinds.map((k) => `<th class="score${k.id === kind ? ' picked' : ' other'}">${esc(k.label)}</th>`).join('');
    const body = scored
        .map((r) => {
            const scores = data.kinds.map((k) => {
                const s = r.scores[k.id];
                return `<td class="score${k.id === kind ? ' picked' : ' other'}">${s === null ? '–' : ratioText(s)}</td>`;
            });
            return `<tr><td class="name">${esc(r.entryInfo.name)}</td><td class="bar-cell"><span class="bar" style="width:${width(r.scores[kind]).toFixed(1)}%"></span></td>${scores.join('')}</tr>`;
        })
        .join('');
    el.innerHTML = `<table class="summary"><thead><tr><th></th><th></th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderDetails(rows) {
    const el = document.getElementById('details');
    if (rows.length === 0) {
        el.innerHTML = '';
        return;
    }
    const kind = one('kind');
    const tests = data.tests.filter((t) => t.kind === kind);
    const head = `<tr><th></th><th>Test</th>${rows.map((r) => `<th class="entry">${esc(r.entryInfo.name)}</th>`).join('')}</tr>`;
    const body = tests.map((test) => {
        const name = `<th class="test">${esc(test.id)} ${esc(test.name)}</th>`;
        if (test.status !== 'ready') return `<tr class="waiting"><td></td>${name}<td colspan="${rows.length}">${esc(test.status)}</td></tr>`;
        const cells = rows.map((r) => {
            const result = r.tests[test.id];
            if (!result) return '<td class="fail">–</td>';
            const time = timeOf(r, test.id);
            if (time === null) return `<td class="fail">${esc(FAILURES[result.check] || result.check)}</td>`;
            const ratio = r.ratios[test.id];
            const style = ratio ? ` style="background:${heat(ratio)}"` : '';
            const title = result.p95 ? ` title="95th percentile ${seconds(result.p95)}"` : '';
            return `<td class="cell"${style}${title}>${seconds(time)}${ratio ? `<span class="x">${ratioText(ratio)}</span>` : ''}</td>`;
        });
        const checked = excluded.has(test.id) ? '' : ' checked';
        return `<tr><td><input type="checkbox" data-test="${esc(test.id)}"${checked} aria-label="Count ${esc(test.id)} in the score"></td>${name}${cells.join('')}</tr>`;
    });
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
