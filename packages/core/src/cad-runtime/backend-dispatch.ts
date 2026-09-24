/**
 * backend-dispatch — BREP/mesh 路径静态判定（引擎侧）
 *
 *
 * 红线（AGENTS.md）：BREP 链是否可用，由静态规则在执行前判定，
 * **禁止运行时 try-catch 回退**。BREP 路径抛异常 = 设计缺陷或 bug，必须直接报错暴露。
 *
 * 本文件从 src/stdlib/internal/resolve-path.ts 迁移而来：判定是引擎的职责，
 * 不该由每个库函数各自调用。
 *
 * ⚠️ 分层例外：本文件位于 cad-runtime/ 但被 stdlib/ import。
 * 这是安全的——它只依赖 runtime-state / stdlib/shape / mesh/types，
 * 不依赖 cad-runtime 的任何其他模块，因此不构成循环。
 * P4b（可选）把函数拆成 brep/mesh 双实现后，此依赖会自然消失。
 */

import { getBackends, getCurrentStmt, BrepUnsupportedError, MeshUnsupportedError } from '../runtime-state'
import { hasBrep } from '../shape'
import type { BrepEngineId, BrepEvolutionKind, BrepMethodKind } from '../brep/engine/types'
import type { Shape } from '../mesh/types'

/** 静态判定的两个可能结果：走 BREP 链或 mesh 链。 */
export type BrepPath = 'brep' | 'mesh'

/**
 * 能力名：族级布尔位（`BrepCapabilities` 里类型为 boolean 的字段）**加上**逐核函数的
 * 面演化名（`BrepEvolutionKind`，`evolution` 名单里的条目）。
 *
 * ⚠️ `'evolution'` 已从本联合中**移除**（2026-09-22 Phase 0.2）：它曾是"面演化族"的
 * 族级名，但族级声明会多报能力（内核可只提供部分 `*WithHistory`）→ 静态判定失效。
 * op 现在必须声明**具体**要哪个核函数（如 `['cut']`），引擎声明**具体**提供哪些
 * （`evolution: ['fuse','cut','fillet']`）。见 `brep/engine/types.ts` 的 `BrepEvolutionKind`。
 */
export type BrepCapabilityName =
  | 'heal'
  | 'directEdit'
  | 'advSurface'
  | 'assembly'
  | 'meshLift'
  | BrepEvolutionKind
  | BrepMethodKind

/**
 * 引擎能力声明的宽松镜像（`runtime-state.Backends.config.brepCapabilities` 同构；
 * 该模块须零依赖，故不复用 `BrepCapabilities`）。
 */
export interface EngineCapabilitiesLike {
  /** 本引擎实际提供的 `*WithHistory` 核函数名。 */
  evolution?: readonly string[]
  /** 本引擎实际提供的非演化内核方法名（`BrepMethodKind`）。 */
  methods?: readonly string[]
  heal?: boolean
  directEdit?: boolean
  advSurface?: boolean
  assembly?: boolean
  meshLift?: boolean
}

/**
 * 引擎能力声明 → 受支持能力名集合（族级布尔位 + `evolution` 名单展开成逐个核函数名）。
 * @param caps - 当前引擎的能力声明（缺省 = 空集，即什么都不支持）。
 * @returns 该引擎声明支持的 `BrepCapabilityName` 集合。
 */
export function engineCapabilitySet(caps: EngineCapabilitiesLike | undefined): ReadonlySet<string> {
  const set = new Set<string>()
  if (!caps) return set
  for (const kind of caps.evolution ?? []) set.add(kind)
  for (const method of caps.methods ?? []) set.add(method)
  if (caps.heal) set.add('heal')
  if (caps.directEdit) set.add('directEdit')
  if (caps.advSurface) set.add('advSurface')
  if (caps.assembly) set.add('assembly')
  if (caps.meshLift) set.add('meshLift')
  return set
}

/**
 * 声明列表中第一个**当前引擎不具备**的能力名（全具备则 `undefined`）。
 *
 * 读的是运行时配置里的能力声明（与 `dispatchPath` 同一来源），因此调用点与分派点
 * 对"缺哪个能力"的判断必然一致——不会出现"defineOp 认为缺 evolution、dispatch 认为具备"。
 * @param declared - op 声明的能力名列表（来自 `DualOpMeta.capabilities`）。
 * @returns 第一个缺失的能力名，或 undefined。
 */
export function firstMissingCapability(
  declared: readonly BrepCapabilityName[] | undefined,
): BrepCapabilityName | undefined {
  if (!declared?.length) return undefined
  const supported = engineCapabilitySet(getBackends().config.brepCapabilities)
  return declared.find((cap) => !supported.has(cap))
}

