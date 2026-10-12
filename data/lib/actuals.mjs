// Everything the ERP books besides sales, built from sales totals: rebates, growth bonus, trade fees,
// operating expenses, marketing, list prices, standard costs, exchange rates and control totals.

import { money, fixed } from './csv.mjs';
import { ACCOUNT_PROFILE } from './world.mjs';
import { exp } from './detmath.mjs';

function between([lo, hi], u) {
    return lo + (hi - lo) * u;
}

const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);

// Sales totals the other tables are built from. Amounts are in hundredths of the local currency.
export class SalesTotals {
    constructor(world) {
        this.world = world;
        this.groupIndex = new Map(world.groups.map((g, i) => [g.code, i]));
        this.countryGross = new Map(); // country|t
        this.groupInvoice = new Map(); // gi|t
        this.groupBrandInvoice = new Map(); // gi|bi|t
        this.brandCountryGross = new Map(); // bi|country|t
        this.countryChannelGross = new Map(); // country|channel|year
        this.groupCategoryUnits = new Map(); // gi|category|year
        this.brandChannelUnits = new Map(); // bi|channel|year
        this.firstBuy = new Map(); // gi|sku -> t, chains only
        this.overrideCandidates = [];
        this.promoFunding = [];
        this.rowsPerMonth = new Map();
    }

    add(t, c, r) {
        const w = this.world;
        const year = w.cal.months[t].year;
        add(this.countryGross, `${c.country}|${t}`, r.gross);
        add(this.brandCountryGross, `${r.sku.brandIndex}|${c.country}|${t}`, r.gross);
        add(this.rowsPerMonth, t, 1);
        if (!c.known) return;
        const gi = this.groupIndex.get(c.group.code);
        const invoice = r.gross - (r.sd || 0) - (r.pd || 0) - (r.ld || 0);
        add(this.groupInvoice, `${gi}|${t}`, invoice);
        add(this.groupBrandInvoice, `${gi}|${r.sku.brandIndex}|${t}`, invoice);
        add(this.countryChannelGross, `${c.country}|${c.channel}|${year}`, r.gross);
        add(this.groupCategoryUnits, `${gi}|${r.sku.category}|${year}`, r.units);
        add(this.brandChannelUnits, `${r.sku.brandIndex}|${c.channel}|${year}`, r.units);
        if (c.channel === 'MT' && r.units > 0) {
            const k = `${gi}|${r.sku.index}`;
            const first = this.firstBuy.get(k);
            if (first === undefined || t < first) this.firstBuy.set(k, t);
        }
        // Plan material: a few chain and wholesaler cells of last year, for typed overrides and promo funding.
        if ((c.channel === 'MT' || c.channel === 'WS') && year === w.cal.planYear - 1 && r.units > 0) {
            if (w.rng.chance(0.03, 'override-candidate', c.index, r.sku.index, t))
                this.overrideCandidates.push({ c, sku: r.sku, t, units: r.units });
            if (r.pf && w.rng.chance(0.15, 'funding-candidate', c.index, r.sku.index, t))
                this.promoFunding.push({ c, sku: r.sku, t, amount: r.pf });
        }
    }
}

// The month keys a table covers: every actual month, or only the close month.
export function monthsOf(world, which) {
    const { cal } = world;
    if (which === 'close') return [cal.close];
    return cal.months.filter((m) => m.t <= cal.lastActual).map((m) => m.t);
}

export function writeRebates(world, totals, w, which) {
    const { rng, cal, termsBook } = world;
    for (const t of monthsOf(world, which)) {
        const m = cal.months[t];
        termsBook.terms.forEach((term, gi) => {
            if (term.rebate <= 0) return;
            const inv = totals.groupInvoice.get(`${gi}|${t}`) || 0;
            const accrual = Math.round(inv * term.rebate);
            let trueUp = null;
            // After a quarter ends, some agreements are settled and the accrual corrected.
            if ((m.month - 1) % 3 === 0 && t >= 3 && rng.chance(world.p.rebateTrueUp.chance, 'rebate-trueup?', gi, t)) {
                let quarter = 0;
                for (let k = 1; k <= 3; k++)
                    quarter += Math.round((totals.groupInvoice.get(`${gi}|${t - k}`) || 0) * term.rebate);
                const v = Math.round(quarter * world.p.rebateTrueUp.spread * rng.normal('rebate-trueup', gi, t));
                if (v !== 0) trueUp = v;
            }
            if (accrual === 0 && trueUp === null) return;
            w.row([
                m.key,
                term.group.code,
                accrual === 0 ? null : money(accrual),
                trueUp === null ? null : money(trueUp),
            ]);
        });
    }
}

