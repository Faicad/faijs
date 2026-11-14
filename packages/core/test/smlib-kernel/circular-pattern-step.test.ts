/**
 * smlib-kernel/circular-pattern-step.test — smlib 内核 angleStep 语义对账
 *
 * 与 `test/api/circular-pattern-step.test.ts`（occt + 脚本面/兼容面）同契约：
 * `circularPattern(shape, center, axis, angleStep, count)` 的 count 份位于
 * `0, step, …, (count−1)·step`。smlib wasm 是可选运行时注入，未安装时整套 skip。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import type { BrepHandle } from '../../src/brep/engine/types'

// GOTCHA: `@faicad/smlib-wasm` 是可选依赖。静态 import smlibKernel 会在收集期直接
// 因缺包 FAIL（应 skip），故检测与加载都用运行期方式，skipIf 条件在收集期同步求值。
const require = createRequire(import.meta.url)
let smlibAvailable = false
try {
  require.resolve('@faicad/smlib-wasm')
  smlibAvailable = true
} catch {
  smlibAvailable = false
}

type SmlibModule = typeof import('../../src/smlib-kernel/smlibKernel')
let mod: SmlibModule | undefined
let p: ReturnType<SmlibModule['createSmlibPrimitives']> | undefined

beforeAll(async () => {
  if (!smlibAvailable) return
  mod = await import('../../src/smlib-kernel/smlibKernel')
  p = await mod.createSmlibPrimitives()
})

afterAll(() => {
  mod?.disposeSmlib()
})

const R = 40

function boxAtRadius(): BrepHandle {
  const b = (p as NonNullable<typeof p>).makeBox(4, 4, 4)
  return (p as NonNullable<typeof p>).translate(b, R, 0, 0)
}

function stepAnglesAbs(k: BrepEngineApi, copies: BrepHandle[]): number[] {
  return copies.map((h) => {
    const bb = k.getBoundingBox(h)
    const cx = (bb.min[0] + bb.max[0]) / 2
    const cy = (bb.min[1] + bb.max[1]) / 2
    return Math.abs((Math.atan2(cy, cx) * 180) / Math.PI)
  })
}

const suite = describe.skipIf(!smlibAvailable)

suite('smlib circularPattern：angleStep 即步距', () => {
  it('angleStep=30 / count=4 → 极角 0/30/60/90', () => {
    const k = p as NonNullable<typeof p>
    const copies = k.circularPattern(boxAtRadius(), { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 30, 4)
    expect(copies).toHaveLength(4)
    const angles = stepAnglesAbs(k as unknown as BrepEngineApi, copies)
    ;[0, 30, 60, 90].forEach((want, i) => expect(angles[i]).toBeCloseTo(want, 4))
  }, 120000)

  it('缺省语义等价：angleStep=360/count 与 occt 整圈一致（count=4 → 90）', () => {
    const k = p as NonNullable<typeof p>
    const copies = k.circularPattern(boxAtRadius(), { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 90, 4)
    const angles = stepAnglesAbs(k as unknown as BrepEngineApi, copies)
    ;[0, 90, 180, 270].forEach((want, i) => expect(angles[i]).toBeCloseTo(want, 4))
  }, 120000)
})
