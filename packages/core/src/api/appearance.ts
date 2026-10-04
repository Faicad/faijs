/**
 * api/appearance — faijs PBR 外观规格（颜色/材质/透明度）权威类型与 Shape 方法
 *
 * 设计文档：docs/plans/2026-10-05-faijs-pbr-appearance-api-design.md（v2）
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
  return s
}
