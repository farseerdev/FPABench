# How FPABench measures

Version 0.9-draft. The method will change before version 1. Every change is listed in [CHANGELOG.md](../CHANGELOG.md).

## The runner

One runner runs every [test](README.md) on every system. Each system has one file per test, written in its own calls: SQL for the SQL systems, the addon's calls for RAMA. The runner times each test the same way and checks its answers.

An entry is a system plus one way of running it. For example, a database can have one entry that computes on read and another that stores results.

## Timing

The runner times everything itself, with a monotonic clock. It never uses times a system reports.

| Test kind | Timer starts | Timer stops |
| --- | --- | --- |
| Read | Before the request | When the whole answer is in the runner's memory |
| Write | Before the write | When the proving read returns the new value |
| Load | When the system starts reading the files | When the proving read returns and `sync` has finished |
| Model change | Before the change | When the proving read returns the new value |

- Before the proving read, the runner waits for the system's own signal that a write is visible. A system with no signal is polled every 1 ms at most.
- The proving read reads a total that depends on the change. It never just reads back the cell that was written.
- The runner also records when the write was acknowledged.
- A model change includes any compile or reload the system needs.
- Some systems start background work after a statement, such as compiling its plan. A system's test waits for that work in its untimed setup, if the system has any. The warm-up write, loads, bulk writes, model changes and R8 still pay for the first run of their statements.

## Durability and tags

A durable write survives a crash. Here that means the system forces the write to disk before it says the write is done, so the write survives a crash of the system or of the operating system. The run machine keeps every system's files on a local SSD, which Google does not keep through a host failure or a stop of the VM. So `durable` does not cover those. Where a system has a setting for this, its entry turns it on. Every result is tagged `durable` or `non-durable`.

Embedded systems run inside the runner's process. Servers pay for a network round trip. Both share one table, tagged `embedded` or `server`.

## Reset

- After the load, the runner copies each system's data folder as a snapshot. It restores the snapshot before each test.
- Each repeat writes a new value to a new cell. The cells and values come with the dataset, in `picks.json`.
- A rollback is never used to reset, because a rollback skips the commit.

## The machine

Every result names its machine, as in ClickBench. The published rankings compare systems on the reference machines below. The website also lets the reader tick several machines and compare across them. Every size gets 4 vCPUs of the same CPU series, so times can be compared across sizes. Only the memory grows with the data. A result from any other machine can be published too, in its own machine's folder of `results/`. 

| Size | Machine | vCPUs | Memory |
| --- | --- | ---: | ---: |
| 10m, 100m | `n2d-standard-4` | 4 | 16 GB |
| 1b | `n2d-custom-4-65536-ext`, a custom N2D with extended memory | 4 | 64 GB |
| 10b | Not chosen yet | 4 | |

At 1b RAMA and DuckDB each needed about 42 to 44 GB, so 16 GB is too small there, and 64 GB leaves room. The machine boots from an SSD persistent disk and has one local NVMe SSD of 375 GB. The data, every system's files, its snapshot and any Docker storage go on the local SSD, so no system runs out of disk. Each machine is small on purpose, because memory often decides whether a model fits. This choice is not final until every system has had a trial run.

- The runner and the system share the machine, and there are no other limits.
- No system gets a thread or core limit. Each keeps its default thread setting, so it can use all 4 vCPUs. Each result file records this as `"threads": "default"`.
- A system that runs out of memory at a size has no result at that size.
- Each result records peak memory, CPU time and thread count.
- Every size runs every test.

## Repeats

| Test kind | Runs | Reported |
| --- | --- | --- |
| Read | 5, after a restore | Median |
| R8 | 3, each after a stop and a cleared OS cache | Median |
| Single-cell write | 20, each on a new cell, after 1 warm-up. Fewer if a test has fewer cells. | Median and 95th percentile |
| Bulk write, load, model change | 3, each from the snapshot | Median |

Tests run in the order of `tests/tests.json`. Every raw time is published.

## Scores

```
score = (c + t) / (c + best)
```

`t` is the system's time and `best` is the fastest system's time. `c` is 10 ms, so differences no user could feel don't count as big ratios. Lower is better, and 1 is the best.

- Loads, writes, reads and model changes get one score each. Each score is the geometric mean of its test scores. There is no combined score.
- R8 is the only read that starts a stopped system. It counts in the read score like the other reads.
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

- **Expected answers.** RAMA runs every test once on the dataset's picks, and every answer and check it gives is saved as the expected result. Every other system must give the same. When a system disagrees with RAMA, someone finds out which one is right, and a RAMA error is fixed in RAMA and recorded again.
- **What RAMA's answers are not checked for.** The runner does not check RAMA's answers against the effects `tests.json` states, such as "the bonus moves by the rate times the sales". If RAMA got one wrong, every correct system would be marked wrong on that test until someone looked. Two independent SQL systems that agree with each other but not with RAMA are the sign to look.
- **Rules at every size.** Every check of the model is 0. The P&L lines add up to EBIT. Each cost pool equals what it allocated plus what it could not place. Closed months equal the actuals. These hold for RAMA too, so they are never recorded.

The proving read is checked during the run. Full answers are compared after the timer stops, member by member.

Amounts must match within 0.01 or a relative 1e-9, whichever is larger. Ratios must match within a relative 1e-6.
