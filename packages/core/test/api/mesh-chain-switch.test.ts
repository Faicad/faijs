/**
 * mesh-chain-switch — 脚本级 mesh 链切换（2026-10-22 weapp mesh 链）
 *
 * 用户原话（2026-10-21/22）：
 * > 能否用mesh来处理这类模型，用brep其实没有意义。这样的人脸模型最终也只能三角化后
 * > 进行3D打印，不可能CNC加工。研究目前的mesh链的完成度，以及能否不用wasm来实现？
 * > 因为小程序没有空间容纳新的wasm。
 * > 实施，保证mesh链走通。而且要支持faijs脚本里直接切换mesh链。
 *
 * 本文件钉住 `cad.useMeshChain` 的契约与行为（宿主装配 = weapp worker 同款：
 * brepkit BREP 引擎 + brepkit 网格后端，mode='auto'——`faijs.worker.ts` 同口径）：
 *
 * 1. **mesh 链走通**：`cad.useMeshChain(true)` 后，sphere→scale3d→cylinder→subtract→
 *    union 的每条产物都是**网格零件**（网格实体句柄 + 注册表 + 近似拓扑 source='mesh'），
 *    三角载荷非空、体积有限正数——不是"跑通了就行"，几何是真的；布尔引擎 = 内核
 *    face-BOP（kernel.fuse/cut，2026-10-22 定论：三角形 CSG 对人脸近切触模型结构性
 *    不可愈合，E_MESH_SOLID_UNWELDABLE 已成历史）；
 * 2. **false 清除偏好**：`useMeshChain(false)` 后回到 auto（brep 实现优先）；
 * 3. **全量执行从零声明**：同一 runtime 第二次 execute 不带指令 → 回到 auto，
 *   旧偏好不泄漏（executeDirectText 起点重置）；
 * 4. **update 增量重放**：改/增 useMeshChain 之后的语句 → 前缀声明保留（仍是 mesh 链）；
 *   把 useMeshChain 语句删掉 → 重放回到 auto（executeDirectText 起点重置 + 陈旧
 *   mesh 拓扑条目由 collectDirectResult 重建为 brep，单一真源）；
 * 5. **auto 行为不变**：未声明时 sphere 走 brep（双引擎装配下）；
 * 6. **混链红线不变**：网格实体与 BREP 实体同处一次布尔 → E_MESH_SOLID_MIXED
 *   （静态门禁，绝不静默归约一侧）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { createEditorRuntime } from '../support/editor-ops'
import type { CadRuntime } from '../../src/cad-runtime/runtime'
import { asPartName } from '../../src/identity'
import { __resetEngineRegistriesForTests, getMeshSolidBackend } from '../../src/brep/engine/registry'
import { registerBrepkitBrepEngine, registerBrepkitMeshEngine } from '../../src/brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../../src/brepkit-kernel/brepkitKernel'
import { hasMeshFace, hasMeshSolid } from '../../src/shape'
import type { Shape } from '../../src/mesh/types'
import type { BrepHandle } from '../../src/brep/engine/types'

function portsFor(): HostPorts {
  return {
    events: { emit: () => undefined },
    assets: {
      resolveByKey: async () => { throw new Error('[test] no asset') },
      resolveFile: async () => { throw new Error('[test] resolveFile unused') },
      resolveUrl: async () => { throw new Error('[test] resolveUrl unused') },
    },
  } as unknown as HostPorts
}
const PORTS = () => portsFor()

/** 网格实体句柄 → 体积（经网格后端 L1 内核，测的是真几何）。 */
function volumeOf(runtime: CadRuntime, part: string): number {
  const backend = getMeshSolidBackend()
  expect(backend, 'mesh backend assembled').not.toBeNull()
  const handle = runtime.meshSolids.get(asPartName(part))
  expect(handle, `mesh solid handle for ${part}`).toBeDefined()
  return backend!.kernel.getVolume(handle as BrepHandle)
}

/** 断言产物是**网格零件**（身份 + 注册表句柄 + 近似拓扑三处一致）。 */
function expectMeshPart(runtime: CadRuntime, result: Awaited<ReturnType<CadRuntime['execute']>>, part: string): Shape {
  const shape = result.outputs.get(asPartName(part)) as Shape
  expect(hasMeshSolid(shape), `${part} stays a mesh solid`).toBe(true)
  expect(hasMeshFace(shape), `${part} is not a mesh-chain face`).toBe(false)
  expect(runtime.meshSolids.has(asPartName(part)), `${part} has a registry handle`).toBe(true)
  expect(result.brepChain.solidCache.has(asPartName(part)), `${part} never enters the BREP cache`).toBe(false)
  expect(result.topology?.get(asPartName(part))?.source, `${part} approximate topology`).toBe('mesh')
  return shape
}

