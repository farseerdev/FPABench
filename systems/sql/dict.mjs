// Integer ids for members, for the SQL entries. Every key column holds ids instead of member names.
//
// Members the model names get fixed ids, ahead of the data's own, so the SQL means the same with any dataset.
// Ids are given once and never change: a new member, such as a customer added by test M2, gets the next
// free id of its dimension, so the rows already stored keep theirs. The ids live in the dimension tables
// ("dim <Dim>": id, name, parent ids), so a restarted system reads them back from there.

export const SYSTEM_DIMS = ['Versions', 'Years', 'Months'];

/** Names of every member of `d`, the model's members or the system ones. */
function membersOf(model, system, d) {
    return SYSTEM_DIMS.includes(d) ? system[d] : [...model.members.get(d).keys()].sort();
}

/**
 * A new dictionary: dimension -> Map(name -> id), ids from 1. In a user dimension the members the model
 * itself brings come first, sorted, so a member a formula names has the same id with any dataset. The
 * members only the data brings, such as customers, follow them. Versions and Years come from the data, and
 * every dataset has the same ones.
 */
export function newDict(model, system) {
    const dict = new Map();
    for (const d of [...model.userDims, ...SYSTEM_DIMS]) {
        const all = membersOf(model, system, d);
        const fixed = SYSTEM_DIMS.includes(d) ? [] : [...(model.modelMembers?.get(d) ?? [])].sort();
        const isFixed = new Set(fixed);
        dict.set(d, new Map([...fixed, ...all.filter((m) => !isFixed.has(m))].map((m, i) => [m, i + 1])));
    }
    return dict;
}

/** Gives the next free id to every member of the model that has none yet. Returns the members added. */
export function extendDict(dict, model) {
    const added = [];
    for (const d of model.userDims) {
        const ids = dict.get(d) ?? dict.set(d, new Map()).get(d);
        let next = Math.max(0, ...ids.values()) + 1;
        for (const m of [...model.members.get(d).keys()].sort()) {
            if (ids.has(m)) continue;
            ids.set(m, next++);
            added.push({ dim: d, name: m });
        }
    }
    return added;
}

/** A dictionary from the rows of the dimension tables: { dim: [{ id, name }] }. */
export function dictFromRows(rowsByDim) {
    return new Map(Object.entries(rowsByDim).map(([d, rows]) => [d, new Map(rows.map((r) => [r.name, Number(r.id)]))]));
}

/** id -> name, per dimension. */
export function reverse(dict) {
    return new Map([...dict].map(([d, ids]) => [d, new Map([...ids].map(([n, i]) => [i, n]))]));
}

/** The row of member `name` in its dimension table: [id, name, ...parent ids]. */
export function dimRow(model, dict, d, name) {
    const id = dict.get(d).get(name);
    if (SYSTEM_DIMS.includes(d)) return [id, name];
    const m = model.members.get(d).get(name);
    return [id, name, ...model.parentsOf(d).map((p) => dict.get(p).get(m.parents[p]))];
}

/** Every row of a dimension table. */
export function dimRows(model, dict, d) {
    return [...dict.get(d).keys()].map((name) => dimRow(model, dict, d, name));
}
