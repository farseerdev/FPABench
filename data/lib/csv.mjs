// CSV output: buffered writes, a row count and the SHA-256 of every file, for the manifest.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FLUSH_AT = 4 << 20;

export class CsvWriter {
    constructor(file, columns) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        this.file = file;
        this.columns = columns;
        this.fd = fs.openSync(file, 'w');
        this.hash = crypto.createHash('sha256');
        this.buf = '';
        this.rows = 0;
        this.bytes = 0;
        this.push(columns.join(',') + '\n');
    }

    push(text) {
        this.buf += text;
        if (this.buf.length > FLUSH_AT) this.flush();
    }

    flush() {
        if (!this.buf) return;
        const b = Buffer.from(this.buf, 'utf8');
        fs.writeSync(this.fd, b);
        this.hash.update(b);
        this.bytes += b.length;
        this.buf = '';
    }

    // One row. Values are written as given: strings must already be formatted, null or undefined is empty.
    row(values) {
        let line = '';
        for (let i = 0; i < values.length; i++) {
            const v = values[i];
            if (i) line += ',';
            if (v === null || v === undefined) continue;
            line += typeof v === 'string' ? quote(v) : String(v);
        }
        this.push(line + '\n');
        this.rows++;
    }

    close() {
        this.flush();
        fs.closeSync(this.fd);
        return { rows: this.rows, bytes: this.bytes, sha256: this.hash.digest('hex') };
    }
}

// RFC 4180 quoting, only where needed.
function quote(s) {
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

// An amount held in hundredths, written with two decimals. Exact for any whole number of hundredths.
export function money(hundredths) {
    if (hundredths === 0) return '0.00';
    const neg = hundredths < 0;
    const a = neg ? -hundredths : hundredths;
    const whole = Math.floor(a / 100);
    const frac = a - whole * 100;
    return (neg ? '-' : '') + whole + '.' + (frac < 10 ? '0' : '') + frac;
}

// A rate or share with a fixed number of decimals. Number.prototype.toFixed is exact by the spec.
export function fixed(x, decimals) {
    const s = x.toFixed(decimals);
    return s === '-' + (0).toFixed(decimals) ? (0).toFixed(decimals) : s;
}
