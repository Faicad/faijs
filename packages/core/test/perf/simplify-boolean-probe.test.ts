/**
 * 布尔 simplify 选项探针 v2（性能实验，非 CI 常驻断言）。
 *
 * v1 发现：裸 kernel.cut ×3 = 27.1s vs cutWithOptions(false) ×3 = 16.5s（1.64x），
 * 面数/顶点逐项一致。v2 需要：
 *  1. 轮换模式顺序（false→true→plain）排除 warmup/机器噪声偏置；
 *  2. 加 fuse 场景（union 8 体）确认收益同样存在；
 *  3. 加共面碎片场景（两个贴合 box fuse）区分 plain cut 是否内含 simplify：
 *     若 plain 做了简化，其输出面数应 ≈ simplify=true；反之 ≈ simplify=false。
 *
 * 用法（packages/core 目录）：
 *   npx vitest run --config vitest.perf.config.ts simplify-boolean-probe
 */
import { describe, it } from 'vitest'
import { getBrepKitKernel } from '@faicad/faijs/brepkit-kernel/brepkitKernel'

const raw = () => getBrepKitKernel()
const ANGULAR = (2 * Math.PI) / 32

function time<T>(fn: () => T): { ms: number; r: T } {
  const t0 = performance.now()
  const r = fn()
  return { ms: performance.now() - t0, r }
}

type Mode = 'plain' | 'simplify-true' | 'simplify-false'
const MODES: Mode[] = ['simplify-false', 'simplify-true', 'plain'] // 轮换：false 先跑

/** 与 face.fai.js 相同的 subtract 输入（head × eye_left × eye_right × mouth）。 */
function buildCutBodies(k: ReturnType<typeof raw>) {
  // getBrepKitKernel 返回裸 wasm BrepKernel：makeSphere(radius, segments) 两参必填
  // （与引擎适配层 makeSphere(radius)→makeSphere(radius, 32) 等价）。
  const head = k.makeSphere(10, 32)
  k.transformSolid(head, [0.9, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1.15, 0, 0, 0, 0, 1])
  const eL = k.makeSphere(2.4, 32)
  k.transformSolid(eL, [1, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  k.transformSolid(eL, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -3.6, 8, 3.2, 1])
  const eR = k.makeSphere(2.4, 32)
  k.transformSolid(eR, [1, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  k.transformSolid(eR, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3.6, 8, 3.2, 1])
  const mouth = k.makeSphere(1.6, 32)
  k.transformSolid(mouth, [2.2, 0, 0, 0, 0, 1.4, 0, 0, 0, 0, 0.55, 0, 0, 0, 0, 1])
  k.transformSolid(mouth, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 8.2, -3.6, 1])
  return { head, eL, eR, mouth }
}

/** 与 face.fai.js 相同的 union 输入（head_carved + 7 小体）。 */
function buildUnionBodies(k: ReturnType<typeof raw>) {
  const mkCarved = () => {
    const head = k.makeSphere(10, 32)
    k.transformSolid(head, [0.9, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1.15, 0, 0, 0, 0, 1])
    const eL = k.makeSphere(2.4, 32)
    k.transformSolid(eL, [1, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    k.transformSolid(eL, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -3.6, 8, 3.2, 1])
    const eR = k.makeSphere(2.4, 32)
    k.transformSolid(eR, [1, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    k.transformSolid(eR, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3.6, 8, 3.2, 1])
    const mouth = k.makeSphere(1.6, 32)
    k.transformSolid(mouth, [2.2, 0, 0, 0, 0, 1.4, 0, 0, 0, 0, 0.55, 0, 0, 0, 0, 1])
    k.transformSolid(mouth, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 8.2, -3.6, 1])
    let r = head
    r = k.cutWithOptions(r, eL, false)
    r = k.cutWithOptions(r, eR, false)
    r = k.cutWithOptions(r, mouth, false)
    return r
  }
  const mkSphere = (r: number, tx: number, ty: number, tz: number) => {
    const s = k.makeSphere(r, 32)
    k.transformSolid(s, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1])
    return s
  }
  const mkEar = (tx: number) => {
    const s = k.makeSphere(2, 32)
    k.transformSolid(s, [0.35, 0, 0, 0, 0, 0.9, 0, 0, 0, 0, 1.3, 0, 0, 0, 0, 1])
    k.transformSolid(s, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, 0, 1, 1])
    return s
  }
  const mkNose = () => {
    const s = k.makeCylinder(0.5, 3.2, 32)
    k.transformSolid(s, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 9.0, 0.5, 1])
    return s
  }
  return [
    mkCarved(),
    mkSphere(1.5, -3.6, 8.2, 3.2),
    mkSphere(1.5, 3.6, 8.2, 3.2),
    mkSphere(0.55, -3.6, 9.6, 3.2),
    mkSphere(0.55, 3.6, 9.6, 3.2),
    mkNose(),
    mkEar(-8.8),
    mkEar(8.8),
  ]
}

