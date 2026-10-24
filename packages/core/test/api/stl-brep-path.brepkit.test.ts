/**
 * 回归：STL 导入走 BREP 路径（kernel.importStl + weld 缝合）后，特征操作全链路可用。
 *
 * 真机 bug（2026-10-17）：weapp 导入 cube.stl 后圆角报
 * 「edge naming has no adjacent-face lineage (mesh limitation)」，钻孔/平面分割
 * 同样报错 → 一度误判为 brepkit 缺陷、考虑隐藏 STL/3MF 导入。
 *
 * 根因（实证）：**问题在路径选择，不在 brepkit 能力**。
 * - STL 原本永远走 mesh 路径（`load.ts` 静态分派：stl 不在 CAD_FORMATS），mesh 路径的
 *   网格实体（importIndexedMesh→weld→unify）边没有邻接面 lineage → 圆角选不了边；
 *   钻孔/分割的 mesh 实现声明 `meshEngines:['manifold']`，brepkit 不是 manifold → 全拒。
 * - brepkit L1 面自带 `importStl`（STL → 真 BREP 实体）与 `weldShellsAndFaces`。
 *   importStl 的实体逐面独立、边不共享；用网格后端的 weld 原语把共享边缝起来后，
 *   **每条边都有两个邻接面** → 圆角可选边；钻孔/分割走 BREP 实现（内核布尔 cut）→ 全通。
 *
 * 修复：`load.ts` 静态分派把 `stl` 纳入 BREP 路径（useBrep 判定 + importStl→weld→unify
 * 分支）。web 端（OCCT importStl，同一 L1 接口面）同样受益。
 *
 * 装配与 weapp 同构（brepkit BREP 引擎 + brepkit mesh 后端 + mode 'auto'）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { createEditorRuntime } from '../support/editor-ops'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { ensureBrepkitMeshBackend } from '../../src/brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../../src/brepkit-kernel/brepkitKernel'
import { resetBrepkitWasm } from '../../src/brepkit-kernel/brepkitWasm'

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

const stlPath = fileURLToPath(new URL('../../../fixtures/data/cube-10x5x5.stl', import.meta.url))

function stlPorts(): HostPorts {
  const bytes = toArrayBuffer(readFileSync(stlPath))
  return {
    events: { emit: () => undefined },
    assets: {
      resolveByKey: async () => ({ bytes }),
      resolveFile: async () => bytes,
      resolveUrl: async () => bytes,
    },
  } as unknown as HostPorts
}

describe('brepkit: STL 走 BREP 路径后特征操作全链路可用（白名单保留依据）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    disposeBrepkit()
    resetBrepkitWasm()
    await registerBrepkitBrepEngine()
    await ensureBrepkitMeshBackend()
  })
  afterAll(() => disposeBrepkit())

  it('load cube.stl → naming.source = brep，全部边都有邻接面 lineage（圆角可选边）', async () => {
    const runtime = createEditorRuntime(stlPorts(), 'auto')
    const base = await runtime.execute(`let part0 = cad.load({ file: 'cube-10x5x5.stl' })`)
    expect(base.failedAt, `load failed: ${JSON.stringify(base.failedAt)}`).toBeUndefined()

    const naming = base.naming?.get('part0' as never)
    expect(naming).toBeDefined()
    expect(naming!.source).toBe('brep')
    // 修复前（mesh 路径 / importStl 不缝合）：全部边 faces=null。
    // 修复后（importStl → weld → unify）：12 条边各带两个邻接面。
    const nullFaces = naming!.edgeNaming.filter((e) => e.faces === null)
    expect(nullFaces, `null-faces edges: ${JSON.stringify(nullFaces)}`).toHaveLength(0)
    expect(naming!.edgeNaming.length).toBe(12)
  })

  it('chamfer（圆角）：挑一条边走 BREP 链 → 成功（不再 E_TOPO_NOT_FOUND）', async () => {
    const runtime = createEditorRuntime(stlPorts(), 'auto')
    const base = await runtime.execute(`let part0 = cad.load({ file: 'cube-10x5x5.stl' })`)
    expect(base.failedAt).toBeUndefined()
    const naming = base.naming?.get('part0' as never)
    const row = naming!.edgeNaming.find((e) => e.faces !== null)!
    expect(row.faces).not.toBeNull()

    const edgeRef = { kind: 'edge', faces: row.faces, hint: row.hint }
    const c = await runtime.execute(
      `let part0 = cad.load({ file: 'cube-10x5x5.stl' })\n` +
        `let part1 = cad.chamfer(part0, { edges: [${JSON.stringify(edgeRef)}], partIndex: 0, type: 'equal', width: 1 })\n`,
    )
    expect(c.failedAt, `chamfer failed: ${JSON.stringify(c.failedAt)}`).toBeUndefined()
    expect(c.outputs.get('part1' as never)).toBeDefined()
  })

  it('fai_drill（钻孔）：BREP cut → 成功（不再 E_MESH_SOLID_UNSUPPORTED）', async () => {
    const runtime = createEditorRuntime(stlPorts(), 'auto')
    const d = await runtime.execute(
      `let part0 = cad.load({ file: 'cube-10x5x5.stl' })\n` +
        `let part1 = cad.fai_drill(part0, { diameter: 2, depth: 0, position: [0, 0, 5], direction: "normal", faceNormal: [0, 0, 1], holeType: "simple" })\n`,
    )
    expect(d.failedAt, `drill failed: ${JSON.stringify(d.failedAt)}`).toBeUndefined()
    expect(d.outputs.get('part1' as never)).toBeDefined()
  })

  it('fai_split（平面分割）：BREP split → 成功', async () => {
    const runtime = createEditorRuntime(stlPorts(), 'auto')
    const s = await runtime.execute(
      `let part0 = cad.load({ file: 'cube-10x5x5.stl' })\n` +
        `let { front, back } = cad.fai_split(part0, { cutMode: 'plane', normal: [0, 0, 1], offset: 0 })\n`,
    )
    expect(s.failedAt, `split failed: ${JSON.stringify(s.failedAt)}`).toBeUndefined()
  })

  it('fai_split（分离参数）：BREP 路径接受 separationRatio + separation', async () => {
    // 覆盖 BREP 分支的 `separationOffset` → `translateBrep` 整条链路：脚本面传参、
    // op 层换算、OCCT 平移都必须跑通（2026-10-24 取代原 `applyExplode`）。
    const runtime = createEditorRuntime(stlPorts(), 'auto')
    const s = await runtime.execute(
      `let part0 = cad.load({ file: 'cube-10x5x5.stl' })\n` +
        `let { front, back } = cad.fai_split(part0, { cutMode: 'plane', normal: [0, 0, 1], offset: 0, separationRatio: 0.02, separation: 1 })\n`,
    )
    expect(s.failedAt, `split with separation failed: ${JSON.stringify(s.failedAt)}`).toBeUndefined()
  })
})
