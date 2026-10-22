// Integer ids for members, for the SQL entries. Every key column holds ids instead of member names.
//
// Members the model names get fixed ids, ahead of the data's own, so the SQL means the same with any dataset.
// The ids live in the dimension tables ("dim <Dim>": id, name, parent ids). A new member, such as the customer
// test M2 adds, gets the next free id of its dimension, so the rows already stored keep theirs.

export const SYSTEM_DIMS = ['Versions', 'Years', 'Months'];

/** Names of every member of `d`, the model's members or the system ones. */
function membersOf(model, system, d) {
    return SYSTEM_DIMS.includes(d) ? system[d] : [...model.members.get(d).keys()].sort();
}

/**
 * A new dictionary: dimension -> Map(name -> id), ids from 1, in sorted order. The model's members get the
 * same ids with any dataset. The data's own members, such as customers, get the ids after them when the
 * data is loaded. Versions and Years come from the data generator's settings, the same for every dataset.
 */
export function newDict(model, system) {
    const dict = new Map();
    for (const d of [...model.userDims, ...SYSTEM_DIMS]) {
        dict.set(d, new Map(membersOf(model, system, d).map((m, i) => [m, i + 1])));
    }
    return dict;
}

/** The row of member `name` in its dimension table: [id, name, ...parent ids]. */
function dimRow(model, dict, d, name) {
    const id = dict.get(d).get(name);
    if (SYSTEM_DIMS.includes(d)) return [id, name];
    const m = model.members.get(d).get(name);
    return [id, name, ...model.parentsOf(d).map((p) => dict.get(p).get(m.parents[p]))];
}

/** Every row of a dimension table. */
export function dimRows(model, dict, d) {
    return [...dict.get(d).keys()].map((name) => dimRow(model, dict, d, name));
}
