# RAMA

RAMA is Farseer's engine. Farseer makes FPABench, so this entry gets the same rules as every other one. Any tuning goes in a separate `rama-tuned` entry.

RAMA is not open source. Its Node package is in Farseer's private npm registry, so outside Farseer this entry cannot be installed yet. The package downloads its binary for each platform from a public bucket.

## Install

```bash
./install.sh
```

The script installs `@farseer/rama` 1.9.0-ffad51e.0 from Farseer's registry. On Ubuntu 24.04 it also installs `libatomic1` and the `libstdc++6` of GCC 16 from the Ubuntu toolchain PPA, because the binary needs `GLIBCXX_3.4.34`. Farseer runs RAMA on the same GCC 16 runtime. On Ubuntu 26.04 the binary runs as it is, with no extra packages.

## How it runs

The tests in `tests/` make the calls the Farseer backend makes, in process, through the Node addon. `db.mjs` holds what they share.

| Step | Call |
| --- | --- |
| Load | One `modelImport` for the dimensions and the variables, without cells. Then `importCellsFromCsvFile`, the native cell import, with every input cell streamed from the cell files. Its commit calculates every formula the cells reach, which is the whole model. Until 2026-10-21 the load also called `recalc()` after it, which calculated the whole model a second time: at 100m on a laptop 40 s instead of 28 s, with the same answers. Until 2026-10-19 the cells went inside the variables' `modelImport` JSON, and at 1b that JSON did not fit in 12 GB of Node heap. |
| Write | `updateCells` with one `sum(...)` formula per cell, then `commit` |
| Write to a read-only variable | `importCellsFromCsvFile`, the native path of a data import. `updateCells` refuses read-only cells. |
| Read | `generateCombinations` lists the combinations of the `by` members that have a value, then one `query` call reads them. A Farseer sheet lists its rows with data the same way. A measure has no stored cells to list, so a measure read asks for every combination the filters allow. |
| Model change | `modelImport` of the changed members and variables, then `commit`. The commit updates every cell that depends on a changed formula. Until 2026-10-12 the load also called `recalc()`, which recalculates the whole model and took M1 from 1.9 s to 3.1 s on a laptop, with the same answers. |

The JSON `modelImport` takes is made ahead from the model by [`model/lib/rama/generate.mjs`](../../model/lib/rama/generate.mjs), into `model/` here. It is the JSON the backend sends when a model is pushed. `model.json` holds every dimension table with the members the model brings, Versions and Years included, and every variable. L1 adds the data's own members from the dataset's `dimensions/` files and sends it all in one `modelImport`. RAMA's built-in `Plan` version stays, with no cells. `m1.json` and `m4.json` hold only what tests M1 and M4 change. Run `node model/lib/rama/generate.mjs` after a model change, and `--check` to see that the files are current.

## Settings

| Setting | Value | Why |
| --- | --- | --- |
| Binary | `rama.node`, the release build | The package loads its slower dev build unless told otherwise |
| Commits | Durable (`commit(checksum, true)`) | The backend's default. The method turns durability on where a system has it. |
| Abakus | On | As in the backend |
| Threads | RAMA's default | |
| Versions | The five the data uses, and RAMA's built-in `Plan` | RAMA seeds a `Plan` version. It stays, with no cells, so no answer changes. |

A write is visible when `commit` returns. RAMA recalculates the cells the write reaches during the commit.

## Notes

- Until 2026-10-12 a read asked for every combination of the `by` members that the filters allowed, and dropped the empty ones. R5 then asked for about 15,000 cells on one group to find 63. With `generateCombinations` the same read asks for the 63.
- The first two writes after a restart take seconds. Later ones settle at 0.1 to 0.3 s. The runner reports the first write of each group apart, as a warm-up.
