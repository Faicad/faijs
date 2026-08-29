/**
 * stdlib shape — 类型化构造器 + 身份槽
 *
 * 设计文档：docs/plans/2026-08-29-engine-library-contract.md §7
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P1
 *
 * 变更要点：
 * - 身份表（created / slots / shapeToName）改读全局锚点 runtime-state，
 *   使"两份 faijs 代码"共享同一份状态（解决 Shape 身份孤岛）。
 * - 新增 fromBrep(mesh, holder)：BREP 产物一次登记句柄与面演化，
 *   库函数不再手动登记（P2 落地）。
 * - 新增 hasBrep / brepOf：引擎侧判定"某 Shape 是否在 BREP 链上"。
 */

import type { Shape } from '../mesh/types'
import { getRuntimeState, nameOf, type ShapeSlot } from '../runtime-state'

// ── Shape 构造器 ──

export type ShapeKind = 'solid' | 'shape2d' | 'curve' | 'compound'

export interface SolidShape extends Shape {
  kind: 'solid'
}

export interface CompoundShape {
  kind: 'compound'
  children: Shape[]
}

export type StdShape = SolidShape | CompoundShape

/** 实体 Shape 构造器：mesh 产物必须经此创建。 */
export function solid(mesh: Shape): SolidShape {
  const s: SolidShape = { ...mesh, kind: 'solid' }
  getRuntimeState().created.add(s)
  return s
}

/**
 * BREP 产物构造器：同时登记 mesh 与 OCCT 句柄（+ 可选面演化）。
 *
 * 库函数用它替代 `solid(mesh)` + 手动登记句柄两步行：
 * ```ts
 * return fromBrep(solidToShape(kernel, resultSolid), {
 *   solid: resultSolid,
 *   faceEvolution: identityEvolution(kernel, resultSolid),
 * })
 * ```
 */
export function fromBrep(mesh: Shape, holder: BrepHolder): SolidShape {
  const s = solid(mesh)
  const state = getRuntimeState()
  const slot = state.slots.get(s) ?? {}
  slot.solid = holder.solid
  if (holder.faceEvolution) slot.faceEvolution = holder.faceEvolution
  state.slots.set(s, slot)
  return s
}

/** BREP 句柄 + 面演化（对应 OCCT 的 ShapeHandle）。类型为 unknown 以保持零依赖。 */
export interface BrepHolder {
  solid: unknown
  faceEvolution?: Map<number, number[]>
}

/** compound Shape 构造器：结构（层级）而非新几何。 */
export function compound(children: Shape[]): CompoundShape {
  const c: CompoundShape = { kind: 'compound', children }
  getRuntimeState().created.add(c)
  return c
}

/** 是否为构造器产物（终端判定与 compound 检测的依据）。 */
export function isShape(v: unknown): v is Shape {
  return !!v && typeof v === 'object' && getRuntimeState().created.has(v)
}

export function isCompound(v: unknown): v is CompoundShape {
  return isShape(v) && (v as { kind?: string }).kind === 'compound'
}

/**
 * 结构判定：是否为 compound 形态（keep-syntax §5.3 D5，对任意库函数零要求）。
 * 引擎内部的终端/消费判定用结构判定；SDK 公开的 isShape/isCompound 保持 WeakSet 严格。
 */
export function isCompoundLike(v: unknown): v is CompoundShape {
  return !!v && typeof v === 'object'
    && (v as { kind?: string }).kind === 'compound'
    && Array.isArray((v as { children?: unknown }).children)
}

// ── 身份槽 ──

export type { ShapeSlot }

/** 读取 Shape 的身份槽（无则 undefined）。 */
export function getSlot(shape: object): ShapeSlot | undefined {
  return getRuntimeState().slots.get(shape)
}

/** 读取或创建 Shape 的身份槽。 */
export function ensureSlot(shape: object): ShapeSlot {
  const state = getRuntimeState()
  let slot = state.slots.get(shape)
  if (!slot) {
    slot = {}
    state.slots.set(shape, slot)
  }
  return slot
}

/** 该 Shape 是否在 BREP 链上（有 OCCT 句柄）。引擎分派与 UI 查询用。 */
export function hasBrep(shape: Shape): boolean {
  return getRuntimeState().slots.get(shape)?.solid !== undefined
}

/** 读取该 Shape 的 OCCT 句柄（无则 undefined）。库函数用前必须判空。 */
export function brepOf(shape: Shape): unknown | undefined {
  return getRuntimeState().slots.get(shape)?.solid
}

/** nameOf 批量版：Shape[] → 成员名（装配 memberNames，P6 替代读 IR）。 */
export function nameOfShapes(shapes: Shape[]): string[] {
  return shapes.map((s) => String(nameOf(s) ?? ''))
}
