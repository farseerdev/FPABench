# FPABench-TM1

An FPABench implementation for IBM Planning Analytics TM1 Server v11, for anyone with their own licensed server to run.

> **Status: experimental and untested.** It has not been installed or run on TM1 v11 or TM1 Database v12. It ships no results. Its timings are not yet comparable with FPABench's published results: see [Known gaps](#known-gaps).
>
> Independently developed and not affiliated with or endorsed by IBM. IBM, Cognos and TM1 are IBM trademarks. No IBM software is included. See [NOTICE](NOTICE). The code was created using Claude Opus 5.5 (Anthropic) and needs validation before use.

The model sits in TM1 rules and feeders. TurboIntegrator (TI) processes load the data, perform each test's action and read the answers. The package holds no FPABench data: the installer generates the dataset and the reference answers on your machine, from your own FPABench checkout.

## What's here

| Folder | Contents |
| --- | --- |
| `rules/` | Rules of the four cubes, the M1 and M4 variants of FPB_Reporting, and an empty file used during the bulk load |
| `processes/` | The 28 TI processes as `.ti` sources |
| `scripts/` | `Install-FPBench.ps1`, `Import-FPBench.ps1` and `Run-FPBench.ps1` (PowerShell), and the Node scripts that stage the data (`stage-official.mjs`, `stage-structure.mjs`, `picks-to-tm1.mjs`) and check answers (`compare.mjs`) |
| `stage/empty/` | Header-only load files, used to undo L2 |
| `docs/` | [`BENCHMARK_METHODOLOGY.md`](docs/BENCHMARK_METHODOLOGY.md): what is timed and what to disclose. [`MAPPING.md`](docs/MAPPING.md): where each FPABench variable lives in TM1. `installer-flow.drawio`: the installer on v11 and v12. |

## Compatibility

| Version | State |
| --- | --- |
| TM1 Server v11 on Windows | Written for it. Turn on the REST API with `HttpPortNumber` in `tm1s.cfg`. Not tested. |
| TM1 Database v12 | Rules, processes and the importer only. Uploading rules and staged data, downloading answers and journals, and R8 are not done. Not tested. |
| Earlier versions | Out of scope |

The scripts call TM1 only through its REST API, and need `tm1.ExecuteWithReturn`.

## The model

Four cubes, with dimensions in this order:

| Cube | Dimensions |
| --- | --- |
| FPB_Drivers | FPB_Version, FPB_Channel, FPB_InputCustomer, FPB_InputProduct, FPB_CostCenter, FPB_Account, FPB_Country, FPB_Years, FPB_Months, FPB_Drivers_m |
| FPB_Reporting | FPB_Version, FPB_Currency, FPB_CurrencyScenario, FPB_Channel, FPB_Customer, FPB_Product, FPB_CostCenter, FPB_Account, FPB_Country, FPB_Years, FPB_Months, FPB_Reporting_m |
| FPB_FX | FPB_Version, FPB_FXType, FPB_CurrencyList, FPB_CurrencyListReverse, FPB_Years, FPB_Months |
| FPB_Control | FPB_Version, FPB_ControlParam, FPB_Years, FPB_Months, FPB_Control_m |

- **Actuals live in the Actual version.** Sales-grain actuals are stored in FPB_Reporting's `Actual` version as signed P&L postings. Another version shows the Actual cell in its closed months (rule 3), and empties the months it neither closes nor plans (rule 4). This is exact because nothing in a closed month depends on plan data. Unlike the FPABench model, the rules name the `Actual` version.
- **Consolidations do the summing.** Every "X by group, brand, country or channel" is a `DB()` read of a consolidated cell. Invoice Sales, Net Sales, Gross Margin, CM II, CM III and EBIT are Account consolidations.
- **Customer × brand amounts**, the allocated logistics, sales force and marketing, sit on one leaf per brand, `<brand> (Brand Level)`.
- **Amounts no customer could carry** sit on `NoCustomer`. Customer `By Currency` is customers only, and `All_Hierarchies` is everything.
- **Typed inputs** carry a flag, `<measure> Entered` = 1, so a typed 0 differs from a blank. FX Rate IN has no flag: a planning rate of 0 counts as blank.
- **Feeders from Actual to other versions** go through two stored flags on FPB_Control, which `z.FPB.Control.FeedFlags` keeps.
- **The 18 KPIs** are rules without feeders, computed at the level read. A direct read returns them. Zero suppression hides them.
- **Checks**, the model's `CHECK` variables, run as TI processes, not rules.
- **L1 bulk mode** (`pBulk = 1`) loads with the Drivers and Reporting rules detached, and attaches them at the end.

`z.FPB.Build.*` builds the dimensions and cubes from the FPABench master data. `z.FPB.Setup.Model` adds the helper measures, KPI measures, brand-level elements and attributes the rules need. [`MAPPING.md`](docs/MAPPING.md) has the detail.

## Install and run

