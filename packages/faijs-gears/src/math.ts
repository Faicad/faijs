/**
 * math — cq_gears `utils.py` 的 numpy 子集（零依赖，TS 手写）
 *
 * 约定（**与 Python 逐字对齐，不要"修正"**）：
 *
 * - `rotationMatrix(axis, alpha)` 返回 cq 的同款 Rodrigues 矩阵 R（列向量约定 `p' = R·p`）。
 * - cq 里齿轮点集用的是 `pts @ r_mat`（**行向量**左乘），等价于 `Rᵀ·p`，即**绕轴转 −alpha**。
 *   这不是笔误——`spur_gear.py::_build_tooth_faces` 就是这么写的，实测
 *   （`spur-helix15` 参考数据）确认齿面扭转方向与 `−twist_angle` 一致。
 *   所以本模块同时提供 `applyRowMatrix()`（忠实复刻）与 `rotateRows()`（语义命名）。
 */

/** 三维点 / 向量（与 `BrepVec3` 同构）。 */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * 构造一个 `Vec3`。
 *
 * @param x x 分量
 * @param y y 分量
 * @param z z 分量
 * @returns 三维向量
 */
export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

/**
 * 向量加法。
 *
 * @param a 左操作数
 * @param b 右操作数
 * @returns `a + b`
 */
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })

/**
 * 向量减法。
 *
 * @param a 左操作数
 * @param b 右操作数
 * @returns `a - b`
 */
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })

/**
 * 标量乘法。
 *
 * @param a 向量
 * @param k 标量
 * @returns `k·a`
 */
export const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k })

/**
 * 点积。
 *
 * @param a 左操作数
 * @param b 右操作数
 * @returns `a·b`
 */
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z

/**
 * 叉积。
 *
 * @param a 左操作数
 * @param b 右操作数
 * @returns `a×b`
 */
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

/**
 * 向量模长。
 *
 * @param a 向量
 * @returns 模长
 */
export const norm = (a: Vec3): number => Math.sqrt(dot(a, a))

/**
 * 归一化；零向量返回零向量（避免除零）。
 *
 * @param a 向量
 * @returns 单位向量（零向量输入返回零向量）
 */
export const normalize = (a: Vec3): Vec3 => {
  const n = norm(a)
  return n === 0 ? { x: 0, y: 0, z: 0 } : scale(a, 1 / n)
}

/**
 * `np.linspace(a, b, n)` —— 闭区间，含两端。
 *
 * @param a 起始值
 * @param b 结束值
 * @param n 点数
 * @returns n 个等距点（n <= 1 时只含 a）
 */
export function linspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a]
  const out = new Array<number>(n)
  const step = (b - a) / (n - 1)
  for (let i = 0; i < n; i++) out[i] = a + step * i
  return out
}

/**
 * 弧度夹到 [0, 2π)。
 *
 * @param t 任意弧度角
 * @returns 归一化后的弧度角
 */
export function normalizeAngle2pi(t: number): number {
  const twoPi = Math.PI * 2
  let r = t % twoPi
  if (r < 0) r += twoPi
  return r
}

/** 3×3 矩阵（行主序）。 */
export type Mat3 = number[][]

/**
 * `cq_gears.utils.rotation_matrix` 的逐字移植（Rodrigues，列向量约定）。
 *
 * @param axis  旋转轴（无需归一化，内部归一）
 * @param alpha 旋转角（弧度）
 * @returns 3×3 Rodrigues 旋转矩阵（行主序）
 */
export function rotationMatrix(axis: Vec3, alpha: number): Mat3 {
  const n = norm(axis)
  const ux = axis.x / n
  const uy = axis.y / n
  const uz = axis.z / n
  const sina = Math.sin(alpha)
  const cosa = Math.cos(alpha)
  const k = 1 - cosa
  return [
    [cosa + k * ux * ux, ux * uy * k - uz * sina, ux * uz * k + uy * sina],
    [uy * ux * k + uz * sina, cosa + k * uy * uy, uy * uz * k - ux * sina],
    [uz * ux * k - uy * sina, uz * uy * k + ux * sina, cosa + k * uz * uz],
  ]
}

/**
 * 行向量左乘：`pts @ m`（cq 的实际用法）。
 *
 * 结果第 j 分量 = Σᵢ pᵢ·m[i][j]，等价于 `mᵀ · p`。
 *
 * @param points 行向量点集
 * @param m 3×3 矩阵
 * @returns 变换后的点集
 */
export function applyRowMatrix(points: Vec3[], m: Mat3): Vec3[] {
  return points.map((p) => ({
    x: p.x * m[0][0] + p.y * m[1][0] + p.z * m[2][0],
    y: p.x * m[0][1] + p.y * m[1][1] + p.z * m[2][1],
    z: p.x * m[0][2] + p.y * m[1][2] + p.z * m[2][2],
  }))
}

/**
 * 语义化包装：`applyRowMatrix(pts, rotationMatrix(axis, alpha))`。
 *
 * ⚠️ 因为 cq 用行向量左乘，实际旋转角是 **−alpha**。
 *
 * @param points 点集
 * @param axis 旋转轴
 * @param alpha 名义旋转角（弧度，实际为 −alpha）
 * @returns 旋转后的点集
 */
export function rotateRows(points: Vec3[], axis: Vec3, alpha: number): Vec3[] {
  return applyRowMatrix(points, rotationMatrix(axis, alpha))
}

