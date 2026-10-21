/**
 * union 输入顺序探针（性能实验，非 CI 常驻断言）。
 *
 * 假设：链式 fuse 的成本随"已累积结果"复杂度增长（每步重交所有既有面）。若先
 * 并小体（简单面）、最后把复杂结果并入一次，总成本可能显著低于原序（大复杂体
 * 先累积、每步都重交）。union 结合律保证几何结果相同；face 序可能不同（拓扑
 * 红线只要求同一 solid 内显示 mesh == 拓扑 mesh，不跨构造路径）。
 *
 * 对比（同一内核 brepkit、与 face.fai.js 相同 8 体）：
 *   A. 原序：head_carved 打头（复杂度累积快）
 *   B. 小体先并：eyeballs/pupils/nose/ears 先 cluster，head_carved 最后
 *
 * 用法（packages/core 目录）：
 *   npx vitest run --config vitest.perf.config.ts union-order-probe
 */
import { describe, it } from 'vitest'
import { getActiveBrepEngine } from '@faicad/faijs/brep/engine/registry'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'

const ANGULAR = (2 * Math.PI) / 32

function time<T>(fn: () => T): { ms: number; r: T } {
  const t0 = performance.now()
  const r = fn()
  return { ms: performance.now() - t0, r }
}

/** 与 face.fai.js 相同的 union 输入构造（head_carved 近似 = scale3d(sphere)）。 */
function buildUnionInputs(api: BrepEngineApi): number[] {
  const head = api.generalTransform(api.makeSphere(10), [0.9, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1.15, 0])
  const eL = api.translate(api.generalTransform(api.makeSphere(2.4), [1, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 1, 0]), -3.6, 8.0, 3.2)
  const eR = api.translate(api.generalTransform(api.makeSphere(2.4), [1, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 1, 0]), 3.6, 8.0, 3.2)
  const mouth = api.translate(api.generalTransform(api.makeSphere(1.6), [2.2, 0, 0, 0, 0, 1.4, 0, 0, 0, 0, 0.55, 0]), 0, 8.2, -3.6)
  const carved = api.cut(api.cut(api.cut(head, eL), eR), mouth)
  const ebL = api.translate(api.makeSphere(1.5), -3.6, 8.2, 3.2)
  const ebR = api.translate(api.makeSphere(1.5), 3.6, 8.2, 3.2)
  const pL = api.translate(api.makeSphere(0.55), -3.6, 9.6, 3.2)
  const pR = api.translate(api.makeSphere(0.55), 3.6, 9.6, 3.2)
  const nose = api.translate(api.makeCylinder(0.5, 3.2), 0, 9.0, 0.5)
  const earL = api.translate(api.generalTransform(api.makeSphere(2), [0.35, 0, 0, 0, 0, 0.9, 0, 0, 0, 0, 1.3, 0]), -8.8, 0, 1.0)
  const earR = api.translate(api.generalTransform(api.makeSphere(2), [0.35, 0, 0, 0, 0, 0.9, 0, 0, 0, 0, 1.3, 0]), 8.8, 0, 1.0)
  // 原序：carved 打头，与 face.fai.js 的 cad.union(carved, ebL, ebR, pL, pR, nose, earL, earR) 一致
  return [carved, ebL, ebR, pL, pR, nose, earL, earR]
}

describe('union 输入顺序探针（brepkit，perf 专用）', () => {
  it('原序（大复杂体打头） vs 小体先并', async () => {
    const api = (await getActiveBrepEngine()).primitives as BrepEngineApi

    const tA = time(() => {
      const xs = buildUnionInputs(api)
      let r = xs[0]!
      for (let i = 1; i < xs.length; i++) r = api.fuse(r, xs[i]!)
      return r
    })

    const tB = time(() => {
      const xs = buildUnionInputs(api)
      const [carved, ...small] = xs
      // 小体 cluster 先并，最后并入 carved
      let r = small[0]!
      for (let i = 1; i < small.length; i++) r = api.fuse(r, small[i]!)
      return api.fuse(r, carved!)
    })

    const mA = time(() => api.meshShape(tA.r, { linearDeflection: 0.1, angularDeflection: ANGULAR }))
    const mB = time(() => api.meshShape(tB.r, { linearDeflection: 0.1, angularDeflection: ANGULAR }))

    console.log('══════════════════════════════════════════════════════════')
    console.log('union 8 体输入顺序对比（angular=2pi/32）：')
    console.log(`  原序(复杂体先): ${tA.ms.toFixed(1)}ms  mesh=${mA.ms.toFixed(1)}ms  顶点=${mA.r.vertexCount}`)
    console.log(`  小体先并      : ${tB.ms.toFixed(1)}ms  mesh=${mB.ms.toFixed(1)}ms  顶点=${mB.r.vertexCount}`)
    console.log(`  加速比: ${(tA.ms / tB.ms).toFixed(2)}x`)
    console.log('══════════════════════════════════════════════════════════')
  })
})
