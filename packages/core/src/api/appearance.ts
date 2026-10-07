/**
 * api/appearance — faijs PBR 外观规格（颜色/材质/透明度）权威类型与 Shape 方法
 *
 * 定位：
 * - 外观设置**不是 op**（不进 defineOp/api-namespace/args-schema），是 Shape
 *   实例方法（`box1.setColor(...)`，复用 `asm1.solve()` 的成员调用语句形态）。
 * - `PbrAppearance` 引擎无关、JSON 可序列化，随 Shape 走 mesh/brep 双链路
 *   （`Shape.appearance`），编辑器/查看器只读字段，不依赖方法。
 * - 本文件零依赖（不 import THREE / occt / store）；唯一 import 是 mesh/types
 *   的 `Shape` 类型（type-only），mesh/types 亦只 type-import 本文件的类型，
 *   两者为类型环、无运行时环（值依赖单向：shape.ts → api/appearance.ts）。
 *
 * 颜色约定：
 * - 内部归一形态：`color: [r, g, b]`（sRGB，0–1）；`opacity` 是透明度的唯一
 *   权威字段（0–1）。
 * - 输入接受 hex（#rgb / #rrggbb / #rrggbbaa）与数组（[r,g,b] / [r,g,b,a]）；
 *   `#rrggbbaa` / 数组第 4 分量的 alpha 等价于 `opacity`（显式 setOpacity 后
 *   写入的 opacity 优先于后续无 alpha 的 setColor 推导，见 setColor 注释）。
 * - CSS 颜色名：P1 不支持（抛错），由宿主或后续版本扩展。
 */

import type { Shape } from '../mesh/types'

// ── 类型 ──

/** 颜色输入：hex（#rgb/#rrggbb/#rrggbbaa）或 sRGB 0–1 数组（[r,g,b] / [r,g,b,a]）。 */
export type PbrColor = string | [number, number, number] | [number, number, number, number]

/** glTF 透明度约定（与 3d_editor MaterialAppearance.alphaMode 对齐）。 */
export type PbrAlphaMode = 'OPAQUE' | 'MASK' | 'BLEND'

/**
 * faijs PBR 外观规格 —— 引擎无关、JSON 可序列化、随 Shape 走双链路。
 *
 * 全字段可选：未设置字段 = 继承上游 / 宿主默认，不隐式清零。
 * 归一形态约定：`color` 为 [r,g,b]（sRGB 0–1）数组；`opacity`（0–1）为
 * 透明度唯一权威字段（color 的 aa 分量在 set 时归一为 opacity）。
 */
export interface PbrAppearance {
  /** 基色（sRGB 0–1）。 */
  color?: [number, number, number]
  /** 透明度 0–1。 */
  opacity?: number
  /** 金属度 0–1；粗糙度 0–1。 */
  metalness?: number
  roughness?: number

  /** 自发光：颜色 + 强度（>0 时启用，默认 1）。 */
  emissive?: [number, number, number]
  emissiveIntensity?: number

  /** 透射/玻璃。 */
  transmission?: number
  thickness?: number
  ior?: number
  attenuationColor?: [number, number, number]
  attenuationDistance?: number

  /** 清漆。 */
  clearcoat?: number
  clearcoatRoughness?: number

  /** 织物/丝绒。 */
  sheen?: number
  sheenColor?: [number, number, number]
  sheenRoughness?: number

  /** 拉丝金属。 */
  anisotropy?: number
  anisotropyRotation?: number

  /** 高光工作流（替代 metalness 工作流）。 */
  specularIntensity?: number
  specularColor?: [number, number, number]

  /** 环境光强度（IBL 贡献）。 */
  envMapIntensity?: number

  /** 透明度模式：默认 OPAQUE；opacity<1 未显式指定时宿主按 BLEND 处理。 */
  alphaMode?: PbrAlphaMode
  alphaCutoff?: number
  /** 双面渲染。 */
  doubleSided?: boolean
  /** 无光照。 */
  unlit?: boolean
}

