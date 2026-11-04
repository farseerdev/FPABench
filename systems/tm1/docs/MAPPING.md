# FPABench model → TM1 mapping (the four FPB cubes)

Every variable of the FPABench model (the `model` folder of the FPABench repository) and where it lives in TM1. "Consolidated read" means a `DB()` on
consolidated elements: TM1 sums the fed/stored leaves natively, no rule. "Inline" means the variable has no
cells of its own: it is an expression inside the rule that needs it.

Short names: **R** = FPB_Reporting, **D** = FPB_Drivers, **C** = FPB_Control, **FX** = FPB_FX.
R coordinates are written (Customer, Product, Account, Measure); everything in R is on `LCY`, `Periodic`,
the customer's channel and country, `NoCostCenter`, unless stated otherwise.

## Coordinates in FPB_Reporting

| Grain | Customer | Product | Account / Measure |
|---|---|---|---|
| customer × SKU | customer | SKU | `NoAccount`/`Units`; `P100`…`P150`/`Amount` (signed: P100 +, all others −); helpers `Invoice Sales Positive`, `Invoice Sales Plan`, `Handling KG` @ `NoAccount` |
| customer × brand | customer | `<brand> (Brand Level)` | `P170`, `P180`, `P190`/`Amount`; helpers `Handling KG Positive`, `IS Positive CB`, `NS Positive CB` @ `NoAccount` |
| no customer could carry it | `NoCustomer` | `NoProduct` or `<brand> (Brand Level)` | unallocated `P130` `P135` `P140` `P170` `P180` `P190`; `P210` overheads on the real cost center |

Account consolidations give the subtotals: `Invoice Sales` (P100–P125), `Net Sales` (+P130–P145),
`Gross Margin` (+P150), `Contribution Margin II` (+P170, P180), `Contribution Margin III` (+P190), `EBIT` (+P210).
Read totals: Customer `All_Hierarchies` (all, incl. NoCustomer) or `By Currency` (customers only);
Product `All_Hierarchies` / `By Product` (all) or `By Division` (SKUs only); Cost center `All_Hierarchies`.

## Layer 0 — setup
| FPABench | TM1 |
|---|---|
| FC Closed IN, FC Horizon IN | C input (v, Default, y, m) |
| FC Actual, FC Plan | C rules |
| FC Plan Months | C rule on month `Annual` (consolidated FC Plan over M1–M12) |
| (new) Feed Actual Copy, Feed Plan | C stored on version Actual, by z.FPB.Control.FeedFlags — feeder switches only |

## Layer 1 — imports
| FPABench | TM1 |
|---|---|
| IMPORT Volume, Gross Sales, Standard/Promo/Logistics Discounts, Promo Funding {Customer, Material} | R version `Actual` (the actuals store), customer × **SKU** (materials summed by the loader with CellIncrementN), Units / P100 / −P110 / −P120 / −P125 / −P145 |
| IMPORT Rebates, Rebate True-ups, Growth Bonus {Customer Group} | D Actual (ch(g), g, NoProduct, ctry(g)) |
| IMPORT Trade Fees {Customer Group, Brand} | D Actual (ch(g), g, brand) |
| IMPORT List Price {SKU, Country} | D Actual (NoChannel, NoCustomer, SKU, country) |
| IMPORT Standard Cost {SKU, Years} | D Actual (SKU, Global, month Annual) |
| IMPORT Unit Weight {SKU} | FPB_Product attribute `UnitWeightKg` |
| IMPORT Handling Factor {Temperature Zone} | FPB_Product attribute `HandlingFactor` on Ambient/Chilled/Frozen |
| IMPORT FX Rate {Currency} | FX Actual, `Average`, EUR → currency |
| IMPORT OPEX {Cost Center, Account} | D Actual (NoChannel, NoCustomer, NoProduct, cost center, account, ctry(cc)) |
| IMPORT Marketing {Brand, Country} | D Actual (NoChannel, NoCustomer, brand, country) |
| IMPORT Control Total {Country} | D Actual (country) |

