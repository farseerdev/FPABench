# DuckDB, refreshed tables

DuckDB 1.5.6, in process, through [`@duckdb/node-api`](https://www.npmjs.com/package/@duckdb/node-api) 1.5.6-r.1. Every calculated variable is a table. A write changes an input table, then every calculated table that reads it, directly or through other tables, is built again. The input tables are in a database file. The calculated tables are `TEMP` tables in memory, built again from the inputs whenever DuckDB starts.

## Install

```bash
./install.sh
```

## How it runs

[`../sql/translate.mjs`](../sql/translate.mjs) turns the model into SQL. The ClickHouse entry uses the same translator. Nothing in it is written by hand for one model. Each input variable is a table. Each calculated variable is a `CREATE OR REPLACE TEMP TABLE ... AS SELECT`, in dependency order.

| Step | What happens |
| --- | --- |
| Load | Create the tables, fill the dimension tables, read `cells.csv` with `read_csv`, then build every calculated table |
| Write | `INSERT OR REPLACE` or `DELETE` on the input tables in one transaction, then build again the calculated tables the write reaches, in dependency order |
| Read | One `GROUP BY` query. A measure is one query over the sums it needs. |
| Model change | Translate the changed model, then build again the changed tables and every table that reads them. New or moved members change the dimension lookups, so then every table is built again. |

The SQL follows RAMA's rules for missing values. A missing cell is a missing row. `+` and `-` count a missing operand as 0, and the result is missing only when every operand is. `*` is missing when any operand is. `a / b` is missing when `b` is missing or 0, and a missing `a` counts as 0 in a stored variable. In a measure a missing `a` gives a missing result, as RAMA does.

## Why tables and not views

DuckDB has no materialized views and no triggers, so nothing inside DuckDB keeps a derived table current. Plain views give the same answers, but DuckDB unfolds every view below a view when it creates or reads it. On this model a view deep in the P&L took 28 s just to create, and the whole set did not finish in ten minutes. A plain-views entry needs other SQL, for example one query per read with `WITH ... AS MATERIALIZED`.

## Settings

| Setting | Value |
| --- | --- |
| Database | A file, `duckdb.db`, for the dimension and input tables. Each commit is forced to disk, so writes are durable. The calculated tables are `TEMP` tables, because they can always be built again from the inputs. Writing them to the file doubled the rebuild time. |
| Threads, memory | DuckDB's defaults |
| Rebuild | Outside the write's transaction. Inside one transaction DuckDB keeps every replaced table until the commit. At 10m on a laptop one write then took 14.6 s and 19 GB instead of 5.9 s and 1 GB. |

A write is visible when the last table is built. After a restart DuckDB builds every calculated table before the first read, so a cold read includes one full rebuild.

## Notes

- Every key column holds an integer member id instead of the member's name. The ids are in the dimension tables (`dim <Dim>`: id, name, parent ids), are given once and never change, so a new member gets the next free id. Names turn into ids when cells are loaded or written, and back into names when they are read. Loading a cell that names an unknown member fails. On a laptop, integer keys made a rebate rate write 0.43 → 0.11 s and the 10m load 3.7 → 2.4 s.
- The translator reads a table straight from its operand when one operand gives every cell, and builds the dimension lookups once per rebuild. Before these two changes and the `TEMP` tables, one rebuild took 5.2 s on a laptop. After, 2.1 s.
- The adapter knows which tables read which variables, from the formulas, and rebuilds only the ones a change reaches. A typed volume reaches 88 of 167 tables, an office's cost 25. It still rebuilds whole tables, not cells. On a laptop this cut a rebate rate write from 2.2 s to 0.4 s. The method may count this dependency logic as tuning. If so, this entry becomes `duckdb-tables-tuned` and a plain full-rebuild entry is added.
- At 10m every calculated cell of all 167 calculated variables matched RAMA after the load.
