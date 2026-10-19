# Changelog

Changes to the model, the data, the tests and the method, newest first. A change that can move a result raises the version.

## 0.9-draft, 2026-10-19

- DuckDB and ClickHouse find the versions and years of `cells.csv` with SQL on the file itself, and ClickHouse reads its column names with `DESCRIBE`. Before, the adapters read the whole file into Node memory for these, and at 1b both ran out of Node heap before the database saw any data. RAMA reads the two columns line by line, since it cannot read the file before its dimensions exist. On a laptop at 10m every answer stayed the same.
- Test W9, copy a version, is removed for now. It waited on a way to copy a version, and no runner code or adapter call for it existed. It never ran, so no result moves. The result files no longer list it.
- New results in `results/10m/` and `results/100m/`, from runs of every entry on 2026-10-19 on FPABench `c85ca46`. Each entry ran on its own new `n2d-standard-4` with a local NVMe SSD. Every ready test passed at both sizes, and `runner/compare.mjs` found no difference in any of the 26 tests it compared. RAMA's 1b run is in `results/off-method/1b/`. It ran on an `n2d-highmem-16`, outside the method, because on the method's machine the run was killed during the first load, most likely for lack of memory.
- The run machine gets a local NVMe SSD of 375 GB, and every system keeps its data, its snapshot and any Docker storage on it. The boot disk stays an SSD persistent disk. Before, everything was on the persistent disk, which a system's state and snapshot could fill. This can move every result that touches the disk, so results from before and after are not comparable. The results of 0.8-draft ran on a persistent disk.
- RAMA's load sends the model through `modelImport` and the input cells through its native cell import, streamed from `cells.csv`. Before, every cell went inside the `modelImport` JSON, and at 1b the adapter ran out of Node heap at 4 GB and again at 12 GB, before RAMA did any work. A cell that appears twice in `cells.csv` now stops the load, since the import would keep only one of the two. On a laptop at 10m the load took 10.0 s against 10.4 s before, with the same answers.
- ClickHouse keeps the join order the translator writes (`query_plan_optimize_join_order_limit = 0`). At 100m its own join reordering made the `Growth Bonus Plan` statement run for more than 15 minutes, so the run did not finish its first load. With the setting the same statement takes 0.04 s. At 10m both orders were fast.
- RAMA's model change no longer calls `recalc()` after the commit. The commit already updates every cell a changed formula reaches. On a laptop M1 went from 3.0 to 1.9 s, with the same answers.

## 0.8-draft, 2026-10-15

- When one chain of joins lists a calculated table's cells, the SQL translator carries the value of each operand in that chain. So each operand is joined once, and the chain needs no `DISTINCT`. Before, the chain gave the distinct cells, and every operand was joined to them again. On the model, 45 of the 167 calculated tables get new SQL. A full rebuild has 49 `SELECT DISTINCT` instead of 94. Only tables are built this way, so it applies to DuckDB and ClickHouse. Views of every kind, such as RisingWave's materialized views, keep the SQL of 0.7-draft, because the new shape was measured on DuckDB and ClickHouse only.
- A measure read by dimensions computes each sum once. The sums are tagged with their index, united with `UNION ALL`, and set side by side by one `GROUP BY`. Before, the keys of all the sums were listed, and every sum was joined to them. DuckDB and ClickHouse read this way. RisingWave keeps the joins, because the new shape was measured on DuckDB and ClickHouse only. Of the tests, only R4 reads measures by dimensions.
- The runner calls an adapter's `settle()`, if it has one. It returns when the system has finished background work it started, such as compiling the plans of new statements. The runner calls it after each restore and after the cold run of R1 to R7, and just before L2, L3, a bulk write, a model change or the first timed write of a write test. The wait is not timed. No entry has a `settle()` yet, so no result moves because of it.
- Measured with an interleaved A/B test on the same `n2d-standard-4` as the new results below, right after their run. Each round ran 0.7-draft, then this version, for DuckDB and then ClickHouse. The second round ran them in reverse order. For loads, writes, model changes and R8, the two rounds of each version agreed within 6%. Every answer matched RAMA in every run. With this version, each write test's median takes 16 to 22% less time in DuckDB (W1 from 1.75 to 1.41 s). In ClickHouse it takes 18 to 27% less (W1 from 3.14 to 2.34 s). Loads take 7 to 28% less time in DuckDB and 14 to 35% less in ClickHouse. Model changes take 15 to 24% less in DuckDB and 22 to 27% less in ClickHouse. R8 takes 15% less in DuckDB and 16% less in ClickHouse. R4 is the only read whose SQL changes. It takes 28% less time in DuckDB and 21% less in ClickHouse. The other reads take a few milliseconds. They moved by up to 15% in DuckDB (0.3 ms) and up to 55% in ClickHouse (R3, 3.8 ms). Two rounds of one version differed by up to 78% on these reads.
- New results in `results/10m/`, from one run of all three entries on 2026-10-15, from 18:40 to 18:59 UTC. The run used a fresh `n2d-standard-4` with a 200 GB SSD persistent disk and Ubuntu 26.04.1. Every ready test passed its checks on all three entries. Every answer matched across the three: `runner/compare.mjs` found no difference in any of the 26 tests it compared. Compare systems within one run, and measure a change with an interleaved A/B test, not against an older run.

