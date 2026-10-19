# Results

Draft. One folder per dataset size, and one file per entry in it. Each file is what [`runner/run.mjs`](../runner/run.mjs) wrote, after [`runner/compare.mjs`](../runner/compare.mjs) compared the answers of all entries.

## 10m, 2026-10-15

One Google Cloud `n2d-standard-4` in europe-west1-b: AMD EPYC 7B13, 4 vCPU, 16 GB, a 200 GB SSD persistent disk, Ubuntu 26.04.1, kernel 7.0.0-1014-gcp, Node 22.22.3. Tests 0.5-draft, model files with SHA-256 `cee0497a6600c68d…`, data generator 0.6-draft (manifest SHA-256 `7e4a79c2…`), seed 1. All entries ran on the same machine, one after the other, with the same picks, from 18:40 to 18:59 UTC.

| Entry | System | Durable | Runs as |
| --- | --- | --- | --- |
| [`rama`](10m/rama.json) | RAMA 1.9.0-ffad51e.0 | yes | in process |
| [`duckdb-tables`](10m/duckdb-tables.json) | DuckDB 1.5.6, `@duckdb/node-api` 1.5.6-r.1 | inputs yes, calculated tables in memory | in process |
| [`clickhouse-tables`](10m/clickhouse-tables.json) | ClickHouse 26.9.16.11, `@clickhouse/client` 1.23.1 | inputs yes, calculated tables in memory | one server on the same machine |

The SQL entries rebuild only the calculated tables a change reaches, and use integer member ids. The method may count that dependency logic as tuning. That is not decided yet. When one chain of joins lists the cells of a table, the chain also carries the value of each operand. Then that table joins each operand once. ClickHouse runs with the two settings it needs to keep missing values missing. Settings are in each system's README.

Seconds. A write is the median of 20 writes, each to a fresh cell, with the 95th percentile after it. W4 has 19 writes, W5 17 and W8 7, because only 20 brands, 18 exchange rates and 8 groups fit their pick rules. A load, bulk write or model change is the median of 3 runs. A read is the median of 5 warm runs, and the cold run after a restart and an OS cache drop. R8 is cold every run.

| Test | RAMA | DuckDB (tables) | ClickHouse (tables) |
| --- | ---: | ---: | ---: |
| L1 Initial load | 10.9 | 6.78 | 9.74 |
| L2 Monthly close | 1.68 | 3.03 | 4.57 |
| L3 Change a weight in master data | 0.886 | 0.342 | 0.544 |
| W1 Type one volume | 0.251 (0.279) | 1.42 (1.46) | 2.37 (2.44) |
| W2 Paste 1,000 volumes at once | 1.39 | 1.43 | 2.44 |
| W3 Change a rebate rate | 0.0446 (0.0601) | 0.425 (0.44) | 0.696 (0.726) |
| W4 Raise a brand's price | 0.428 (0.551) | 1.15 (1.17) | 1.94 (2.00) |
| W5 Change a planning exchange rate | 0.0829 (0.088) | 0.379 (0.396) | 0.673 (0.747) |
| W6a Change the cost of a warehouse | 0.0254 (0.0284) | 0.289 (0.296) | 0.499 (0.536) |
| W6b Change the cost of an office | 0.0186 (0.0197) | 0.286 (0.299) | 0.498 (0.525) |
| W7 Set a yearly target | 0.267 (0.33) | 1.45 (1.49) | 2.43 (2.49) |
| W8 Flip a yearly bonus | 0.055 (0.074) | 0.422 (0.429) | 0.794 (0.868) |
| R1 Company P&L | 0.0041, cold 1.20 | 0.0022, cold 2.71 | 0.0065, cold 7.49 |
| R2a P&L by brand | 0.0061, cold 1.19 | 0.0022, cold 2.67 | 0.0057, cold 7.50 |
| R2b P&L by channel | 0.0017, cold 1.21 | 0.0019, cold 2.67 | 0.006, cold 7.53 |
| R2c P&L by country | 0.002, cold 1.18 | 0.0021, cold 2.75 | 0.0059, cold 7.45 |
| R3 Plan against last year | 0.0022, cold 1.23 | 0.0048, cold 2.71 | 0.0095, cold 7.56 |
| R4 Ratios | 0.0256, cold 1.23 | 0.0616, cold 2.76 | 0.188, cold 7.87 |
| R5 Drill to the detail | 0.0121, cold 1.21 | 0.0292, cold 2.71 | 0.065, cold 7.59 |
| R6 Margin by product attributes | 0.0063, cold 1.22 | 0.0039, cold 2.74 | 0.009, cold 7.67 |
| R7 Top customers | 0.00034, cold 1.50 | 0.0018, cold 2.79 | 0.006, cold 7.71 |
| R8 Open the model | 1.17 | 2.71 | 7.54 |
| M1 Change a formula | 3.92 | 0.324 | 0.476 |
| M2 Add a customer | 1.53 | 2.56 | 4.21 |
| M3 Move a customer to another group | 1.98 | 2.57 | 4.20 |
| M4 Allocate one more cost | 3.92 | 0.276 | 0.424 |

