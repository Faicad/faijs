/**
 * profile — SpurGear 齿廓与齿面点阵（cq_gears `spur_gear.py` 的数学部分）
 *
 * 只做**纯数学**，不碰内核：输出的是点集，可直接与 Python 侧
 * `SpurGear.t_lflank_pts` 等内部数组逐点比对（见 `profile.test.ts`）。
 *
 * 参数名**逐字沿用 Python**（`module` / `teeth_number` / `pressure_angle` …），
 * 这样 `regression_test_cases.json` 可以零转换直接喂进来。
 */

import {
  angleBetween, circle3dBy3points, dot, linspace, norm, rotateRows, sArc, sInv,
  sphereToCartesian, vec3, type Vec3,
} from './math'

/** `GearBase` 的类级常量（cq_gears `spur_gear.py:27-39`），逐字保留。 */
export const GEAR_BASE_CONSTANTS = {
  ka: 1.0,
  kd: 1.25,
  curve_points: 20,
  surface_splines: 5,
  wire_comb_tol: 1e-2,
  spline_approx_tol: 1e-2,
  shell_sewing_tol: 1e-2,
  isection_tol: 1e-7,
  spline_approx_min_deg: 3,
  spline_approx_max_deg: 8,
} as const

/** SpurGear 构造参数（参数名逐字沿用 Python `SpurGear.__init__`）。 */
export interface SpurGearParams {
  module: number
  teeth_number: number
  width: number
  pressure_angle?: number
  helix_angle?: number
  clearance?: number
  backlash?: number
  addendum_coeff?: number | null
  dedendum_coeff?: number | null
}

/** RingGear 构造参数（参数名逐字沿用 Python `RingGear.__init__`）。
 *
 * 注意：内部齿（ring）在 `e73874c` 沿用固定的 `ka=1.0 / kd=1.25`
 * （`addendum_coeff` 仅 `SpurGear` 支持，见 commit `a6bedc0` 之后的改动），
 * 所以这里没有 `addendum_coeff` / `dedendum_coeff`。 */
export interface RingGearParams {
  module: number
  teeth_number: number
  width: number
  rim_width: number
  pressure_angle?: number
  helix_angle?: number
  clearance?: number
  backlash?: number
}

/** SpurGear 的全部派生几何量与四段齿廓点集（`SpurGear.__init__` 的产物）。 */
export interface SpurGearGeometry {
  /** 模数 m */
  m: number
  /** 齿数 z */
  z: number
  /** 压力角（弧度） */
  a0: number
  clearance: number
  backlash: number
  /** 螺旋角（弧度） */
  helixAngle: number
  width: number
  ka: number
  kd: number
  /** 分度圆直径 */
  d0: number
  /** 齿顶高 */
  adn: number
  /** 齿根高 */
  ddn: number
  /** 齿顶圆直径 */
  da: number
  /** 齿根圆直径 */
  dd: number
  /** 分度圆齿厚 */
  s0: number
  invA0: number
  /** 分度圆半径 */
  r0: number
  /** 齿顶圆半径 */
  ra: number
  /** 齿根圆半径 */
  rd: number
  /** 基圆半径 */
  rb: number
  /** 齿根过渡起始半径 max(rb, rd) */
  rr: number
  /** 齿距角 2π/z */
  tau: number
  /** 扭转角（弧度，= 0 当 helix_angle = 0） */
  twistAngle: number
  /** 齿面点阵行数（helix_angle = 0 时为 2，否则 5） */
  surfaceSplines: number
  curvePoints: number
  /** 左齿廓渐开线点集 */
  t_lflank_pts: Vec3[]
  /** 齿顶圆弧点集 */
  t_tip_pts: Vec3[]
  /** 右齿廓渐开线点集 */
  t_rflank_pts: Vec3[]
  /** 齿根圆弧点集 */
  t_root_pts: Vec3[]
}

/**
 * 计算 SpurGear 的全部几何量（`SpurGear.__init__` 的移植）。
 *
 * @throws 与 Python 同款校验：`addendum_coeff <= 0` / `dedendum_coeff <= 0` /
 *   齿根圆直径 <= 0。
 *
 * @param params 齿轮参数（模数/齿数/宽度等）
 * @returns 全部派生几何量
 */
