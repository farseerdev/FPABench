# Results

Draft. One folder per machine, one folder per dataset size in it, and one file per entry in that, as in ClickBench. An entry is only compared with others on the same machine. Each file is what [`runner/run.mjs`](../runner/run.mjs) wrote. Every run used the published dataset of its size and RAMA's recorded answers, which the runner downloads from R2 (see [`data/README.md`](../data/README.md#download)). Every answer of every entry is checked against those.

## The machine

At 10m and 100m each entry ran on its own Google Cloud `n2d-standard-4` in europe-west1-b: AMD EPYC 7B13, 4 vCPU, 16 GB, an SSD persistent disk to boot from and a 375 GB local NVMe SSD for the data, the system's files and its snapshot. Ubuntu 24.04, kernel 7.0.0-1014-gcp, Node 22.22.3. Every VM was new and was deleted after its run. Tests 0.5-draft, data generator 0.6-draft, seed 1, FPABench on `28f3481` with the changes of 2026-10-21 not yet committed. All runs were on 2026-10-21: RAMA without the second calculation in its load, and DuckDB and ClickHouse with reads by member id. At each size every entry wrote the same cells, from the dataset's `picks.json`.

| Entry | System | Durable | Runs as |
| --- | --- | --- | --- |
| `rama` ([10m](n2d-standard-4-local-nvme-ssd/10m/rama.json), [100m](n2d-standard-4-local-nvme-ssd/100m/rama.json)) | RAMA 1.9.0-c9c20e7.0, release build | yes | in process |
| `duckdb-tables` ([10m](n2d-standard-4-local-nvme-ssd/10m/duckdb-tables.json), [100m](n2d-standard-4-local-nvme-ssd/100m/duckdb-tables.json)) | DuckDB 1.5.6, `@duckdb/node-api` 1.5.6-r.1 | inputs yes, calculated tables in memory | in process |
| `clickhouse-tables` ([10m](n2d-standard-4-local-nvme-ssd/10m/clickhouse-tables.json), [100m](n2d-standard-4-local-nvme-ssd/100m/clickhouse-tables.json)) | ClickHouse 26.9.16.11, `@clickhouse/client` 1.23.1 | inputs yes, calculated tables in memory | one server on the same machine |

The SQL entries rebuild only the calculated tables a change reaches, and use integer member ids. The method may count that dependency logic as tuning. That is not decided yet. ClickHouse runs with the two settings it needs to keep missing values missing, and keeps the translator's join order. Settings are in each system's README.

Seconds. A write is the median of up to 20 writes after one warm-up, each to a fresh cell, with the 95th percentile after it. Fewer cells fit some pick rules: W4 has 19 writes at 10m, W5 17 at both sizes, and W8 7 at 10m and 11 at 100m. A load, bulk write or model change is the median of 3 runs. A read is the median of 5 runs after a restore. R8 is the median of 3 runs, each from a stopped system, and its time includes the start. In these runs R8 also cleared the OS cache first. The runner no longer does that.

## 10m

Manifest SHA-256 `ea6f5dc3…`. Run times: RAMA 1.5 min, DuckDB 5.0 min, ClickHouse 9.2 min. Every entry passed every test.

| Test | RAMA | DuckDB (tables) | ClickHouse (tables) |
| --- | ---: | ---: | ---: |
| L1 Initial load | 5.25 | 5.1 | 8.46 |
| L2 Monthly close | 1.36 | 3.16 | 4.81 |
| L3 Change a weight in master data | 0.694 | 0.36 | 0.53 |
| W1 Type one volume | 0.0872 (0.106) | 1.54 (1.56) | 2.47 (2.53) |
| W2 Paste 1,000 volumes at once | 0.945 | 1.56 | 2.83 |
| W3 Change a rebate rate | 0.0342 (0.0434) | 0.45 (0.473) | 0.681 (0.726) |
| W4 Raise a brand's price | 0.266 (0.367) | 1.2 (1.26) | 1.99 (2.15) |
| W5 Change a planning exchange rate | 0.0503 (0.0557) | 0.409 (0.622) | 0.79 (0.86) |
| W6a Change the cost of a warehouse | 0.011 (0.0132) | 0.341 (0.363) | 0.502 (0.546) |
| W6b Change the cost of an office | 0.00598 (0.00809) | 0.3 (0.333) | 0.49 (0.535) |
| W7 Set a yearly target | 0.11 (0.146) | 1.52 (1.57) | 2.56 (2.66) |
| W8 Flip a yearly bonus | 0.0407 (0.0578) | 0.427 (0.458) | 0.77 (0.913) |
| R1 Company P&L | 0.00416 | 0.00189 | 0.00479 |
| R2a P&L by brand | 0.00885 | 0.00211 | 0.00555 |
| R2b P&L by channel | 0.00171 | 0.00212 | 0.00482 |
| R2c P&L by country, in its own currency | 0.00207 | 0.00191 | 0.00512 |
| R3 Plan against last year | 0.00161 | 0.00468 | 0.0146 |
| R4 Ratios | 0.0371 | 0.0436 | 0.144 |
| R5 Drill to the detail | 0.00849 | 0.0278 | 0.0791 |
| R6 Margin by product attributes | 0.00617 | 0.00308 | 0.00996 |
| R7 Top customers | 0.000367 | 0.00182 | 0.00595 |
| R8 Open the model | 0.756 | 2.75 | 9.47 |
| M1 Change a formula | 1.21 | 0.28 | 0.412 |
| M2 Add a customer | 0.953 | 2.58 | 4.6 |
| M3 Move a customer to another group | 1.44 | 2.6 | 4.43 |
| M4 Allocate one more cost | 1.18 | 0.225 | 0.378 |
| C1 to C3, the checks without a timer | ok | ok | ok |

