/**
 * mesh-solid .fai.js tests — 用户场景的脚本面验收
 *
 * 场景（用户原话）：
 *
 * > 用户上传一个 STL 文件以后，我可以对识别出来的边加圆角，可以在识别出来的
 * > 平面上画草图拉伸出新的实体。
 *
 * 与 core 侧 `mesh-solid-scenario.test.ts` 的分工：那边把场景拆成 5 步、逐步断言
 * 中间态（拓扑读数 / 体积解析值 / 导出行为），宿主用的是 core 的测试宿主、STL 由
 * 测试内存构造；这里只跑**一份真实 .fai.js**，宿主是 `@faicad/faijs-extra` 的编辑器
 * 宿主，STL 是磁盘上的夹具 `packages/fixtures/data/cube-10x5x5.stl`（走 `assetsDir`
 * 端口读字节）。因此本文件钉的是**脚本面**这条链路，两点：
 *
 * 1. **识别可用**：宿主装配网格后端后，`cad.load` 读出的 STL 是**网格零件**
 *    （网格身份 + 近似拓扑），不是"无拓扑的裸网格"——后者会让所有下游网格 op 失去
 *    选择能力（`load` 的设计口径是报错好于掩盖）。
 * 2. **序号是真的**：`.fai.js` 里写死的选择器（边 9 / 面 4）必须对应宿主展示给用户
 *    的那条边 / 那张面。序号不是猜的——先读拓扑、按几何定位、再写进脚本；本文件把
 *    这个映射对同一份夹具逐条断言，拓扑序号口径一变就在这里炸，而不是让体积悄悄错。
 *    面序号是在**倒圆角之后**那份拓扑上读的：圆角新增一张面，序号是位置号、随改型
 *    重建（`a` 上的顶面是 6，`b` 上已是 4），宿主每改一次型就重读一次。
 *
 * 解析期望（夹具 20×10×10，x∈[−10,10]，y,z∈[−5,5]，体积 2000）：
 *
 *   倒圆角 r=1、棱长 20 → 磨掉 (1 − π/4)·r²·L = 4.2920
 *   顶面 4×6 草图拉 5   → +120
 *
 * Run: npx vitest run faijs/mesh-solid/mesh-solid.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeCode } from '@faicad/faijs/lang/statement-summary'
import { registerOcctBrepEngine, registerBrepkitMeshEngine, getMeshSolidBackend } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { hasMeshSolid } from '@faicad/faijs/shape'
import { asPartName } from '@faicad/faijs/identity'
import type { Shape } from '@faicad/faijs/mesh/types'
import { createEditorRuntime } from '../_support/editor-runtime'

beforeAll(async () => {
  await registerOcctBrepEngine()
  await registerBrepkitMeshEngine()
}, 120000)

const MESH_SOLID_DIR = fileURLToPath(new URL('.', import.meta.url))
const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/data', import.meta.url))

const SCRIPT_FILE = 'stl-detect-edit.fai.js'
const SCRIPT = readFileSync(join(MESH_SOLID_DIR, SCRIPT_FILE), 'utf-8')

/** 夹具 20×10×10 的解析量。 */
const BODY_VOLUME = 20 * 10 * 10                       // 2000
const EDGE_LENGTH = 20
const FILLET_RADIUS = 1
const FILLET_REMOVED = (1 - Math.PI / 4) * FILLET_RADIUS ** 2 * EDGE_LENGTH  // 4.2920
const BOSS_VOLUME = (2 - -2) * (3 - -3) * 5            // 4 × 6 × 5 = 120

/** 脚本写死的选择器：宿主读数 → 用户点选 → 写进脚本。 */
const FILLET_EDGE_ORDINAL = 9   // 在 `a`（刚 load 完）的拓扑上读
const SKETCH_FACE_ORDINAL = 4   // 在 `b`（倒圆角之后）的拓扑上读

const LOAD_STMT = "let a = await cad.load({ file: 'cube-10x5x5.stl' })"
const FILLET_STMT = `let b = cad.fillet(a, { edges: [${FILLET_EDGE_ORDINAL}], radius: 1 })`

interface FaceRow {
  ordinal?: number
  surfaceType?: string
  normal?: number[]
  center?: number[]
  area?: number
}
interface EdgeRow {
  ordinal?: number
  curveType?: string
  length?: number
  center?: number[]
  faceCount?: number
}

