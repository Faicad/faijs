/**
 * api extrude — 双向拉伸（backwardLength）测试（2026-10-19）
 *
 * 对应 3d_editor 草图方案 §7.1（weapp 草图拉升：双向拉伸 + 面上布尔合并）。
 * 先写测试再实现：本文件断言在 backwardLength 实现前应失败。
 *
 * 覆盖：
 * 1. 双向几何（双引擎各跑一遍）：XY 面 20×10 矩形，
 *    `{ length:10, backwardLength:5, normal:[0,0,1] }` → 包围盒 z∈[-5,10]、
 *    体积 = 20×10×15、角色表 cap:top（+L1 端）/ cap:bottom（−L2 端）/ wall×4。
 * 2. 兼容性：`backwardLength:0` 与缺省 → 与现状单向几何一致（bbox / 体积）。
 * 3. 校验：`backwardLength>0 && mode:'backward'` → E_EXTRUDE_BACKWARD_CONFLICT；
 *    `backwardLength>0 && upTo` → E_EXTRUDE_BACKWARD_UPTO。
 * 4. 双向 + 布尔组合端到端：box 顶面草图 → 双向拉升 → subtract / union / intersect。
 *
 * 引擎切换按仓库惯例（R8：默认引擎 = 第一个注册者）：`__resetEngineRegistriesForTests()`
 * 重置注册表后只注册目标引擎，文件内按 describe 隔离（参照 engine-compat/brepkit-selector-runtime.test.ts）。
 * BREP 内核是 runtime 作用域，断言须在 runtime dispose 前进行（参照 D13 的 brepChain.kernel）。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { createRuntime } from '../../src/cad-runtime/runtime'
import { createNodePorts } from '../../src/node-host'
import { asPartName } from '../../src/identity'
import type { CadRuntime, ExecutionResult } from '../../src/cad-runtime/runtime'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import type { BrepHandle } from '../../src/brep/engine/types'

/** XY 面上的 20×10 矩形草图（双向测试共用基线）。 */
const SKETCH_RECT = `
  let sk0 = cad.sketch({ plane: 'XY', shapes: [{ kind: 'rect', w: 20, d: 10, tag: 'g0' }], constraints: [] })
`

/**
 * 执行代码并在 runtime 存活期内做断言（内核 handle 只在 runtime 作用域有效）。
 * 失败即抛（断言 failedAt 为空）。
 */
async function executeOk(
  code: string,
  run: (kernel: BrepEngineApi, result: ExecutionResult) => void,
): Promise<void> {
  const runtime: CadRuntime = createRuntime(createNodePorts(), 'brep')
  try {
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt, `执行失败: ${result.failedAt?.message ?? ''}`).toBeUndefined()
    // brepChain 在 CadRuntime 上是私有的，测试经结构断言取内核（运行时同构）
    const kernel = (runtime as unknown as { brepChain?: { kernel: BrepEngineApi } }).brepChain?.kernel
    expect(kernel, 'BREP kernel 未初始化').toBeTruthy()
    run(kernel!, result)
  } finally {
    runtime.dispose()
  }
}

/** 执行代码并断言 failedAt 携带指定错误码（校验类测试用）。 */
async function expectFailure(code: string, errCode: string): Promise<void> {
  const runtime: CadRuntime = createRuntime(createNodePorts(), 'brep')
  try {
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt, '应失败').toBeDefined()
    expect(result.failedAt?.code).toBe(errCode)
  } finally {
    runtime.dispose()
  }
}

function solidOf(result: ExecutionResult, part: string): BrepHandle {
  const s = result.brepSolids?.get(asPartName(part))?.solid
  expect(s, `${part} 无 BREP solid`).toBeDefined()
  return s!
}

function bboxOf(kernel: BrepEngineApi, solid: BrepHandle): { min: number[]; max: number[] } {
  const b = kernel.getBoundingBox(solid)
  return { min: [b.xmin, b.ymin, b.zmin], max: [b.xmax, b.ymax, b.zmax] }
}

function volumeOf(kernel: BrepEngineApi, solid: BrepHandle): number {
  return kernel.getVolume(solid)
}

/** 面上草图 + 双向拉升 + 布尔 的共用代码前缀（p2 为布尔结果）。 */
const FACE_BOOL_PREFIX = `
  let part0 = cad.box(20, 20, 20, { centered: true })
  let sk0 = cad.sketch({ plane: { origin: [0, 0, 10], normal: [0, 0, 1] }, shapes: [{ kind: 'rect', w: 4, d: 4, tag: 'g0' }], constraints: [] })
  let p1 = cad.extrude(sk0, { length: 5, backwardLength: 15, normal: [0, 0, 1] })
`