export function spurGearGeometry(params: SpurGearParams): SpurGearGeometry {
  const ka = params.addendum_coeff ?? GEAR_BASE_CONSTANTS.ka
  const kd = params.dedendum_coeff ?? GEAR_BASE_CONSTANTS.kd
  if (params.addendum_coeff !== undefined && params.addendum_coeff !== null && params.addendum_coeff <= 0) {
    throw new RangeError('Addendum coefficient (addendum_coeff) must be greater than 0.')
  }
  if (params.dedendum_coeff !== undefined && params.dedendum_coeff !== null && params.dedendum_coeff <= 0) {
    throw new RangeError('Dedendum coefficient (dedendum_coeff) must be greater than 0.')
  }

  const m = params.module
  const z = params.teeth_number
  const a0 = (params.pressure_angle ?? 20.0) * Math.PI / 180
  const clearance = params.clearance ?? 0.0
  const backlash = params.backlash ?? 0.0
  const helixAngle = (params.helix_angle ?? 0.0) * Math.PI / 180
  const width = params.width

  const d0 = m * z
  const adn = ka / (z / d0)
  const ddn = kd / (z / d0)
  if (2 * ddn + 2 * clearance >= d0) {
    throw new RangeError(
      'Invalid dedendum or clearance: resulting dedendum circle diameter is negative or zero.',
    )
  }

  const da = d0 + 2 * adn
  const dd = d0 - 2 * ddn - 2 * clearance
  const s0 = m * (Math.PI / 2 - backlash * Math.tan(a0))
  const invA0 = Math.tan(a0) - a0

  const r0 = d0 / 2
  const ra = da / 2
  const rd = dd / 2
  const rb = Math.cos(a0) * d0 / 2
  const rr = Math.max(rb, rd)
  const tau = Math.PI * 2 / z

  const twistAngle = helixAngle !== 0
    ? width / (r0 * Math.tan(Math.PI / 2 - helixAngle))
    : 0.0
  const surfaceSplines = helixAngle !== 0 ? GEAR_BASE_CONSTANTS.surface_splines : 2

  const n = GEAR_BASE_CONSTANTS.curve_points

  // 左齿廓渐开线
  const r = linspace(rr, ra, n)
  const phi = r.map((ri) => {
    const cosA = (r0 / ri) * Math.cos(a0)
    const a = Math.acos(Math.min(1, Math.max(-1, cosA)))
    const invA = Math.tan(a) - a
    const s = ri * (s0 / d0 + invA0 - invA)
    return s / ri
  })
  const t_lflank_pts = r.map((ri, i) => vec3(Math.cos(phi[i]) * ri, Math.sin(phi[i]) * ri, 0))

  // 齿顶圆弧
  const bTip = linspace(phi[n - 1], -phi[n - 1], n)
  const t_tip_pts = bTip.map((bi) => vec3(Math.cos(bi) * ra, Math.sin(bi) * ra, 0))

  // 右齿廓 = 左齿廓镜像并反向
  const t_rflank_pts = r.map((ri, i) => vec3(Math.cos(-phi[i]) * ri, Math.sin(-phi[i]) * ri, 0)).reverse()

  // 齿根圆弧：过右齿廓末点、齿根圆中点、左齿廓起点（下一个齿的起点）三点定圆
  const rho = tau - phi[0] * 2
  const p1 = vec3(t_rflank_pts[n - 1].x, t_rflank_pts[n - 1].y, 0)
  const p2 = vec3(Math.cos(-phi[0] - rho / 2) * rd, Math.sin(-phi[0] - rho / 2) * rd, 0)
  const p3 = vec3(Math.cos(-phi[0] - rho) * rr, Math.sin(-phi[0] - rho) * rr, 0)

  const { radius: bcr, center: bcxy } = circle3dBy3points(p1, p2, p3)
  let t1 = Math.atan2(p1.y - bcxy.y, p1.x - bcxy.x)
  let t2 = Math.atan2(p3.y - bcxy.y, p3.x - bcxy.x)
  if (t1 < 0) t1 += Math.PI * 2
  if (t2 < 0) t2 += Math.PI * 2
  const ta = Math.min(t1, t2)
  const tb = Math.max(t1, t2)
  const tRoot = linspace(ta + Math.PI * 2, tb + Math.PI * 2, n)
  const t_root_pts = tRoot.map((t) =>
    vec3(bcxy.x + bcr * Math.cos(t), bcxy.y + bcr * Math.sin(t), 0))

  return {
    m, z, a0, clearance, backlash, helixAngle, width, ka, kd,
    d0, adn, ddn, da, dd, s0, invA0,
    r0, ra, rd, rb, rr, tau,
    twistAngle, surfaceSplines, curvePoints: n,
    t_lflank_pts, t_tip_pts, t_rflank_pts, t_root_pts,
  }
}

/**
 * 计算 RingGear（内部齿）的全部几何量（`RingGear.__init__` 的移植）。
 *
 * 与 SpurGear 的关键差异（内部齿）：
 * - 齿顶圆 `da = d0 − 2·adn`（比分度圆小）、齿根圆 `dd = d0 + 2·ddn + 2·clearance`（比分度圆大）；
 * - 齿厚 `s0 = m·(π/2 + backlash·tan(a0))`（注意是 **+**，外齿是 −）；
 * - 渐开线 `r = linspace(ra, rr)`：从齿顶圆（内）走向齿根圆（外），与外齿方向相反；
 * - 齿顶圆弧落在 `rd`（外齿是 `ra`）、齿根圆弧落在 `ra`（外齿是 `rd`）——齿尖朝外、齿根朝内。
 *
 * `ka` / `kd` 固定取 `GEAR_BASE_CONSTANTS`（内部齿在 `e73874c` 不支持 `addendum_coeff`）。
 * 返回的仍是 `SpurGearGeometry`（点集布局一致），可直接喂给 `toothFaceGrids` /
 * `buildToothFaces`，无需为 RingGear 另写齿面构造。
 *
 * @throws 与 Python 同款校验：齿根圆直径 <= 0。
 *
 * @param params 内部齿参数（模数/齿数/宽度/轮缘宽等）
 * @returns 全部派生几何量（与 `SpurGearGeometry` 同构）
 */
