# The FPABench model

Version 0.8-draft. The model will change before version 1. Every change is listed in [CHANGELOG.md](../CHANGELOG.md).

## The business

A consumer goods company makes food, drinks, home care and personal care products. It sells them in six countries, to retail chains, independent shops, wholesalers, hotels and restaurants, and web shops. Three of the countries use the euro. The other three use the Polish zloty, the Czech koruna and the Hungarian forint. Everyone has bought products like these. Most people in finance have seen a P&L like this one.

Finance plans and reports that P&L per customer, product, version and month. The versions are Actual, Budget, two forecasts and a what-if. Actuals come from the company's ERP system. Budget, forecasts and the what-if come from planners' inputs and the model's formulas.

## The P&L

| Line | How it is computed |
| --- | --- |
| Gross Sales | Units × the list price in the customer's country |
| − Standard Discounts | Gross sales × the discount rate agreed with the customer group for the brand |
| − Promo Discounts | Gross sales × the promotion rate, in promotion months only |
| − Logistics Discounts | Gross sales × the customer group's rate for delivery to its own warehouse |
| = Invoice Sales | |
| − Rebates | Invoice sales × the customer group's rebate rate. Actual rebates are the accrual booked per customer group each month, plus any true-ups, which load apart. They are spread to its customers and brands by invoice sales. |
| − Growth Bonus | A bonus rate on the whole year's invoice sales, if the customer group beats last year's sales by more than its threshold. The plan months carry what the closed months have not booked yet. |
| − Trade Fees | Listing, shelf and promotion fees per customer group, brand and month, spread to the group's customers by invoice sales |
| − Promo Funding | Payments per customer and product after a promotion |
| = Net Sales | |
| − COGS | Units × standard cost in euros × the exchange rate |
| = Gross Margin | Per customer and product, at standard cost, after allocated trade deductions |
| − Logistics | Each country's warehouse and transport costs, spread by shipped weight. A chilled or frozen kilogram counts more than an ambient one. |
| − Sales Force | The cost of each sales team, per channel and country, spread by invoice sales |
| = Contribution Margin II | Per customer and brand, after the cost to serve |
| − Marketing | Brand spend per country, spread by net sales. The plan splits each brand's budget, set in euros, to countries by a typed key. |
| = Contribution Margin III | Per customer and brand, after marketing |
| − Overheads | All other operating expenses, per country |
| = EBIT | Per country, with every cost and deduction |

Everything down to gross margin is computed per customer, SKU and month. Rebates, the growth bonus and trade fees are agreed per customer group or brand. Rebates and the growth bonus are rates on sales. Trade fees are fixed amounts, spread by sales. So gross margin per SKU is a management margin at standard cost, after allocated trade deductions. It does not show what dropping a SKU would save, because a fee doesn't shrink with one SKU's volume and standard cost can hold fixed factory overhead. Logistics, the sales force and marketing are fixed costs per country, channel or brand. Spread over single SKUs, they would mislead a decision about one SKU even more. So contribution margins II and III are computed per customer and brand. `8-report.fml` posts every line to a P&L by brand, channel and country. Summed over all its lines, that P&L equals EBIT.

Sometimes no customer can carry a cost or deduction. Launch spend before the first sale is one example. A listing fee before the first delivery is another. The model keeps such an amount at its own level. It posts to its P&L line and counts in EBIT, but in no customer's or SKU's net sales or margin. Allocation keys count only positive values, at the grain each allocation runs at. The trade fee key drops a SKU line whose returns beat its sales, while the customer's other SKUs still get a share. The cost keys drop a customer and brand whose returns beat its sales.

## Actuals and plan

Actuals load once, with no version. A version shows them only in its closed months. A month is closed once its books are final. Two inputs per version and month decide what each month shows.

- `FC Closed IN` marks the months that were already closed when the version was made.
- `FC Horizon IN` marks the months the version reports.

A month that is reported and closed shows actuals. A month that is reported and not yet closed shows plan. The plan starts from the last closed month, even when that month is not reported. In the planned dataset, actuals run from January 2023 to June 2026, and the flags look like this.

