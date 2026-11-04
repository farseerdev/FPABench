#!/usr/bin/env node
// Writes the dimension structure files that z.FPB.Build.Dimension reads, from the FPABench master data
// and the FPABench model's lookup lists (model/dimensions/*.csv). Nothing is invented: every element,
// parent and attribute comes from those files, plus the TM1-only grouping described below.
//
//   node scripts/stage-structure.mjs <FPABench repo> <dataset dir> <out dir>
//
// One file per dimension, FPB_<name>.csv, 21 columns:
//   Parent, Child, Weight, Alias, Type, then up to 16 attributes whose header is "<name>:S" (text) or
//   "<name>:N" (number); unused columns are blank.
// Each row is one parent-child link. A child with several parents has several rows (same attributes).
//
// TM1-only additions:
//   - one root, All_Hierarchies
//   - where a dimension has several hierarchies, a "By <level>" node per hierarchy under All_Hierarchies.
//     The primary hierarchy is linked with weight 1, the others with weight 0, so nothing is counted twice.
//     FPB_Product's primary path is All_Hierarchies > By Product > By Division > division > ... > SKU.
//   - FPB_Account: the management P&L (Invoice Sales ... EBIT, weight 1 throughout) and the GL account
//     groups under "GL Accounts" (weight 0 at the root)
//   - alias "<code> - <name>" (attribute "Code and Name Alias")
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoArg, dataArg, outArg] = process.argv.slice(2);
if (!outArg) {
  console.error('usage: node stage-structure.mjs <FPABench repo> <dataset dir> <out dir>');
  process.exit(2);
}
const repo = path.resolve(repoArg), dataset = path.resolve(dataArg), out = path.resolve(outArg);

// ---- CSV
function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (rows.length && rows[0].length) rows[0][0] = rows[0][0].replace(/^\uFEFF/, '');
  return rows;
}
function readTable(file) {
  if (!fs.existsSync(file)) throw new Error('not found: ' + file);
  const [head, ...rows] = parseCsv(fs.readFileSync(file, 'utf8'));
  return { head, rows: rows.map((r, n) => {
    if (r.length !== head.length) throw new Error(`${file} line ${n + 2}: ${r.length} fields, expected ${head.length}`);
    return Object.fromEntries(head.map((h, j) => [h, r[j]]));
  }) };
}
const master = name => readTable(path.join(dataset, 'master', name + '.csv')).rows;
// model/dimensions/<Level>.csv: first column is the code (header = level name), second is @description
function lookup(level) {
  const { head, rows } = readTable(path.join(repo, 'model', 'dimensions', level + '.csv'));
  if (head[0] !== level || head[1] !== '@description') throw new Error(`unexpected header in ${level}.csv`);
  return rows.map(r => ({ ...r, code: r[head[0]], name: r['@description'] }));
}
const csvField = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s; };

const NUMERIC = new Set(['UnitWeightKg', 'PostingSign']);
const ROOT = 'All_Hierarchies';

