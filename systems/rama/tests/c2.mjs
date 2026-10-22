// C2 All checks, on RAMA. Untimed.
//
// Every CHECK variable of the model is 0 in every cell of the snapshot. Returns each stored cell that is not
// 0, so errors of opposite sign cannot cancel out in a total.

import { restore, modelFile } from '../db.mjs';

// The CHECK variables of the model, read once when the file loads.
const CHECKS = JSON.parse(modelFile('model.json')).variables.filter((v) => v.name.startsWith('CHECK ') && v.formula);

export default {
    async setup(context) {
        context.db = restore(context.work);
    },

    run({ db }) {
        const out = [];
        for (const v of CHECKS) {
            db.ro((tx) => {
                const h = tx.variableByName(v.name);
                let k = 0;
                for (const r of h.rows()) {
                    const value = h.row(r)[0];
                    if (value) out.push({ key: { check: v.name, row: String(k++) }, value });
                }
            });
        }
        return out;
    },

    teardown: ({ db }) => db.close(),
};
