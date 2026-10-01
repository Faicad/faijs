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

/**
 * 1D 曲线 Shape（wire / helix / edge-loop 等无三角载荷的 1D 几何）。
 *
 * `kind: 'curve'` 表达「无三角载荷」，与 `'solid'` 对称（见 `curve()` /
 * `fromBrepCurve()`）。执行链路照走 `solidToShape`（wire → 空 0/0 载荷，不抛），
 * 显示经 `wireframe`。
 */
export interface CurveShape extends Shape {
  kind: 'curve'
}

/** A shape that the stdlib exports as a finished result. */
export type StdShape = SolidShape | CompoundShape | CurveShape

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
 * 1D 曲线 Shape 构造器（wire / helix / edge-loop 等 1D 产物）。
 *
 * 与 `solid` 对称：登记到 identity 表（供 `isShape` 识别），`kind` 设为 `'curve'`
 * 以表达「无三角载荷的 1D 几何」（执行链路照走 `solidToShape`，显示经 `wireframe`）。
 *
 * @param mesh - the mesh payload (positions/indices) to wrap as a curve.
 * @returns the created curve shape.
 */
export function curve(mesh: Shape): CurveShape {
  const s: CurveShape = { ...mesh, kind: 'curve' }
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
  attachBrep(s, holder)
  return s
}

/**
 * 1D 曲线产物的 BREP 登记构造器：与 `fromBrep` 对称，但 `kind` 取 `'curve'`
 * （维持既有「有无三角载荷」语义——1D 几何无三角载荷，不得报 `'solid'`）。
 * 登记逻辑与 `fromBrep` 共用 `attachBrep`，保证两种形态走同一份身份/血缘/释放语义。
 *
 * @param mesh - the mesh payload (positions/indices) to wrap as a curve.
 * @param holder - the BREP holder providing the OCCT handle and optional face evolution.
 * @returns the created curve shape with the BREP handle attached.
 */
export function fromBrepCurve(mesh: Shape, holder: BrepHolder): CurveShape {
  const s = curve(mesh)
  attachBrep(s, holder)
  return s
}

/**
 * 网格实体产物的构造器：与 `fromBrep` 对称，登记网格实体句柄（近似链）而非
 * BREP 句柄（精度链）。
 *
 * ```ts
 * return fromMeshSolid(displayMesh, { meshSolid: result.solid })
 * ```
 *
 * 与 `fromBrep` 的三点差别（方案 §3.2）：
 * 1. 写 `slot.meshSolid`，**不写** `slot.solid`——网格零件永不进 BREP 链；
 * 2. 不登记函数 BREP 域（`registerFunctionBrep`）——句柄所有权在
 *    `MeshSolidRegistry`，按 BREP 内核释放是错的（可能是另一个内核）；
 * 3. 不旁挂 roleTable（近似拓扑不给语义 role——role 是 BREP 真拓扑的专有能力）。
 *
 * @param mesh - the mesh shape to wrap as a solid (display mesh).
 * @param holder - the mesh-solid holder providing the handle identity.
 * @returns the created solid shape carrying the mesh-solid slot.
 */
export function fromMeshSolid(mesh: Shape, holder: MeshSolidHolder): SolidShape {
  const s = solid(mesh)
  attachMeshSolid(s, holder.meshSolid)
  return s
}

/** 网格实体句柄容器（与 `BrepHolder` 对称；类型为 unknown 以保持零依赖）。 */
export interface MeshSolidHolder {
  /** 网格实体句柄的**身份**（句柄本体在 `MeshSolidRegistry`）。 */
  meshSolid: unknown
}

/**
 * 网格链**面**产物的构造器（方案 2026-10-01 §4 Phase 3）。与 `fromBrep` 的
 * 面产物对称：BREP 侧 `sketchOnFace` 返回 `fromBrep(solidToShape(kernel, face),
 * { solid: face })`，这里返回 `fromMeshFace(meshShape(face), { meshFace: face })`。
 *
 * `kind` 沿用 `'solid'`（不是 `'shape2d'`）：与 BREP 侧的面 Shape 保持同一形态，
 * 好让 `extrude` 的 `isCurveShape` 预检在两条链上行为一致——面不是 1D 曲线，
 * 不该被面消费 op 当成曲线拒掉。
 *
 * @param mesh - the face's display mesh (its own tessellation).
 * @param holder - the mesh-face holder providing the handle identity.
 * @returns the created shape carrying the mesh-face slot.
 */
export function fromMeshFace(mesh: Shape, holder: MeshFaceHolder): SolidShape {
  const s = solid(mesh)
  attachMeshFace(s, holder.meshFace)
  return s
}

/** 网格链面句柄容器（与 `MeshSolidHolder` 对称；类型为 unknown 以保持零依赖）。 */
export interface MeshFaceHolder {
  /** 网格链面句柄的**身份**。 */
  meshFace: unknown
}

/**
 * 把网格实体句柄登记到已构造的 Shape。
 *
 * 互斥红线：该 Shape 已有 BREP 句柄或网格链面句柄时**直接抛错**——一个 Shape
 * 同时声称两种链身份是设计缺陷，不能静默覆盖任何一侧。
 *
 * @param s - the already-constructed shape.
 * @param meshSolid - the mesh solid handle.
 * @throws {Error} `E_SHAPE_SLOT_EXCLUSIVE` when the shape already carries another chain identity.
 */
