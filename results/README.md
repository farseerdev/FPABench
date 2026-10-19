# Results

Draft. One folder per dataset size, and one file per entry in it. Each file is what [`runner/run.mjs`](../runner/run.mjs) wrote, after [`runner/compare.mjs`](../runner/compare.mjs) compared the answers of all entries.

## The machine

Each entry ran on its own Google Cloud `n2d-standard-4` in europe-west1-b: AMD EPYC 7B13, 4 vCPU, 16 GB, an SSD persistent disk to boot from and a 375 GB local NVMe SSD for the data, the system's files and its snapshot. Ubuntu 24.04.5, kernel 7.0.0-1014-gcp, Node 22.22.3. Every VM was new and was deleted after its run. Tests 0.5-draft, model files with SHA-256 `cee0497a6600c68d…`, data generator 0.6-draft, seed 1, FPABench `c85ca46`. All runs were on 2026-10-19. At each size every entry wrote the same cells, from one picks file.

| Entry | System | Durable | Runs as |
| --- | --- | --- | --- |
| `rama` ([10m](10m/rama.json), [100m](100m/rama.json)) | RAMA 1.9.0-ffad51e.0 | yes | in process |
| `duckdb-tables` ([10m](10m/duckdb-tables.json), [100m](100m/duckdb-tables.json)) | DuckDB 1.5.6, `@duckdb/node-api` 1.5.6-r.1 | inputs yes, calculated tables in memory | in process |
| `clickhouse-tables` ([10m](10m/clickhouse-tables.json), [100m](100m/clickhouse-tables.json)) | ClickHouse 26.9.16.11, `@clickhouse/client` 1.23.1 | inputs yes, calculated tables in memory | one server on the same machine |

The SQL entries rebuild only the calculated tables a change reaches, and use integer member ids. The method may count that dependency logic as tuning. That is not decided yet. ClickHouse runs with the two settings it needs to keep missing values missing, and keeps the translator's join order. Settings are in each system's README.

Seconds. A write is the median of up to 20 writes, each to a fresh cell, with the 95th percentile after it. Fewer cells fit some pick rules: at 10m W4 has 19 writes, W5 17 and W8 7, and at 100m W5 has 17 and W8 11. A load, bulk write or model change is the median of 3 runs. A read is the median of 5 warm runs, and the cold run after a restart and an OS cache drop. R8 is cold every run.

## 10m

Manifest SHA-256 `7e4a79c2…`. Run times: RAMA 1.9 min, DuckDB 5.7 min, ClickHouse 10.4 min. Every ready test passed its checks on every entry, and every answer matched across all three in all 26 compared tests. W9 is not ready.

| Test | RAMA | DuckDB (tables) | ClickHouse (tables) |
| --- | ---: | ---: | ---: |
| L1 Initial load | 8.77 | 6.76 | 9.39 |
| L2 Monthly close | 1.29 | 3.07 | 4.6 |
| L3 Change a weight in master data | 0.609 | 0.331 | 0.506 |
| W1 Type one volume | 0.229 (0.25) | 1.42 (1.44) | 2.31 (2.36) |
| W2 Paste 1,000 volumes at once | 1.01 | 1.45 | 2.43 |
| W3 Change a rebate rate | 0.042 (0.0589) | 0.431 (0.44) | 0.641 (0.682) |
| W4 Raise a brand's price | 0.413 (0.504) | 1.15 (1.18) | 2.02 (2.43) |
| W5 Change a planning exchange rate | 0.0738 (0.084) | 0.384 (0.394) | 0.719 (0.781) |
| W6a Change the cost of a warehouse | 0.0236 (0.026) | 0.287 (0.294) | 0.511 (0.563) |
| W6b Change the cost of an office | 0.015 (0.0165) | 0.285 (0.295) | 0.523 (0.562) |
| W7 Set a yearly target | 0.254 (0.319) | 1.44 (1.48) | 2.66 (2.74) |
| W8 Flip a yearly bonus | 0.056 (0.0681) | 0.424 (0.442) | 0.801 (0.936) |
| R1 Company P&L | 0.00402, cold 0.773 | 0.00197, cold 2.66 | 0.00644, cold 7.55 |
| R2a P&L by brand | 0.00612, cold 0.785 | 0.00241, cold 3.21 | 0.00706, cold 7.1 |
| R2b P&L by channel | 0.00166, cold 0.773 | 0.00192, cold 3.25 | 0.00586, cold 7.59 |
| R2c P&L by country, in its own currency | 0.00208, cold 0.751 | 0.00196, cold 2.65 | 0.00694, cold 7.76 |
| R3 Plan against last year | 0.00154, cold 0.761 | 0.00446, cold 2.66 | 0.00838, cold 7.62 |
| R4 Ratios | 0.0252, cold 0.796 | 0.0736, cold 3.29 | 0.208, cold 7.72 |
| R5 Drill to the detail | 0.0122, cold 0.881 | 0.0498, cold 2.68 | 0.0895, cold 7.61 |
| R6 Margin by product attributes | 0.00614, cold 0.773 | 0.00472, cold 3.24 | 0.00992, cold 7.49 |
| R7 Top customers | 0.00036, cold 0.722 | 0.00183, cold 2.66 | 0.00602, cold 8.38 |
| R8 Open the model | 0.745 | 2.69 | 6.92 |
| M1 Change a formula | 1.29 | 0.327 | 0.435 |
| M2 Add a customer | 1.11 | 2.54 | 4.53 |
| M3 Move a customer to another group | 1.56 | 2.56 | 4.48 |
| M4 Allocate one more cost | 1.17 | 0.263 | 0.429 |

