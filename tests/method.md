# How FPABench measures

Version 0.8-draft. The method will change before version 1. Every change is listed in [CHANGELOG.md](../CHANGELOG.md).

## The runner

One runner runs every [test](README.md) on every system. Each system plugs in through a small adapter. The adapter starts and stops the system, loads files, writes cells, reads results and changes the model.

An entry is a system plus one way of running it. For example, a database can have one entry that computes on read and another that stores results.

## Timing

The runner times everything itself, with a monotonic clock. It never uses times a system reports.

| Test kind | Timer starts | Timer stops |
| --- | --- | --- |
| Read | Before the request | When the whole answer is in the runner's memory |
| Write | Before the write | When the proving read returns the new value |
| Load | When the system starts reading the files | When the proving read returns and `sync` has finished |
| Model change | Before the change | When the proving read returns the new value |

- Before the proving read, the runner waits for the system's own signal that a write is visible. One example is `FLUSH` in RisingWave. A system with no signal is polled every 1 ms at most.
- The proving read reads a total that depends on the change. It never just reads back the cell that was written.
- The runner also records when the write was acknowledged.
- A model change includes any compile or reload the system needs.
- Some systems start background work after a statement, such as compiling its plan. The runner waits until that work is done after each restore and after the cold run of R1 to R7. It also waits just before L2, L3, a bulk write, a model change or the first timed write of a write test. The adapter's `settle()` says when. It only waits, and must not start work of its own. The wait is not timed. So the warm reads and these timed runs start with the system at rest. The cold read, the warm-up write, loads, bulk writes, model changes and R8 still pay for the first run of their statements.

## Durability and tags

A durable write survives a crash. Here that means the system forces the write to disk before it says the write is done, so the write survives a crash of the system or of the operating system. The run machine keeps every system's files on a local SSD, which Google does not keep through a host failure or a stop of the VM. So `durable` does not cover those. Where a system has a setting for this, its entry turns it on. Every result is tagged `durable` or `non-durable`.

Embedded systems run inside the runner's process. Servers pay for a network round trip. Both share one table, tagged `embedded` or `server`.

## Reset

- After the load, the runner copies each system's data folder as a snapshot. It restores the snapshot before each test.
- Each repeat writes a new value to a new cell. The runner tracks its changes, so it always knows the expected answer.
- A rollback is never used to reset, because a rollback skips the commit.

## The machine

Every result comes from one Google Cloud `n2d-standard-4`: 4 vCPUs and 16 GB of memory. It boots from an SSD persistent disk and has one local NVMe SSD of 375 GB. The data, every system's files, its snapshot and any Docker storage go on the local SSD, so no system runs out of disk. It is small on purpose, because memory often decides whether a model fits. This choice is not final until every system has had a trial run.

- The runner and the system share the machine, and there are no other limits.
- No system gets a thread or core limit. Each keeps its default thread setting, so it can use all 4 vCPUs. Each result file records this as `"threads": "default"`.
- A system that runs out of memory at a size has no result at that size.
- Each result records peak memory, CPU time and thread count.
- The 10m and 100m sizes run every test. Larger sizes run loads and reads only, for now.

## Repeats

| Test kind | Runs | Reported |
| --- | --- | --- |
| Read | 1 cold, after a restart and a cleared OS cache. Then 5 warm. | Cold time, and median warm time |
| Single-cell write | 20, each on a new cell, after 1 warm-up. Fewer if a test has fewer cells. | Median and 95th percentile |
| Bulk write, load, model change | 3, each from the snapshot | Median |

Reads run in a random order from a fixed seed. Every raw time is published.

## Scores

```
score = (c + t) / (c + best)
```

`t` is the system's time and `best` is the fastest system's time. `c` is 10 ms, so differences no user could feel don't count as big ratios. Lower is better, and 1 is the best.

- Each system gets four scores, one each for loads, writes, reads and model changes. Each is the geometric mean of its test scores. There is no combined score.
- Absolute times are always shown next to the scores.
- A failed, timed-out or wrong test counts as twice the largest of three times. These are 300 s, the system's slowest warm time on any test, and the slowest success of any system on that test.

These follow ClickBench. The 10 ms constant will be reviewed once there are real results.

## Caches and stored results

Planning engines keep results up to date, so stored results are allowed. This covers materialized views, incremental views and stored totals. Their build and upkeep time counts inside the timed loads and writes. They must be correct after every write. APB-1, TPC-DS and LDBC use the same rule. ClickBench does not allow stored results.

OS caches, buffer pools, compiled plans and prepared statements are also allowed.

A cache of answers keyed on a read's text or parameters is not allowed. Neither is anything built for one test's read. The runner also makes unpublished reads to catch this.

## Fair comparison

- Use default settings, changed only where a system cannot run without it. A tuned setup is its own entry, such as `DuckDB-tuned`.
- Settings stay the same for the whole run. There are no per-test settings or query hints.
- Use only released versions and documented features.
- Every system runs the same model on the same files. Each result records the model version and a hash of its files.
- Published runs use a public seed. A check run uses a second, unpublished one.
- Everything needed to rerun is in this repo. Each system's makers may review its entry before results are published.
- Farseer makes FPABench and RAMA, one of its systems. RAMA follows the same rules.
- A system whose licence forbids published results can still have an entry with no results.

## Correctness

- **Reference answers.** A plain JavaScript program computes exact answers. It shares no code with any system and covers the 10m size.
- **Rules at every size.** Every check equals its published value. The P&L lines add up to EBIT. EBIT equals the source amounts. Each cost pool equals what it allocated plus what it could not place. Closed months equal the actuals.
- **Stated deltas.** A write or model change must move a result by exactly what its test states.
- **Unchanged values.** Each write and model change checks a value it cannot reach.

The proving read is checked during the run. Full answers are compared after the timer stops, member by member.

Amounts must match within 0.01 or a relative 1e-9, whichever is larger. Ratios must match within a relative 1e-6.
