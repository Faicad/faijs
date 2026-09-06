/**
 * handle-bridge — OCCT 句柄 → faijs Shape 的 SDK 桥接（B1）
 *
 *
 * 第三方库要造 BREP 产物，需要"OCCT handle → mesh"。`src/brep/brep-ops.ts:17`
 * 有 `import * as THREE from 'three'`，SDK 绝不能 import 它（会把 three 拉进
 * SDK bundle，违反 `src/sdk.test.ts` 的零 heavy 依赖守卫）。本文件在**新建的
 * 零依赖模块**中实现，直接调运行时注入的 `kernel.meshShape`。
 *
 * 依赖约束（硬性）：只允许 import `runtime-state`、`stdlib/shape`、type-only
 * `mesh/types`——任何新增依赖必须保持 dist/sdk.js 零 heavy 依赖守卫通过。
 */

import type { Shape } from '../mesh/types'
import { getBackends } from '../runtime-state'
import { fromBrep } from '../shape'

/** 结构化内核接口（不 import occt-wasm，只做结构匹配，避免 heavy 依赖） */
interface MeshableKernel {
  meshShape(
    handle: unknown,
    opts: { linearDeflection: number; angularDeflection: number },
  ): { positions: ArrayLike<number>; indices: ArrayLike<number> }
}

/**
 * Get the OCCT kernel instance faijs is currently using.
 * @returns the current OCCT kernel.
 * @throws when the kernel is not ready (mesh mode or uninitialized) — never silently returns null.
 */
export function getKernel(): unknown {
  const kernel = getBackends().kernel.brep
  if (!kernel) {
    throw new Error('[faijs/bridge] OCCT kernel not available: BREP operations require an initialized kernel')
  }
  return kernel
}

/**
 * Options controlling how a handle is tessellated.
 */
export interface MeshHandleOptions {
  /** linear deflection (mm), default 0.1 — matches the built-in ops (src/brep/brep-ops.ts:27). */
  linearDeflection?: number
  /** angular segment count, default 32 — angularDeflection = 2π / segments. */
  segments?: number
}

/**
 * OCC 句柄身份契约判别（单一真源）。
 *
 * occt-wasm 的 `handle()` 工厂（vendored occtWasm helpers.ts:25）构造的句柄对象
 * 统一携带 `__occtWasm: true`。本叶子是 faijs 侧唯一允许的判据：
 * define-op 的 `wrapBrepOne` 用它区分"几何句柄"与"纯数据记录"，本文件
 * `fromHandle`/`meshHandle` 入口用它做形态断言。禁止在其他文件硬编码
 * `'__occtWasm' in v` 字符串直查——句柄/数据判定的任何新消费点都必须引用本叶子。
 * @param v - 待判别的值。
 * @returns `true` 当且仅当 `v` 是携带 `__occtWasm: true` 标记的句柄对象。
 */
export function isOcctHandle(v: unknown): boolean {
  return typeof v === 'object' && v !== null && (v as { __occtWasm?: unknown }).__occtWasm === true
}

/** 合法句柄输入：branded numeric id（occt-wasm 的 `ShapeHandle` 运行时形态）或
 *  `__occtWasm` 标记对象（`handle()` 工厂产物）。 */
function isHandleLike(v: unknown): boolean {
  return typeof v === 'number' || isOcctHandle(v)
}

/**
 * 入口形态断言：拒绝把纯数据记录当句柄三角化。
 * 纯数据记录（无 `__occtWasm` 标记的 plain object，如 sheetmetal part 数据）
 * 必须在 SDK 边界被显式拒绝（E_BAD_HANDLE），而不是在 kernel 深处以
 * `OcctError: meshShape: Invalid shape ID 0` 崩溃——define-op 的 wrapBrepOne
 * 已在第一道透传过滤，本断言是第二道防线（防未来未带标记的新句柄形态漏网）。
 */
function requireHandle(handle: unknown, caller: string): void {
  if (!isHandleLike(handle)) {
    throw new Error(
      `[faijs/bridge] ${caller}: E_BAD_HANDLE: expected an OCCT handle (numeric id or ` +
        `__occtWasm-tagged object); got ${handle === null ? 'null' : typeof handle}. ` +
        `Plain data records must not be tessellated as handles.`,
    )
  }
}

/**
 * Tessellate an OCCT handle into a Shape (without registering a BREP slot).
 * @param handle - the OCCT solid handle to tessellate (numeric id or `__occtWasm`-tagged object).
 * @param opts - optional tessellation options.
 * @returns the tessellated Shape.
 */
export function meshHandle(handle: unknown, opts?: MeshHandleOptions): Shape {
  requireHandle(handle, 'meshHandle')
  const kernel = getKernel() as MeshableKernel
  const mesh = kernel.meshShape(handle, {
    linearDeflection: opts?.linearDeflection ?? 0.1,
    angularDeflection: (2 * Math.PI) / Math.max(3, opts?.segments ?? 32),
  })
  return {
    positions: new Float32Array(mesh.positions as ArrayLike<number>),
    indices: new Uint32Array(mesh.indices as ArrayLike<number>),
  }
}

/**
 * Default path (recommended): tessellate + register the BREP slot in one step.
 * Equivalent to meshHandle(h) + fromBrep(sh, { solid: h }).
 * Library authors only fall back to the meshHandle + fromBrep combination when
 * they need custom tessellation precision.
 * @param handle - the OCCT solid handle to bridge (numeric id or `__occtWasm`-tagged object).
 * @param opts - optional tessellation options.
 * @returns the registered Shape, as returned by fromBrep.
 */
export function fromHandle(handle: unknown, opts?: MeshHandleOptions): ReturnType<typeof fromBrep> {
  requireHandle(handle, 'fromHandle')
  return fromBrep(meshHandle(handle, opts), { solid: handle })
}
