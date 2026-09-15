/**
 * chain — P1-a 链条（`chain.py` 的函数式移植）
 *
 * 上游 `Chain` 类：给定若干链轮（齿数/位置/正 wrap 方向），计算链条路径
 * （入/出角 → 段长 → 滚子位置），产出滚子链逐节装配体（`{name, solid}[]`，
 * 对齐 `*ExportParts` 形态，逐件进 STEP 产品名）。
 *
 * 语义对齐 chain.py：
 *  - `pitchRadii` = `Sprocket.sprocket_pitch_radius`（复用 sprocket.ts）；
 *  - 入/出角：`_calc_entry_exit_angles`（atan2 + asin 四分支）；
 *  - 段长：`_calc_segment_lengths`（弦长 + 弧长交错，`_interleave_lists`/`_gen_mix_sum_list`）；
 *  - 滚子定位：`_calc_roller_locations`（弧段绕轮心、线段线性插值）；
 *  - 链节：`make_link`（inner=滚子对，outer=销轴对，dog-bone 链板）；
 *  - `spktInitialRotation` = 首滚子角 + 180/齿数（齿间夹滚子）。
 *
 * ⚠️ 局限：上游 `Chain` 支持 3+ 链轮与斜面（`chain_plane`）；本移植先覆盖
 * 测试锚定的 **2 链轮共面**形态（`sprocket_and_chain_tests.py:184` 两例），
 * `spkt_normal` 仅支持 (0,0,1)。多链轮/斜面为后续增量。
 */

import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import { requireKernel } from './kernel'
import {
  arcEdge,
  cylinder,
  extrudeFace,
  fuse,
  planarFace,
  rotateAbout,
  translate,
  wireFromEdges,
  cylinderBetween,
} from './primitives'
import { sprocketPitchRadius } from './sprocket'

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

/** 2D 向量（chain_plane 局部坐标）。 */
interface V2 { x: number; y: number }

/** Chain 构造参数（逐字沿用 Python `Chain.__init__`，mm）。 */
export interface ChainParams {
  /** 各链轮齿数（≥2 个）。 */
  spkt_teeth: number[]
  /** 各链轮中心（2D，chain 平面内，mm）。 */
  spkt_locations: [number, number][]
  /** 各链轮是否正方向缠绕（链条从上方看逆时针包住该轮）。 */
  positive_chain_wrap: boolean[]
  /** 链节距（mm），默认 12.7 = 1/2"（ANSI 40）。 */
  chain_pitch?: number
  /** 滚子直径（mm），默认 7.9375 = 5/16"。 */
  roller_diameter?: number
  /** 滚子长度（mm），默认 2.38125 = 3/32"。 */
  roller_length?: number
  /** 链板单厚（mm），默认 1.0。 */
  link_plate_thickness?: number
  /** 链轮轴法向——仅支持 (0,0,1)。 */
  spkt_normal?: [number, number, number]
}

/** 单节链（导出条目：名字进 STEP 产品名）。 */
export interface ChainPart {
  name: string
  solid: BrepHandle
}

/** Chain 结果：逐件装配 + 派生量（对应上游各 property）。 */
export interface ChainResult {
  /** 逐节链零件（link0..linkN-1），多产品 STEP 逐件导出用。 */
  parts: ChainPart[]
  /** 各链轮节圆半径。 */
  pitchRadii: number[]
  /** 链条总长（mm）。 */
  chainLength: number
  /** 链长折合节数（浮点，上游 `chain_links`）。 */
  chainLinks: number
  /** 滚子数（上游 `num_rollers`）。 */
  numRollers: number
  /** 滚子圆心（chain 平面局部坐标）。 */
  rollerLoc: V2[]
  /** 各链轮初始转角（度，对齿让滚子）。 */
  spktInitialRotation: number[]
}

// ── 基础 2D 工具 ──────────────────────────────────────────────────────────────

function sub(a: V2, b: V2): V2 { return { x: a.x - b.x, y: a.y - b.y } }
function len(a: V2): number { return Math.hypot(a.x, a.y) }
function rotZ(a: V2, deg: number): V2 {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}
/** 上游 `Vector(0, r).rotateZ(a)`：先竖直再转角。 */
function radial(r: number, deg: number): V2 { return rotZ({ x: 0, y: r }, deg) }
function add(a: V2, b: V2): V2 { return { x: a.x + b.x, y: a.y + b.y } }
function scale(a: V2, k: number): V2 { return { x: a.x * k, y: a.y * k } }

