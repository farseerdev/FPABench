# The FPABench tests

Version 0.9-draft. The tests will change before version 1. Every change is listed in [CHANGELOG.md](../CHANGELOG.md).

FPABench times what a planning team does every day. It loads actuals, types numbers into the plan, reads reports and changes the model. Each test does one of these to [the model](../model/README.md).

| File | What it holds |
| --- | --- |
| `README.md` | The tests, for people |
| [`tests.json`](tests.json) | The same tests for the runner, with exact cells, values and expected results |
| [`method.md`](method.md) | How the tests are timed, repeated, reset and checked |

## How a test works

Every load, write and model change ends with a proving read. The timer stops when that read returns the right answer. A fast wrong answer is a failure.

Most writes and some reads pick their cells at random. The test gives a rule, such as "a customer in the biggest customer group of its country, a SKU it buys, a plan month". A seed picks among the matching cells. The same rule works at every data size. Published runs use a public seed. A check run uses a second, unpublished seed, so a system cannot be tuned for the published cells.

Writes go to the FC 6+6 version unless a test says otherwise. Its plan months are Y2026 M7 to M12.

Each test expects one of three kinds of result.

| Kind | Meaning | Example |
| --- | --- | --- |
| Value | The reference program's exact answer | The company P&L for FC 6+6 |
| Delta | A change the test states | 1,000 more in OPEX lowers EBIT by 1,000 |
| Unchanged | A value that must not move | EBIT of a country the write cannot reach |

[method.md](method.md) has the full rules for checking answers.

## Loads

| Id | Test | Proving read | Expected result |
| --- | --- | --- | --- |
| L1 | **Initial load.** The ERP export, master data, planner inputs and version flags, from an empty system. | `EBIT EUR OUT` by country, version and month | Value. Every check equals its published value. |
| L2 | **Monthly close.** Load the actuals of Y2026 M7, then close M7 in the Actual version. | `EBIT OUT` of Actual, Y2026 M7 | Value. `CHECK Import Total` is 0. |
| L3 | **Change a weight in master data.** One SKU's unit weight. | `Logistics Cost` of the SKU's brand | Value. `EBIT OUT` is unchanged. |

L2 loads the `increments/close-2026-07` folder of the dataset.

## Writes

| Id | Test | Proving read | Expected result |
| --- | --- | --- | --- |
| W1 | **Type one volume.** One customer, SKU and plan month. | `EBIT OUT` of the country | Value |
| W2 | **Paste 1,000 volumes** in one country, across the six plan months, in one transaction. | `Volume` of the country over the plan months | Delta. The sum of the changes. |
| W3 | **Change a rebate rate** of one customer group and month. | `EBIT OUT` of the country | Delta. Rate change × the group's invoice sales. |
| W4 | **Raise a brand's price** for the year. | `Gross Sales` of the brand | Delta. × (1 + new) / (1 + old) in plan months. |
| W5 | **Change a planning exchange rate** of one currency and month. | `COGS` of that country and month | Delta. × new rate / old rate. |
| W6a | **Change a warehouse's cost.** It is allocated to customers. | `EBIT OUT` of the country | Delta. EBIT falls by the change. |
| W6b | **Change an office's cost.** It is not allocated. | `EBIT OUT` of the country | Delta. EBIT falls by the change. |
| W7 | **Set a yearly target** for one customer group and category. The model spreads it down. | `Volume` of the group and category | Value |
| W8 | **Flip a yearly bonus.** Move a group's growth threshold across its growth. The group's bonus rate is above 0. | `Growth Bonus` of the group for the year | Delta. Bonus rate × the year's invoice sales. |

W6a and W6b write the same kind of cell. W6a moves thousands of allocated cells, and W6b moves one total. An engine that recalculates only what a change reaches does far less work for W6b.

## Reads

| Id | Read | Answer size |
| --- | --- | --- |
| R1 | **Company P&L.** `PL EUR OUT` by line and month. | 13 × 12 |
| R2a | **P&L by brand.** `PL EUR OUT` by line and brand. | 13 × brands |
| R2b | **P&L by channel.** `PL EUR OUT` by line and channel. | 13 × 6 |
| R2c | **P&L by country,** in its own currency. `PL OUT` by line and country. | 13 × countries |
| R3 | **Plan against last year.** `PL EUR OUT` by line for Budget, FC 6+6 and last year's actuals. | 13 × 3 |
| R4 | **Ratios.** The 18 KPI measures by country and version. | 18 × countries × 5 |
| R5 | **Drill to the detail.** The gross-to-net lines by customer and SKU for one customer group, in M7. | 12 × the group's rows |
| R6 | **Margin by product attributes.** `Gross Margin` by country, category and price tier. | small |
| R7 | **Top customers.** The 100 largest by `Contribution Margin III`, in one country. | 100 |
| R8 | **Open the model.** Start the system and read `EBIT EUR OUT`. | 1 |

Reads cover FC 6+6 and Y2026 unless they say otherwise. An amount in a local currency is never added across countries.

## Model changes

| Id | Change | Proving read | Expected result |
| --- | --- | --- | --- |
| M1 | **Change a formula.** Handling weight no longer weighs chilled and frozen goods more. | `Logistics Cost` by brand and country | Value. `EBIT OUT` is unchanged. |
| M2 | **Add a customer** to a customer group, with a typed volume. | `Volume` of the group | Delta. The typed volume. |
| M3 | **Move a customer** to another group in the same country. | `Gross Sales` of both groups | Value. Actual totals by country are unchanged. |
| M4 | **Allocate one more cost.** Marketing staff costs are spread to customers and brands. | `Contribution Margin III` by country | Delta. It falls by what the pool allocated. `EBIT OUT` is unchanged. |

## Checks without a timer

| Id | Check | Expected result |
| --- | --- | --- |
| C1 | Type a volume into a closed month. | Nothing changes. |
| C2 | Read every `CHECK` variable. | Each equals its published value. |
| C3 | Read another country's `EBIT OUT` right after each W1 write. | Unchanged |
