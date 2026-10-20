/**
 * 临时诊断：ellipse 带 angle（rx<ry）走 expand → planegcs solve → project 全链，
 * 验证 angle 在哪一层被丢弃（rx=10/ry=20/angle=π/4 必须还原出 rot=135° 的椭圆）。
 *
 * 现象：rx=10/ry=20 extrude 截面 40×40（project.ts 归一化缺失，已修）；
 * 旋转用例（angle≠0）bbox 半宽 10（=minor）——angle 疑似在求解链丢失，长轴被摆到 90°。
 * 运行：npx vitest run packages/core/test/sketch/ellipse-angle-diag.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getActiveBrepEngine } from '../../src/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION } from '../../src/runtime-state'
import { expandShapes } from '../../src/sketch/shapes'
import { solveSketch } from '../../src/sketch/solve'
import { toFreeCadGeoms } from '../../src/sketch/project'
import { createNodePlanegcsSolver } from '../../src/sketch/node'
import type { SketchSolver } from '../../src/sketch/solver'

let solver: SketchSolver

beforeAll(async () => {
  await initOcctWasm()
  await registerOcctBrepEngine()
  const brep = (await getActiveBrepEngine()).primitives
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'brep' },
    kernel: { brep, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: undefined,
    cad: undefined,
  } as never)
  solver = await createNodePlanegcsSolver()
}, 120000)

afterAll(() => {})

describe('ellipse angle 链诊断（rx<ry + angle≠0）', () => {
  it('expand → geoms 的 ellipse 保留 rx/ry/angle', () => {
    const e = expandShapes([{ kind: 'ellipse', tag: 'e', rx: 10, ry: 20, angle: Math.PI / 4 }])
    const g = e.geoms[0]
    expect(g.kind).toBe('ellipse')
    expect((g as { rx?: number }).rx).toBe(10)
    expect((g as { ry?: number }).ry).toBe(20)
    expect((g as { angle?: number }).angle).toBeCloseTo(Math.PI / 4, 6)
  })

  it('solve 后 project（toFreeCadGeoms）的 major/minor/angleXU', async () => {
    const e = expandShapes([{ kind: 'ellipse', tag: 'e', rx: 10, ry: 20, angle: Math.PI / 4 }])
    const outcome = await solveSketch(e.geoms, e.constraints, { solver })
    expect(outcome.converged).toBe(true)
    const fc = toFreeCadGeoms(outcome.geoms as never)
    const el = fc.find((g) => g.kind === 'ellipse')
    expect(el).toBeTruthy()
    const typed = el as { majorRadius?: number; minorRadius?: number; angleXU?: number }
    console.log('[diag] majorRadius=', typed.majorRadius, 'minorRadius=', typed.minorRadius, 'angleXU=', typed.angleXU)
    // 期望：归一化后 major=20/minor=10；长轴方向 = angleXU（焦点1 方向）。
    // project.ts 归一化把 focus1 摆到 rot 的反方向（fx1 = cx − c·cos(rot)），
    // 因此 angleXU = rot − π = 135°−180° = −45°（与 135° 是同一长轴的等价表示）。
    expect(typed.majorRadius).toBeCloseTo(20, 3)
    expect(typed.minorRadius).toBeCloseTo(10, 3)
    const a = typed.angleXU ?? 0
    const equivalentTo135 =
      Math.abs(a - (Math.PI * 3) / 4) < 0.001 || Math.abs(a + Math.PI / 4) < 0.001
    expect(equivalentTo135, `angleXU=${a} 应等价于 135°（−45° 亦为同一长轴）`).toBe(true)
  })
})
