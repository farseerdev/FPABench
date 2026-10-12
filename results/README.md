# Results

Draft. One folder per dataset size, and one file per entry in it. Each file is what [`runner/run.mjs`](../runner/run.mjs) wrote, after [`runner/compare.mjs`](../runner/compare.mjs) compared the answers of all entries.

## 10m, 2026-10-12

One Google Cloud `n2d-standard-4` in europe-west1-b: AMD EPYC 7B13, 4 vCPU, 16 GB, a 50 GB SSD persistent disk, Ubuntu 24.04, kernel 7.0.0-1014-gcp, Node 22.22.3. Tests 0.5-draft, model files with SHA-256 `cee0497a6600c68d…`, data generator 0.6-draft (manifest SHA-256 `7e4a79c2…`), seed 1. All entries ran on the same machine, one after the other, with the same picks, from 20:53 to 21:16 UTC.

| Entry | System | Durable | Runs as |
| --- | --- | --- | --- |
| [`rama`](10m/rama.json) | RAMA 1.9.0-ffad51e.0 | yes | in process |
| [`duckdb-tables`](10m/duckdb-tables.json) | DuckDB 1.5.6, `@duckdb/node-api` 1.5.6-r.1 | inputs yes, calculated tables in memory | in process |
| [`clickhouse-tables`](10m/clickhouse-tables.json) | ClickHouse 26.9.16.11, `@clickhouse/client` 1.23.1 | inputs yes, calculated tables in memory | one server on the same machine |

The SQL entries rebuild only the calculated tables a change reaches, and use integer member ids. The method may count that dependency logic as tuning. That is not decided yet. ClickHouse runs with the two settings it needs to keep missing values missing. Settings are in each system's README.

Seconds. A write is the median of 20 writes, each to a fresh cell, with the 95th percentile after it. W4 has 19 writes and W8 7, because only 20 brands and 8 groups fit their pick rules. A load, bulk write or model change is the median of 3 runs. A read is the median of 5 warm runs, and the cold run after a restart and an OS cache drop. R8 is cold every run.

| Test | RAMA | DuckDB (tables) | ClickHouse (tables) |
| --- | ---: | ---: | ---: |
| L1 Initial load | 10.6 | 7.22 | 11.1 |
| L2 Monthly close | 1.72 | 3.47 | 5.84 |
| L3 Change a weight in master data | 0.883 | 0.508 | 0.79 |
| W1 Type one volume | 0.241 (0.259) | 1.78 (1.80) | 3.10 (3.30) |
| W2 Paste 1,000 volumes at once | 1.35 | 1.85 | 3.15 |
| W3 Change a rebate rate | 0.0454 (0.0603) | 0.529 (0.536) | 0.858 (0.891) |
| W4 Raise a brand's price | 0.418 (0.508) | 1.41 (1.48) | 2.41 (2.49) |
| W5 Change a planning exchange rate | 0.0822 (0.0872) | 0.472 (0.481) | 0.832 (0.925) |
| W6a Change the cost of a warehouse | 0.0259 (0.0272) | 0.377 (0.381) | 0.673 (0.736) |
| W6b Change the cost of an office | 0.0175 (0.0186) | 0.369 (0.378) | 0.659 (0.72) |
| W7 Set a yearly target | 0.28 (0.326) | 1.89 (1.93) | 3.35 (3.47) |
| W8 Flip a yearly bonus | 0.0616 (0.0737) | 0.552 (0.573) | 1.06 (1.15) |
| R1 Company P&L | 0.0041, cold 1.22 | 0.0022, cold 3.27 | 0.0045, cold 8.54 |
| R2a P&L by brand | 0.0065, cold 1.09 | 0.0022, cold 3.26 | 0.0047, cold 8.65 |
| R2b P&L by channel | 0.0018, cold 1.22 | 0.002, cold 3.20 | 0.0061, cold 9.18 |
| R2c P&L by country | 0.0028, cold 1.21 | 0.0027, cold 3.35 | 0.0053, cold 8.76 |
| R3 Plan against last year | 0.0016, cold 1.21 | 0.0046, cold 3.34 | 0.0092, cold 8.52 |
| R4 Ratios | 0.0258, cold 1.10 | 0.113, cold 3.51 | 0.256, cold 9.42 |
| R5 Drill to the detail | 0.0124, cold 1.31 | 0.0295, cold 3.37 | 0.072, cold 9.01 |
| R6 Margin by product attributes | 0.0062, cold 1.11 | 0.0039, cold 3.41 | 0.0071, cold 8.57 |
| R7 Top customers | 0.00036, cold 1.55 | 0.0018, cold 3.37 | 0.0053, cold 8.90 |
| R8 Open the model | 1.17 | 3.36 | 8.83 |
| M1 Change a formula | 3.85 | 0.398 | 0.599 |
| M2 Add a customer | 1.49 | 3.18 | 5.38 |
| M3 Move a customer to another group | 1.95 | 3.15 | 5.16 |
| M4 Allocate one more cost | 3.93 | 0.331 | 0.616 |

Every test passed its checks on every entry, and every answer matched across all three. C1, C2 and C3 passed on all. W9 waits on the model.

What the numbers show:

- RAMA is fastest on every write: 0.02 to 0.42 s, against 0.37 to 1.9 s for DuckDB and 0.66 to 3.4 s for ClickHouse. It recalculates only the cells a write reaches. The SQL entries rebuild whole tables, 20 to 90 of the 167, depending on the input.
- RAMA is slower on model changes that touch formulas. On M1 and M4, changing a formula and adding a cost allocation, RAMA takes 3.9 s, DuckDB 0.33 to 0.40 s and ClickHouse 0.60 to 0.62 s. RAMA imports the changed variables and recalculates everything, while the SQL entries rebuild only the tables the change reaches. Both SQL entries are also faster on L3, the master data change (0.51 and 0.79 s against 0.88 s), and DuckDB loads faster (L1: 7.2 s against 10.6 s).
- Member changes (M2, M3) rebuild every SQL table, because the dimension lookups change. There RAMA is faster: 1.5 to 2.0 s against 3.2 s for DuckDB and 5.2 to 5.4 s for ClickHouse.
- Warm reads are a few milliseconds on all three. DuckDB is faster than RAMA on R1, R2a, R2c and R6, RAMA on R2b, R3, R4, R5 and R7.
- Cold reads and R8 include starting the system. RAMA opens its database in about 1.2 s. DuckDB and ClickHouse keep their calculated tables in memory, so a start rebuilds them: about 3.3 s for DuckDB and 8.8 s for ClickHouse, which also starts its server.

## Caveats

- There is no reference program yet for the expected values. Two systems built in different ways that agree stand in for one. See the runner's README.
- Invariant I3 is not checked.
- The test edits of M4 are the runner's own reading of `tests.json`.
- RAMA cannot be installed outside Farseer yet. Its package is in Farseer's private registry.
- One run of each entry. ClickBench-style repeats on fresh machines are still to do.
- These results replace two earlier runs the same day. Both had runner bugs found in review: some write cells were taken twice and L2, L3 stopped before `sync`. Since then the SQL entries also changed a lot: calculated tables in memory, rebuilds of only the reached tables, integer keys and `UNION ALL` sums. RAMA's reads now list only cells that have a value.
