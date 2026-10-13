/**
 * @vitest-environment node
 *
 * Text BREP 操作单元测试
 *
 * 测试内容：
 * 1. text-to-solid 产出有效 OCCT wire
 * 2. textToSolid 产出有效 OCCT solid
 * 3. STEP 导出含 ADVANCED_FACE + PLANE
 * 4. 多字符文字 fuse 集成测试
 * 5. 字体加载测试
 *
 * 运行：npx vitest run src/brep/text/text-to-solid.test.ts
 */

// ─── OCCT stdout 噪声过滤 ───
const occtOrigLog = console.log
console.log = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  const isOcctNoise =
    msg.includes('Statistics on Transfer') ||
    msg.includes('Transfer Mode =') ||
    msg.includes('Transferring Shape') ||
    msg.includes('WorkSession') ||
    /^\*{4,}/.test(msg) ||
    msg.startsWith(' Step File Name')
  if (isOcctNoise || msg.trim() === '') return
  occtOrigLog(...args)
}

import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm, getKernel } from '../../../src/occt-kernel/occtKernel'
import type { BrepEngineApi } from '../../../src/brep/engine/primitives'
import { setupTestFont } from '@faicad/faijs/brep/text/fontTestHelper'
import { textBlueprints, textBlueprintsDetailed, textToSolid } from '../../../src/brep/text/text-to-solid'
import {
  classifyNested,
  computeBBox,
  computeSignedArea,
} from '../../../src/primitives/svg/svg-path'
import { solidToShape } from '../../../src/brep/brep-ops'

let kernel: BrepEngineApi

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel() as unknown as BrepEngineApi
  // 注入 fs 字体加载器并加载默认字体
  await setupTestFont()
}, 120000)

describe('textBlueprints', () => {
  it('should produce wires from ASCII text', () => {
    const wires = textBlueprints(kernel, 'A', { fontSize: 16 })
    expect(wires.length).toBeGreaterThan(0)
    for (const w of wires) kernel.release(w)
  })

  it('should produce wires from multi-character text', () => {
    const wires = textBlueprints(kernel, 'Hello', { fontSize: 16 })
    expect(wires.length).toBeGreaterThan(0)
    for (const w of wires) kernel.release(w)
  })

  it('should produce wires from digits', () => {
    const wires = textBlueprints(kernel, '123', { fontSize: 16 })
    expect(wires.length).toBeGreaterThan(0)
    for (const w of wires) kernel.release(w)
  })

  // GOTCHA: opentype.js paths are y-DOWN (canvas convention), OCCT is y-up.
  // `toPt` must flip y, exactly like the SVG path's `flipY`. Without the flip
  // the glyphs come out vertically mirrored: ink lands at negative y (an "I"
  // would sit *below* the baseline). Pinned with the font's real metrics —
  // OpenSans 'I' at size 10 spans baseline..capHeight = y ∈ [0, 7.1387].
  it('should flip the opentype y-down axis so text is y-up (baseline at 0)', () => {
    const boxOf = (wires: ReturnType<typeof textBlueprints>) => {
      let ymin = Infinity
      let ymax = -Infinity
      for (const w of wires) {
        const b = kernel.getBoundingBox(w)
        if (b.ymin < ymin) ymin = b.ymin
        if (b.ymax > ymax) ymax = b.ymax
      }
      for (const w of wires) kernel.release(w)
      return { ymin, ymax }
    }

    // "I" has no descender: ink sits entirely ABOVE the baseline.
    const cap = boxOf(textBlueprints(kernel, 'I', { fontSize: 10 }))
    expect(cap.ymin).toBeCloseTo(0, 3)
    expect(cap.ymax).toBeCloseTo(7.1387, 2)

    // "_" (underscore) sits BELOW the baseline in font units — a mirrored
    // (buggy) build would put it above.
    const under = boxOf(textBlueprints(kernel, '_', { fontSize: 10 }))
    expect(under.ymax).toBeLessThan(0)
  })
})

