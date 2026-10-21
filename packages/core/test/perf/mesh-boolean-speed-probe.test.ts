/**
 * mesh-boolean-speed-probe — brepkit 网格布尔的速度（2026-10-22）。
 *
 * 背景：人脸类"打印件"模型用 BRep 没有意义（最终只三角化 3D 打印），用户要求研究
 * mesh 链完成度 + 免新 wasm 的可行性。端侧只打包 brepkit（无 manifold），而网格实体
 * （mesh solid）链的布尔/变换/圆角全部走 brepkit 网格内核（同一份已打包 wasm）——
 * 唯一缺口是脚本基本体（sphere/box）还没有"网格实体"构造器（mesh 实现是 manifold
 * 网格数据，端侧不可用）。本探针测决定性数字：**网格实体的 importMesh→weld→unify
 * 规范化 + fuse/cut 一次多少毫秒**，与 BRep 布尔（~3s/次 cut，face 全链 34s）对比，
 * 判断 mesh 链方向是否成立、基本体构造器补齐后的预期总耗时。
 *
 * 直接走裸 brepkit kernel（同 simplify-boolean-probe 的引导，无 runtime/backends）：
 * 同一份 wasm、同一批原语（importMesh→weld→unify 顺序不可交换）。
 *
 * 用法（packages/core 目录）：
 *   npx vitest run --config vitest.perf.config.ts mesh-boolean-speed-probe
 */
import { describe, expect, it } from 'vitest'
import { createBrepkitPrimitives, getBrepKitKernel } from '@faicad/faijs/brepkit-kernel/brepkitKernel'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import type { BrepHandle } from '../../src/brep/engine/types'

/** wasm 句柄运行时是 number；类型面是 branded object——探针统一经此转换。 */
const bh = (n: number): BrepHandle => n as unknown as BrepHandle

type Kernel = BrepEngineApi & { meshSolid: { importMesh(p: Float32Array, i: Uint32Array): number; weld(f: BrepHandle[], t: number): BrepHandle; unify(s: BrepHandle): number } }

/** 裸 wasm kernel（createBrepkitPrimitives 之后 liveKernel 已就绪）：含 meshBoolean 三角形 CSG。 */
type RawKernel = {
  meshBoolean(a: Float64Array, ia: Uint32Array, b: Float64Array, ib: Uint32Array, op: string, tol: number): { positions: Float64Array; indices: Uint32Array }
}

/** UV 球（Z-up，极向 m × 方位向 n 网格）：与 brepkit sphere 的 angular 细分同族。 */
function uvSphere(radius: number, n: number, m: number, cx = 0, cy = 0, cz = 0): { positions: Float32Array; indices: Uint32Array } {
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= m; i++) {
    const theta = (i / m) * Math.PI // 0..π 极角
    for (let j = 0; j <= n; j++) {
      const phi = (j / n) * 2 * Math.PI // 0..2π 方位角
      positions.push(
        cx + radius * Math.sin(theta) * Math.cos(phi),
        cy + radius * Math.cos(theta),
        cz + radius * Math.sin(theta) * Math.sin(phi),
      )
    }
  }
  const row = n + 1
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * row + j
      const b = a + 1
      const c = (i + 1) * row + j
      const d = c + 1
      indices.push(a, b, c, b, d, c)
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}

/** normalizeMeshSolid 的等价步骤（同一 api 对象，顺序不可交换）。 */
function normalizeSolid(k: Kernel, pos: Float32Array, idx: Uint32Array): BrepHandle {
  const rawSolid = k.meshSolid.importMesh(pos, idx)
  const faces = k.getSubShapes(bh(rawSolid), 'face')
  const bb = k.getBoundingBox(bh(rawSolid), false)
  const diag = Math.sqrt((bb.xmax - bb.xmin) ** 2 + (bb.ymax - bb.ymin) ** 2 + (bb.zmax - bb.zmin) ** 2)
  const tol = Math.max(1e-6, diag * 1e-6)
  const welded = k.meshSolid.weld(faces, tol)
  k.meshSolid.unify(welded)
  if (!k.isValid(welded)) throw new Error('E_MESH_SOLID_UNWELDABLE: welded mesh is not a valid solid')
  k.release(bh(rawSolid))
  return welded
}

function time<T>(fn: () => T): { ms: number; r: T } {
  const t0 = performance.now()
  const r = fn()
  return { ms: performance.now() - t0, r }
}

describe('brepkit 网格实体链速度（对比 BRep 布尔 ~3s/cut）', () => {
  it('normalize(UV球) + mesh fuse/cut 计时（32×16 与 64×32 两档密度）', async () => {
    const k = (await createBrepkitPrimitives()) as Kernel
    expect(k).toBeTruthy()

    for (const [n, m, label] of [
      [32, 16, '32×16(~2k tri)'],
      [64, 32, '64×32(~8k tri)'],
    ] as const) {
      const head = uvSphere(10, n, m)
      const tool = uvSphere(4, n, m, 8, 0, 0) // 偏心重叠，模拟 cut 场景

      const normA = time(() => normalizeSolid(k, head.positions, head.indices))
      const normB = time(() => normalizeSolid(k, tool.positions, tool.indices))
      const sa = normA.r
      const sb = normB.r

      const fuse = time(() => k.fuse(sa, sb))
      const fused = fuse.r
      const cut = time(() => k.cut(sa, sb))

      // 结果三角化（显示 mesh 与拓扑同源，一次 meshShape）
      const tess = time(() => k.meshShape(fused, { linearDeflection: 0.1, angularDeflection: (2 * Math.PI) / 32 }))
      const verts = (tess.r as { positions: unknown }).positions as Float32Array

      // eslint-disable-next-line no-console
      console.log(
        `[mesh-solid chain] ${label}: normalize=${normA.ms.toFixed(1)}/${normB.ms.toFixed(1)}ms, ` +
          `fuse=${fuse.ms.toFixed(1)}ms, cut=${cut.ms.toFixed(1)}ms, resultMesh=${tess.ms.toFixed(1)}ms ` +
          `(${verts.length / 3} verts)`,
      )

      k.release(sa)
      k.release(sb)
      k.release(fused)
    }
  })

  it('meshBoolean（裸三角形 CSG，wasm 已打包但 faijs 未调用）计时', async () => {
    const k = (await createBrepkitPrimitives()) as Kernel
    const raw = getBrepKitKernel() as unknown as RawKernel
    expect(raw.meshBoolean).toBeTruthy()

    for (const [n, m, label] of [
      [32, 16, '32×16(~2k tri)'],
      [64, 32, '64×32(~8k tri)'],
      [128, 64, '128×64(~32k tri)'],
    ] as const) {
      const head = uvSphere(10, n, m)
      const tool = uvSphere(4, n, m, 8, 0, 0)
      const tol = 1e-4 // 与球半径同量级的焊接容差（bbox 对角线×1e-6 ≈ 3e-5）

      const fuse = time(() => raw.meshBoolean(new Float64Array(head.positions), head.indices, new Float64Array(tool.positions), tool.indices, 'fuse', tol))
      const cut = time(() => raw.meshBoolean(new Float64Array(head.positions), head.indices, new Float64Array(tool.positions), tool.indices, 'cut', tol))
      const verts = (fuse.r as { positions: Float64Array }).positions.length / 3

      // eslint-disable-next-line no-console
      console.log(
        `[meshBoolean CSG] ${label}: fuse=${fuse.ms.toFixed(1)}ms, cut=${cut.ms.toFixed(1)}ms, result=${verts.toFixed(0)} verts`,
      )
    }
  })
})
