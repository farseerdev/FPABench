// Checks the /proc parsers of proc.mjs on fixed text: node --test runner/proc.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatus, parseIo, parseStat, parseMountInfo, samplesAfterRun, Meter } from './proc.mjs';

test('status', () => {
    const text = 'Name:\tnode\nVmPeak:\t  900000 kB\nVmHWM:\t  123456 kB\nVmRSS:\t  100000 kB\nThreads:\t11\n';
    assert.deepEqual(parseStatus(text), { rssKB: 100000, hwmKB: 123456, threads: 11, anonKB: 0, fileKB: 0, shmemKB: 0 });
    assert.deepEqual(parseStatus('Name:\tkthreadd\n'), { rssKB: 0, hwmKB: 0, threads: 0, anonKB: 0, fileKB: 0, shmemKB: 0 });
});

test('io', () => {
    const text = 'rchar: 10\nwchar: 20\nsyscr: 1\nsyscw: 2\nread_bytes: 4096\nwrite_bytes: 8192\ncancelled_write_bytes: 0\n';
    assert.deepEqual(parseIo(text), { readBytes: 4096, writeBytes: 8192 });
    assert.equal(parseIo(''), null);
});

test('stat, with a name that has spaces and brackets', () => {
    const text = '4242 (my (odd) name) S 100 4242 4242 0 -1 4194560 100 0 0 0 250 75 3 1 20 0 9 0 987654 1000000 500 18446744073709551615';
    assert.deepEqual(parseStat(text), { ppid: 100, user: 250, sys: 75, start: '987654' });
});

test('the file system of a folder is the one with the longest mount point holding it', () => {
    const text = ['22 1 8:1 / / rw,relatime shared:1 - ext4 /dev/sda1 rw', '30 22 259:1 / /data rw,relatime shared:2 - xfs /dev/nvme0n1 rw', '31 22 259:2 / /database rw - ext4 /dev/sdb rw'].join('\n');
    assert.deepEqual(parseMountInfo(text, '/data/run/work'), { type: 'xfs', source: '/dev/nvme0n1', mount: '/data' });
    assert.deepEqual(parseMountInfo(text, '/database'), { type: 'ext4', source: '/dev/sdb', mount: '/database' });
    assert.deepEqual(parseMountInfo(text, '/home/x'), { type: 'ext4', source: '/dev/sda1', mount: '/' });
});

test('status splits the resident size', () => {
    const text = 'VmHWM:\t 300 kB\nVmRSS:\t 200 kB\nRssAnon:\t 120 kB\nRssFile:\t 70 kB\nRssShmem:\t 10 kB\nThreads:\t2\n';
    assert.deepEqual(parseStatus(text), { rssKB: 200, hwmKB: 300, threads: 2, anonKB: 120, fileKB: 70, shmemKB: 10 });
});

test('a mount point with escaped characters is decoded', () => {
    const text = ['22 1 8:1 / / rw - ext4 /dev/sda1 rw', '30 22 259:1 / /mnt/my\\040disk rw - xfs /dev/nvme0n1 rw'].join('\n');
    assert.deepEqual(parseMountInfo(text, '/mnt/my disk/work'), { type: 'xfs', source: '/dev/nvme0n1', mount: '/mnt/my disk' });
});

test('the readings after a run are taken only after the first and the last run', () => {
    assert.deepEqual([0, 1, 2, 3, 4].map((i) => samplesAfterRun(i, 5)), [true, false, false, false, true]);
    assert.deepEqual([samplesAfterRun(0, 1)], [true]);
    // The hook itself: a Meter whose sample() counts, with no /proc needed.
    const meter = Object.create(Meter.prototype);
    let reads = 0;
    meter.sample = () => (++reads, 2048);
    meter.marks = {};
    for (let i = 0; i < 5; i++) meter.afterRun(i, 5);
    assert.equal(reads, 2);
    assert.deepEqual(meter.marks, { afterFirstRun: 2, afterLastRun: 2 });
    reads = 0;
    meter.marks = {};
    meter.afterRun(0, 1);
    assert.equal(reads, 1);
    assert.deepEqual(meter.marks, { afterFirstRun: 2, afterLastRun: 2 });
});