/**
 * 真正按 +alpha 旋转（标准列向量约定），用于 TS 侧需要正向旋转的场景。
 *
 * @param points 点集
 * @param axis 旋转轴
 * @param alpha 旋转角（弧度）
 * @returns 旋转后的点集
 */
export function rotatePoints(points: Vec3[], axis: Vec3, alpha: number): Vec3[] {
  const m = rotationMatrix(axis, -alpha)
  return points.map((p) => ({
    x: m[0][0] * p.x + m[0][1] * p.y + m[0][2] * p.z,
    y: m[1][0] * p.x + m[1][1] * p.y + m[1][2] * p.z,
    z: m[2][0] * p.x + m[2][1] * p.y + m[2][2] * p.z,
  }))
}

/**
 * `cq_gears.utils.sphere_to_cartesian` 的逐字移植：球坐标 → 笛卡尔。
 *
 * ⚠️ 注意极点角 `gamma` 是**从 +Z 轴量起**（`z = r·cos(gamma)`），
 * 而不是数学习惯里从 XY 平面量起的仰角——BevelGear 的整套公式都建立在这个约定上。
 *
 * @param r 球半径
 * @param gamma 极角（弧度，自 +Z 轴）
 * @param theta 方位角（弧度）
 * @returns 笛卡尔坐标
 */
export function sphereToCartesian(r: number, gamma: number, theta: number): Vec3 {
  return {
    x: r * Math.sin(gamma) * Math.sin(theta),
    y: r * Math.sin(gamma) * Math.cos(theta),
    z: r * Math.cos(gamma),
  }
}

/**
 * `cq_gears.utils.s_inv` 的逐字移植：球面渐开线（给定极角 → 方位角）。
 *
 * `phi = arccos(tan(gamma0)/tan(gamma))`；
 * `return arccos(cos(gamma)/cos(gamma0))/sin(gamma0) − phi`。
 *
 * 定义域外（`|tan(gamma0)/tan(gamma)| > 1`）与 Python 的 numpy 一样返回 NaN——
 * 由调用方决定是否报错，本函数不静默替换。
 *
 * @param gamma0 基锥极角（弧度）
 * @param gamma 曲线上点的极角（弧度）
 * @returns 该点的方位角（弧度）
 */
export function sInv(gamma0: number, gamma: number): number {
  const phi = Math.acos(Math.tan(gamma0) / Math.tan(gamma))
  return Math.acos(Math.cos(gamma) / Math.cos(gamma0)) / Math.sin(gamma0) - phi
}

/**
 * `cq_gears.utils.s_arc` 的逐字移植：球面上的一段圆弧。
 *
 * Python 侧是 `cos(t)·a + sin(t)·(k×a) + (k·a)(1−cos t)·k`（`a` = 球心到弧心方向
 * 偏移 `r_delta` 后的单位向量，`k` = 弧心的单位向量），再整体乘球半径。
 *
 * @param sr 球半径
 * @param cGamma 弧心的极角（弧度）
 * @param cTheta 弧心的方位角（弧度）
 * @param rDelta 弧心与弧上任一点的夹角（弧度）
 * @param start 起始角（弧度）
 * @param end 终止角（弧度）
 * @param n 点数（含两端）
 * @returns 弧上 n 个点
 */
export function sArc(
  sr: number, cGamma: number, cTheta: number,
  rDelta: number, start: number, end: number, n = 32,
): Vec3[] {
  const a = sphereToCartesian(1.0, cGamma + rDelta, cTheta)
  const k = sphereToCartesian(1.0, cGamma, cTheta)
  const ka = cross(k, a)
  const kdota = dot(k, a)
  return linspace(start, end, n).map((t) => {
    const ct = Math.cos(t)
    const st = Math.sin(t)
    const w = 1 - ct
    return vec3(
      sr * (ct * a.x + st * ka.x + kdota * w * k.x),
      sr * (ct * a.y + st * ka.y + kdota * w * k.y),
      sr * (ct * a.z + st * ka.z + kdota * w * k.z),
    )
  })
}

/**
 * `cq_gears.utils.angle_between` 的移植：向量 OA 与 OB 的夹角。
 *
 * @param o 公共起点
 * @param a 向量 OA 的终点
 * @param b 向量 OB 的终点
 * @returns 夹角（弧度）
 */
export function angleBetween(o: Vec3, a: Vec3, b: Vec3): number {
  const p = sub(a, o)
  const q = sub(b, o)
  return Math.acos(dot(p, q) / (norm(p) * norm(q)))
}

/**
 * `cq_gears.utils.circle3d_by3points` 的移植：三点定圆。
 *
 * @param a 第一点
 * @param b 第二点
 * @param c 第三点
 * @returns `{ radius, center }`
 */
export function circle3dBy3points(a: Vec3, b: Vec3, c: Vec3): { radius: number; center: Vec3 } {
  let u = sub(b, a)
  let w = cross(sub(c, a), u)
  u = normalize(u)
  w = normalize(w)
  const v = cross(w, u)

  const bx = dot(sub(b, a), u)
  const cx = dot(sub(c, a), u)
  const cy = dot(sub(c, a), v)

  const h = ((cx - bx / 2) ** 2 + cy ** 2 - (bx / 2) ** 2) / (2 * cy)
  const center = add(a, add(scale(u, bx / 2), scale(v, h)))
  return { radius: norm(sub(a, center)), center }
}
