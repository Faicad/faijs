/**
 * brepkit vs occt：草图拉伸产物的「面/边拓扑选择数据链」等价测试。
 *
 * 背景：端侧拾取（web / weapp 共用 viewer3d）只消费 ExecutionResult.topology.data
 * （SelectorRuntimeData）→ buildSelectorRuntimeMaps 重建 SelectorRuntime →
 * 拾取行号 rowIndex → naming 行 → captureTopoRef 造 EdgeTopoRef / FaceTopoRef。
 * 两个 BREP 引擎必须产出**同构且完整**的数据链，否则换内核即出现「面/边无法选择」。
 *
 * 本文件在两个引擎下各自执行用户真实 web 代码（cad.sketch + cad.extrude），
 * 断言数据链每个环节：面/边/引用行数、拾取 maps、pickData 完整性、naming 行数、
 * TopoRef 发射、proxy 几何缓冲。引擎切换为显式注册（registerBrepkitBrepEngine /
 * registerOcctBrepEngine + __resetEngineRegistriesForTests），文件级隔离，不改任何装配。
 *
 * Run: npx vitest run packages/tests/faijs/engine-compat/brepkit-selector-runtime.test.ts
 */
import { describe, it, expect } from 'vitest'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerBrepkitBrepEngine, BREPKIT_BREP_ENGINE_ID } from '@faicad/faijs/brep/engine/adapters/brepkit'
import { registerOcctBrepEngine, OCCT_BREP_ENGINE_ID } from '@faicad/faijs/brep/engine/adapters/occt'
import { __resetEngineRegistriesForTests } from '@faicad/faijs/brep/engine/registry'
import { buildSelectorRuntimeMaps } from '@faicad/faijs/topology/build-selector-runtime'
import { captureTopoRef } from '@faicad/faijs/topology/naming'
import type { SelectorRuntimeData } from '@faicad/faijs/topology/build-selector-runtime'
import type { PartNaming } from '@faicad/faijs/topology/naming'

/** 用户 web 端真实测试代码（UI 生成的 cad.sketch + cad.extrude）。 */
const WEB_CODE = `let part0 = cad.sketch({ shapes:[{kind:'rect', tag:'g1', w:26 * MM, d:34 * MM, cx:-6 * MM, cy:-8 * MM}], constraints:[], plane:'XY' })
let part1 = cad.extrude(part0, { length:10 * MM })`

interface PickChain {
  engineId: string
  faces: number
  edges: number
  references: number
  faceRowSize: number
  edgeRowSize: number
  facePickMissing: number
  edgePickMissing: number
  edgeNamingRows: number
  faceNamingRows: number
  edgeRefOk: boolean
  faceRefOk: boolean
  faceRefOrigin: string
  edgePositions: number
  edgeIndices: number
  edgeIds: number
}

