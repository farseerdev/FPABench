# Benchmark methodology

How `scripts/Run-FPBench.ps1` measures the FPABench tests on TM1, what its numbers mean, and what to
disclose if you publish them. This repository contains no recorded TM1 results: everything below
describes how results would be produced.

## Upstream benchmark

| | |
|---|---|
| Benchmark | [FPABench](https://github.com/farseerdev/FPABench), made by [Farseer](https://www.farseer.com) |
| Upstream commit used for this package | `3c02a65c16181e3918cae7a5381de3d4c352d890` (25 Oct 2026) |
| Dataset | generated with the upstream generator: `node data/generate.mjs --size 10m` (seed 20261012) |
| Test definitions | upstream `tests/method.md` and the per-test descriptions in the upstream repository |
| Reference answers | written by the installer to `<WorkDir>\tm1_reference\answers-duckdb-10m.json` with the upstream runner's `duckdb-tables` entry on that dataset, using the dataset's `picks.json`. Nothing here comes with this package. |

FPABench is published by Farseer, which also develops one of the benchmarked systems (RAMA). The
benchmark's definitions, data and reference implementation are public, so they can be inspected; say
so when comparing results with any system, including Farseer's.

## What is timed

- **One call per run.** Each timed run is one REST call (`POST /Processes('<name>')/tm1.ExecuteWithReturn`)
  to a TI process that performs the test's action (write, load or model change) and then its proving read.
  The Stopwatch in the harness starts just before the call and stops when the server's response arrives.
  Signing in is not timed: the harness keeps one session for the whole run.
- **Checks are not timed.** For W1, W2, W8, M2, M4 and L2, the values that prove the run correct are read
  afterwards by `z.FPB.Test.Check`, outside the timer.
- **Undo is not timed.** Before each run `z.FPB.State.Save` records what the run will change; afterwards
  `z.FPB.State.Restore` puts it back inside the running server. The server is not restarted between tests.
- **Warm-up.** Before the read tests (R1–R7, C2), untimed warm-up reads run whenever TM1's calculation cache
  was emptied (after a load, restart, rule reload or undo), so reads meet a server in its normal working
  state. Writes, loads and model changes get no warm-up. `-NoWarmup` turns this off; the choice is recorded.
- **R8 (open the model)** stops the TM1 Windows service, starts it, and times until the first read succeeds
  (wall clock). It needs the server on the same machine and is reported as not measurable otherwise.
- **Repetitions** come from the harness plan the installer writes (`<WorkDir>\tm1_plan\plan.json`) (`repeats`, `warm`, and the list of runs for single-cell writes);
  `-Quick` runs each test once (four runs for single-cell writes).

## The numbers in `tm1-results.json`

| Field | Meaning |
|---|---|
| `rawMs` | every timed call, in milliseconds, as measured by the client |
| `medianMs` | median of `rawMs` |
| `p95Ms` | 95th percentile, for the single-cell write tests |
| `noopMedianMs` | median of ten calls to `z.FPB.Noop`, an empty process: the cost of one REST call without TM1 work |
| `netMedianMs` | `max(0, medianMs - noopMedianMs)`: an **estimate** of the time spent in TM1 beyond the call overhead. It is not measured inside the TM1 engine |
| `wallSec` | the whole test including untimed resets and checks, for orientation only |
| `settings` | every harness choice (transport, reset method, warm-up, affinity, checks) |

The client-side timings include network latency and the REST layer. Server-side process timings (for
example from the TM1 server log) can be used to cross-check them; say which you report.

## Correctness

A time counts only with a correct answer. After a run, compare every answer file with the reference:

```
node scripts\compare.mjs <WorkDir>\tm1_reference\answers-duckdb-10m.json <OutDirectory>\answers
```

`compare.mjs` matches answers by key. The tolerance is 0.01 absolute (or 1e-9 relative for large values),
and 1e-6 relative for the R4 ratios; C2 rows must all be 0. Report any test whose answers differ, and
do not report its time as comparable.

## What to disclose with published results

- FPABench upstream commit, dataset size and seed; this package's version or commit.
- IBM Planning Analytics / TM1 product, version and fix pack, and its relevant `tm1s.cfg` settings
  (for example `MTQ`, `PersistentFeeders`).
- Operating system, CPU model, cores and threads, memory, storage, virtualisation, and whether client
  and server ran on the same machine. Any processor affinity (`-Affinity`) or priority change.
- The harness settings recorded in `tm1-results.json`, the number of runs, and whether `-Quick` or
  `-NoWarmup` was used.
- Whether timings are client-side (`medianMs`, `netMedianMs`) or server-side.
- The result of `compare.mjs`, and every test that failed, was skipped (for example R8) or differs from
  the reference.
- Every way the TM1 model differs from the FPABench model description, and anything that makes a
  comparison with another system less than like for like (for example a different machine, or a
  different meaning of "a write is visible").

Before publishing performance measurements or comparative benchmark results, users must review the licence
terms applicable to their IBM software installation, including any restrictions on performance testing or
disclosure, and obtain any authorisation required by those terms. Results produced with this code are not
certified or endorsed by IBM.

This harness has not been installed, executed or validated on IBM Planning Analytics TM1 Server v11 or TM1
Database v12. This document describes how it is designed to measure.