type Exec = Awaited<ReturnType<ReturnType<typeof createEditorRuntime>['execute']>>

function runtime(): ReturnType<typeof createEditorRuntime> {
  return createEditorRuntime(createNodePorts({ assetsDir: FIXTURES_DIR }), 'mesh')
}

/** 读某 part 的近似拓扑（宿主展示给用户的那份读数）。 */
function topologyOf(result: Exec, part: string): { faces: FaceRow[]; edges: EdgeRow[] } {
  const topo = result.topology?.get(asPartName(part))
  expect(topo, `topology for ${part}`).toBeDefined()
  return {
    faces: topo!.data.faces as unknown as FaceRow[],
    edges: topo!.data.edges as unknown as EdgeRow[],
  }
}

/** 网格零件句柄 → 体积（经网格后端的 L1 内核，与显示三角化同一份句柄）。 */
function volumeOf(rt: ReturnType<typeof createEditorRuntime>, part: string): number {
  const backend = getMeshSolidBackend()
  expect(backend, 'mesh backend assembled').not.toBeNull()
  const handle = rt.meshSolids.get(asPartName(part))
  expect(handle, `mesh solid handle for ${part}`).toBeDefined()
  return backend!.kernel.getVolume(handle!)
}

/** 断言产物是网格零件：有网格身份、不在 BREP cache 里、拓扑来源是 mesh。 */
function expectMeshPart(rt: ReturnType<typeof createEditorRuntime>, result: Exec, part: string): void {
  const shape = result.outputs.get(asPartName(part)) as Shape
  expect(shape, `output "${part}"`).toBeDefined()
  expect(hasMeshSolid(shape), `${part} is a mesh part`).toBe(true)
  expect(rt.meshSolids.has(asPartName(part)), `${part} has a mesh registry handle`).toBe(true)
  expect(result.brepChain.solidCache.has(asPartName(part)), `${part} is not in the BREP cache`).toBe(false)
  expect(result.topology?.get(asPartName(part))?.source, `${part} topology source`).toBe('mesh')
}

const NO_FAIL = (r: Exec): string => r.failedAt?.message ?? 'no failure'

