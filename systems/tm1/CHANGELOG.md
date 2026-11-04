# Changelog

## Current issue

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
