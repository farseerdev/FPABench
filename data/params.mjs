// Every number that shapes the dataset.
//
// Each one is a public figure with its source, or an assumption. An assumption is our own judgement of
// what a consumer goods maker in Central Europe looks like. Where a public dataset or statistic roughly
// confirms it, the note says so. Changing any value changes the data, so it needs a CHANGELOG entry.

export const params = {
    seed: 20261012,

    // --- time -----------------------------------------------------------------------------------------
    time: {
        firstMonth: '2023-01',
        lastActual: '2026-06',
        // The later load that closes a month.
        closeMonth: '2026-07',
        planYear: 2026,
        // Closed and reported months of each version. These follow the model's own description.
        versions: {
            Actual: { closed: ['2023-01', '2026-06'], horizon: ['2023-01', '2026-06'] },
            Budget: { closed: ['2023-01', '2025-12'], horizon: ['2026-01', '2026-12'] },
            'FC 3+9': { closed: ['2023-01', '2026-03'], horizon: ['2026-01', '2026-12'] },
            'FC 6+6': { closed: ['2023-01', '2026-06'], horizon: ['2026-01', '2026-12'] },
            'What-if': { closed: ['2023-01', '2026-06'], horizon: ['2026-01', '2026-12'] },
        },
    },

    // --- sizes ----------------------------------------------------------------------------------------
    // Named by model cells. Customer counts are set so that the model reaches its size. They will be
    // frozen at version 1.0. Everything else follows from customers and SKUs below.
    sizes: {
        '10m': { customers: 115, skus: 1000 },
        '100m': { customers: 3350, skus: 3000 },
        '1b': { customers: 26000, skus: 10000 },
        '10b': { customers: 186000, skus: 30000 },
    },

    // --- countries ------------------------------------------------------------------------------------
    // weight: share of the maker's sales. Assumption, roughly following market size.
    // priceLevel: food and non-alcoholic beverages, EU27 = 1, 2025. Eurostat prc_ppp_ind.
    // traditionalTrade: share of grocery turnover in firms of 0 to 9 people, 2023. Eurostat sbs_sc_ovw, G471.
    // horeca: the maker's sales to hotels, restaurants and cafes. Assumption, scaled from Eurostat
    //   nama_10_cp18, catering as a share of food and drink spending, 2024.
    // foodInflation: HICP food, annual average change. Eurostat prc_hicp_aind, CP011. 2026 is January to August.
    countries: [
        {
            code: 'HR',
            name: 'Croatia',
            currency: 'EUR',
            weight: 0.16,
            priceLevel: 1.055,
            traditionalTrade: 0.053,
            horeca: 0.095,
            foodInflation: { 2023: 0.13, 2024: 0.036, 2025: 0.045, 2026: 0.014 },
        },
        {
            code: 'SI',
            name: 'Slovenia',
            currency: 'EUR',
            weight: 0.12,
            priceLevel: 1.01,
            traditionalTrade: 0.036,
            horeca: 0.105,
            foodInflation: { 2023: 0.122, 2024: 0.009, 2025: 0.045, 2026: 0.015 },
        },
        {
            code: 'SK',
            name: 'Slovakia',
            currency: 'EUR',
            weight: 0.1,
            priceLevel: 0.832,
            traditionalTrade: 0.176,
            horeca: 0.07,
            foodInflation: { 2023: 0.175, 2024: 0.025, 2025: 0.017, 2026: -0.001 },
        },
        {
            code: 'PL',
            name: 'Poland',
            currency: 'PLN',
            weight: 0.3,
            priceLevel: 0.895,
            traditionalTrade: 0.204,
            horeca: 0.05,
            foodInflation: { 2023: 0.16, 2024: 0.032, 2025: 0.044, 2026: 0.01 },
        },
        {
            code: 'CZ',
            name: 'Czechia',
            currency: 'CZK',
            weight: 0.17,
            priceLevel: 0.898,
            traditionalTrade: 0.15,
            horeca: 0.095,
            foodInflation: { 2023: 0.117, 2024: -0.029, 2025: 0.041, 2026: -0.021 },
        },
        {
            code: 'HU',
            name: 'Hungary',
            currency: 'HUF',
            weight: 0.15,
            priceLevel: 0.952,
            traditionalTrade: 0.119,
            horeca: 0.115,
            foodInflation: { 2023: 0.229, 2024: 0.0, 2025: 0.029, 2026: -0.036 },
        },
    ],
    // HUF prices and amounts have no decimals in practice. Assumption.
    wholeUnitCurrencies: ['HUF'],

    // --- channels -------------------------------------------------------------------------------------
    // groupsPerCountry: base and exponent on customers / 270. Chains are few, shops and restaurants many.
    // customersPerGroup: for chains, wholesalers and web shops. Shops and restaurants fill their clusters.
    // size: annual gross sales of one customer in EUR, median and spread on the log scale, at the 10m size.
    //   sizeGrowth scales the median with customers / 270, so chains grow with the company and the long
    //   tail of shops gets smaller as it gets longer.
    // activity: share of months in which a customer buys, from the smallest to the largest of its channel.
    // breadth: SKUs a buying customer takes in a month at the 10m size, at the channel's median size.
    //   breadthCatalogue scales it with SKUs / 1000. breadthSize scales it with the customer's size.
    // All assumptions. The customer counts per channel follow Eurostat's firm counts, see countries.
    channels: {
        MT: {
            groupsPerCountry: [3, 0.2],
            customersPerGroup: [1, 3],
            size: [8.0e5, 0.7],
            sizeGrowth: 0.25,
            activity: [0.92, 0.99],
            breadth: 45,
            breadthCatalogue: 0.5,
            breadthSize: 0.4,
        },
        WS: {
            groupsPerCountry: [2, 0.3],
            customersPerGroup: [1, 2],
            size: [3.5e5, 0.9],
            sizeGrowth: 0.25,
            activity: [0.85, 0.98],
            breadth: 30,
            breadthCatalogue: 0.45,
            breadthSize: 0.4,
        },
        EC: {
            groupsPerCountry: [1, 0.25],
            customersPerGroup: [1, 1],
            size: [6.0e4, 0.8],
            sizeGrowth: 0.2,
            activity: [0.85, 0.98],
            breadth: 20,
            breadthCatalogue: 0.4,
            breadthSize: 0.25,
        },
        TT: {
            groupsPerCountry: [1, 0.45],
            size: [3.0e4, 1.2],
            sizeGrowth: -0.25,
            activity: [0.15, 0.9],
            breadth: 13,
            breadthCatalogue: 0.3,
            breadthSize: 0.6,
        },
        HC: {
            groupsPerCountry: [1, 0.45],
            size: [2.0e4, 1.2],
            sizeGrowth: -0.25,
            activity: [0.15, 0.9],
            breadth: 9,
            breadthCatalogue: 0.3,
            breadthSize: 0.6,
        },
    },
    // Share of shops and restaurants among the customers that are not chains, wholesalers or web shops,
    // by count. Assumption.
    traditionalVsHoreca: 0.6,

    // --- customers over time --------------------------------------------------------------------------
    // About a sixth of customers start and a sixth stop each year. Chains and wholesalers rarely change.
    // Assumption.
    customerTurnover: { startShare: 0.45, endShare: 0.45, stableChannels: ['MT', 'WS', 'EC'] },

    // --- assortment -----------------------------------------------------------------------------------
    // A customer buys from a core assortment that changes slowly and from occasional extras.
    // core: share of breadth, chance to buy a core SKU in a buying month, months a core SKU stays.
    // extra: pool size as a multiple of breadth, chance to buy, months an extra stays in the pool.
    // Assumptions, set so that about half of the customer and SKU pairs of a month return the next month
    // and about a third return in the same month a year later.
    assortment: {
        core: { share: 0.62, buy: 0.88, monthsMin: 18, monthsMax: 60 },
        extra: { pool: 2.5, buy: 0.18, monthsMin: 6, monthsMax: 18 },
    },

    // --- products -------------------------------------------------------------------------------------
    // Counts of the product hierarchy, as base and exponent on SKUs / 1000. Assumptions.
    hierarchy: {
        brands: [20, 0.6],
        brandGroups: [6, 0.2],
        categories: [8, 0.2],
        subcategories: [24, 0.4],
        productLines: [120, 0.8],
        plants: [6, 0.33],
    },
    divisions: { Food: 0.45, Beverages: 0.25, 'Home Care': 0.15, 'Personal Care': 0.15 },
    brandTypes: { 'Own brand': 0.75, Licensed: 0.15, 'Private label': 0.1 },
    packFormats: { Single: 0.55, Multipack: 0.15, 'Family pack': 0.12, 'Catering pack': 0.1, 'Display pack': 0.08 },
    sizeBands: { Small: 0.25, Medium: 0.45, Large: 0.25, Bulk: 0.05 },
    priceTiers: { Premium: 0.2, Mainstream: 0.6, Value: 0.2 },
    temperatureZones: {
        Food: { Ambient: 0.8, Chilled: 0.15, Frozen: 0.05 },
        Beverages: { Ambient: 0.9, Chilled: 0.1 },
        'Home Care': { Ambient: 1 },
        'Personal Care': { Ambient: 1 },
    },
    // Popularity of a SKU, lognormal spread. The top fifth of SKUs then holds most of the sales.
    // Assumption.
    skuPopularity: 2.0,
    // SKUs launched and dropped each year. Henkel reports about half of its 2025 consumer sales from
    // products launched in the last three years. Assumption at 15 % a year.
    skuTurnover: 0.15,
    // Share of SKUs sold in every country. The rest sell in one to three. Assumption.
    skuEverywhere: 0.7,
    // ERP material codes. A SKU changes artwork, and so its code, with this chance over the four years.
    // A promo pack sells next to the regular code in promotion months. Assumptions.
    materials: { artworkChange: 0.5, overlapMonths: 4, promoPackShare: 0.5, promoPackUnits: 0.4 },

    // --- prices and costs -----------------------------------------------------------------------------
    // List price of one unit in EUR, before the country's price level. Median and log spread. Assumption.
    basePrice: { Food: [2.2, 0.55], Beverages: [1.3, 0.5], 'Home Care': [3.8, 0.5], 'Personal Care': [3.2, 0.55] },
    priceTierFactor: { Premium: 1.45, Mainstream: 1, Value: 0.7 },
    sizeBandFactor: { Small: 0.6, Medium: 1, Large: 1.7, Bulk: 3.5 },
    packFactor: { Single: 1, Multipack: 4, 'Family pack': 2.2, 'Catering pack': 4.5, 'Display pack': 10 },
    // Weight in kg of a medium single unit, and its scale by size band. Assumption.
    unitWeight: { Food: 0.5, Beverages: 1.0, 'Home Care': 1.1, 'Personal Care': 0.35 },
    // List prices change in January, and also in July of years with high inflation. A maker passes on
    // part of food inflation. Assumption.
    priceChanges: { passThrough: 0.8, midYearAbove: 0.06 },
    // Standard cost as a share of the EUR list price, and its change per year. Assumption.
    costRatio: { Food: 0.52, Beverages: 0.42, 'Home Care': 0.48, 'Personal Care': 0.38 },
    costIndex: { 2023: 1.0, 2024: 1.03, 2025: 1.05, 2026: 1.07 },
    handlingFactor: { Ambient: 1, Chilled: 1.6, Frozen: 2.4 },

    // --- terms with customers -------------------------------------------------------------------------
    // Rates as a share of gross sales or invoice sales. Low and high end per channel. Assumptions within
    // the trade spend range of public studies, 14 to 25 % of gross sales in total.
    terms: {
        MT: {
            standard: [0.06, 0.12],
            logistics: [0.015, 0.03],
            rebate: [0.03, 0.06],
            bonusShare: 0.5,
            promoMonths: [3, 5],
        },
        WS: {
            standard: [0.1, 0.17],
            logistics: [0.01, 0.025],
            rebate: [0.02, 0.04],
            bonusShare: 0.4,
            promoMonths: [1, 3],
        },
        EC: { standard: [0.05, 0.1], logistics: [0, 0], rebate: [0.015, 0.03], bonusShare: 0.2, promoMonths: [1, 2] },
        TT: { standard: [0.02, 0.05], logistics: [0, 0], rebate: [0, 0.01], bonusShare: 0, promoMonths: [0, 1] },
        HC: { standard: [0.03, 0.08], logistics: [0, 0], rebate: [0, 0.015], bonusShare: 0, promoMonths: [0, 1] },
    },
    promo: { discount: [0.12, 0.25], uplift: [1.5, 2.4], funding: [0.02, 0.05] },
    // Rebate true-ups come after some quarters. Growth bonus: rate, threshold and the year-end true-up.
    rebateTrueUp: { chance: 0.25, spread: 0.15 },
    growthBonus: { rate: [0.01, 0.02], threshold: [0.02, 0.06] },
    // Trade fees: a quarterly share of the group's invoice sales per brand, and a listing fee in EUR
    // when a chain first buys a new SKU. Assumptions.
    tradeFees: { quarterly: [0.02, 0.04], listing: [800, 4000] },

    // --- volumes --------------------------------------------------------------------------------------
    // Seasonality by division, month over the year's mean. Eurostat, not seasonally adjusted, 2015 to
    // 2019 and 2022 to 2025: turnover of food and of beverage makers (sts_trtu_m and sts_inpr_m, C10 and
    // C11, mean of PL, CZ, HU and AT), production of soaps and detergents (C2041) and of perfumes and
    // toiletries (C2042), EU27.
    seasonality: {
        Food: [0.94, 0.92, 1.03, 0.97, 1.01, 0.98, 0.97, 1.01, 1.02, 1.09, 1.07, 1.01],
        Beverages: [0.75, 0.78, 1.0, 1.0, 1.08, 1.2, 1.13, 1.11, 0.99, 0.94, 0.98, 1.04],
        'Home Care': [1.04, 1.0, 1.07, 0.99, 1.0, 1.02, 1.05, 0.93, 1.03, 1.04, 1.0, 0.83],
        'Personal Care': [1.01, 1.02, 1.09, 1.01, 0.99, 1.03, 1.04, 0.86, 1.03, 1.06, 1.02, 0.85],
    },
    // Volume change per year. Food retail volume fell 1 to 6 % in 2023 in most of these countries and grew
    // 0 to 4 % in 2024. Eurostat sts_trtu_m. Later years are assumptions.
    volumeTrend: { 2023: -0.02, 2024: 0.015, 2025: 0.01, 2026: 0.01 },
    // Spread of units from one month to the next, on the log scale. Assumption.
    unitNoise: 0.45,
    // Chains and wholesalers order full cases. Shops and restaurants often order single units. Assumption.
    caseSize: { Single: 12, Multipack: 6, 'Family pack': 4, 'Catering pack': 2, 'Display pack': 1 },
    singleUnitShare: { MT: 0, WS: 0.05, EC: 0.4, TT: 0.45, HC: 0.5 },

    // --- returns --------------------------------------------------------------------------------------
    // Chance that a month's purchase of a SKU comes partly back, the share that comes back, and how many
    // months later. Returns net into the month they come back in. Assumptions, set so that about 5 % of
    // customer, material and month rows are negative.
    returns: {
        chance: { MT: 0.16, WS: 0.14, EC: 0.2, TT: 0.12, HC: 0.1 },
        share: [0.05, 0.6],
        lag: [0.2, 0.45, 0.22, 0.13],
    },

    // --- unknown codes --------------------------------------------------------------------------------
    // Off by default. When switched on, customers, materials and a cost center of the last months are
    // missing from the master data, as if it had been exported before them. The model loads them under its
    // NULL members, and its checks flag them, because they have no country. So a dataset with them is not
    // a healthy one. 0 and false mean none.
    unknown: { months: 2, newCustomersPerMonth: 0, newMaterialsShare: 0, costCenter: false },

    // --- costs below gross margin ---------------------------------------------------------------------
    // Shares of a country's gross sales. Assumptions within the ranges FMCG makers report.
    opex: { Logistics: 0.065, Sales: 0.05, Marketing: 0.008, Administration: 0.045 },
    marketing: { share: 0.045, campaignMonths: [3, 6], campaignShare: 0.65 },

    // --- plan -----------------------------------------------------------------------------------------
    // How each version was made. Growth and price increase are means, per brand and channel or brand.
    plan: {
        Budget: { growth: 0.03, priceIncrease: 0.035, marketing: 1.05, opex: 1.03, targets: 0.6, overrides: 0.004 },
        'FC 3+9': { growth: 0.02, priceIncrease: 0.03, marketing: 1.0, opex: 1.03, targets: 0.3, overrides: 0.003 },
        'FC 6+6': { growth: 0.015, priceIncrease: 0.025, marketing: 1.0, opex: 1.02, targets: 0.3, overrides: 0.003 },
        'What-if': { growth: 0.015, priceIncrease: 0.045, marketing: 1.2, opex: 1.02, targets: 0.3, overrides: 0.003 },
    },
    // Share of brand and channel pairs with a typed growth. A blank means flat volume. Assumption.
    typedGrowthShare: 0.8,
};
