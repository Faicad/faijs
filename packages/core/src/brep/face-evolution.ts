/**
 * 面演化（face evolution）工具：hash 映射 ↔ ordinal 映射转换
 *
 * See docs/api-contract.md §11 (topology contract) for face evolution context.
 *
 * occt-wasm 的 *WithHistory API 返回 BrepEvolutionData，其中 modified/generated
 * 用面 hash（内存指针哈希）编码。本模块将其解码为 ordinal 映射（面枚举序号），
 * 可安全持久化进 faijs 文本。
 *
 * 核心原理（分析文档 §4.4）：
 * getSubShapes(shape,'face')[i] ↔ subShapeHashes(shape,'face',B)[i] 一一对应
 * 因此可以把 hash 映射无损转换为 ordinal 映射。
 */

import type { BrepHandle, BrepEvolutionData } from './engine/types'
import type { BrepEngineApi } from './engine/primitives'

/** hash 上界（与 occt-wasm kernel.cpp 一致：`% 2147483647`） */
export const HASH_UPPER_BOUND = 2147483647

/**
 * 面演化映射：输入面 ordinal → 输出面 ordinal 列表
 *
 * - 1→1：面被修改但未被切割（如面带孔仍是单面）
 * - 1→N：面被切割成多个面
 * - 不在 map 中：面未被修改或被删除
 */
export type FaceEvolution = Map<number, number[]>

/**
 * Collect the hash list of all faces of a shape (via subShapeHashes; efficient, no handles allocated).
 * @param kernel - the OCCT kernel.
 * @param shape - the shape whose face hashes to collect.
 * @returns the array of face hashes.
 */
export function getFaceHashes(kernel: BrepEngineApi, shape: BrepHandle): number[] {
  return Array.from(kernel.subShapeHashes(shape, 'face', HASH_UPPER_BOUND))
}

/**
 * Collect the union of face hashes of two shapes (for WithHistory calls of binary boolean operations).
 *
 * Analysis doc §4.2: fuse/cut/intersect must pass subShapeHashes(A) ∪ subShapeHashes(B)
 * to track both inputs' face evolution.
 * @param kernel - the OCCT kernel.
 * @param shapeA - the first input shape.
 * @param shapeB - the second input shape.
 * @returns the union of the two shapes' face hashes.
 */
export function getUnionFaceHashes(
  kernel: BrepEngineApi,
  shapeA: BrepHandle,
  shapeB: BrepHandle,
): number[] {
  const hashesA = getFaceHashes(kernel, shapeA)
  const hashesB = getFaceHashes(kernel, shapeB)
  return [...new Set([...hashesA, ...hashesB])]
}

/**
 * 解码 BrepEvolutionData 的 modified 数组为 ordinal 映射。
 *
 * modified 分段编码格式：[inputHash, count, outHash1, outHash2, ...] × N
 *
 * @param kernel      the OCCT kernel.
 * @param evo         the BrepEvolutionData (from a *WithHistory API).
 * @param inputShape  the input shape (for the input face hash → ordinal mapping).
 * @param resultShape the result shape (for the output face hash → ordinal mapping).
 * @returns the FaceEvolution: inOrdinal → outOrdinal[].
 */
