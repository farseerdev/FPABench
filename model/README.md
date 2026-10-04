# The FPABench model

Version 0.1-draft. The model will change before version 1. Every change is listed in [CHANGELOG.md](../CHANGELOG.md).

## The business

A consumer goods company makes food, drinks, home care and personal care products. It sells them in six euro countries, to retail chains, independent shops, wholesalers, hotels and restaurants, and web shops. Everyone has bought products like these. Most people in finance have seen a P&L like this one.

Finance plans and reports that P&L per customer, product, version and month. The versions are Actual, Budget and Forecast. Actuals come from the company's ERP system. Budget and forecast come from planners' inputs and the formulas in this folder.

## The P&L

| Line | How it is computed |
| --- | --- |
| Gross Sales | Units × list price |
| − Standard Discounts | Gross sales × the discount rate agreed with the customer group for the brand |
| − Promo Discounts | Gross sales × the promotion rate, in promotion months only |
| = Invoice Sales | |
| − Rebates | Invoice sales × the rebate rate. Actual rebates arrive as credit notes per customer and are spread to products by invoice sales. |
| − Trade Fees | Listing and promotion fees per customer group, spread to its customers and products by invoice sales |
| = Net Sales | |
| − COGS | Units × standard cost |
| = Gross Margin | |
| − Logistics | Each country's warehouse and transport costs, spread by shipped weight. A chilled or frozen kilogram counts more than an ambient one. |
| − Sales Force | The cost of each sales team, per channel and country, spread by invoice sales |
| − Marketing | Brand spend per country, spread by net sales |
| = Contribution Margin | Per customer and product |
| − Overheads | All other operating expenses, per country |
| = EBIT | Per country |

The model computes every line down to customer, product and month, in all three versions. `8-report.fml` then posts the lines to a P&L by brand, channel and country. Summed over all its lines, that P&L equals EBIT.

## Actuals and plan

Actuals load once, with no version. A version shows them only in the months it knows. Two inputs per version and month decide this.

- `FC Known IN` marks the months whose actuals the version knows.
- `FC Horizon IN` marks the months the version reports.

A month that is reported and known shows actuals. A month that is reported and not yet known shows plan. In the planned dataset, actuals run to June 2026 and the flags look like this.

| Version | Reports | Shows actuals | Shows plan | Knows actuals up to |
| --- | --- | --- | --- | --- |
| Actual | Y2024 M1 to Y2026 M6 | All months | None | Y2026 M6 |
| Budget | Y2026 M1 to M12 | None | All months | Y2025 M12 |
| Forecast | Y2026 M1 to M12 | Y2026 M1 to M6 | Y2026 M7 to M12 | Y2026 M6 |

No formula names a version. Closing a month is a data change. Load the month's actuals, then move the two flags.

The plan works like this.

- **Volume.** A planner sets a yearly target per customer group and category. The model phases it to customers, products and months by last year's mix over the whole year. Each version keeps only its plan months. So a forecast with six months of actuals takes the target's share of the last six months. Where there is no target, volume is last year's volume times planned growth. A planner can also type the volume of one customer, product and month. That value wins.
- **Price.** The last known list price, held flat, times a planned increase.
- **Everything else.** Discount and rebate rates, trade fees, standard costs, marketing spend and operating expenses are planner inputs.