async function pickChain(engineLabel: string): Promise<PickChain> {
  const runtime = createRuntime(createNodePorts(), 'brep', undefined, { execBackend: 'interpreter' })
  const result = await runtime.execute(WEB_CODE, { topology: 'auto' })
  expect(result.failedAt, `[${engineLabel}] execute 失败`).toBeUndefined()
  const topo = result.topology?.get('part1') ?? result.topology?.get('part0')
  expect(topo, `[${engineLabel}] topology 缺失（outputs=${[...(result.outputs?.keys() ?? [])].join(',')}）`).toBeTruthy()
  const data: SelectorRuntimeData = topo!.data
  const maps = buildSelectorRuntimeMaps(data)
  const naming = (result.naming?.get('part1') ?? result.naming?.get('part0')) as PartNaming | undefined

  const faceRefs = [...maps.faceReferenceByRowIndex.entries()]
  const edgeRefs = [...maps.edgeReferenceByRowIndex.entries()]
  const facePickMissing = faceRefs.filter(([, r]) => !r.pickData?.center || !(r.pickData?.triangleCount > 0)).length
  const edgePickMissing = edgeRefs.filter(([, r]) => !r.pickData?.center).length

  let edgeRefOk = false
  let faceRefOk = false
  let faceRefOrigin = ''
  if (naming && naming.edgeNaming.length > 0 && naming.faceNaming.length > 0) {
    try {
      edgeRefOk = captureTopoRef(naming.edgeNaming[0]).kind === 'edge'
    } catch {
      edgeRefOk = false
    }
    try {
      const f = captureTopoRef(naming.faceNaming[0])
      faceRefOk = f.kind === 'face'
      faceRefOrigin = JSON.stringify((f as { origin?: unknown }).origin ?? null)
    } catch {
      faceRefOk = false
    }
  }

  return {
    engineId: engineLabel,
    faces: data.faces.length,
    edges: data.edges.length,
    references: data.references.length,
    faceRowSize: maps.faceReferenceByRowIndex.size,
    edgeRowSize: maps.edgeReferenceByRowIndex.size,
    facePickMissing,
    edgePickMissing,
    edgeNamingRows: naming?.edgeNaming.length ?? 0,
    faceNamingRows: naming?.faceNaming.length ?? 0,
    edgeRefOk,
    faceRefOk,
    faceRefOrigin,
    edgePositions: data.proxy.edgePositions.length,
    edgeIndices: data.proxy.edgeIndices.length,
    edgeIds: data.proxy.edgeIds.length,
  }
}

/** 草图拉伸长方体（26×34×10，X 偏移 -6）的固有拓扑：6 面 / 12 条去重边 / 每面 2 个三角形。 */
function assertChain(c: PickChain): void {
  const tag = `[${c.engineId}]`
  expect(c.faces, `${tag} faces 行数`).toBe(6)
  expect(c.edges, `${tag} edges 行数`).toBe(12)
  expect(c.references, `${tag} references 行数`).toBeGreaterThanOrEqual(40)
  expect(c.faceRowSize, `${tag} faceReferenceByRowIndex size`).toBe(6)
  expect(c.edgeRowSize, `${tag} edgeReferenceByRowIndex size`).toBe(12)
  expect(c.facePickMissing, `${tag} 面 references 缺 pickData`).toBe(0)
  expect(c.edgePickMissing, `${tag} 边 references 缺 pickData`).toBe(0)
  expect(c.edgeNamingRows, `${tag} naming.edgeNaming 行数`).toBe(12)
  expect(c.faceNamingRows, `${tag} naming.faceNaming 行数`).toBe(6)
  expect(c.edgeRefOk, `${tag} edgeNaming[0] → captureTopoRef 应产出 kind=edge`).toBe(true)
  expect(c.faceRefOk, `${tag} faceNaming[0] → captureTopoRef 应产出 kind=face`).toBe(true)
  expect(c.edgePositions, `${tag} proxy.edgePositions 长度`).toBeGreaterThan(0)
  expect(c.edgeIndices, `${tag} proxy.edgeIndices 长度`).toBeGreaterThan(0)
  expect(c.edgeIds, `${tag} proxy.edgeIds 数量`).toBe(12)
}

describe('brepkit vs occt：草图拉伸产物拾取数据链等价（端侧面/边选择前提）', () => {
  it(`brepkit（${BREPKIT_BREP_ENGINE_ID}）— 用户代码 → 完整拾取数据链`, async () => {
    await registerBrepkitBrepEngine()
    const c = await pickChain('brepkit')
    assertChain(c)
    // 面身份必须带 origin（跨内核可移植的身份来源；edge 身份在 hint/faces 上，与 occt 对照断言）。
    expect(c.faceRefOrigin).toContain('s')
  }, 120000)

  it(`occt（${OCCT_BREP_ENGINE_ID}）— 对照：同构完整`, async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const c = await pickChain('occt')
    assertChain(c)
  }, 120000)
})