export function attachMeshSolid(s: Shape, meshSolid: unknown): void {
  const state = getRuntimeState()
  const slot = state.slots.get(s) ?? {}
  if (slot.solid !== undefined) {
    throw new Error(
      'E_SHAPE_SLOT_EXCLUSIVE: shape already carries a BREP handle — a shape is either on the precision chain or the mesh chain, never both',
    )
  }
  if (slot.meshFace !== undefined) {
    throw new Error(
      'E_SHAPE_SLOT_EXCLUSIVE: shape already carries a mesh-chain face handle — a shape is either a mesh solid or a mesh-chain face, never both',
    )
  }
  slot.meshSolid = meshSolid
  state.slots.set(s, slot)
}

/**
 * 把网格链**面**句柄登记到已构造的 Shape。
 *
 * 与 `attachMeshSolid` 同一条互斥红线：已有任意另一种链身份即抛错。
 *
 * @param s - the already-constructed shape.
 * @param meshFace - the mesh-chain face handle.
 * @throws {Error} `E_SHAPE_SLOT_EXCLUSIVE` when the shape already carries another chain identity.
 */
export function attachMeshFace(s: Shape, meshFace: unknown): void {
  const state = getRuntimeState()
  const slot = state.slots.get(s) ?? {}
  if (slot.solid !== undefined || slot.meshSolid !== undefined) {
    throw new Error(
      'E_SHAPE_SLOT_EXCLUSIVE: shape already carries a BREP or mesh-solid handle — a mesh-chain face is its own identity',
    )
  }
  slot.meshFace = meshFace
  state.slots.set(s, slot)
}

/**
 * 该 Shape 是否携带网格链面（`sketchOnFace` 在近似拓扑面上的产物）。
 *
 * @param shape - the shape to test.
 * @returns true if the shape carries a mesh-chain face handle.
 */
export function hasMeshFace(shape: Shape): boolean {
  return getRuntimeState().slots.get(shape)?.meshFace !== undefined
}

/**
 * 读取该 Shape 的网格链面句柄（无则 undefined）。
 *
 * @param shape - the shape whose mesh-chain face handle to read.
 * @returns the mesh-chain face handle, or undefined if none.
 */
export function meshFaceOf(shape: Shape): unknown | undefined {
  return getRuntimeState().slots.get(shape)?.meshFace
}

/**
 * 该 Shape 是否携带网格实体（网格零件）。引擎分派与 UI 查询用。
 *
 * 与 `hasBrep` 互斥：正常路径下二者不可能同时为真（`attachMeshSolid` 已经把
 * 互斥钉在写入侧，`assertShapeSlotExclusive` 在分派前再兜一层）。
 *
 * @param shape - the shape to test.
 * @returns true if the shape carries a mesh solid handle.
 */
export function hasMeshSolid(shape: Shape): boolean {
  return getRuntimeState().slots.get(shape)?.meshSolid !== undefined
}

/**
 * 读取该 Shape 的网格实体句柄（无则 undefined）。
 *
 * @param shape - the shape whose mesh solid handle to read.
 * @returns the mesh solid handle, or undefined if none.
 */
export function meshSolidOf(shape: Shape): unknown | undefined {
  return getRuntimeState().slots.get(shape)?.meshSolid
}

/**
 * 把 BREP 句柄登记到已构造的 Shape（由 `solid` / `curve` 产出）。
 *
 * 集中 brep 登记的四步（identity 槽登记已由构造器完成；此处只补：① 身份槽挂载
 * 句柄 / ② 血缘图语句键旁挂 roleTable / ③ 函数 BREP 域登记）。供 `fromBrep` /
 * `fromBrepCurve` 共用——禁止绕开本函数手写登记（否则等于复制一整套身份、血缘与
 * 释放语义）。
 *
 * @param s - the already-constructed shape (solid or curve).
 * @param holder - the BREP holder to attach.
 */
function attachBrep(s: Shape, holder: BrepHolder): void {
  const state = getRuntimeState()
  const slot = state.slots.get(s) ?? {}
  if (slot.meshSolid !== undefined || slot.meshFace !== undefined) {
    // 互斥红线的另一侧：网格链产物不得再被登记成 BREP 实体（那会让 STEP 导出
    // 静默复活 facet STEP 的通道）。
    throw new Error(
      'E_SHAPE_SLOT_EXCLUSIVE: shape already carries a mesh-chain handle — a shape is either on the precision chain or the mesh chain, never both',
    )
  }
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

/**
 * 1D 曲线判定（1D 判别位，Phase 3）：`kind === 'curve'`。
 *
 * 面消费 op（extrude / revolve / sweep 等）用它做**执行前**输入维度预检——
 * 1D 产物（wire / helix / sketch as:'wire'）喂给面 op 时必须是明确的预检失败，
 * 不得落进内核深层才报「操作失败」。与 SDK 的 WeakSet 严格 `isShape` 不同，
 * 本判定是结构判定（与 `isCompoundLike` 同族），对跨库产物零要求。
 *
 * @param v - the value to test.
 * @returns true when the value is a 1D curve shape.
 */
export function isCurveShape(v: unknown): v is CurveShape {
  return !!v && typeof v === 'object' && (v as { kind?: string }).kind === 'curve'
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
