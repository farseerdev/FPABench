// Monthly sales per customer, material and month.
//
// Each customer is simulated on its own, month by month. It has core slots and extra slots. A slot holds
// one SKU for a stretch of months, then draws another, so the assortment changes slowly. In a month the
// customer buys or not, and each slot's SKU is bought with its slot's chance. Units follow the customer's
// size, the SKU's popularity, the season, the trend, promotions and noise. Part of a purchase can come back
// later, which lowers that month's total, sometimes below zero. A SKU's units go to the material codes
// current in that month.

import { exp, pow } from './detmath.mjs';

function between([lo, hi], u) {
    return lo + (hi - lo) * u;
}

export function simulateSales(world, out) {
    const { p, rng, cal, skus } = world;
    const book = world.termsBook;
    const close = cal.close;
    const A = p.assortment;
    const catalogue = world.size.skus / 1000;

    // Volume trend as an index, 2023 = 1.
    const trend = {};
    let level = 1;
    for (const y of cal.years) {
        if (y > cal.years[0]) level *= 1 + (p.volumeTrend[y] ?? 0);
        trend[y] = level;
    }
    const popSigma = 0.3 * p.skuPopularity;
    const popMean = exp(0.5 * popSigma * popSigma);
    const sigmaN = p.unitNoise;

    const agg = out.agg;
    const groupIndex = new Map(world.groups.map((g, i) => [g.code, i]));

    const everyone = [...world.customers, ...world.unknownCustomers];
    for (const c of everyone) {
        const cp = p.channels[c.channel];
        const { list, alias } = world.skuTable(c);
        if (list.length === 0) continue;
        const gi = groupIndex.get(c.group.code);
        const term = book.terms[gi];
        const k = Math.max(
            1,
            Math.min(
                0.8 * list.length,
                cp.breadth * pow(catalogue, cp.breadthCatalogue) * exp(cp.breadthSize * cp.size[1] * c.z)
            )
        );
        const nCore = Math.max(1, Math.round((k * A.core.share) / A.core.buy));
        const nExtra = Math.round((k * (1 - A.core.share)) / A.extra.buy);
        const nSlots = nCore + nExtra;
        const slotLen = new Int32Array(nSlots);
        const slotPhase = new Int32Array(nSlots);
        for (let j = 0; j < nSlots; j++) {
            const s = j < nCore ? A.core : A.extra;
            slotLen[j] = s.monthsMin + rng.int(s.monthsMax - s.monthsMin + 1, 'slot-length', c.index, j);
            slotPhase[j] = rng.int(slotLen[j], 'slot-phase', c.index, j);
        }
        // Euros of one purchase, so that a year of purchases adds up to the customer's size.
        const lineEur = c.sizeEur / (12 * c.activity * k);

        const pending = new Map();
        for (let t = Math.max(0, c.start); t <= Math.min(close, c.end); t++) {
            const m = cal.months[t];
            const buys = new Map();
            if (rng.u('active', c.index, t) < c.activity) {
                for (let j = 0; j < nSlots; j++) {
                    const core = j < nCore;
                    if (rng.u('buy', c.index, j, t) >= (core ? A.core.buy : A.extra.buy)) continue;
                    const e = Math.floor((t + slotPhase[j]) / slotLen[j]);
                    let sku = null;
                    for (let tryNo = 0; tryNo < 4 && !sku; tryNo++) {
                        const s =
                            list[
                                alias.sample(
                                    rng.u('slot-a', c.index, j, e * 8 + tryNo),
                                    rng.u('slot-b', c.index, j, e * 8 + tryNo)
                                )
                            ];
                        if (s.launch <= t && t <= s.end) sku = s;
                    }
                    if (!sku || buys.has(sku.index)) continue;
                    const promo = c.known ? book.promo(gi, sku.brandIndex, t) : null;
                    let x = (lineEur / sku.priceEur) * (pow(sku.popularity, 0.3) / popMean);
                    x *= p.seasonality[sku.division][m.month - 1] * trend[m.year];
                    x *= exp(sigmaN * rng.normal('units', c.index, sku.index, t) - (sigmaN * sigmaN) / 2);
                    if (promo) x *= promo.uplift;
                    let units;
                    if (rng.chance(p.singleUnitShare[c.channel], 'single-units', c.index, sku.index, t))
                        units = Math.max(1, rng.round(x, 'units-round', c.index, sku.index, t));
                    else
                        units =
                            Math.max(1, rng.round(x / sku.caseSize, 'units-round', c.index, sku.index, t)) *
                            sku.caseSize;
                    buys.set(sku.index, units);
                    // Part of it may come back, now or in a later month.
                    if (rng.chance(p.returns.chance[c.channel], 'return?', c.index, sku.index, t)) {
                        const back = Math.min(
                            units,
                            Math.max(
                                1,
                                Math.round(
                                    units * between(p.returns.share, rng.u('return-share', c.index, sku.index, t))
                                )
                            )
                        );
                        const u = rng.u('return-lag', c.index, sku.index, t);
                        let lag = 0;
                        let acc = 0;
                        for (; lag < p.returns.lag.length; lag++) {
                            acc += p.returns.lag[lag];
                            if (u < acc) break;
                        }
                        const tb = t + Math.min(lag, p.returns.lag.length - 1);
                        if (tb <= Math.min(close, c.end)) {
                            let bucket = pending.get(tb);
                            if (!bucket) pending.set(tb, (bucket = new Map()));
                            bucket.set(sku.index, (bucket.get(sku.index) || 0) + back);
                        }
                    }
                }
            }
            const back = pending.get(t);
            pending.delete(t);
            if (buys.size === 0 && !back) continue;

            // Net units per SKU, then per material code.
            const net = new Map(buys);
            if (back) for (const [si, u] of back) net.set(si, (net.get(si) || 0) - u);
            const rows = [];
            for (const [si, n] of net) {
                if (n === 0) continue;
                const sku = skus[si];
                const promo = c.known ? book.promo(gi, sku.brandIndex, t) : null;
                const regular = sku.materials.filter((mt) => !mt.promo && mt.from <= t && t <= mt.to);
                const promoPack = sku.materials.find((mt) => mt.promo);
                const parts = [];
                if (n > 0 && promo && promoPack && (c.channel === 'MT' || c.channel === 'WS')) {
                    const pu = Math.round(n * p.materials.promoPackUnits);
                    if (pu > 0) parts.push([promoPack, pu]);
                    if (n - pu > 0) parts.push([regular[regular.length - 1], n - pu]);
                } else if (n > 0 && regular.length > 1) {
                    const first = Math.round(n * rng.u('overlap-split', c.index, si, t));
                    if (first > 0) parts.push([regular[0], first]);
                    if (n - first > 0) parts.push([regular[regular.length - 1], n - first]);
                } else {
                    parts.push([regular[regular.length - 1], n]);
                }
                const price = world.listPrice(sku, c.country, t);
                const std = c.known ? book.standardRate(gi, sku.brandIndex, t) : 0;
                const logRate = c.known ? term.logistics : 0;
                for (const [mat, units] of parts) {
                    const gross = units * price;
                    const sd = std > 0 ? Math.round(gross * std) : null;
                    const pd = promo ? Math.round(gross * promo.discount) : null;
                    const ld = logRate > 0 ? Math.round(gross * logRate) : null;
                    const pf = promo && promo.funding > 0 && units > 0 ? Math.round(gross * promo.funding) : null;
                    rows.push({ mat, sku, units, gross, sd, pd, ld, pf });
                }
            }
            rows.sort((a, b) => (a.mat.code < b.mat.code ? -1 : a.mat.code > b.mat.code ? 1 : 0));
            for (const r of rows) {
                if (r.units === 0 && r.gross === 0) continue;
                out.row(t, c, r);
                agg.add(t, c, r);
            }
        }
    }
}
