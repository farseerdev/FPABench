// The model changes of tests M1 and M4, as edits to the model files. tests/tests.json describes M4 in
// words. This is one way to write it, and the reference for every system.

import fs from 'node:fs';
import path from 'node:path';

function edit(dir, file, from, to) {
    const p = path.join(dir, file);
    const text = fs.readFileSync(p, 'utf8');
    if (!text.includes(from)) throw new Error(`${file}: cannot find ${from}`);
    fs.writeFileSync(p, text.replace(from, to));
}

/** Copies the model to `out` and applies the change of test `id`. */
export function changedModel(modelDir, out, id) {
    fs.rmSync(out, { recursive: true, force: true });
    fs.cpSync(modelDir, out, { recursive: true });
    if (id === 'M1') {
        edit(out, '6-margin.fml', '"Handling KG" { Customer, SKU, Versions, Years, Months } = "Volume KG" * "IMPORT Handling Factor"', '"Handling KG" { Customer, SKU, Versions, Years, Months } = "Volume KG"');
        return { changed: ['Handling KG'] };
    }
    if (id === 'M4') {
        fs.appendFileSync(
            path.join(out, '6-margin.fml'),
            `
# --- Test M4: the marketing staff, allocated into contribution margin III ---------------------------

"Marketing Staff Pool" { Country, Versions, Years, Months } = sum("OPEX", Function>Marketing)
  @rollup sum
  @readonly true

"Net Sales Positive by Country" { Country, Versions, Years, Months } = "Net Sales Positive"
  @rollup sum
  @readonly true

"Marketing Staff Key" { Customer, Brand, Versions, Years, Months } = if(gt("Net Sales Positive by Country", 0), "Net Sales Positive" / "Net Sales Positive by Country")
  @rollup sum
  @readonly true

"Marketing Staff Cost" { Customer, Brand, Versions, Years, Months } = "Marketing Staff Pool" * "Marketing Staff Key"
  @rollup sum
  @readonly true

"Marketing Staff Unallocated" { Country, Versions, Years, Months } = "Marketing Staff Pool" - "Marketing Staff Cost"
  @rollup sum
  @readonly true
`
        );
        edit(out, '6-margin.fml', '= "Contribution Margin II" - "Marketing Cost"', '= "Contribution Margin II" - "Marketing Cost" - "Marketing Staff Cost"');
        edit(out, '7-ebit.fml', 'sum("OPEX", not(or(Function>Logistics, Function>Sales)))', 'sum("OPEX", not(or(Function>Logistics, Function>Sales, Function>Marketing)))');
        edit(out, '7-ebit.fml', '+ "Sales Force Unallocated" + "Marketing Unallocated"', '+ "Sales Force Unallocated" + "Marketing Unallocated" + "Marketing Staff Unallocated"');
        edit(out, '9-checks.fml', '- "Sales Force Cost" - "Sales Force Unallocated"', '- "Sales Force Cost" - "Sales Force Unallocated" - "Marketing Staff Cost" - "Marketing Staff Unallocated"');
        fs.appendFileSync(
            path.join(out, '8-report.fml'),
            `
# --- Test M4 ---------------------------------------------------------------------------------------

"PL Marketing Staff" { "PL Line" = P190, Brand, Channel, Country, Versions, Years, Months } = -1 * "Marketing Staff Cost"
  @rollup sum
  @readonly true

"PL Marketing Staff Unallocated" { "PL Line" = P190, Brand = "NULL (Brand)", Channel = "NULL (Channel)", Country, Versions, Years, Months } = -1 * "Marketing Staff Unallocated"
  @rollup sum
  @readonly true
`
        );
        const report = path.join(out, '8-report.fml');
        const text = fs.readFileSync(report, 'utf8');
        const m = /"PL OUT" \{[^}]*\} =([\s\S]*?)\n\s*@/.exec(text);
        if (!m) throw new Error('8-report.fml: cannot find PL OUT');
        fs.writeFileSync(report, text.replace(m[1], `${m[1].trimEnd()} + "PL Marketing Staff" + "PL Marketing Staff Unallocated"`));
        return { changed: ['Contribution Margin III', 'Overheads', 'Unallocated by Country', 'CHECK OPEX in EBIT', 'PL OUT'], added: ['Marketing Staff Pool', 'Net Sales Positive by Country', 'Marketing Staff Key', 'Marketing Staff Cost', 'Marketing Staff Unallocated', 'PL Marketing Staff', 'PL Marketing Staff Unallocated'] };
    }
    throw new Error(`no model change for ${id}`);
}