export function writeGrowthBonus(world, totals, w, which) {
    const { rng, cal, termsBook } = world;
    const yearInvoice = (gi, year) => {
        let s = 0;
        for (const m of cal.months)
            if (m.year === year && m.t <= cal.lastActual) s += totals.groupInvoice.get(`${gi}|${m.t}`) || 0;
        return s;
    };
    for (const t of monthsOf(world, which)) {
        const m = cal.months[t];
        termsBook.terms.forEach((term, gi) => {
            if (!term.bonus) return;
            const expects = rng.chance(0.6, 'bonus-expected', gi, m.year);
            const inv = totals.groupInvoice.get(`${gi}|${t}`) || 0;
            let amount = expects ? Math.round(inv * term.bonus.rate) : 0;
            // In December the year is known. The books true up to the entitlement.
            if (m.month === 12 && m.year > cal.years[0]) {
                const thisYear = yearInvoice(gi, m.year);
                const lastYear = yearInvoice(gi, m.year - 1);
                const earned =
                    lastYear > 0 && thisYear > lastYear * (1 + term.bonus.threshold)
                        ? Math.round(thisYear * term.bonus.rate)
                        : 0;
                let booked = 0;
                for (const mm of cal.months)
                    if (mm.year === m.year && mm.t < t)
                        booked += expects
                            ? Math.round((totals.groupInvoice.get(`${gi}|${mm.t}`) || 0) * term.bonus.rate)
                            : 0;
                amount = earned - booked;
            }
            if (amount !== 0) w.row([m.key, term.group.code, money(amount)]);
        });
    }
}

export function writeTradeFees(world, totals, w, which) {
    const { p, rng, cal, termsBook, fx, brands, skus } = world;
    // Listing fees, in the month a chain first buys a SKU launched inside the window.
    const listing = new Map();
    for (const [k, t] of totals.firstBuy) {
        const [gi, si] = k.split('|').map(Number);
        const sku = skus[si];
        if (sku.launch < 0 || t < sku.launch) continue;
        const g = world.groups[gi];
        const cur = p.countries[world.countryIndex[g.country]].currency;
        const rate = cur === 'EUR' ? 1 : fx.get(`${cur}|${cal.months[t].key}`).value;
        const eur = between(p.tradeFees.listing, rng.u('listing-fee', gi, si));
        add(listing, `${gi}|${sku.brandIndex}|${t}`, Math.round(eur * rate) * 100);
    }
    for (const t of monthsOf(world, which)) {
        const m = cal.months[t];
        termsBook.terms.forEach((term, gi) => {
            if (term.group.channel !== 'MT') return;
            for (let bi = 0; bi < brands.length; bi++) {
                const amount = (listing.get(`${gi}|${bi}|${t}`) || 0) + quarterlyFee(world, totals, gi, bi, t);
                if (amount !== 0) w.row([m.key, term.group.code, brands[bi].code, money(amount)]);
            }
        });
    }
}

// The quarterly fee of a chain for a brand, booked in the first month of the next quarter.
export function quarterlyFee(world, totals, gi, bi, t) {
    const { p, rng, cal } = world;
    if ((cal.months[t].month - 1) % 3 !== 0 || t < 3) return 0;
    let quarter = 0;
    for (let k = 1; k <= 3; k++) quarter += totals.groupBrandInvoice.get(`${gi}|${bi}|${t - k}`) || 0;
    return quarter > 0 ? Math.round(quarter * between(p.tradeFees.quarterly, rng.u('fee-rate', gi, bi))) : 0;
}

// Marketing spend of a brand in a country and month, in hundredths of the local currency.
export function marketingAmount(world, totals, bi, country, t) {
    const { p, rng, cal } = world;
    const M = p.marketing;
    const gross = totals.brandCountryGross.get(`${bi}|${country}|${t}`) || 0;
    if (gross <= 0) return 0;
    const ci = world.countryIndex[country];
    const year = cal.months[t].year;
    const [lo, hi] = M.campaignMonths;
    const n = lo + rng.int(hi - lo + 1, 'campaign-count', bi, ci, year);
    const campaign = rng.u('campaign-month', bi, ci, t) < n / 12;
    const factor = campaign ? (M.campaignShare * 12) / n : ((1 - M.campaignShare) * 12) / (12 - n);
    return Math.round(gross * M.share * factor * exp(0.15 * rng.normal('marketing-noise', bi, ci, t)));
}

export function writeMarketing(world, totals, w, which) {
    const { p, cal, brands } = world;
    for (const t of monthsOf(world, which)) {
        const m = cal.months[t];
        for (let bi = 0; bi < brands.length; bi++) {
            for (const c of p.countries) {
                const amount = marketingAmount(world, totals, bi, c.code, t);
                if (amount !== 0) w.row([m.key, brands[bi].code, c.code, money(amount)]);
            }
        }
    }
}