Each input sits at the level the business decides at, which is mostly coarser than customer and product. Formulas carry the values down.

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
Customer → Region → Country
Cost Center → Function, Country, Channel
Account → Account Group
```

- A **material** is one ERP code, such as a promo pack or a new artwork. Several materials make one planning **SKU**. Actuals arrive per material. The model sums them into SKUs before anything else reads them.
- A **customer group** is a retail chain or a buying group. Terms, targets and fees are agreed at this level.
- A **cost center** belongs to one function. Logistics and sales cost centers feed the allocations. All others are overheads.
- **PL Line** holds the lines of the management P&L.
- **Versions**, **Years** and **Months** are built in.

`relations.fml` declares every link. Each link is many-to-one and every path is balanced. The members of the fixed dimensions are in `dimensions/`. Customers, products, regions and the other members come with the dataset. How many there are depends on the data size.

A code that is missing from master data still loads. It becomes a new member whose parents are the `NULL` members, such as `NULL (Customer Group)` and `NULL (Region)`. Its values reach every total through them.

## Files

The model is split into layers. Each layer reads only the layers before it.

| File | What it does |
| --- | --- |
| `0-setup.fml` | The two version inputs, and the flags for actual months and plan months |
| `1-import.fml` | Where actuals load. Invoice lines per customer, material and month, credit notes, trade fee invoices, master data and the general ledger. |
| `2-actuals.fml` | Sums materials into SKUs, spreads rebate credit notes to SKUs, prices actual COGS and shifts last year's volume |
| `3-inputs.fml` | The planner inputs. These are the cells planners write. |
| `4-plan.fml` | The plan, on plan months only, including the volume target cascade |
| `5-merge.fml` | Actual part plus plan part, for each line. Every later layer serves all versions with one formula. |
| `6-margin.fml` | Subtotals and four cost allocations, down to contribution margin |
| `7-ebit.fml` | Overheads and EBIT per country |
| `8-report.fml` | The P&L by line, brand, channel and country, and the KPI measures |
| `9-checks.fml` | Controls. Each one is empty or zero on a healthy model. |
| `relations.fml` | The hierarchies |
| `dimensions/*.csv` | Members of the fixed dimensions. The first column is the member and `@description` is its label. Any other column names the member's parent. |

## What the model makes an engine do

Each item is something real planning models do.

- Keep a sparse cube sparse. In any month a customer buys only a small share of the products.
- Roll up through deep and parallel hierarchies, from material to division and from customer to channel and country.
- Apply a coarse rate to every customer and product under it.
- Spread a target down by computed shares.
- Sum source codes into planning SKUs before anything else reads them.
- Allocate a cost pool by a computed key. Sum the key to the pool's level, take each cell's share and multiply it by the pool. Trade fees, logistics, sales force, marketing and rebate credit notes all work this way, each with its own key.
- Split brand spend to countries by a key that a planner typed.
- Show an actual that has no version in every version that knows its month, then merge it with the plan.
- Move the actuals cutoff with a data write.
- Read last year's value for the same month.
- Hold a value flat into later months.
- Filter a roll-up by members, with set logic.
- Post computed amounts to fixed report lines, then read them all as one P&L.
- Compute ratios when they are read, as a ratio of totals.
- Keep controls inside the model.
- Recalculate a long chain of formulas, from an imported invoice line to EBIT.

## Reading FML

FML describes a model as a list of variables. A variable is a cube of numbers. Here is one from `6-margin.fml`.

```
"Net Sales" { Customer, SKU, Versions, Years, Months } = "Invoice Sales" - "Rebates" - "Trade Fees"
  @rollup sum
  @folder "Margin"
  @readonly true
```

- The name comes first. A name with spaces is quoted.
- The braces hold the grain, the dimensions of the cube. Net Sales has one value per customer, SKU, version, year and month.
- The formula follows `=`. It is evaluated for every cell of the grain. A variable with no formula is an input. Its values are loaded or typed.
- Properties follow on the indented lines. `@rollup` says how values add up when they are read at a coarser level. `@readonly true` marks everything a planner does not type. `@folder`, `@notes`, `@format` and `@type` describe the variable.
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
| `... ACT` | Actuals summed to the planning grain |
| `... ACT part`, `... PLAN part` | The actual side and the plan side of a line, before the merge |
| `... OUT` | A final result that nothing else reads |
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

**A cell exists or it does not.** Missing is not zero. The model never stores a zero to mean "nothing here".

**A finer operand is rolled up first.** `"Invoice Sales by Customer Group" = "Invoice Sales"` adds up the invoice sales of each group's customers and SKUs. A roll-up follows the operand's `@rollup`. In this model every operand that gets rolled up sums.

**Cells come from the operands that span the grain.** A formula creates cells where its operands with all of the target's dimensions have cells. An operand with fewer dimensions is looked up at each of those cells, through the hierarchy links. That is how a rate per customer group and brand reaches every customer and SKU under them. Such an operand never creates cells on its own. Neither does a constant.

**Operands that each span part of the grain combine.** In `if(eq("FC Actual", 1), "Volume ACT")`, the flag has versions and months, and the actuals have customers, SKUs and months. The result has a cell for each pair of cells that agree on their shared dimensions, here the year and month. That is how an actual appears in every version that knows its month.

**A dimension that no operand has repeats the value.** `Marketing Split Monthly` adds months to a yearly input. The yearly value repeats in every month.

**`+` and `-` count a missing value as 0.** The result has a cell wherever either side has one.

**`*` and `/` need both sides.** If either side is missing, there is no cell. The KPI measures follow this rule too. Every division in a stored variable checks its denominator first, and its numerator decides where the cells are. So no stored division ever meets a missing numerator.

**Conditions.** `if(c, x)` has a cell only where `c` holds and `x` has a value. In this model, a condition on a missing value is false.

**Time.** `delay(x, 12)` moves every value twelve months later, across year ends. Values moved past the last month are dropped. `cumsum(0, 0, x)` holds the last value of `x` in every later month, to the end of the timeline. Before the first value there is no cell.

**Filters.** `sum("OPEX", Function>Logistics)` adds up only the cells of cost centers in the Logistics function. `not(or(Function>Logistics, Function>Sales))` takes every other cost center. That includes cost centers with no known function.

**Reading at a coarser level.** Any variable can be read at any level of its dimensions. `@rollup sum` adds up the cells. `@rollup average` takes the plain average of the cells that exist. A measure is computed from the totals of its operands at the level read, so a margin percentage is always a ratio of totals.

## Not in this version

- Calculated dimension members, such as a Net Sales member made of other members
- Currencies. Every amount is in euros.
- Balance sheet and cash flow
- Many-to-many hierarchies
- Splashing, where the engine spreads a typed total down a hierarchy. The volume target cascade does this with formulas.
- Weeks and days, warehouses, inventory and headcount

## How the model was checked

The model runs in Farseer's engine on a small dataset that reaches every formula path. Every stored cell of every calculated variable matched an independent calculation in plain JavaScript, to a relative error of 1e-9. That dataset and that calculation will move into this repo next.
