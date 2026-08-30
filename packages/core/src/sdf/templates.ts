/** SDF 内置模板库 — 每个模板既是功能也是教学示例 */
import type { SdfTemplate } from './types'

/** Built-in SDF templates: each template is both a feature and a teaching example. */
export const SDF_TEMPLATES: SdfTemplate[] = [
  {
    id: 'sphere',
    name: '球体',
    category: 'primitive',
    description: '最简 SDF：sqrt(x²+y²+z²) - r',
    defaultBounds: { min: [-12, -12, -12], max: [12, 12, 12] },
    code: `// 球体 -- 最简 SDF：sqrt(x²+y²+z²) - r
// @param radius 10 半径
function sdf(x, y, z) {
  return radius - Math.sqrt(x*x + y*y + z*z)
}

function bounds() {
  const r = radius
  return { min: [-r, -r, -r], max: [r, r, r] }
}`,
  },
  {
    id: 'torus',
    name: '圆环',
    category: 'primitive',
    description: '二维到一维的降维技巧',
    defaultBounds: { min: [-22, -22, -22], max: [22, 22, 22] },
    code: `// 圆环 -- 二维到一维的降维技巧
// @param majorRadius 15 大半径
// @param minorRadius 5 小半径
function sdf(x, y, z) {
  const qx = Math.sqrt(x*x + y*y) - majorRadius
  return Math.sqrt(qx*qx + z*z) - minorRadius
}

function bounds() {
  const r = majorRadius + minorRadius
  return { min: [-r, -r, -r], max: [r, r, r] }
}`,
  },
  {
    id: 'ripple-sphere',
    name: '波纹球体',
    category: 'primitive',
    description: '用 sin 调制半径',
    defaultBounds: { min: [-16, -16, -16], max: [16, 16, 16] },
    code: `// 波纹球体 -- 用 sin 调制半径
// @param radius 10 半径
// @param freq 3 波纹频率
// @param amp 1 波纹幅度
function sdf(x, y, z) {
  const r = Math.sqrt(x*x + y*y + z*z)
  const ripple = amp * Math.sin(freq * r)
  return (radius + ripple) - r
}

function bounds() {
  const r = radius + amp
  return { min: [-r, -r, -r], max: [r, r, r] }
}`,
  },
  {
    id: 'gyroid',
    name: 'Gyroid 极小曲面',
    category: 'periodic',
    description: '周期函数组合',
    defaultBounds: { min: [-7, -7, -7], max: [7, 7, 7] },
    code: `// Gyroid 极小曲面 -- 周期函数组合
// @param period 6.28 周期
// @param thickness 0.5 壁厚
function sdf(x, y, z) {
  const k = 2 * Math.PI / period
  const g = Math.cos(k*x) * Math.sin(k*y)
           + Math.cos(k*y) * Math.sin(k*z)
           + Math.cos(k*z) * Math.sin(k*x)
  return thickness - Math.abs(g)
}

function bounds() {
  const p = period
  return { min: [-p, -p, -p], max: [p, p, p] }
}`,
  },
  {
    id: 'metaball',
    name: '球体混合',
    category: 'blend',
    description: 'exp-sum-log 平滑混合',
    defaultBounds: { min: [-18, -18, -18], max: [18, 18, 18] },
    code: `// 球体混合 -- exp-sum-log 平滑混合
// @param radius1 7 球1半径
// @param radius2 6 球2半径
// @param blend 2 混合系数
function sdf(x, y, z) {
  const d1 = Math.sqrt((x+5)*(x+5) + y*y + z*z) - radius1
  const d2 = Math.sqrt((x-5)*(x-5) + y*y + z*z) - radius2
  const e = blend
  return Math.log(Math.exp(-e*d1) + Math.exp(-e*d2)) / e
}

function bounds() {
  const r = Math.max(radius1, radius2) + 5
  return { min: [-r, -r, -r], max: [r, r, r] }
}`,
  },
  {
    id: 'cube-frame',
    name: '立方体框架',
    category: 'primitive',
    description: 'max 做交集、min 做并集',
    defaultBounds: { min: [-22, -22, -22], max: [22, 22, 22] },
    code: `// 立方体框架 -- max 做交集、min 做并集
// @param size 20 边长
// @param thickness 1.5 杆径
function sdf(x, y, z) {
  const h = size / 2
  const q = [Math.abs(x) - h, Math.abs(y) - h, Math.abs(z) - h]
  const d1 = Math.sqrt(q[1]*q[1] + q[2]*q[2]) - thickness
  const d2 = Math.sqrt(q[0]*q[0] + q[2]*q[2]) - thickness
  const d3 = Math.sqrt(q[0]*q[0] + q[1]*q[1]) - thickness
  return Math.min(Math.min(d1, d2), d3)
}

function bounds() {
  const h = size / 2 + thickness
  return { min: [-h, -h, -h], max: [h, h, h] }
}`,
  },
  {
    id: 'mandelbulb',
    name: 'Mandelbulb 分形',
    category: 'fractal',
    description: '循环迭代 + 球坐标变换',
    defaultBounds: { min: [-4, -4, -4], max: [4, 4, 4] },
    code: `// Mandelbulb 分形 -- 循环迭代 + 球坐标变换
// @param power 8 分形幂次
// @param radius 3 最大半径
// @param maxIter 20 迭代次数 int
function sdf(x, y, z) {
  let w = [x, y, z]
  let dr = 1.0
  let r = 0.0
  for (let i = 0; i < maxIter; i++) {
    r = Math.sqrt(w[0]*w[0] + w[1]*w[1] + w[2]*w[2])
    if (r > radius) break
    const theta = Math.acos(w[2] / r)
    const phi = Math.atan2(w[1], w[0])
    const rn = Math.pow(r, power)
    dr = Math.pow(r, power - 1.0) * power * dr + 1.0
    const thetaN = theta * power
    const phiN = phi * power
    w = [
      rn * Math.sin(thetaN) * Math.cos(phiN) + x,
      rn * Math.sin(thetaN) * Math.sin(phiN) + y,
      rn * Math.cos(thetaN) + z,
    ]
  }
  return 0.5 * Math.log(r) * r / dr
}

function bounds() {
  const r = radius + 1
  return { min: [-r, -r, -r], max: [r, r, r] }
}`,
  },
  {
    id: 'cylinder',
    name: '圆柱 (布尔)',
    category: 'primitive',
    description: '无限圆柱 + 平面截断 (交集)',
    defaultBounds: { min: [-9, -9, -9], max: [9, 9, 9] },
    code: `// 圆柱 (布尔) -- 无限圆柱 + 平面截断 (交集)
// @param radius 8 圆柱半径
// @param height 15 截断高度
function sdf(x, y, z) {
  const cyl = Math.sqrt(x*x + y*y) - radius
  const cap = Math.abs(z) - height / 2
  return Math.max(cyl, cap)
}

function bounds() {
  const h = height / 2
  return { min: [-radius, -radius, -h], max: [radius, radius, h] }
}`,
  },
  {
    id: 'gyroid-lattice',
    name: '晶格填充',
    category: 'periodic',
    description: 'Gyroid 与立方体求交',
    defaultBounds: { min: [-11, -11, -11], max: [11, 11, 11] },
    code: `// 晶格填充 -- Gyroid 与立方体求交
// @param period 5 周期
// @param thickness 0.3 壁厚
// @param size 20 立方体边长
function sdf(x, y, z) {
  const k = 2 * Math.PI / period
  const g = Math.cos(k*x) * Math.sin(k*y)
           + Math.cos(k*y) * Math.sin(k*z)
           + Math.cos(k*z) * Math.sin(k*x)
  const gyroidShell = thickness - Math.abs(g)
  const h = size / 2
  const box = Math.max(Math.abs(x) - h, Math.abs(y) - h, Math.abs(z) - h)
  return Math.max(gyroidShell, box)
}

function bounds() {
  const h = size / 2
  return { min: [-h, -h, -h], max: [h, h, h] }
}`,
  },
  {
    id: 'noise-terrain',
    name: '噪声地形',
    category: 'utility',
    description: '多频正弦叠加模拟地形',
    defaultBounds: { min: [-22, -22, -10], max: [22, 22, 14] },
    code: `// 噪声地形 -- 多频正弦叠加模拟地形
// @param scale 20 地形尺度
// @param rough 0.5 粗糙度
// @param height 8 最大高度
function sdf(x, y, z) {
  const nx = x / scale
  const ny = y / scale
  const terrain =
    Math.sin(nx * 1.0) * Math.cos(ny * 1.3) * 0.5 +
    Math.sin(nx * 2.1 + 1.3) * Math.cos(ny * 1.7 + 0.7) * 0.25 +
    Math.sin(nx * 4.3 + 2.1) * Math.cos(ny * 3.7 + 1.3) * 0.125 +
    Math.sin(nx * 8.7 + 3.4) * Math.cos(ny * 7.3 + 2.1) * 0.0625
  const ground = height * (0.5 + terrain * rough)
  return ground - z
}

function bounds() {
  return { min: [-scale, -scale, -height], max: [scale, scale, height * 1.5] }
}`,
  },
]

/** 默认模板（球体） */
export const DEFAULT_SDF_TEMPLATE = SDF_TEMPLATES[0]
