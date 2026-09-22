/**
 * stdlib shape — 类型化构造器 + 身份槽
 *
 *
 * 变更要点：
 * - 身份表（created / slots / shapeToName）改读全局锚点 runtime-state，
 *   使"两份 faijs 代码"共享同一份状态（解决 Shape 身份孤岛）。
 * - 新增 fromBrep(mesh, holder)：BREP 产物一次登记句柄与面演化，
 *   库函数不再手动登记（P2 落地）。
 * - 新增 hasBrep / brepOf：引擎侧判定"某 Shape 是否在 BREP 链上"。
 */

import type { Shape } from './mesh/types'
import { getRuntimeState, registerFunctionBrep, nameOf, getCurrentStmt, type ShapeSlot } from './runtime-state'
import { asStmtId } from './identity'
import { runtimeLineage } from './topology/naming/lineage'

// ── Shape 构造器 ──

/** Discriminator for the concrete shape kinds. */
export type ShapeKind = 'solid' | 'shape2d' | 'curve' | 'compound'

/** A solid mesh shape produced by a constructor. */
export interface SolidShape extends Shape {
  kind: 'solid'
}

/** A structural compound grouping a list of child shapes. */
export interface CompoundShape {
  kind: 'compound'
  children: Shape[]
}

/** A shape that the stdlib exports as a finished result. */
export type StdShape = SolidShape | CompoundShape

/**
 * 实体 Shape 构造器：mesh 产物必须经此创建。
 *
 * @param mesh - the mesh shape to wrap as a solid.
 * @returns the created solid shape.
 */
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
 *
 * @param mesh - the mesh shape to register.
 * @param holder - the BREP holder providing the OCCT handle and optional face evolution.
 * @returns the created solid shape with the BREP handle attached.
 */
export function fromBrep(mesh: Shape, holder: BrepHolder): SolidShape {
  const s = solid(mesh)
  const state = getRuntimeState()
  const slot = state.slots.get(s) ?? {}
  slot.solid = holder.solid
  if (holder.faceEvolution) slot.faceEvolution = holder.faceEvolution
  // 1.10 前置③：roleTable **不再写 slot**（字段已删）——权威落点是下方血缘图
  // 旁挂（语句键 + part 键），解析缓存 miss 由回走重算恢复。
  state.slots.set(s, slot)
  // 1.10 前置③：roleTable 权威旁挂（**语句键**）在血缘图。part 键的记录在
  // define-op.wrapped（impl 返回后 anchor.outputs 名字已定）——此处 shape 还未
  // 被 executor 命名，nameOf(s) 为 undefined，不能在这里记 part 键。
  const stmt = getCurrentStmt()
  if (stmt && (holder.roleTable || holder.solid !== undefined)) {
    runtimeLineage.recordOutput(
      asStmtId(stmt.id),
      holder.roleTable as ReadonlyMap<string, ReadonlyMap<string, readonly number[]>> | undefined,
      holder.solid,
    )
  }
  // 函数 BREP 域（§5.6）：函数体内 op 产生的新句柄登记到当前域，函数返回后统一释放
  registerFunctionBrep(holder.solid)
  return s
}

/** BREP 句柄 + 面演化 + 拓扑命名 RoleTable（对应 OCCT 的 ShapeHandle）。类型为 unknown 以保持零依赖。 */
export interface BrepHolder {
  solid: unknown
  faceEvolution?: Map<number, number[]>
  /**
   * 1.10 前置③：产形 op 交付 role 表的唯一入口。fromBrep 把它**旁挂到血缘图**
   * （语句键 + part 键）；slot 侧的缓存存储已删（ShapeSlot 不再有该字段）。
   */
  roleTable?: unknown
}

/**
 * compound Shape 构造器：结构（层级）而非新几何。
 *
 * @param children - the child shapes to group.
 * @returns the created compound shape.
 */
export function compound(children: Shape[]): CompoundShape {
  const c: CompoundShape = { kind: 'compound', children }
  getRuntimeState().created.add(c)
  return c
}

/**
 * 是否为构造器产物（终端判定与 compound 检测的依据）。
 *
 * @param v - the value to test.
 * @returns true if the value was created by a shape constructor.
 */
export function isShape(v: unknown): v is Shape {
  return !!v && typeof v === 'object' && getRuntimeState().created.has(v)
}

/**
 * Returns true if the value is a strict compound shape created by a constructor.
 *
 * @param v - the value to test.
 * @returns true if the value is a strict compound shape.
 */
export function isCompound(v: unknown): v is CompoundShape {
  return isShape(v) && (v as { kind?: string }).kind === 'compound'
}

/**
 * 结构判定：是否为 compound 形态（keep-syntax §5.3 D5，对任意库函数零要求）。
 * 引擎内部的终端/消费判定用结构判定；SDK 公开的 isShape/isCompound 保持 WeakSet 严格。
 *
 * @param v - the value to test.
 * @returns true if the value has compound shape structure.
 */
export function isCompoundLike(v: unknown): v is CompoundShape {
  return !!v && typeof v === 'object'
    && (v as { kind?: string }).kind === 'compound'
    && Array.isArray((v as { children?: unknown }).children)
}

// ── 身份槽 ──

export type { ShapeSlot }

/**
 * 读取 Shape 的身份槽（无则 undefined）。
 *
 * @param shape - the shape whose slot to read.
 * @returns the identity slot, or undefined if none is registered.
 */
export function getSlot(shape: object): ShapeSlot | undefined {
  return getRuntimeState().slots.get(shape)
}

/**
 * 读取或创建 Shape 的身份槽。
 *
 * @param shape - the shape whose slot to read or create.
 * @returns the shape's identity slot.
 */
export function ensureSlot(shape: object): ShapeSlot {
  const state = getRuntimeState()
  let slot = state.slots.get(shape)
  if (!slot) {
    slot = {}
    state.slots.set(shape, slot)
  }
  return slot
}

/**
 * 读输入 Shape 的 roleTable（op 实现读**输入**表的唯一读口，1.10 前置③）。
 *
 * 语义 = 旧 `getSlot(shape)?.roleTable`：权威落点在血缘图的 part 键旁挂
 * （上一条语句 fromBrep 时记录），slot 缓存字段已删除。未记录 → undefined
 * （mesh 产物 / 无命名）。
 *
 * @param shape - the input shape whose role table to read.
 * @returns the role table (unknown — callers assert their table type), or undefined.
 */
export function inputRoleTable(shape: object): unknown | undefined {
  const name = nameOf(shape)
  return name ? runtimeLineage.tableOfPart(name) : undefined
}

/**
 * 该 Shape 是否在 BREP 链上（有 OCCT 句柄）。引擎分派与 UI 查询用。
 *
 * @param shape - the shape to test.
 * @returns true if the shape has an attached OCCT handle.
 */
export function hasBrep(shape: Shape): boolean {
  return getRuntimeState().slots.get(shape)?.solid !== undefined
}

/**
 * 读取该 Shape 的 OCCT 句柄（无则 undefined）。库函数用前必须判空。
 *
 * @param shape - the shape whose handle to read.
 * @returns the OCCT handle, or undefined if none.
 */
export function brepOf(shape: Shape): unknown | undefined {
  return getRuntimeState().slots.get(shape)?.solid
}

/**
 * nameOf 批量版：Shape[] → 成员名（装配 memberNames，P6 替代读 IR）。
 *
 * @param shapes - the shapes to name.
 * @returns the member names, one per shape (empty string when unnamed).
 */
export function nameOfShapes(shapes: Shape[]): string[] {
  return shapes.map((s) => String(nameOf(s) ?? ''))
}
