/**
 * stdlib Shape — 类型化构造器 + 身份槽（WeakMap 记账）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.4
 *
 * - 库函数的产物必须经构造器创建（solid/compound）。`isShape` 只认构造器产物
 *   （内部以 WeakSet 登记），是终端判定（§3.6）的唯一依据。
 * - compound 是 Shape 的一种（用户规定）：kind='compound'，持有 children 引用
 *   （不复制几何）。它自身没有独立 mesh——几何由 children 承载，意义是结构（层级）。
 * - 引擎用 WeakMap<Shape, ShapeSlot> 挂身份槽：solid / faceEvolution / meshShape /
 *   behavior。现状按 PartName 键控的 solidCache/faceEvolutionCache/meshShapeCache
 *   迁移为身份槽后，库函数签名里没有变量名，op 实现与命名体系解耦。
 */

import type { ShapeHandle, Mesh as WasmMesh } from 'occt-wasm'
import type { Shape } from '../mesh/types'

// ── Shape 构造器 ──

export type ShapeKind = 'solid' | 'shape2d' | 'curve' | 'compound'

/** 实体 Shape：mesh 数据 + kind 标记（与既有 Shape 消费方兼容，多一个 kind 字段）。 */
export interface SolidShape extends Shape {
  kind: 'solid'
}

/** compound Shape：结构（层级）而非新几何；children 是成员 Shape 的引用。 */
export interface CompoundShape {
  kind: 'compound'
  children: Shape[]
}

/** stdlib 库函数产物的 Shape 联合（shape2d/curve 后续阶段扩展）。 */
export type StdShape = SolidShape | CompoundShape

/** 构造器产物登记（isShape 的唯一依据）。 */
const created = new WeakSet<object>()

/** 实体 Shape 构造器：库函数 mesh 路径/BREP 三角化产物必须经此创建。 */
export function solid(mesh: Shape): SolidShape {
  const s: SolidShape = { ...mesh, kind: 'solid' }
  created.add(s)
  return s
}

/** compound Shape 构造器：group/assembly 的产物（成员引用，不复制几何）。 */
export function compound(children: Shape[]): CompoundShape {
  const c: CompoundShape = { kind: 'compound', children }
  created.add(c)
  return c
}

/** 是否为构造器产物（终端判定与 compound 检测的唯一依据）。 */
export function isShape(v: unknown): v is Shape {
  return !!v && typeof v === 'object' && created.has(v)
}

/** 是否为 compound Shape（构造器产物，WeakSet 严格判定）。 */
export function isCompound(v: unknown): v is CompoundShape {
  return isShape(v) && (v as { kind?: string }).kind === 'compound'
}

/**
 * 结构判定：是否为 compound 形态（keep-syntax 设计 §5.3，D5）。
 *
 * 引擎内部的终端/消费判定用结构判定（对第三方零要求）：第三方库直接返回
 * `{kind:'compound', children:[...]}` 而未经 SDK `compound()` → `isShape` false、
 * 又无 `positions` → 旧 `isCompound` 完全不识别、静默丢失；`isCompoundLike`
 * 按结构识别（与 runtime 的 `isShapeLike` 鸭子类型同一风格）。
 * SDK 公开的 `isShape`/`isCompound` 保持 WeakSet 严格（身份槽依赖它）。
 */
export function isCompoundLike(v: unknown): v is CompoundShape {
  return !!v && typeof v === 'object'
    && (v as { kind?: string }).kind === 'compound'
    && Array.isArray((v as { children?: unknown }).children)
}

// ── 身份槽（WeakMap<Shape, ShapeSlot>） ──

/**
 * Shape 身份槽：库函数经 exec.getSolid/setSolid 读写，不感知变量名。
 * - solid：OCCT 实体句柄（BREP 路径产物）
 * - faceEvolution：面演化映射（布尔/变换的 *WithHistory 产物）
 * - meshShape：三角化缓存（保证拓扑 mesh = 显示 mesh）
 * - behavior：装配 compound 专有（约束列表 + 求解方法，见 §3.10）
 */
export interface ShapeSlot {
  solid?: ShapeHandle
  faceEvolution?: Map<number, number[]>
  meshShape?: WasmMesh
  behavior?: unknown
}

const slots = new WeakMap<object, ShapeSlot>()

/** 读取 Shape 的身份槽（无则 undefined）。 */
export function getSlot(shape: object): ShapeSlot | undefined {
  return slots.get(shape)
}

/** 读取或创建 Shape 的身份槽。 */
export function ensureSlot(shape: object): ShapeSlot {
  let slot = slots.get(shape)
  if (!slot) {
    slot = {}
    slots.set(shape, slot)
  }
  return slot
}
