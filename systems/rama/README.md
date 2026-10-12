# RAMA

RAMA is Farseer's engine. Farseer makes FPABench, so this entry gets the same rules as every other one. Any tuning goes in a separate `rama-tuned` entry.

RAMA is not open source. Its Node package is in Farseer's private npm registry, so outside Farseer this entry cannot be installed yet. The package downloads its binary for each platform from a public bucket.

## Install

```bash
./install.sh
```

The script installs `@farseer/rama` 1.9.0-ffad51e.0 from Farseer's registry. On Ubuntu 24.04 it also installs `libatomic1` and the `libstdc++6` of GCC 16 from the Ubuntu toolchain PPA, because the binary needs `GLIBCXX_3.4.34`. Farseer runs RAMA on the same GCC 16 runtime.

## How it runs

`adapter.mjs` makes the calls the Farseer backend makes, in process, through the Node addon.

| Step | Call |
| --- | --- |
| Load | One `modelImport` for the dimensions, one for the variables with their cells, then `recalc` |
| Write | `updateCells` with one `sum(...)` formula per cell, then `commit` |
| Write to a read-only variable | `importCellsFromCsvFile`, the native path of a data import. `updateCells` refuses read-only cells. |
| Read | `generateCombinations` lists the combinations of the `by` members that have a value, then one `query` call reads them. A Farseer sheet lists its rows with data the same way. A measure has no stored cells to list, so a measure read asks for every combination the filters allow. |
| Model change | `modelImport` of the changed members and variables, then `recalc` |

`payload.mjs` turns the model and the input cells into the JSON `modelImport` takes. That is the JSON the backend sends when a model is pushed.

## Settings

| Setting | Value | Why |
| --- | --- | --- |
| Binary | `rama.node`, the release build | The package loads its slower dev build unless told otherwise |
| Commits | Durable (`commit(checksum, true)`) | The backend's default. The method turns durability on where a system has it. |
| Abakus | On | As in the backend |
| Threads | RAMA's default | |
| Versions | The five the data uses | RAMA seeds a `Plan` version. The adapter removes it, as the data does not use it. |

A write is visible when `commit` returns. RAMA recalculates the cells the write reaches during the commit.

## Notes

- Until 2026-10-12 a read asked for every combination of the `by` members that the filters allowed, and dropped the empty ones. R5 then asked for about 15,000 cells on one group to find 63. With `generateCombinations` the same read asks for the 63.
- The first two writes after a restart take seconds. Later ones settle at 0.1 to 0.3 s. The runner reports the first write of each group apart, as a warm-up.