You need your own licensed TM1 v11 server with the REST API on, used for nothing else. You also need Node.js 22.15 or later, Windows PowerShell 5.1 or PowerShell 7, and a checkout of [FPABench](https://github.com/farseerdev/FPABench).

1. **Config.** Copy `scripts\FPBench.config.example.psd1` to `FPBench.config.psd1`. Set `DisposableServer = $true`, `RestBaseUrl`, the sign-in and `WorkDir`. Every other folder derives from `WorkDir`. The TM1 server must be able to read and write those folders.
2. **Install.** Run it with `-WhatIf` first:
   ```
   .\scripts\Install-FPBench.ps1 -Config .\scripts\FPBench.config.psd1 -Repo <FPABench checkout> -WhatIf
   .\scripts\Install-FPBench.ps1 -Config .\scripts\FPBench.config.psd1 -Repo <FPABench checkout>
   ```
   A read-only check runs first. It stops if the install would replace `z.FPB.*` processes without `-ReplaceProcesses`, or empty FPB cubes without `-Force`. Then seven stages run. `-From <stage>` resumes at one.

   | Stage | What it does |
   | --- | --- |
   | Data | Generates the 10m dataset if `WorkDir` has none. Writes the load files, the July-close increment and the dimension structure files. |
   | Reference | Downloads RAMA's recorded answers for the dataset, the `expected.json` FPABench publishes, and checks they belong to it. Writes the harness plan and the W2 cells from them. `-SkipReference` uses the dataset's `picks.json` instead. |
   | Import | Creates the 28 processes through REST. A compile error stops the install. |
   | Build | `z.FPB.Build.All`: the 20 dimensions and four cubes |
   | Setup | `z.FPB.Setup.Model` as a dry run, then for real, then `z.FPB.Setup.GroupAttr` and `z.FPB.Setup.HandlingFactor` |
   | Load | `z.FPB.Run.L1`: empties the four cubes, loads them and attaches the rules |
   | Check | `z.FPB.Check.Run`, where every count must be 0, and `compare.mjs` on the L1 answers |

   Nothing outside the FPB cubes, FPB dimensions and `z.FPB.*` processes is created or changed. Each process also runs on its own from Architect or Workspace. Their folder parameters default to `WorkDir` = `C:\FPABench-10m`, with the package in `C:\FPABench-TM1`.
3. **Run.** In PowerShell, elevated if the config names a local `ServiceName`:
   ```
   .\scripts\Run-FPBench.ps1 -Config .\scripts\FPBench.config.psd1
   node scripts\compare.mjs <WorkDir>\tm1_reference\expected.json <WorkDir>\tm1_results\answers
   ```

The harness signs in once and runs each test as one timed `tm1.ExecuteWithReturn` call: the action, then its proving read. Its L1 starts from an empty model: `z.FPB.Run.L1` with `pBuild = 1` destroys the four cubes and every FPB dimension, then builds, sets up and loads them. The loads end with `SaveDataAll`. It undoes each run inside the running server with `z.FPB.State.Save` and `z.FPB.State.Restore`. R8 stops and starts the TM1 service. [`BENCHMARK_METHODOLOGY.md`](docs/BENCHMARK_METHODOLOGY.md) has the details.

## Known gaps

These make the harness's numbers differ from how FPABench times and checks its other entries. Fix them before comparing results.

| Gap | FPABench's method |
| --- | --- |
| L2 adds the increment to Actual Y2026 M7 instead of replacing it. That is right only because the base has no M7 actuals. | A load replaces the cells it names |
| Reads get an untimed warm-up before the timed runs | Reads run 5 times after a restore, with no warm-up |
| Tests are undone inside the running server | Loads, bulk writes and model changes start from the snapshot |
| `netMedianMs` subtracts a REST round trip. `-Affinity` pins the TM1 service and raises its priority. | Times are not adjusted, servers pay their round trip, and settings stay at defaults |
| Answers are written to a file on the server with `NumberToString`, whose precision is not checked. Results go to `tm1-results.json`. | The timer stops when the answer is in the runner's memory. Results use the runner's format. |
| R5 and R6 read with `CellGetN` loops over every customer and product | A view is what a TM1 user would run |

The straightest fix is an entry for FPABench's own runner, `systems/tm1/tests/<id>.mjs` as the other entries have, that calls these processes and MDX views over REST.

## Safety

Use the scripts only on an isolated, disposable server that holds nothing you need. They stop unless the config sets `DisposableServer = $true`.

| Operation | Risk | Safeguard |
| --- | --- | --- |
| Stopping and starting the service (R8, `-FromSnapshot`) | Everyone connected loses the server. Unsaved changes can be lost. | Only with `ServiceName` set |
| Restoring the data folder (`-FromSnapshot`) | Replaces its contents. A failed copy leaves it incomplete and the service stopped. | Refuses a folder without `tm1s.cfg` |
| `robocopy /MIR` | Deletes whatever the destination has that the source lacks | Refuses drive roots, identical or nested folders, and non-empty folders that aren't a snapshot |
| `-Affinity` | Pins TM1 to chosen processors at high priority, starving other work | Only when passed |
| `RestSkipCertificateCheck` | Exposes the password and session if the server isn't the one you meant | Off by default, and only for `RestBaseUrl`'s host and port |
| `-Force`, or `z.FPB.Build.Cubes` with `pDestroy = 1` | Empties or destroys the four FPB cubes | The installer asks for `-Force`, and never uses `pDestroy` |

The password comes from the environment variable named in `PasswordEnvVar`, from `Password` in your local config, or from a prompt. It is never logged. `.gitignore` keeps `FPBench.config.psd1` out of the repository. `RestBaseUrl` must use https, except for a server on the same machine with `AllowInsecureHttp = $true`.

## Licence and publishing

The code is under the [Apache License 2.0](LICENSE). It grants no rights in IBM software. The rules and `docs/MAPPING.md` translate FPABench's model, which is under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The scripts read FPABench's data from your checkout, and FPABench's licences apply to what they write. Built against FPABench commit `3c02a65c16181e3918cae7a5381de3d4c352d890`.

Publishing this code, running it on your TM1 server, and publishing its timings are separate acts. Before publishing measurements or comparisons, review the licence of your IBM installation, including any limits on performance testing or disclosure, and get any authorisation it requires. Results are not certified or endorsed by IBM. This is not legal advice.