/** 材质参数（不含颜色/透明度，`cad` 便捷方法 setMaterial 的入参）。 */
export type MaterialSpec = Omit<PbrAppearance, 'color' | 'opacity'>

/** Shape 外观方法签名（运行时由 attachAppearanceMethods 挂载；纯数据判定不受影响）。 */
export interface ShapeAppearanceMethods {
  /** 合并外观：`{...cur, ...spec}`，spec 中 undefined 字段保留旧值。 */
  setAppearance(spec: PbrAppearance): this
  /** 便捷：等价 setAppearance({ color })；#rrggbbaa / [r,g,b,a] 的 alpha 归一为 opacity。 */
  setColor(color: PbrColor): this
  /** 便捷：等价 setAppearance(spec)。 */
  setMaterial(spec: MaterialSpec): this
  /** 便捷：透明度权威字段（0–1）。 */
  setOpacity(opacity: number): this
  /** 读取当前外观（可能 undefined）。 */
  getAppearance(): Readonly<PbrAppearance> | undefined
  /**
   * 面级设色：把 faceIds 指定的面（面序号契约见 `Shape.faceRanges`，参数化
   * primitives 才有）写入 `materialGroups`。无面结构（布尔/组合/导入产物）抛
   * `E_FACE_UNAVAILABLE`；面序号越界抛 `E_FACE_INDEX`。
   */
  setFaceColor(faces: number[], color: PbrColor): this
  /** 面级材质：等价 setFaceColor 的 material 版本。 */
  setFaceMaterial(faces: number[], spec: MaterialSpec): this
}

// ── 归一化 ──

/** hex #rgb/#rrggbb/#rrggbbaa → sRGB 0–1（+可选 alpha）。 */
function parseHexColor(hex: string): { rgb: [number, number, number]; alpha?: number } {
  let h = hex.startsWith('#') ? hex.slice(1) : hex
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('')
  }
  if (h.length !== 6 && h.length !== 8) {
    throw new Error(`[faijs/appearance] invalid hex color "${hex}" (expected #rgb/#rrggbb/#rrggbbaa)`)
  }
  if (!/^[0-9a-fA-F]+$/.test(h)) {
    throw new Error(`[faijs/appearance] invalid hex color "${hex}" (non-hex digit)`)
  }
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const rgb: [number, number, number] = [r, g, b]
  if (h.length === 8) return { rgb, alpha: parseInt(h.slice(6, 8), 16) / 255 }
  return { rgb }
}

function assertComponent01(v: number, label: string): void {
  if (v < 0 || v > 1 || !Number.isFinite(v)) {
    throw new Error(`[faijs/appearance] ${label} must be in 0..1, got ${v}`)
  }
}

/**
 * 归一颜色输入 → { rgb, alpha? }。
 * hex 与 [r,g,b] / [r,g,b,a]（sRGB 0–1）；CSS 颜色名 P1 不支持。
 * @param color 颜色输入：`#rgb` / `#rrggbb` / `#rrggbbaa`，或 `[r,g,b]` / `[r,g,b,a]`（sRGB 0–1）
 * @returns 归一后的 sRGB 颜色（0–1）与可选 alpha；带 alpha 的输入在 alpha 通道返回
 */
export function normalizeColor(color: PbrColor): { rgb: [number, number, number]; alpha?: number } {
  if (typeof color === 'string') {
    if (color.startsWith('#')) return parseHexColor(color)
    throw new Error(
      `[faijs/appearance] unsupported color "${color}" (P1: hex #rgb/#rrggbb/#rrggbbaa or [r,g,b] expected; CSS names not supported)`,
    )
  }
  const [r, g, b, a] = color
  assertComponent01(r, 'color.r')
  assertComponent01(g, 'color.g')
  assertComponent01(b, 'color.b')
  if (a !== undefined) {
    assertComponent01(a, 'color.a')
    return { rgb: [r, g, b], alpha: a }
  }
  return { rgb: [r, g, b] }
}