export function decodeEvolution(
  kernel: BrepEngineApi,
  evo: BrepEvolutionData,
  inputShape: BrepHandle,
  resultShape: BrepHandle,
): FaceEvolution {
  const inputHashes = getFaceHashes(kernel, inputShape)
  const resultHashes = getFaceHashes(kernel, resultShape)

  // 构建 hash → ordinal 查找表
  const resultHashToOrdinal = new Map<number, number>()
  for (let i = 0; i < resultHashes.length; i++) {
    resultHashToOrdinal.set(resultHashes[i], i)
  }
  const inputHashToOrdinal = new Map<number, number>()
  for (let i = 0; i < inputHashes.length; i++) {
    inputHashToOrdinal.set(inputHashes[i], i)
  }

  // 解码 modified 数组
  const evolution: FaceEvolution = new Map()
  const modified = evo.modified
  let idx = 0
  while (idx < modified.length) {
    const inHash = modified[idx]
    const count = modified[idx + 1]
    const outOrdinals: number[] = []
    for (let j = 0; j < count; j++) {
      const outHash = modified[idx + 2 + j]
      const outOrdinal = resultHashToOrdinal.get(outHash)
      if (outOrdinal !== undefined) {
        outOrdinals.push(outOrdinal)
      }
    }
    const inOrdinal = inputHashToOrdinal.get(inHash)
    if (inOrdinal !== undefined) {
      evolution.set(inOrdinal, outOrdinals)
    }
    idx += 2 + count
  }

  return evolution
}


/**
 * Hash 键面演化：输入面 hash → 输出面 hash 列表（1→多分裂时多个）。
 *
 * 与序号键 FaceEvolution 并列、同源（同一次 *WithHistory 打包结果解出），
 * 一个供 role 传播（hash 键）、一个供选择器/文本（序号键），零额外 wasm 调用。
 */
export interface HashEvolution {
  /** 输入面 hash → 输出面 hash 列表（1→多分裂时多个）。 */
  readonly modified: ReadonlyMap<number, readonly number[]>
  /** 输入面中已不存在的面 hash。 */
  readonly deleted: ReadonlySet<number>
}

/**
 * 把 BrepEvolutionData 解码为 hash 键演化（§2.4）。
 *
 * modified 分段编码格式：[inHash, count, outHash1, ...] × N —— 本身就是
 * hash→hash[] 的 1→多映射，直接按同一格式解出 hash 键版本，不需要
 * getSubShapes 逐句柄 hashCode，也不分配任何句柄。
 *
 * generated 刻意不进 role 传播。**实测依据（2026-09-22，`brep/engine/phase0-kernel-probes.test.ts`）**：
 * `generated` 与 `modified` **同构分段、键集相同**，其值是各输入面派生出的**中间形**——
 * `cut` 实测 12 个 hash、结果里 **0 个存活**（`fillet`/`fuse` 里整个桶为空）。
 * ⇒ 新造面**不能**由 `generated` 定位，只能由"三类命运"的补集判定
 * （既不在输入 hash 集合、也不在任何 `modified` 输出里），再交 `construct`/派生词汇命名。
 *
 * @param evo - the BrepEvolutionData (from a *WithHistory API).
 * @returns the hash-keyed evolution.
 */
export function decodeHashEvolution(evo: BrepEvolutionData): HashEvolution {
  const modified = new Map<number, number[]>()
  const m = evo.modified
  let idx = 0
  while (idx < m.length) {
    const inHash = m[idx]
    const count = m[idx + 1]
    const outHashes: number[] = []
    for (let j = 0; j < count; j++) {
      outHashes.push(m[idx + 2 + j])
    }
    modified.set(inHash, outHashes)
    idx += 2 + count
  }
  return { modified, deleted: new Set(evo.deleted) }
}

/**
 * 把一次双输入布尔（cut/fuse/intersect）的打包演化按「inHash 属于 A 还是 B」
 * 拆成 A、B 两张 hash 演化（§3.4 布尔合流，faijs 对 brepjs 的必要扩展）。
 *
 * 现有 *WithHistoryBrep 包装只用 getUnionFaceHashes 传入 A∪B 两边 hash、且只对
 * 基体 a 解码序号演化。本函数对同一份 evo 零额外内核调用：用 subShapeHashes(a)
 * / subShapeHashes(b) 两个集合判定每个 inHash 的归属，各自传播各自的 role 表。
 *
 * @param evo     - the BrepEvolutionData (from a binary boolean *WithHistory API).
 * @param hashesA - the face hashes of input A (target), via subShapeHashes.
 * @param hashesB - the face hashes of input B (tool), via subShapeHashes.
 * @returns the A/B split hash evolutions (faces from neither input are dropped).
 */
