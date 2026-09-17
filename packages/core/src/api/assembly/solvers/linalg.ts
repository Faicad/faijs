/**
 * api/assembly/solvers/linalg — 自实现向量数学与线性求解（P1，裁定 4）
 *
 * 规模极小（≤30 阶对称正定），优先 Cholesky（比 Gauss-Jordan 更稳且快），
 * 退化时回落 Gauss-Jordan 带部分主元。vendored 的 `ikFns.solveLinear` 是模块私有、
 * 不可 import（裁定 4），故在此自实现，vendored 只读约定不变。
 *
 * 模块零外部依赖；所有函数纯数值。
 */

export type Vec3 = [number, number, number]

export function vadd(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
export function vsub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
export function vdot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
export function vcross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
export function vscale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}
export function vnorm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2])
}
/** 原地归一化（零向量安全：返回 [0,0,0]）。 */
export function vnormalize(a: Vec3): Vec3 {
  const l = vnorm(a)
  return l < 1e-15 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l]
}
export function vsumsqr(a: Vec3): number {
  return a[0] * a[0] + a[1] * a[1] + a[2] * a[2]
}

/**
 * AᵀA（n×m 矩阵 → n×n 对称）与 Aᵀb。矩阵按行主序扁平存于 `A`（len = rows*cols）。
 */
export function ata(a: number[], rows: number, cols: number): number[] {
  const out = new Array(cols * cols).fill(0)
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < cols; j++) {
      let s = 0
      for (let k = 0; k < rows; k++) s += a[k * cols + i] * a[k * cols + j]
      out[i * cols + j] = s
    }
  }
  return out
}
export function atb(a: number[], b: number[], rows: number, cols: number): number[] {
  const out = new Array(cols).fill(0)
  for (let j = 0; j < cols; j++) {
    let s = 0
    for (let k = 0; k < rows; k++) s += a[k * cols + j] * b[k]
    out[j] = s
  }
  return out
}

/**
 * 解 (M + λI) x = b，M 为 n×n 对称正定（此处 M = JᵀJ）。
 * 先尝试 Cholesky(M + λI)；若非正定，逐步放大 λ 重试；最终回落带部分主元 Gauss-Jordan。
 *
 * @returns 解向量 x，或退化时 null。
 */
export function solveDampedNormal(
  m: number[],
  b: number[],
  n: number,
  lambda: number,
): number[] | null {
  // 尝试多级 λ（LM 阻尼放大）
  const lambdas = [lambda, lambda * 4, lambda * 16, lambda * 64, lambda * 256, lambda * 1024]
  for (const lam of lambdas) {
    const md = m.slice()
    for (let i = 0; i < n; i++) md[i * n + i] += lam
    const x = choleskySolve(md, b, n)
    if (x) return x
  }
  return gaussJordanSolve(m, b, n, lambda)
}

/** Cholesky（A = L Lᵀ）解对称正定系统；失败返回 null。 */
function choleskySolve(a: number[], b: number[], n: number): number[] | null {
  const L = new Array(n * n).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i * n + j]
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k]
      if (i === j) {
        if (s <= 0) return null // 非正定
        L[i * n + i] = Math.sqrt(s)
      } else {
        L[i * n + j] = s / L[j * n + j]
      }
    }
  }
  // 前代 L y = b
  const y = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    let s = b[i]
    for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k]
    y[i] = s / L[i * n + i]
  }
  // 回代 Lᵀ x = y
  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]
    x[i] = s / L[i * n + i]
  }
  return x
}

/** 带部分主元 Gauss-Jordan，附加 λI 阻尼保证可解性。 */
function gaussJordanSolve(a: number[], b: number[], n: number, lambda: number): number[] | null {
  const m = a.slice()
  for (let i = 0; i < n; i++) m[i * n + i] += lambda
  const x = new Array(n).fill(0)
  const aug = new Array(n).fill(0).map((_, i) => [...m.slice(i * n, i * n + n), b[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    let best = Math.abs(aug[col][col])
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(aug[r][col])
      if (v > best) {
        best = v
        piv = r
      }
    }
    if (best < 1e-15) return null
    if (piv !== col) {
      const tmp = aug[piv]
      aug[piv] = aug[col]
      aug[col] = tmp
    }
    const d = aug[col][col]
    for (let j = col; j <= n; j++) aug[col][j] /= d
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = aug[r][col]
      if (f === 0) continue
      for (let j = col; j <= n; j++) aug[r][j] -= f * aug[col][j]
    }
  }
  for (let i = 0; i < n; i++) x[i] = aug[i][n]
  return x
}
