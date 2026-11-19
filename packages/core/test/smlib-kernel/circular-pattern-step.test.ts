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

/** bbox 中心的极角（度）。 */
function polarAngle(k: BrepEngineApi, h: BrepHandle): number {
  // GOTCHA: `getBoundingBox` returns flat `BrepBoundingBox` ({xmin,ymin,zmin,xmax,ymax,zmax}),
  // NOT `{min:number[], max:number[]}`. `getSolidBoundingBox` (brep-utils) returns the array form.
  const bb = k.getBoundingBox(h) as unknown as { xmin: number; ymin: number; xmax: number; ymax: number }
  const cx = (bb.xmin + bb.xmax) / 2
  const cy = (bb.ymin + bb.ymax) / 2
  return (Math.atan2(cy, cx) * 180) / Math.PI
}

/**
 * 各副本相对原件的极角偏移（度，归一化到 [0, 360)）。
 *
 * 旋转方向由 axis 决定（可能 CW 或 CCW），所以同时接受 `want` 与 `(360 - want) % 360`。
 */
function stepAnglesAbs(k: BrepEngineApi, copies: BrepHandle[], baseDeg: number): number[] {
  return copies.map((h) => {
    const deg = polarAngle(k, h)
    return ((deg - baseDeg + 360) % 360)
  })
}

const suite = describe.skipIf(!smlibAvailable)

suite('smlib circularPattern：angleStep 即步距', () => {
  /** 同时接受 CW / CCW 方向（want 或 (360 - want) % 360）。 */
  function expectAngle(angles: number[], i: number, want: number): void {
    const got = angles[i]!
    const mirror = (360 - want) % 360
    const pass = Math.abs(got - want) < 0.001 || Math.abs(got - mirror) < 0.001
    expect(pass, `angles[${i}]=${got.toFixed(4)}, expected ${want} or ${mirror.toFixed(4)}`).toBe(true)
  }

  it('angleStep=30 / count=4 → 极角 0/30/60/90', () => {
    const k = p as NonNullable<typeof p>
    const base = boxAtRadius()
    const baseDeg = polarAngle(k as unknown as BrepEngineApi, base)
    const copies = k.circularPattern(base, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 30, 4)
    expect(copies).toHaveLength(4)
    const angles = stepAnglesAbs(k as unknown as BrepEngineApi, copies, baseDeg)
    ;[0, 30, 60, 90].forEach((want, i) => expectAngle(angles, i, want))
  }, 120000)

  it('缺省语义等价：angleStep=360/count 与 occt 整圈一致（count=4 → 90）', () => {
    const k = p as NonNullable<typeof p>
    const base = boxAtRadius()
    const baseDeg = polarAngle(k as unknown as BrepEngineApi, base)
    const copies = k.circularPattern(base, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 90, 4)
    const angles = stepAnglesAbs(k as unknown as BrepEngineApi, copies, baseDeg)
    ;[0, 90, 180, 270].forEach((want, i) => expectAngle(angles, i, want))
  }, 120000)
})
