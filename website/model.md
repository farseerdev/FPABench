{{version}}

A consumer goods company makes food, drinks, home care and personal care products. It sells them to retail chains, independent shops, wholesalers, hotels and restaurants, and web shops in six countries.

Finance plans and reports the P&L per customer, product and month. Actuals come from the ERP system. Planners make the budget, two forecasts and a what-if.

Each country plans in its own currency. Three use the euro, and Poland, Czechia and Hungary their own. Standard costs and the central marketing budget are set in euros and convert at each version's rate. The P&L is also reported in euros.

## The P&L

| Line | How it is computed |
| --- | --- |
| Gross Sales | Units × the list price in the customer's country |
| − Standard Discounts | Gross sales × the rate agreed with the customer group for the brand |
| − Promo Discounts | Gross sales × the promotion rate, in promotion months |
| − Logistics Discounts | Gross sales × the customer group's rate for delivery to its own warehouse |
| **= Invoice Sales** | |
| − Rebates | Invoice sales × the customer group's rebate rate |
| − Growth Bonus | A rate on the whole year's sales, if the customer group beats last year by more than its threshold |
| − Trade Fees | Listing, shelf and promotion fees per customer group and brand, spread by sales |
| − Promo Funding | Payments per customer and product after a promotion |
| **= Net Sales** | |
| − Cost of Goods Sold | Units × standard cost |
| **= Gross Margin** | |
| − Logistics | Warehouse and transport costs per country, spread by shipped weight. Chilled and frozen goods count more. |
| − Sales Force | Sales team costs per channel and country, spread by sales |
| **= Contribution Margin II** | |
| − Marketing | Brand spend per country, spread by net sales |
| **= Contribution Margin III** | |
| − Overheads | All other operating costs, per country |
| **= EBIT** | |

Everything down to gross margin is computed per customer, product and month. The costs below it are fixed per country, channel or brand, so the contribution margins stop at customer and brand.

## Actuals and plan

Actuals run from January 2023 to June 2026. Each version shows actuals in its closed months and plan in the others. The 2026 Budget is all plan. FC 3+9 has three months of actuals and nine of plan, and FC 6+6 six of each. The What-if starts from FC 6+6 with its own inputs.

The plan is made like this.

- **Volume.** A yearly target per customer group and category, spread to customers, products and months by last year's mix. Without a target, last year's volume plus planned growth. Planners can also type the volume of one customer, product and month.
- **Price.** The last actual list price, plus a planned increase.
- **Discount and rebate rates.** Taken from the actuals and held flat, unless a planner types a new rate.
- **Growth bonus.** On or off for the whole year, depending on the year's sales against last year.
- **Everything else** is typed by planners. That is promotions, trade fees, promo funding, standard costs, exchange rates, marketing budgets and overheads.

## Dimensions

Each arrow means "rolls up to".

{{hierarchies}}

A customer is the account that places the order. A customer group holds the trade agreement, such as a chain's head office or a buying group. Several ERP codes, such as a promo pack, make one planning SKU.

## Why it is hard to run

Each of these is common in real planning models. Together they make one typed number move many others.

- Most customers buy few of the products in any month, so most combinations are empty.
- Costs are spread by keys the model computes, such as each customer's share of shipped weight.
- A yearly target is spread down by last year's mix.
- One change can switch a growth bonus on or off for all twelve months.
- Actuals and plan sit in the same version, split by the closed months.
- A long chain of formulas runs from one invoice line to the euro P&L.

## The model in FML

The model is written in FML, the Financial Modeling Language. Each variable is a cube of numbers. It has a name, the dimensions it is broken down by, and a formula.

{{fml-example}}

A variable without a formula is an input, loaded from files or typed by planners. Systems that do not read FML run a translation, and it must give the same numbers. The [full model description](../model/README.md) has the calculation rules, and the [model files](../model/) have every formula.

Not in this version: balance sheet and cash flow, headcount, inventory, weekly plans and constant-currency reports.