/** 上游 `_interleave_lists`：a 占偶数位、b 占奇数位。 */
function interleave(a: number[], b: number[]): number[] {
  if (a.length !== b.length) throw new Error('interleave requires two equal lists')
  const out: number[] = []
  for (let i = 0; i < a.length; i++) { out.push(a[i]!, b[i]!) }
  return out
}

/** 上游 `_gen_mix_sum_list`：交错前缀和。 */
function mixSumList(a: number[], b: number[]): number[] {
  if (a.length !== b.length) throw new Error('mixSumList requires two equal lists')
  const out = [a[0]!, a[0]! + b[0]!]
  for (let i = 1; i < a.length; i++) {
    out.push(out[out.length - 1]! + a[i]!)
    out.push(out[out.length - 1]! + b[i]!)
  }
  return out
}

/** 上游 `_find_segment`：第一个大于 lenValue 的前缀和下标。 */
function findSegment(v: number, sums: number[]): number {
  for (let i = 0; i < sums.length; i++) {
    if (v < sums[i]!) return i
  }
  return NaN
}

// ── 链节几何（chain.py `make_link`）──────────────────────────────────────────

/**
 * dog-bone 链板 plan wire（chain.py:637-652 的等价轮廓）。
 *
 * 上游逐字：hLine(pitch/2+plateR) → threePointArc((pitch/2, plateR), tangent)
 * → radiusArc((0, neck), neck_r) → mirrorX() → mirrorY()。
 * B 侧以**密集采样折线**重建同一条闭曲线（每弧 24 段，远细于几何容差）：
 * 大端圆弧圆心 (pitch/2, 0)、半径 plateR；颈部圆弧半径 neckR、过切点与 (0, neck)。
 */
function linkPlateWire(chainPitch: number): { wire: BrepHandle; plateR: number } {
  const plateScale = chainPitch / (0.5 * 25.4)
  const neck = (plateScale * 4.5) / 2
  const plateR = (plateScale * 8.5) / 2
  const neckR =
    (Math.pow(chainPitch / 2, 2) + Math.pow(neck, 2) - Math.pow(plateR, 2)) /
    (2 * plateR - 2 * neck)
  const plateCenX = chainPitch / 2
  const neckIntersectionA = Math.atan2(neck + neckR, chainPitch / 2) * RAD
  // 上游：Vector(plate_r,0).rotateZ(180-a) + (pitch/2, 0) —— 与大端圆的切点
  const t = rotZ({ x: plateR, y: 0 }, 180 - neckIntersectionA)
  const tangent: V2 = { x: t.x + plateCenX, y: t.y }
  const endPt: V2 = { x: 0, y: neck }

  // 颈部圆弧圆心：距切点与 (0, neck) 均 neckR，取 y 较小解（弦下方，劣弧朝上）
  const dx = endPt.x - tangent.x, dy = endPt.y - tangent.y
  const d = Math.hypot(dx, dy)
  if (d > 2 * Math.abs(neckR)) throw new Error('chain link: neck arc impossible')
  const midX = (tangent.x + endPt.x) / 2, midY = (tangent.y + endPt.y) / 2
  const h = Math.sqrt(Math.max(neckR * neckR - (d / 2) * (d / 2), 0))
  const ux = -dy / d, uy = dx / d
  const c1: V2 = { x: midX + ux * h, y: midY + uy * h }
  const c2: V2 = { x: midX - ux * h, y: midY - uy * h }
  // 上游 radiusArc((0, neck), -neck_r)：负半径 = 凹弧（dog-bone 收腰），圆心在
  // 弦**上方**（y 较大解）——选凸弧会每块板多出 ~6.94 mm²（A/B 体积比对实测）。
  const cen = c1.y > c2.y ? c1 : c2

  // 精确圆弧轮廓（与上游 threePointArc/radiusArc 逐字对应，8 条三点弧）。
  // 四个圆心：大端右 C_R=(plateCenX,0) / 大端左 C_L=镜像；颈部右上 cen / 左 cenL=镜像。
  // ⚠️ 每条弧的中点必须用**该弧自己的圆心**算（镜像弧用镜像圆心）。
  const z0 = 0
  const p3 = (v: V2): BrepVec3 => ({ x: v.x, y: v.y, z: z0 })
  const CR: V2 = { x: plateCenX, y: 0 }
  const CL: V2 = { x: -plateCenX, y: 0 }
  const cenL: V2 = { x: -cen.x, y: cen.y }
  /** 圆上 a→b 弧的中点（角度走劣向，da 规范到 (−π,π]）。 */
  const arcMid = (center: V2, r: number, a: V2, b: V2): V2 => {
    const aa = Math.atan2(a.y - center.y, a.x - center.x)
    let da = Math.atan2(b.y - center.y, b.x - center.x) - aa
    while (da > Math.PI) da -= 2 * Math.PI
    while (da < -Math.PI) da += 2 * Math.PI
    const am = aa + da / 2
    return { x: center.x + r * Math.cos(am), y: center.y + r * Math.sin(am) }
  }
  const S: V2 = { x: plateCenX + plateR, y: 0 }
  const SL: V2 = { x: -S.x, y: S.y }
  const N = endPt
  const Tl: V2 = { x: -tangent.x, y: tangent.y }
  const nR = Math.abs(neckR)

  const edges = [
    // 右上：大端弧 S→切点（圆心 CR），颈部弧 切点→N（圆心 cen）
    arcEdge(p3(S), p3(arcMid(CR, plateR, S, tangent)), p3(tangent)),
    arcEdge(p3(tangent), p3(arcMid(cen, nR, tangent, N)), p3(N)),
    // 左上：颈部弧 N→Tl（圆心 cenL），大端弧 Tl→SL（圆心 CL）
    arcEdge(p3(N), p3(arcMid(cenL, nR, N, Tl)), p3(Tl)),
    arcEdge(p3(Tl), p3(arcMid(CL, plateR, Tl, SL)), p3(SL)),
    // 左下：大端弧 SL→my(Tl)（圆心 CL），颈部弧 my(Tl)→my(N)（圆心 my(cenL)）
    arcEdge(p3(SL), p3(arcMid(CL, plateR, SL, { x: Tl.x, y: -Tl.y })), p3({ x: Tl.x, y: -Tl.y })),
    arcEdge(
      p3({ x: Tl.x, y: -Tl.y }),
      p3(arcMid({ x: cenL.x, y: -cenL.y }, nR, { x: Tl.x, y: -Tl.y }, { x: N.x, y: -N.y })),
      p3({ x: N.x, y: -N.y }),
    ),
    // 右下：颈部弧 my(N)→my(切点)（圆心 my(cen)），大端弧 my(切点)→S（圆心 CR）
    arcEdge(
      p3({ x: N.x, y: -N.y }),
      p3(arcMid({ x: cen.x, y: -cen.y }, nR, { x: N.x, y: -N.y }, { x: tangent.x, y: -tangent.y })),
      p3({ x: tangent.x, y: -tangent.y }),
    ),
    arcEdge(
      p3({ x: tangent.x, y: -tangent.y }),
      p3(arcMid(CR, plateR, { x: tangent.x, y: -tangent.y }, S)),
      p3(S),
    ),
  ]
  const wire = wireFromEdges(edges)
  return { wire, plateR }
}

