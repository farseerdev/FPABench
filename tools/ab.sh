#!/bin/bash
# Runs two or more builds of the same entry against each other, in turns, on this machine.
#
#   tools/ab.sh --entry rama --dataset ~/data/fpabench-10m --out ~/ab/out --work ~/ab/work \
#       --arm A=/path/to/checkout --env RAMA_PATH=/path/a --env RAMA_NODE_ADDON_BINARY=/path/a/rama.node \
#       --arm B=/path/to/checkout --env RAMA_PATH=/path/b --env RAMA_NODE_ADDON_BINARY=/path/b/rama.node \
#       [--legs 6] [--tests R1,W3] [--machine <name>] [--timeout <seconds>] [--cpus 4-23] \
#       -- --expected ~/run/expected.json
#
# An arm is `--arm NAME=<FPABench checkout>`, followed by any number of `--env NAME=VALUE` for that arm (a
# value may contain commas). The checkout may be the same for every arm (two builds of one system) or
# differ (two versions of the runner). What follows `--` goes to runner/run.mjs as it is, such as
# --expected and --quick.
#
# Each arm has its own work folder. Each gets one untimed load first, so no arm times a snapshot another
# one made. Then the legs run in turns that keep the order balanced (A B, B A, A B, ...; for 3 or more arms
# a rotating Latin square), so that no arm is always first or last. At least 5 legs per arm.
# Each leg runs under SCHED_FIFO 50 when the machine allows it, and the result says whether it did. Without
# --cpus the runner and any server it starts get FIFO 50 on every CPU and can starve the rest of the
# machine: pass --cpus on a machine that has other work. The run stops when the machine changes between legs.
# Never time on a machine that other work uses. Running again into the same --out replaces the legs of the arms.
# The results are in <out>/<arm>-L<leg>/, and tools/summarize-ab.mjs prints the table.

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
entry= dataset= out= work= machine= tests= cpus= legs=6 leg_timeout=7200
arms=() arm_envs=()
while [ $# -gt 0 ]; do
    case $1 in
        --entry) entry=$2; shift 2 ;;
        --dataset) dataset=$2; shift 2 ;;
        --out) out=$2; shift 2 ;;
        --work) work=$2; shift 2 ;;
        --arm)
            case $2 in ?*=?*) ;; *) echo "--arm needs NAME=<checkout>, not $2" >&2; exit 2 ;; esac
            arms+=("$2"); arm_envs+=(""); shift 2 ;;
        --env)
            [ ${#arms[@]} -gt 0 ] || { echo "--env comes after the --arm it belongs to" >&2; exit 2; }
            case $2 in [A-Za-z_]*=*) ;; *) echo "--env needs NAME=VALUE, not $2" >&2; exit 2 ;; esac
            arm_envs[${#arms[@]}-1]+="$2"$'\n'; shift 2 ;;
        --legs) legs=$2; shift 2 ;;
        --tests) tests=$2; shift 2 ;;
        --machine) machine=$2; shift 2 ;;
        --timeout) leg_timeout=$2; shift 2 ;;
        --cpus) cpus=$2; shift 2 ;;
        --) shift; break ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
