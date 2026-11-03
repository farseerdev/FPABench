# Results

Draft. One folder per machine, one folder per dataset size in it, and one file per entry and system version in that, `<entry>-<version>.json`, as in ClickBench. An entry is only compared with others on the same machine. Each version of a system is its own entry on the website, so RAMA 1.9 and RAMA 2.0 show side by side. Each file is what [`runner/run.mjs`](../runner/run.mjs) wrote. Every run used the published dataset of its size and RAMA's recorded answers, which the runner downloads from R2 (see [`data/README.md`](../data/README.md#download)). Every answer of every entry is checked against those.

## The machine

At 10m and 100m each entry ran on its own Google Cloud `n2d-standard-4` in europe-west1-b: AMD EPYC 7B13, 4 vCPU, 16 GB, an SSD persistent disk to boot from and a 375 GB local NVMe SSD for the data, the system's files and its snapshot. Ubuntu 24.04, kernel 7.0.0-1014-gcp, Node 22.22.3. Every VM was new and was deleted after its run. Tests 0.5-draft, data generator 0.6-draft, seed 1. At each size every entry wrote the same cells, from the dataset's `picks.json`.

| Entry | System | Run on | Durable | Runs as |
| --- | --- | --- | --- | --- |
| `rama` 2.0 | RAMA 2.0.0-7528851.0, release build | 2026-11-03, FPABench with #41 | yes | in process |
| `rama` 1.9 | RAMA 1.9.0-c9c20e7.0, release build | 2026-10-24, FPABench with #40 | yes | in process |
| `duckdb-tables` | DuckDB 1.5.6, `@duckdb/node-api` 1.5.6-r.1 | 2026-10-24, FPABench with #40 | inputs yes, calculated tables in memory | in process |
| `clickhouse-tables` | ClickHouse 26.9.16.11, `@clickhouse/client` 1.23.1 | 2026-10-24, FPABench with #40 | inputs yes, calculated tables in memory | one server on the same machine |