Every test passed its checks on every entry, and every answer matched across all three. C1, C2 and C3 passed on all. W9 waits on the model.

What the numbers show:

- RAMA is fastest on every write. A one-cell write takes 0.02 to 0.43 s on RAMA, 0.29 to 1.5 s on DuckDB and 0.50 to 2.4 s on ClickHouse. On W2, the paste of 1,000 volumes, RAMA is only 3% faster than DuckDB: 1.39 against 1.43 s. RAMA recalculates only the cells a write reaches. The SQL entries rebuild whole tables, 24 to 90 of the 167, depending on the input.
- RAMA is slower on model changes that touch formulas. On M1 and M4, changing a formula and adding a cost allocation, RAMA takes 3.9 s, DuckDB 0.28 to 0.32 s and ClickHouse 0.42 to 0.48 s. RAMA imports the changed variables and recalculates everything, while the SQL entries rebuild only the tables the change reaches. Both SQL entries are also faster on L3, the master data change (0.34 and 0.54 s against 0.89 s). They also load faster (L1: 6.8 and 9.7 s against 10.9 s).
- Member changes (M2, M3) rebuild every SQL table, because the dimension lookups change. There RAMA is faster: 1.5 to 2.0 s against 2.6 s for DuckDB and 4.2 s for ClickHouse.
- Warm reads take less than 10 ms on all three, except R4 and R5. Those take 12 to 26 ms on RAMA, 29 to 62 ms on DuckDB and 65 to 188 ms on ClickHouse. DuckDB is faster than RAMA on R1, R2a and R6. RAMA is faster on R2b, R2c, R3, R4, R5 and R7, but on R2c by less than 1%.
- Cold reads and R8 include starting the system. RAMA opens its database in about 1.2 s. DuckDB and ClickHouse keep their calculated tables in memory, so a start rebuilds them: about 2.7 s for DuckDB and 7.5 s for ClickHouse, which also starts its server.

## Caveats

- There is no reference program yet for the expected values. Two systems built in different ways that agree stand in for one. See the runner's README.
- Invariant I3 is not checked.
- The test edits of M4 are the runner's own reading of `tests.json`.
- RAMA cannot be installed outside Farseer yet. Its package is in Farseer's private registry.
- One run of each entry. ClickBench-style repeats on fresh machines are still to do.
- The run of 2026-10-12 used another `n2d-standard-4`, a 50 GB disk and Ubuntu 24.04. Compare entries within one run, not across runs.
- These results replace the run of 2026-10-12. Since then, 45 of the 167 calculated tables of the SQL entries get new SQL, which joins each operand once. A measure read by dimensions puts its sums side by side with one `GROUP BY`. The changelog has the effect of each.
