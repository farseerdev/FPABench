# PostgreSQL, refreshed tables

PostgreSQL 18.6, one server on the same machine, through [`pg`](https://www.npmjs.com/package/pg) (node-postgres) 8.23.1 over TCP. Every calculated variable is a table. A write changes an input table, then every calculated table that reads it, directly or through other tables, is built again. The input tables are ordinary tables. The calculated tables are `UNLOGGED` tables. A clean stop keeps them, and after a crash they are built again from the inputs.

## Install

```bash
./install.sh
```

It installs PostgreSQL 18 (from the PostgreSQL apt repository on Debian and Ubuntu, Homebrew on macOS) and the Node client. The tests look for the server's programs in `POSTGRES_BIN`, then in the folders those packages use, then on the `PATH`.

## How it runs

The tests make their own data folder with `initdb` in the work folder, and start and stop their own server on port 15432 (`FPABENCH_POSTGRES_PORT`). L1's `initdb` is in its untimed setup. Opening the model (test R8) includes starting the server.

The SQL is in [`sql/`](sql/), generated from the model by [`model/lib/sql/generate.mjs`](../../model/lib/sql/generate.mjs) with the translator [`model/lib/sql/translate.mjs`](../../model/lib/sql/translate.mjs), which every SQL entry shares. [`sql/schema.sql`](sql/schema.sql) creates the tables and [`sql/calculate.sql`](sql/calculate.sql) builds every calculated table. [`sql/m1.sql`](sql/m1.sql) and [`sql/m4.sql`](sql/m4.sql) are the migrations of tests M1 and M4. Run `node model/lib/sql/generate.mjs` after changing the model or the translator. Reads come from [`model/lib/sql/reads.mjs`](../../model/lib/sql/reads.mjs).

| Step | What happens |
| --- | --- |
| Load | Create the tables, add the model's members and the data's own, `COPY` each input variable's file `cells/<Variable>.csv` into a temporary table on the server and insert it by member id, then build every calculated table. L1's tables are empty, so it inserts with [`sql/load/`](sql/load/), a plain `INSERT`. L2 inserts with [`sql/import/`](sql/import/), whose `ON CONFLICT` replaces a cell that is there already. |
| Write | `INSERT ... ON CONFLICT DO UPDATE` on the input tables, then build again the calculated tables the write reaches, in dependency order |
| Read | One `GROUP BY` query. A measure is one query over the sums it needs. |
| Model change | Translate the changed model, then build again the changed tables and every table that reads them. New or moved members change the dimension lookups, so then every table is built again. |

The translator writes the same SQL as for DuckDB, with four differences. PostgreSQL has no `CREATE OR REPLACE TABLE`, so each calculated table is dropped and created. It has no `ASOF JOIN` and no `IGNORE NULLS`, so `cumsum` uses `lead()`. Each value of the variable holds from its own month up to the month before its next value, and `generate_series()` lists those months. Each table is `ANALYZE`d right after it is built. A new table has no statistics until autovacuum gets to it, and the planner then picks nested loops over tables of millions of rows: at 10m a full rebuild took 76 s without it. The 48-row `period` table is analyzed too, since autovacuum never analyzes a table that small. And the calculated tables have autovacuum off. A rebuild leaves no dead rows and analyzes each table itself, and autovacuum running after a rebuild made the next write wait for it.

A run of several statements in one call is one transaction in PostgreSQL. So a rebuild commits once, and a reader sees every table of it or none.

`COPY` needs a column list in the file's order, and the files list a cell's dimensions in their own order. So each statement of the load that reads a file starts with a line `-- @csv <file>`, and `db.mjs` makes the temporary table `csv` from that file's header line before it runs the statement. A name a dimension does not have stops the load through `fpabench_error()`, a one-line function the load creates, as DuckDB's `error()` does.

The SQL follows RAMA's rules for missing values, as in the DuckDB entry.

## Settings

| Setting | Value |
| --- | --- |
| Server | Every setting is the default `initdb` writes: `shared_buffers` 128 MB, `work_mem` 4 MB, parallel query on. Only the port and listen address are set, on the command line. |
| `initdb` | `-E UTF8 --no-locale`: UTF-8 with the C locale, so text sorts by byte, as in DuckDB |
| Durability | `fsync` and `synchronous_commit` on, the defaults, so every commit of an input is forced to disk. The calculated tables are `UNLOGGED`: they skip the write-ahead log, because they can always be built again from the inputs. L1 ends with a `CHECKPOINT`, as DuckDB's does. |
| Autovacuum | On, the default, except on the calculated tables, which are made `WITH (autovacuum_enabled = false)` |
| Threads, memory | PostgreSQL's defaults |

A write is visible when the last table is built. A clean stop keeps the `UNLOGGED` calculated tables, so after a restart the server answers from them at once, and R8 times the start and the read. Each full rebuild ends with one row in the `UNLOGGED` table `fpabench_calculated`. Crash recovery empties every `UNLOGGED` table, that one too, so a start that finds no row builds every calculated table again before the first read.

## Notes

- Keys are integer member ids, as in the other SQL entries. Versions, Years and Months are `SMALLINT`, since PostgreSQL has no one-byte integer.
- The input tables have their primary key, which `ON CONFLICT` needs. The calculated tables have no index. Every read scans a table.
- The generator knows which tables read which variables. `sql/rebuild/<Variable>.sql` rebuilds only the tables a write to that variable reaches. It still rebuilds whole tables, not cells.
- With the default `work_mem` of 4 MB, large sorts and hashes spill to disk. A tuned setup would raise it and `shared_buffers`, and would be its own entry, `postgres-tables-tuned`.