export function ringGearGeometry(params: RingGearParams): SpurGearGeometry {
  const ka = GEAR_BASE_CONSTANTS.ka
  const kd = GEAR_BASE_CONSTANTS.kd
  // 防御性守卫：RingGear 不接受 addendum_coeff，但 JS 调用方可能多传字段——显式拒绝而不是静默忽略。
  if ((params as { addendum_coeff?: unknown }).addendum_coeff !== undefined) {
    throw new Error('RingGear does not support addendum_coeff at this source revision (e73874c).')
  }

  const m = params.module
  const z = params.teeth_number
  const a0 = (params.pressure_angle ?? 20.0) * Math.PI / 180
  const clearance = params.clearance ?? 0.0
  const backlash = params.backlash ?? 0.0
  const helixAngle = (params.helix_angle ?? 0.0) * Math.PI / 180
  const width = params.width
  // 注意：`rim_width` 只用于实体构造阶段的 rim 半径（`ring_gear.ts`），
  // 齿廓几何量本身与它无关，故此函数不读该字段。

  const d0 = m * z
  const adn = ka / (z / d0)
  const ddn = kd / (z / d0)
  if (2 * ddn + 2 * clearance >= d0) {
    throw new RangeError(
      'Invalid dedendum or clearance: resulting dedendum circle diameter is negative or zero.',
    )
  }

  const da = d0 - 2 * adn
  const dd = d0 + 2 * ddn + 2 * clearance
  const s0 = m * (Math.PI / 2 + backlash * Math.tan(a0)) // 内部齿：+
  const invA0 = Math.tan(a0) - a0

  const r0 = d0 / 2
  const ra = da / 2
  const rd = dd / 2
  const rb = Math.cos(a0) * d0 / 2
  const rr = Math.max(rb, rd)
  const tau = Math.PI * 2 / z

  const twistAngle = helixAngle !== 0
    ? width / (r0 * Math.tan(Math.PI / 2 - helixAngle))
    : 0.0
  const surfaceSplines = helixAngle !== 0 ? GEAR_BASE_CONSTANTS.surface_splines : 2

  const n = GEAR_BASE_CONSTANTS.curve_points

  // 左齿廓渐开线：r 从齿顶圆 ra（内）到 rr（外）
  const r = linspace(ra, rr, n)
  const phi = r.map((ri) => {
    const cosA = (r0 / ri) * Math.cos(a0)
    const a = Math.acos(Math.min(1, Math.max(-1, cosA)))
    const invA = Math.tan(a) - a
    const s = ri * (s0 / d0 + invA0 - invA)
    return s / ri
  })
  const t_lflank_pts = r.map((ri, i) => vec3(Math.cos(phi[i]) * ri, Math.sin(phi[i]) * ri, 0))

  // 齿顶圆弧：落在 rd（外齿落在 ra）
  const bTip = linspace(phi[n - 1], -phi[n - 1], n)
  const t_tip_pts = bTip.map((bi) => vec3(Math.cos(bi) * rd, Math.sin(bi) * rd, 0))

  // 右齿廓 = 左齿廓镜像并反向
  const t_rflank_pts = r.map((ri, i) => vec3(Math.cos(-phi[i]) * ri, Math.sin(-phi[i]) * ri, 0)).reverse()

  // 齿根圆弧：过右齿廓末点、齿根圆（ra）中点、左齿廓起点三点定圆
  const rho = tau - phi[0] * 2
  const p1 = vec3(t_rflank_pts[n - 1].x, t_rflank_pts[n - 1].y, 0)
  const p2 = vec3(Math.cos(-phi[0] - rho / 2) * ra, Math.sin(-phi[0] - rho / 2) * ra, 0)
  const p3 = vec3(Math.cos(-phi[0] - rho) * ra, Math.sin(-phi[0] - rho) * ra, 0)

  const { radius: bcr, center: bcxy } = circle3dBy3points(p1, p2, p3)
  let t1 = Math.atan2(p1.y - bcxy.y, p1.x - bcxy.x)
  let t2 = Math.atan2(p3.y - bcxy.y, p3.x - bcxy.x)
  if (t1 < 0) t1 += Math.PI * 2
  if (t2 < 0) t2 += Math.PI * 2
  const ta = Math.min(t1, t2)
  const tb = Math.max(t1, t2)
  // 注意：内部齿 `ring_gear.py` 用 **递减** 采样 `linspace(t2 + 2π, t1 + 2π)`（与外齿
  // `spur_gear.py` 的递增相反）。必须保持同向，否则大齿数非对称齿根弧整段错开（实测 ~2.6mm）。
  const tRoot = linspace(tb + Math.PI * 2, ta + Math.PI * 2, n)
  const t_root_pts = tRoot.map((t) =>
    vec3(bcxy.x + bcr * Math.cos(t), bcxy.y + bcr * Math.sin(t), 0))

  return {
    m, z, a0, clearance, backlash, helixAngle, width, ka, kd,
    d0, adn, ddn, da, dd, s0, invA0,
    r0, ra, rd, rb, rr, tau,
    twistAngle, surfaceSplines, curvePoints: n,
    t_lflank_pts, t_tip_pts, t_rflank_pts, t_root_pts,
  }
}

