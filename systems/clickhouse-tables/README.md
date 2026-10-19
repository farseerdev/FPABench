# ClickHouse, refreshed tables

ClickHouse 26.9.16.11, one server on the same machine, through [`@clickhouse/client`](https://www.npmjs.com/package/@clickhouse/client) 1.23.1 over HTTP. Every calculated variable is a table. A write adds rows to an input table, then every calculated table that reads it, directly or through other tables, is built again. The input tables are `MergeTree` tables on disk. The calculated tables are `Memory` tables, built again from the inputs whenever the server starts.

## Install

```bash
./install.sh
```

It installs the `clickhouse` binary (Homebrew on macOS, the official static build on Linux) and the Node client.

## How it runs

The adapter starts and stops its own server, with a small config in the work folder. So opening the model (test R8) includes starting the server.

The SQL comes from [`../sql/translate.mjs`](../sql/translate.mjs), the same translator the DuckDB entry uses, in ClickHouse's dialect. Reads come from [`../sql/reads.mjs`](../sql/reads.mjs).

| Step | What happens |
| --- | --- |
| Load | Create the tables, fill the dimension tables, read `cells.csv` with `file()`, then build every calculated table |
| Write | `INSERT` a new row version into each input table, then build again the calculated tables the write reaches, in dependency order |
| Read | One `GROUP BY` query. A measure is one query over the sums it needs. |
| Model change | Translate the changed model, then build again the changed tables and every table that reads them. New or moved members change the dimension lookups, so then every table is built again. |

ClickHouse has no row update that suits typed values. So each input table is a `ReplacingMergeTree(ver, is_deleted)`. A write is a row with a higher version, a delete is a row with `is_deleted = 1`, and every read of an input table uses `FINAL`. Calculated tables are `Memory` tables, made with `CREATE OR REPLACE TABLE ... ENGINE = Memory AS SELECT`. They can always be built again from the inputs, so only the inputs are written to disk.

## Settings

| Setting | Value | Why |
| --- | --- | --- |
| `join_use_nulls` | 1 | Required. With the default 0, the missing side of an outer join is 0 or `''`, and "missing" turns into 0. |
| `aggregate_functions_null_for_empty` | 1 | Required. With the default 0, a sum over no rows is 0 instead of missing. |
| `query_plan_optimize_join_order_limit` | 0 | Keeps the join order the translator writes, widest operand first. At 100m, ClickHouse's own join reordering made one statement (`Growth Bonus Plan`, 1 million rows joined to three lookups of up to 3,351 rows) run for more than 15 minutes. With this setting it takes 0.04 s. |
| `mutations_sync` | 2 | No mutations run in the tests. Set so one would finish before the next statement. |
| `fsync_after_insert`, `fsync_part_directory` | 1, on every table on disk | The method turns durability on where a system has a setting for it |
| Threads, memory | ClickHouse's defaults | |

A write is visible when the last table is built. After a restart the server builds every calculated table before the first read, so a cold read includes one full rebuild.

## Why tables and not views

ClickHouse's incremental materialized views react to inserts into one table, so they cannot follow a change through joins, or take back a value a write replaces. Plain views would give the same answers, but they are computed again inside every view that reads them, as in DuckDB.

Refreshable materialized views were tried, with the translator's `REFRESHABLE` kind. Each calculated variable became a view with `REFRESH EVERY 1 YEAR DEPENDS ON ...`, created `EMPTY`. Two things came out of it:

- `SYSTEM REFRESH VIEW` on one view does not refresh the views that depend on it. `DEPENDS ON` only orders scheduled refreshes. So the adapter would still refresh all 194 views itself, in order, with `SYSTEM REFRESH VIEW` and `SYSTEM WAIT VIEW`.
- A refresh runs without the session's settings. Each view's query must carry `join_use_nulls = 1` and `aggregate_functions_null_for_empty = 1`, or missing values turn into 0.

With both handled the answers were the same, and a full refresh took 4.2 s on a laptop against 4.25 s for rebuilding the tables. So this entry keeps the tables, which are simpler.

## Notes

- Every key column holds an integer member id instead of the member's name. The ids are in the dimension tables (`dim <Dim>`: id, name, parent ids), are given once and never change, so a new member gets the next free id. Names turn into ids when cells are loaded or written, and back into names when they are read. Loading a cell that names an unknown member fails. On a laptop, integer keys made a rebate rate write 0.92 → 0.35 s and the 10m load 7.8 → 5.6 s.
- The first translation joined each table's operands in one comma-separated `FROM`. DuckDB reorders such joins, but ClickHouse joins in the order written, and the 10m load took 307 s. The translator now writes an explicit chain of joins, widest operand first. The load took 10 s on a laptop, and DuckDB got the same SQL.
- Keeping the calculated tables in `Memory` instead of writing them as `MergeTree` parts, and reading each table straight from its operand when one operand gives every cell, cut a laptop rebuild from about 6.9 s to 3.8 s.
- The adapter knows which tables read which variables, from the formulas, and rebuilds only the ones a change reaches. It still rebuilds whole tables, not cells. On a laptop this cut a rebate rate write from 3.9 s to 0.9 s. The method may count this dependency logic as tuning. If so, this entry becomes `clickhouse-tables-tuned` and a plain full-rebuild entry is added.