// ---- one dimension: elements (with level and attributes) and parent-child links, in insertion order
class Dim {
  constructor(name, primaryLevels, groupByLevel) {
    Object.assign(this, { name, primary: new Set(primaryLevels), groupByLevel, els: new Map(), links: new Map() });
  }
  el(code, name, level, attrs = {}) {
    if (!code || code === ROOT) throw new Error(`${this.name}: bad element code '${code}'`);
    let e = this.els.get(code);
    if (!e) { this.els.set(code, e = { code, name: name || code, level, attrs: {} }); }
    else {
      if (e.level !== level) throw new Error(`${this.name}: ${code} is both ${e.level} and ${level}`);
      if (e.name !== (name || code)) throw new Error(`${this.name}: ${code} has two names`);
    }
    for (const [k, v] of Object.entries(attrs)) {
      if (v === '' || v == null) continue;
      if (e.attrs[k] !== undefined && String(e.attrs[k]) !== String(v)) throw new Error(`${this.name}: ${code}.${k} has two values`);
      e.attrs[k] = v;
    }
  }
  link(parent, child, weight = 1) {
    if (!this.els.has(child) || (parent !== ROOT && !this.els.has(parent))) throw new Error(`${this.name}: link ${parent} > ${child} names an unknown element`);
    const key = parent + '\u0000' + child;
    if (this.links.has(key) && this.links.get(key) !== weight) throw new Error(`${this.name}: ${parent} > ${child} has two weights`);
    this.links.set(key, weight);
  }
  rows() {
    // elements nobody consolidates go under the root, grouped per level when the dimension has several hierarchies
    const hasParent = new Set([...this.links.keys()].map(k => k.split('\u0000')[1]));
    const tops = [...this.els.values()].filter(e => !hasParent.has(e.code));
    if (this.groupByLevel) {
      const byLevel = new Map();
      for (const e of tops) { if (!byLevel.has(e.level)) byLevel.set(e.level, []); byLevel.get(e.level).push(e); }
      for (const [level, members] of byLevel) {
        const head = 'By ' + level;
        this.el(head, head, 'TM1 Hierarchy');
        for (const e of members) this.link(head, e.code, 1);
        if (this.name === 'FPB_Product' && level === 'Division') {
          this.el('By Product', 'By Product', 'TM1 Hierarchy');
          this.link('By Product', head, 1);
          this.link(ROOT, 'By Product', 1);
        } else this.link(ROOT, head, this.primary.has(level) ? 1 : 0);
      }
      for (const level of this.primary) if (!byLevel.has(level)) throw new Error(`${this.name}: primary hierarchy ${level} has no members`);
    } else {
      for (const e of tops) this.link(ROOT, e.code, this.primary.has(e.level) ? 1 : 0);
    }
    // every element must hang under the root, without cycles
    const kids = new Map();
    for (const k of this.links.keys()) { const [p, c] = k.split('\u0000'); if (!kids.has(p)) kids.set(p, []); kids.get(p).push(c); }
    const done = new Set(), path_ = new Set();
    const walk = c => { if (path_.has(c)) throw new Error(`${this.name}: cycle at ${c}`); if (done.has(c)) return; path_.add(c); for (const k of kids.get(c) || []) walk(k); path_.delete(c); done.add(c); };
    walk(ROOT);
    if (done.size !== this.els.size + 1) throw new Error(`${this.name}: ${this.els.size + 1 - done.size} elements not under ${ROOT}`);

    const keys = [...new Set([...this.els.values()].flatMap(e => Object.keys(e.attrs)))].sort();
    const attrs = ['Source Level', ...keys];
    if (attrs.length > 16) throw new Error(`${this.name}: more than 16 attributes`);
    const pad = Array(16 - attrs.length).fill('');
    const isC = new Set([...this.links.keys()].map(k => k.split('\u0000')[0]));
    const aliases = new Set(), codes = new Set([...this.els.keys()].map(c => c.toLowerCase()));
    for (const e of this.els.values()) {
      const a = `${e.code} - ${e.name}`.toLowerCase();
      if (aliases.has(a) || codes.has(a)) throw new Error(`${this.name}: alias ${a} is not unique`);
      aliases.add(a);
    }
    const rows = [['Parent', 'Child', 'Weight', 'Alias', 'Type', ...attrs.map(a => a + (NUMERIC.has(a) ? ':N' : ':S')), ...pad]];
    for (const [k, w] of this.links) {
      const [p, c] = k.split('\u0000'); const e = this.els.get(c);
      const values = [e.level, ...keys.map(key => e.attrs[key] ?? '')];
      values.forEach((v, i) => { if (NUMERIC.has(attrs[i]) && v !== '' && !Number.isFinite(Number(v))) throw new Error(`${this.name}: ${c}.${attrs[i]} = '${v}' is not a number`); });
      rows.push([p, c, w, `${c} - ${e.name}`, isC.has(c) ? 'C' : 'N', ...values, ...pad]);
    }
    return rows;
  }
}

