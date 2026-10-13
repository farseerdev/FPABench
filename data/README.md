# The FPABench data

Version 0.6-draft. The data will change before version 1. Every change is listed in [CHANGELOG.md](../CHANGELOG.md).

This folder holds the generator of the FPABench datasets. The datasets are downloaded or generated, never stored in the repo.

The company is invented. It makes food, drinks, home care and personal care products and sells them in Croatia, Slovenia and Slovakia, which use the euro, and in Poland, Czechia and Hungary. Its customers are retail chains, wholesalers, web shops, independent shops, and hotels, restaurants and cafes.

## Sizes

| Size | Customers | SKUs | Sales rows | Input cells | Model cells |
|---|---:|---:|---:|---:|---:|
| 10m | 115 | 1,000 | 89 thousand | 0.6 M | 10.0 M |
| 100m | 3,350 | 3,000 | 1.3 M | 5.1 M | 99.7 M |
| 1b | 26,000 | 10,000 | 14 M | about 54 M | about 990 M |
| 10b | 186,000 | 30,000 | about 140 M | about 540 M | about 10 B |

## Files

UTF-8 CSV with a header row, commas and a decimal point. Months are `2024-03`. Codes are text and keep their leading zeros. `schema.json` gives every column's type, and `manifest.json` every file's SHA-256. An empty field means no value. Amounts are in the country's currency, except in columns that end in `_eur`.

| Folder | What it holds |
|---|---|
| `master/` | Members and their parents: countries, regions, customer groups, customers, the product hierarchy, SKUs with their attributes and weights, materials, cost centers |
| `actuals/` | Monthly totals from January 2023 to June 2026. `sales.csv` holds almost all rows, one per customer, material and month. The rest are rebates, growth bonus, trade fees, OPEX, marketing, list prices, standard costs, exchange rates and control totals. |
| `plan/` | One file per planner input, one row per typed cell, for Budget, FC 3+9, FC 6+6 and What-if in 2026. Plus the two version flags. |
| `increments/` | Later loads for the tests: July 2026 actuals, a correction of March 2026 with its restated control totals, master data changes and a new price list. Corrections and new prices replace the old values. |

Every code in the actuals is in the master data, and every check of the model is empty or zero on this data.

## Use

```bash
node generate.mjs --size 10m --out fpabench-10m   # write one dataset
node cells.mjs fpabench-10m cells-10m             # the model's input cells, as one long CSV
```

Node 22 or newer, no packages. The same size always gives the same bytes. `cells.mjs` is the reference reading of the files. It shows which column feeds which model input. A system may load the files any way it likes, as long as it reaches the same cells.

## How it is built

Each customer is simulated month by month. It buys from a core assortment that changes slowly and from extras that change faster. Units follow the customer's size, the SKU's popularity, the season, the trend and promotions. Some purchases come back later, so a month can be negative. Rebates, fees, OPEX and marketing follow the sales. The plan follows stated rules from last year's actuals.

Every number that shapes the data is in `params.mjs`, with its public source or marked as an assumption. The sources are Eurostat, the ECB and annual reports of public consumer goods makers. Every random draw depends only on the seed and its own keys, and the generator uses its own `log` and `exp`, so any machine writes the same bytes.

## Licence

The generator is licensed under Apache 2.0. The data is licensed under CC BY 4.0. Exchange rates are the euro reference rates of the European Central Bank. Source: ECB.