/** CrossedHelicalGear 构造参数（逐字沿用 `crossed_helical_gear.py::CrossedHelicalGear.__init__`）。
 *
 * 与 `SpurGear` 不同：**不接受** `addendum_coeff` / `dedendum_coeff`（源码该构造函数没有这两个形参）。 */
export interface CrossedHelicalGearParams {
  module: number
  teeth_number: number
  width: number
  pressure_angle?: number
  helix_angle?: number
  clearance?: number
  backlash?: number
}

/**
 * 计算 CrossedHelicalGear（交错轴斜齿轮）的全部几何量
 * （`crossed_helical_gear.py::CrossedHelicalGear.__init__` 的移植）。
 *
 * 与 SpurGear 的**根本差异**是「端面模数」而非「法向模数」：
 * - 端面压力角 `at0 = arctan(a0 / cos(helix))`——⚠️ 源码里 `a0` 是**弧度值**直接除以
 *   `cos(helix)`（并非 `tan(a0)`），这是 cq_gears 的原始写法，必须逐字复刻，
 *   否则 `rb` 会偏（实测 case30 rb 由 20.2898 偏到 20.1227）；
 * - 端面模数 `mt = m / cos(helix)`，分度圆直径 `d0 = mt·z`（SpurGear 是 `m·z`）；
 * - 分度圆齿厚 `s0 = r0·π/z`（SpurGear 是 `m·(π/2 − backlash·tan(a0))`）；
 * - 基圆半径 `rb = cos(at0)·r0`。
 *
 * 其余（渐开线采样、齿顶/齿根圆弧、扭转角、齿面行数）与 SpurGear 同构，返回的仍是
 * `SpurGearGeometry`，可直接喂给 `toothFaceGrids` / `buildToothFaces`。
 *
 * 源码此处**没有**齿根圆直径校验（与 SpurGear 不同），故不复刻该抛错。
 *
 * @param params 交错轴斜齿轮参数（模数/齿数/宽度/螺旋角等）
 * @returns 全部派生几何量（与 `SpurGearGeometry` 同构）
 */
export function crossedHelicalGearGeometry(params: CrossedHelicalGearParams): SpurGearGeometry {
  const ka = GEAR_BASE_CONSTANTS.ka
  const kd = GEAR_BASE_CONSTANTS.kd

  const m = params.module
  const z = params.teeth_number
  const a0 = (params.pressure_angle ?? 20.0) * Math.PI / 180
  const clearance = params.clearance ?? 0.0
  const backlash = params.backlash ?? 0.0
  const helixAngle = (params.helix_angle ?? 0.0) * Math.PI / 180
  const width = params.width

  // ⚠️ 源码写法：a0（弧度）直接除以 cos(helix)，不是 tan(a0)。
  const at0 = Math.atan(a0 / Math.cos(helixAngle))
  const mt = m / Math.cos(helixAngle)

  const d0 = mt * z
  const adn = ka / (z / d0)
  const ddn = kd / (z / d0)

  const da = d0 + 2 * adn
  const dd = d0 - 2 * ddn - 2 * clearance
  const invA0 = Math.tan(at0) - at0

  const r0 = d0 / 2
  const ra = da / 2
  const rd = dd / 2
  const rb = Math.cos(at0) * r0
  const rr = Math.max(rb, rd)
  const tau = Math.PI * 2 / z

  const s0 = r0 * Math.PI / z

  const twistAngle = helixAngle !== 0
    ? width / (r0 * Math.tan(Math.PI / 2 - helixAngle))
    : 0.0
  const surfaceSplines = helixAngle !== 0 ? GEAR_BASE_CONSTANTS.surface_splines : 2

  const n = GEAR_BASE_CONSTANTS.curve_points

  // 左齿廓渐开线（用端面压力角 at0）
  const r = linspace(rr, ra, n)
  const phi = r.map((ri) => {
    const cosA = (r0 / ri) * Math.cos(at0)
    const a = Math.acos(Math.min(1, Math.max(-1, cosA)))
    const invA = Math.tan(a) - a
    const s = ri * (s0 / d0 + invA0 - invA)
    return s / ri
  })
  const t_lflank_pts = r.map((ri, i) => vec3(Math.cos(phi[i]) * ri, Math.sin(phi[i]) * ri, 0))

  // 齿顶圆弧
  const bTip = linspace(phi[n - 1], -phi[n - 1], n)
  const t_tip_pts = bTip.map((bi) => vec3(Math.cos(bi) * ra, Math.sin(bi) * ra, 0))

  // 右齿廓 = 左齿廓镜像并反向
  const t_rflank_pts = r.map((ri, i) => vec3(Math.cos(-phi[i]) * ri, Math.sin(-phi[i]) * ri, 0)).reverse()

  // 齿根圆弧（与外齿一致：p2 在 rd、p3 在 rr，递增采样）
  const rho = tau - phi[0] * 2
  const p1 = vec3(t_rflank_pts[n - 1].x, t_rflank_pts[n - 1].y, 0)
  const p2 = vec3(Math.cos(-phi[0] - rho / 2) * rd, Math.sin(-phi[0] - rho / 2) * rd, 0)
  const p3 = vec3(Math.cos(-phi[0] - rho) * rr, Math.sin(-phi[0] - rho) * rr, 0)

  const { radius: bcr, center: bcxy } = circle3dBy3points(p1, p2, p3)
  let t1 = Math.atan2(p1.y - bcxy.y, p1.x - bcxy.x)
  let t2 = Math.atan2(p3.y - bcxy.y, p3.x - bcxy.x)
  if (t1 < 0) t1 += Math.PI * 2
  if (t2 < 0) t2 += Math.PI * 2
  const ta = Math.min(t1, t2)
  const tb = Math.max(t1, t2)
  const tRoot = linspace(ta + Math.PI * 2, tb + Math.PI * 2, n)
  const t_root_pts = tRoot.map((t) =>
    vec3(bcxy.x + bcr * Math.cos(t), bcxy.y + bcr * Math.sin(t), 0))

  return {
    m, z, a0, clearance, backlash, helixAngle, width, ka, kd,
    d0, adn, ddn, da, dd, s0, invA0,
    r0, ra, rd, rb, rr, tau,
    twistAngle, surfaceSplines, curvePoints: n,
    t_lflank_pts, t_tip_pts, t_rflank_pts, t_root_pts,
  }
}

