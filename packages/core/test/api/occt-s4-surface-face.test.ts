/**
 * @vitest-environment node
 *
 * occt S4 曲面面族（方案 §3.4.2）——长期测试，可重复跑。
 *
 * 覆盖 5 个新脚本符号（全部平台 op engines:['occt']；bsplineSurface 已由 S3 的
 * `surface` op 覆盖，不在本文件）：
 *   faceOnSurface / nonPlanarFace / makeSolid / reverseSurfaceU / outerWire
 *
 * 钉住的事实：
 *   A. occt 下各 op 几何正确（bbox / 体积 / kind 判别位）；
 *      GOTCHA：脚本面取「面」输入用 `cad.profile`（产 planar face）——
 *      `cad.sectionByPlane` 产 1D 交线 compound，不是面，不能当宿主面。
 *   B. 入参校验（缺参）；
 *   C. 平台身份：brepkit 下执行前报 E_BREP_UNSUPPORTED（D11-4）；
 *   D. TS 级直连（L1 覆盖门禁；makeSolid 的 shell 经 L1 getSubShapes 拆壳构造）。
 *
 * Run: npx vitest run test/api/occt-s4-surface-face.test.ts
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
import { solidToShape } from '../../src/brep/brep-ops'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { brepOf, fromBrep } from '../../src/shape'
import type { BrepHandle } from '../../src/brep/engine/types'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'
import { faceOnSurface, nonPlanarFace, makeSolid, reverseSurfaceU, outerWire } from '../../src/api/surface-face'

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

const kindOf = (s: Shape): string | undefined => (s as { kind?: string }).kind

function bboxOf(s: Shape): { xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number } {
  return getBrepApi().getBoundingBox(brepOf(s) as never)
}
function volumeOf(s: Shape): number {
  return getBrepApi().getVolume(brepOf(s) as never)
}

/** 10×10 方形 profile 面（XY 平面，[0,10]²，z=0）——面输入 fixture 共用。 */
const SQUARE_PROFILE =
  `let part0 = cad.profile({ contours: [{"segments":[` +
  `{"kind":"line","x1":0,"y1":0,"x2":10,"y2":0},{"kind":"line","x1":10,"y1":0,"x2":10,"y2":10},` +
  `{"kind":"line","x1":10,"y1":10,"x2":0,"y2":10},{"kind":"line","x1":0,"y1":10,"x2":0,"y2":0}],"closed":true}] })\n`

describe('S4 曲面面族 — occt 正例（脚本级）', () => {
  it('A1. nonPlanarFace：闭合 wire → 面（MakeFilling 内核；平面 wire 亦可）', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `let part0 = cad.wire([[0,0,0],[10,0,0],[10,10,0],[0,10,0]], { closed: true })\n` +
      `let part1 = cad.nonPlanarFace(part0)\n`,
      'part1',
    )
    const b = bboxOf(s)
    expect(b.xmax - b.xmin).toBeCloseTo(10, 4)
    expect(b.ymax - b.ymin).toBeCloseTo(10, 4)
  })

  it('A2. outerWire：面 → 外环（kind=curve，bbox 与面一致）', async () => {
    await useOcct()
    const s = await shapeOf('brep', `${SQUARE_PROFILE}let part1 = cad.outerWire(part0)\n`, 'part1')
    expect(kindOf(s)).toBe('curve')
    const b = bboxOf(s)
    expect(b.xmin).toBeCloseTo(0, 4)
    expect(b.xmax).toBeCloseTo(10, 4)
    expect(b.ymin).toBeCloseTo(0, 4)
    expect(b.ymax).toBeCloseTo(10, 4)
    expect(Math.abs(b.zmax - b.zmin)).toBeLessThanOrEqual(1e-6)
  })

  it('A3. reverseSurfaceU：U 反转面 bbox 不变（拓扑不变，参数化镜像）', async () => {
    await useOcct()
    const after = await shapeOf('brep', `${SQUARE_PROFILE}let part1 = cad.reverseSurfaceU(part0)\n`, 'part1')
    const b = bboxOf(after)
    expect(b.xmin).toBeCloseTo(0, 4)
    expect(b.xmax).toBeCloseTo(10, 4)
    expect(b.ymax).toBeCloseTo(10, 4)
  })

  it('A4. faceOnSurface：宿主面 + 其曲面上的闭合 wire → 新面（bbox = wire 跨度）', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `${SQUARE_PROFILE}` +
      `let part1 = cad.wire([[2,2,0],[8,2,0],[8,8,0],[2,8,0]], { closed: true })\n` +
      `let part2 = cad.faceOnSurface(part0, part1)\n`,
      'part2',
    )
    const b = bboxOf(s)
    expect(b.xmin).toBeCloseTo(2, 3)
    expect(b.xmax).toBeCloseTo(8, 3)
    expect(b.ymin).toBeCloseTo(2, 3)
    expect(b.ymax).toBeCloseTo(8, 3)
  })
})

