/**
 * projectedges-contract — occt projectEdges 返回结构防回归（wrapup A 案留档）
 *
 * GOTCHA: occt-wasm 的 projectEdges 返回 6 组 **compound 数字 id**
 * （visibleSharp/visibleSmooth/visibleOutline/hidden*），不是对象句柄；
 * 0 = 空 compound。view-projection 依赖该契约：取边走
 * getSubShapes(compoundId, 'edge')，边几何走 curveParameters/
 * curvePointAtParam。防回归要点：结构、取边、曲线采样三者任一被引擎改动
 * 都会在本测试暴露。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { registerOcctBrepEngine } from '../../brep/engine/adapters/occt'
import { getBrepEngine } from '../../brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../runtime-state'
import { getBrepApi } from '../../brep/handle-bridge'

beforeAll(async () => {
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

describe('projectEdges contract', () => {
  it('box projectEdges visible/hidden compound ids', () => {
    const api = getBrepApi()
    const box = api.makeBox(10, 20, 30)
    const r = api.projectEdges(
      box,
      { x: 0, y: 0, z: 100 },
      { x: 0, y: 0, z: -1 },
      { x: 1, y: 0, z: 0 },
      true,
      0.1,
    ) as {
      visibleSharp: number
      visibleSmooth: number
      visibleOutline: number
      hiddenSharp: number
      hiddenSmooth: number
      hiddenOutline: number
    }
    expect(r.visibleSharp).toBeTypeOf('number')
    const allEdges: { compound: string; edge: number }[] = []
    for (const key of ['visibleSharp', 'visibleSmooth', 'visibleOutline', 'hiddenSharp', 'hiddenSmooth', 'hiddenOutline'] as const) {
      const id = r[key]
      if (typeof id !== 'number' || id === 0) continue
      const edges = api.getSubShapes(id as unknown as Parameters<typeof api.getSubShapes>[0], 'edge')
      for (const e of edges) allEdges.push({ compound: key, edge: e as unknown as number })
    }
    expect(allEdges.length, `edges=${allEdges.map((x) => `${x.compound}:${x.edge}`).join(',')}`).toBeGreaterThan(0)
    // curve params of first edge
    const first = allEdges[0]
    if (first === undefined) return
    const eh = first.edge as unknown as Parameters<typeof api.curveParameters>[0]
    const cp = api.curveParameters(eh)
    const p0 = api.curvePointAtParam(eh, cp.first)
    const p1 = api.curvePointAtParam(eh, cp.last)
    expect(p0).toBeTruthy()
    expect(p1).toBeTruthy()
    api.dispose(box)
  })

  it('HLR 输出边坐标 = (水平, 垂直, 深度≈0)：2D 投影直接取前两分量（view-projection GOTCHA）', () => {
    // front 视图（dir=-Y, xAxis=+X）：box 角点 0..20/0..30/0..40 —— 水平=x 分量
    // （0..20）、垂直=z 分量（0..40）、深度=y 分量（≈0，occt 已投影归零）。
    const api = getBrepApi()
    const box = api.makeBox(20, 30, 40)
    const r = api.projectEdges(
      box,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 1, y: 0, z: 0 },
      true,
      0.1,
    ) as { visibleSharp: number; visibleSmooth: number; visibleOutline: number; hiddenSharp: number; hiddenSmooth: number; hiddenOutline: number }
    const cid = r.visibleSharp as number
    const edges = api.getSubShapes(cid as unknown as Parameters<typeof api.getSubShapes>[0], 'edge')
    expect(edges.length).toBeGreaterThan(0)
    const first = edges[0]
    if (first === undefined) return
    const cp = api.curveParameters(first)
    const samples: [number, number, number][] = []
    for (let i = 0; i < 3; i += 1) {
      const t = cp.first + ((cp.last - cp.first) * i) / 2
      const p = api.curvePointAtParam(first, t)
      samples.push([p.x, p.y, p.z])
    }
    // 深度分量 ≈ 0（投影平面）；垂直分量非零（0..40 域内）
    const anyZeroDepth = samples.some((s) => Math.abs(s[2]) < 1e-6)
    const anyVertical = samples.some((s) => Math.abs(s[1]) > 1e-3)
    expect(anyZeroDepth, `samples=${JSON.stringify(samples)}`).toBe(true)
    expect(anyVertical, `samples=${JSON.stringify(samples)}`).toBe(true)
    api.dispose(box)
  })
})
