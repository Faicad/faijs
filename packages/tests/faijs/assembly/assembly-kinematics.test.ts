/**
 * 装配运动副 e2e（J12，方案 §3.4 / §3.3 宿主消费）
 *
 * 锁定：
 * - J12a：含 joints+drive 的 `.fai.js` 重放 → `ExecutionResult.kinematics` 与库面直调
 *   `solveKinematics` 逐成员一致（position / rotation，rotation 为 faijs [x,y,z,w]）。
 * - J12b：module 与 direct 双执行器（R11② 同源纪律）产出同一 kinematics。
 * - J12c：仅 constraints（无 joints）→ `ExecutionResult.kinematics` 留空（undefined），
 *   不产生脏数据。
 *
 * 求解是纯位姿层（D1：装配不参与 BREP/mesh 链判定）→ 用 mesh 模式跑，无需 OCCT。
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createNodePorts } from '@faicad/faijs/node'
import { CadRuntime } from '@faicad/faijs-core/cad-runtime/runtime'
import { createApiNamespace } from '@faicad/faijs-core/api/api-namespace'
import { solveKinematics, type JointSpec, type KinematicsPose } from '@faicad/faijs-core/api/assembly/joints'
import { asPartName, type PartName } from '@faicad/faijs-core/identity'
import type { ExecutionResult } from '@faicad/faijs-core/cad-runtime/runtime'

/** 单 revolute：part0 固定，part1 绕原点 Z 轴转 90°（与 J5 同一场景）。 */
const FIXTURE = `let part0 = cad.box(60, 40, 10, { centered: true })
let part1 = cad.box(30, 30, 20, { centered: true })
let asm1 = cad.assembly({
  name: 'revolute-demo',
  members: [part0, part1],
  constraints: [{ type: 'fixed', part: 'part0' }],
  joints: [
    { type: 'revolute', parent: 'part0', child: 'part1',
      axis: { origin: [0, 0, 0], direction: [0, 0, 1] },
      min: -180, max: 180, value: 90 },
  ],
  drive: { part1: 90 },
})
asm1.solve()
`

/** 仅 constraints（无 joints）——J12c 对照组。 */
const NO_JOINTS = `let part0 = cad.box(60, 40, 10, { centered: true })
let part1 = cad.box(30, 30, 20, { centered: true })
let asm1 = cad.assembly({
  name: 'fixed-only',
  members: [part0, part1],
  constraints: [{ type: 'fixed', part: 'part0' }],
})
asm1.solve()
`

const cadNs = createApiNamespace()

function moduleRuntime(): CadRuntime {
  return new CadRuntime(createNodePorts(), 'mesh', { cad: cadNs })
}

function directRuntime(): CadRuntime {
  return new CadRuntime(createNodePorts(), 'mesh', { cad: cadNs }, { executor: 'direct' })
}

/** 与 FIXTURE 装配一致的库面直调预期（成员名全集恒定）。 */
function expectedKinematics(): Record<string, KinematicsPose> {
  const joints: JointSpec[] = [{
    type: 'revolute',
    parent: 'part0',
    child: 'part1',
    axis: { origin: [0, 0, 0], direction: [0, 0, 1] },
    min: -180,
    max: 180,
    value: 90,
  }]
  return solveKinematics(['part0', 'part1'], joints, { part1: 90 }).kinematics
}

function expectPoseClose(actual: KinematicsPose, expected: KinematicsPose, label: string): void {
  for (let c = 0; c < 3; c++) {
    expect(Math.abs(actual.position[c] - expected.position[c]), `${label}: position[${c}]`).toBeLessThan(1e-9)
  }
  for (let c = 0; c < 4; c++) {
    expect(Math.abs(actual.rotation[c] - expected.rotation[c]), `${label}: rotation[${c}]`).toBeLessThan(1e-9)
  }
}

/** ExecutionResult.kinematics（Map<PartName, pose>）与库面预期逐成员比对。 */
function expectKinematicsEqualsLibrary(
  result: ExecutionResult,
  expected: Record<string, KinematicsPose>,
): void {
  expect(result.failedAt).toBeUndefined()
  expect(result.kinematics).toBeDefined()
  for (const name of ['part0', 'part1']) {
    const pose = result.kinematics!.get(asPartName(name))
    expect(pose, `kinematics missing member ${name}`).toBeDefined()
    expectPoseClose(pose!, expected[name]!, name)
  }
}

const runtimes: CadRuntime[] = []

function track(rt: CadRuntime): CadRuntime {
  runtimes.push(rt)
  return rt
}

afterEach(() => {
  for (const rt of runtimes.splice(0)) rt.dispose()
})

describe('J12: ExecutionResult.kinematics（.fai.js 重放）', () => {
  it('J12a：e2e 重放的 kinematics 与库面直调 solveKinematics 逐成员一致', async () => {
    const rt = track(moduleRuntime())
    const result = await rt.execute(FIXTURE)
    expectKinematicsEqualsLibrary(result, expectedKinematics())
  })

  it('J12b：module 与 direct 双执行器产出同一 kinematics（R11② 同源纪律）', async () => {
    const m = track(moduleRuntime())
    const d = track(directRuntime())
    const moduleResult = await m.execute(FIXTURE)
    const directResult = await d.execute(FIXTURE)
    expectKinematicsEqualsLibrary(moduleResult, expectedKinematics())
    expectKinematicsEqualsLibrary(directResult, expectedKinematics())
    // 双链路逐成员完全相等（同库面 → 数值一致）
    for (const name of ['part0', 'part1'] as const) {
      const a = moduleResult.kinematics!.get(asPartName(name))!
      const b = directResult.kinematics!.get(asPartName(name))!
      expectPoseClose(a, b, `module vs direct: ${name}`)
    }
  })

  it('J12c：仅 constraints（无 joints）→ kinematics 字段留空（undefined）', async () => {
    const m = track(moduleRuntime())
    const d = track(directRuntime())
    const moduleResult = await m.execute(NO_JOINTS)
    const directResult = await d.execute(NO_JOINTS)
    expect(moduleResult.failedAt).toBeUndefined()
    expect(directResult.failedAt).toBeUndefined()
    expect(moduleResult.kinematics).toBeUndefined()
    expect(directResult.kinematics).toBeUndefined()
  })
})