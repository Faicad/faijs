/**
 * 回归测试：椭圆草图拉伸后截面必须是椭圆（rx≠ry），不得塌成圆。
 *
 * 用户 bug（2026-10-20）：weapp 画椭圆（外接框对角）→ 拉伸 → 截面变圆。
 * 复现（真 worker bundle + brepkit，`scripts/repro-ellipse-extrude.mjs` E1）：
 *   rx=10/ry=20 extrude → 截面 bbox 40×40（rx 被 ry 覆盖）——rx<ry 时 project.ts
 *   未归一化 major/minor，焦点距 c=√(major²−minor²) 取到 √(负)→0 → 焦点塌进中心。
 * 修复：project.ts ellipse 投影处 rx<ry 时交换半径并把长轴方向 +π/2（gp_Elips/GCS
 * 语义 major≥minor）。E2（rx=20/ry=10）修复前本来就正常，作为对照钉住。
 *
 * 运行：npx vitest run packages/core/test/brep/ellipse-extrude-regression.test.ts
 */

// ── brepkit stdout 噪声过滤 ──
const occtOrigLog = console.log
console.log = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  if (msg.trim() === '') return
  occtOrigLog(...args)
}

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRuntime } from '../../src/index'
import { createNodePorts } from '../../src/node'
import { getActiveBrepEngine, __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { configureBackends, CONTRACT_VERSION } from '../../src/runtime-state'
import { disposeBrepkit } from '../../src/brepkit-kernel/brepkitKernel'

beforeAll(async () => {
  __resetEngineRegistriesForTests()
  await registerBrepkitBrepEngine()
  const brep = await getActiveBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepEngineId: 'brepkit' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Parameters<typeof configureBackends>[0])
}, 120000)

afterAll(() => {
  disposeBrepkit()
})

const ELLIPSE_SCENE = (rx: number, ry: number, angleDeg = 0): string => `let sk0 = cad.sketch({ shapes:[{kind:'ellipse', cx:0, cy:0, rx:${rx} * MM, ry:${ry} * MM, angle:${angleDeg}}], constraints:[], plane:'XY' })
let part0 = cad.extrude(sk0, { length:5 * MM, normal:[0,0,1] })`

/** outputs.part0 的 mesh bbox（浮点容差）。 */
async function part0Bbox(runtime: ReturnType<typeof createRuntime>, code: string) {
  const result = await runtime.execute(code)
  expect(result.failedAt ?? null).toBeNull()
  const geo = result.outputs.get('part0')
  expect(geo).toBeTruthy()
  const pos = geo.positions as Float32Array
  let min = [Infinity, Infinity, Infinity]
  let max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (pos[i + k] < min[k]) min[k] = pos[i + k]
      if (pos[i + k] > max[k]) max[k] = pos[i + k]
    }
  }
  return { min, max }
}

const closeTo = (v: number, expected: number, tol = 0.5) => {
  expect(Math.abs(v - expected), `实际 ${v} 期望 ${expected}`).toBeLessThan(tol)
}

describe('regression: ellipse sketch + extrude 截面保持椭圆', () => {
  it('rx=10 < ry=20：截面 x 半宽 10、y 半宽 20（修复前 x 被 ry 覆盖成 20 → 圆）', async () => {
    const runtime = createRuntime(createNodePorts())
    const { min, max } = await part0Bbox(runtime, ELLIPSE_SCENE(10, 20))
    closeTo(min[0], -10)
    closeTo(max[0], 10)
    closeTo(min[1], -20)
    closeTo(max[1], 20)
  })

  it('rx=20 > ry=10：对照（修复前本就正常），x 半宽 20、y 半宽 10', async () => {
    const runtime = createRuntime(createNodePorts())
    const { min, max } = await part0Bbox(runtime, ELLIPSE_SCENE(20, 10))
    closeTo(min[0], -20)
    closeTo(max[0], 20)
    closeTo(min[1], -10)
    closeTo(max[1], 10)
  })

  it('rx=10 < ry=20 且旋转 45°（faijs 的 angle 单位是度）：归一化长轴=20/短轴=10/rot=135°，截面 bbox 半宽 15.81', async () => {
    const runtime = createRuntime(createNodePorts())
    const { min, max } = await part0Bbox(runtime, ELLIPSE_SCENE(10, 20, 45))
    // rot=135°：x(t)=20cos(135°)cos t − 10sin(135°)sin t，半宽 = √(400·0.5 + 100·0.5) = √250 ≈ 15.81
    closeTo(max[0], 15.81, 0.5)
    closeTo(max[1], 15.81, 0.5)
    closeTo(min[0], -15.81, 0.5)
    closeTo(min[1], -15.81, 0.5)
  })

  it('rx=10 < ry=20 且旋转 30°（度）：canonical angleXU=-60°，包络 x=√(100+75)=13.23 / y=√(300+25)=18.03', async () => {
    const runtime = createRuntime(createNodePorts())
    const { max } = await part0Bbox(runtime, ELLIPSE_SCENE(10, 20, 30))
    closeTo(max[0], 13.23, 0.5)
    closeTo(max[1], 18.03, 0.5)
  })
})
