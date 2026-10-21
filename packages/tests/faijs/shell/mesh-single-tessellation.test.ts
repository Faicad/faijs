/**
 * mesh-single-tessellation.test — I1「一份 mesh」：每个 BREP part 每次执行只三角化一次
 *
 * 方案：faijs/docs/plans/2026-10-20-face-identity-single-source-plan.md（P4 #3）
 *
 * 历史缺陷（D3）：`brepChain.meshShapeCache` 在生产路径从未被写入（唯一写入点用
 * 的键是 StmtId，而读取用的是 PartName），于是 `buildBrepTopology` 恒 miss → 拓扑
 * 对同一 solid **再三角化一次**，且兜底参数硬编码 2π/32。显式 `segments` 的曲线面
 * 因此"显示 mesh ≠ 拓扑 mesh"，面行区间错位。
 *
 * 本测试对内核 `meshShape` 打 spy：box 这类参数化基本体执行一次，应只调用 1 次
 * （显示三角化），拓扑构建命中 BREP_TESS 缓存，不再二次三角化。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { getActiveBrepEngine } from '@faicad/faijs/brep/engine/registry'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
import { createEditorRuntime } from '../_support/editor-runtime'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

async function countMeshShape(code: string): Promise<number> {
  const engine = await getActiveBrepEngine()
  const kernel = engine.primitives as BrepEngineApi
  const spy = vi.spyOn(kernel, 'meshShape')
  try {
    const rt = createEditorRuntime(createNodePorts(), 'brep')
    const res = await rt.execute(code)
    expect(res.failedAt, `执行失败: ${JSON.stringify(res.failedAt)}`).toBeUndefined()
    return spy.mock.calls.length
  } finally {
    spy.mockRestore()
  }
}

describe('I1 一次执行一份 mesh（BREP 参数化基本体）', () => {
  it('box 单语句：只三角化 1 次（拓扑复用显示 mesh 的 BREP_TESS）', async () => {
    const n = await countMeshShape('let part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })')
    expect(n).toBe(1)
  })

  it('box(segments:16) 显式段数：仍只三角化 1 次（显示与拓扑同源）', async () => {
    const n = await countMeshShape('let part0 = cad.cylinder(10 * MM, 20 * MM, { segments: 16 })')
    expect(n).toBe(1)
  })

  it('box + shell：每个 part 各一次（box 1 + shell 结果 1）', async () => {
    const n = await countMeshShape(
      'let part0 = cad.box(10 * MM, 20 * MM, 30 * MM)\nlet part1 = cad.shell(part0, { openFaces: ">X", thickness: 2 * MM })',
    )
    expect(n).toBe(2)
  })
})