export function splitHashEvolutionByOrigin(
  evo: BrepEvolutionData,
  hashesA: readonly number[],
  hashesB: readonly number[],
): { a: HashEvolution; b: HashEvolution } {
  const raw = decodeHashEvolution(evo)
  const setA = new Set(hashesA)
  const setB = new Set(hashesB)

  const aModified = new Map<number, number[]>()
  const bModified = new Map<number, number[]>()
  for (const [inHash, outs] of raw.modified) {
    if (setA.has(inHash)) aModified.set(inHash, [...outs])
    else if (setB.has(inHash)) bModified.set(inHash, [...outs])
  }

  const aDeleted = new Set<number>()
  const bDeleted = new Set<number>()
  for (const h of raw.deleted) {
    if (setA.has(h)) aDeleted.add(h)
    else if (setB.has(h)) bDeleted.add(h)
  }

  return { a: { modified: aModified, deleted: aDeleted }, b: { modified: bModified, deleted: bDeleted } }
}

/**
 * 构造 hash 键恒等演化：输入第 i 面 hash → 输出第 i 面 hash（按枚举序号对齐）。
 *
 * ⚠️ **Phase 0.3 后本函数只用于「内核无 `*WithHistory` 可表达」的 4 个 op**：
 *
 * | op | 为什么不能走权威映射 |
 * |---|---|
 * | `rotate_euler` | 任意欧拉角 + pivot；内核只有**单轴** `rotateWithHistory` |
 * | `scale3d` | 非等比；`generalTransform` 无历史（`scaleWithHistory` 只收均匀 factor） |
 * | `copy` | 深拷贝；内核无 `copyWithHistory` |
 * | `place` | 任意矩阵 `located`；内核无对应历史 API |
 *
 * `translate` / `scale`（均匀）已改走权威映射（`translateWithHashEvolution` /
 * `scaleWithHashEvolution`），不再经过本函数。
 *
 * ⚠️ **本函数的正确性依赖一个曾经未被验证的假设**：刚体变换/深拷贝保持 OCCT 的
 * 面枚举序号。该假设现由 `brep/face-evolution.ordering.test.ts` 实测钉住。
 * 若该测试变红 ⇒ 本函数在这 4 个 op 上会产出**错误的身份映射**，
 * 必须为它们找别的权威来源，**不是**调松测试。
 *
 * @param kernel       - the OCCT kernel.
 * @param inputShape   - the input shape.
 * @param resultShape  - the transformed/copied output shape.
 * @returns the hash identity evolution (modified: in[i] → [out[i]]).
 */
export function identityHashEvolution(
  kernel: BrepEngineApi,
  inputShape: BrepHandle,
  resultShape: BrepHandle,
): HashEvolution {
  const inputHashes = getFaceHashes(kernel, inputShape)
  const resultHashes = getFaceHashes(kernel, resultShape)
  const count = Math.min(inputHashes.length, resultHashes.length)
  const modified = new Map<number, number[]>()
  for (let i = 0; i < count; i++) {
    modified.set(inputHashes[i], [resultHashes[i]])
  }
  return { modified, deleted: new Set() }
}

/**
 * 平移 + **权威**面演化（Phase 0.3）：走内核 `translateWithHistory`。
 *
 * 与 `identityHashEvolution` 的区别：这里的 `inHash → outHash[]` 是 OCCT 自己给的，
 * **不依赖**"枚举序号在变换后保持"这个此前从未验证的假设（分析文档 §7 第 6 项）。
 * 实测（`brep/engine/evolution-bindings.test.ts`）：刚体变换的权威映射为
 * 1:1 全覆盖（`coveredInputs === 面数`、`deleted` 空、`generated` 空）。
 *
 * @param kernel - the OCCT kernel.
 * @param shape  - the input shape.
 * @param d      - the translation vector as [dx, dy, dz].
 * @returns the translated handle plus the authority hash evolution.
 */