// ---- source data
const m = {
  country: master('countries'), region: master('regions'), group: master('customer_groups'), customer: master('customers'),
  brandGroup: master('brand_groups'), brand: master('brands'), category: master('categories'), subcategory: master('subcategories'),
  line: master('product_lines'), plant: master('plants'), sku: master('skus'), costCenter: master('cost_centers'),
};
const by = (rows, key) => new Map(rows.map(r => [r[key], r]));
const need = (map, code, what) => { const r = map.get(code); if (!r) throw new Error(`unknown ${what} '${code}'`); return r; };
const countryBy = by(m.country, 'country'), groupBy = by(m.group, 'customer_group'), categoryBy = by(m.category, 'category');
const subBy = by(m.subcategory, 'subcategory'), brandBy = by(m.brand, 'brand'), lineBy = by(m.line, 'product_line'), plantBy = by(m.plant, 'plant');
const fromLookup = (d, level) => { for (const r of lookup(level)) d.el(r.code, r.name, level); };
// an element of level L also carries attribute L = its own code (Brand B001 has Brand = B001)
const selfAttr = (d, map) => { for (const e of [...d.els.values()]) if (map[e.level]) d.el(e.code, e.name, e.level, { [map[e.level]]: e.code }); };

const dims = [];

// FPB_Product: Division > Category > Subcategory > Product Line > SKU, plus Brand Group / Brand Type > Brand > Product Line,
// Supply Type > Plant > SKU, and Pack Format, Size Band, Price Tier, Temperature Zone, Lifecycle Status > SKU
{
  const d = new Dim('FPB_Product', ['Division'], true); dims.push(d);
  for (const level of ['Division', 'Brand Type', 'Pack Format', 'Size Band', 'Price Tier', 'Temperature Zone', 'Lifecycle Status', 'Supply Type']) fromLookup(d, level);
  for (const r of m.brandGroup) d.el(r.brand_group, r.name, 'Brand Group');
  for (const r of m.brand) d.el(r.brand, r.name, 'Brand', { BrandGroup: r.brand_group, BrandType: r.brand_type });
  for (const r of m.category) d.el(r.category, r.name, 'Category', { Division: r.division });
  for (const r of m.subcategory) d.el(r.subcategory, r.name, 'Subcategory', { Category: r.category });
  for (const r of m.line) d.el(r.product_line, r.name, 'Product Line', { Subcategory: r.subcategory, Brand: r.brand });
  for (const r of m.plant) d.el(r.plant, r.name, 'Plant', { SupplyType: r.supply_type });
  for (const r of m.sku) d.el(r.sku, r.name, 'SKU', { ProductLine: r.product_line, PackFormat: r.pack_format, SizeBand: r.size_band, PriceTier: r.price_tier,
    TemperatureZone: r.temperature_zone, LifecycleStatus: r.lifecycle_status, Plant: r.plant, UnitWeightKg: r.unit_weight_kg });
  for (const r of m.sku) for (const p of [r.product_line, r.pack_format, r.size_band, r.price_tier, r.temperature_zone, r.lifecycle_status, r.plant]) d.link(p, r.sku);
  for (const r of m.line) { d.link(r.subcategory, r.product_line); d.link(r.brand, r.product_line); }
  for (const r of m.subcategory) d.link(r.category, r.subcategory);
  for (const r of m.category) d.link(r.division, r.category);
  for (const r of m.brand) { d.link(r.brand_group, r.brand); d.link(r.brand_type, r.brand); }
  for (const r of m.plant) d.link(r.supply_type, r.plant);
  // ancestors as attributes, following the master-data keys
  const lineAncestors = line => {
    const sub = need(subBy, line.subcategory, 'subcategory'), cat = need(categoryBy, sub.category, 'category'), br = need(brandBy, line.brand, 'brand');
    return { Subcategory: sub.subcategory, Category: cat.category, Division: cat.division, Brand: br.brand, BrandGroup: br.brand_group, BrandType: br.brand_type };
  };
  for (const r of m.subcategory) d.el(r.subcategory, r.name, 'Subcategory', { Category: r.category, Division: need(categoryBy, r.category, 'category').division });
  const brandDivisions = new Map();
  for (const r of m.line) {
    const a = lineAncestors(r); d.el(r.product_line, r.name, 'Product Line', a);
    if (!brandDivisions.has(r.brand)) brandDivisions.set(r.brand, new Set());
    brandDivisions.get(r.brand).add(a.Division);
  }
  // a brand gets a Division only when all its product lines are in one division
  for (const r of m.brand) { const s = brandDivisions.get(r.brand); if (s && s.size === 1) d.el(r.brand, r.name, 'Brand', { Division: [...s][0] }); }
  for (const r of m.sku) {
    const line = need(lineBy, r.product_line, 'product line'), plant = need(plantBy, r.plant, 'plant');
    d.el(r.sku, r.name, 'SKU', { ...lineAncestors(line), ProductLine: line.product_line, PackFormat: r.pack_format, SizeBand: r.size_band, PriceTier: r.price_tier,
      TemperatureZone: r.temperature_zone, LifecycleStatus: r.lifecycle_status, Plant: r.plant, SupplyType: plant.supply_type, UnitWeightKg: r.unit_weight_kg });
  }
  selfAttr(d, { 'Division': 'Division', 'Brand Type': 'BrandType', 'Pack Format': 'PackFormat', 'Size Band': 'SizeBand', 'Price Tier': 'PriceTier',
    'Temperature Zone': 'TemperatureZone', 'Lifecycle Status': 'LifecycleStatus', 'Supply Type': 'SupplyType', 'Brand Group': 'BrandGroup',
    'Brand': 'Brand', 'Category': 'Category', 'Subcategory': 'Subcategory', 'Product Line': 'ProductLine', 'Plant': 'Plant' });
}