/** BevelGear 构造参数（逐字沿用 `bevel_gear.py::BevelGear.__init__`）。
 *
 * ⚠️ 与 SpurGear 不同：用 `cone_angle`（分度锥角，度）而不是 `width`；
 * 且 `cone_angle` / `face_width` 是**位置参数**（Python 签名里排在压力角之前）。 */
export interface BevelGearParams {
  module: number
  teeth_number: number
  /** 分度锥角（度） */
  cone_angle: number
  /** 齿宽（沿分度锥母线的长度） */
  face_width: number
  pressure_angle?: number
  helix_angle?: number
  clearance?: number
  backlash?: number
}

/** `BevelGear` 覆写 `GearBase` 的类常量（`bevel_gear.py:32`；`helix_angle = 0` 时被改成 2）。 */
export const BEVEL_SURFACE_SPLINES = 12

/** BevelGear 的全部派生几何量与四段齿廓点集（`BevelGear.__init__` 的产物）。
 *
 * ⚠️ 四段点集与 SpurGear 不同：它们是**单位球面上的点**（`r = 1`），
 * 真正落到齿面上要乘以每行的锥距 `r ∈ [tc_f, pc_f]`（见 `bevel_gear.ts`）。 */
export interface BevelGearGeometry {
  /** 模数 m */
  m: number
  /** 齿数 z */
  z: number
  /** 压力角（弧度） */
  a0: number
  clearance: number
  backlash: number
  /** 螺旋角（弧度） */
  helixAngle: number
  /** 齿宽（锥距方向） */
  faceWidth: number
  ka: number
  kd: number
  /** 分度圆半径 rp = m·z/2 */
  rp: number
  /** 大球半径（= 分度锥母线长）gs_r = rp / sin(gamma_p) */
  gsR: number
  /** 分度锥角（弧度） */
  gammaP: number
  /** 基锥角（弧度） */
  gammaB: number
  /** 面锥角（弧度） */
  gammaF: number
  /** 根锥角（弧度） */
  gammaR: number
  /** 齿距角 2π/z */
  tau: number
  /** 锥顶到齿轮底面的距离 cone_h = cos(gamma_r)·gs_r */
  coneH: number
  /** 齿镜像点方位角 mp_theta = π/z + 2·s_inv(gamma_b, gamma_p) */
  mpTheta: number
  /** 扭转角（弧度；helix_angle = 0 时为 0） */
  twistAngle: number
  /** 齿面点阵行数（helix_angle = 0 时为 2，否则 12） */
  surfaceSplines: number
  curvePoints: number
  /** 左齿廓渐开线点集（**单位球面**） */
  t_lflank_pts: Vec3[]
  /** 齿顶圆弧点集（**单位球面**） */
  t_tip_pts: Vec3[]
  /** 右齿廓渐开线点集（**单位球面**） */
  t_rflank_pts: Vec3[]
  /** 齿根圆弧点集（**单位球面**） */
  t_root_pts: Vec3[]
}

/**
 * 计算 BevelGear（锥齿轮）的全部几何量（`BevelGear.__init__` 的移植）。
 *
 * 与 SpurGear 的根本差异：齿廓画在**单位球面**上（球面渐开线），
 * 齿面是「球面齿廓 × 锥距」的直纹面；`gamma_b/_f/_r` 分别是基/面/根锥角，
 * 高度一律用 `r·cos(gamma)` 折算到齿轮轴（+Z）上。
 *
 * @throws `gs_r <= face_width` 时抛 RangeError（Python 同款 assert）；
 *   `twist_angle` 为 NaN 时抛 Error（Python 同款 assert）。
 *
 * @param params 锥齿轮参数（模数/齿数/锥角/齿宽等）
 * @returns 全部派生几何量
 */
