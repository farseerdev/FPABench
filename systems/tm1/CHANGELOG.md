# Changelog

## Current issue

**L1 from empty, L3 to disk, and every check**
- The harness's L1 runs `z.FPB.Run.L1` with the new `pBuild = 1`: it destroys the four cubes and every FPB dimension, then runs `z.FPB.Build.All`, `z.FPB.Setup.Model`, `z.FPB.Setup.GroupAttr` and `z.FPB.Setup.HandlingFactor` before the load, all inside the timer, as FPABench's L1 loads master data from an empty system. The installer still builds in its own stages.
- L3 ends with `SaveDataAll`, as L1 and L2 do, and its undo saves again.
- `z.FPB.Test.Check` reads every check `expected.json` has: also W4, W5, L3, M1, M3 and C1, EBIT by country for W1, and the marketing staff cost, overheads and EBIT for M4. Each read goes to its own file, `.check`, `.check2` and so on, and `compare.mjs` reads them all. The marketing staff cost has no measure of its own, so its check is the pool of each month the country has positive net sales, which is what the allocation sums to.

**Answers checked against RAMA's**
- The installer's Reference stage downloads `expected.json`, the answers and checks RAMA recorded for the published dataset, with `scripts/fetch-expected.mjs`. It checks the file against its SHA-256 and that it belongs to the dataset. Every FPABench entry is held to these answers. The installer no longer records DuckDB's answers, and `scripts/windows-import-hook.mjs`, which only that needed, is removed.
- The harness plan comes from `expected.json`, so W8 writes the thresholds RAMA wrote. `z.FPB.Test.W8Setup` runs only without them.
- `compare.mjs` reads `expected.json`. It checks W8 and the `.check` files, fails a missing answer file or check, and takes `--quick` after `-Quick`. The checks the harness does not return yet make W1, W4, W5, L3, M1, M3, M4 and C1 fail.

**Review in FPABench, PR #54**
- README.md and docs/BENCHMARK_METHODOLOGY.md are shorter. Repeated notices are gone: NOTICE holds them.
- README.md has a new Known gaps section: where the harness differs from how FPABench times and checks its other entries. The methodology doc now says that W8 and the `.check` files are not compared, and that `-Quick` times 3 runs of each single-cell write.
- README.md no longer says feeders never name a version. They name `Actual`, as the rules do.

The package remains experimental. Nothing listed here has been validated on IBM Planning Analytics TM1 Server v11 or TM1 Database v12.

**Documentation and notices**
- Project identifier changed to FPABench-TM1, with a prominent Development Status notice.
- Compatibility section now separates what is implemented, intended and validated. Earlier TM1 versions are outside the supported scope, and the manual route for them was removed.
- Benchmark publication notices now tell users to review the licence terms of their own IBM installation and obtain any authorisation those terms require. The earlier unconditional wording was removed.
- IBM non-affiliation wording extended. Publishing source code, running benchmarks and publishing measurements are now described separately.
- Attribution now says that the rules translate FPABench's CC BY 4.0 formulas, rather than describing them as independent of it.
- Added Safety and operational risks to the README.

**Scripts**
- `Install-FPBench.ps1`, `Import-FPBench.ps1` and `Run-FPBench.ps1` stop unless the config sets `DisposableServer = $true`. `-WhatIf` on the installer and importer does not need it.

**Package contents**
- Removed `reference/` and `run/`. The installer now writes the harness plan, the W2 cells and the reference answers on your machine (Data and Reference stages; `-SkipReference` leaves the answers out).
- Added `scripts/windows-import-hook.mjs`, which lets the FPABench runner start on Windows. Needs Node.js 22.15 or later.

**Processes**
- `z.FPB.Build.Dimension`: attributes are created in the Metadata tab, and comments no longer follow code.
- `z.FPB.Build.Fixed`: special members are added last.
- `z.FPB.Setup.Model`: elements are counted before the insert, attributes are read only for elements that already existed, and `FPB_InputCustomer` attributes are guarded with `DimensionExists`.

No change to benchmark methodology, formulas, calculation semantics or process architecture in this issue, other than the process corrections above.