describe('场景脚本 .fai.js：上传 STL → 识别边倒圆角 → 识别面草图 → 拉伸融合', () => {
  it(`${SCRIPT_FILE}: 解析通过`, () => {
    const summaries = analyzeCode(SCRIPT)
    expect(summaries.length).toBeGreaterThan(0)
    // 五步齐备：load → fillet → sketchOnFace → extrude → union
    expect(summaries.map((s) => s.callee)).toContain('load')
    expect(summaries.map((s) => s.callee)).toContain('sketchOnFace')
  })

  it(`宿主读出的是网格零件：6 面（100×2 + 200×4）、12 边（长 10×8 + 长 20×4）`, async () => {
    const rt = runtime()
    const result = await rt.execute(LOAD_STMT)
    expect(NO_FAIL(result)).toBe('no failure')
    expectMeshPart(rt, result, 'a')

    const { faces, edges } = topologyOf(result, 'a')
    expect(faces.length).toBe(6)
    expect(edges.length).toBe(12)
    // 逐面：plane，面积按 20×10×10 的解析值
    const areas = faces.map((f) => f.area).sort((x, y) => x! - y!)
    expect(areas).toEqual([100, 100, 200, 200, 200, 200])
    for (const f of faces) expect(f.surfaceType).toBe('plane')
    // 逐边：LINE、邻接两面，长度二值分布（8 条 10、4 条 20）
    for (const e of edges) {
      expect(e.curveType).toBe('LINE')
      expect(e.faceCount, '每条识别边邻接两面').toBe(2)
    }
    const lengths = edges.map((e) => e.length).sort((x, y) => x! - y!)
    expect(lengths).toEqual([10, 10, 10, 10, 10, 10, 10, 10, 20, 20, 20, 20])
  })

  it(`脚本写死的选择器是真的：边 ${FILLET_EDGE_ORDINAL} = 长 ${EDGE_LENGTH} 的底棱，面 ${SKETCH_FACE_ORDINAL} = 圆角后的 +Z 顶面`, async () => {
    // 序号即宿主读数里的 ordinal（`edges: [9]` / `face: 4` 解析的就是它）。
    // 两处序号读自**不同**的拓扑：倒圆角新增一张面，`b` 上的序号整体漂移。
    const rt = runtime()

    const loaded = await rt.execute(LOAD_STMT)
    expect(NO_FAIL(loaded)).toBe('no failure')
    const edge = topologyOf(loaded, 'a').edges.find((e) => e.ordinal === FILLET_EDGE_ORDINAL)
    expect(edge, `edge ordinal ${FILLET_EDGE_ORDINAL} on "a"`).toBeDefined()
    expect(edge!.length).toBeCloseTo(EDGE_LENGTH, 6)
    // 底棱：倒圆角不动 +Z 顶面，下一步才能在同一张顶面上画草图
    expect(edge!.center![2]).toBeCloseTo(-5, 6)

    const filleted = await rt.execute(`${LOAD_STMT}\n${FILLET_STMT}`)
    expect(NO_FAIL(filleted)).toBe('no failure')
    const afterFillet = topologyOf(filleted, 'b')
    expect(afterFillet.faces.length, '圆角新增一张面').toBe(7)
    expect(afterFillet.edges.length, '圆角把两条棱各切成两段').toBeGreaterThan(12)

    const face = afterFillet.faces.find((f) => f.ordinal === SKETCH_FACE_ORDINAL)
    expect(face, `face ordinal ${SKETCH_FACE_ORDINAL} on "b"`).toBeDefined()
    expect(face!.surfaceType).toBe('plane')
    expect(face!.normal![2]).toBeGreaterThan(0.9)
    expect(face!.area).toBeCloseTo(200, 6)
  })

  it('整脚本执行：产物仍是网格零件，体积 = 2000 − 4.2920 + 120', async () => {
    const rt = runtime()
    const result = await rt.execute(SCRIPT)
    expect(NO_FAIL(result)).toBe('no failure')

    // 倒圆角件 / 拉伸件 / 融合件：全部落在近似链上，没有一处滑进 BREP
    expectMeshPart(rt, result, 'b')
    expect(rt.meshSolids.has(asPartName('p')), '拉伸件带网格身份').toBe(true)
    expectMeshPart(rt, result, 'u')

    // 草图是网格链上的"面"，不是网格零件（还不能当实体用）
    const sketch = result.outputs.get(asPartName('s')) as Shape
    expect(sketch, 'sketch output "s"').toBeDefined()
    expect(hasMeshSolid(sketch), '草图是网格链面而不是网格零件').toBe(false)

    // 体积对解析值：圆角盒体 + 顶面 4×6 拉 5 的棱柱
    expect(volumeOf(rt, 'b')).toBeCloseTo(BODY_VOLUME - FILLET_REMOVED, 0)
    expect(volumeOf(rt, 'p')).toBeCloseTo(BOSS_VOLUME, 0)
    expect(volumeOf(rt, 'u')).toBeCloseTo(BODY_VOLUME - FILLET_REMOVED + BOSS_VOLUME, 0)

    // 融合件上仍能继续识别（拓扑随改型重建，而不是一次性的）
    const after = topologyOf(result, 'u')
    expect(after.faces.length).toBeGreaterThan(6)
    expect(after.edges.length).toBeGreaterThan(12)
  })

  it('改型产物可继续改型：按融合件的当前读数选一条整棱再倒圆角', async () => {
    const rt = runtime()
    const built = await rt.execute(SCRIPT)
    expect(NO_FAIL(built)).toBe('no failure')

    // 宿主重新读融合件的拓扑 → 用户点选（这里按几何挑：长出原盒体的那条 20 棱，
    // 且远离第一次圆角所在的 y=−5 角）
    const candidates = topologyOf(built, 'u').edges.filter(
      (e) => Math.abs((e.length ?? 0) - EDGE_LENGTH) < 1e-6 && (e.center?.[1] ?? 0) > 0,
    )
    expect(candidates.length, '融合件上仍有可选的整棱').toBeGreaterThan(0)
    const ordinal = candidates[0]!.ordinal

    const result = await rt.execute(`${SCRIPT}\nlet v = cad.fillet(u, { edges: [${ordinal}], radius: 0.5 })`)
    expect(NO_FAIL(result)).toBe('no failure')
    expectMeshPart(rt, result, 'v')
    // 只可能磨掉料
    expect(volumeOf(rt, 'v')).toBeLessThan(BODY_VOLUME - FILLET_REMOVED + BOSS_VOLUME)
  })
})