## 100m

Manifest SHA-256 `3ede1d21…`. Run times: RAMA 14.0 min, DuckDB 31.5 min, ClickHouse 42.9 min. Every ready test passed its checks on every entry, and every answer matched across all three in all 26 compared tests. W9 is not ready.

| Test | RAMA | DuckDB (tables) | ClickHouse (tables) |
| --- | ---: | ---: | ---: |
| L1 Initial load | 95.1 | 46.5 | 37.9 |
| L2 Monthly close | 10.6 | 16 | 18.9 |
| L3 Change a weight in master data | 4.79 | 1.9 | 1.91 |
| W1 Type one volume | 1.45 (1.74) | 9.74 (9.88) | 13.8 (14.1) |
| W2 Paste 1,000 volumes at once | 8.21 | 9.67 | 13.8 |
| W3 Change a rebate rate | 0.3 (0.471) | 2.56 (2.62) | 3.67 (3.71) |
| W4 Raise a brand's price | 3.58 (4.21) | 7.13 (7.26) | 9.96 (10) |
| W5 Change a planning exchange rate | 0.837 (1.11) | 2.25 (2.34) | 3.63 (3.7) |
| W6a Change the cost of a warehouse | 0.294 (0.319) | 1.28 (1.32) | 1.56 (1.62) |
| W6b Change the cost of an office | 0.207 (0.21) | 1.28 (1.32) | 1.57 (1.61) |
| W7 Set a yearly target | 1.61 (2.18) | 9.95 (10.1) | 14.3 (14.5) |
| W8 Flip a yearly bonus | 0.43 (0.517) | 2.19 (2.25) | 3.17 (3.33) |
| R1 Company P&L | 0.00579, cold 2.47 | 0.00282, cold 13.5 | 0.0056, cold 23.2 |
| R2a P&L by brand | 0.0137, cold 2.64 | 0.00326, cold 13.6 | 0.00765, cold 23.1 |
| R2b P&L by channel | 0.0031, cold 2.48 | 0.00279, cold 13.7 | 0.007, cold 23 |
| R2c P&L by country, in its own currency | 0.00315, cold 2.47 | 0.00305, cold 13.6 | 0.00628, cold 23.5 |
| R3 Plan against last year | 0.00333, cold 2.47 | 0.00728, cold 13.6 | 0.0104, cold 23.4 |
| R4 Ratios | 0.0607, cold 2.54 | 0.0912, cold 13.7 | 0.267, cold 23.5 |
| R5 Drill to the detail | 0.0701, cold 3.59 | 0.0566, cold 13.8 | 0.105, cold 23.2 |
| R6 Margin by product attributes | 0.132, cold 2.78 | 0.0172, cold 13.6 | 0.0218, cold 23 |
| R7 Top customers | 0.0051, cold 2.46 | 0.00503, cold 13.8 | 0.00982, cold 23.9 |
| R8 Open the model | 2.4 | 13.7 | 23 |
| M1 Change a formula | 9.64 | 1.64 | 1.86 |
| M2 Add a customer | 8.25 | 13.3 | 18.3 |
| M3 Move a customer to another group | 10.1 | 13.6 | 18.2 |
| M4 Allocate one more cost | 8.05 | 1.12 | 1.24 |