/**
 * 合并外观：spec 中 undefined 字段不覆盖旧值。
 * @param cur 当前外观（可为 undefined）
 * @param spec 待合并字段（undefined 字段被跳过）
 * @returns 合并后的外观（新对象；cur 为 undefined 时仅含 spec 非空字段）
 */
export function mergeAppearance(cur: PbrAppearance | undefined, spec: PbrAppearance): PbrAppearance {
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(spec)) {
    if (v !== undefined) clean[k] = v
  }
  return { ...(cur ?? {}), ...clean } as PbrAppearance
}

/** 两外观等价判定（字段级深比较；undefined 视同空对象）。 */
function sameAppearance(a: PbrAppearance | undefined, b: PbrAppearance | undefined): boolean {
  const ka = Object.keys(a ?? {}).filter((k) => (a as Record<string, unknown>)[k] !== undefined).sort()
  const kb = Object.keys(b ?? {}).filter((k) => (b as Record<string, unknown>)[k] !== undefined).sort()
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    const va = (a as Record<string, unknown>)[k]
    const vb = (b as Record<string, unknown>)[k]
    if (Array.isArray(va) || Array.isArray(vb)) {
      if (!Array.isArray(va) || !Array.isArray(vb) || va.length !== vb.length) return false
      for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) return false
    } else if (va !== vb) {
      return false
    }
  }
  return true
}

// ── 面级外观 ──

/** 面区间跨度（内部表示，end 为开区间上界）。 */
interface FaceSpan {
  start: number
  end: number
  appearance: PbrAppearance | undefined
}

/**
 * 把 faceIds 指定的面（面序号 → `Shape.faceRanges` 三角形区间）合并进
 * `shape.materialGroups`。多次设置同一面 → 外观合并（spec 未设置字段保留旧值）；
 * 不同面同外观 → 相邻区间合并为一个分组。输出按三角形起始排序。
 *
 * 无面结构（`faceRanges` 缺失——布尔/组合/导入产物）抛 `E_FACE_UNAVAILABLE`；
 * 面序号越界/非整数抛 `E_FACE_INDEX`。
 * @param shape 目标 Shape（必须携带 faceRanges）
 * @param faceIds 面序号列表（PbrAppearance 面序契约见 mesh/primitives.ts 各构造点注释）
 * @param spec 待合并到目标面的外观字段
 */
export function mergeFaceAppearance(shape: Shape, faceIds: number[], spec: PbrAppearance): void {
  const ranges = shape.faceRanges
  if (!ranges || ranges.length === 0) {
    throw new Error(
      '[faijs/appearance] E_FACE_UNAVAILABLE: shape has no face structure — ' +
      'face-level methods only apply to parameterized primitives (box/cylinder/cone); ' +
      'boolean/combined/imported shapes have no CAD faces',
    )
  }
  const targets: Array<{ start: number; count: number }> = []
  for (const id of faceIds) {
    if (!Number.isInteger(id) || id < 0 || id >= ranges.length) {
      throw new Error(
        `[faijs/appearance] E_FACE_INDEX: face index ${id} out of range 0..${ranges.length - 1}`,
      )
    }
    targets.push(ranges[id])
  }

  const spans: FaceSpan[] = []
  for (const g of shape.materialGroups ?? []) {
    spans.push({ start: g.start, end: g.start + g.count, appearance: g.appearance })
  }
  // 每个目标区间与现有 spans 求并：重叠部分 mergeAppearance，保留两侧未覆盖段。
  for (const t of targets) {
    const ts = t.start
    const te = t.start + t.count
    let applied = false
    for (const h of spans) {
      const is = Math.max(ts, h.start)
      const ie = Math.min(te, h.end)
      if (is >= ie) continue
      applied = true
      const left = h.start < is ? { start: h.start, end: is, appearance: h.appearance } : null
      const right = ie < h.end ? { start: ie, end: h.end, appearance: h.appearance } : null
      const merged: FaceSpan = { start: is, end: ie, appearance: mergeAppearance(h.appearance, spec) }
      const idx = spans.indexOf(h)
      spans.splice(idx, 1, ...(left ? [left] : []), merged, ...(right ? [right] : []))
    }
    if (!applied) spans.push({ start: ts, end: te, appearance: spec })
  }
  // 归一化：按 start 排序 + 相邻同外观合并。
  spans.sort((a, b) => a.start - b.start)
  const out: FaceSpan[] = []
  for (const s of spans) {
    const last = out[out.length - 1]
    if (last && last.end === s.start && sameAppearance(last.appearance, s.appearance)) {
      last.end = s.end
    } else {
      out.push({ ...s })
    }
  }
  shape.materialGroups = out.map((s) => ({
    start: s.start,
    count: s.end - s.start,
    appearance: s.appearance ?? {},
  }))
}