describe('S4 曲面面族 — 入参校验', () => {
  it('B. faceOnSurface 缺 wire → E_FACEONSURFACE_MISSING_ARG', async () => {
    await useOcct()
    const r = await exec('brep', `let part1 = cad.faceOnSurface(null, null)\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_FACEONSURFACE_MISSING_ARG/)
  })

  it('B. makeSolid 缺参 → E_MAKESOLID_NO_SHELL', async () => {
    await useOcct()
    const r = await exec('brep', `let part1 = cad.makeSolid(null)\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_MAKESOLID_NO_SHELL/)
  })

  it('B. outerWire 缺参 → E_OUTERWIRE_NO_FACE', async () => {
    await useOcct()
    const r = await exec('brep', `let part1 = cad.outerWire(null)\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_OUTERWIRE_NO_FACE/)
  })
})

describe('S4 曲面面族 — 平台身份（brepkit 下执行前静态拒绝，D11-4）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
  }, 120000)

  const CALLS: Array<[string, string]> = [
    ['faceOnSurface', `${SQUARE_PROFILE}let part1 = cad.faceOnSurface(part0, part0)\n`],
    ['nonPlanarFace', `let part0 = cad.wire([[0,0,0],[10,0,0],[10,10,0],[0,10,0]], { closed: true })\nlet part1 = cad.nonPlanarFace(part0)\n`],
    ['makeSolid', `let part0 = cad.box(10, 10, 10)\nlet part1 = cad.makeSolid(part0)\n`],
    ['reverseSurfaceU', `${SQUARE_PROFILE}let part1 = cad.reverseSurfaceU(part0)\n`],
    ['outerWire', `${SQUARE_PROFILE}let part1 = cad.outerWire(part0)\n`],
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

describe('S4 曲面面族 — TS 级直连（L1 覆盖门禁）', () => {
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

  it('D1. makeSolid：闭合壳（box 拆壳）→ 实体，体积 1000', async () => {
    const kernel = getBrepApi()
    const box = kernel.makeBox(10, 10, 10) as unknown as BrepHandle
    const shell = kernel.getSubShapes(box as never, 'shell')[0] as unknown as BrepHandle
    const shellShape = fromBrep(solidToShape(getBrepApi(), shell), { solid: shell })
    const s = await makeSolid(shellShape)
    expect(volumeOf(s)).toBeCloseTo(1000, 3)
  })

  it('D2. makeSolid：已是 solid 的输入原样升实体（上游语义：return as-is）', async () => {
    const runtime = new CadRuntime(ports(), 'brep', { cad: createApiNamespaceWithEditorOps() })
    const result = await runtime.execute(`let part0 = cad.box(10, 10, 10)\n`)
    const box = result.outputs.get(asPartName('part0')) as Shape
    const s = await makeSolid(box)
    expect(volumeOf(s)).toBeCloseTo(1000, 3)
  })

  it('D3. outerWire：面 → 外环 kind=curve', async () => {
    const runtime = new CadRuntime(ports(), 'brep', { cad: createApiNamespaceWithEditorOps() })
    const result = await runtime.execute(SQUARE_PROFILE)
    const face = result.outputs.get(asPartName('part0')) as Shape
    const w = await outerWire(face)
    expect(kindOf(w)).toBe('curve')
    const b = bboxOf(w)
    expect(b.xmax - b.xmin).toBeCloseTo(10, 4)
  })

  it('D4. nonPlanarFace：闭合 wire → 面', async () => {
    const runtime = new CadRuntime(ports(), 'brep', { cad: createApiNamespaceWithEditorOps() })
    const result = await runtime.execute(
      `let part0 = cad.wire([[0,0,0],[10,0,0],[10,10,0],[0,10,0]], { closed: true })\n`,
    )
    const wire = result.outputs.get(asPartName('part0')) as Shape
    const f = await nonPlanarFace(wire)
    const b = bboxOf(f)
    expect(b.xmax - b.xmin).toBeCloseTo(10, 4)
  })
})
