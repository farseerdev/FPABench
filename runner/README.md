# The runner

Draft. It runs the tests in [`tests/tests.json`](../tests/tests.json) against one system and writes the times, the checks and every answer. It is the same for every system. [`tests/method.md`](../tests/method.md) says how each kind of test is timed, repeated and reset.

## Run it

```bash
node data/generate.mjs --size 10m --out ~/data/fpabench-10m
node runner/run.mjs --entry rama --dataset ~/data/fpabench-10m --work ~/run/work --out ~/run/out --picks ~/run/picks.json --machine n2d-standard-4
node runner/run.mjs --entry duckdb-tables --dataset ~/data/fpabench-10m --work ~/run/work --out ~/run/out --picks ~/run/picks.json --machine n2d-standard-4
node runner/compare.mjs ~/run/out
```

Each system must be installed first. See its folder in [`systems/`](../systems/).

| Option | What it does |
| --- | --- |
| `--entry` | The folder in `systems/` to run |
| `--dataset` | A dataset written by `data/generate.mjs` |
| `--work` | Scratch space: the input cells, the system's files and the snapshot. All of them are kept per dataset, by the SHA-256 of its manifest. |
| `--out` | Where `<entry>.json`, `<entry>.answers.json` and `<entry>.log` go |
| `--picks` | The cells and values the tests write. The first system to run saves them. Every later system reads them, so all systems write the same cells. A picks file made for another dataset or seed is refused. |
| `--tests` | Only these tests, such as `L1,W1,R1`. They are added to the results already in `--out`. Without L1, the runner uses the snapshot of this dataset, or loads once to make one, untimed. |
| `--machine` | The machine type, as it goes in the results |
| `--seed` | The seed for picks. The default is the one in `tests.json`. |
| `--quick` | One run of everything and two writes per test, to try the runner. Not for results. |

On Linux the runner drops the OS cache before a cold read with `sudo -n`. Without passwordless sudo the result notes that the cache was not dropped.

## What it does

1. It turns the dataset into input cells with `data/cells.mjs`, once. Every system loads the same `cells.csv`. This step is not timed.
2. L1 loads three times from empty. After the last load the runner stops the system and copies its files. That copy is the snapshot.
3. Every other test starts from the snapshot. A write test writes once to warm up, then 20 times. The cells come from the seed in one shuffled order, so every write takes a fresh cell. When fewer cells fit the pick rule, the test writes fewer times and its result says so. A bulk write, a later load and a model change run three times, each from the snapshot. A read runs once cold, after a restart and an OS cache drop, then five times warm.
4. The timer runs here, from just before the action to the end of the proving read. A load's timer also waits for `sync`. A write result also has the two parts: the write until the system says it is done, and the proving read.
5. At sizes where the method runs loads and reads only, the runner leaves out every other test. `tests.json` still names sizes SF1 to SF1000, so the runner reads SF1, SF10, SF100 and SF1000 as 10m, 100m, 1b and 10b.

## Checks

The runner checks every expectation it can state on its own: deltas, values that must not move, cells that must equal what was typed, the model's checks, and invariants I1, I2, I4 and I5. A test that fails one of them is `wrong`. I1 and C2 look at every stored cell of every check, so errors of opposite sign cannot cancel in a total. A W1 write that moves another country's EBIT fails W1 as well as C3.

A `value` expectation needs a reference program, and there is none yet. So the runner saves every answer, and `compare.mjs` compares the answers of all systems, test by test and run by run, within the tolerances of `tests.json`. Ratios also get an absolute floor of 1e-12, so a 0 against 5e-19 is not a difference. A test whose answers differ is marked `wrong` in each system, with the first differences. A test with several answers, such as M2 and its EBIT, is wrong when any of them differs. Until there is a reference, two systems built in different ways that give the same answer stand in for it.

## The adapter

A system plugs in through `systems/<entry>/adapter.mjs`. It exports `create({ work, model })`, which returns:

| Member | What it does |
| --- | --- |
| `name`, `version`, `settings` | What goes in the results |
| `load(cellsDir)` | Builds the system from empty and loads every input cell. Done when every value is current. |
| `open()`, `close()` | Start and stop. `close()` must leave everything on disk. |
| `dataDirs()` | The files and folders the snapshot copies |
| `cells(variable)` | Every stored cell of a variable, as rows `{ key, value }`. For the checks, not timed. |
| `read({ variable, by, where })` | Rows `{ key, value }` of a variable summed over `by`, or averaged when its rollup is average. A measure is computed at that slice. `where` values may be lists. |
| `write(cells)` | Writes `{ variable, at, value }` cells in one transaction. Done when every value is current. |
| `loadCells(cellsDir, { cells })` | Loads more input cells on top, and `cells` with them |
| `changeModel({ model, members, variables, cells })` | Applies a changed model: new or moved members, new or changed variables, and cells to write with them |
| `setModel(model)` | Points the adapter at the model again after a restore. It changes nothing in the system. |

## Not covered yet

- W8 is skipped when no customer group fits its pick rule. The rule needs a growth bonus rate above 0 in FC 6+6.
- W9 waits on the model.
- Invariant I3 needs a reference for the source amounts before allocation.
- `tests.json` describes M4 in words. `lib/changes.mjs` writes it as model edits, and that is the reference for every system.
