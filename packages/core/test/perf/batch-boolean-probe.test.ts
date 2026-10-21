/**
 * 批量布尔探针（性能实验，非 CI 常驻断言）。
 *
 * 背景：faijs union/subtract 是逐对链式布尔（union 8 体 = 7 次 fuse，
 * subtract 4 体 = 3 次 cut）。brepkit 4.1.49 另有单次批量入口 fuseAll /
 * compoundCut(target, tool_ids[])——若内核单趟布尔显著快于链式重放，faijs
 * 布尔 op 改为批量入口将是比椭球 peephole 大得多的收益。
 *
 * 对比（同一内核 brepkit）：
 *   A. union 8 体：顺序 fuse x 7   vs   fuseAll(8)
 *   B. subtract 4 体：顺序 cut x 3  vs   compoundCut(head, [工具 x 3]) 单次
 * 测量耗时 + 结果顶点数（几何一致性参考）。
 *
 * 用法（packages/core 目录）：
 *   npx vitest run --config vitest.perf.config.ts batch-boolean-probe
 */
import { describe, it } from 'vitest'
import { getActiveBrepEngine } from '@faicad/faijs/brep/engine/registry'
import { getBrepKitKernel } from '@faicad/faijs/brepkit-kernel/brepkitKernel'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'

const ANGULAR = (2 * Math.PI) / 32

function time<T>(fn: () => T): { ms: number; r: T } {
  const t0 = performance.now()
  const r = fn()
  return { ms: performance.now() - t0, r }
}

function meshOf(api: BrepEngineApi, solid: number) {
  return api.meshShape(solid, { linearDeflection: 0.1, angularDeflection: ANGULAR })
}

/** 与 face.fai.js 相同的 8 个 body 构造（返回句柄数组）。 */
function buildBodies(api: BrepEngineApi): number[] {
  const head = api.generalTransform(api.makeSphere(10), [0.9, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1.15, 0])
  const eL = api.translate(api.generalTransform(api.makeSphere(2.4), [1, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 1, 0]), -3.6, 8.0, 3.2)
  const eR = api.translate(api.generalTransform(api.makeSphere(2.4), [1, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 1, 0]), 3.6, 8.0, 3.2)
  const mouth = api.translate(api.generalTransform(api.makeSphere(1.6), [2.2, 0, 0, 0, 0, 1.4, 0, 0, 0, 0, 0.55, 0]), 0, 8.2, -3.6)
  const ebL = api.translate(api.makeSphere(1.5), -3.6, 8.2, 3.2)
  const ebR = api.translate(api.makeSphere(1.5), 3.6, 8.2, 3.2)
  const pL = api.translate(api.makeSphere(0.55), -3.6, 9.6, 3.2)
  const pR = api.translate(api.makeSphere(0.55), 3.6, 9.6, 3.2)
  // nose：cone 近似（探针不追求逐字节一致，只看相对成本）
  const nose = api.translate(api.makeCylinder(0.5, 3.2), 0, 9.0, 0.5)
  return [head, eL, eR, mouth, ebL, ebR, pL, pR, nose]
}

describe('批量布尔探针（brepkit，perf 专用）', () => {
  it('union 8 体：顺序 fuse vs fuseAll', async () => {
    const api = (await getActiveBrepEngine()).primitives as BrepEngineApi

    const tSeq = time(() => {
      const seq = buildBodies(api)
      let r = seq[0]!
      for (let i = 1; i < seq.length; i++) r = api.fuse(r, seq[i]!)
      return r
    })
    const tAll = time(() => api.fuseAll(buildBodies(api)))

    const mSeq = time(() => meshOf(api, tSeq.r))
    const mAll = time(() => meshOf(api, tAll.r))

    console.log('══════════════════════════════════════════════════════════')
    console.log('union 8 body compare (angular=2pi/32):')
    console.log(`  sequential fuse x7: ${tSeq.ms.toFixed(1)}ms  mesh=${mSeq.ms.toFixed(1)}ms  verts=${mSeq.r.vertexCount}`)
    console.log(`  fuseAll x1        : ${tAll.ms.toFixed(1)}ms  mesh=${mAll.ms.toFixed(1)}ms  verts=${mAll.r.vertexCount}`)
    console.log(`  speedup: ${(tSeq.ms / tAll.ms).toFixed(2)}x`)
    console.log('══════════════════════════════════════════════════════════')
  })

  it('subtract 4 体：顺序 cut vs compoundCut', async () => {
    const api = (await getActiveBrepEngine()).primitives as BrepEngineApi
    const raw = getBrepKitKernel()

    const tSeq = time(() => {
      const parts = buildBodies(api)
      let r = parts[0]!
      for (let i = 1; i < 4; i++) r = api.cut(r, parts[i]!)
      return r
    })
    const tCmp = time(() => {
      const parts = buildBodies(api)
      return raw.compoundCut(parts[0]!, Uint32Array.from(parts.slice(1, 4)))
    })

    const mSeq = time(() => meshOf(api, tSeq.r))
    const mCmp = time(() => meshOf(api, tCmp.r))

    console.log('══════════════════════════════════════════════════════════')
    console.log('subtract 4 body compare (angular=2pi/32):')
    console.log(`  sequential cut x3 : ${tSeq.ms.toFixed(1)}ms  mesh=${mSeq.ms.toFixed(1)}ms  verts=${mSeq.r.vertexCount}`)
    console.log(`  compoundCut x1    : ${tCmp.ms.toFixed(1)}ms  mesh=${mCmp.ms.toFixed(1)}ms  verts=${mCmp.r.vertexCount}`)
    console.log(`  speedup: ${(tSeq.ms / tCmp.ms).toFixed(2)}x`)
    console.log('══════════════════════════════════════════════════════════')
  })
})