| Version | Reports | Shows actuals | Shows plan | Closed up to |
| --- | --- | --- | --- | --- |
| Actual | Y2023 M1 to Y2026 M6 | All months | None | Y2026 M6 |
| Budget | Y2026 M1 to M12 | None | All months | Y2025 M12 |
| FC 3+9 | Y2026 M1 to M12 | Y2026 M1 to M3 | Y2026 M4 to M12 | Y2026 M3 |
| FC 6+6 | Y2026 M1 to M12 | Y2026 M1 to M6 | Y2026 M7 to M12 | Y2026 M6 |
| What-if | Y2026 M1 to M12 | Y2026 M1 to M6 | Y2026 M7 to M12 | Y2026 M6 |

The What-if has the flags of FC 6+6 and its own planner inputs. No formula names a version. Closing a month is a data change. Load the month's actuals, then move the two flags. A new forecast is a new version with its own flags and inputs.

The plan works like this.

- **Volume.** A planner sets a yearly target per customer group and category. The model phases it to customers, products and months by last year's mix over the whole year. Each version keeps only its plan months. So a forecast with six months of actuals takes the target's share of the last six months. Where there is no target, volume is last year's volume times planned growth. A brand and channel with no planned growth keeps last year's volume. A planner can also type the volume of one customer, product and month. That value wins.
- **Price.** The list price of the SKU in the country in the last closed month, held flat, times a planned increase.
- **Rates.** The model works out the actual standard discount, logistics discount and rebate rates from the actual amounts, month by month. The rebate rate uses the regular accrual only, so a one-off true-up does not repeat in the plan. A planner can type a rate. Where nobody did, the last actual rate is held flat into the plan months.
- **Growth bonus.** The bonus rate applies to the whole year, but only if the customer group's sales for the year beat last year's by more than its threshold. A change in any month can switch it on or off for all twelve months. The year's bonus is the rate times the year's sales. The closed months already booked part of it. The plan months carry the rest, which is negative when the group no longer qualifies. A group with no planned sales left carries the rest at group level, spread evenly over the plan months. A blank rate is no decision yet. The plan then keeps what the books accrued, and a check shows it. A typed 0 releases the accrual, even for a group with no sales this year.
- **Everything else.** Promotion rates, trade fees, promo funding, standard costs, exchange rates, marketing spend and operating expenses are planner inputs. A blank standard cost uses the product's actual standard cost of the year. A blank exchange rate keeps the last actual rate.

Each input sits at the level the business decides at, which is mostly coarser than customer and product. Formulas carry the values down.

The yearly target, the growth on last year and the price increase are choices of this benchmark. They exercise functions that real models use. Many real models let planners type the volume per customer and product instead. The typed volume above is that write.

## Currencies

Each country books and plans in its own currency. List prices, invoices, booked deductions, fees and the costs of cost centers are in that currency. Two things are set in euros, the standard cost of a product and the central marketing budget of a brand.

An exchange rate says how much local currency one euro buys. The rate for the euro is 1. Actual months use the average rate of the month. Plan months use the rate each version plans with, so the Budget and a forecast can use different rates. Where a version has no planning rate for a month, it keeps the last actual rate.

The model multiplies the euro amounts by the rate. So each country's whole P&L is in one currency. Every cost pool stays inside one country. At the end, `PL EUR OUT` and `EBIT EUR OUT` divide by the rate. Only these euro copies add up across countries. The KPI measures read the euro P&L.

Where a country has no rate at all for a month, or a rate of 0 or less, its euro amounts have no cell. Checks show where. Customers and cost centers that are missing from master data have no country, so they have no currency either.

## Dimensions

Products roll up along two paths, a category path and a brand path. Six attributes describe each SKU.

```
Material → SKU → Product Line → Subcategory → Category → Division
                 Product Line → Brand → Brand Group
                                Brand → Brand Type
           SKU → Pack Format, Size Band, Price Tier, Temperature Zone, Lifecycle Status
           SKU → Plant → Supply Type
```