export function translateWithHashEvolution(
  kernel: BrepEngineApi,
  shape: BrepHandle,
  d: readonly [number, number, number],
): { result: BrepHandle; evolution: HashEvolution } {
  const inputHashes = getFaceHashes(kernel, shape)
  const evo = kernel.translateWithHistory(shape, d[0], d[1], d[2], inputHashes, HASH_UPPER_BOUND)
  return { result: evo.result, evolution: decodeHashEvolution(evo) }
}

/**
 * 均匀缩放 + **权威**面演化（Phase 0.3）：走内核 `scaleWithHistory`。
 *
 * ⚠️ **仅均匀缩放**。非均匀缩放内核无 `*WithHistory`（`generalTransform` 无历史），
 * 故 `scale3d` 无法走本函数——它退回 `identityHashEvolution`，其"面序保持"假设
 * 由 `brep/face-evolution.ordering.test.ts` 钉住。
 *
 * @param kernel - the OCCT kernel.
 * @param shape  - the input shape.
 * @param center - the fixed point of the scaling (not scaled).
 * @param factor - the uniform scale factor.
 * @returns the scaled handle plus the authority hash evolution.
 */
export function scaleWithHashEvolution(
  kernel: BrepEngineApi,
  shape: BrepHandle,
  center: readonly [number, number, number],
  factor: number,
): { result: BrepHandle; evolution: HashEvolution } {
  const inputHashes = getFaceHashes(kernel, shape)
  const evo = kernel.scaleWithHistory(
    shape,
    { x: center[0], y: center[1], z: center[2] },
    factor,
    inputHashes,
    HASH_UPPER_BOUND,
  )
  return { result: evo.result, evolution: decodeHashEvolution(evo) }
}

/**
 * 双输入布尔 + roleTable 合流组合封装（§3.4，stdlib boolean 链式调用用）。
 *
 * 一次 *WithHistory 内核调用同时产出：
 * - result：结果实体
 * - faceEvolution：序号键演化（进 faceEvolutionCache，服务选择器/可视化）
 * - roleTable：A/B 两侧 role 表各自传播后合并（进 roleTableCache，服务命名）
 *
 * 缝面（generated）刻意不进 role 传播（§1.3/R2：generated hash 指向中间形、
 * 实测 0 存活）。新 origin 一律是**本次语句的 StmtId**（Phase 1.6：不再用 LHS
 * 变量名——PartName 会被改名/复用，StmtId 全局唯一）。
 *
 * @param kernel  - the OCCT kernel.
 * @param op      - the boolean operation ('fuse' | 'cut' | 'intersect').
 * @param a       - the target shape.
 * @param b       - the tool shape.
 * @param tableA  - the target's role table.
 * @param tableB  - the tool's role table.
 * @param outStmt - the boolean statement's StmtId (串形；新 origin for seam faces).
 * @returns the result handle, ordinal evolution and merged role table.
 */
export function booleanWithRoleTable(
  kernel: BrepEngineApi,
  op: 'fuse' | 'cut' | 'intersect',
  a: BrepHandle,
  b: BrepHandle,
  tableA: ReadonlyMap<unknown, unknown>,
  tableB: ReadonlyMap<unknown, unknown>,
  outStmt: string,
): { result: BrepHandle; faceEvolution: FaceEvolution; roleTable: ReadonlyMap<unknown, unknown> } {
  const inputHashes = getUnionFaceHashes(kernel, a, b)
  let evo: BrepEvolutionData
  if (op === 'fuse') evo = kernel.fuseWithHistory(a, b, inputHashes, HASH_UPPER_BOUND)
  else if (op === 'cut') evo = kernel.cutWithHistory(a, b, inputHashes, HASH_UPPER_BOUND)
  else evo = kernel.intersectWithHistory(a, b, inputHashes, HASH_UPPER_BOUND)

  const faceEvolution = decodeEvolution(kernel, evo, a, evo.result)

  // A/B 拆流 → 各自传播 → 合表（§3.4）
  const hashesA = getFaceHashes(kernel, a)
  const hashesB = getFaceHashes(kernel, b)
  const { a: evoA, b: evoB } = splitHashEvolutionByOrigin(evo, hashesA, hashesB)
  const merged = mergeRoleTablesLocal(tableA, evoA, tableB, evoB, outStmt)

  return { result: evo.result, faceEvolution, roleTable: merged }
}

