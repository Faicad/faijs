/**
 * handle-bridge — OCCT 句柄 → faijs Shape 的 SDK 桥接（B1）
 *
 * 设计文档：docs/plans/2026-08-29-faijs-module-runtime-plan.md §4.5
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
 * 取 faijs 当前使用的 OCCT 内核实例。
 * @throws 内核未就绪（mesh 模式或未初始化）时抛错 —— 不静默返回 null。
 */
export function getKernel(): unknown {
  const kernel = getBackends().kernel.occt
  if (!kernel) {
    throw new Error('[faijs/bridge] OCCT kernel not available: BREP operations require an initialized kernel')
  }
  return kernel
}

export interface MeshHandleOptions {
  /** 线性偏差（mm），默认 0.1 —— 与内置 op 一致（src/brep/brep-ops.ts:27） */
  linearDeflection?: number
  /** 角度分段数，默认 32 —— angularDeflection = 2π / segments */
  segments?: number
}

/** 三角化一个 OCCT 句柄 → Shape（不登记 BREP 槽）。 */
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
 * 默认路径（推荐）：三角化 + 登记 BREP 槽，一步完成。
 * 等价于 meshHandle(h) + fromBrep(sh, { solid: h })。
 * 库作者只有在需要自定义三角化精度时，才退回 meshHandle + fromBrep 组合。
 */
export function fromHandle(handle: unknown, opts?: MeshHandleOptions): ReturnType<typeof fromBrep> {
  return fromBrep(meshHandle(handle, opts), { solid: handle })
}