Customers roll up by trade and by geography. Costs sit on cost centers and accounts.

```
Customer → Customer Group → Channel
           Customer Group → Country → Currency
Customer → Region
Cost Center → Function, Country, Channel
Account → Account Group
```

- A **material** is one ERP code, such as a promo pack or a new artwork. Several materials make one planning **SKU**. Actuals arrive per material. The model sums them into SKUs before anything else reads them.
- A **customer** is the account that places the order. A chain's buying company is one customer. Its stores are delivery addresses and are not in the model. A shop or restaurant that orders for itself is its own customer.
- A **customer group** holds the trade agreement. It is a chain's head office, a buying group, a wholesaler or a cluster of independent shops. Rates, fees and booked deductions sit at this level. Every customer group lies inside one country, and it sets the country and currency of its customers.
- A **region** is a sales territory inside one country.
- A **cost center** belongs to one function. Logistics and sales cost centers feed the allocations. All others are overheads.
- **Currency** has one member per currency. Each country has one currency.
- **PL Line** holds the lines of the management P&L.
- **Versions**, **Years** and **Months** are built in.

`relations.fml` declares every link. Each link is many-to-one and every path is balanced. There is exactly one path from a dimension to each dimension above it. A second path, such as from region to country, would make the totals depend on which path an engine takes. The members of the fixed dimensions are in `dimensions/`. Customers, products, regions and the other members come with the dataset. How many there are depends on the data size.

A code that is missing from master data still loads. It becomes a new member whose parents are the `NULL` members, such as `NULL (Customer Group)` and `NULL (Region)`. Its values reach every total through them. Such a customer has no country and no currency.

## Files

The model is split into layers. Each layer mostly reads the layers before it. The exception is the plan of rebates and the growth bonus in `4-plan.fml`. It reads invoice sales from `6-margin.fml`, because those rates apply to the merged invoice sales of every month.

| File | What it does |
| --- | --- |
| `0-setup.fml` | The two version inputs, and the flags for actual months and plan months |
| `1-import.fml` | Where actuals load. Invoice lines per customer, material and month, rebate and growth bonus expense per customer group, trade fee invoices per customer group and brand, master data, exchange rates and the general ledger. |
| `2-actuals.fml` | Sums materials into SKUs, spreads the group's booked deductions to customers and brands, works out the actual rates, prices actual COGS and shifts last year's figures |
| `3-inputs.fml` | The planner inputs. These are the cells planners write. |
| `4-plan.fml` | The plan, on plan months only. The volume target cascade, carried prices and rates, the growth bonus true-up, and euro amounts converted to local currency. |
| `5-merge.fml` | One variable per line. It takes the actual in the months a version shows actuals, and the plan in the others. Every later layer serves all versions with one formula. |
| `6-margin.fml` | Gross-to-net and gross margin per customer and SKU, then four cost allocations, down to contribution margins II and III per customer and brand. Each pool keeps what no customer could carry. |
| `7-ebit.fml` | Overheads, the amounts no customer could carry, and EBIT per country, in its currency and in euros |
| `8-report.fml` | The P&L by line, brand, channel and country, its euro copy, and the KPI measures |
| `9-checks.fml` | Controls. Each one is empty or zero on a healthy model. |
| `relations.fml` | The hierarchies |
| `dimensions/*.csv` | Members of the fixed dimensions. The first column is the member and `@description` is its label. Any other column names the member's parent. |

## What the model makes an engine do

Each item is something real planning models do.

