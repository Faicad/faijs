/**
 * backend-dispatch — BREP/mesh 路径静态判定（引擎侧）
 *
 *
 * 红线（AGENTS.md）：BREP 链是否可用，由静态规则在执行前判定，
 * **禁止运行时 try-catch 回退**。BREP 路径抛异常 = 设计缺陷或 bug，必须直接报错暴露。
 *
 * 本文件从 src/api/internal/resolve-path.ts 迁移而来：判定是引擎的职责，
 * 不该由每个库函数各自调用。
 *
 * ⚠️ 分层例外：本文件位于 cad-runtime/ 但被 api/ import。
 * 这是安全的——它只依赖 runtime-state / api/shape / mesh/types，
 * 不依赖 cad-runtime 的任何其他模块，因此不构成循环。
 * P4b（可选）把函数拆成 brep/mesh 双实现后，此依赖会自然消失。
 */

import { getBackends, getCurrentStmt, BrepUnsupportedError, MeshUnsupportedError } from '../runtime-state'
import { hasBrep, hasMeshFace, hasMeshSolid, isCompoundLike } from '../shape'
import type { BrepEngineId } from '../brep/engine/types'
import type { Shape } from '../mesh/types'

/** 静态判定的两个可能结果：走 BREP 链或 mesh 链。 */
export type BrepPath = 'brep' | 'mesh'

/**
 * Shape 身份槽互斥校验（方案 2026-10-01 §3.2）：一个 Shape 只能携带**一种**链身份
 * ——BREP 精度链句柄 / 网格实体句柄 / 网格链面句柄，三者取一。
 *
 * 两人同时存在意味着"这个零件既在精度链又在近似链上"——后续无论按哪一侧分派
 * 都是错的（按 BREP 走 → 近似几何被当精确实体；按 mesh 走 → 精确句柄悬空）。
 * 这是设计缺陷而非可恢复状态，故在**分派之前**直接抛错，不给运行时"选边站"的
 * 机会（静态判定红线）。
 *
 * 三个写入点（`attachBrep` / `attachMeshSolid` / `attachMeshFace`）已经把互斥钉在
 * 写入侧；这里在分派前再兜一层，兜的是"绕开构造器直接改 slot"的路径。
 *
 * @param inputs - the shapes feeding the operation.
 * @throws {Error} `E_SHAPE_SLOT_EXCLUSIVE` when a shape carries more than one chain identity.
 */
export function assertShapeSlotExclusive(inputs: readonly Shape[]): void {
  for (const s of inputs) {
    const carriers: string[] = []
    if (hasBrep(s)) carriers.push('BREP')
    if (hasMeshSolid(s)) carriers.push('mesh solid')
    if (hasMeshFace(s)) carriers.push('mesh-chain face')
    if (carriers.length > 1) {
      throw new Error(
        `E_SHAPE_SLOT_EXCLUSIVE: input shape carries ${carriers.join(' and ')} handles — ` +
        'a shape belongs to exactly one chain identity (precision, mesh solid, or mesh-chain face)',
      )
    }
  }
}

/**
 * `meshEngines` 缺省值（方案 2026-10-01 §3.4）：内置 `mesh/`（manifold CSG）。
 *
 * 为什么缺省是"只认识裸网格"而不是"全都能"：mesh 实现默认跑在 manifold 上，它拿不到
 * 网格实体句柄；给一个不声明 `meshEngines` 的 op 喂网格实体，唯一诚实的结局是**静态
 * 报错**，而不是在运行时挑一个能跑的后端（红线：无运行时回退）。
 */
export const DEFAULT_MESH_ENGINES: readonly string[] = ['manifold']

/**
 * 网格链输入的静态门禁（方案 2026-10-01 §3.4 规则 1 / 规则 4）。
 *
 * "网格链输入"= 网格实体（`meshSolid`）或网格链面（`meshFace`）——两者都是近似链上的
 * 构造中几何，都要由**声明的**网格后端来读懂。
 *
 * 只在**已判定走 mesh 路径**时调用（brep 模式下网格实体的归宿是
 * `E_BREP_UNSUPPORTED`——网格零件按定义没有精度链，那条判定更贴切）。
 *
 * 两条不变量：
 * 1. **链不可混**：一次调用里要么全是网格链输入，要么都不是。网格链输入与 BREP 实体
 *    （或裸网格）混在一起时，任一侧的结局都是隐式降级——走 manifold 会把网格实体的
 *    身份与近似拓扑静默丢掉，走网格后端则拿不到对侧实体的句柄。故直接报错。
 * 2. **后端必须声明接受**：当前装配的网格后端 id 必须出现在 op 的 `meshEngines` 里。
 *
 * @param inputs - the shapes feeding the operation.
 * @param impls - the op's implementation set (reads `meshEngines` / `name`).
 * @throws {Error} `E_MESH_SOLID_MIXED` when mesh-chain inputs are mixed with other geometry.
 * @throws {MeshUnsupportedError} `E_MESH_SOLID_UNSUPPORTED` when the mesh backend is not declared.
 */
