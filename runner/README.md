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
| `--machine` | The machine, as it goes in the results, such as `n2d-standard-4, local NVMe SSD`. A published result goes in `results/<machine>/<size>/`, with the machine in lower case and hyphens: `results/n2d-standard-4-local-nvme-ssd/10m/rama.json`. |
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


## Not covered yet

- Invariant I3 needs a reference for the source amounts before allocation.
- `tests.json` describes M4 in words. `model/lib/changes.mjs` writes it as model edits, and that is the reference for every system.