// Seasonal pattern of a few lumpy accounts: bonuses, insurance, audit. Assumption.
const ACCOUNT_MONTHS = {
    6120: [0.6, 0.6, 2.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 3.4],
    6520: [6.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    6510: [0.6, 2.4, 2.4, 2.4, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6],
};

export function opexAmounts(world, totals) {
    const { p, rng, cal, costCenters } = world;
    const yearGross = (country, year, channel) => {
        const chans = channel ? [channel] : Object.keys(p.channels);
        let s = 0;
        for (const ch of chans) s += totals.countryChannelGross.get(`${country}|${ch}|${year}`) || 0;
        return s;
    };
    // A year's cost base: the year's gross sales. The open year uses last year's times a little growth.
    const base = (country, year, channel) => {
        const months = cal.months.filter((m) => m.year === year && m.t <= cal.lastActual).length;
        if (months === 12) return yearGross(country, year, channel);
        return yearGross(country, year - 1, channel) * 1.03;
    };
    return function amount(cc, account, t) {
        const m = cal.months[t];
        let pool = (p.opex[cc.function] * base(cc.country, m.year)) / 12;
        if (cc.function === 'Sales') {
            const all = base(cc.country, m.year);
            pool = all > 0 ? (pool * base(cc.country, m.year, cc.channel)) / all : 0;
        } else {
            pool *= cc.share;
        }
        const share = ACCOUNT_PROFILE[cc.function][account] || 0;
        if (share === 0 || pool <= 0) return 0;
        const seasonal = ACCOUNT_MONTHS[account] ? ACCOUNT_MONTHS[account][m.month - 1] : 1;
        const ci = costCenters.indexOf(cc);
        return Math.round(pool * share * seasonal * exp(0.04 * rng.normal('opex-noise', ci, Number(account), t)));
    };
}

export function writeOpex(world, totals, w, which) {
    const { cal, costCenters } = world;
    const amount = opexAmounts(world, totals);
    for (const t of monthsOf(world, which)) {
        const m = cal.months[t];
        for (const cc of costCenters) {
            for (const account of Object.keys(ACCOUNT_PROFILE[cc.function])) {
                const a = amount(cc, account, t);
                if (a !== 0) w.row([m.key, cc.code, account, money(a)]);
            }
        }
        // A cost center opened after the master data export. Its cost still reaches EBIT.
        if (world.p.unknown.costCenter && which !== 'close' && t > cal.lastActual - world.p.unknown.months) {
            const a = amount(
                costCenters.find((x) => x.code.endsWith('ADM-MGT')),
                '6100',
                t
            );
            if (a) w.row([m.key, 'PL-ADM-NEW', '6100', money(Math.round(a / 4))]);
        }
    }
}

export function writeListPrices(world, w, which, onlyKeys = null) {
    const { p, cal, skus } = world;
    for (const t of monthsOf(world, which)) {
        const m = cal.months[t];
        for (const s of skus) {
            if (s.launch > t || s.end + returnTail(world) < t) continue;
            for (const c of p.countries) {
                if (!(s.countryMask & (1 << world.countryIndex[c.code]))) continue;
                if (onlyKeys && !onlyKeys.has(`${s.index}|${c.code}`)) continue;
                w.row([m.key, s.code, c.code, money(world.listPrice(s, c.code, t))]);
            }
        }
    }
}

export function standardCost(world, sku, year) {
    const { p, rng } = world;
    const v =
        sku.priceEur *
        p.costRatio[sku.division] *
        p.costIndex[year] *
        exp(0.05 * rng.normal('std-cost', sku.index, year));
    return Math.round(v * 10000) / 10000;
}

// Months after a SKU's last sale in which returns can still arrive.
const returnTail = (world) => world.p.returns.lag.length - 1;

// A standard cost for every year in which the SKU sells, returns included, and for the year after its last
// sale, because the plan repeats last year's volume.
export function writeStandardCosts(world, w) {
    const { cal, skus } = world;
    for (const year of cal.years) {
        const first = cal.months.find((m) => m.year === year).t;
        const lastT = Math.min(cal.lastActual, cal.months.filter((m) => m.year === year).at(-1).t);
        for (const s of skus) {
            if (s.launch > lastT || s.end + returnTail(world) < first - 12) continue;
            w.row([String(year), s.code, fixed(standardCost(world, s, year), 4)]);
        }
    }
}

export function writeFx(world, w, which) {
    const { p, cal, fx } = world;
    const currencies = [...new Set(p.countries.map((c) => c.currency))];
    for (const t of monthsOf(world, which)) {
        const m = cal.months[t];
        for (const cur of currencies) w.row([m.key, cur, cur === 'EUR' ? '1' : fx.get(`${cur}|${m.key}`).text]);
    }
}

export function writeControlTotals(world, totals, w, which) {
    const { p, cal } = world;
    for (const t of monthsOf(world, which)) {
        const m = cal.months[t];
        for (const c of p.countries) {
            const v = totals.countryGross.get(`${c.code}|${t}`) || 0;
            if (v !== 0) w.row([m.key, c.code, money(v)]);
        }
    }
}
