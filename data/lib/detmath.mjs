// Deterministic log and exp.
//
// JavaScript's Math.log, Math.exp and Math.pow are "implementation-approximated": two engines, or one
// engine on two platforms, may return different last bits. The generator must write the same bytes
// everywhere, so it uses these instead. They are ports of fdlibm's algorithms and use only +, -, *, /
// and Math.round, which IEEE 754 and ECMAScript define exactly. Powers of two are built by repeated
// doubling, which is exact. Accuracy is about one unit in the last place, which is plenty here.

const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.442695040888963387;

const LG1 = 6.66666666666673513e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;

const SQRT_HALF = 0.7071067811865475244;

// 2^k for an integer k, exact while the result stays a normal number.
function pow2(k) {
    let r = 1;
    let b = k >= 0 ? 2 : 0.5;
    let n = k >= 0 ? k : -k;
    while (n > 0) {
        if (n & 1) r *= b;
        b *= b;
        n >>= 1;
    }
    return r;
}

export function log(x) {
    if (!(x > 0)) {
        if (x === 0) return -Infinity;
        return NaN;
    }
    if (x === Infinity) return Infinity;
    // Reduce x to m * 2^k with m in [sqrt(1/2), sqrt(2)). Multiplying by 2 or 1/2 is exact.
    let k = 0;
    let m = x;
    while (m >= 2) {
        m *= 0.5;
        k++;
    }
    while (m < 1) {
        m *= 2;
        k--;
    }
    if (m >= 2 * SQRT_HALF) {
        m *= 0.5;
        k++;
    }
    const f = m - 1;
    const s = f / (2 + f);
    const z = s * s;
    const w = z * z;
    const t1 = w * (LG2 + w * (LG4 + w * LG6));
    const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
    const R = t2 + t1;
    const hfsq = 0.5 * f * f;
    return k * LN2_HI - (hfsq - (s * (hfsq + R) + k * LN2_LO) - f);
}

export function exp(x) {
    if (x !== x) return NaN;
    if (x > 709.78) return Infinity;
    if (x < -745.13) return 0;
    if (x === 0) return 1;
    const k = Math.round(x * INV_LN2);
    const hi = x - k * LN2_HI;
    const lo = k * LN2_LO;
    const r = hi - lo;
    const t = r * r;
    const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    const y = 1 - (lo - (r * c) / (2 - c) - hi);
    return y * pow2(k);
}

// x^a for x > 0.
export function pow(x, a) {
    if (a === 0) return 1;
    if (x === 0) return 0;
    return exp(a * log(x));
}