export function bevelGearGeometry(params: BevelGearParams): BevelGearGeometry {
  const ka = GEAR_BASE_CONSTANTS.ka
  const kd = GEAR_BASE_CONSTANTS.kd

  const m = params.module
  const z = params.teeth_number
  const a0 = ((params.pressure_angle ?? 20.0) * Math.PI) / 180.0
  const clearance = params.clearance ?? 0.0
  const backlash = params.backlash ?? 0.0
  const helixAngle = ((params.helix_angle ?? 0.0) * Math.PI) / 180.0
  const faceWidth = params.face_width

  const gammaP = (params.cone_angle * Math.PI) / 180.0

  const rp = (m * z) / 2.0
  const gsR = rp / Math.sin(gammaP)
  if (!(gsR > faceWidth)) {
    throw new RangeError(
      `face_width value is too big, it should be < ${gsR.toFixed(3)}`,
    )
  }

  const gammaB = Math.asin(Math.cos(a0) * Math.sin(gammaP))
  const gammaF = gammaP + Math.atan((ka * m) / gsR)
  const gammaR = gammaP - Math.atan((kd * m) / gsR)

  const tau = (Math.PI * 2.0) / z

  let twistAngle: number
  let surfaceSplines: number
  if (helixAngle !== 0.0) {
    // 扭转（torsion）角
    const beta = Math.atan((faceWidth * Math.tan(helixAngle)) / (2.0 * gsR - faceWidth))
    twistAngle = Math.asin((gsR / rp) * Math.sin(beta)) * 2.0
    surfaceSplines = BEVEL_SURFACE_SPLINES
  } else {
    surfaceSplines = 2
    twistAngle = 0.0
  }
  if (Number.isNaN(twistAngle)) {
    throw new Error('Twist angle is NaN')
  }

  const coneH = Math.cos(gammaR) * gsR

  const phiR = sInv(gammaB, gammaP)
  const mpTheta = Math.PI / z + 2.0 * phiR

  const n = GEAR_BASE_CONSTANTS.curve_points

  // 左齿廓：球面渐开线
  const gammaTr = Math.max(gammaB, gammaR)
  const gamma = linspace(gammaTr, gammaF, n)
  const theta = gamma.map((g) => sInv(gammaB, g) + backlash / (m * z))
  const t_lflank_pts = gamma.map((g, i) => sphereToCartesian(1.0, g, theta[i]))

  // 齿顶圆弧（恒在 gamma_f）
  const thetaTip = linspace(theta[n - 1], mpTheta - theta[n - 1], n)
  const t_tip_pts = thetaTip.map((t) => sphereToCartesian(1.0, gammaF, t))

  // 右齿廓 = 左齿廓的镜像（方位角取 mp_theta − theta）并反向
  const t_rflank_pts: Vec3[] = []
  for (let i = n - 1; i >= 0; i--) {
    t_rflank_pts.push(sphereToCartesian(1.0, gamma[i], mpTheta - theta[i]))
  }

  // 齿根圆弧
  let t_root_pts: Vec3[]
  if (gammaR < gammaB) {
    // 根锥在基锥之内：过右齿廓末点、基锥上的齿槽中点、根锥上的齿槽中点三点定圆
    const p1 = t_rflank_pts[n - 1]
    const p2 = sphereToCartesian(1.0, gammaB, theta[0] + tau)
    const p3 = sphereToCartesian(1.0, gammaR, (tau + mpTheta) / 2.0)
    const { center: rcc } = circle3dBy3points(p1, p2, p3)
    const rccGamma = Math.acos(
      dot(p3, rcc) / (norm(p3) * norm(rcc)),
    )
    const p1p3 = angleBetween(rcc, p1, p3)
    const aStart = (Math.PI - p1p3 * 2.0) / 2.0
    const aEnd = -aStart + Math.PI
    t_root_pts = sArc(
      1.0, gammaR + rccGamma, (tau + mpTheta) / 2.0, rccGamma,
      Math.PI / 2.0 + aStart, Math.PI / 2.0 + aEnd, n,
    )
  } else {
    const rTheta = linspace(mpTheta - theta[0], theta[0] + tau, n)
    t_root_pts = rTheta.map((t) => sphereToCartesian(1.0, gammaTr, t))
  }

  return {
    m, z, a0, clearance, backlash, helixAngle, faceWidth, ka, kd,
    rp, gsR, gammaP, gammaB, gammaF, gammaR, tau, coneH, mpTheta,
    twistAngle, surfaceSplines, curvePoints: n,
    t_lflank_pts, t_tip_pts, t_rflank_pts, t_root_pts,
  }
}

/** 四段齿廓的名字（`_build_tooth_faces` 的迭代顺序，勿改）。 */
export const TOOTH_SEGMENTS = ['lflank', 'tip', 'rflank', 'root'] as const
/** 单个齿廓段的名字。 */
export type ToothSegment = typeof TOOTH_SEGMENTS[number]

/**
 * 取某段齿廓的基础点集（z=0 平面上的轮廓点，与 Python 内部数组逐点一致）。
 *
 * @param g 已计算的齿轮几何量
 * @param seg 齿廓段名
 * @returns 该段的点集
 */
export function segmentPoints(
  g: SpurGearGeometry | WormGeometry | BevelGearGeometry, seg: ToothSegment,
): Vec3[] {
  switch (seg) {
    case 'lflank': return g.t_lflank_pts
    case 'tip': return g.t_tip_pts
    case 'rflank': return g.t_rflank_pts
    case 'root': return g.t_root_pts
  }
}

/** 一个齿面段的行 × 列点阵。 */
export interface ToothGrid {
  segment: ToothSegment
  rows: number
  cols: number
  /** 行主序，`points[r][c]` */
  points: Vec3[][]
}

