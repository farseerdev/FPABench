# RAMA

RAMA is Farseer's engine. Farseer makes FPABench, so this entry gets the same rules as every other one. Any tuning goes in a separate `rama-tuned` entry.

RAMA is not open source. Its Node package is in Farseer's private npm registry, so outside Farseer this entry cannot be installed yet. The package downloads its binary for each platform from a public bucket.

## Install

```bash
./install.sh
```

The script installs `@farseer/rama` 2.0.0-7528851.0 from Farseer's registry. On Ubuntu 24.04 it also installs `libatomic1` and the `libstdc++6` of GCC 16 from the Ubuntu toolchain PPA, because the binary needs `GLIBCXX_3.4.34`. Farseer runs RAMA on the same GCC 16 runtime. On Ubuntu 26.04 the binary runs as it is, with no extra packages.

## How it runs

Every call on a database is one command: a JSON body run through `Database.runCommand`, in process, through the Node addon. These are the bodies the Farseer backend sends, and `runCommand` is the entry newer RAMA builds have for them. `db.mjs` holds what the tests share.

| Step | Command |
| --- | --- |
| Load | One `MODEL_IMPORT` for the dimensions and the variables, without cells. Then `IMPORT_CELLS`, the native cell import, with every input cell streamed from the cell files. Its commit calculates every formula the cells reach, which is the whole model. Until 2026-10-21 the load also called `recalc()` after it, which calculated the whole model a second time: at 100m on a laptop 40 s instead of 28 s, with the same answers. Until 2026-10-19 the cells went inside the variables' model import JSON, and at 1b that JSON did not fit in 12 GB of Node heap. |
| Write | `UPDATE_CELLS` with one `sum(...)` formula per cell |
| Write to a read-only variable | `IMPORT_CELLS`, the native path of a data import. `UPDATE_CELLS` refuses read-only cells. |
| Read | With `by` members, one `GROUPED_READ` gives the groups that have a value, each folded by the variable's rollup in one scan. A Farseer sheet lists its rows with data the same way. Without `by`, one `EVALUATE` reads the cell. A measure has no stored cells to group, so a measure read asks for every combination the filters allow. |
| Model change | `MODEL_IMPORT` of the changed members and variables. Its commit updates every cell that depends on a changed formula. Until 2026-10-12 the load also called `recalc()`, which recalculates the whole model and took M1 from 1.9 s to 3.1 s on a laptop, with the same answers. |

A write command runs in a transaction of its own and commits to disk before it answers. So a test that makes two writes makes two commits: L2 imports the month's cells and then types the two flags, and M2 adds the customer and then types its volume. Until 2026-11-19 each of the two did both in one transaction, with one commit.

`MODEL_IMPORT` and `IMPORT_CELLS` name a file by its path, as the backend does after it has fetched an upload. So the model JSON is written to a file in the work folder before the command runs: in setup for a model change, and inside the timer for L1, where making the JSON is part of the load. RAMA reads the file inside the timer. Until 2026-11-19 the JSON text was handed over in memory, and M2 and M3 made it inside the timer.

The names the commands need, such as the gid of a variable or of a member, come from `GET_DTABLES` and `GET_VARIABLES`, once per open, when first needed. The untimed checks read every stored cell of a `CHECK` variable with `EXPORT_CELLS`.

The JSON `MODEL_IMPORT` takes is made ahead from the model by [`model/lib/rama/generate.mjs`](../../model/lib/rama/generate.mjs), into `model/` here. It is the JSON the backend sends when a model is pushed. `model.json` holds every dimension table with the members the model brings, Versions and Years included, and every variable. L1 adds the data's own members from the dataset's `dimensions/` files and sends it all in one `MODEL_IMPORT`. RAMA's built-in `Plan` version stays, with no cells. `m1.json` and `m4.json` hold only what tests M1 and M4 change. Run `node model/lib/rama/generate.mjs` after a model change, and `--check` to see that the files are current.

`db.mjs` keeps the commands apart from the way they reach RAMA. The tests call `session()`'s functions, and `session()` only needs a function that runs one command body and gives its answer. Here that function is the addon's `runCommand`. An entry that reaches RAMA another way, such as a server, needs only another such function.

## Settings

| Setting | Value | Why |
| --- | --- | --- |
| Binary | `rama.node`, the release build | The package loads its slower dev build unless told otherwise |
| Commits | Durable | A write command always commits to disk before it answers. The method turns durability on where a system has it. |
| Abakus | Always on | RAMA 2.0 has no other engine, so it has no switch |
| Threads | RAMA's default | |
| Versions | The five the data uses, and RAMA's built-in `Plan` | RAMA seeds a `Plan` version. It stays, with no cells, so no answer changes. |

A write is visible when its command answers. RAMA recalculates the cells the write reaches during the commit.

## Notes

- Until 2026-10-12 a read asked for every combination of the `by` members that the filters allowed, and dropped the empty ones. R5 then asked for about 15,000 cells on one group to find 63. With `generateCombinations` the same read asks for the 63.
- The first two writes after a restart take seconds. Later ones settle at 0.1 to 0.3 s. The runner reports the first write of each group apart, as a warm-up.