/**
 * 单节链（chain.py `make_link` 的函数式移植）。
 * @param p - 链节参数：chainPitch 节距、linkPlateThickness 板厚、inner 内/外节、rollerLength 滚子长、rollerDiameter 滚子径。
 * @returns 链节实体，中心在两滚子连线中点、x 轴沿链方向。
 */
export function makeLink(p: {
  chainPitch: number
  linkPlateThickness: number
  inner: boolean
  rollerLength: number
  rollerDiameter: number
}): BrepHandle {
  const { chainPitch, linkPlateThickness: t, inner, rollerLength: rl, rollerDiameter: rd } = p
  const { wire, plateR } = linkPlateWire(chainPitch)
  const face = planarFace(wire)
  // 板轮廓两瓣已在 ±pitch/2（wire 自带）；上游再 translate(pitch/2,0,·) 把瓣心
  // 移到 0 与 pitch（滚子/销轴位置）。板体 z ∈ [0, t]。
  const plate = extrudeFace(face, t)

  if (inner) {
    // 上游：两块板 z ∈ [rl/2, rl/2+t] 与 [-rl/2-t, -rl/2]（both=True ±t/2 再平移）
    let link = fuse(
      translate(plate, chainPitch / 2, 0, rl / 2),
      translate(plate, chainPitch / 2, 0, -rl / 2 - t),
    )
    // 两个滚子：(0,0) 与 (pitch,0)，滚子长 rl 居中（z ∈ [-rl/2, rl/2]）
    link = fuse(link, cylinderBetween(rd / 2, -rl / 2, rl / 2))
    link = fuse(link, translate(cylinderBetween(rd / 2, -rl / 2, rl / 2), chainPitch, 0, 0))
    void plateR
    return link
  }

  // 外节（chain.py:667-691）：板 + 顶面两个销轴凸台（r=plateR/4，高 t/3），
  // 整体平移 z=rl/2+t（上游 (rl+3t)/2 − t/2）；第二块由第一块绕 x 轴转 180° 得到
  // （(x,y,z)→(x,−y,−z)，轮廓双轴对称故 y 翻转不可见）。
  const pinR = plateR / 4
  let plateWithPins = fuse(plate, translate(cylinder(pinR, t / 3), chainPitch / 2, 0, t))
  plateWithPins = fuse(plateWithPins, translate(cylinder(pinR, t / 3), -chainPitch / 2, 0, t))
  const zShift = rl / 2 + t
  const plateA = translate(plateWithPins, chainPitch / 2, 0, zShift)
  const plateB = rotateAbout(
    plateA,
    { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
    Math.PI,
  )
  return fuse(plateA, plateB)
}

// ── Chain 主流程 ─────────────────────────────────────────────────────────────

/**
 * 构建滚子链（上游 `Chain` 构造函数全流程的函数式形态）。
 *
 * @param p - 链参数（逐字沿用 Python，mm）。
 * @returns 逐件装配与派生量。
 * @throws 参数不合法（齿数/位置/wrap 长度不一致、少于 2 轮、重复位置、斜面）。
 */
export function buildChain(p: ChainParams): ChainResult {
  const chainPitch = p.chain_pitch ?? 12.7
  const rollerDiameter = p.roller_diameter ?? 7.9375
  const rollerLength = p.roller_length ?? 2.38125
  const plateT = p.link_plate_thickness ?? 1.0

  const teeth = p.spkt_teeth
  const locs = p.spkt_locations.map(([x, y]) => ({ x, y }))
  const wrap = p.positive_chain_wrap
  if (!Array.isArray(teeth) || !teeth.every((t) => Number.isInteger(t) && t > 0)) {
    throw new Error('spkt_teeth must be a list of positive int')
  }
  if (teeth.length !== locs.length || teeth.length !== wrap.length) {
    throw new Error('Length of spkt_teeth, spkt_locations, positive_chain_wrap not equal')
  }
  if (teeth.length < 2) throw new Error('Chain requires at least 2 sprockets')
  const seen = new Set(locs.map((l) => `${l.x},${l.y}`))
  if (seen.size !== locs.length) throw new Error('Sprocket locations must be unique')
  const normal = p.spkt_normal ?? [0, 0, 1]
  if (normal[0] !== 0 || normal[1] !== 0) {
    throw new Error('chain: only spkt_normal=(0,0,1) is supported (planar chains)')
  }

  const n = teeth.length
  const pitchRadii = teeth.map((t) => sprocketPitchRadius(t, chainPitch))

  // 入/出角（chain.py `_calc_entry_exit_angles` 四分支逐字）
  const sep: number[] = []
  for (let s = 0; s < n; s++) sep.push(len(sub(locs[(s + 1) % n]!, locs[s]!)))

  const baseA = locs.map((l, s) => {
    const nxt = locs[(s + 1) % n]!
    return 90 + Math.atan2(l.y - nxt.y, l.x - nxt.x) * RAD
  })

  const exitA: number[] = []
  for (let s = 0; s < n; s++) {
    const s1 = (s + 1) % n
    const ratio = (pitchRadii[s]! - pitchRadii[s1]!) / sep[s]!
    const ratioSum = (pitchRadii[s]! + pitchRadii[s1]!) / sep[s]!
    if (wrap[s] && wrap[s1]) {
      exitA.push(baseA[s]! - 90 + Math.asin(clamp1(ratio)) * RAD)
    } else if (wrap[s] && !wrap[s1]) {
      exitA.push(baseA[s]! - 90 + Math.asin(clamp1(ratioSum)) * RAD)
    } else if (!wrap[s] && wrap[s1]) {
      exitA.push(baseA[s]! + 90 - Math.asin(clamp1(ratioSum)) * RAD)
    } else {
      exitA.push(baseA[s]! + 90 - Math.asin(clamp1(ratio)) * RAD)
    }
  }

  // 上游：entry_a[s] = exit_a[s-1]（+180 当 wrap 翻转）——取的是**上一轮**的出角
  const entryA = exitA.map((_, s) => {
    const prev = (s - 1 + n) % n
    return wrap[s] !== wrap[prev] ? exitA[prev]! + 180 : exitA[prev]!
  })

  // 段长（chain.py `_calc_segment_lengths`）
  const arcA = wrap.map((w, s) =>
    w
      ? (exitA[s]! - entryA[s]! + 360) % 360
      : (entryA[s]! - exitA[s]! + 360) % 360,
  )
  const lineL = wrap.map((w, s) => {
    const s1 = (s + 1) % n
    const dR = w === wrap[s1] ? pitchRadii[s]! - pitchRadii[s1]! : pitchRadii[s]! + pitchRadii[s1]!
    return Math.sqrt(Math.max(sep[s]! ** 2 - dR ** 2, 0))
  })
  const arcL = arcA.map((a, s) => Math.abs((a * 2 * Math.PI * pitchRadii[s]!) / 360))
  const segmentLengths = interleave(arcL, lineL)
  const segmentSums = mixSumList(arcL, lineL)
  const chainLength = segmentSums[segmentSums.length - 1]!
  const chainLinks = chainLength / chainPitch
  const numRollers = Math.floor(chainLength / chainPitch)

  // 滚子定位（chain.py `_calc_roller_locations`）
  const entryExitLoc = entryA.map((a, s) => [
    add(locs[s]!, radial(pitchRadii[s]!, a)),
    add(locs[s]!, radial(pitchRadii[s]!, exitA[s]!)),
  ])
  const rollerLoc: V2[] = []
  const rollerAPerSpkt: Array<[number, number]> = []
  for (let i = 0; i < numRollers; i++) {
    const rollerDistance = (i * chainPitch) % chainLength
    const seg = findSegment(rollerDistance, segmentSums)
    if (!Number.isInteger(seg)) throw new Error('chain: roller segment not found')
    const spkt = Math.floor(seg / 2)
    const along = 1 - (segmentSums[seg]! - rollerDistance) / segmentLengths[seg]!
    if (seg % 2 === 0) {
      const dir = wrap[spkt] ? 1 : -1
      const a = entryA[spkt]! + dir * arcA[spkt]! * along
      rollerLoc.push(add(locs[spkt]!, radial(pitchRadii[spkt]!, a)))
      rollerAPerSpkt.push([spkt, a])
    } else {
      const from = entryExitLoc[spkt]![1]!
      const to = entryExitLoc[(spkt + 1) % n]![0]!
      rollerLoc.push(add(from, scale(sub(to, from), along)))
    }
  }
  // 各轮首个滚子角 → 链轮初始转角（齿间夹滚子）
  const spktInitialRotation = teeth.map((t, s) => {
    const idx = rollerAPerSpkt.findIndex(([sp]) => sp === s)
    if (idx < 0) throw new Error(`chain: no roller contacts sprocket ${s}`)
    return rollerAPerSpkt[idx]![1] + 180 / t
  })

  // 逐节装配（chain.py `_assemble_chain`）
  const parts: ChainPart[] = []
  const cacheInner = makeLink({ chainPitch, linkPlateThickness: plateT, inner: true, rollerLength, rollerDiameter })
  const cacheOuter = makeLink({ chainPitch, linkPlateThickness: plateT, inner: false, rollerLength, rollerDiameter })
  for (let i = 0; i < numRollers; i++) {
    const cur = rollerLoc[i]!
    const nxt = rollerLoc[(i + 1) % numRollers]!
    const rotDeg = Math.atan2(nxt.y - cur.y, nxt.x - cur.x) * RAD
    const base = i % 2 === 0 ? cacheInner : cacheOuter
    const k = requireKernel()
    const rotated = rotateAbout(base, { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }, rotDeg * DEG)
    const placed = k.translate(rotated, cur.x, cur.y, 0)
    parts.push({ name: `link${i}`, solid: placed })
  }

  return {
    parts,
    pitchRadii,
    chainLength,
    chainLinks,
    numRollers,
    rollerLoc,
    spktInitialRotation,
  }
}

function clamp1(v: number): number {
  return Math.min(1, Math.max(-1, v))
}

/**
 * 供链轮初始转角旋转（`assemble_chain_transmission` 的 B 侧等价）。
 * @param solid - 待旋转的链轮实体。
 * @param rotationDeg - 绕 +Z 旋转角度（度）。
 * @param loc - 链轮平面位置 [x, y]。
 * @returns 旋转并平移后的链轮实体。
 */
export function placeSprocket(solid: BrepHandle, rotationDeg: number, loc: [number, number]): BrepHandle {
  const rotated = rotateAbout(
    solid,
    { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
    rotationDeg * DEG,
  )
  return translate(rotated, loc[0], loc[1], 0)
}
