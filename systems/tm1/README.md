# FPABench-TM1

> **Development Status — Experimental and Untested**
>
> FPABench-TM1 is an independent, experimental implementation of the FPABench benchmark for IBM Planning Analytics.
>
> The implementation has not been installed, executed or validated on IBM Planning Analytics TM1 Server v11 or TM1 Database v12.
>
> Compatibility, functional correctness and benchmark performance have not been established.
>
> The repository contains no measured TM1 benchmark results.
>
> Earlier TM1 versions are outside the supported scope of this release.
>
> Users must provide their own appropriately licensed IBM Planning Analytics environment.

> **No IBM software, no affiliation.** This project is independently developed and is not affiliated with, endorsed by, sponsored by or supported by IBM. IBM, Cognos and TM1 are trademarks of International Business Machines Corporation, used only to identify the software this code is intended for. IBM software is not included, and this project's licence grants no rights in it. See [NOTICE](NOTICE).

> **Benchmark results.** Before publishing performance measurements or comparative benchmark results, users must review the licence terms applicable to their IBM software installation, including any restrictions on performance testing or disclosure, and obtain any authorisation required by those terms. See [Publishing and licensing](#publishing-and-licensing).

> **Created using Claude.** The code in this repository, including the TurboIntegrator processes, rules and scripts, was created using Claude Opus 5.5 (Anthropic) and requires validation before use.

FPABench-TM1 is an independent, experimental FPABench implementation intended for IBM Planning Analytics TM1 Server v11, with potential future support for TM1 Database v12. It consists of rules, TurboIntegrator (TI) processes, scripts and documentation. It contains no FPABench data: the installer generates the dataset and the reference answers it checks against on your machine, from your own copy of FPABench. All calculation is designed to sit in TM1 rules and feeders; TI loads data, performs each test's action and reads the answers. It is not an official FPABench reference implementation.

## What's here

| Folder | Contents |
|---|---|
| `rules/` | Rule files for the four cubes: base, plus the M1 and M4 variants of FPB_Reporting, and an empty file used during bulk load. |
| `processes/` | The 28 TI processes as readable sources, one `.ti` file each: parameters, data source, variables and the code of the four tabs. They include the four `z.FPB.Build.*` processes that create the dimensions and cubes. `scripts/Import-FPBench.ps1` creates them on a server. |
| `scripts/` | `Install-FPBench.ps1` (sets everything up in one run), `Import-FPBench.ps1` (creates or updates the processes on a server through the REST API), `Run-FPBench.ps1` (timing harness), `FPBench.Rest.ps1` and `FPBench.Config.ps1` (the REST connection and config reading they share), `compare.mjs` (checks answers against the reference), `stage-official.mjs` (turns the FPABench dataset into the three load files), `stage-structure.mjs` (writes the dimension structure files from the FPABench master data), `picks-to-tm1.mjs` (builds the harness plan). |
| `stage/empty/` | Header-only load files the harness uses to undo L2. |
| `docs/` | `BENCHMARK_METHODOLOGY.md`: what the harness times, what its numbers mean and what to disclose with results. `MAPPING.md`: every variable of the FPABench model and its TM1 home. `installer-flow.drawio`: how `Install-FPBench.ps1` works on Planning Analytics v11 and on TM1 Database 12 (open it in draw.io / diagrams.net). |
| `CHANGELOG.md` | What changed in each issue of this package. |

Also here: `CONTRIBUTING.md` (what may be contributed), `.gitignore` (keeps your local config, credentials and generated files out of the repository), `LICENSE` and `NOTICE`.

## Compatibility

Nothing below has been validated. "Implemented" means the code exists, "intended" means what it is designed for, and "validated" means it has been installed and run on that version.

| Version | Implemented | Intended | Validated |
|---|---|---|---|
| IBM Planning Analytics TM1 Server v11, on Windows | Installer, importer, processes, rules and harness | Designed for this version. Set `HttpPortNumber` in `tm1s.cfg` to enable the REST API, and point `RestBaseUrl` at it. | **No. Requires testing.** |
| TM1 Database v12 | Rules, processes and the import script. Not implemented: uploading the rule files and staged data to the database's file storage, downloading answer files and undo journals, and R8, which restarts the server. | Potential future support, subject to further adaptation. | **No. Requires testing.** |

Earlier TM1 versions are outside the supported scope of this release. That some of them have a REST API does not imply compatibility with this package.

The import script and the harness call TM1 only through its REST API, and are designed for a server whose REST API can create processes and run them with a returned status (`tm1.ExecuteWithReturn`). The code is provided as is, without warranty (see [LICENSE](LICENSE)). Check your version's documentation and validate the code on it before relying on it.

### How the harness connects

- **One session for the whole run.** The harness signs in once, keeps the server's session cookie, and runs each process with `POST /Processes('<name>')/tm1.ExecuteWithReturn`. The sign-in is not part of any timed call. If the session is lost (for example after a restart), it signs in again once.
- **Signing in.** TM1 security uses `User` and `Password` (Basic). CAM security also needs `CAMNamespace`. Any other scheme (for example a v12 API key) can be given as a complete `RestAuthorization` header.
- **Encryption and password.** `RestBaseUrl` must use https; plain http is accepted only for a server on the same machine with `AllowInsecureHttp = $true`. The password comes from the environment variable named in `PasswordEnvVar`, from `Password` in your local config, or from a prompt, and is never logged.
- **Certificates.** `RestSkipCertificateCheck = $true` accepts a self-signed or otherwise invalid certificate, for the `RestBaseUrl` host and port only (per request in PowerShell 7; in Windows PowerShell 5.1 through a .NET callback limited to that host and port). Use it only on a server you control.
- **Exit codes.** `CompletedSuccessfully` counts as success, `HasMinorErrors` as exit 3, anything else as a failure.
- **Local server only.** R8, `-FromSnapshot` and `-Affinity` stop, start or pin the TM1 Windows service named in `ServiceName`, so they need the server on the same machine and an elevated PowerShell. Without a local service, R8 is reported as not measurable.
- **Not yet adapted for v12.** Answer files, undo journals and rule files are read and written at the config's paths, which a v12 database cannot see.

## The model it expects

Four cubes, with dimensions in this order:

| Cube | Dimensions |
|---|---|
| FPB_Drivers | FPB_Version, FPB_Channel, FPB_InputCustomer, FPB_InputProduct, FPB_CostCenter, FPB_Account, FPB_Country, FPB_Years, FPB_Months, FPB_Drivers_m |
| FPB_Reporting | FPB_Version, FPB_Currency, FPB_CurrencyScenario, FPB_Channel, FPB_Customer, FPB_Product, FPB_CostCenter, FPB_Account, FPB_Country, FPB_Years, FPB_Months, FPB_Reporting_m |
| FPB_FX | FPB_Version, FPB_FXType, FPB_CurrencyList, FPB_CurrencyListReverse, FPB_Years, FPB_Months |
| FPB_Control | FPB_Version, FPB_ControlParam, FPB_Years, FPB_Months, FPB_Control_m |

The base dimensions and cubes are built from the FPABench master data by the `z.FPB.Build.*` processes (next section). `z.FPB.Setup.Model` then adds the elements, attributes and consolidations the rules need (table below). Alternate rollups are consolidations and attributes, not extra dimensions. Special members are dimension-specific: NoCustomer, NoProduct, NoCostCenter, NoAccount, NoChannel, Global, Annual.

### What z.FPB.Setup.Model adds (run with pApply = 0 first: it only logs)

| Dimension | Change |
|---|---|
| FPB_Control_m | + FC Plan Months, Feed Actual Copy, Feed Plan |
| FPB_FXType | + Carry, Effective |
| FPB_Drivers_m | + 18 helper measures, + zFPB_KPI_ClearScope and zFPB_Leaf_ClearScope (C, weight 0, zero-out scopes) |
| FPB_Reporting_m | + 6 helper measures, + 18 KPI measures |
| FPB_Product | + C `Brand Level` under `By Product`; one N `<brand> (Brand Level)` per brand under its brand and under Brand Level; NoProduct under Brand Level |
| FPB_Customer / FPB_CostCenter | NoCustomer / NoCostCenter into All_Hierarchies (weight 1) |
| Attributes | FPB_Years Prev/Next, FPB_Months Prev/Next, FPB_Product HandlingFactor, FPB_InputCustomer Channel/Country |

No cube is created, destroyed or re-dimensioned.

## Build and run

**You need:** your own licensed IBM Planning Analytics v11 server with the REST API on (`HttpPortNumber` in `tm1s.cfg`), an empty TM1 server for FPABench, Node.js 22.15 or later, Windows PowerShell 5.1 or PowerShell 7, and a checkout of the [FPABench repository](https://github.com/farseerdev/FPABench).

**Before you install.** Use an isolated, disposable, non-production TM1 server and back it up first, and read [Safety and operational risks](#safety-and-operational-risks). The scripts stop unless the config sets `DisposableServer = $true`, which confirms this. The installer empties existing FPB cubes only with `-Force` and replaces existing `z.FPB.*` processes only with `-ReplaceProcesses`; the harness's R8 and `-FromSnapshot` stop the TM1 service and mirror its data folder.

1. **Write the config.** Copy `scripts\FPBench.config.example.psd1` to `FPBench.config.psd1` and set `DisposableServer = $true`, `RestBaseUrl`, the sign-in and `WorkDir`. Every other folder is derived from `WorkDir` (listed in `scripts\FPBench.Config.ps1`); set a folder explicitly to override it. The TM1 server must be able to read and write these folders, because the processes open the files themselves: automatic for a server on the same machine, a shared folder otherwise.
2. **Install.** First see what it would do, then run it:
   ```
   .\scripts\Install-FPBench.ps1 -Config .\scripts\FPBench.config.psd1 -Repo <FPABench repository> -WhatIf
   .\scripts\Install-FPBench.ps1 -Config .\scripts\FPBench.config.psd1 -Repo <FPABench repository>
   ```
   A read-only check of the server runs first: it stops, with nothing changed, if the run would replace existing processes or empty existing FPB cubes without the matching switch. The seven stages below then run, stopping at the first failure; `-From <stage>` resumes there, after the same check (so on an installed server, resuming at Load or earlier needs `-Force`, and at Import also `-ReplaceProcesses`). `docs/installer-flow.drawio` shows the flow, including what differs on TM1 Database 12.

   | Stage | What it does |
   |---|---|
   | Data | Generates the 10m dataset with the FPABench generator if `WorkDir` has none, then writes the three load files and the July-close increment (`stage-official.mjs`), the nine dimension structure files (`stage-structure.mjs`), and the harness plan and W2 cells from the dataset's picks (`picks-to-tm1.mjs`). |
   | Reference | Writes the reference answers to `<WorkDir>\tm1_reference` with the FPABench runner's DuckDB entry, unless the file already exists. It installs that entry's packages in the FPABench repository and can take a long time. `-SkipReference` leaves this out, and the Check stage then does not compare answers. |
   | Import | Creates the 28 processes from `processes\*.ti` through the REST API (`Import-FPBench.ps1`), replacing existing ones only with `-ReplaceProcesses`. The server compiles each one; any compile error stops the install, with its tab and line. |
   | Build | `z.FPB.Build.All`: the 20 dimensions and the four cubes, in the dimension order above. |
   | Setup | `z.FPB.Setup.Model` with pApply = 0 (a dry run that stops on a missing prerequisite), then pApply = 1; then `z.FPB.Setup.GroupAttr` and `z.FPB.Setup.HandlingFactor`. |
   | Load | `z.FPB.Run.L1` (FPABench L1): loads the four cubes and attaches the rules from the `rules` folder with `RuleLoadFromFile`. It empties the four cubes first. |
   | Check | `z.FPB.Check.Run` (every SUMMARY count must be 0) and `compare.mjs` on the L1 answers. |

   Nothing outside the FPB cubes, the FPB dimensions and the z.FPB processes is created or changed. The processes write their logs to `<WorkDir>\tm1_logs`.
3. **Run the benchmark** with the same config, in PowerShell (elevated, if the config names a local `ServiceName`):
   ```
   .\scripts\Run-FPBench.ps1 -Config .\scripts\FPBench.config.psd1
   node scripts\compare.mjs <WorkDir>\tm1_reference\answers-duckdb-10m.json <WorkDir>\tm1_results\answers
   ```

**The build processes.** `z.FPB.Build.All` runs the other three:
1. `z.FPB.Build.Dimension` once per structure file: FPB_Version, FPB_Years, FPB_Months, FPB_Channel, FPB_Country, FPB_Account, FPB_CostCenter, FPB_Customer, FPB_Product. It creates the dimension if needed, adds the elements and links in file order, and creates and fills the attributes the file's header declares, plus the alias `Code and Name Alias`.
2. `z.FPB.Build.Fixed`: the dimensions that belong to the TM1 design rather than the master data (FPB_Currency, FPB_CurrencyScenario, FPB_FXType, FPB_ControlParam, FPB_CurrencyList, FPB_CurrencyListReverse and the three measure dimensions), FPB_InputCustomer and FPB_InputProduct (derived from the `Source Level` attribute of FPB_Customer and FPB_Product), and the special members.
3. `z.FPB.Build.Cubes` with pDestroy = 0: creates the four cubes, and checks the dimension order of any cube that already exists.

All four only add: they never delete an element or a link, or change an existing weight. The exception is `z.FPB.Build.Cubes` with pDestroy = 1, which first **destroys the four cubes and their data**; the installer never uses it.

**Step by step instead.** Each stage can also be run on its own: the three Node scripts with the arguments shown in their headers, `Import-FPBench.ps1` (it stops without changes if any selected process already exists, unless you add `-ReplaceExisting`; `-WhatIf` lists what it would create or replace; `-Process z.FPB.Build.*` limits it to matching names), and the processes from Architect or Workspace in the order of the table. Every process takes its folders as parameters; a folder name with `/` is joined with `/`, any other with `\`. The processes that write logs take an optional `pLogDir` (default: the server's process error folder). Their parameter defaults assume `WorkDir` = `C:\FPABench-10m` and this package in `C:\FPABench-TM1`.

**How the harness works.**
- **Timer.** Each test is one call to a TI process through the REST API: the action and its proving read. The checks are read afterwards, untimed. The harness measures the round trip of an empty process (`z.FPB.Noop`) and also reports each median with it subtracted (`netMedianMs`), an estimate rather than a measurement inside TM1. [docs/BENCHMARK_METHODOLOGY.md](docs/BENCHMARK_METHODOLOGY.md) has the details.
- **Undo between runs.** The server stays up. Before each run, `z.FPB.State.Save` records what the run will change; afterwards, `z.FPB.State.Restore` puts it back. Both are untimed.
- **R8.** It stops and starts the TM1 service, as FPABench defines it (local server only).
- **Warm-up.** Before the reads, an untimed warm-up runs whenever TM1's calculation cache was emptied (`-NoWarmup` turns it off).
- **Pinning.** `-Affinity <hex mask>` pins the TM1 service to chosen logical processors, for CPUs with performance and efficiency cores.
- **Settings recorded.** `tm1-results.json` records every choice under `settings`.

## Safety and operational risks

Use these scripts only on an isolated, disposable benchmark environment that holds nothing you need to keep. They are not designed for shared or production servers.

| Operation | Risk | Safeguard in the scripts |
|---|---|---|
| Stopping and starting the TM1 service (R8, `-FromSnapshot`) | Everyone connected loses the server, and unsaved changes can be lost. | Only with `ServiceName` set in the config. |
| Restoring the server's data folder (`-FromSnapshot`) | Replaces the data folder's contents with the snapshot. If the copy fails, the data folder may be incomplete, and the service is left stopped. | Refuses a folder without `tm1s.cfg` as data folder or as snapshot to restore from. |
| `robocopy /MIR` | **Deletes** whatever the destination has that the source lacks. | Refuses drive roots, identical or nested folders, and mirroring into a non-empty folder that isn't a previous snapshot. |
| Processor affinity and priority (`-Affinity`) | Pins the TM1 service to chosen processors at high priority, which can starve other work on the machine. | Only when you pass `-Affinity`. |
| Skipping certificate validation (`RestSkipCertificateCheck`) | Exposes the password and session to interception if the connection isn't the server you intended. | Off by default, and applies to the `RestBaseUrl` host and port only. Use it only on a network you control. |
| Emptying or destroying data (`-Force`, `z.FPB.Build.Cubes` with pDestroy = 1, test undo) | `-Force` empties and reloads the four FPB cubes. pDestroy = 1 destroys them and their data. | The installer asks for `-Force` when FPB cubes exist, and never uses pDestroy. |

These safeguards have limits and do not replace your own backup. The snapshot is a convenience for the benchmark, not a supported TM1 backup.

## Publishing and licensing

These are different activities, and different legal and contractual considerations may apply to each:

- **Publishing independently authored benchmarking source code**, such as this repository, is governed by the licences listed below.
- **Running benchmarks against licensed IBM software** is governed by the licence terms of your installation.
- **Publishing benchmark measurements or comparisons**: Before publishing performance measurements or comparative benchmark results, users must review the licence terms applicable to their IBM software installation, including any restrictions on performance testing or disclosure, and obtain any authorisation required by those terms.

Results produced with this code are not certified or endorsed by IBM. This section is not legal advice.

## Design

- **Native consolidation does the summing.** Every "X by group / brand / country / channel" is a consolidated `DB()` read of stored leaves, with no rule involved.
- **Sales-grain actuals are stored** in FPB_Reporting's `Actual` version as signed P&L postings. Invoice Sales, Net Sales, Gross Margin, CM II, CM III and EBIT are Account consolidations.
- **Two generic rules handle the forecast merge.** One copies the Actual cell into a version's closed months; the other empties months that are neither actual nor plan.
- **Customer × brand amounts sit on one N element per brand**, `<brand> (Brand Level)`. These are the allocated logistics, sales force and marketing costs.
- **Amounts no customer could carry sit on `NoCustomer`.** This keeps "customers only" (`By Currency`) and "everything" (`All_Hierarchies`) apart.
- **Feeders never name a version.** Two stored flags on FPB_Control, maintained by `z.FPB.Control.FeedFlags`, decide whether actuals feed other versions.
- **The 18 KPI ratios have no feeders.** They are rules on FPB_Reporting_m (for example `['COGS % of Gross Sales'] = - ['P150','Amount'] \ ['P100','Amount']`), calculated at whatever level is read. A direct read (`CellGetN`, `DBRW`) always returns them, which is how R4 reads them. In a view with zero suppression on, they are hidden, because suppression keeps only stored or fed cells: turn suppression off to see them. They are left unfed on purpose, since feeding them would add feeder work to every load and rule reload in the timed tests.
- **Checks run as TI processes**, not rules.
- **L1 bulk mode** (`pBulk = 1`) loads with the Drivers and Reporting rules detached and attaches them at the end.

**Typed inputs.** A typed input is its value plus `<measure> Entered` = 1, so a typed 0 differs from a blank. The loaders and test processes always write both. FX Rate IN has no flag: a planning rate counts as typed when it is non-zero.

## Licence

The original code in this repository is licensed under the [Apache License 2.0](LICENSE). That licence does not cover IBM software, and it does not replace the licences of the third-party material below.

This project implements [FPABench](https://github.com/farseerdev/FPABench), made by [Farseer](https://www.farseer.com). Upstream, FPABench's code is licensed under the Apache License 2.0, and its model, data and documentation under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This package was built against upstream commit `3c02a65c16181e3918cae7a5381de3d4c352d890` (25 Oct 2026). Material here that is derived from FPABench, and is under CC BY 4.0:
- `rules/`: the model's formulas, translated into TM1 rule syntax;
- `docs/MAPPING.md`: lists the FPABench model's variables, with where each lives in TM1.

This package contains no FPABench data. The installer writes the dataset, the harness plan, the W2 cells and the reference answers on your machine, from your own checkout of FPABench; FPABench's licences apply to them.

The rule files translate the formulas of the FPABench model (CC BY 4.0) into TM1 rule syntax, and the processes follow FPABench's test definitions and dataset layout. They were changed from the originals in language and structure, to fit TM1 and the four-cube design; `docs/MAPPING.md` shows where each variable went. Nothing here implies endorsement by FPABench's authors or Farseer. The scripts read FPABench's dataset and lookup lists from your own copy of FPABench at run time, and the files they write are derived from that material, so FPABench's licences apply to them. The DuckDB packages the Reference stage installs through the FPABench entry are not included here and carry their own licences.
