# DuckDB, tables

DuckDB 1.5.6, in process, through [`@duckdb/node-api`](https://www.npmjs.com/package/@duckdb/node-api) 1.5.6-r.1. Every calculated variable is a table. DuckDB has no incremental calculation, so a write changes an input table and then every calculated table is calculated again from the inputs. The input tables and the calculated tables are ordinary tables in one database file, and every commit is forced to disk. The results of every test that does this are marked `recalc: 'full'`, and the website shows them as "not supported - full recalc results".

## Install

```bash
./install.sh
```

## How it runs

The SQL is in [`sql/`](sql/), generated from the model by [`model/lib/sql/generate.mjs`](../../model/lib/sql/generate.mjs) with the translator [`model/lib/sql/translate.mjs`](../../model/lib/sql/translate.mjs), which both SQL entries share. [`sql/schema.sql`](sql/schema.sql) creates the tables and [`sql/calculate.sql`](sql/calculate.sql) builds every calculated table. [`sql/m1.sql`](sql/m1.sql) and [`sql/m4.sql`](sql/m4.sql) are the migrations of tests M1 and M4: only the statements that take the base model to the changed one. Run `node model/lib/sql/generate.mjs` after changing the model or the translator. `--check` fails when the files are out of date. Nothing in it is written by hand for one model. Each input variable is a table. Each calculated variable is a `CREATE OR REPLACE TABLE ... AS SELECT`, in dependency order.

| Step | What happens |
| --- | --- |
| Load | Create the tables, add the model's members and the data's own, read each input variable's file `cells/<Variable>.csv` with `read_csv`, then build every calculated table |
| Write | One small transaction: `INSERT OR REPLACE` or `DELETE` on the input tables and `calculated = false` in the one-row table `calc_state`, committed together. Then `sql/calculate.sql` builds every calculated table again, outside any transaction, one commit per table. Then `calculated = true`, a second tiny commit. |
| Read | One `GROUP BY` query. A measure is one query over the sums it needs. |
| Model change | The same three steps. The first commit holds the new input tables, if any, and `calculated = false`, with the name of the migration. Then every calculated table is built again, for the changed model. A member change updates the dimension tables in the first commit and runs `sql/calculate.sql`. |
| Open (R8) | Open the database file and read `calc_state`. When `calculated` is true, nothing is built. When it is false, a recalculation was cut short, and the open runs the pending recalculation before the first read. |

The SQL follows RAMA's rules for missing values. A missing cell is a missing row. `+` and `-` count a missing operand as 0, and the result is missing only when every operand is. `*` is missing when any operand is. `a / b` is missing when `b` is missing or 0, and a missing `a` counts as 0 in a stored variable. In a measure a missing `a` gives a missing result, as RAMA does.

## Why tables and not views

DuckDB has no materialized views and no triggers, so nothing inside DuckDB keeps a derived table current. Plain views give the same answers, but DuckDB unfolds every view below a view when it creates or reads it. On this model a view deep in the P&L took 28 s just to create, and the whole set did not finish in ten minutes. A plain-views entry needs other SQL, for example one query per read with `WITH ... AS MATERIALIZED`.

## Settings

| Setting | Value |
| --- | --- |
| Database | A file, `duckdb.db`, for the dimension, input and calculated tables. Each commit is forced to disk, so what a write or a recalculation commits is durable. |
| Threads, memory | DuckDB's defaults |
| Recalculation | After the input change, outside any transaction, one commit per calculated table. A one-row table, `calc_state` (`calculated`, `script`), says whether the calculated tables are current. A write, an increment load (L2), a master data change (L3) and a model change (M1 to M4) commit their input change together with `calculated = false`, and commit `calculated = true` after the last table. |

The inputs are durable as soon as the first commit returns. A crash or a kill in the recalculation leaves `calculated = false`, and the next open calculates every table again before the first read, so after a crash the first open pays one full recalculation (about the cost of one write). A reader never sees a half-built state as valid: a read happens after the write has returned, which is when `calculated` is true, and a start that finds it false repairs the tables first. The load (L1) ends with `calculated = true`, and R8 opens the snapshot, which has it true, so R8 normally builds nothing.

A single transaction around the input change and the whole recalculation was tried, and it was too slow to use. On an n2d-standard-4 (4 vCPU) one recalculation took about 271 s inside `BEGIN ... COMMIT` (463 s with `threads = 1`), against 3.7 to 4.0 s outside a transaction, on a copy of the L1 snapshot at 10m. On a 24-core machine the transaction cost 17 to 28 s. That is the measurement. The cause is not claimed beyond it: the time is in the statements of the recalculation, and it grows as cores get fewer. A 10m run would have taken about 20 hours, so the entry uses the marker.

## Caveats

Two minus points of DuckDB, and the workaround they made necessary:

- Recalculating the derived tables inside one transaction costs far more than outside it. Measured on an n2d-standard-4 (4 vCPU), on a copy of the 10m snapshot: about 271 s per recalculation inside `BEGIN ... COMMIT`, 463 s with `threads = 1`, and about 4 s with each statement committing by itself. On a 24-core machine it took 17 to 28 s inside a transaction. The time is CPU, there is no I/O wait. The cause is not established.
- DuckDB commits each statement by itself and has no materialized views or triggers, so there is no way to refresh derived tables atomically with the input write without paying the cost above. The choice is atomic and slow, or fast and not atomic: a crash between the input commit and the end of the recalculation leaves stale derived tables.
- So the entry carries the `calc_state` table and recalculates on open after a crash, as described under Settings.

## Notes

- Every key column holds an integer member id instead of the member's name. The ids are in the dimension tables (`dim <Dim>`: id, name, parent ids), are given once and never change, so a new member gets the next free id. Names turn into ids when cells are loaded or written, and back into names when they are read. Loading a cell that names an unknown member fails. On a laptop, integer keys made a rebate rate write 0.43 → 0.11 s and the 10m load 3.7 → 2.4 s.
- The translator reads a table straight from its operand when one operand gives every cell, and builds the dimension lookups once per calculation.
- DuckDB has no incremental calculation, so this entry does not pretend to have one. It does not keep the calculated tables in memory, and it does not calculate only the tables a write reaches. That would stand in for a missing feature, and [the method](../../tests/method.md#systems-without-incremental-calculation) does not allow it. Every write, load of new data and model change runs all of `sql/calculate.sql`, and its tests are marked `recalc: 'full'`. The numbers stay in the scores as measured. The generator still writes the dependency lists in `sql/base.json`, but nothing in this entry uses them.
- The marker is not a transaction around the recalculation. Between the first commit and the last, a concurrent reader would see old calculated tables next to new inputs. The benchmark has no concurrent reader, and a process that died there is repaired on the next open.
- At 10m every calculated cell of all 167 calculated variables matched RAMA after the load.