## 100m

Manifest SHA-256 `35ca0575…`. Run times: RAMA 10.7 min, DuckDB 27.9 min, ClickHouse 40.8 min. Every entry passed every test.

| Test | RAMA | DuckDB (tables) | ClickHouse (tables) |
| --- | ---: | ---: | ---: |
| L1 Initial load | 53.4 | 25.7 | 28.5 |
| L2 Monthly close | 11.3 | 15.9 | 20.6 |
| L3 Change a weight in master data | 5.47 | 1.96 | 2.08 |
| W1 Type one volume | 0.426 (0.673) | 10.1 (10.3) | 15.7 (16.4) |
| W2 Paste 1,000 volumes at once | 7.67 | 10.3 | 14.8 |
| W3 Change a rebate rate | 0.149 (0.434) | 2.67 (2.73) | 3.94 (4) |
| W4 Raise a brand's price | 2.78 (3.25) | 7.33 (7.45) | 10.7 (11.1) |
| W5 Change a planning exchange rate | 0.563 (0.794) | 2.27 (2.43) | 3.97 (4.96) |
| W6a Change the cost of a warehouse | 0.177 (0.195) | 1.29 (1.32) | 1.66 (1.72) |
| W6b Change the cost of an office | 0.00831 (0.0088) | 1.3 (1.32) | 1.66 (1.72) |
| W7 Set a yearly target | 0.74 (1.42) | 10.2 (10.3) | 15.5 (15.7) |
| W8 Flip a yearly bonus | 0.275 (0.369) | 2.18 (2.22) | 3.37 (3.57) |
| R1 Company P&L | 0.00707 | 0.00282 | 0.00561 |
| R2a P&L by brand | 0.0165 | 0.0038 | 0.00639 |
| R2b P&L by channel | 0.00311 | 0.00331 | 0.00646 |
| R2c P&L by country, in its own currency | 0.00333 | 0.00287 | 0.00637 |
| R3 Plan against last year | 0.00542 | 0.00755 | 0.0163 |
| R4 Ratios | 0.0805 | 0.0582 | 0.209 |
| R5 Drill to the detail | 0.0245 | 0.0436 | 0.102 |
| R6 Margin by product attributes | 0.109 | 0.0101 | 0.0201 |
| R7 Top customers | 0.00516 | 0.00506 | 0.00929 |
| R8 Open the model | 2.56 | 13.6 | 24.1 |
| M1 Change a formula | 9.89 | 1.52 | 1.8 |
| M2 Add a customer | 7.64 | 13.1 | 19.3 |
| M3 Move a customer to another group | 11.5 | 13.1 | 19.6 |
| M4 Allocate one more cost | 8.43 | 1 | 1.2 |
| C1 to C3, the checks without a timer | ok | ok | ok |

- RAMA is fastest on every write at both sizes. At 100m a one-cell write takes 0.008 to 2.8 s on RAMA, 1.3 to 10 s on DuckDB and 1.7 to 16 s on ClickHouse. RAMA recalculates only the cells a write reaches. The SQL entries rebuild whole tables. The paste of 1,000 volumes (W2) is closer: 7.7 s on RAMA, 10 s on DuckDB and 15 s on ClickHouse.
- DuckDB loads fastest. L1 at 100m takes 26 s on DuckDB, 29 s on ClickHouse and 53 s on RAMA. At 10m DuckDB and RAMA are close, at 5.1 and 5.3 s. RAMA is fastest on the monthly close (L2) at both sizes. The SQL entries are faster on L3, the master data change.
- RAMA is slower on model changes that touch formulas. At 100m M1 and M4 take 8 to 10 s on RAMA and 1.0 to 1.8 s on the SQL entries, which rebuild only the tables the change reaches. Member changes (M2, M3) rebuild every SQL table, because the dimension lookups change. There RAMA is faster at both sizes.
- Reads stay in milliseconds on all three, and RAMA and DuckDB split them. At 100m DuckDB is fastest on R1, R2a, R2c, R4, R6 and R7, and RAMA on R2b, R3 and R5. The largest gap is R6, margin by product attributes: 0.010 s on DuckDB and 0.11 s on RAMA.
- Opening the model (R8) takes 2.6 s on RAMA at 100m, 14 s on DuckDB and 24 s on ClickHouse. DuckDB and ClickHouse build their calculated tables in memory on every start.