// FPB_Customer: Currency > Country > Customer Group > Customer (primary), Channel > Customer Group, Region > Customer
{
  const d = new Dim('FPB_Customer', ['Currency'], true); dims.push(d);
  fromLookup(d, 'Channel'); fromLookup(d, 'Currency');
  for (const r of m.country) d.el(r.country, r.name, 'Country', { Currency: r.currency });
  for (const r of m.region) d.el(r.region, r.name, 'Region');
  for (const r of m.group) d.el(r.customer_group, r.name, 'Customer Group', { Country: r.country, Channel: r.channel });
  for (const r of m.customer) d.el(r.customer, r.name, 'Customer', { CustomerGroup: r.customer_group, Region: r.region });
  for (const r of m.customer) { d.link(r.customer_group, r.customer); d.link(r.region, r.customer); }
  for (const r of m.group) { d.link(r.country, r.customer_group); d.link(r.channel, r.customer_group); }
  for (const r of m.country) d.link(r.currency, r.country);
  for (const r of m.group) d.el(r.customer_group, r.name, 'Customer Group', { Country: r.country, Channel: r.channel, Currency: need(countryBy, r.country, 'country').currency });
  for (const r of m.customer) {
    const g = need(groupBy, r.customer_group, 'customer group');
    d.el(r.customer, r.name, 'Customer', { CustomerGroup: r.customer_group, Region: r.region, Country: g.country, Channel: g.channel, Currency: need(countryBy, g.country, 'country').currency });
  }
  selfAttr(d, { 'Currency': 'Currency', 'Channel': 'Channel', 'Country': 'Country', 'Customer Group': 'CustomerGroup', 'Region': 'Region' });
}

// FPB_CostCenter: Country > Cost Center (primary), Function > Cost Center, Channel > Cost Center
{
  const d = new Dim('FPB_CostCenter', ['Country'], true); dims.push(d);
  fromLookup(d, 'Function'); fromLookup(d, 'Channel');
  for (const r of m.country) d.el(r.country, r.name, 'Country');
  for (const r of m.costCenter) d.el(r.cost_center, r.name, 'Cost Center', { Function: r.function, Country: r.country, Channel: r.channel || 'NULL (Channel)' });
  for (const r of m.costCenter) { d.link(r.function, r.cost_center); d.link(r.country, r.cost_center); d.link(r.channel || 'NULL (Channel)', r.cost_center); }
}