- Keep a sparse cube sparse. In any month a customer buys only a small share of the products.
- Roll up through deep and parallel hierarchies, from material to division and from customer to channel, country and currency.
- Apply a coarse rate to every customer and product under it.
- Work out a rate from actual amounts and hold it flat into the plan.
- Spread a target down by computed shares.
- Switch a rate on or off for a whole year, based on that year's total.
- Sum source codes into planning SKUs before anything else reads them.
- Allocate a cost pool by a computed key. Sum the key to the pool's level, take each cell's share and multiply it by the pool. Group deductions, trade fees, logistics, sales force and marketing all work this way, each with its own key. Whatever the key cannot place still counts in profit.
- True up a yearly amount against what the closed months already booked.
- Split brand spend to countries by a key that a planner typed.
- Show an actual that has no version in every version where its month is closed, merged with the plan in the same variable.
- Move the actuals cutoff with a data write.
- Convert amounts at an exchange rate that differs by version and month.
- Read last year's value for the same month.
- Hold a value flat into later months.
- Filter a roll-up by members, with set logic.
- Post computed amounts to fixed report lines, then read them all as one P&L.
- Compute ratios when they are read, as a ratio of totals.
- Keep controls inside the model.
- Recalculate a long chain of formulas, from an imported invoice line to the euro P&L.

## Reading FML

FML describes a model as a list of variables. A variable is a cube of numbers. Here is one from `6-margin.fml`.

```
"Gross Margin" { Customer, SKU, Versions, Years, Months } = "Net Sales" - "COGS"
  @rollup sum
  @folder "Margin"
  @readonly true
```

- The name comes first. A name with spaces is quoted.
- The braces hold the grain, the dimensions of the cube. Gross Margin has one value per customer, SKU, version, year and month.
- The formula follows `=`. It is evaluated for every cell of the grain. A variable with no formula is an input. Its values are loaded or typed.
- Properties follow on the indented lines. `@rollup` says how values add up when they are read at a coarser level. `@readonly true` marks everything a planner does not type. `@folder`, `@notes`, `@format` and `@type` describe the variable. `@optimizeCalculation false` changes where a merge creates cells. The calculation rules below explain it.
- `link Customer -> "Customer Group" : n:1` declares a hierarchy. Each customer has one customer group.
- `Function>Logistics` names one member of a dimension.
- A grain entry such as `"PL Line" = P100` pins the variable to one member. Every cell of `PL Gross Sales` sits on report line P100.
- An empty grain, `{ }`, makes a measure. A measure stores nothing. It is computed when it is read.
- `#` starts a comment.

Names follow a few conventions.

| Name | Meaning |
| --- | --- |
| `IMPORT ...` | Actuals loaded from the source files. They have no Versions dimension. |
| `... IN` | A planner input |
| `... ACT` | Actuals summed to the planning grain, or a rate worked out from them |
| `... Plan` | The plan side of a line, on plan months only |
| `... OUT` | A final result, such as EBIT or the P&L |
| `CHECK ...` | A control |

The model uses these functions.

| Function | Meaning |
| --- | --- |
| `if(c, x)` | x where c holds, and no cell elsewhere |
| `if(c, x, y)` | x where c holds, y elsewhere |
| `eq(a, b)`, `gt(a, b)` | a equals b, a is greater than b |
| `not(c)`, `or(a, b)` | Logic on conditions and on member filters |
| `hasValue(x)` | True where x has a cell |
| `sum(x, filter)` | x rolled up, counting only the cells whose members match the filter |
| `delay(x, 12)` | x moved twelve months later |
| `cumsum(0, 0, x)` | The last value of x, held flat into later months |

## Calculation rules

Every system must give the same numbers as the model. These rules decide the numbers. A translation that misses one gets numbers that look right and are wrong.

**A cell exists or it does not.** Missing is not zero. The model never stores a zero to mean "nothing here". A stored zero is a real zero, such as the rebate rate of a group that got no rebate.

**Rows for the same cell add up.** Two loaded rows can share a cell, such as a sale and a price correction for the same customer, material and month. The cell holds their sum, as an import does.

**A finer operand is rolled up first.** `"Invoice Sales by Customer Brand" = "Invoice Sales"` adds up the invoice sales of each customer's SKUs, per brand. A roll-up follows the operand's `@rollup`. In this model every operand that gets rolled up sums.

**Cells come from the operands that span the grain.** A formula creates cells where its operands with all of the target's dimensions have cells. Such an operand may have extra dimensions. They are summed first. An operand that lacks one of them is looked up or rolled up at each of those cells, through the hierarchy links. That is how a rate per customer group and brand reaches every customer and SKU under them. Such an operand never creates cells on its own. Neither does a constant.

