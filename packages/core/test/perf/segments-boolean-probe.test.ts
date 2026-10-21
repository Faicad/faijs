/**
 * 球体 segments 与布尔成本扫描探针（性能实验，非 CI 常驻断言）。
 *
 * 问题：faijs 引擎层 makeSphere 固定 `makeSphere(radius, 32)`（brepkit 适配层
 * 硬编码 32 段）——若 brepkit 的球是 NURBS（段数 = 控制网密度），布尔求交成本
 * 可能随段数缩放。老报告 §2.4 说"降 segments 反而慢 57%"（eager 时代，三角化
 * 主导）；现在 defer + angular 后布尔主导，需要重新测：布尔成本 vs 段数曲线，
 * 以及粗段数是否稳定。
 *
 * 直接调原始内核 `makeSphere(radius, segments)`，测同一几何（head × eye，含
 * 平移）下 cut 单次耗时。段数 N ∈ {8, 16, 32, 64, 128}。
 *
 * 用法（packages/core 目录）：
 *   npx vitest run --config vitest.perf.config.ts segments-boolean-probe
 */
import { describe, it } from 'vitest'
import { getBrepKitKernel } from '@faicad/faijs/brepkit-kernel/brepkitKernel'

const raw = () => getBrepKitKernel()

function time<T>(fn: () => T): { ms: number; r: T } {
  const t0 = performance.now()
  const r = fn()
  return { ms: performance.now() - t0, r }
}

describe('segments 与布尔成本扫描探针（brepkit，perf 专用）', () => {
  it('cut(head, eye)：makeSphere 段数 8..128', async () => {
    const k = raw()

    // head: sphere r=10 → 非等比 [0.9,1,1.15]；eye: sphere r=2.4 → [1,0.7,1] → 平移
    // （与 face.fai.js 前两个 subtract 输入一致）。raw 内核 transformSolid 是原地
    // 修改，需先 copySolid 再变换（与引擎适配层同构）。
    const headWithSeg = (seg: number) => {
      const h = k.makeSphere(10, seg)
      k.transformSolid(h, [0.9, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1.15, 0, 0, 0, 0, 1])
      return h
    }
    const eyeWithSeg = (seg: number) => {
      const e = k.makeSphere(2.4, seg)
      k.transformSolid(e, [1, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
      k.transformSolid(e, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -3.6, 8, 3.2, 1])
      return e
    }

    console.log('══════════════════════════════════════════════════════════')
    console.log('cut(head, eye) 耗时 vs makeSphere 段数：')
    for (const seg of [8, 16, 32, 64, 128]) {
      let ok = true
      const t = time(() => {
        const h = headWithSeg(seg)
        const e = eyeWithSeg(seg)
        return k.cut(h, e)
      })
      // 结果三角化（angular=2π/32）看几何是否稳定
      let verts = 0
      try {
        const mesh = k.tessellateSolidGrouped(t.r, 0.1, (2 * Math.PI) / 32)
        verts = (JSON.parse(mesh) as { positions: number[] }).positions.length / 3
      } catch (cause) {
        ok = false
        console.log(`  seg=${String(seg).padStart(3)}: cut=${t.ms.toFixed(1)}ms  三角化失败: ${(cause as Error).message.slice(0, 60)}`)
        continue
      }
      console.log(`  seg=${String(seg).padStart(3)}: cut=${t.ms.toFixed(1)}ms  结果顶点=${verts}`)
    }
    console.log('══════════════════════════════════════════════════════════')
  })
})