/** 断言产物是**BREP 零件**（solidCache + source='brep'）。 */
function expectBrepPart(result: Awaited<ReturnType<CadRuntime['execute']>>, part: string): void {
  expect(result.brepChain.solidCache.has(asPartName(part)), `${part} enters the BREP cache`).toBe(true)
  expect(result.topology?.get(asPartName(part))?.source, `${part} brep topology`).toBe('brep')
}

const SWITCH_ON = 'cad.useMeshChain(true)'

describe('cad.useMeshChain 脚本级链切换（weapp 同款双引擎装配，mode=auto）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    await registerBrepkitMeshEngine()
  })
  afterAll(() => { disposeBrepkit() })

  it('mesh 链走通：useMeshChain(true) 后 sphere→scale3d→subtract→union 全是网格零件', async () => {
    const runtime = createEditorRuntime(PORTS(), 'auto')
    // 与 face.fai.js 同构的"人脸"链：head(scale3d) − 眼睛/嘴 → carved；再 union
    // 小部件（眼珠/瞳孔/鼻子）——真实 bench 场景（小体与雕刻面干净相交）。
    // 显式低细分（`segments: 32`，≈ 2k 面/球）：本测试钉的是**链语义与几何真实**，
    // 不是三角密度；内核布尔代价对密度超线性（探针实测 64 段 ≈ 8.2k 面/球 → 单链
    // 分钟级，无法进 CI）。真实密度/性能由 weapp bench 脚本（bench-face*.mjs）承担。
    const S = '32'
    const code = [
      SWITCH_ON,
      `const head = cad.sphere({ radius: 10, segments: ${S} })`,
      'const headS = cad.scale3d(head, { factor: [0.9, 1, 1.15] })',
      `const eL = cad.scale3d(cad.sphere({ radius: 2.4, segments: ${S} }), { factor: [1, 0.7, 1] })`,
      'const eL2 = cad.translate(eL, { offset: [-3.6, 8.0, 3.2] })',
      `const eR2 = cad.translate(cad.scale3d(cad.sphere({ radius: 2.4, segments: ${S} }), { factor: [1, 0.7, 1] }), { offset: [3.6, 8.0, 3.2] })`,
      `const mouth = cad.translate(cad.scale3d(cad.sphere({ radius: 1.6, segments: ${S} }), { factor: [2.2, 1.4, 0.55] }), { offset: [0, 8.2, -3.6] })`,
      'const carved = cad.subtract(headS, eL2, eR2, mouth)',
      `const ebL = cad.translate(cad.sphere({ radius: 1.5, segments: ${S} }), { offset: [-3.6, 8.2, 3.2] })`,
      `const ebR = cad.translate(cad.sphere({ radius: 1.5, segments: ${S} }), { offset: [3.6, 8.2, 3.2] })`,
      `const pL = cad.translate(cad.sphere({ radius: 0.55, segments: ${S} }), { offset: [-3.6, 9.6, 3.2] })`,
      `const pR = cad.translate(cad.sphere({ radius: 0.55, segments: ${S} }), { offset: [3.6, 9.6, 3.2] })`,
      'const nose = cad.translate(cad.cylinder({ radius: 0.5, height: 3.2, segments: 24 }), { offset: [0, 9.0, 0.5] })',
      'const face = cad.union(carved, ebL, ebR, pL, pR, nose)',
    ].join('\n')
    const result = await runtime.execute(code)
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    for (const part of ['head', 'headS', 'eL2', 'eR2', 'mouth', 'carved', 'ebL', 'ebR', 'pL', 'pR', 'nose', 'face']) {
      expectMeshPart(runtime, result, part)
    }
    // 几何是真的：三角载荷非空、体积有限正数；head 体积 ≈ 4/3·π·10³（±2% 网格近似）
    const shape = result.outputs.get(asPartName('face')) as Shape
    expect(shape.indices.length, 'union result has triangles').toBeGreaterThan(0)
    const v = volumeOf(runtime, 'face')
    expect(Number.isFinite(v), 'volume is finite').toBe(true)
    expect(v, 'face volume is positive').toBeGreaterThan(0)
    const vHead = volumeOf(runtime, 'head')
    expect(vHead).toBeGreaterThan(4.0e3)
    expect(vHead).toBeLessThan(4.4e3)
  }, 180_000)

  it('近重合面 union 如实产出有效实体：union(carved, head) 用 face-BOP 可成实（非静默坏几何）', async () => {
    const runtime = createEditorRuntime(PORTS(), 'auto')
    const S = '32'
    const code = [
      SWITCH_ON,
      `const head = cad.sphere({ radius: 10, segments: ${S} })`,
      'const headS = cad.scale3d(head, { factor: [0.9, 1, 1.15] })',
      'const tool = cad.cylinder({ radius: 2.4, height: 20, centered: true, segments: 24 })',
      'const carved = cad.subtract(headS, tool)',
      // 与 carved 大面积重合面的 union（mesh CSG 的 grazing/imprint 病态）。2026-10-22
      // 实测：三角形 CSG（meshBoolean）在此输出真实开洞（boundary=546 自由边、全容差
      // 不可愈合 → E_MESH_SOLID_UNWELDABLE）；mesh 链布尔引擎已定为内核 face-BOP
      // （kernel.fuse/cut，解析 GFA）→ 全程 isValid=true，成实。这里钉住"如实成实"。
      'const add = cad.union(carved, head)',
    ].join('\n')
    const result = await runtime.execute(code)
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    for (const part of ['head', 'headS', 'carved', 'add']) {
      expectMeshPart(runtime, result, part)
    }
    // 几何是真的：union 填掉钻孔。界用运行时实测体积算：∪ 的体积 ≥ 每个分量，
    // ≤ 分量之和（head ≈ 4.19e3，headS ≈ 4.34e3；head 在 x 向比 headS 宽，∪ 约 4.55e3）。
    const v = volumeOf(runtime, 'add')
    const vHeadS = volumeOf(runtime, 'headS')
    expect(Number.isFinite(v), 'volume is finite').toBe(true)
    expect(v).toBeGreaterThan(vHeadS)
    expect(v).toBeLessThan(vHeadS + volumeOf(runtime, 'head') + 1e-6)
  }, 180_000)

  it('useMeshChain(false) 清除偏好 → 后续语句回到 auto（brep 实现优先）', async () => {
    const runtime = createEditorRuntime(PORTS(), 'auto')
    const code = [
      SWITCH_ON,
      'const a = cad.sphere({ radius: 10 })',
      'cad.useMeshChain(false)',
      'const b = cad.box(10, 10, 10, { centered: true })',
    ].join('\n')
    const result = await runtime.execute(code)
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, result, 'a')
    expectBrepPart(result, 'b')
  })

  it('全量执行从零声明：第二次 execute 不带指令 → 回到 auto，偏好不泄漏', async () => {
    const runtime = createEditorRuntime(PORTS(), 'auto')
    const withSwitch = [SWITCH_ON, 'const a = cad.sphere({ radius: 10 })'].join('\n')
    const r1 = await runtime.execute(withSwitch)
    expect(r1.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, r1, 'a')

    const withoutSwitch = 'const b = cad.box(10, 10, 10, { centered: true })'
    const r2 = await runtime.execute(withoutSwitch)
    expect(r2.failedAt?.message ?? 'no failure').toBe('no failure')
    expectBrepPart(r2, 'b')
  })

  it('update 增量重放：前缀声明保留（改开关之后的语句仍走 mesh 链）', async () => {
    const runtime = createEditorRuntime(PORTS(), 'auto')
    const base = [SWITCH_ON, 'const head = cad.sphere({ radius: 10 })'].join('\n')
    await runtime.execute(base)

    // 在 useMeshChain 之后增一行 cylinder → 只重放新行；前缀（含开关）是权威
    const modified = [SWITCH_ON, 'const head = cad.sphere({ radius: 10 })', 'const tool = cad.cylinder({ radius: 2.4, height: 20, centered: true })'].join('\n')
    const r2 = await runtime.update(base, modified)
    expect(r2.failedAt?.message ?? 'no failure').toBe('no failure')
    expectMeshPart(runtime, r2, 'tool')
  })

  it('update 删掉 useMeshChain 语句 → 重放回到 auto（前缀扫描兜底）', async () => {
    const runtime = createEditorRuntime(PORTS(), 'auto')
    const base = [SWITCH_ON, 'const head = cad.sphere({ radius: 10 })'].join('\n')
    await runtime.execute(base)

    // 删掉第一行开关 → 新代码前缀不再声明偏好 → 清除；head 重放成 brep
    const deleted = ['const head = cad.sphere({ radius: 10 })'].join('\n')
    const r2 = await runtime.update(base, deleted)
    expect(r2.failedAt?.message ?? 'no failure').toBe('no failure')
    expectBrepPart(r2, 'head')
  })

  it('auto 行为不变：未声明时 sphere 走 brep（双引擎装配下）', async () => {
    const runtime = createEditorRuntime(PORTS(), 'auto')
    const result = await runtime.execute('const a = cad.sphere({ radius: 10 })')
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expectBrepPart(result, 'a')
  })

  it('混链红线：网格实体 + BREP 实体同一次布尔 → E_MESH_SOLID_MIXED（静态门禁）', async () => {
    const runtime = createEditorRuntime(PORTS(), 'auto')
    const code = [
      'const b = cad.box(10, 10, 10, { centered: true })', // auto → brep
      SWITCH_ON,
      'const a = cad.sphere({ radius: 5 })',                 // mesh solid
      'const c = cad.subtract(b, a)',                        // 混链 → 必须静态报错
    ].join('\n')
    const result = await runtime.execute(code)
    expect(result.failedAt).toBeDefined()
    expect(result.failedAt!.message).toMatch(/E_MESH_SOLID_MIXED/)
  })
})
