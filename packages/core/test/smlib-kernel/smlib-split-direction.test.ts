/**
 * smlib-kernel/smlib-split-direction — `splitByPlane` 的 positive/negative 侧必须与
 * 契约一致（**法向正侧 = positive**，见 api/split-by-plane.ts），与 occt 同口径。
 *
 * 复现（2026-10-27）：smlib 反了——`SmApiCut(brep, pt, nrm)` 保留的是法向**负**侧
 * （切掉 +nrm 侧），而适配器用 +normal 切出的结果当 positive，导致 positive 落在
 * 法向负侧。皮卡丘耳朵因此「下黑上黄」（应为上黑下黄）。
 *
 * 用 bbox 判定（smlib 的 SmApiCut 输出开口壳、volume=0，不能用体积）。
 *
 * Run: npx vitest run test/smlib-kernel/smlib-split-direction.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createSmlibPrimitives, disposeSmlib, type SmlibPrimitives } from '../../src/smlib-kernel/smlibKernel'
import { resetSmlibWasm } from '../../src/smlib-kernel/smlibWasm'

let p: SmlibPrimitives

beforeAll(async () => {
  p = await createSmlibPrimitives()
})

afterAll(() => {
  disposeSmlib()
  resetSmlibWasm()
})

describe('smlib splitByPlane 方向（法向正侧 = positive）', () => {
  it('normal +Z @ z=3：positive 在 z>3，negative 在 z<3', () => {
    const s = p.makeBox(10, 10, 10)
    const { positive, negative } = p.splitByPlane(s, { x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: 1 })
    expect(p.getBoundingBox(positive).zmin, 'positive 应在法向正侧（z>3）').toBeGreaterThan(2.5)
    expect(p.getBoundingBox(negative).zmax, 'negative 应在法向负侧（z<3）').toBeLessThan(3.5)
  })

  it('normal +X @ x=5：positive 在 x>5，negative 在 x<5', () => {
    const s = p.makeBox(10, 20, 30)
    const { positive, negative } = p.splitByPlane(s, { x: 5, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    expect(p.getBoundingBox(positive).xmin, 'positive 应在法向正侧（x>5）').toBeGreaterThan(4.5)
    expect(p.getBoundingBox(negative).xmax, 'negative 应在法向负侧（x<5）').toBeLessThan(5.5)
  })
})