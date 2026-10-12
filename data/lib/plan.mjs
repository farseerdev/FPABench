// Planner inputs for Budget, FC 3+9, FC 6+6 and What-if, all for the plan year.
//
// Each version follows simple rules from last year's actuals and the version's own settings in
// params.plan. Inputs sit at the grain the business decides at. Where a planner typed nothing, the file
// has no row, and the model carries the last actual value.

import { money, fixed } from './csv.mjs';
import { ACCOUNT_PROFILE, buildCalendar } from './world.mjs';
import { standardCost, opexAmounts, marketingAmount, quarterlyFee } from './actuals.mjs';

const PLAN_VERSIONS = ['Budget', 'FC 3+9', 'FC 6+6', 'What-if'];

function rate(x) {
    return fixed(Math.max(0, Math.round(x * 10000) / 10000), 4);
}

// The months a version plans: inside its horizon and after its last closed month.
function planMonths(world, version) {
    const { cal, p } = world;
    const v = p.time.versions[version];
    const closedTo = cal.index(v.closed[1]);
    const [h0, h1] = v.horizon.map((k) => cal.index(k));
    return cal.months.filter((m) => m.t >= h0 && m.t <= h1 && m.t > closedTo).map((m) => m.t);
}

export function writeFlags(world, wClosed, wHorizon) {
    const { cal, p } = world;
    for (const [version, v] of Object.entries(p.time.versions)) {
        const [c0, c1] = v.closed.map((k) => cal.index(k));
        const [h0, h1] = v.horizon.map((k) => cal.index(k));
        for (const m of cal.months) {
            if (m.t >= c0 && m.t <= c1) wClosed.row([version, m.key, '1']);
            if (m.t >= h0 && m.t <= h1) wHorizon.row([version, m.key, '1']);
        }
    }
}