/**
 * 复现 `SpurGear._build_tooth_faces` 的点阵构造。
 *
 * 注意扭转用 `pts @ rotation_matrix(...)`（行向量左乘 ⇒ 实际转 −a，见 `math.ts` 顶部说明），
 * 与 Python 逐字一致。
 *
 * @param twistA 起始扭转角（弧度）
 * @param twistB 终止扭转角（弧度）
 * @param zPos   起始 z
 * @param width  该段宽度
 * @param g 齿轮几何量
 * @returns 4 段齿廓各自的 row×col 点阵
 */
export function toothFaceGrids(
  g: SpurGearGeometry,
  twistA = 0.0,
  twistB: number = g.twistAngle,
  zPos = 0.0,
  width: number = g.width,
): ToothGrid[] {
  const twistSpan = Math.abs(g.twistAngle)
  const surfSplines = Math.max(1, Math.ceil(twistSpan / Math.PI)) * g.surfaceSplines
  const angles = linspace(twistA, twistB, surfSplines)
  const zs = linspace(zPos, zPos + width, surfSplines)

  return TOOTH_SEGMENTS.map((seg) => {
    const base = segmentPoints(g, seg)
    const points: Vec3[][] = []
    for (let r = 0; r < surfSplines; r++) {
      const z = zs[r]
      const row = base.map((p) => vec3(p.x, p.y, z))
      points.push(rotateRows(row, vec3(0, 0, 1), angles[r]))
    }
    return { segment: seg, rows: surfSplines, cols: base.length, points }
  })
}

/**
 * 按 cq_gears 类名分派到对应的齿廓几何计算（manifest 的 `class` 字段直接驱动）。
 *
 * `HerringboneGear` 继承 `SpurGear`、`HerringboneRingGear` 继承 `RingGear`，
 * 其**齿廓数学**与父类相同（人字形的差异只体现在建面阶段的 `_build_tooth_faces` 覆盖），
 * 故分派到同一函数。
 *
 * @throws 未支持的类名直接抛错（不静默退回 SpurGear，避免掩盖分派错误）
 *
 * @param className cq_gears 类名（`SpurGear` / `RingGear` / `CrossedHelicalGear` …）
 * @param args 该类构造函数的参数（逐字取自 manifest）
 * @returns 全部派生几何量
 */
export function gearGeometryForClass(
  className: string,
  args: Record<string, unknown>,
): SpurGearGeometry | WormGeometry | BevelGearGeometry {
  switch (className) {
    case 'SpurGear':
    case 'HerringboneGear':
      return spurGearGeometry(args as unknown as SpurGearParams)
    case 'RingGear':
    case 'HerringboneRingGear':
      return ringGearGeometry(args as unknown as RingGearParams)
    case 'CrossedHelicalGear':
      return crossedHelicalGearGeometry(args as unknown as CrossedHelicalGearParams)
    case 'Worm':
      return wormGeometry(args as unknown as WormParams)
    case 'BevelGear':
      return bevelGearGeometry(args as unknown as BevelGearParams)
    default:
      throw new Error(`gearGeometryForClass: unsupported gear class '${className}'`)
  }
}

/** RackGear 构造参数（参数名逐字沿用 Python `RackGear.__init__`）。 */
export interface RackGearParams {
  module: number
  length: number
  width: number
  height: number
  pressure_angle?: number
  helix_angle?: number
  clearance?: number
  backlash?: number
}

/** RackGear 的全部派生几何量与四段齿廓点集（`RackGear.__init__` 的产物）。 */
export interface RackGearGeometry {
  m: number
  /** 压力角（弧度） */
  a0: number
  clearance: number
  backlash: number
  /** 螺旋角（弧度） */
  helixAngle: number
  width: number
  length: number
  height: number
  /** 齿顶线（+y） */
  la: number
  /** 齿根线（−y） */
  ld: number
  /** 分度线上的齿厚（x 向） */
  s0: number
  /** 齿廓总高（la − ld） */
  toothHeight: number
  /** 齿数 z = ceil(length / (π·m)) */
  z: number
  t_lflank_pts: Vec3[]
  t_tip_pts: Vec3[]
  t_rflank_pts: Vec3[]
  t_root_pts: Vec3[]
}

/**
 * 计算 RackGear 的全部几何量（`RackGear.__init__` 的移植）。
 *
 * 齿条齿廓是**梯形直线段**（每段只有 2 个点），沿 X 以 π·m 为周期重复；
 * 齿深方向是 +y（la 在上、ld 在下），实体沿 Z 挤出 width。
 * `ka`/`kd` 沿用 GearBase 类常量（RackGear 构造函数不接受 addendum/dedendum 覆盖）。
 *
 * @param params 齿条参数（模数/长度/宽/高/螺旋角等）
 * @returns 全部派生几何量
 */