function assertMeshSolidInputs(
  inputs: readonly Shape[],
  impls: { meshEngines?: readonly string[]; name?: string },
): void {
  let chainCount = 0
  for (const s of inputs) if (hasMeshSolid(s) || hasMeshFace(s)) chainCount++
  if (chainCount === 0) return

  const opLabel = impls.name ? ` '${impls.name}'` : ''
  if (chainCount !== inputs.length) {
    throw new Error(
      `E_MESH_SOLID_MIXED: op${opLabel} got both mesh-chain geometry and other geometry ` +
      `(${chainCount}/${inputs.length} inputs are mesh solids or mesh-chain faces) — mesh-chain geometry ` +
      'cannot take part in an operation whose other inputs are outside its chain (the result would silently drop one side)',
    )
  }

  const declared = impls.meshEngines ?? DEFAULT_MESH_ENGINES
  const current = currentMeshBackendId()
  if (current !== null && declared.includes(current)) return
  throw new MeshUnsupportedError(
    `E_MESH_SOLID_UNSUPPORTED: op${opLabel} cannot accept mesh-chain input — current mesh backend ` +
    `is ${current ?? '<none>'} but the op declares [${declared.join(', ')}]`,
    getCurrentStmt(),
  )
}

/**
 * 当前装配的网格后端 id（未装配 → null）。
 *
 * 读的是**已装配的后端对象自身**（`Backends.kernel.meshSolid`）而不是注册表的另一份
 * 快照——装配事实只有一个来源，门禁不可能与装配结果漂移。类型在本模块只当结构读
 * （`{ id?: string }`），因为它对 runtime-state 是 `unknown`（零依赖红线）。
 *
 * @returns the assembled mesh backend id, or null when none is assembled.
 */
function currentMeshBackendId(): string | null {
  const backend = getBackends().kernel.meshSolid as { id?: unknown } | undefined
  return backend && typeof backend.id === 'string' ? backend.id : null
}

/**
 * Decide whether this invocation takes the BREP or the mesh backend path.
 *
 * Bidirectional dispatch (defineOp contract, D1/D1b/D2):
 * - `impls` carries mesh/brep implementation presence (function reference or
 *   undefined, fixed at defineOp construction — static).
 * - `mode='mesh'` → always mesh; missing mesh implementation (brep-only)
 *   throws `MeshUnsupportedError`.
 * - `mode='brep'` → missing brep / input off chain / engine not whitelisted
 *   throws `BrepUnsupportedError`.
 * - `mode='auto'` → brep when brep exists and all inputs are on the chain;
 *   otherwise mesh when mesh exists; brep-only with a broken input chain
 *   throws `MeshUnsupportedError` — no mesh to fall back to.
 *
 * Engine identity (`engines`, D11) is the **only** narrowing axis: a pure
 * engine whitelist, checked before mode and chain. There is no capability
 * declaration face — what a kernel can do is fixed in code at author time
 * (the engine adapters and `brep/engine/native-history.ts`), not declared in
 * op metadata and not looked up at dispatch.
 *
 * Red line unchanged: static dispatch, no runtime try-catch fallback. The
 * decision happens before the implementation runs and is never revised after a
 * failed execution.
 *
 * Third-party library authors never call this directly — `defineOp` (SDK)
 * invokes it inside its wrapper; authors only declare the implementation set.
 * @param inputs - the shapes feeding the operation, used to test whether all
 * lie on the BREP chain.
 * @param impls - the operation's implementation set: `mesh`/`brep` presence
 * (function reference or undefined; fixed at defineOp construction), plus the
 * op `name` (error messages).
 * @param engines - the operation's platform declaration (D11): `engines` from
 * the defineOp meta. Undefined/empty = neutral op (all engines). A platform op
 * whose engines do not include the current engine is rejected before the mode
 * and chain routing (D11-2: engine mismatch precedes everything else).
 * @returns the selected backend path: 'brep' or 'mesh'.
 */
