# The runner

Draft. It runs the tests in [`tests/tests.json`](../tests/tests.json) against one system and writes the times, the checks and every answer. It is the same for every system. [`tests/method.md`](../tests/method.md) says how each kind of test is timed, repeated and reset.

## Run it

With a published size, the runner downloads the dataset and RAMA's expected answers into `--work` once, and checks their SHA-256 first:

```bash
node runner/run.mjs --entry duckdb-tables --dataset 10m --work ~/run/work --out ~/run/out --machine n2d-standard-4
```

To make a dataset and record the answers yourself:

```bash
node data/generate.mjs --size 10m --out ~/data/fpabench-10m
node runner/run.mjs --entry rama --dataset ~/data/fpabench-10m --work ~/run/work --out ~/run/out --record ~/run/expected.json --machine n2d-standard-4
node runner/run.mjs --entry duckdb-tables --dataset ~/data/fpabench-10m --work ~/run/work --out ~/run/out --expected ~/run/expected.json --machine n2d-standard-4
```

Each system must be installed first. See its folder in [`systems/`](../systems/).

The dataset brings `picks.json`: for each test, the cells it writes and the values. `--record` runs RAMA's tests on those picks and saves every answer and check as the expected results, with the picks. Every other system runs with `--expected` and must give the same answers. When a system disagrees with RAMA, someone finds out which one is right. RAMA's answers are not checked against the effects `tests.json` states, so a RAMA error shows up as every other system being wrong on that test.

| Option | What it does |
| --- | --- |
| `--entry` | The folder in `systems/` to run |
| `--dataset` | A dataset folder written by `data/generate.mjs`, or a published size such as `10m`, which is downloaded |
| `--work` | Scratch space: the input cells, the system's files and the snapshot. All of them are kept per dataset, by the SHA-256 of its manifest. |
| `--out` | Where `<entry>.json`, `<entry>.answers.json` and `<entry>.log` go |
| `--record` | Runs on the dataset's picks and writes the expected results to this file. For RAMA. |
| `--expected` | The expected results to check against. A downloaded size brings its own. A file recorded for another dataset is refused. |
| `--tests` | Only these tests, such as `L1,W1,R1`. They are added to the results already in `--out`. With `--record`, they replace only their own entries in an expected file that is already there. Every test but L1 starts from the snapshot L1 leaves. On a work folder where L1 has not run yet, the runner loads once first, untimed and not recorded, to make one. |
| `--machine` | The machine, as it goes in the results, such as `n2d-standard-4, local NVMe SSD`. A published result goes in `results/<machine>/<size>/`, with the machine in lower case and hyphens, named by the entry and the system version: `results/n2d-standard-4-local-nvme-ssd/10m/rama-2.0.0-7528851.0.json`. Each version is its own row on the website. |
| `--quick` | One run of each load, bulk write, model change and read, and three writes per write test, to try the runner. Not for results. A quick record goes with quick runs only. |

## The tests

Each test is one file per system, `systems/<entry>/tests/<id>.mjs`, written in the system's own calls. A test exports:

| Member | What it does |
| --- | --- |
| `setup(context)` | Gets the system ready, untimed. Most tests put the system back to the snapshot. RAMA's W8 also works out the values it writes here, since they come from the model. |
| `open(context)` | Optional, R8 only. Starts the system, inside the timer. |
| `run(context)` | One timed run, from the first call to the end of the proving read. Returns the rows it read, `{ key, value }`. |
| `check(context)` | Optional. Untimed checks after a run. Returns `{ name: rows }`. |
| `teardown(context)` | Untimed. Stops the system. It runs even when setup or a run throws, with `context.failed` set. L1's teardown keeps the snapshot, unless the load failed. |

`context` holds the work folder, the input cells, the test's picks, the pick of the run, and whatever `setup` puts in it. Each system's `db.mjs` also exports `system`: its name, version and settings, as they go in the results.

## What it does

1. It turns the dataset into input cells with `data/cells.mjs`, once. This step is not timed.
2. It runs the tests in the order of `tests.json`. L1 loads three times from empty, and the file after the last load is the snapshot.
3. A write test sets up once, writes once to warm up, then 20 times, each with its own pick. A read sets up once and runs 5 times. R8, a load, a bulk write, a model change and a check without a timer set up fresh for each of their runs.
4. The timer runs here, around `run()`. A load's timer also waits for `sync`. R8's timer also covers `open()`.
5. It compares every answer and every check with the expected results, within the tolerances of `tests.json`. Amounts match within 0.01 or a relative 1e-9. A test whose expectation says `ratioRelative`, such as R4, matches within a relative 1e-6. An answer and a recorded answer must have the same rows, since a missing row means no value, not 0. What a pick lists under `zero`, such as C2's answer and every check of L1, must be 0 everywhere, and there a missing row is fine. Those are never recorded, so RAMA is held to them too. A test with a difference is `wrong`, with the first differences.


