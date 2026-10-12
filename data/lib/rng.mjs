// Keyed random numbers.
//
// Every draw is a pure function of the seed, the name of the draw and the keys it belongs to, for
// example the units of one customer, SKU and month. No state passes from one draw to the next. So the
// output does not depend on the order things are generated in, a new kind of draw leaves every other
// draw unchanged, and any customer can be rebuilt on its own.
//
// The hash is MurmurHash3's mixing on 32-bit integers, with Math.imul, which is exact.

import { log, exp } from './detmath.mjs';

function mixKey(h, k) {
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

function finish(h, n) {
    h ^= n;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}

// Keys are non-negative integers below 2^53. The high part only matters above 2^32.
function mixNumber(h, k) {
    h = mixKey(h, k | 0);
    if (k >= 4294967296) h = mixKey(h, Math.floor(k / 4294967296) | 0);
    return h;
}

// A stable 32-bit id for the name of a draw (FNV-1a).
export function streamId(name) {
    let h = 0x811c9dc5;
    for (let i = 0; i < name.length; i++) {
        h ^= name.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

const TWO_32 = 4294967296;
const TWO_53 = 9007199254740992;

export class Rng {
    constructor(seed) {
        this.a = seed | 0;
        this.b = (seed ^ 0x9e3779b9) | 0;
        this.ids = new Map();
    }

    id(name) {
        let s = this.ids.get(name);
        if (s === undefined) {
            s = streamId(name);
            this.ids.set(name, s);
        }
        return s;
    }

    // A uniform number in [0, 1) with 53 random bits.
    u(name, k1 = 0, k2 = 0, k3 = 0, k4 = 0) {
        const s = this.id(name);
        let h1 = mixKey(this.a, s);
        let h2 = mixKey(this.b, s);
        h1 = mixNumber(mixNumber(mixNumber(mixNumber(h1, k1), k2), k3), k4);
        h2 = mixNumber(mixNumber(mixNumber(mixNumber(h2, k1), k2), k3), k4);
        const x = finish(h1, 4) >>> 5;
        const y = finish(h2, 4) >>> 6;
        return (x * 67108864 + y) / TWO_53;
    }

    chance(p, name, k1, k2, k3, k4) {
        return this.u(name, k1, k2, k3, k4) < p;
    }

    int(n, name, k1, k2, k3, k4) {
        return Math.floor(this.u(name, k1, k2, k3, k4) * n);
    }

    // A standard normal number, by Acklam's inverse of the normal distribution.
    normal(name, k1, k2, k3, k4) {
        let p = this.u(name, k1, k2, k3, k4);
        if (p <= 0) p = 1 / TWO_53;
        return inverseNormal(p);
    }

    // A lognormal number with the given median and spread on the log scale.
    lognormal(median, sigma, name, k1, k2, k3, k4) {
        return median * exp(sigma * this.normal(name, k1, k2, k3, k4));
    }

    // A whole number around x: the floor, plus one with probability of the fraction.
    round(x, name, k1, k2, k3, k4) {
        const f = Math.floor(x);
        return f + (this.u(name, k1, k2, k3, k4) < x - f ? 1 : 0);
    }
}

const A = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
];
const B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
const C = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
];
const D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
const P_LOW = 0.02425;

// Math.sqrt is correctly rounded by IEEE 754 on every platform Node runs on.
export function inverseNormal(p) {
    if (p < P_LOW) {
        const q = Math.sqrt(-2 * log(p));
        return (
            (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
            ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1)
        );
    }
    if (p <= 1 - P_LOW) {
        const q = p - 0.5;
        const r = q * q;
        return (
            ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q) /
            (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1)
        );
    }
    const q = Math.sqrt(-2 * log(1 - p));
    return (
        -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
        ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1)
    );
}

// Weighted sampling with replacement, by Walker's alias method. Two uniforms give one item.
export class Alias {
    constructor(weights) {
        const n = weights.length;
        this.n = n;
        this.prob = new Float64Array(n);
        this.alias = new Int32Array(n);
        let total = 0;
        for (const w of weights) total += w;
        const scaled = weights.map((w) => (w * n) / total);
        const small = [];
        const large = [];
        scaled.forEach((s, i) => (s < 1 ? small : large).push(i));
        while (small.length && large.length) {
            const s = small.pop();
            const l = large.pop();
            this.prob[s] = scaled[s];
            this.alias[s] = l;
            scaled[l] = scaled[l] + scaled[s] - 1;
            (scaled[l] < 1 ? small : large).push(l);
        }
        for (const i of large) this.prob[i] = 1;
        for (const i of small) this.prob[i] = 1;
    }

    sample(u1, u2) {
        const i = Math.floor(u1 * this.n);
        return u2 < this.prob[i] ? i : this.alias[i];
    }
}

export { TWO_32 };
