# Changelog

Changes to the model, the data, the tests and the method, newest first. A change that can move a result raises the version.

## 0.5-draft, 2026-10-11

- First draft of the tests, in `tests/`. There are 27 timed tests: 3 loads, 10 writes, 10 reads and 4 model changes. Three more checks run without a timer. Each test has a proving read and an expected result. Two of them wait on the model or the data.
- First draft of the method, in `tests/method.md`. Every test is timed on the client. A write is timed until a read shows its effect. Systems run on one `n2d-standard-4` machine on Google Cloud. Each test scores against the fastest system, with a 10 ms constant. There is one score each for loads, writes, reads and model changes.

## 0.4-draft, 2026-10-11

- A brand and channel with no planned volume growth keeps last year's volume. Before, it got no planned volume unless a planner typed a growth of 0 %. The growth now sits inside the volume formula, and the separate growth factor variable is gone.
- Two loaded rows for the same cell add up. The model description now says so.
- A blank logistics discount rate keeps the customer group's last actual rate, like the standard discount and rebate rates. Before, it planned no logistics discount at all.
- A blank planning exchange rate keeps the currency's last actual rate. Before, the month lost the country's cost of goods and marketing, and its euro amounts.
- A blank planned standard cost uses the product's actual standard cost of the year. Before, the product had no planned cost of goods.

## 0.3-draft, 2026-10-08

- Net sales and gross margin are computed per customer and SKU. Rebates, the growth bonus and trade fees are spread down to SKU. Costs stay allocated per customer and brand.
- Gross margin is a management margin at standard cost, after allocated trade deductions. Contribution margin II follows the cost to serve, and contribution margin III follows marketing.
- Rebate true-ups load apart from the regular accrual, so a one-off does not become the plan's rate.
- A blank growth bonus rate is no decision yet, so the plan keeps what the books accrued, and a check shows it. A typed 0 releases the accrual, even for a group with no sales this year. A group with no planned sales left carries the rest at group level.
- KPI measures can no longer be read by PL Line, since each one picks its own lines.
- A new check shows each P&L line that the euro copy leaves out, as a positive amount, so lines cannot cancel out. Another check makes sure the euro rate is 1.
- The operating expense import excludes factory overhead that the standard cost already covers.

## 0.2-draft, 2026-10-06

- Currencies. Three of the six countries have their own currency, and each country books and plans in its own. Standard costs and the central marketing budget are set in euros and convert at the rate of the version and month. The P&L and EBIT also come in euros.
- Five versions over four years. They are Actual, Budget, FC 3+9, FC 6+6 and What-if, from 2023 to 2026.
- A wider gross-to-net waterfall. Logistics discounts, a growth bonus and promo funding are new P&L lines. Every line below gross sales has a "% of gross sales" measure.
- A customer is the account that places the order. Rebate and growth bonus expense arrives per customer group and is spread to its customers. It is the expense booked each month, not the credit note that settles it.
- Trade fees are planned and booked per customer group, brand and month.
- Discount and rebate rates are monthly. The actual rates are worked out from the actual amounts. Where no rate is typed, the plan holds the last actual rate.
- Each line merges actual and plan in one variable. The separate actual and plan parts are gone.
- Costs are allocated down to customer and brand, no longer to customer and SKU.
- Checks find amounts without a valid exchange rate, per customer and for planned marketing. A zero or negative rate counts as missing.
- The input that marks each version's closed months is now called `FC Closed IN`.
- The forecast books the whole year's growth bonus. Plan months carry what the closed months have not booked, and release it when the group no longer qualifies.
- Costs and deductions that no customer can carry stay in EBIT, on their own P&L line.
- Allocation keys count only positive values, so returns get no share of a cost.
- Each customer group links to its country. Region no longer links to Country.
- KPI measures can only be read by the P&L's own dimensions. The net price per unit divides by the units of the countries in its euro sales.
- The import check shows loaded sales that have no control total.

## 0.1-draft, 2026-10-04

- First draft of the model. A consumer goods P&L from gross sales to EBIT, with actual, budget and forecast.