/** 合表（避免 naming/roles 循环依赖：本文件不 import naming，用结构等价实现）。 */
function mergeRoleTablesLocal(
  tableA: ReadonlyMap<unknown, unknown>,
  evoA: HashEvolution,
  tableB: ReadonlyMap<unknown, unknown>,
  evoB: HashEvolution,
  outPart: string,
): ReadonlyMap<unknown, unknown> {
  const result = new Map<unknown, unknown>()
  for (const [origin, roles] of tableA) {
    result.set(origin, propagateOriginRoles(roles as ReadonlyMap<string, readonly number[]>, evoA))
  }
  for (const [origin, roles] of tableB) {
    const existing = result.get(origin) as ReadonlyMap<string, readonly number[]> | undefined
    const advanced = propagateOriginRoles(roles as ReadonlyMap<string, readonly number[]>, evoB)
    if (existing) {
      const merged = new Map<string, number[]>()
      for (const [role, hs] of existing) merged.set(role, [...hs])
      for (const [role, hs] of advanced) {
        const prev = merged.get(role)
        merged.set(role, prev ? [...new Set([...prev, ...hs])] : [...hs])
      }
      result.set(origin, merged)
    } else {
      result.set(origin, advanced)
    }
  }
  // 缝面位置名：调用方决定是否补（generated 不可靠，默认不补）
  void outPart
  return result
}

/** 单 origin 传播（结构等价于 naming/roles.propagateRoles，避免循环依赖）。 */
function propagateOriginRoles(
  roles: ReadonlyMap<string, readonly number[]>,
  evolution: HashEvolution,
): ReadonlyMap<string, readonly number[]> {
  const updated = new Map<string, number[]>()
  for (const [role, hashes] of roles) {
    const successors: number[] = []
    for (const hash of hashes) {
      if (evolution.deleted.has(hash)) continue
      const modified = evolution.modified.get(hash)
      const targets = modified !== undefined && modified.length > 0 ? modified : [hash]
      for (const h of targets) if (!successors.includes(h)) successors.push(h)
    }
    if (successors.length > 0) updated.set(role, successors)
  }
  return updated
}

/**
 * Decode a BrepEvolutionData deleted array into the ordinal list of deleted faces.
 * @param kernel     - the OCCT kernel.
 * @param evo        - the BrepEvolutionData (from a *WithHistory API).
 * @param inputShape - the input shape (for the hash → ordinal mapping).
 * @returns the array of deleted face ordinals.
 */
export function decodeDeleted(
  kernel: BrepEngineApi,
  evo: BrepEvolutionData,
  inputShape: BrepHandle,
): number[] {
  const inputHashes = getFaceHashes(kernel, inputShape)
  const inputHashToOrdinal = new Map<number, number>()
  for (let i = 0; i < inputHashes.length; i++) {
    inputHashToOrdinal.set(inputHashes[i], i)
  }

  const deletedOrdinals: number[] = []
  for (const hash of evo.deleted) {
    const ordinal = inputHashToOrdinal.get(hash)
    if (ordinal !== undefined) {
      deletedOrdinals.push(ordinal)
    }
  }
  return deletedOrdinals
}

// ─── WithHistory 封装函数 ───

/**
 * cutWithHistory 封装：执行切割并返回结果 + 面演化映射。
 *
 * @param kernel OCCT 内核
 * @param a 基体
 * @param b 工具（从基体中减去）
 * @returns { result: 结果 BrepHandle, faceEvolution: 面演化映射 }
 */