/**
 * Decide whether this invocation takes the BREP or the mesh backend path.
 *
 * Bidirectional dispatch (defineOp contract, D1/D1b/D2):
 * - `impls` carries mesh/brep implementation presence (function reference or
 *   undefined, fixed at defineOp construction — static).
 * - `mode='mesh'` → always mesh; missing mesh implementation (brep-only)
 *   throws `MeshUnsupportedError`.
 * - `mode='brep'` → missing brep / input off chain / missing capability throws
 *   `BrepUnsupportedError`.
 * - `mode='auto'` → brep when brep exists and all inputs are on the chain;
 *   otherwise mesh when mesh exists; brep-only with a broken input chain (or
 *   missing capability) throws `MeshUnsupportedError` — no mesh to fall back to.
 *
 * Capability routing (requiredCapability): when the current engine (registry)
 * lacks a declared capability, brep mode throws a BrepUnsupportedError (an
 * explicit error, never a silent fallback) while auto mode statically degrades
 * to mesh (never fabricating a missing capability). The capability is matched
 * against the engine's declaration as a set of concrete names: family booleans
 * plus the engine's `evolution` list of `*WithHistory` kernel function names
 * (Phase 0.2 — a family-level `evolution: true` would over-report, since a
 * kernel may provide only a subset of the evolution family).
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
 * @param requiredCapability - an optional capability the operation declares;
 * a missing capability routes the dispatch.
 * @param engines - the operation's platform declaration (D11): `engines` from
 * the defineOp meta. Undefined/empty = neutral op (all engines). A platform op
 * whose engines do not include the current engine is rejected before the
 * capability/mode routing (D11-2: engine mismatch precedes capability checks).
 * @returns the selected backend path: 'brep' or 'mesh'.
 */
export function dispatchPath(
  inputs: Shape[],
  impls: { mesh?: unknown; brep?: unknown; name?: string },
  requiredCapability?: BrepCapabilityName,
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

  // ── D11-2: 平台身份判定，置于最前（先于 mode/capabilities——引擎不匹配时谈能力没有意义）──
  //
  // D11-3（mock 豁免，**有意为之**）：brep_mock 是测试替身，不代表任何真实平台——
  // 它的 capabilities 也是"全给"，职责是让编排链路（naming、Result 边界、多输出）
  // 能被测到；真实引擎下的身份校验由 parity 测试与 engine-switch 测试覆盖。
  // 本豁免由 engine-switch-p5 测试钉住（mock 下平台 op 不拦截）。
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
      // D11-5: auto 模式 → 静态降级 mesh；无 mesh 实现 → MeshUnsupportedError（与能力路由同构）。
      if (!impls.mesh) {
        throw new MeshUnsupportedError(
          `E_MESH_UNSUPPORTED: op${opLabel} requires engine ${engines.join('/')} (current=${current}) and has no mesh implementation`,
          currentStmt,
        )
      }
      return 'mesh'
    }
  }

  // 引擎能力声明 → 具体能力名集合（族级布尔位 + evolution 名单逐核函数展开）。
  const supported = engineCapabilitySet(config.brepCapabilities)

  if (config.mode === 'brep') {
    if (!impls.brep) {
      throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: function has no BREP implementation', currentStmt)
    }
    if (!inputs.every(hasBrep)) {
      throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: input is not BREP', currentStmt)
    }
    // 能力路由：brep 模式缺能力 → 明确报错，不静默回退
    if (requiredCapability && !supported.has(requiredCapability)) {
      throw new BrepUnsupportedError(
        `E_BREP_UNSUPPORTED: current engine lacks capability '${requiredCapability}' (brepEngineId=${config.brepEngineId ?? '<none>'})`,
        currentStmt,
      )
    }
    return 'brep'
  }

  // auto 模式：能力路由（缺能力 → 静态降级走 mesh；brep-only 无 mesh 可降 → 明确报错）
  if (requiredCapability && !supported.has(requiredCapability)) {
    if (!impls.mesh) {
      throw new MeshUnsupportedError(
        `E_MESH_UNSUPPORTED: current engine lacks capability '${requiredCapability}' and function has no mesh implementation`,
        currentStmt,
      )
    }
    return 'mesh'
  }

  if (impls.brep && inputs.every(hasBrep)) return 'brep'
  if (!impls.mesh) {
    throw new MeshUnsupportedError(
      'E_MESH_UNSUPPORTED: input is not BREP and function has no mesh implementation',
      currentStmt,
    )
  }
  return 'mesh'
}