// ── Shape 方法挂载 ──

/**
 * 给 Shape 实例挂载外观方法（幂等：已有 setAppearance 则跳过）。
 *
 * 所有产物构造点（solid/curve → fromBrep/fromMeshSolid/fromBrepCurve）统一
 * 调用本函数，保证 mesh/brep 双链路产物都可用 `box1.setColor(...)`。
 * 方法**不序列化**（JSON 丢弃函数）；`appearance` 字段随产物跨 worker 传递，
 * 编辑器/查看器只读字段即可，不依赖方法。
 * @param shape 产物 Shape 实例（solid/curve 产物）
 * @returns 挂载后的 shape（类型提升为 `Shape & ShapeAppearanceMethods`；同一实例原地挂载）
 */
export function attachAppearanceMethods(shape: Shape): Shape & ShapeAppearanceMethods {
  const s = shape as Shape & ShapeAppearanceMethods
  if (typeof s.setAppearance === 'function') return s
  s.setAppearance = function setAppearance(this: Shape & ShapeAppearanceMethods, spec: PbrAppearance) {
    this.appearance = mergeAppearance(this.appearance, spec)
    return this
  }
  s.setColor = function setColor(this: Shape & ShapeAppearanceMethods, color: PbrColor) {
    const { rgb, alpha } = normalizeColor(color)
    const spec: PbrAppearance = { color: rgb }
    // #rrggbbaa / [r,g,b,a] 的 alpha 归一为 opacity（权威字段）。已显式
    // setOpacity 的旧值：仅当本次 color 自带 alpha 时覆盖；无 alpha 的
    // setColor 不动 opacity。
    if (alpha !== undefined) spec.opacity = alpha
    this.appearance = mergeAppearance(this.appearance, spec)
    return this
  }
  s.setMaterial = function setMaterial(this: Shape & ShapeAppearanceMethods, spec: MaterialSpec) {
    this.appearance = mergeAppearance(this.appearance, spec as PbrAppearance)
    return this
  }
  s.setOpacity = function setOpacity(this: Shape & ShapeAppearanceMethods, opacity: number) {
    assertComponent01(opacity, 'opacity')
    this.appearance = mergeAppearance(this.appearance, { opacity })
    return this
  }
  s.getAppearance = function getAppearance(this: Shape) {
    return this.appearance
  }
  s.setFaceColor = function setFaceColor(this: Shape & ShapeAppearanceMethods, faces: number[], color: PbrColor) {
    const { rgb, alpha } = normalizeColor(color)
    const spec: PbrAppearance = { color: rgb }
    if (alpha !== undefined) spec.opacity = alpha
    mergeFaceAppearance(this, faces, spec)
    return this
  }
  s.setFaceMaterial = function setFaceMaterial(this: Shape & ShapeAppearanceMethods, faces: number[], spec: MaterialSpec) {
    mergeFaceAppearance(this, faces, spec as PbrAppearance)
    return this
  }
  return s
}