export function dispatchPath(
  inputs: Shape[],
  impls: { mesh?: unknown; brep?: unknown; name?: string; meshEngines?: readonly string[] },
  engines?: readonly BrepEngineId[],
): BrepPath {
  // 前置不变量：槽位互斥（缺陷即报错，先于任何模式/引擎判定）。
  assertShapeSlotExclusive(inputs)
  const path = decidePath(inputs, impls, engines)
  // 网格实体输入的静态门禁（§3.4 规则 1/4）：只在**已经**选定 mesh 路径后判定。
  // 放在这里而不是最前面，是为了让 brep 模式下的网格实体仍拿到更贴切的
  // E_BREP_UNSUPPORTED（规则 3）——网格零件没有精度链，那才是它的第一条事实。
  if (path === 'mesh') assertMeshSolidInputs(inputs, impls)
  return path
}

/**
 * P2（2026-10-06-step-3mf-multipart-import-plan.md §7）：多零件 load 的输出是
 * compound——输入「在 BREP 链上」判定对其展开：children 全部有 OCCT 句柄才
 * 算链上（消费 op 按 partIndex 解包出的目标成员才是真正被操作的对象）。
 * 空 children / 混合链按不在链上处理（静态判定，不运行时回退）。
 */
function allInputsOnBrepChain(inputs: Shape[]): boolean {
  return inputs.every((s) => (isCompoundLike(s) ? s.children.length > 0 && s.children.every(hasBrep) : hasBrep(s)))
}

/**
 * The path decision itself (mode → engine identity → chain).
 *
 * Split out of `dispatchPath` so the mesh-solid gate can run *after* the path is
 * known, without duplicating the mesh-returning branches. Behaviour is
 * unchanged: every throw here is a "path not available" refusal.
 *
 * @param inputs - the shapes feeding the operation.
 * @param impls - the op's implementation set (presence + name + meshEngines).
 * @param engines - the op's BREP platform declaration (D11), if any.
 * @returns the selected backend path.
 */
function decidePath(
  inputs: Shape[],
  impls: { mesh?: unknown; brep?: unknown; name?: string; meshEngines?: readonly string[] },
  engines?: readonly BrepEngineId[],
): BrepPath {
  const { config } = getBackends()

  if (config.mode === 'mesh') {
    // D11-6: mode='mesh' 分支仍在最前——平台 op 与中立 op 一视同仁（有 mesh 实现就走
    // mesh）。宿主强制 mesh 时不因平台身份报错。
    if (!impls.mesh) {
      throw new MeshUnsupportedError('E_MESH_UNSUPPORTED: function has no mesh implementation', getCurrentStmt())
    }
    return 'mesh'
  }
  const currentStmt = getCurrentStmt()

  // ── D11-2: 平台身份判定，置于最前（引擎不匹配时没有别的可谈）──
  //
  // D11-3（mock 豁免，**有意为之**）：brep_mock 是测试替身，不代表任何真实平台——
  // 它的职责是让编排链路（naming、Result 边界、多输出）能被测到；真实引擎下的身份
  // 校验由 parity 测试与 engine-switch 测试覆盖。本豁免由 engine-switch-p5 测试钉住。
  if (engines && engines.length > 0) {
    const engineId = config.brepEngineId
    if (engineId !== 'brep_mock' && (engineId === null || engineId === undefined || !engines.some((e) => e === engineId))) {
      const opLabel = impls.name ? ` '${impls.name}'` : ''
      const current = engineId ?? '<none>'
      const message = `E_BREP_UNSUPPORTED: op${opLabel} requires engine ${engines.join('/')} (current=${current})`
      if (config.mode === 'brep') {
        // D11-4: brep 模式不匹配 → BrepUnsupportedError（执行前，非运行时回退）。
        throw new BrepUnsupportedError(message, currentStmt)
      }
      // D11-5: auto 模式 → 静态降级 mesh；无 mesh 实现 → MeshUnsupportedError。
      if (!impls.mesh) {
        throw new MeshUnsupportedError(
          `E_MESH_UNSUPPORTED: op${opLabel} requires engine ${engines.join('/')} (current=${current}) and has no mesh implementation`,
          currentStmt,
        )
      }
      return 'mesh'
    }
  }

  if (config.mode === 'brep') {
    if (!impls.brep) {
      throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: function has no BREP implementation', currentStmt)
    }
    if (!allInputsOnBrepChain(inputs)) {
      throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: input is not BREP', currentStmt)
    }
    return 'brep'
  }

  // auto 模式：brep 实现 + 输入全在链上 → brep；否则 mesh。
  if (impls.brep && allInputsOnBrepChain(inputs)) return 'brep'
  if (!impls.mesh) {
    throw new MeshUnsupportedError(
      'E_MESH_UNSUPPORTED: input is not BREP and function has no mesh implementation',
      currentStmt,
    )
  }
  return 'mesh'
}