// FPB_Account: Management P&L (P&L lines, signed when posted; all weights 1) and GL Accounts > Account Group > Account (weight 0 at the root)
{
  const d = new Dim('FPB_Account', ['TM1 P&L Root'], false); dims.push(d);
  fromLookup(d, 'Account Group');
  const accounts = lookup('Account');
  for (const r of accounts) d.el(r.code, r.name, 'Account', { AccountGroup: r['Account Group'] });
  for (const r of accounts) d.link(r['Account Group'], r.code);
  d.el('GL Accounts', 'GL Accounts', 'TM1 GL Root');
  for (const r of lookup('Account Group')) d.link('GL Accounts', r.code, 1);
  // the FPABench model's P&L report posts P100 positively and every other P&L line with -1
  const lines = lookup('PL Line');
  for (const r of lines) d.el(r.code, r.name, 'PL Line', { PostingSign: r.code === 'P100' ? 1 : -1 });
  const steps = [['Invoice Sales', null, ['P100', 'P110', 'P120', 'P125']], ['Net Sales', 'Invoice Sales', ['P130', 'P135', 'P140', 'P145']],
    ['Gross Margin', 'Net Sales', ['P150']], ['Contribution Margin II', 'Gross Margin', ['P170', 'P180']],
    ['Contribution Margin III', 'Contribution Margin II', ['P190']], ['EBIT', 'Contribution Margin III', ['P210']]];
  const used = steps.flatMap(s => s[2]);
  if (used.length !== lines.length || lines.some(r => !used.includes(r.code))) throw new Error('PL Line list differs from the P&L steps: ' + lines.map(r => r.code).join(','));
  for (const [name] of steps) d.el(name, name, 'TM1 P&L Subtotal');
  d.el('Management P&L', 'Management P&L', 'TM1 P&L Root');
  for (const [name, prev, codes] of steps) { if (prev) d.link(name, prev, 1); for (const c of codes) d.link(name, c, 1); }
  d.link('Management P&L', 'EBIT', 1);
}

{ const d = new Dim('FPB_Country', ['Country'], false); dims.push(d); for (const r of m.country) d.el(r.country, r.name, 'Country', { Currency: r.currency }); }
{ const d = new Dim('FPB_Channel', ['Channel'], false); dims.push(d); fromLookup(d, 'Channel'); }

// time and versions, from the generator's parameters
const { params } = await import(pathToFileURL(path.join(repo, 'data', 'params.mjs')).href);
{ const d = new Dim('FPB_Version', ['Version'], false); dims.push(d); for (const v of Object.keys(params.time.versions)) d.el(v, v, 'Version'); }
{
  const d = new Dim('FPB_Years', ['Year'], false); dims.push(d);
  const first = Number(params.time.firstMonth.slice(0, 4));
  const last = Math.max(Number(params.time.planYear), Number(params.time.closeMonth.slice(0, 4)), Number(params.time.lastActual.slice(0, 4)));
  for (let y = first; y <= last; y++) d.el('Y' + y, String(y), 'Year');
}
{ const d = new Dim('FPB_Months', ['Month'], false); dims.push(d); for (let i = 1; i <= 12; i++) d.el('M' + i, 'Month ' + i, 'Month'); }

if (out === dataset || out.startsWith(dataset + path.sep)) throw new Error('write the structure files outside the dataset folder');
fs.mkdirSync(out, { recursive: true });
for (const d of dims) {
  const rows = d.rows();
  fs.writeFileSync(path.join(out, d.name + '.csv'), '\uFEFF' + rows.map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n', 'utf8');
  console.log(`${d.name}.csv  ${d.els.size} elements, ${rows.length - 1} links`);
}
