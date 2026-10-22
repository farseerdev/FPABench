// W8 Flip a yearly bonus, on RAMA.
//
// A planner moves one customer group's growth threshold just across the group's growth, so its yearly bonus
// switches on or off. updateCells writes it, and the commit recalculates every cell it reaches. Timed until
// the group's growth bonus for the year can be read.

import { restore, cell } from '../db.mjs';

export default {
    // The threshold goes just across each group's planned growth, so the bonus flips: just above it when the
    // group earns the bonus now, just below when it does not. The growth comes from the model, so the picks
    // have no value yet when RAMA records the expected results. RAMA works it out here, untimed, and the
    // runner saves it with the answers. Other systems write the same value.
    async setup(context) {
        context.db = restore(context.work);
        for (const pick of context.picks) {
            if (pick.value !== undefined) continue;
            const at = { 'Customer Group': pick.group, Versions: 'FC 6+6', Years: 'Y2026' };
            const year = context.db.rows('Invoice Sales by Group Year', [], at)[0].value;
            const lastYear = context.db.rows('Invoice Sales LY by Group', [], { 'Customer Group': pick.group, Years: 'Y2026' })[0].value;
            const growth = year / lastYear - 1;
            const on = (context.db.rows('Growth Bonus Rate', [], at)[0]?.value ?? 0) > 0;
            pick.value = on ? growth + 0.001 : growth - 0.001;
        }
    },

    async run({ db, pick: { group, value } }) {
        const at = { 'Customer Group': group, Versions: 'FC 6+6', Years: 'Y2026' };
        db.rw((tx) => tx.updateCells([], [{ type: 'VARIABLE', formula: cell('Growth Bonus Threshold IN', at), value }], [], false));

        return db.rows('Growth Bonus', [], at);
    },

    // The bonus check of the group, untimed. It must stay 0.
    check: ({ db, pick: { group } }) => ({ 'CHECK Growth Bonus': db.rows('CHECK Growth Bonus', [], { 'Customer Group': group, Versions: 'FC 6+6', Years: 'Y2026' }) }),

    teardown: ({ db }) => db.close(),
};