What the numbers show, at both sizes:

- RAMA is fastest on every write. At 100m a one-cell write takes 0.21 to 3.6 s on RAMA, 1.3 to 10 s on DuckDB and 1.6 to 14 s on ClickHouse. RAMA recalculates only the cells a write reaches. The SQL entries rebuild whole tables.
- RAMA is slower on model changes that touch formulas. At 100m M1 and M4 take 8 to 10 s on RAMA and 1.1 to 1.9 s on the SQL entries, which rebuild only the tables the change reaches. Both SQL entries are faster on L3, the master data change, and on the initial load at 100m (L1: 46.5 and 37.9 s against 95.1 s). At 10m ClickHouse loads slower than RAMA. RAMA is faster on L2, the monthly close, at both sizes.
- Member changes (M2, M3) rebuild every SQL table, because the dimension lookups change. There RAMA is faster at both sizes.
- Warm reads stay in milliseconds on all three. At 100m R4, R5 and R6 take 17 to 270 ms, and every other read under 15 ms.
- Cold reads and R8 include starting the system. RAMA opens its database. DuckDB and ClickHouse rebuild their calculated tables in memory, and ClickHouse also starts its server. At 100m R8 takes 2.4 s on RAMA, 13.7 s on DuckDB and 23 s on ClickHouse.

## 1b, RAMA only, on a larger machine

This run is outside the method, and its times do not rank against the tables above. On the method's `n2d-standard-4` the run was killed about 9 minutes into the first load, most likely for lack of memory. The kernel log was not kept, so that is not confirmed. So it ran on an `n2d-highmem-16`, with 16 vCPU and 128 GB, of which Linux sees 126 GB, four times the cores and eight times the memory, with the same local SSD. Peak resident memory was 41.4 GB, for RAMA and the runner in one process. At 1b the method runs loads and reads only. Every one of them passed its checks. Manifest SHA-256 `af44b682…`, run time 69.3 min. There is no other entry at 1b, so no answer was compared.

The file is in [`off-method/1b/rama.json`](off-method/1b/rama.json), outside the size folders, because the website shows results from one machine only.

| Test | RAMA, 1b, `n2d-highmem-16` |
| --- | ---: |
| L1 Initial load | 1,022 |
| L2 Monthly close | 104 |
| L3 Change a weight in master data | 38.7 |
| R1 Company P&L | 0.0103, cold 20.7 |
| R2a P&L by brand | 0.0387, cold 20.7 |
| R2b P&L by channel | 0.00512, cold 20.7 |
| R2c P&L by country, in its own currency | 0.00558, cold 20.8 |
| R3 Plan against last year | 0.00764, cold 20.6 |
| R4 Ratios | 0.0843, cold 20.8 |
| R5 Drill to the detail | 0.32, cold 30.5 |
| R6 Margin by product attributes | 2.39, cold 25.2 |
| R7 Top customers | 0.116, cold 21.8 |
| R8 Open the model | 20.7 |

## Caveats

- There is no reference program yet for the expected values. Two systems built in different ways that agree stand in for one. See the runner's README.
- W9 waits on the model. Every file marks it `unsupported`.
- Invariant I3 is not checked.
- The test edits of M4 are the runner's own reading of `tests.json`.
- RAMA cannot be installed outside Farseer yet. Its package is in Farseer's private registry.
- One run of each entry. ClickBench-style repeats on fresh machines are still to do.
- These results replace the run of 2026-10-15, which used a 200 GB SSD persistent disk. Since then the run machine has a local NVMe SSD, RAMA commits a model change without a full recalc and streams its input cells through the native cell import, and ClickHouse keeps the translator's join order. The changelog has the effect of each. Compare entries within one set of runs. Each entry ran on its own new machine of the same type.
- Durable means a write survives a crash of the system or the operating system. The local SSD does not survive a host failure or a stop of the VM. See the method.
