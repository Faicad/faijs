/**
 * brepkit2 引擎的 textToSolid 验证（2026-10-13 回归复现转正）。
 *
 * 背景：textToSolid 的孔洞+compound 重构只在 occt-wasm 上验证过（14 绿），
 * 真机/weapp 实际跑的是 **brepkit2** —— 两内核的 compound/translate 行为不同，
 * 用户实测 'Hello' 建模后只剩 'o'（其它字符消失）。
 * 本套件钉住：brepkit 上 'Hello' 在 translate 居中 + meshShape 后仍是完整 5 成员。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { createBrepkitPrimitives, disposeBrepkit } from '../../../src/brepkit-kernel/brepkitKernel'
import { setupTestFont } from '../../../src/brep/text/fontTestHelper'
import { textToSolid, textBlueprintsDetailed } from '../../../src/brep/text/text-to-solid'
import { classifyNested, computeBBox, computeSignedArea } from '../../../src/primitives/svg/svg-path'

// GOTCHA: brepkit-wasm 是有意的可选运行时注入（同 brepkitKernel.test.ts）——
// 未安装时套件整体 skip，已安装但初始化失败（真 bug）时如实 FAIL。
const require = createRequire(import.meta.url)
let brepkitAvailable = false
try {
  require.resolve('brepkit-wasm')
  brepkitAvailable = true
} catch {
  brepkitAvailable = false
}

let kernel!: ReturnType<typeof createBrepkitPrimitives> extends Promise<infer T> ? T : never

beforeAll(async () => {
  if (!brepkitAvailable) return
  kernel = await createBrepkitPrimitives()
  await setupTestFont()
})

afterAll(() => {
  if (brepkitAvailable) disposeBrepkit()
})

const suite = describe.skipIf(!brepkitAvailable)

suite('brepkit textToSolid（textBrep 同款链路：textToSolid → bbox → translate → meshShape）', () => {
  it("'Hello' 在 translate 居中 + meshShape 后仍是完整 5 个 solid 成员", () => {
    const raw = textToSolid(kernel, 'Hello', { fontSize: 20, depth: 5 })
    // textBrep（faijs-extra/src/ops/text.ts）同款居中：X/Z 中心、Y 底部对齐。
    const bb = kernel.getBoundingBox(raw)
    const centered = kernel.translate(
      raw,
      -(bb.xmin + bb.xmax) / 2,
      -bb.ymin,
      -(bb.zmin + bb.zmax) / 2,
    )
    const members = kernel.getSubShapes(centered, 'solid')
    // 回归钉：translate(compound) 后成员必须仍是 5（'Hello' = H e l l o）。
    // 旧 bug：compound 被当 solid 处理（copySolid/transformSolid），成员丢失。
    expect(members.length).toBe(5)
    const m = kernel.meshShape(centered, { linearDeflection: 0.5 })
    expect(m.triangleCount).toBeGreaterThan(100)
    expect(m.faceCount).toBeGreaterThan(10)
    kernel.release?.(raw)
  })

  it("'o' 单字符是空心（brepkit 上同样成立，体积判据）", () => {
    const raw = textToSolid(kernel, 'o', { fontSize: 20, depth: 5 })
    const subs = textBlueprintsDetailed(kernel, 'o', { fontSize: 20 }).map((d) => ({
      points: d.points,
      bbox: computeBBox(d.points),
      signedArea: computeSignedArea(d.points),
    }))
    const groups = classifyNested(subs)
    const aOuter = Math.abs(subs[groups[0].outerIdx].signedArea)
    const aHoles = groups[0].holes.reduce((s, h) => s + Math.abs(subs[h].signedArea), 0)
    const expected = (aOuter - aHoles) * 5
    const actual = kernel.getVolume(raw)
    expect(Math.abs(actual - expected) / expected).toBeLessThan(0.05)
    kernel.release?.(raw)
  })
})
