/**
 * @vitest-environment node
 *
 * occt S4 实体与偏置族剩余（方案 §3.4.4）——长期测试，可重复跑。
 * （该族 5 项中 offsetWire2D / buildSolidFromFaces / halfSpace 已由 S3 落地，
 *  见 test/api/offset2d.test.ts / solid-fromfaces / half-space。）
 *
 * 覆盖 2 个新脚本符号（平台 op engines:['occt']）：
 *   draftPrism（拔模棱柱）/ pipe（沿脊柱的管）
 *
 * 钉住的事实：
 *   A. occt 下几何正确：
 *     - draftPrism 角度 0 = 普通挤出（10×10 面 × z10 → 体积 1000，与上游
 *       occt-wasm api-coverage.test.ts「zero angle」用例同口径）；
 *     - **角度约定：occt 原生 draftPrism 形参即 angleDeg（度，原生内部换算弧度）**
 *       ——脚本面直传度，不做二次换算（对照：circleArc/ellipseArc 脚本面收度、
 *       内部换算弧度，因 occt Geom_TrimmedCurve 吃弧度）。
 *     - pipe：圆截面沿直线脊柱 → 圆柱管（体积 ≈ πr²L）。
 *   B. 入参校验（方向零向量 / 角度非有限 / 缺参）；
 *   C. 平台身份：brepkit 下执行前报 E_BREP_UNSUPPORTED（D11-4）；
 *   D. TS 级直连（L1 覆盖门禁）。
 *
 * Run: npx vitest run test/api/occt-s4-solid-offset.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import type { Shape } from '../../src/mesh/types'
import { __resetEngineRegistriesForTests, getBrepEngine } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { brepOf } from '../../src/shape'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'
import { draftPrism, pipe } from '../../src/api/solid-offset'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function useOcct(): Promise<void> {
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
}

function exec(mode: ExecutionMode, code: string): Promise<ExecutionResult> {
  return new CadRuntime(ports(), mode, { cad: createApiNamespaceWithEditorOps() }).execute(code)
}

async function shapeOf(mode: ExecutionMode, code: string, part: string): Promise<Shape> {
  const result = await exec(mode, code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const s = result.outputs.get(asPartName(part))
  if (!s) throw new Error(`no output for ${part}`)
  return s as Shape
}

function bboxOf(s: Shape): { xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number } {
  return getBrepApi().getBoundingBox(brepOf(s) as never)
}
function volumeOf(s: Shape): number {
  return getBrepApi().getVolume(brepOf(s) as never)
}

/** 10×10 方形 profile 面（XY 平面，[0,10]²，z=0）——拔模棱柱基底共用。 */
const SQUARE_PROFILE =
  `let part0 = cad.profile({ contours: [{"segments":[` +
  `{"kind":"line","x1":0,"y1":0,"x2":10,"y2":0},{"kind":"line","x1":10,"y1":0,"x2":10,"y2":10},` +
  `{"kind":"line","x1":10,"y1":10,"x2":0,"y2":10},{"kind":"line","x1":0,"y1":10,"x2":0,"y2":0}],"closed":true}] })\n`

describe('S4 实体偏置族剩余 — draftPrism（occt 正例，脚本级）', () => {
  it('A1. 拔模角 0 = 普通挤出：体积 1000，z∈[0,10]', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `${SQUARE_PROFILE}let part1 = cad.draftPrism(part0, [0, 0, 10], 0)\n`,
      'part1',
    )
    expect(volumeOf(s)).toBeCloseTo(1000, 3)
    const b = bboxOf(s)
    expect(b.zmin).toBeCloseTo(0, 4)
    expect(b.zmax).toBeCloseTo(10, 4)
  })

  it('A2. 拔模角 5°：正体积、高度不变、体积 ≠ 无拔模（截面渐变生效）', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `${SQUARE_PROFILE}let part1 = cad.draftPrism(part0, [0, 0, 10], 5)\n`,
      'part1',
    )
    const v = volumeOf(s)
    expect(v).toBeGreaterThan(0)
    expect(v).not.toBeCloseTo(1000, 0) // 与零拔模可区分（taper 生效）
    const b = bboxOf(s)
    expect(b.zmax).toBeCloseTo(10, 4)
    expect(b.zmin).toBeCloseTo(0, 4)
  })
})