describe('布尔 simplify 选项探针 v2（brepkit，perf 专用）', () => {
  it('cut×3 轮换顺序：simplify-false / simplify-true / plain', async () => {
    const k = raw()
    const runCut = (mode: Mode) => {
      const { head, eL, eR, mouth } = buildCutBodies(k)
      const cut = (a: number, b: number) =>
        mode === 'plain' ? k.cut(a, b) : k.cutWithOptions(a, b, mode === 'simplify-true')
      return cut(cut(cut(head, eL), eR), mouth)
    }
    console.log('══════════════════════════════════════════════════════════')
    console.log('cut×3 三态（false 先跑，排除 warmup）：')
    for (const mode of MODES) {
      const t = time(() => runCut(mode))
      const faces = k.getSolidFaces(t.r).length
      const mesh = JSON.parse(k.tessellateSolidGrouped(t.r, 0.1, ANGULAR)) as { positions: number[] }
      console.log(`  ${mode.padEnd(14)}: cut=${t.ms.toFixed(1)}ms  面数=${faces}  顶点=${mesh.positions.length / 3}`)
    }
    console.log('══════════════════════════════════════════════════════════')
  })

  it('fuse 8 体（union）三态 + 面数', async () => {
    const k = raw()
    const runFuse = (mode: Mode) => {
      const xs = buildUnionBodies(k)
      const fuse = (a: number, b: number) =>
        mode === 'plain' ? k.fuse(a, b) : k.fuseWithOptions(a, b, mode === 'simplify-true')
      let r = xs[0]!
      for (let i = 1; i < xs.length; i++) r = fuse(r, xs[i]!)
      return r
    }
    console.log('══════════════════════════════════════════════════════════')
    console.log('fuse×7（union 8 体）三态（false 先跑）：')
    for (const mode of MODES) {
      const t = time(() => runFuse(mode))
      const faces = k.getSolidFaces(t.r).length
      const mesh = JSON.parse(k.tessellateSolidGrouped(t.r, 0.1, ANGULAR)) as { positions: number[] }
      console.log(`  ${mode.padEnd(14)}: fuse=${t.ms.toFixed(1)}ms  面数=${faces}  顶点=${mesh.positions.length / 3}`)
    }
    console.log('══════════════════════════════════════════════════════════')
  })

  it('共面碎片场景：两个贴合 box fuse，区分 plain 是否内含 simplify', async () => {
    const k = raw()
    const mkBox = (z: number) => {
      const b = k.makeBox(2, 2, 2)
      k.transformSolid(b, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, z, 1])
      return b
    }
    console.log('══════════════════════════════════════════════════════════')
    console.log('fuse(box@z=0, box@z=1) 三态（重叠 1 单位，产生共面碎片）：')
    for (const mode of MODES) {
      const t = time(() => {
        const a = mkBox(0)
        const b = mkBox(1)
        return mode === 'plain' ? k.fuse(a, b) : k.fuseWithOptions(a, b, mode === 'simplify-true')
      })
      const faces = k.getSolidFaces(t.r).length
      console.log(`  ${mode.padEnd(14)}: fuse=${t.ms.toFixed(1)}ms  面数=${faces}`)
    }
    console.log('  （若 plain 面数 ≈ simplify-true → plain 内含简化；≈ simplify-false → 不含）')
    console.log('══════════════════════════════════════════════════════════')
  })
})