describe('textToSolid', () => {
  it('should produce a valid solid from text', () => {
    const solid = textToSolid(kernel, 'A', { fontSize: 16, depth: 2 })
    expect(solid).toBeDefined()

    const shape = solidToShape(kernel, solid)
    expect(shape.positions.length).toBeGreaterThan(0)
    expect(shape.indices.length).toBeGreaterThan(0)

    kernel.release(solid)
  })

  it('should produce STEP with ADVANCED_FACE and PLANE', () => {
    const solid = textToSolid(kernel, 'B', { fontSize: 20, depth: 3 })
    const step = kernel.exportStep(solid)
    expect(step).toContain('ADVANCED_FACE')
    expect(step).toContain('PLANE')

    kernel.release(solid)
  })

  it('should produce valid solid from multi-character text', () => {
    const solid = textToSolid(kernel, 'AB', { fontSize: 16, depth: 2 })
    expect(solid).toBeDefined()

    const shape = solidToShape(kernel, solid)
    expect(shape.positions.length).toBeGreaterThan(0)

    const step = kernel.exportStep(solid)
    expect(step).toContain('ADVANCED_FACE')

    kernel.release(solid)
  })
})

describe('fontRegistry', () => {
  it('should load and retrieve font', async () => {
    const { getFont } = await import('../../../src/brep/text/fontRegistry')
    const font = getFont('default')
    expect(font).toBeDefined()
    expect(font?.charToGlyph).toBeDefined()
  })

  it('should return undefined for unregistered font', async () => {
    const { getFont } = await import('../../../src/brep/text/fontRegistry')
    const font = getFont('nonexistent')
    expect(font).toBeUndefined()
  })
})

// ─── 孔洞与组合修复（2026-10-13）：见 .agents/notes/ 对应 Agent Note ───
// 旧实现把每个闭合轮廓独立 extrude 后逐个 fuse：带孔字符（'o'/'A'/'O'）的
// 外轮廓体与内孔体布尔并成一个实心体（孔被填实，与 mesh 路径 evenodd 分类不一致）；
// 且 fuse 次数 = 轮廓数，是文字建模 10 秒级耗时的主因。新实现按包含关系分组
// （复用 svg 共享 classifyNested）+ addHolesInFace 挖孔，字符间 makeCompound。
describe('textToSolid 孔洞与 compound（2026-10-13 修复）', () => {
  /** 理论体积 = (外轮廓面积 − 孔面积) × depth（空心判据；旧 fuse 实心会多出孔体积）。 */
  function expectHollowVolume(ch: string) {
    const solid = textToSolid(kernel, ch, { fontSize: 20, depth: 5 })
    const detailed = textBlueprintsDetailed(kernel, ch, { fontSize: 20 })
    const subpaths = detailed.map((d) => ({
      points: d.points,
      bbox: computeBBox(d.points),
      signedArea: computeSignedArea(d.points),
    }))
    const groups = classifyNested(subpaths)
    expect(groups).toHaveLength(1)
    const aOuter = Math.abs(subpaths[groups[0].outerIdx].signedArea)
    const aHoles = groups[0].holes.reduce((s, h) => s + Math.abs(subpaths[h].signedArea), 0)
    const expected = (aOuter - aHoles) * 5
    const actual = kernel.getVolume(solid)
    expect(Math.abs(actual - expected) / expected).toBeLessThan(0.05)
    kernel.release(solid)
  }

  it("'o' 带孔字符是空心：体积 = (外轮廓 − 孔) × depth（旧 fuse 实现把孔填实）", () => {
    expectHollowVolume('o')
  })

  it("'A'/'O' 大写字母同样空心（三角孔 / 椭圆孔）", () => {
    for (const ch of ['A', 'O']) expectHollowVolume(ch)
  })

  it("'Hello' 多字符 = COMPOUND，5 个 solid 成员（不再逐个 fuse）", () => {
    const solid = textToSolid(kernel, 'Hello', { fontSize: 20, depth: 5 })
    const members = kernel.getSubShapes(solid, 'solid')
    expect(members.length).toBe(5) // H e l l o 各一组，'o' 带孔
    kernel.release(solid)
  })

  it("'i' 的点与杆是独立轮廓 → COMPOUND 两个成员（与 mesh 路径一致，点浮在杆上方）", () => {
    const solid = textToSolid(kernel, 'i', { fontSize: 20, depth: 5 })
    const members = kernel.getSubShapes(solid, 'solid')
    expect(members.length).toBe(2)
    kernel.release(solid)
  })

  it("'AB' 多字符仍产出有效几何（旧用例语义兼容）", () => {
    const solid = textToSolid(kernel, 'AB', { fontSize: 16, depth: 2 })
    const shape = solidToShape(kernel, solid)
    expect(shape.positions.length).toBeGreaterThan(0)
    expect(shape.indices.length).toBeGreaterThan(0)
    kernel.release(solid)
  })
})