export function writePlan(world, totals, open) {
    const { p, rng, cal, termsBook, groups, brands, skus, costCenters, fx } = world;
    const year = cal.planYear;
    const ly = year - 1;
    const months = (y) => cal.months.filter((m) => m.year === y);
    const lyT = (t) => t - 12;
    const vIndex = Object.fromEntries(PLAN_VERSIONS.map((v, i) => [v, i]));

    const w = {
        target: open('plan/volume_target.csv', ['version', 'year', 'customer_group', 'category', 'units']),
        growth: open('plan/volume_growth.csv', ['version', 'year', 'brand', 'channel', 'growth']),
        override: open('plan/volume_override.csv', ['version', 'month', 'customer', 'sku', 'units']),
        price: open('plan/price_increase.csv', ['version', 'year', 'brand', 'increase']),
        std: open('plan/standard_discount.csv', ['version', 'month', 'customer_group', 'brand', 'rate']),
        promo: open('plan/promo_discount.csv', ['version', 'month', 'customer_group', 'brand', 'rate']),
        logistics: open('plan/logistics_discount.csv', ['version', 'month', 'customer_group', 'rate']),
        rebate: open('plan/rebate_rate.csv', ['version', 'month', 'customer_group', 'rate']),
        bonusRate: open('plan/growth_bonus_rate.csv', ['version', 'year', 'customer_group', 'rate']),
        bonusThreshold: open('plan/growth_bonus_threshold.csv', ['version', 'year', 'customer_group', 'threshold']),
        fees: open('plan/trade_fees.csv', ['version', 'month', 'customer_group', 'brand', 'amount']),
        funding: open('plan/promo_funding.csv', ['version', 'month', 'customer', 'sku', 'amount']),
        cost: open('plan/standard_cost.csv', ['version', 'year', 'sku', 'standard_cost_eur']),
        fx: open('plan/fx_rate.csv', ['version', 'month', 'currency', 'rate_per_eur']),
        mktSpend: open('plan/marketing_spend.csv', ['version', 'month', 'brand', 'amount_eur']),
        mktSplit: open('plan/marketing_split.csv', ['version', 'year', 'brand', 'country', 'share']),
        opex: open('plan/opex.csv', ['version', 'month', 'cost_center', 'account', 'amount']),
    };

    const currencies = [...new Set(p.countries.map((c) => c.currency))];
    const fxValue = (country, t) => {
        const cur = p.countries[world.countryIndex[country]].currency;
        return cur === 'EUR' ? 1 : fx.get(`${cur}|${cal.months[t].key}`).value;
    };
    const opexAmount = opexAmounts(world, totals);

    for (const version of PLAN_VERSIONS) {
        const K = p.plan[version];
        const vi = vIndex[version];
        const plan = planMonths(world, version);
        const planSet = new Set(plan);
        const lastClosed = cal.index(p.time.versions[version].closed[1]);

        // Volume targets for some chains and wholesalers, on their two largest categories of last year.
        groups.forEach((g, gi) => {
            if (g.channel !== 'MT' && g.channel !== 'WS') return;
            if (!rng.chance(K.targets, 'target-group', gi, vi)) return;
            const cats = world.categories
                .map((c) => [c.code, totals.groupCategoryUnits.get(`${gi}|${c.code}|${ly}`) || 0])
                .filter(([, u]) => u > 0)
                .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
                .slice(0, 2);
            for (const [cat, units] of cats) {
                const t = Math.round(
                    units * (1 + K.growth + 0.02 * rng.normal('target', gi, vi, cat.length + Number(cat.slice(3))))
                );
                w.target.row([version, String(year), g.code, cat, String(Math.max(0, t))]);
            }
        });

        // Growth per brand and channel, where the pair sold last year. Some pairs stay blank: flat volume.
        brands.forEach((b, bi) => {
            for (const ch of Object.keys(p.channels)) {
                if (!(totals.brandChannelUnits.get(`${bi}|${ch}|${ly}`) > 0)) continue;
                if (!rng.chance(p.typedGrowthShare, 'growth-typed', bi, vi, ch.charCodeAt(0))) continue;
                const g = K.growth + 0.02 * rng.normal('growth', bi, vi, ch.charCodeAt(0));
                w.growth.row([version, String(year), b.code, ch, fixed(Math.round(g * 10000) / 10000, 4)]);
            }
            const inc = Math.max(0, K.priceIncrease + 0.01 * rng.normal('price-increase', bi, vi));
            w.price.row([version, String(year), b.code, rate(inc)]);
        });

        // Volumes typed by key account managers, in plan months, from last year's same month.
        const overrides = new Map();
        for (const o of totals.overrideCandidates) {
            const t = o.t + 12;
            // A planner types volumes only for SKUs still on sale in that month.
            if (!planSet.has(t) || o.sku.end < t || !rng.chance(0.4, 'override', o.c.index, o.sku.index, t * 8 + vi))
                continue;
            const k = `${o.c.code}|${o.sku.code}|${t}`;
            const units = Math.max(
                0,
                Math.round(o.units * (1.05 + 0.1 * rng.normal('override-units', o.c.index, o.sku.index, t * 8 + vi)))
            );
            overrides.set(k, (overrides.get(k) || 0) + units);
        }
        for (const [k, units] of [...overrides].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
            const [cust, sku, t] = k.split('|');
            w.override.row([version, cal.months[Number(t)].key, cust, sku, String(units)]);
        }

        // Promotion payments per customer and SKU, from last year's same month.
        const funding = new Map();
        for (const f of totals.promoFunding) {
            const t = f.t + 12;
            if (!planSet.has(t) || f.sku.end < t) continue;
            const k = `${f.c.code}|${f.sku.code}|${t}`;
            funding.set(k, (funding.get(k) || 0) + Math.round(f.amount * 1.05));
        }
        for (const [k, amount] of [...funding].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
            const [cust, sku, t] = k.split('|');
            w.funding.row([version, cal.months[Number(t)].key, cust, sku, money(amount)]);
        }

        // Rates per group. The Budget types them all. Forecasts carry the last actual rate.
        termsBook.terms.forEach((term, gi) => {
            const g = term.group;
            for (const t of plan) {
                const key = cal.months[t].key;
                if (version === 'Budget' && (g.channel === 'MT' || g.channel === 'WS')) {
                    for (let bi = 0; bi < brands.length; bi++) {
                        if (!(totals.groupBrandInvoice.get(`${gi}|${bi}|${lyT(t)}`) > 0)) continue;
                        const r =
                            termsBook.standardRate(gi, bi, lastClosed) +
                            (rng.chance(0.3, 'std-plan?', gi, bi) ? 0.005 : 0);
                        w.std.row([version, key, g.code, brands[bi].code, rate(r)]);
                    }
                }
                if (g.channel === 'MT' || g.channel === 'WS') {
                    for (let bi = 0; bi < brands.length; bi++) {
                        const pr = termsBook.promo(gi, bi, t);
                        if (pr) w.promo.row([version, key, g.code, brands[bi].code, rate(pr.discount)]);
                    }
                }
                if (version === 'Budget' && term.logistics > 0)
                    w.logistics.row([version, key, g.code, rate(term.logistics)]);
                if (version === 'Budget' && term.rebate > 0)
                    w.rebate.row([
                        version,
                        key,
                        g.code,
                        rate(term.rebate + (rng.chance(0.2, 'rebate-plan?', gi) ? 0.0025 : 0)),
                    ]);
                if (g.channel === 'MT' && cal.months[t].month % 3 === 1) {
                    for (let bi = 0; bi < brands.length; bi++) {
                        const fee = quarterlyFee(world, totals, gi, bi, lyT(t));
                        if (fee > 0) w.fees.row([version, key, g.code, brands[bi].code, money(Math.round(fee * 1.03))]);
                    }
                }
            }
            // Growth bonus. A forecast that sees the group miss its threshold types 0, which releases the accrual.
            if (term.bonus) {
                // Growth so far: the closed months of the plan year against the same months last year.
                const closedMonth = cal.months[lastClosed].month;
                const soFar = (y) =>
                    months(y)
                        .filter((m) => m.month <= closedMonth)
                        .reduce((a, m) => a + (totals.groupInvoice.get(`${gi}|${m.t}`) || 0), 0);
                const growth = version === 'Budget' ? 0.05 : soFar(ly) > 0 ? soFar(year) / soFar(ly) - 1 : 0;
                let r = term.bonus.rate;
                if (version !== 'Budget' && growth < term.bonus.threshold) r = 0;
                w.bonusRate.row([version, String(year), g.code, rate(r)]);
                w.bonusThreshold.row([version, String(year), g.code, rate(term.bonus.threshold)]);
            }
        });

        // Standard costs. The Budget types every SKU. Forecasts retype some.
        for (const s of skus) {
            if (s.end < cal.index(`${year}-01`) || s.launch > cal.index(`${year}-12`)) continue;
            if (version !== 'Budget' && !rng.chance(0.3, 'cost-retyped', s.index, vi)) continue;
            let c =
                standardCost(world, s, year) *
                (version === 'Budget' ? 1.01 : 1 + 0.02 * rng.normal('cost-plan', s.index, vi));
            if (version === 'What-if' && s.division === 'Food') c *= 1.03;
            w.cost.row([version, String(year), s.code, fixed(Math.round(c * 10000) / 10000, 4)]);
        }

        // Planning rates: the rate of the last closed month, for every plan month.
        for (const t of plan) {
            for (const cur of currencies) {
                const r = cur === 'EUR' ? '1' : fx.get(`${cur}|${cal.months[lastClosed].key}`).text;
                w.fx.row([version, cal.months[t].key, cur, r]);
            }
        }

        // Marketing: last year's spend in EUR per brand, and its split by country.
        brands.forEach((b, bi) => {
            const byCountry = p.countries.map((c) => {
                let eur = 0;
                for (const m of months(ly))
                    eur += marketingAmount(world, totals, bi, c.code, m.t) / 100 / fxValue(c.code, m.t);
                return [c.code, eur];
            });
            const total = byCountry.reduce((a, [, v]) => a + v, 0);
            if (total <= 0) return;
            for (const t of plan) {
                const monthly = ((total * K.marketing) / 12) * (1 + 0.2 * (2 * rng.u('mkt-plan', bi, vi, t) - 1));
                w.mktSpend.row([version, cal.months[t].key, b.code, money(Math.round(monthly * 100))]);
            }
            // Shares rounded to four decimals, with the largest share taking the rounding, so they add up to 1.
            const shares = byCountry.filter(([, v]) => v > 0).map(([c, v]) => [c, Math.round((v / total) * 10000)]);
            const sum = shares.reduce((a, [, v]) => a + v, 0);
            shares.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
            shares[0][1] += 10000 - sum;
            shares.sort((a, b) => (a[0] < b[0] ? -1 : 1));
            for (const [c, v] of shares) w.mktSplit.row([version, String(year), b.code, c, fixed(v / 10000, 4)]);
        });

        // Operating expenses: last year's same month, times the version's factor.
        for (const t of plan) {
            for (const cc of costCenters) {
                for (const account of Object.keys(ACCOUNT_PROFILE[cc.function])) {
                    const a = Math.round(opexAmount(cc, account, lyT(t)) * K.opex);
                    if (a !== 0) w.opex.row([version, cal.months[t].key, cc.code, account, money(a)]);
                }
            }
        }
    }
    return w;
}

export { PLAN_VERSIONS, planMonths, buildCalendar };