export function rackGearGeometry(params: RackGearParams): RackGearGeometry {
  const ka = GEAR_BASE_CONSTANTS.ka
  const kd = GEAR_BASE_CONSTANTS.kd
  const m = params.module
  const a0 = ((params.pressure_angle ?? 20.0) * Math.PI) / 180.0
  const clearance = params.clearance ?? 0.0
  const backlash = params.backlash ?? 0.0
  const helixAngle = ((params.helix_angle ?? 0.0) * Math.PI) / 180.0
  const width = params.width
  const length = params.length
  const height = params.height

  const la = ka * m
  const ld = -(kd * m + clearance)

  const s0 = (m * (Math.PI / 2.0 - backlash * Math.tan(a0))) / 2.0

  const p1x = Math.tan(a0) * Math.abs(ld)
  const p1p2 = (Math.abs(la) + Math.abs(ld)) / Math.cos(a0)

  const p1 = vec3(-s0 - p1x, ld, 0.0)
  const p2 = vec3(Math.sin(a0) * p1p2 + p1.x, Math.cos(a0) * p1p2 + p1.y, 0.0)
  const p3 = vec3(-p2.x, p2.y, 0.0)
  const p4 = vec3(-p1.x, p1.y, 0.0)
  const p5 = vec3(p4.x + (Math.PI * m - p4.x * 2.0), p4.y, 0.0)

  const toothHeight = Math.abs(la) + Math.abs(ld)
  const z = Math.ceil(length / (Math.PI * m))

  return {
    m, a0, clearance, backlash, helixAngle, width, length, height,
    la, ld, s0, toothHeight, z,
    t_lflank_pts: [p1, p2],
    t_tip_pts: [p2, p3],
    t_rflank_pts: [p3, p4],
    t_root_pts: [p4, p5],
  }
}

/** Worm 构造参数（参数名逐字沿用 Python `Worm.__init__`）。 */
export interface WormParams {
  module: number
  /** 导程角（度） */
  lead_angle: number
  /** 蜗杆头数 */
  n_threads: number
  /** 蜗杆长度（轴向，沿 X） */
  length: number
  pressure_angle?: number
  clearance?: number
  backlash?: number
}

/** Worm 的全部派生几何量与四段齿廓点集（`Worm.__init__` 的产物）。 */
export interface WormGeometry {
  m: number
  /** 压力角（弧度） */
  a0: number
  clearance: number
  backlash: number
  /** 导程角（弧度） */
  leadAngle: number
  length: number
  /** 头数 */
  nThreads: number
  /** 分度圆半径 */
  r0: number
  /** 齿顶圆半径 */
  ra: number
  /** 齿根圆半径 */
  rd: number
  /** 齿顶线（+y） */
  la: number
  /** 齿根线（−y） */
  ld: number
  /** 分度线上的齿厚（x 向，半齿距） */
  s0: number
  /** 齿廓总高（la − ld，Python `self.tooth_height`） */
  toothHeight: number
  t_lflank_pts: Vec3[]
  t_tip_pts: Vec3[]
  t_rflank_pts: Vec3[]
  t_root_pts: Vec3[]
}

/**
 * 计算 Worm 的全部几何量（`Worm.__init__` 的移植）。
 *
 * 齿廓公式与 `RackGear.__init__` **逐字同构**（梯形直线段 p1–p5）——cq 里 Worm
 * 的齿廓本来就是「展开到分度圆柱切平面上的齿条」。差异只在分度半径：
 * `d0 = n_threads·m / |tan(lead_angle)|`，以及半径向的 ra/rd。
 *
 * @param params 蜗杆参数（模数/导程角/头数/长度等）
 * @returns 全部派生几何量
 */
export function wormGeometry(params: WormParams): WormGeometry {
  const ka = GEAR_BASE_CONSTANTS.ka
  const kd = GEAR_BASE_CONSTANTS.kd
  const m = params.module
  const a0 = ((params.pressure_angle ?? 20.0) * Math.PI) / 180.0
  const clearance = params.clearance ?? 0.0
  const backlash = params.backlash ?? 0.0
  const leadAngle = (params.lead_angle * Math.PI) / 180.0
  const length = params.length
  const nThreads = params.n_threads

  const d0 = (nThreads * m) / Math.abs(Math.tan(leadAngle))
  const r0 = d0 / 2.0

  const adn = ka * m
  const ddn = kd * m

  const la = adn
  const ld = -(ddn + clearance)

  const ra = r0 + adn
  const rd = r0 - ddn

  const s0 = (m * (Math.PI / 2.0 - backlash * Math.tan(a0))) / 2.0

  const p1x = Math.tan(a0) * Math.abs(ld)
  const p1p2 = (Math.abs(la) + Math.abs(ld)) / Math.cos(a0)

  const p1 = vec3(-s0 - p1x, ld, 0.0)
  const p2 = vec3(Math.sin(a0) * p1p2 + p1.x, Math.cos(a0) * p1p2 + p1.y, 0.0)
  const p3 = vec3(-p2.x, p2.y, 0.0)
  const p4 = vec3(-p1.x, p1.y, 0.0)
  const p5 = vec3(p4.x + (Math.PI * m - p4.x * 2.0), p4.y, 0.0)

  const toothHeight = Math.abs(la) + Math.abs(ld)

  return {
    m, a0, clearance, backlash, leadAngle, length, nThreads,
    r0, ra, rd, la, ld, s0, toothHeight,
    t_lflank_pts: [p1, p2],
    t_tip_pts: [p2, p3],
    t_rflank_pts: [p3, p4],
    t_root_pts: [p4, p5],
  }
}