## 1b

On an `n2d-highmem-8` (AMD EPYC 7B13, 8 vCPU, 64 GB) with a 375 GB local NVMe SSD, one new VM per entry, deleted after its run. No predefined N2D has 4 vCPUs and 64 GB, so 1b has twice the cores of 10m and 100m. Manifest SHA-256 `bb28482e…`. RAMA recorded the 1b answers, and DuckDB and ClickHouse ran against them. Run times: RAMA 116.5 min, DuckDB 142.2 min, ClickHouse 271.5 min. Peak memory, for the system and the runner: RAMA 37.3 GB, DuckDB 42.9 GB, ClickHouse 39.2 GB. Every entry passed every test. The files are in [`n2d-highmem-8-local-nvme-ssd/1b/`](n2d-highmem-8-local-nvme-ssd/1b/), and the website shows them when that machine is ticked.

| Test | RAMA | DuckDB (tables) | ClickHouse (tables) |
| --- | ---: | ---: | ---: |
| L1 Initial load | 559 | 163 | 138 |
| L2 Monthly close | 117 | 80.9 | 125 |
| L3 Change a weight in master data | 37.2 | 10.9 | 11.8 |
| W1 Type one volume | 6.13 (11.1) | 51 (51.8) | 110 (112) |
| W2 Paste 1,000 volumes at once | 53.4 | 50.3 | 107 |
| W3 Change a rebate rate | 1.5 (3.72) | 13.4 (13.6) | 25.1 (25.6) |
| W4 Raise a brand's price | 31.1 (35.8) | 35.7 (36.8) | 73.2 (79.2) |
| W5 Change a planning exchange rate | 7.85 (12.7) | 11.6 (12.1) | 35.2 (35.7) |
| W6a Change the cost of a warehouse | 2.04 (2.19) | 6.59 (6.69) | 17.3 (17.7) |
| W6b Change the cost of an office | 0.0106 (0.015) | 6.56 (6.64) | 17.3 (17.7) |
| W7 Set a yearly target | 11.2 (13.7) | 52.2 (53.1) | 114 (115) |
| W8 Flip a yearly bonus | 2.27 (3.61) | 11.2 (11.6) | 19 (19.3) |
| R1 Company P&L | 0.0117 | 0.00313 | 0.00552 |
| R2a P&L by brand | 0.0443 | 0.00355 | 0.00756 |
| R2b P&L by channel | 0.00524 | 0.00295 | 0.00656 |
| R2c P&L by country, in its own currency | 0.00734 | 0.00374 | 0.00644 |
| R3 Plan against last year | 0.00884 | 0.00743 | 0.0174 |
| R4 Ratios | 0.137 | 0.0613 | 0.218 |
| R5 Drill to the detail | 0.336 | 0.161 | 0.26 |
| R6 Margin by product attributes | 1.75 | 0.0441 | 0.0831 |
| R7 Top customers | 0.125 | 0.0257 | 0.0266 |
| R8 Open the model | 22.1 | 61.5 | 128 |
| M1 Change a formula | 89.8 | 8.12 | 11.1 |
| M2 Add a customer | 45.3 | 62.2 | 127 |
| M3 Move a customer to another group | 127 | 62.1 | 128 |
| M4 Allocate one more cost | 65.6 | 4.99 | 6.77 |
| C1 to C3, the checks without a timer | ok | ok | ok |

- RAMA is fastest on every one-cell write. W1 takes 6.1 s on RAMA, 51 s on DuckDB and 110 s on ClickHouse. The paste of 1,000 volumes (W2) is the one write where DuckDB is as fast, at 50 s against RAMA's 53 s.
- The SQL entries load 3.5 to 4 times faster than RAMA, and change formulas (M1, M4) 8 to 13 times faster.
- DuckDB is fastest on every read at 1b. The reads that list detail grow fastest on RAMA: R6 takes 1.75 s on RAMA, 0.044 s on DuckDB and 0.083 s on ClickHouse.
- RAMA opens the model fastest (R8): 22 s, against 62 s on DuckDB and 128 s on ClickHouse.

## Caveats

- RAMA's recorded answers are the expected results. They are not checked against the effects `tests.json` states. Two SQL entries built another way agree with RAMA on every answer at both sizes. See the method.
- Invariant I3 is not checked.
- The test edits of M4 are the runner's own reading of `tests.json`.
- RAMA cannot be installed outside Farseer yet. Its package is in Farseer's private registry.
- One run of each entry. ClickBench-style repeats on fresh machines are still to do.
- These results replace the run of 2026-10-19. Since then each system has its own test files, the picks come with the dataset and changed in some rules, reads have no cold run, and RAMA moved from 1.9.0-ffad51e.0 to 1.9.0-c9c20e7.0. The changelog has the details. The times are not comparable with that run.
- Durable means a write survives a crash of the system or the operating system. The local SSD does not survive a host failure or a stop of the VM. See the method.