## 0.7-draft, 2026-10-12

- First draft of the runner, in `runner/`. One runner for every system, with an adapter per system. It picks cells from the seed, times each test on the client, restores a snapshot before each test, and checks every expectation it can state. `runner/compare.mjs` compares the answers of all systems, until there is a reference program.
- Ratios are compared within 1e-6 relative or 1e-12 absolute, whichever is larger. Before, a ratio of 0 against 5e-19 counted as a difference.
- Test M4 is written out as model edits, in `runner/lib/changes.mjs`. It allocates the marketing staff by positive net sales per country into contribution margin III, and adds two P&L lines so the P&L still sums to EBIT.
- The first two entries, in `systems/`: RAMA 1.9.0-ffad51e.0, and DuckDB 1.5.6 with every calculated variable as a table rebuilt after each write.
- A third entry, ClickHouse 26.9.16.11 with every calculated variable as a table. The SQL translator is shared, in `systems/sql/`, and writes each table's operands as an explicit chain of joins.
- The first results, in `results/10m/`, from one `n2d-standard-4`. They are provisional until a rerun with the fixes below.
- Both SQL entries keep their calculated tables in memory (DuckDB `TEMP`, ClickHouse `Memory`) and only the inputs on disk. After a restart they build them again, and a cold read pays for it. The translator reads a table straight from its operand when one operand gives every cell, and builds each dimension lookup once per rebuild. On a laptop a rebuild went from 5.2 to 2.1 s in DuckDB and from 6.9 to 3.8 s in ClickHouse, with the same answers.
- RAMA's reads list the combinations that have a value with `generateCombinations`, as a Farseer sheet does, instead of asking for every combination the filters allow. R5 went from 173 ms to 5 ms on a laptop, with the same answers.
- Both SQL entries rebuild only the calculated tables a change reaches, found from the formulas, instead of all of them. A member change still rebuilds everything. On a laptop a rebate rate write went from 2.2 to 0.4 s in DuckDB and from 3.9 to 0.9 s in ClickHouse, with the same answers.
- Both SQL entries store integer member ids in every key column instead of names, with one dictionary per dimension in the dimension tables. Sums whose terms all have the target's dimensions are `UNION ALL` plus `GROUP BY` instead of joins. On a laptop a rebate rate write went from 0.43 to 0.11 s in DuckDB and from 0.92 to 0.35 s in ClickHouse, with the same answers.
- Runner fixes after review: every write takes a fresh cell, and a test with too few cells writes fewer times. L2 and L3 wait for `sync` like L1. I1 and C2 check every stored cell. A W1 write that moves another country fails W1. R8 reports its time as cold too. Caches and picks are kept per dataset. Large sizes run loads and reads only. A difference in any answer of a test fails it. The website shows them in place of the demo data.

## 0.6-draft, 2026-10-12

- First draft of the data generator, in `data/`. It writes one company at four sizes, named by their model cells: 10m, 100m, 1b and 10b. The same size always gives the same bytes, and `manifest.json` lists the SHA-256 of every file.
- The data is clean UTF-8 CSV with a schema. Codes are text. Actuals come as monthly totals per customer and material, the way planning tools load them. Returns net into the month they come back in, so a month can be negative.
- Each size also writes four later loads: the actuals of July 2026, a correction of March 2026, master data changes and a new price list. Test L2 uses the first one and is ready now.
- Test W8 picks only customer groups with a bonus rate above 0. With a rate of 0, moving the threshold changes nothing.
- Test W2 pastes its 1,000 volumes across the six plan months of one country. Before, they had to fit in one month, and at 10m no country has more than about 420 cells in a month.
- The model cells of 10m and 100m were counted in a full model run. Those of 1b and 10b are estimated from the 100m run.
- Every code in the actuals is in the master data, and every check of the model is empty or zero on the data.

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