extra=("$@")
if [ -z "$entry" ] || [ -z "$dataset" ] || [ -z "$out" ] || [ -z "$work" ] || [ ${#arms[@]} -lt 2 ]; then
    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//' >&2
    echo "needs --entry, --dataset, --out, --work and at least two --arm" >&2
    exit 2
fi
[[ $legs =~ ^[0-9]+$ ]] && [ "$legs" -ge 5 ] || { echo "--legs $legs: at least 5 legs per arm (fewer cannot tell a difference from noise)" >&2; exit 2; }
if [ $((legs % ${#arms[@]})) != 0 ]; then echo "WARNING: $legs legs is not a multiple of ${#arms[@]} arms: the order of the arms is not fully balanced" >&2; fi
case $dataset in 10m|100m|1b|10b) ;; *) dataset=$(cd "$dataset" && pwd) ;; esac
mkdir -p "$out" "$work/datasets"
out=$(cd "$out" && pwd)
work=$(cd "$work" && pwd)

# --- the machine: the legs must all run on the one ---------------------------------------------------------

fingerprint() { echo "$(hostname) $(cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo no-boot-id) $(cat /etc/machine-id 2>/dev/null || echo no-machine-id)"; }
host=$(fingerprint)
echo "$host" > "$out/host.txt"
check_host() { [ "$(fingerprint)" = "$host" ] || { echo "the machine changed ($(fingerprint), it was $host): stopping" >&2; exit 3; }; }

# A single CPU would starve the runner and a server of each other under a real-time class.
if [ -n "$cpus" ]; then
    n=0
    IFS=, read -ra parts <<< "$cpus"
    for p in "${parts[@]}"; do case $p in *-*) n=$((n + ${p#*-} - ${p%-*} + 1)) ;; *) n=$((n + 1)) ;; esac; done
    [ $n -ge 2 ] || { echo "--cpus $cpus is one CPU: a real-time runner needs at least 2" >&2; exit 2; }
fi
pin=()
[ -z "$cpus" ] || pin=(taskset -c "$cpus")

# --- real-time scheduling, verified instead of assumed -----------------------------------------------------
# What the shell can start under SCHED_FIFO 50 is tried directly, then through sudo. The probe has the shape
# of a leg: the prefix, the pin, then env with a variable and PATH, then a process that must find node, see
# the variable and report its class. A candidate counts only when that process reports class FF and a
# non-zero real-time priority.

rt=()
sched="not realtime"
probe() { "$@" "${pin[@]}" env AB_PROBE=seen HOME="$HOME" PATH="$PATH" sh -c 'echo "$AB_PROBE $(node --version >/dev/null 2>&1 && echo node) $(ps -o cls=,rtprio= -p $$)"' 2>/dev/null | tr -s ' ' | sed 's/^ //; s/ $//'; }
for candidate in "chrt -f 50" "sudo -n chrt -f 50 setpriv --reuid=$(id -u) --regid=$(id -g) --clear-groups --"; do
    read -ra c <<< "$candidate"
    got=$(probe "${c[@]}" || true)
    if [[ $got =~ ^seen\ node\ (FF\ [1-9][0-9]*)$ ]]; then rt=("${c[@]}"); sched=${BASH_REMATCH[1]}; break; fi
done
[ ${#rt[@]} -gt 0 ] || echo "WARNING: SCHED_FIFO is not available (no rtprio limit, no passwordless sudo, or node not found under it): the legs run \"not realtime\" and say so" >&2
{ [ ${#rt[@]} -eq 0 ] || [ -n "$cpus" ]; } || echo "WARNING: without --cpus the runner and any server it starts run FIFO 50 on all CPUs" >&2
echo "scheduling: $sched"

# --- one leg ------------------------------------------------------------------------------------------------

arm_name() { echo "${1%%=*}"; }
arm_dir() { realpath "${1#*=}"; }

# run_leg <arm index> <folder name> <tests> <real-time 0|1>; the runner gets what followed `--`
run_leg() {
    local idx=$1 name=$2 only=$3 realtime=$4
    local spec=${arms[$1]} dir envs=() leg=$out/$2 prefix=() tflag=()
    dir=$(arm_dir "$spec")
    while IFS= read -r kv; do [ -z "$kv" ] || envs+=("$kv"); done <<< "${arm_envs[$idx]}"
    [ "$realtime" = 1 ] && [ ${#rt[@]} -gt 0 ] && prefix=("${rt[@]}")
    [ -z "$only" ] || tflag=(--tests "$only")
    rm -rf "${leg:?}"
    mkdir -p "$leg"
    {
        echo "host=$(fingerprint)"
        echo "load=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || echo unknown)"
        echo "sched=$([ ${#prefix[@]} -gt 0 ] && echo "$sched" || echo "not realtime")"
        echo "start=$(date -u +%FT%TZ)"
        echo "run=$((++runs))"
    } > "$leg/leg.txt"
    local rc=0
    # env comes AFTER the real-time prefix: sudo resets the environment, so assignments before it never
    # arrive. PATH and HOME are passed on for the same reason; an arm's own PATH or HOME wins.
    (cd "$dir" && timeout "$leg_timeout" "${prefix[@]}" "${pin[@]}" env HOME="$HOME" PATH="$PATH" "${envs[@]}" node runner/run.mjs --entry "$entry" --dataset "$dataset" \
        --work "$work/$(arm_name "$spec")" --out "$leg" ${machine:+--machine "$machine"} "${tflag[@]}" "${extra[@]}") > "$leg/run.log" 2>&1 || rc=$?
    { echo "end=$(date -u +%FT%TZ)"; echo "rc=$rc"; } >> "$leg/leg.txt"
    return $rc
}

# The arms, in order, for leg i (0-based). Two arms: A B, B A, A B, ... so the runs go A B B A A B B A.
# Three or more: row i of a Latin square, the cyclic one over the sequence 0 1 k-1 2 k-2 ... shifted by i,
# which for an even k also balances which arm follows which when legs is a multiple of k.
leg_order() {
    local i=$1 k=${#arms[@]} j seq=(0) lo=1 hi=$((${#arms[@]} - 1))
    while [ $lo -le $hi ]; do
        seq+=($lo); lo=$((lo + 1))
        if [ $lo -le $hi ]; then seq+=($hi); hi=$((hi - 1)); fi
    done
    for j in "${seq[@]}"; do echo $(((j + i) % k)); done
}

failed=0 runs=0
for idx in "${!arms[@]}"; do
    name=$(arm_name "${arms[$idx]}")
    rm -rf "${out:?}/$name-prep" "${out:?}/$name"-L[0-9]*
    mkdir -p "$work/$name"
    # A real folder where the link goes (an earlier run, or a runner that made one) is removed when empty,
    # and never linked into.
    if [ -e "$work/$name/datasets" ] && [ ! -L "$work/$name/datasets" ]; then
        rmdir "$work/$name/datasets" || { echo "$work/$name/datasets is a folder with files in it: move it away" >&2; exit 2; }
    fi
    ln -sfn "$work/datasets" "$work/$name/datasets"
    echo "prepare $name: one untimed load"
    check_host
    run_leg "$idx" "$name-prep" L1 0 || { echo "the load of $name failed, see $out/$name-prep/run.log" >&2; exit 1; }
done
for ((i = 0; i < legs; i++)); do
    for idx in $(leg_order $i); do
        name=$(arm_name "${arms[$idx]}")
        check_host
        echo "leg $((i + 1)): $name"
        run_leg "$idx" "$name-L$((i + 1))" "$tests" 1 || { echo "leg $((i + 1)) of $name failed (rc $?), see $out/$name-L$((i + 1))/run.log" >&2; failed=1; }
    done
done
node "$here/summarize-ab.mjs" "$out" || true
exit $failed
