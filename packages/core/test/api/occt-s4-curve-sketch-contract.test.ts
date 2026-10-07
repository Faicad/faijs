/**
 * @vitest-environment node
 *
 * occt S4 曲线草图族 — 契约/边界测试（从 occt-s4-curve-sketch.test.ts 拆出）。
 *
 * 覆盖：
 *   B. 入参校验（半径/角度/点集/整数）→ 专用错误码；
 *   C. 平台身份：brepkit 下执行前报 E_BREP_UNSUPPORTED（D11-4）；
 *   D. TS 级直连：mesh-only 输入报 NO_BREP / E_MESH_UNSUPPORTED，而非穿透到 occt。
 *
 * 几何正例（A1-A12）见 occt-s4-curve-sketch.test.ts。
 *
 * Run: npx vitest run test/api/occt-s4-curve-sketch-contract.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import type { Shape } from '../../src/mesh/types'
import { __resetEngineRegistriesForTests, getBrepEngine } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'
import { curveDegreeElevate, curveIsPeriodic } from '../../src/api/curve-sketch'

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

describe('S4 曲线草图族 — 入参校验', () => {
  it('B. circleArc 半径 <= 0 / 角度非有限数 → 专用错误码', async () => {
    await useOcct()
    const r = await exec('brep', `let part0 = cad.circleArc([0,0,0],[0,0,1],-1,0,90)\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_CIRCLEARC_BAD_RADIUS/)
    const a = await exec('brep', `let part0 = cad.circleArc([0,0,0],[0,0,1],5,0,'x')\n`)
    expect(JSON.stringify(a.failedAt)).toMatch(/E_CIRCLEARC_BAD_ANGLE/)
  })

  it('B. ellipseEdge minor > major → E_ELLIPSEEDGE_BAD_RADII（gp_Elips 约束）', async () => {
    await useOcct()
    const r = await exec('brep', `let part0 = cad.ellipseEdge([0,0,0],[0,0,1],5,10)\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_ELLIPSEEDGE_BAD_RADII/)
  })

  it('B. tangentArc 零切向 → E_TANGENTARC_BAD_TANGENT', async () => {
    await useOcct()
    const r = await exec('brep', `let part0 = cad.tangentArc([0,0,0],[0,0,0],[5,5,0])\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_TANGENTARC_BAD_TANGENT/)
  })

  it('B. approximatePoints 点数 < 2 → E_APPROXIMATEPOINTS_BAD_POINTS', async () => {
    await useOcct()
    const r = await exec('brep', `let part0 = cad.approximatePoints([[0,0,0]])\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_APPROXIMATEPOINTS_BAD_POINTS/)
  })

  it('B. curveDegreeElevate 非正整数 → E_CURVEDEGREEELEVATE_BAD_STEP', async () => {
    await useOcct()
    const r = await exec('brep', `let part0 = cad.edge([0,0,0],[1,0,0])\nlet part1 = cad.curveDegreeElevate(part0, 1.5)\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_CURVEDEGREEELEVATE_BAD_STEP/)
  })
})

describe('S4 曲线草图族 — 平台身份（brepkit 下执行前静态拒绝，D11-4）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
  }, 120000)

  /** 各 op 的最小调用形态（brepkit 下在触碰内核前即被拒，参数只需过 parse）。 */
  const CALLS: Array<[string, string]> = [
    ['edge', `let part0 = cad.edge([0,0,0],[1,0,0])\n`],
    ['circleArc', `let part0 = cad.circleArc([0,0,0],[0,0,1],5,0,90)\n`],
    ['ellipseEdge', `let part0 = cad.ellipseEdge([0,0,0],[0,0,1],10,5)\n`],
    ['ellipseArc', `let part0 = cad.ellipseArc([0,0,0],[0,0,1],10,5,0,90)\n`],
    ['tangentArc', `let part0 = cad.tangentArc([0,0,0],[1,0,0],[5,5,0])\n`],
    ['approximatePoints', `let part0 = cad.approximatePoints([[0,0,0],[5,3,0],[10,0,0]])\n`],
    ['interpolateWithTangents', `let part0 = cad.interpolateWithTangents([[0,0,0],[5,3,0],[10,0,0]],[1,0,0],[1,0,0])\n`],
    ['curveDegreeElevate', `let part0 = cad.wire([[0,0,0],[1,0,0]])\nlet part1 = cad.curveDegreeElevate(part0, 1)\n`],
    ['curveKnotInsert', `let part0 = cad.wire([[0,0,0],[1,0,0]])\nlet part1 = cad.curveKnotInsert(part0, 0.5, 1)\n`],
    ['curveKnotRemove', `let part0 = cad.wire([[0,0,0],[1,0,0]])\nlet part1 = cad.curveKnotRemove(part0, 0.5, 1e-3)\n`],
    ['curveIsPeriodic', `let part0 = cad.wire([[0,0,0],[1,0,0]])\nlet part1 = cad.curveIsPeriodic(part0)\n`],
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

describe('S4 曲线草图族 — TS 级直连（L1 覆盖门禁 + vertex 入参形态）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const brep = await getBrepEngine()
    configureBackends({
      contractVersion: CONTRACT_VERSION,
      config: { mode: 'auto', brepCapabilities: brep.capabilities, brepEngineId: 'occt' },
      kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
      fonts: undefined,
      texture: undefined,
      assets: undefined,
      events: { emit: () => undefined },
    } as unknown as Backends)
  }, 120000)

  it('D. mesh-only 输入（无 BREP 柄）报 NO_BREP，而非穿透到 occt', async () => {
    const { solid } = await import('../../src/shape')
    const meshOnly = solid({ positions: new Float32Array([]), indices: new Uint32Array([]) })
    // defineOp 形态（curveDegreeElevate）：mesh-only 输入走 dispatch 无 mesh 实现 → E_MESH_UNSUPPORTED。
    await expect(curveDegreeElevate(meshOnly as Shape, 1)).rejects.toThrow(/E_MESH_UNSUPPORTED/)
    // 普通函数形态（curveIsPeriodic）：直连 brep 路径 → NO_BREP。
    expect(() => curveIsPeriodic(meshOnly as Shape)).toThrow(/E_CURVEISPERIODIC_NO_BREP/)
  })
})