## What it records besides time

On Linux, each test's summary has `resources`, and the result file has `env`. Both are additive: the website and the scores read neither. Without `/proc` they are left out, and `env.source` says `unavailable`. Set `FPABENCH_RESOURCES=0` to leave `resources` out and time a run without the readings.

The readings cover the runner and the processes it started, so a system that runs in the runner, such as RAMA and DuckDB, and a server it starts, such as PostgreSQL and ClickHouse, are measured the same way. The runner scans `/proc` before the test, after its setup, after its first run, after its last run and at its end, never inside the timer and never between two runs in the middle, since a scan takes 0.1 to 0.6 ms and a read can take about as long. What lies between the scans is covered by each process's own `VmHWM` (its peak resident memory), `/proc/<pid>/io` and CPU counters, which only grow. The cost of the scans has not been measured on a quiet machine, which an on or off comparison of `FPABENCH_RESOURCES` needs. [`proc.mjs`](proc.mjs) holds the code.

| Field of `resources` | What it is |
| --- | --- |
| `peakRssUpperBoundMB` | An upper bound of the peak resident memory, not a peak measured at one moment. It is the `VmHWM` of each process, reset at the start of the test through `/proc/<pid>/clear_refs`, added up over the processes. The processes peaked at different times, so the sum can be larger than any moment's total. A shared page counts once for each process that maps it, so a server of several processes, PostgreSQL, is overstated. `peakSource` says how it was read. If `clear_refs` cannot be written, it is the largest resident memory at a scan, which can miss a peak between two. |
| `rssSplitMB` | What the resident memory was made of at the scan where it was largest: `anon` (heap and stack), `file` (mapped files) and `shmem` (`RssAnon`, `RssFile` and `RssShmem` of `/proc/<pid>/status`). A file that a system maps, such as an mmap'd database, counts as `file`, not `anon`. To compare systems that hold their data differently, compare `anon`; `file` is cache the kernel can drop. It is a reading, not a peak of its own. |
| `rssMB` | Resident memory at three points: `afterSetup` (the restored snapshot, the system not started yet for R8), `afterFirstRun` and `afterLastRun`. |
| `cpuMs` | CPU time, `user` and `sys`, of the whole test: setup, runs and teardown. A process that started and ended between two scans adds nothing. |
| `involuntaryCtxSwitches` | Times the kernel took the CPU from the runner's process, a sign of other work on the machine. |
| `threads` | The most threads the runner and its processes had at one sample. |
| `io` | `readBytes` and `writeBytes` over the test (`read_bytes` and `write_bytes` of `/proc/<pid>/io`). A read the page cache served is not counted. `writeBytes` is the bytes the process dirtied, which the kernel writes out later, or never if the file is deleted first. It is not the bytes that reached the device. A process that ended between two scans is counted up to its last scan. Left out when `/proc/<pid>/io` cannot be read. |
| `diskMB` | `apparent` (bytes of the files) and `allocated` (bytes the file system gave them) of the entry's folder in `--work` at the end of the test: its database and its snapshot, not the input cells. A hard link counts once. A copy made by reflink, which shares its blocks with the original, counts in full again, so on a file system that has them the restored copy of the snapshot is counted twice and the number is larger than the space used. |

`env` holds the kernel, the CPU governor, the load average at the start and the end, the steal time (the share of the machine's CPU time, user to steal, that the virtual machine's CPUs spent waiting for the host) during the run, the type of file system of `--work` (not its device or its mount point), and the scheduling class of the runner as `ps` reports it (`FF 50` is SCHED_FIFO 50).

The snapshot that every test but L1 starts from is made again when the system's version, or the RAMA binary named by `RAMA_NODE_ADDON_BINARY`, changes, not only when its files do. The binary counts by its path, size and modification time, not its contents: a rebuild changes the time, and the contents of a file of hundreds of MB would be read at every start for no gain. Only a different build restored with the same size and time would be missed.

## Not covered yet

- Invariant I3 needs a reference for the source amounts before allocation.
- `tests.json` describes M4 in words. `model/lib/changes.mjs` writes it as model edits, and that is the reference for every system.