export function cutWithHistoryBrep(
  kernel: BrepEngineApi,
  a: BrepHandle,
  b: BrepHandle,
): { result: BrepHandle; faceEvolution: FaceEvolution } {
  const inputHashes = getUnionFaceHashes(kernel, a, b)
  const evo = kernel.cutWithHistory(a, b, inputHashes, HASH_UPPER_BOUND)
  const faceEvolution = decodeEvolution(kernel, evo, a, evo.result)
  return { result: evo.result, faceEvolution }
}

/**
 * fuseWithHistory wrapper: performs the fuse and returns the result plus the face evolution mapping.
 * @param kernel - the OCCT kernel.
 * @param a - the base shape.
 * @param b - the tool shape to fuse into the base.
 * @returns the result BrepHandle plus the face evolution mapping.
 */
export function fuseWithHistoryBrep(
  kernel: BrepEngineApi,
  a: BrepHandle,
  b: BrepHandle,
): { result: BrepHandle; faceEvolution: FaceEvolution } {
  const inputHashes = getUnionFaceHashes(kernel, a, b)
  const evo = kernel.fuseWithHistory(a, b, inputHashes, HASH_UPPER_BOUND)
  const faceEvolution = decodeEvolution(kernel, evo, a, evo.result)
  return { result: evo.result, faceEvolution }
}

/**
 * intersectWithHistory wrapper: performs the intersection and returns the result plus the face evolution mapping.
 * @param kernel - the OCCT kernel.
 * @param a - the first input shape.
 * @param b - the second input shape.
 * @returns the result BrepHandle plus the face evolution mapping.
 */
export function intersectWithHistoryBrep(
  kernel: BrepEngineApi,
  a: BrepHandle,
  b: BrepHandle,
): { result: BrepHandle; faceEvolution: FaceEvolution } {
  const inputHashes = getUnionFaceHashes(kernel, a, b)
  const evo = kernel.intersectWithHistory(a, b, inputHashes, HASH_UPPER_BOUND)
  const faceEvolution = decodeEvolution(kernel, evo, a, evo.result)
  return { result: evo.result, faceEvolution }
}

// ─── 变换操作面演化 ───

/**
 * 构造恒等面演化映射（用于 translate/rotate/scale 等不改变拓扑的操作）。
 *
 * 变换操作不改变面的数量和顺序，每个面 ordinal i → [i]。
 * 避免调用 *WithHistory API（rotate/scale 的 WithHistory 签名与现有 Euler/Vec3 参数不兼容）。
 *
 * @param kernel OCCT 内核
 * @param shape 输入形状（用于获取面数量）
 * @returns 恒等 FaceEvolution
 */
export function identityEvolution(
  kernel: BrepEngineApi,
  shape: BrepHandle,
): FaceEvolution {
  const faceCount = getFaceHashes(kernel, shape).length
  const evolution: FaceEvolution = new Map()
  for (let i = 0; i < faceCount; i++) {
    evolution.set(i, [i])
  }
  return evolution
}

// ─── directEdit WithHistory 封装（fillet / chamfer：单输入） ───

/**
 * 单输入 directEdit（fillet/chamfer）+ roleTable 传播封装。
 *
 * 与 `booleanWithRoleTable`（双输入）对应：单输入只有一张输入 role 表，
 * 一次 `*WithHistory` 内核调用产出结果 + 面演化，沿 hash 演化推进所有 origin。
 *
 * generated 刻意不进 role 传播（§1.3 事实：generated hash 指向中间形，
 * 实测 0 存活），过渡面的命名由 DerivedFaceTopoRef 在 M2 处理。
 *
 * @param kernel          - the OCCT kernel.
 * @param op              - the directEdit operation ('fillet' | 'chamfer').
 * @param solid          - the input solid (single input, unlike boolean's a/b).
 * @param edgeHandles     - the resolved Edge handles to fillet/chamfer.
 * @param radius          - the fillet radius or chamfer distance (uniform only).
 * @param inputRoleTable  - the input's role table.
 * @param outPart         - the statement's LHS variable name (for new origin allocation).
 * @returns the result handle, ordinal evolution and propagated role table.
 */