RAMA 2.0 reads grouped reads with one `GROUPED_READ` command (#41). RAMA 1.9 lists the combinations with `generateCombinations` and reads them with one `query` call. Everything else in the RAMA entry is the same for both versions.

The SQL entries rebuild only the calculated tables a change reaches, and use integer member ids. The method may count that dependency logic as tuning. That is not decided yet. ClickHouse runs with the two settings it needs to keep missing values missing, plus `join_algorithm = 'hash'`, and keeps the translator's join order. Settings are in each system's README.

Seconds. A write is the median of up to 20 writes after one warm-up, each to a fresh cell, with the 95th percentile after it. Fewer cells fit some pick rules: W4 has 19 writes at 10m, W5 17 at both sizes, and W8 7 at 10m and 11 at 100m. A load, bulk write or model change is the median of 3 runs. A read is the median of 5 runs after a restore. R8 is the median of 3 runs, each from a stopped system, and its time includes the start.

## 10m

Manifest SHA-256 `ea6f5dc3…`. Run times: RAMA 2.0 1.3 min, RAMA 1.9 1.5 min, DuckDB 4.3 min, ClickHouse 5.9 min. RAMA 2.0's peak memory was 0.55 GB. Every entry passed every test.

| Test | RAMA 2.0 | RAMA 1.9 | DuckDB (tables) | ClickHouse (tables) |
| --- | ---: | ---: | ---: | ---: |
| L1 Initial load | 3.78 | 4.87 | 4.4 | 6.29 |
| L2 Monthly close | 0.695 | 0.876 | 2.76 | 3.17 |
| L3 Change a weight in master data | 0.116 | 0.168 | 0.333 | 0.408 |
| W1 Type one volume | 0.0865 (0.106) | 0.0973 (0.121) | 1.27 (1.28) | 1.5 (1.56) |
| W2 Paste 1,000 volumes at once | 0.323 | 0.542 | 1.33 | 1.89 |
| W3 Change a rebate rate | 0.0313 (0.041) | 0.0339 (0.0443) | 0.409 (0.425) | 0.445 (0.464) |
| W4 Raise a brand's price | 0.229 (0.308) | 0.279 (0.387) | 1.01 (1.04) | 1.24 (1.4) |
| W5 Change a planning exchange rate | 0.0442 (0.0491) | 0.0509 (0.0576) | 0.341 (0.353) | 0.433 (0.508) |
| W6a Change the cost of a warehouse | 0.0121 (0.0146) | 0.0138 (0.0165) | 0.263 (0.279) | 0.37 (0.464) |
| W6b Change the cost of an office | 0.00669 (0.00828) | 0.00782 (0.01) | 0.264 (0.279) | 0.405 (0.425) |
| W7 Set a yearly target | 0.0927 (0.13) | 0.109 (0.144) | 1.39 (1.48) | 1.52 (1.61) |
| W8 Flip a yearly bonus | 0.0365 (0.0524) | 0.0467 (0.0587) | 0.394 (0.42) | 0.501 (0.639) |
| R1 Company P&L | 0.000617 | 0.00375 | 0.00228 | 0.0045 |
| R2a P&L by brand | 0.000483 | 0.00612 | 0.00259 | 0.00582 |
| R2b P&L by channel | 0.000496 | 0.00178 | 0.00244 | 0.0047 |
| R2c P&L by country, in its own currency | 0.000444 | 0.00211 | 0.0023 | 0.00453 |
| R3 Plan against last year | 0.000822 | 0.00145 | 0.00496 | 0.0128 |
| R4 Ratios | 0.0293 | 0.0415 | 0.0357 | 0.0414 |
| R5 Drill to the detail | 0.00267 | 0.00648 | 0.0272 | 0.0587 |
| R6 Margin by product attributes | 0.00044 | 0.00593 | 0.00361 | 0.00623 |
| R7 Top customers | 0.000126 | 0.000245 | 0.00222 | 0.00464 |
| R8 Open the model | 0.195 | 0.199 | 2.32 | 3.42 |
| M1 Change a formula | 0.385 | 0.858 | 0.272 | 0.327 |
| M2 Add a customer | 0.304 | 0.552 | 2.27 | 2.8 |
| M3 Move a customer to another group | 0.528 | 1.01 | 2.32 | 2.74 |
| M4 Allocate one more cost | 0.36 | 0.739 | 0.224 | 0.3 |
| C1 to C3, the checks without a timer | ok | ok | ok | ok |

## 100m

Manifest SHA-256 `35ca0575…`. Run times: RAMA 2.0 8.5 min, RAMA 1.9 10.9 min, DuckDB 21.0 min, ClickHouse 14.2 min. RAMA 2.0's peak memory was 3.4 GB of the 16 GB. Every entry passed every test.

| Test | RAMA 2.0 | RAMA 1.9 | DuckDB (tables) | ClickHouse (tables) |
| --- | ---: | ---: | ---: | ---: |
| L1 Initial load | 33.5 | 46.2 | 21 | 12.5 |
| L2 Monthly close | 6.21 | 8.07 | 12.1 | 7.17 |
| L3 Change a weight in master data | 1.3 | 2.05 | 1.81 | 0.917 |
| W1 Type one volume | 0.167 (0.414) | 0.4 (0.657) | 7.03 (8.99) | 4.44 (4.49) |
| W2 Paste 1,000 volumes at once | 2.39 | 4.41 | 7.27 | 4.83 |
| W3 Change a rebate rate | 0.107 (0.369) | 0.138 (0.424) | 2.17 (2.2) | 1.31 (1.34) |
| W4 Raise a brand's price | 2.04 (2.49) | 2.66 (3.13) | 5.3 (5.45) | 3.71 (3.81) |
| W5 Change a planning exchange rate | 0.415 (0.626) | 0.533 (0.759) | 1.84 (1.86) | 1.12 (1.2) |
| W6a Change the cost of a warehouse | 0.0588 (0.0721) | 0.174 (0.191) | 1.14 (1.16) | 0.783 (0.838) |
| W6b Change the cost of an office | 0.00595 (0.00803) | 0.00661 (0.0086) | 1.15 (1.17) | 0.788 (0.797) |
| W7 Set a yearly target | 0.343 (0.856) | 0.707 (1.37) | 7.03 (7.08) | 4.51 (4.63) |
| W8 Flip a yearly bonus | 0.215 (0.299) | 0.261 (0.355) | 2.04 (2.23) | 1.32 (1.5) |
| R1 Company P&L | 0.000974 | 0.00471 | 0.00324 | 0.00547 |
| R2a P&L by brand | 0.00113 | 0.00999 | 0.00378 | 0.00608 |
| R2b P&L by channel | 0.000801 | 0.00208 | 0.00311 | 0.00586 |
| R2c P&L by country, in its own currency | 0.000743 | 0.00334 | 0.00314 | 0.00499 |
| R3 Plan against last year | 0.00159 | 0.0046 | 0.00754 | 0.0166 |
| R4 Ratios | 0.0622 | 0.078 | 0.0533 | 0.0464 |
| R5 Drill to the detail | 0.00788 | 0.0099 | 0.0441 | 0.0783 |
| R6 Margin by product attributes | 0.00373 | 0.102 | 0.0114 | 0.0148 |
| R7 Top customers | 0.000919 | 0.00324 | 0.00547 | 0.00704 |
| R8 Open the model | 1.34 | 1.28 | 10.1 | 7.5 |
| M1 Change a formula | 3.07 | 8.03 | 1.46 | 0.814 |
| M2 Add a customer | 1.9 | 4.25 | 10.1 | 6.73 |
| M3 Move a customer to another group | 2.83 | 8.97 | 10.3 | 6.63 |
| M4 Allocate one more cost | 1.86 | 6.16 | 0.916 | 0.64 |
| C1 to C3, the checks without a timer | ok | ok | ok | ok |

- RAMA 2.0 is fastest on every write. A one-cell write takes 0.006 to 2.0 s on RAMA 2.0, 0.78 to 4.5 s on ClickHouse and 1.1 to 7.0 s on DuckDB. The paste of 1,000 volumes (W2) takes 2.4 s on RAMA 2.0, 4.8 s on ClickHouse and 7.3 s on DuckDB.
- ClickHouse loads fastest. L1 takes 12.5 s on ClickHouse, 21 s on DuckDB, 34 s on RAMA 2.0 and 46 s on RAMA 1.9. RAMA 2.0 is fastest on the monthly close (L2).
- The SQL entries are faster on model changes that touch formulas. M1 and M4 take 1.9 to 3.1 s on RAMA 2.0 and 0.64 to 1.5 s on the SQL entries, which rebuild only the tables the change reaches. Member changes (M2, M3) rebuild every SQL table, because the dimension lookups change. There RAMA 2.0 is 2.3 to 5.3 times faster than the SQL entries.
- RAMA 2.0 is fastest on every read but R4, the ratios, where ClickHouse takes 0.046 s and RAMA 2.0 0.062 s.
- Opening the model (R8) takes 1.3 s on RAMA, 7.5 s on ClickHouse and 10 s on DuckDB. DuckDB and ClickHouse build their calculated tables in memory on every start.
- RAMA 2.0 against RAMA 1.9: loads take 23 to 37% less time, writes up to 66% less, and model changes 55 to 70% less. Most reads are 2.6 to 27 times as fast, from `GROUPED_READ`. R8 is the same.

## 1b

On an `n2d-highmem-8` (AMD EPYC 7B13, 8 vCPU, 64 GB) with a 375 GB local NVMe SSD, one new VM per entry, deleted after its run. No predefined N2D has 4 vCPUs and 64 GB, so 1b has twice the cores of 10m and 100m. Manifest SHA-256 `bb28482e…`. RAMA 1.9 recorded the 1b answers, and the other entries ran against them. Run times: RAMA 2.0 88.0 min, RAMA 1.9 123.6 min, DuckDB 104.7 min, ClickHouse 58.5 min. Peak memory, for the system and the runner: RAMA 2.0 30.0 GB, RAMA 1.9 37.3 GB, DuckDB 35.9 GB, ClickHouse 17.6 GB. Every entry passed every test. The files are in [`n2d-highmem-8-local-nvme-ssd/1b/`](n2d-highmem-8-local-nvme-ssd/1b/), and the website shows them when that machine is ticked.

| Test | RAMA 2.0 | RAMA 1.9 | DuckDB (tables) | ClickHouse (tables) |
| --- | ---: | ---: | ---: | ---: |
| L1 Initial load | 403 | 566 | 137 | 41.1 |
| L2 Monthly close | 77.6 | 109 | 59.6 | 27.1 |
| L3 Change a weight in master data | 28.4 | 38.7 | 9.77 | 4.16 |
| W1 Type one volume | 2.19 (3) | 6.48 (11.5) | 34.3 (34.7) | 19.4 (19.6) |
| W2 Paste 1,000 volumes at once | 25.5 | 53 | 34.7 | 19.4 |
| W3 Change a rebate rate | 1.01 (2.29) | 1.52 (3.91) | 11.4 (11.7) | 7.05 (7.15) |
| W4 Raise a brand's price | 18.4 (22.6) | 31.4 (36.1) | 26.3 (26.8) | 16.3 (16.4) |
| W5 Change a planning exchange rate | 4.77 (9.05) | 7.74 (13.3) | 8.83 (8.99) | 5.52 (5.67) |
| W6a Change the cost of a warehouse | 0.645 (0.754) | 2.01 (2.19) | 5.87 (6.02) | 3.44 (3.48) |
| W6b Change the cost of an office | 0.00875 (0.0133) | 0.00912 (0.0141) | 5.9 (6.14) | 3.43 (3.48) |
| W7 Set a yearly target | 3.48 (4.93) | 11.4 (13.8) | 34.5 (35.1) | 19.6 (19.8) |
| W8 Flip a yearly bonus | 1.5 (2.83) | 2.39 (3.79) | 10.4 (10.7) | 6.74 (6.91) |
| R1 Company P&L | 0.00225 | 0.00665 | 0.00305 | 0.00523 |
| R2a P&L by brand | 0.00358 | 0.0214 | 0.0039 | 0.00664 |
| R2b P&L by channel | 0.00313 | 0.00412 | 0.00343 | 0.00528 |
| R2c P&L by country, in its own currency | 0.00131 | 0.0045 | 0.00364 | 0.00539 |
| R3 Plan against last year | 0.00803 | 0.00956 | 0.00805 | 0.0159 |
| R4 Ratios | 0.135 | 0.131 | 0.0548 | 0.0499 |
| R5 Drill to the detail | 0.0374 | 0.099 | 0.135 | 0.181 |
| R6 Margin by product attributes | 0.0428 | 1.67 | 0.0438 | 0.0542 |
| R7 Top customers | 0.00707 | 0.025 | 0.0283 | 0.0199 |
| R8 Open the model | 16.8 | 15.1 | 43.1 | 26.9 |
| M1 Change a formula | 39.5 | 89.3 | 7.52 | 3.8 |
| M2 Add a customer | 21 | 45.3 | 44.9 | 25.8 |
| M3 Move a customer to another group | 27.4 | 127 | 44.3 | 29.3 |
| M4 Allocate one more cost | 18.9 | 65.7 | 4.34 | 2.43 |
| C1 to C3, the checks without a timer | ok | ok | ok | ok |

- RAMA 2.0 is fastest on most one-cell writes. W1 takes 2.2 s on RAMA 2.0, 19 s on ClickHouse and 34 s on DuckDB. ClickHouse is faster on W4, at 16.3 s against 18.4 s, and on the paste of 1,000 volumes (W2), at 19.4 s against 25.5 s.
- ClickHouse loads 3 to 10 times faster than RAMA 2.0, and changes formulas (M1, M4) 8 to 10 times faster. RAMA 2.0 is faster on the member changes M2 and M3.
- RAMA 2.0 is fastest on every read but R4, where the SQL entries take 0.05 s and RAMA 0.135 s. R6, margin by product attributes, took 1.67 s on RAMA 1.9 and takes 0.043 s on RAMA 2.0.
- RAMA opens the model fastest (R8): 17 s, against 27 s on ClickHouse and 43 s on DuckDB.
- RAMA 2.0 against RAMA 1.9: loads take 27 to 29% less time, one-cell writes up to 70% less, and model changes 54 to 78% less. Most reads are 1.2 to 39 times as fast. R4 is the same, and R8 is 11% slower.

## Caveats

- RAMA's recorded answers are the expected results. They are not checked against the effects `tests.json` states. Two SQL entries built another way agree with RAMA on every answer at every size. See the method.
- Invariant I3 is not checked.
- The test edits of M4 are the runner's own reading of `tests.json`.
- RAMA cannot be installed outside Farseer yet. Its package is in Farseer's private registry.
- One run of each entry. ClickBench-style repeats on fresh machines are still to do. Two runs of RAMA 2.0 at 100m on two new VMs differed by about 5%.
- The RAMA 2.0 runs are ten days after the others, on new VMs of the same type.
- Durable means a write survives a crash of the system or the operating system. The local SSD does not survive a host failure or a stop of the VM. See the method.