/** 双引擎共享的用例集（describe 级隔离注册引擎后调用）。 */
function extrudeTwoSidedTests(engine: string): void {
  it(`${engine}: 双向几何 bbox z∈[-5,10]、体积 20×10×15、角色表完整`, async () => {
    await executeOk(`${SKETCH_RECT}
      let part0 = cad.extrude(sk0, { length: 10, backwardLength: 5, normal: [0, 0, 1] })
    `, (kernel, result) => {
      const solid = solidOf(result, 'part0')
      const bb = bboxOf(kernel, solid)
      expect(bb.min[2]).toBeCloseTo(-5, 6)
      expect(bb.max[2]).toBeCloseTo(10, 6)
      expect(bb.max[0] - bb.min[0]).toBeCloseTo(20, 6)
      expect(bb.max[1] - bb.min[1]).toBeCloseTo(10, 6)
      expect(volumeOf(kernel, solid)).toBeCloseTo(20 * 10 * 15, 6)
      // 角色表：cap:top（+L1 端 z=10）/ cap:bottom（−L2 端 z=-5）/ wall×4
      const roles = (result.naming?.get(asPartName('part0'))?.faceNaming ?? []).map((f) => f.role ?? 'null')
      expect(roles).toContain('top')
      expect(roles).toContain('bottom')
      expect(roles.filter((r) => r.startsWith('wall:')).sort()).toEqual(['wall:0', 'wall:1', 'wall:2', 'wall:3'])
    })
  }, 120000)

  it(`${engine}: 负向-only（mode:'backward'）现状能力不受影响`, async () => {
    await executeOk(`${SKETCH_RECT}
      let part0 = cad.extrude(sk0, { length: 5, mode: 'backward', normal: [0, 0, 1] })
    `, (kernel, result) => {
      const bb = bboxOf(kernel, solidOf(result, 'part0'))
      expect(bb.min[2]).toBeCloseTo(-5, 6)
      expect(bb.max[2]).toBeCloseTo(0, 6)
    })
  }, 120000)

  it(`${engine}: backwardLength:0 与缺省 → 与现状单向几何一致`, async () => {
    await executeOk(`${SKETCH_RECT}
      let part0 = cad.extrude(sk0, { length: 10, normal: [0, 0, 1] })
    `, (kernel, result) => {
      const ba = bboxOf(kernel, solidOf(result, 'part0'))
      expect(ba.min[2]).toBeCloseTo(0, 6)
      expect(ba.max[2]).toBeCloseTo(10, 6)
    })
    await executeOk(`${SKETCH_RECT}
      let part0 = cad.extrude(sk0, { length: 10, backwardLength: 0, normal: [0, 0, 1] })
    `, (kernel, result) => {
      const bb = bboxOf(kernel, solidOf(result, 'part0'))
      expect(bb.min[2]).toBeCloseTo(0, 6)
      expect(bb.max[2]).toBeCloseTo(10, 6)
    })
  }, 120000)

  it(`${engine}: backwardLength>0 && mode:'backward' → E_EXTRUDE_BACKWARD_CONFLICT`, async () => {
    await expectFailure(`${SKETCH_RECT}
      let part0 = cad.extrude(sk0, { length: 5, backwardLength: 5, mode: 'backward', normal: [0, 0, 1] })
    `, 'E_EXTRUDE_BACKWARD_CONFLICT')
  }, 120000)

  it(`${engine}: backwardLength>0 && upTo → E_EXTRUDE_BACKWARD_UPTO`, async () => {
    await expectFailure(`${SKETCH_RECT}
      let part0 = cad.extrude(sk0, { length: 5, backwardLength: 5, upTo: 'last', baseFeature: sk0, normal: [0, 0, 1] })
    `, 'E_EXTRUDE_BACKWARD_UPTO')
  }, 120000)

  it(`${engine}: 面上草图双向拉升 + subtract → 挖穿（体积 8000−240）`, async () => {
    await executeOk(`${FACE_BOOL_PREFIX}
      let p2 = cad.subtract(part0, p1)
    `, (kernel, result) => {
      // p1 与 box 的重叠 = z∈[-5,10] 的 4×4×15 → 被挖掉：8000 − 240 = 7760
      const solid = solidOf(result, 'p2')
      expect(volumeOf(kernel, solid)).toBeCloseTo(20 * 20 * 20 - 4 * 4 * 15, 4)
      const bb = bboxOf(kernel, solid)
      expect(bb.min[2]).toBeCloseTo(-10, 4)
      expect(bb.max[2]).toBeCloseTo(10, 4)
    })
  }, 120000)

  it(`${engine}: 面上草图双向拉升 + union → 融合（体积 8000+320−240）`, async () => {
    await executeOk(`${FACE_BOOL_PREFIX}
      let p2 = cad.union(part0, p1)
    `, (kernel, result) => {
      // union 体积 = box + p1(4×4×20=320) − 重叠(4×4×15=240)
      expect(volumeOf(kernel, solidOf(result, 'p2'))).toBeCloseTo(8000 + 4 * 4 * 20 - 4 * 4 * 15, 4)
    })
  }, 120000)

  it(`${engine}: 面上草图双向拉升 + intersect → 交集（体积 4×4×15）`, async () => {
    await executeOk(`${FACE_BOOL_PREFIX}
      let p2 = cad.intersect(part0, p1)
    `, (kernel, result) => {
      // 交集 = z∈[-5,10] 的 4×4×15
      expect(volumeOf(kernel, solidOf(result, 'p2'))).toBeCloseTo(4 * 4 * 15, 4)
    })
  }, 120000)
}

describe('backwardLength（双向拉伸）· brepkit', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
  }, 120000)

  extrudeTwoSidedTests('brepkit')
})

describe('backwardLength（双向拉伸）· occt', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
  }, 120000)

  extrudeTwoSidedTests('occt')
})