export function directEditWithRoleTable(
  kernel: BrepEngineApi,
  op: 'fillet' | 'chamfer',
  solid: BrepHandle,
  edgeHandles: BrepHandle[],
  radius: number,
  inputRoleTable: ReadonlyMap<unknown, unknown>,
  outPart: string,
): { result: BrepHandle; faceEvolution: FaceEvolution; roleTable: ReadonlyMap<unknown, unknown> } {
  const inputHashes = getFaceHashes(kernel, solid)
  let evo: BrepEvolutionData
  if (op === 'fillet') {
    evo = kernel.filletWithHistory(solid, edgeHandles, radius, inputHashes, HASH_UPPER_BOUND)
  } else {
    evo = kernel.chamferWithHistory(solid, edgeHandles, radius, inputHashes, HASH_UPPER_BOUND)
  }

  const faceEvolution = decodeEvolution(kernel, evo, solid, evo.result)
  const hashEvo = decodeHashEvolution(evo)
  const roleTable = propagateAllOriginsLocal(inputRoleTable, hashEvo)

  // outPart used for new-origin allocation in M2 (derived faces); M1 does not
  // generate positional roles for transition faces.
  void outPart

  return { result: evo.result, faceEvolution, roleTable }
}

/**
 * 单输入 directEdit 的便捷别名：fillet。
 *
 * @param kernel          - the OCCT kernel.
 * @param solid          - the input solid.
 * @param edgeHandles     - the resolved Edge handles.
 * @param radius          - the fillet radius (uniform).
 * @param inputRoleTable  - the input's role table.
 * @param outPart         - the statement's LHS variable name.
 * @returns the result handle, ordinal evolution and propagated role table.
 */
export function filletWithRoleTable(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  edgeHandles: BrepHandle[],
  radius: number,
  inputRoleTable: ReadonlyMap<unknown, unknown>,
  outPart: string,
): { result: BrepHandle; faceEvolution: FaceEvolution; roleTable: ReadonlyMap<unknown, unknown> } {
  return directEditWithRoleTable(kernel, 'fillet', solid, edgeHandles, radius, inputRoleTable, outPart)
}

/**
 * 单输入 directEdit 的便捷别名：chamfer。
 *
 * @param kernel          - the OCCT kernel.
 * @param solid          - the input solid.
 * @param edgeHandles     - the resolved Edge handles.
 * @param distance        - the chamfer distance (uniform).
 * @param inputRoleTable  - the input's role table.
 * @param outPart         - the statement's LHS variable name.
 * @returns the result handle, ordinal evolution and propagated role table.
 */
export function chamferWithRoleTable(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  edgeHandles: BrepHandle[],
  distance: number,
  inputRoleTable: ReadonlyMap<unknown, unknown>,
  outPart: string,
): { result: BrepHandle; faceEvolution: FaceEvolution; roleTable: ReadonlyMap<unknown, unknown> } {
  return directEditWithRoleTable(kernel, 'chamfer', solid, edgeHandles, distance, inputRoleTable, outPart)
}

/** 单输入 roleTable 传播（结构等价于 naming/roles.propagateAllOrigins，避免循环依赖）。 */
function propagateAllOriginsLocal(
  roles: ReadonlyMap<unknown, unknown>,
  evolution: HashEvolution,
): ReadonlyMap<unknown, unknown> {
  const result = new Map<unknown, unknown>()
  for (const [origin, originRoles] of roles) {
    result.set(origin, propagateOriginRoles(originRoles as ReadonlyMap<string, readonly number[]>, evolution))
  }
  return result
}
