# Tools

## Comparing two builds

The runner times one system once. A difference between two runs of two builds can be the builds, or the order they ran in, a neighbour on the machine, a different disk, or a snapshot one build made for the other. `ab.sh` takes the last four out, and `summarize-ab.mjs` says how large the difference is next to the noise between runs of the same build. Linux, bash 4.4 or later.

```bash
tools/ab.sh --entry rama --dataset ~/data/fpabench-10m --work ~/ab/work --out ~/ab/out \
    --arm old=$PWD,RAMA_PATH=$HOME/rama-old,RAMA_NODE_ADDON_BINARY=$HOME/rama-old/rama.node \
    --arm new=$PWD,RAMA_PATH=$HOME/rama-new,RAMA_NODE_ADDON_BINARY=$HOME/rama-new/rama.node \
    --legs 3 --tests R1,W3 -- --expected ~/run/expected.json
node tools/summarize-ab.mjs ~/ab/out
```

An `--arm` is `NAME=<FPABench checkout>`. Each `--env NAME=VALUE` after it is an environment variable for that arm; a value may contain commas. Everything after `--` goes to `runner/run.mjs` as it is. The other options:

| Option | What it does |
| --- | --- |
| `--entry`, `--dataset`, `--tests`, `--machine` | As in the runner. `--dataset` is a folder or a published size. |
| `--work` | Each arm gets its own folder in it. Downloaded datasets are shared. |
| `--out` | One folder per leg, `<arm>-L<n>`, with the runner's files, `run.log`, and `leg.txt`: the host, the load, the scheduling and the exit code. |
| `--legs` | How many times each arm runs. The default is 6, the least is 5. |
| `--timeout` | Seconds a leg may take. A leg over it is a failed leg, never a wait. |
| `--cpus` | Pin the runs to these CPUs, such as `4-23`. At least 2. Without it the runner and any server it starts inherit `SCHED_FIFO` 50 on every CPU, and can starve the rest of the machine: pass it on a machine that has other work. |

What it does:

- **Own work folder.** Every arm has its own `--work` folder, and one untimed load of its own first, so no arm times a snapshot another build made.
- **Turns.** The legs run `A B`, `B A`, `A B`, `B A`, ... (the runs go A B B A A B B A), so neither arm is always first or last. With three or more arms each leg is the next row of a rotating Latin square. The order is fully balanced when `--legs` is a multiple of the number of arms, and `ab.sh` warns when it is not. Running again into the same `--out` replaces the legs of the arms.
- **Real-time.** Each leg tries `chrt -f 50`, then the same through `sudo -n`. The check runs the same command as a leg (the prefix, the pin, `env` with a variable and `PATH`, then `node`) and trusts it only when the process finds `node`, sees the variable, and reports class `FF` and a priority above 0 in `ps`. The arm's variables are set after `sudo`, which would otherwise drop them. Otherwise the leg runs normally and is marked `not realtime` in `leg.txt` and in the summary.
- **Same machine.** It records the host name, the boot id and the machine id, and stops when any of them changes between legs.

The summary prints, per test and arm, the median over the legs and its spread, which is (max - min) / median. Two arms are "beyond spread" only when there are at least 5 legs in each and all three hold:

1. the ranges (min to max) of their legs do not overlap;
2. the difference of the medians is larger than the range (max - min) of each of the two arms;
3. that difference is at least 1% of the first arm's median.

Anything else is "within spread", "fewer than 5 legs", or "check failed in a leg".

**False alarms.** If both arms were the same build, rule 1 alone flags a test with probability 2 / C(2n, n) for n legs each: 10% at 3 legs, 0.8% at 5, 0.2% at 6. Rules 2 and 3 only lower that; simulated with normally distributed noise, the three rules together flag 0.2% of the tests at 5 legs and 0.04% at 6. That is per test: over m tests the chance of at least one false flag is 1 - (1 - p)^m, so for 20 tests at 5 legs about 15% by rule 1 alone and about 3.5% with all three rules. It says nothing about a difference smaller than the spread: that is "within spread", not "no difference".

It refuses results from machines that differ in their CPU, CPU count, memory, kernel, Node version, dataset or tests version. `--csv` prints the same numbers for a spreadsheet.

A timed run needs a machine nothing else uses. `ab.sh` does not check that, and a run with other work on the machine shows up as a large spread.
