/**
 * engine-switch-smlib — smlib（usd-brep SM_API）第三 BREP 引擎 P1 验收
 *
 * 方案文档 §6 P1 验收："engine-switch 测试可在 smlib 会话下建 box/union 并出 mesh"。
 * 与 engine-switch.test.ts 同构：同一段 faijs 脚本、同一个 runtime 执行路径
 * （registry → ensureBrepChain → api → brep ops），只是注册 smlib 引擎。
 *
 * P1 能力面：生命周期、图元、布尔（副本化）、变换、测量、meshShape/wireframe、
 * getSubShapes（face/edge）。本测试覆盖验收锚 + 红线验证：
 * - meshShape 的 faceGroups face hash 与 getSubShapes('face') 的 subShapeHashes 同源
 *   （方案文档 §4.4：同一 SmFace* 指针 → 同一 hash，拓扑提取可回查）；
 * - 布尔副本化后用户句柄（part0/part1）仍可用（SmApiBoolean* 原地消耗式已隔离）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { ExecutionResult } from '../../../src/cad-runtime/runtime'
import type { HostPorts } from '../../../src/cad-runtime/ports'
import { asPartName } from '../../../src/identity'
import { __resetEngineRegistriesForTests, getActiveBrepEngineId } from '../../../src/brep/engine/registry'
import { registerSmlibBrepEngine, SMLIB_BREP_ENGINE_ID } from '../../../src/brep/engine/adapters/smlib'
import { createEditorRuntime } from '../../support/editor-ops'

/** 同一段 faijs 脚本：构造（box×2）→ 布尔（union）→ 显式保留 part0。 */
const SCRIPT = `let part0 = cad.box(10, 20, 30)
let part1 = cad.box(5, 5, 5, { at: [10, 10, 10] })
let part2 = cad.union(part0, part1)
part0.keep()
`

/** 简化宿主端口（box/union 不依赖 assets/fonts）。 */
function createNodePorts(): HostPorts {
  return { events: { emit: () => undefined } }
}

async function runWithEngine(): Promise<ExecutionResult> {
  __resetEngineRegistriesForTests()
  await registerSmlibBrepEngine()
  expect(getActiveBrepEngineId()).toBe(SMLIB_BREP_ENGINE_ID)
  const runtime = createEditorRuntime(createNodePorts(), 'brep')
  return runtime.execute(SCRIPT)
}

describe('smlib 引擎（第三 BREP 引擎，P1 内核桥验收）', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('box+union 成功 → ≥2 brepSolids + part2 meshShape 出 faceGroups', async () => {
    const result = await runWithEngine()
    expect(result.failedAt).toBeUndefined()
    expect(result.brepSolids).toBeDefined()
    // union 消费输入；part0 由独立声明保留 → part0 + part2
    expect(result.brepSolids!.size).toBeGreaterThanOrEqual(2)
    const entry = result.brepSolids!.get(asPartName('part2'))
    expect(entry).toBeDefined()
    const solid = entry!.solid

    // 测量（P1 面）：union 体积 > 单个 box（含重叠区容差）
    const vol = entry!.kernel.getVolume(solid)
    const vBox0 = 10 * 20 * 30 // 6000
    const vBox1 = 5 * 5 * 5 // 125
    expect(vol).toBeGreaterThan(vBox0)
    expect(vol).toBeLessThanOrEqual(vBox0 + vBox1 + 1e-6)

    // meshShape（P1 面）：非空网格 + faceGroups
    const mesh = entry!.kernel.meshShape(solid)
    expect(mesh.vertexCount).toBeGreaterThan(0)
    expect(mesh.triangleCount).toBeGreaterThan(0)
    expect(mesh.faceCount).toBeGreaterThan(0)
    expect(mesh.faceGroups!.length).toBe(mesh.faceCount! * 3)

    // 红线：faceGroups 的面 hash 与 getSubShapes('face') 的 subShapeHashes 同源
    const faces = entry!.kernel.getSubShapes(solid, 'face')
    expect(faces.length).toBe(mesh.faceCount)
    const faceHashes = entry!.kernel.subShapeHashes(solid, 'face', 2147483647)
    expect(faceHashes.length).toBe(faces.length)
    // faceGroups 里的 hash 集合 ⊆ subShapeHashes 集合（同指针同 hash）
    const groupHashes = new Set<number>()
    for (let i = 0; i < mesh.faceCount!; i++) groupHashes.add(mesh.faceGroups![i * 3 + 2])
    for (const h of groupHashes) expect(faceHashes).toContain(h)
  })

  it('布尔副本化：part0/part1 句柄在 union 后仍可查询（未被内核消耗）', async () => {
    const result = await runWithEngine()
    const entry0 = result.brepSolids!.get(asPartName('part0'))
    expect(entry0).toBeDefined()
    // part0 原 box：体积仍 6000（SmApiBoolean* 的 a 原地消耗已被副本化隔离）
    expect(entry0!.kernel.getVolume(entry0!.solid)).toBeCloseTo(6000, 3)
  })
})