## Layer 2 — actuals leveling
| FPABench | TM1 |
|---|---|
| Volume ACT … Promo Funding ACT | the Actual store itself |
| Invoice Sales ACT | R Actual, Account `Invoice Sales` |
| Invoice Sales ACT by Group | consolidated read (Customer = group, Product `By Division`) |
| Group Key ACT, Rebate Expense ACT | inline in the Actual branch of P130 / P135 |
| Rebates ACT, Growth Bonus ACT | R P130 / P135 on version Actual (rule) |
| Rebates / Growth Bonus Unallocated ACT | D `Rebates Unallocated` / `GB Unallocated` (whole amount when the group's invoice sales ≤ 0, else 0 — the closed form of "expense − what the key placed") |
| Gross Sales / Standard Discounts ACT by Group Brand, … by Group | consolidated reads |
| Standard Discount / Rebate / Logistics Discount Rate ACT | inline in the reset branch of the carry rules |
| COGS ACT | R P150 on version Actual |
| Volume LY | inline: R Actual Units at `Prev` year |
| Invoice Sales ACT LY, Invoice Sales LY by Group | consolidated read at `Prev` year (GB Rate) |

## Layer 3 — inputs (D unless noted; typed cells also carry `<measure> Entered` = 1)
| FPABench | Coordinates |
|---|---|
| Volume Growth IN {Brand, Channel, Years} | (channel, NoCustomer, brand, Global, Annual) |
| Volume Target IN {Customer Group, Category, Years} | (ch(g), g, category, ctry(g), Annual) |
| Volume Override IN, Promo Funding IN {Customer, SKU, Months} | (ch(g), customer, SKU, ctry(g), month) |
| Price Increase IN {Brand, Years} | (NoChannel, NoCustomer, brand, Global, Annual) |
| Standard / Promo Discount IN, Trade Fees IN {Customer Group, Brand, Months} | (ch(g), g, brand, ctry(g), month) |
| Logistics Discount IN, Rebate Rate IN {Customer Group, Months} | (ch(g), g, NoProduct, ctry(g), month) |
| Growth Bonus Rate IN, Growth Bonus Threshold IN {Customer Group, Years} | (ch(g), g, NoProduct, ctry(g), Annual) |
| Standard Cost IN {SKU, Years} | (NoChannel, NoCustomer, SKU, Global, Annual) |
| FX Rate IN {Currency, Months} | FX plan version, `Average`, EUR → currency |
| Marketing Spend IN {Brand, Months} | (NoChannel, NoCustomer, brand, Global, month) |
| Marketing Split IN {Brand, Country, Years} | (NoChannel, NoCustomer, brand, country, Annual) |
| OPEX IN {Cost Center, Account, Months} | (NoChannel, NoCustomer, NoProduct, cc, account, ctry(cc), month) |

## Layer 4 — plan
| FPABench | TM1 |
|---|---|
| Volume LY Plan, Volume Growth Baseline, Volume LY by Group Category, Volume Target Key, Volume Target Cascade, Volume Baseline, Volume Planned, Volume Plan | one R Units rule (override wins; else target × LY / LY of group × category if a target is entered and that LY > 0; else LY × (1 + growth)); plan months only through gate rule 4 |
| List Price Reset / Carry / Plan | D `List Price Carry` (recursive over months, reset inline) / `List Price Plan` |
| Standard Discount / Rebate / Logistics Discount Rate Reset, Carry, Rate | D `… Carry` (recursive) / `Std Disc Rate`, `Rebate Rate`, `Log Disc Rate` |
| FX Rate Reset / Carry / Plan | FX `Carry` / plan branch of FX `Effective` |
| Gross Sales, Standard, Promo, Logistics Discounts Plan | R P100, P110, P120, P125 (plan branch) |
| Promo Funding Plan | R P145 (plan branch) |
| Standard Cost Plan | D `Standard Cost Plan` |
| COGS Plan | R P150 (plan branch) |
| Invoice Sales Plan | R helper `Invoice Sales Plan` |
| Rebates Plan | R P130 (plan branch) |
| Invoice Sales by Group Year, Invoice Sales Plan by Group Year | consolidated reads (months `All_Hierarchies`) |
| Growth Bonus Rate, Entitlement, Booked Monthly + Booked, Remaining | D `GB Rate`, `GB Entitlement`, `GB Booked` (12 explicit FC Actual months), `GB Remaining` |
| Growth Bonus Plan | R P135 (plan branch) |
| Growth Bonus Plan Unallocated | D `GB Plan Unallocated` |
| Trade Fees Plan, OPEX Plan | inline (Trade Fees IN / OPEX IN, plan months through the gate) |
| Marketing Spend Plan, Marketing Split Monthly, Marketing Plan EUR, Marketing Plan | D `Marketing Pool` (plan branch: split × spend × planning rate) |

## Layer 5 — merge
All merges are two generic R rules: **rule 3** — a non-Actual version shows the Actual version's cell in its
FC Actual months; **rule 4** — a month that is neither FC Actual nor FC Plan is empty. This is exact here because
every downstream variable in an FC Actual month depends only on actuals. Rebates /
Growth Bonus Unallocated → the D helpers; Trade Fees Pool, OPEX → inline; Marketing Pool → D `Marketing Pool`;
FX Rate → FX `Effective`.

## Layer 6 — margin and allocations
| FPABench | TM1 |
|---|---|
| Invoice Sales, Net Sales, Gross Margin | Account consolidations |
| Volume KG, Handling KG | R helper `Handling KG` (Units × UnitWeightKg × HandlingFactor) |
| Invoice Sales Positive / by Group Brand | R helper / consolidated read at (group, brand) |
| Trade Fees Key, Trade Fees | R P140 (key inline) |
| Trade Fees Unallocated | D `Trade Fees Unallocated` → R P140 on NoCustomer, brand level |
| … by Customer Brand (Invoice/Net Sales, Gross Margin, Handling KG) | consolidated reads at (customer, brand) |
| Logistics Pool, Sales Force Pool | consolidated reads of D OPEX (cost-center rollups `Logistics`, `<channel>`) |
| Handling KG Positive / by Country; Logistics Key, Cost, Unallocated | R helper at brand level / consolidated read / R P170 at brand level / R P170 on NoCustomer |
| Invoice Sales Positive by Customer Brand / by Channel Country; Sales Force Key, Cost, Unallocated | R helper `IS Positive CB` / consolidated read / R P180 / R P180 on NoCustomer |
| Contribution Margin II | Account `Contribution Margin II` at (customer, brand) |
| Net Sales Positive / by Brand Country; Marketing Key, Cost, Unallocated | R helper `NS Positive CB` / consolidated read / R P190 / R P190 on NoCustomer |
| Contribution Margin III | Account `Contribution Margin III` (customers only: Customer `By Currency`) |

## Layers 7–8 — EBIT and report
| FPABench | TM1 |
|---|---|
| Overheads | R P210 per cost center on NoCustomer (every cost center not Logistics/Sales) |
| Contribution Margin III by Country | Account `Contribution Margin III`, Customer `By Currency`, Product all |
| … Unallocated by Country, Unallocated by Country | the NoCustomer postings, consolidated |
| EBIT OUT | Account `EBIT`, all customers/products/cost centers/channels, `LCY` |
| EBIT EUR OUT | the same on `EUR` (rule 0: LCY ÷ Effective rate) |
| PL Gross Sales … PL Marketing Unallocated | the P-line cells above |
| PL OUT {PL Line, Brand, Channel, Country} | Account P-line at Product = brand (or NoProduct = NULL (Brand)), channel, country, `LCY` |
| PL EUR OUT | the same on `EUR` |
| Volume by Brand Channel Country, Volume for KPIs | Units, consolidated |
| 18 KPI measures | FPB_Reporting_m KPI elements: rules without N:/C: ratio of totals at whatever level is read. Not fed: hidden by zero suppression, returned by direct reads |

## Layer 9 — checks
`z.FPB.Check.Run` (Import Total, Marketing Split, Growth Bonus, OPEX in EBIT, EUR Rate, PL without FX Rate,
Marketing without FX Rate) and `z.FPB.Check.Cells` (Uncosted Volume, Uncosted Plan Volume, Unpriced Volume,
Volume without FX Rate, over every fed Units cell). Kept out of the rules so they cost nothing at calc time.

## Model changes M1 and M4
`rules/FPB_Reporting.M1.rux` drops the handling factor from `Handling KG`. `rules/FPB_Reporting.M4.rux` adds the
marketing-staff pool (OPEX of cost-center rollup `Marketing`) allocated by `NS Positive CB` share of the
country onto P190 at brand level, the rest on P190 NoCustomer/NoProduct/NULL (Channel), and removes the
Marketing function from P210.