describe('S4 实体偏置族剩余 — pipe（occt 正例，脚本级）', () => {
  it('A3. 圆盘面截面（XY 面）沿 +Z 直线脊柱 → 实体圆柱，体积 ≈ πr²L', async () => {
    await useOcct()
    // GOTCHA（实测钉住）：BRepOffsetAPI_MakePipe 的产物类型随截面类型——
    //   截面 face → 实体；截面 wire/edge → **壳**（管面，体积无意义）。
    // 因此实体管必须喂「面截面」（圆盘轮廓）；edge 截面行为另钉在 A4。
    // 再 GOTCHA：截面须**横截**脊柱（盘面法向 = 脊柱方向）——盘在 XY 面、
    // 脊柱沿 +Y 时两者平行，扫掠退化（体积 0，第一版实测踩坑）。
    const s = await shapeOf(
      'brep',
      // 2D 圆盘轮廓（两段半圆弧，radius 2）→ face 截面
      `let part0 = cad.profile({ contours: [{"segments":[` +
      `{"kind":"arc","cx":0,"cy":0,"radius":2,"startAngle":0,"endAngle":3.141592653589793,"ccw":true,"x1":2,"y1":0,"x2":-2,"y2":0},` +
      `{"kind":"arc","cx":0,"cy":0,"radius":2,"startAngle":3.141592653589793,"endAngle":6.283185307179586,"ccw":true,"x1":-2,"y1":0,"x2":2,"y2":0}],"closed":true}] })\n` +
      `let part1 = cad.wire([[0,0,0],[0,0,20]])\n` +
      `let part2 = cad.pipe(part0, part1)\n`,
      'part2',
    )
    const v = volumeOf(s)
    expect(v).toBeGreaterThan(0)
    expect(Math.abs(v - Math.PI * 4 * 20)).toBeLessThan(Math.PI * 4 * 20 * 0.02)
    const b = bboxOf(s)
    expect(b.zmax - b.zmin).toBeCloseTo(20, 3)
  })

  it('A4. GOTCHA：edge 截面 → 产**壳**（管面）而非实体；bbox 跨度仍是脊柱长', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `let part0 = cad.circleArc([0,0,0],[0,1,0],2,0,360)\n` +
      `let part1 = cad.wire([[0,0,0],[0,20,0]])\n` +
      `let part2 = cad.pipe(part0, part1)\n`,
      'part2',
    )
    const t = getBrepApi().shapeType(brepOf(s) as never)
    expect(String(t)).toMatch(/shell/i)
    const b = bboxOf(s)
    expect(b.ymax - b.ymin).toBeCloseTo(20, 3)
  })
})

describe('S4 实体偏置族剩余 — 入参校验', () => {
  it('B. draftPrism 零方向向量 → E_DRAFTPRISM_BAD_DIRECTION', async () => {
    await useOcct()
    const r = await exec('brep', `${SQUARE_PROFILE}let part1 = cad.draftPrism(part0, [0,0,0], 5)\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_DRAFTPRISM_BAD_DIRECTION/)
  })

  it('B. draftPrism 角度非有限数 → E_DRAFTPRISM_BAD_ANGLE', async () => {
    await useOcct()
    const r = await exec('brep', `${SQUARE_PROFILE}let part1 = cad.draftPrism(part0, [0,0,10], 'x')\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_DRAFTPRISM_BAD_ANGLE/)
  })

  it('B. pipe 缺参 → E_PIPE_MISSING_ARG', async () => {
    await useOcct()
    const r = await exec('brep', `let part1 = cad.pipe(null, null)\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_PIPE_MISSING_ARG/)
  })
})

describe('S4 实体偏置族剩余 — 平台身份（brepkit 下执行前静态拒绝，D11-4）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
  }, 120000)

  const CALLS: Array<[string, string]> = [
    ['draftPrism', `${SQUARE_PROFILE}let part1 = cad.draftPrism(part0, [0,0,10], 5)\n`],
    ['pipe', `let part0 = cad.wire([[0,0,0],[1,0,0]])\nlet part1 = cad.pipe(part0, part0)\n`],
  ]

  for (const [op, code] of CALLS) {
    it(`${op}: requires engine occt (current=brepkit)`, async () => {
      const result = await exec('brep', code)
      expect(result.failedAt).toBeDefined()
      const msg = JSON.stringify(result.failedAt)
      expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
      expect(msg).toMatch(new RegExp(`op '${op}' requires engine occt`))
      expect(msg).toMatch(/current=brepkit/)
    })
  }
})

describe('S4 实体偏置族剩余 — TS 级直连（L1 覆盖门禁）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const brep = await getBrepEngine()
    configureBackends({
      contractVersion: CONTRACT_VERSION,
      config: { mode: 'auto', brepEngineId: 'occt' },
      kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
      fonts: undefined,
      texture: undefined,
      assets: undefined,
      events: { emit: () => undefined },
    } as unknown as Backends)
  }, 120000)

  it('D. draftPrism 直连：零角 = 普通挤出，体积 1000', async () => {
    const runtime = new CadRuntime(ports(), 'brep', { cad: createApiNamespaceWithEditorOps() })
    const result = await runtime.execute(SQUARE_PROFILE)
    const face = result.outputs.get(asPartName('part0')) as Shape
    const s = await draftPrism(face, [0, 0, 10], 0)
    expect(volumeOf(s)).toBeCloseTo(1000, 3)
  })

  it('D. pipe 直连：edge 截面 → 壳（管面）；体积断言见 A3 的面截面口径', async () => {
    const runtime = new CadRuntime(ports(), 'brep', { cad: createApiNamespaceWithEditorOps() })
    const result = await runtime.execute(
      `let part0 = cad.circleArc([0,0,0],[0,1,0],2,0,360)\nlet part1 = cad.wire([[0,0,0],[0,20,0]])\n`,
    )
    const profile = result.outputs.get(asPartName('part0')) as Shape
    const spine = result.outputs.get(asPartName('part1')) as Shape
    const s = await pipe(profile, spine)
    expect(String(getBrepApi().shapeType(brepOf(s) as never))).toMatch(/shell/i)
  })
})
