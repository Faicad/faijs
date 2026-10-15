/**
 * 回归：多实体 STEP 导入后，**每个成员**的每条边都必须有邻接面 lineage。
 *
 * 真机 bug：导入 Cube334.step（2 个 cube）后，选成员2 的边倒角报
 * 「edge naming has no adjacent-face lineage (mesh limitation)」。
 *
 * 根因：brepkit importStep 多实体分支 `compoundOf(solids)` 没对每个成员 solid
 * 调 markSolid。于是 buildCompoundTopologyRuntime 枚举成员面后（面号进 derivedFaces），
 * 再对该成员调 getSubShapes(memberSolid,'edge') 时，isFaceLike 误判成立（成员号
 * 撞面号、又不在 knownSolids）→ 走 getFaceEdges 只回一个面的 4 条边，且这些边的
 * faceCount=0 → edgeNaming.faces=null。修复：compoundOf(markSolids(solids))。
 *
 * 用真实 Cube334.step（packages/fixtures/data/Cube334.step）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { createEditorRuntime } from '../support/editor-ops'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../../src/brepkit-kernel/brepkitKernel'
import { resetBrepkitWasm } from '../../src/brepkit-kernel/brepkitWasm'

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

const cube334StepPath = fileURLToPath(new URL('../../../fixtures/data/Cube334.step', import.meta.url))

describe('brepkit: 多实体 STEP 每条边都有邻接面 lineage', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    disposeBrepkit()
    resetBrepkitWasm()
    await registerBrepkitBrepEngine()
  })
  afterAll(() => disposeBrepkit())

  it('Cube334.step: 所有 edgeNaming.faces 非 null（成员2 不再 faceCount=0）', async () => {
    const bytes = toArrayBuffer(readFileSync(cube334StepPath))
    const ports = {
      events: { emit: () => undefined },
      assets: {
        resolveByKey: async () => ({ bytes }),
        resolveFile: async () => bytes,
        resolveUrl: async () => bytes,
      },
    } as unknown as HostPorts
    const runtime = createEditorRuntime(ports, 'brep')
    const r = await runtime.execute(`let part0 = await cad.load({ file: 'Cube334.step' })`)
    expect(r.failedAt).toBeUndefined()
    const naming = r.naming?.get('part0' as never)
    expect(naming).toBeDefined()
    const nullEdges = naming!.edgeNaming.filter((e) => e.faces === null)
    // 修复前：成员2 的 4 条边全 null。修复后：闭合实体每条边都应有两邻面。
    expect(nullEdges, `null-faces edges: ${JSON.stringify(nullEdges)}`).toHaveLength(0)
    // 每个 cube 12 条边 × 2 成员 = 24 条（修复前只有 8 条）。
    expect(naming!.edgeNaming.length).toBeGreaterThanOrEqual(24)
  })

  it('Cube334.step: 挑出一条边能构造 EdgeTopoRef（不再 faces=null）', async () => {
    const bytes = toArrayBuffer(readFileSync(cube334StepPath))
    const ports = {
      events: { emit: () => undefined },
      assets: {
        resolveByKey: async () => ({ bytes }),
        resolveFile: async () => bytes,
        resolveUrl: async () => bytes,
      },
    } as unknown as HostPorts
    const runtime = createEditorRuntime(ports, 'brep')
    const base = await runtime.execute(`let part0 = await cad.load({ file: 'Cube334.step' })`)
    expect(base.failedAt).toBeUndefined()
    const naming = base.naming?.get('part0' as never)
    // 任意一条边都能构造 EdgeTopoRef（修复前成员2 的边 faces=null → captureTopoRef 抛错）。
    const row = naming!.edgeNaming.find((e) => e.faces !== null)!
    expect(row.faces).not.toBeNull()
    const edgeRef = { kind: 'edge', faces: row.faces, hint: row.hint }
    const c = await runtime.execute(
      `let part0 = await cad.load({ file: 'Cube334.step' })\n` +
        `let part1 = cad.chamfer(part0, { edges: [${JSON.stringify(edgeRef)}], partIndex: 0, type: 'equal', width: 1 })\n`,
    )
    expect(c.failedAt).toBeUndefined()
    expect(c.outputs.get('part1' as never)).toBeDefined()
  })
})
