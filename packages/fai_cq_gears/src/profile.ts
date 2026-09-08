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
  circle3dBy3points, cross, dot, linspace, normalize, norm,
  rotateRows, sub, vec3, type Vec3,
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
export function segmentPoints(g: SpurGearGeometry, seg: ToothSegment): Vec3[] {
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
