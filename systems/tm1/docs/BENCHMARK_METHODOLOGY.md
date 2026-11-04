# Benchmark methodology

How `scripts/Run-FPBench.ps1` times the FPABench tests on TM1, what its numbers mean, and what to disclose with them. The package holds no results, and the harness has not run on a TM1 server. Where it differs from FPABench's own method, see [Known gaps](../README.md#known-gaps).

## Source

| | |
| --- | --- |
| Benchmark | [FPABench](https://github.com/farseerdev/FPABench), by [Farseer](https://www.farseer.com), built against commit `3c02a65c16181e3918cae7a5381de3d4c352d890` |
| Dataset | `node data/generate.mjs --size 10m`, seed 20261012 |
| Tests | FPABench's `tests/tests.json`, `tests/README.md` and `tests/method.md` |
| Reference answers | RAMA's recorded answers and checks, the `expected.json` FPABench publishes with the 10m dataset. The installer downloads it into `<WorkDir>\tm1_reference\expected.json` and checks it belongs to the dataset. Every FPABench entry is held to it. |

Farseer makes FPABench and RAMA, one of its systems. Say so when you compare results.

## What is timed

- **One call per run.** Each run is one REST call, `POST /Processes('<name>')/tm1.ExecuteWithReturn`, to a TI process that performs the test's action and then its proving read. The timer starts just before the call and stops when the response arrives. Signing in is not timed.
- **Checks, undo and warm-up are not timed.** `z.FPB.Test.Check` reads, after the run, every check `expected.json` has for the test. `z.FPB.State.Save` and `z.FPB.State.Restore` undo each run inside the running server. Before the reads, R1 to R7 and C2, an untimed warm-up runs whenever TM1's calculation cache was emptied. `-NoWarmup` turns it off.
- **R8** stops the TM1 Windows service, starts it, and times until the first read succeeds. It needs the server on the same machine.
- **Repeats** come from the harness plan, `<WorkDir>\tm1_plan\plan.json`. `-Quick` runs each test once, and single-cell writes 4 times: 1 warm-up and 3 timed.

## The numbers in `tm1-results.json`

| Field | Meaning |
| --- | --- |
| `rawMs` | Every timed call, in milliseconds, measured by the client |
| `medianMs` | The median of `rawMs` |
| `p95Ms` | The 95th percentile, for single-cell writes |
| `noopMedianMs` | The median of ten calls to `z.FPB.Noop`, an empty process: one REST call without TM1 work |
| `netMedianMs` | `max(0, medianMs - noopMedianMs)`. An estimate, not measured inside TM1. FPABench does not subtract round trips, so compare `medianMs`. |
| `wallSec` | The whole test with its resets and checks, for orientation only |
| `settings` | Every harness choice: transport, reset, warm-up, affinity, checks |

## Correctness

A time counts only with a correct answer. After a run, compare the answers with the reference:

```
node scripts\compare.mjs <WorkDir>\tm1_reference\expected.json <OutDirectory>\answers
```

`compare.mjs` matches answers by key, within 0.01 or a relative 1e-9, whichever is larger, and R4's ratios within a relative 1e-6. A missing row counts as 0. What `expected.json` lists as zero must be 0, and every other check it has must come back and match. A missing answer file is a failure. After `-Quick`, add `--quick`: only the runs that have a file are compared. Report every test that differs or is incomplete.

## What to disclose

- The FPABench commit, dataset size and seed, and this package's commit.
- The TM1 product, version and fix pack, and the relevant `tm1s.cfg` settings, such as `MTQ` and `PersistentFeeders`.
- The operating system, CPU, cores and threads, memory, storage and virtualisation, and whether client and server shared the machine. Any `-Affinity` or priority change.
- The harness settings in `tm1-results.json`, the number of runs, and whether `-Quick` or `-NoWarmup` was used.
- Whether the times are client-side or server-side.
- The output of `compare.mjs`, and every test that failed, was skipped, or differs from the reference.
- Every way the TM1 model or harness differs from FPABench's model and method, including the [Known gaps](../README.md#known-gaps).

Before publishing measurements or comparisons, review the licence of your IBM installation, including any limits on performance testing or disclosure, and get any authorisation it requires. Results are not certified or endorsed by IBM.
