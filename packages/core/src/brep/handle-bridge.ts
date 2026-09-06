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
 * Tessellate an OCCT handle into a Shape (without registering a BREP slot).
 * @param handle - the OCCT solid handle to tessellate.
 * @param opts - optional tessellation options.
 * @returns the tessellated Shape.
 */
export function meshHandle(handle: unknown, opts?: MeshHandleOptions): Shape {
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
 * @param handle - the OCCT solid handle to bridge.
 * @param opts - optional tessellation options.
 * @returns the registered Shape, as returned by fromBrep.
 */
export function fromHandle(handle: unknown, opts?: MeshHandleOptions): ReturnType<typeof fromBrep> {
  return fromBrep(meshHandle(handle, opts), { solid: handle })
}
