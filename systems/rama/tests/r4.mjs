// R4 Ratios, on RAMA.
//
// Every KPI measure of the report, such as gross margin %, by country and version for the plan year. A
// measure is a formula RAMA evaluates when it is read, with no stored cells, so there are no combinations to
// list. The read asks one query call for every country and version.
// Setup puts the database back to the snapshot and opens it. Each run reads.

import { restore, cell, modelFile } from '../db.mjs';

// The measures this test reads, read once when the file loads.
const MEASURES = JSON.parse(modelFile('reads/R4.json')).measures;

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    run({ db }) {
        return db.ro((tx) => {
            // Every country and version RAMA has. data() gives a dimension's ids, gids and names.
            const countries = Array.from(tx.dimensionByName('Country').data(false, null)[2]);
            const versions = Array.from(tx.dimensionByName('Versions').data(false, null)[2]);
            const asks = [];
            for (const measure of MEASURES) for (const Country of countries) for (const Versions of versions) asks.push({ measure, Country, Versions });
            const values = tx.query([], asks.map((a) => ({ type: 'VARIABLE', formula: cell(a.measure, { Country: a.Country, Versions: a.Versions, Years: 'Y2026' }) })), []);
            const out = [];
            asks.forEach((a, i) => {
                const v = values[i].value;
                if (v !== null && v !== undefined) out.push({ key: { Country: a.Country, Versions: a.Versions, measure: a.measure }, value: v });
            });
            return out;
        });
    },

    teardown: ({ db }) => db.close(),
};
