/**
 * rng — deterministic PRNG for the T3 stability tests (plan §9.3).
 *
 * Mirrors the role of `np.random.default_rng(seed)` in cq_gears'
 * `tests/stability/gen_params`: same draw order (uniform floats, then
 * integers), same [min, max) scaling. It does NOT reproduce numpy's bit
 * stream — the test suites are independent, only *determinism given a seed*
 * matters here (same seed → same case list across runs).
 */

/** Mulberry32 PRNG — small, fast, good enough distribution for param sweeps. */
export class Rng {
  private s: number

  constructor(seed: number) {
    // |0 to uint32 domain.
    this.s = seed >>> 0
  }

  /**
   * Uniform float in [0, 1) (numpy `rng.random()` analogue).
   * @returns 下一个 [0, 1) 区间的确定性浮点数。
   */
  next(): number {
    const t = (this.s + 0x6d2b79f5) >>> 0
    this.s = t
    let r = Math.imul(t ^ (t >>> 15), t | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }

  /**
   * Uniform float in [min, max) (the `MIN + (MAX-MIN) * rng.random(n)` idiom).
   * @param min - 区间下界（含）。
   * @param max - 区间上界（不含）。
   * @returns [min, max) 区间内的确定性浮点数。
   */
  uniform(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  /**
   * Uniform integer in [min, max] inclusive (numpy `rng.integers(min, max+1)`).
   * @param min - 区间下界（含）。
   * @param max - 区间上界（含）。
   * @returns [min, max] 区间内的确定性整数。
   */
  intInclusive(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }
}