**Operands that each span part of the grain combine.** In `if(eq("FC Plan", 1), "Volume LY")`, the flag has versions and months, and last year's volume has customers, SKUs and months. The result has a cell for each pair of cells that agree on their shared dimensions, here the year and month. That is how last year's volume appears in every version that plans its month.

**Merges take every operand.** The merges in `5-merge.fml`, such as `if(eq("FC Actual", 1), "Volume ACT", "Volume Plan")`, set `@optimizeCalculation false`. Their result has a cell wherever the chosen side has one. So the actual lands in every version whose flag marks the month, and the plan fills the other months. With the setting on, Farseer's engine would create cells only from the plan side, which has every dimension, and the actuals would be lost.

**A dimension that no operand has repeats the value.** `Marketing Split Monthly` adds months to a yearly input. The yearly value repeats in every month.

**`+` and `-` count a missing value as 0.** The result has a cell wherever an operand that spans the grain has one. A finer operand adds to those cells and creates none. That is why `CHECK Import Total` reads `Gross Sales Loaded by Country`, a variable at the country grain. The loaded sales then create cells of their own, even in a country with no control total.

**A constant counts at every cell the formula creates.** In `"Volume LY Plan" * (1 + "Volume Growth IN")`, last year's volume creates the cells. A missing growth counts as 0 there, so the volume stays flat. A variable that held only `1 + "Volume Growth IN"` would have cells only where a growth was typed.

**`*` and `/` need both sides.** If either side is missing, there is no cell. The KPI measures follow this rule too. Every division in a stored variable checks its denominator first, with `if(gt(d, 0), n / d)`. In most of them only the numerator spans the grain, so it decides where the cells are. Two actual rates differ, `Standard Discount Rate ACT` and `Rebate Rate ACT`. There both sides span the grain. Where the denominator has a cell and the numerator has none, the rate is 0.

**Conditions.** `if(c, x)` has a cell only where `c` holds and `x` has a value. In this model, a condition on a missing value is false.

**Time.** `delay(x, 12)` moves every value twelve months later, across year ends. Values moved past the last month are dropped. `cumsum(0, 0, x)` holds the last value of `x` in every later month, to the end of the timeline. Before the first value there is no cell.

**Filters.** `sum("OPEX", Function>Logistics)` adds up only the cells of cost centers in the Logistics function. `not(or(Function>Logistics, Function>Sales))` takes every other cost center. That includes cost centers with no known function.

**Measures have a scope.** A KPI measure reads the P&L, which has no customer and no product below brand. So a measure can only be read by the P&L's own dimensions and their parents. Those are Brand, Brand Group, Brand Type, Channel, Country, Currency, versions and time. PL Line is out too, because each measure picks its own P&L lines. A filter on it would change what the measure means. Any other filter gives a wrong number.

**Reading at a coarser level.** Any variable can be read at any level of its dimensions. `@rollup sum` adds up the cells. `@rollup average` takes the plain average of the cells that exist. A measure is computed from the totals of its operands at the level read, so a margin percentage is always a ratio of totals.

## Not in this version

- Calculated dimension members, such as a Net Sales member made of other members
- Constant-currency reporting, where every version uses the same exchange rate
- Balance sheet and cash flow
- Many-to-many hierarchies
- Splashing, where the engine spreads a typed total down a hierarchy. The volume target cascade does this with formulas.
- Formula cells that planners type over. Inputs and formulas are always separate variables.
- Weeks and days, warehouses, inventory and headcount

## How the model was checked

The model runs in Farseer's engine on a small dataset that reaches every formula path. The dataset has two countries, one in euros and one in zloty. Every stored cell of every calculated variable matched an independent calculation in plain JavaScript, to a relative error of 1e-9. So did the 17 KPI measures, read at 15 different slices. EBIT also equals the sum of every source amount, computed without any allocation. That dataset and that calculation will move into this repo next.
