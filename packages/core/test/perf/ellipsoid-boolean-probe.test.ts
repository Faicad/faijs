/**
 * 椭球 vs scale3d(sphere) 布尔探针（性能实验，非 CI 常驻断言）。
 *
 * 背景：face.fai.js 里 head/eye/mouth/ear 都是 `scale3d(sphere)` 产物。scale3d
 * 非等比走 generalTransform（brepkit = copySolid + transformSolid），把解析球面
 * 变成 NURBS，布尔求交走数值路径 → subtract 一次 ~14s、union 一次 ~14s（占端侧
 * execute 31.9s 的 ~88%）。brepkit 4.1.49 有原生 `makeEllipsoid(rx,ry,rz)` ——
 * 椭球 = scale3d(sphere) 的**精确**解析等价物（几何逐点相等），若布尔走解析
 * 求交，可能快一个数量级。
 *
 * 本探针直接对比（同一内核 brepkit、同一 subtract 三体）：
 *   A. 现状：makeSphere × 3 → generalTransform(非等比) → cut × 2
 *   B. 提议：makeEllipsoid × 3 → cut × 2
 * 测量每次 cut / meshShape 耗时与结果顶点数，验证「椭球路径更快」且几何等价。
 *
 * 用法（packages/core 目录）：
 *   npx vitest run --config vitest.perf.config.ts ellipsoid-boolean-probe
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

describe('椭球 vs scale3d(sphere) 布尔探针（brepkit，perf 专用）', () => {
  it('subtract 三体：NURBS 缩放路径 vs 原生椭球路径', async () => {
    const api = (await getActiveBrepEngine()).primitives as BrepEngineApi

    // ── A. 现状路径：sphere → generalTransform（非等比）→ translate → cut ──
    const aHead = api.generalTransform(api.makeSphere(10), [0.9, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1.15, 0])
    const aEye = api.translate(api.generalTransform(api.makeSphere(2.4), [1, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 1, 0]), -3.6, 8.0, 3.2)
    const aMouth = api.translate(api.generalTransform(api.makeSphere(1.6), [2.2, 0, 0, 0, 0, 1.4, 0, 0, 0, 0, 0.55, 0]), 0, 8.2, -3.6)

    const tAcut1 = time(() => api.cut(aHead, aEye))
    const tAcut2 = time(() => api.cut(tAcut1.r, aMouth))
    const tAmesh = time(() => api.meshShape(tAcut2.r, { linearDeflection: 0.1, angularDeflection: ANGULAR }))

    // ── B. 提议路径：原生椭球（= 精确的 scale3d(sphere)）→ translate → cut ──
    const bHead = api.makeEllipsoid(9, 10, 11.5) // sphere r=10 × [0.9,1,1.15]
    const bEye = api.translate(api.makeEllipsoid(2.4, 1.68, 2.4), -3.6, 8.0, 3.2) // sphere r=2.4 × [1,0.7,1]
    const bMouth = api.translate(api.makeEllipsoid(3.52, 2.24, 0.88), 0, 8.2, -3.6) // sphere r=1.6 × [2.2,1.4,0.55]

    const tBcut1 = time(() => api.cut(bHead, bEye))
    const tBcut2 = time(() => api.cut(tBcut1.r, bMouth))
    const tBmesh = time(() => api.meshShape(tBcut2.r, { linearDeflection: 0.1, angularDeflection: ANGULAR }))

    const va = tAmesh.r.vertexCount
    const vb = tBmesh.r.vertexCount
    const ta = tAmesh.r.triangleCount
    const tb = tBmesh.r.triangleCount

    console.log('══════════════════════════════════════════════════════════')
    console.log(`subtract 三体对比（angular=2π/32）：`)
    console.log(`  A scale3d(sphere): cut1=${tAcut1.ms.toFixed(1)}ms cut2=${tAcut2.ms.toFixed(1)}ms mesh=${tAmesh.ms.toFixed(1)}ms 顶点=${va} 三角=${ta}`)
    console.log(`  B makeEllipsoid : cut1=${tBcut1.ms.toFixed(1)}ms cut2=${tBcut2.ms.toFixed(1)}ms mesh=${tBmesh.ms.toFixed(1)}ms 顶点=${vb} 三角=${tb}`)
    console.log(`  cut 合计: A=${(tAcut1.ms + tAcut2.ms).toFixed(1)}ms  B=${(tBcut1.ms + tBcut2.ms).toFixed(1)}ms  B/A=${((tBcut1.ms + tBcut2.ms) / (tAcut1.ms + tAcut2.ms)).toFixed(3)}`)
    console.log(`  结果网格顶点比: B/A=${(vb / va).toFixed(3)}（几何应接近）`)
    console.log('══════════════════════════════════════════════════════════')
  })
})
