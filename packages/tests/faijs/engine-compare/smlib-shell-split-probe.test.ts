/**
 * smlib shell/split 缺陷探针（用户报：①抽壳默认把长方体外表圆角；②平面分割后破面）
 *
 * 双引擎（occt vs smlib）跑同一脚本，对比体积/面积/包围盒/三角数/面数。
 * 探针输出观测，不设断言（先取证，再决定修法）。
 *
 * Run: Set-Location packages/tests; npx vitest run faijs/engine-compare/smlib-shell-split-probe.test.ts
 */
import { describe, it, beforeAll } from 'vitest'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { registerSmlibBrepEngine } from '../../../core/src/brep/engine/adapters/smlib'
import { __resetEngineRegistriesForTests } from '../../../core/src/brep/engine/registry'
import { brepOf } from '../../../core/src/shape'
import { getBackends } from '../../../core/src/runtime-state'
import type { Shape } from '../../../core/src/mesh/types'

interface M {
  vol: number
  area: number
  tri: number
  faceGroups: number
  bbox: [number, number, number]
  ok: boolean
  failedAt: string | null
  faceCount: number
}

function computeMetrics(shape: Shape): M {
  const positions = shape.positions
  const indices = shape.indices
  let area = 0
  let vol = 0
  for (let t = 0; t < Math.floor(indices.length / 3); t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2]
    const x0 = positions[i0 * 3], y0 = positions[i0 * 3 + 1], z0 = positions[i0 * 3 + 2]
    const x1 = positions[i1 * 3], y1 = positions[i1 * 3 + 1], z1 = positions[i1 * 3 + 2]
    const x2 = positions[i2 * 3], y2 = positions[i2 * 3 + 1], z2 = positions[i2 * 3 + 2]
    const cx = (y1 - y0) * (z2 - z0) - (z1 - z0) * (y2 - y0)
    const cy = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0)
    const cz = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
    area += Math.hypot(cx, cy, cz) / 2
    vol += (x0 * (y1 * z2 - z1 * y2) + y0 * (z1 * x2 - x1 * z2) + z0 * (x1 * y2 - y1 * x2)) / 6
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]); minY = Math.min(minY, positions[i + 1]); minZ = Math.min(minZ, positions[i + 2])
    maxX = Math.max(maxX, positions[i]); maxY = Math.max(maxY, positions[i + 1]); maxZ = Math.max(maxZ, positions[i + 2])
  }
  return {
    vol, area, tri: Math.floor(indices.length / 3),
    faceGroups: shape.faceGroups ? Math.floor(shape.faceGroups.length / 3) : 0,
    bbox: [maxX - minX, maxY - minY, maxZ - minZ],
    ok: true, failedAt: null, faceCount: 0,
  }
}

async function runScript(code: string): Promise<M> {
  const runtime = createRuntime(createNodePorts(), 'brep')
  const res = await runtime.execute(code)
  if (res.failedAt) {
    return { vol: 0, area: 0, tri: 0, faceGroups: 0, bbox: [0, 0, 0], ok: false, failedAt: `${res.failedAt.callee}: ${res.failedAt.message}`, faceCount: 0 }
  }
  const names = [...res.outputs.keys()]
  const last = res.outputs.get(names[names.length - 1] as never) as Shape | undefined
  if (!last || !last.positions || last.positions.length === 0) {
    return { vol: 0, area: 0, tri: 0, faceGroups: 0, bbox: [0, 0, 0], ok: false, failedAt: 'no-shape-output', faceCount: 0 }
  }
  const m = computeMetrics(last)
  // 面枚举（当前内核 getSubShapes('face') 面数）
  try {
    const kernel = getBackends().kernel.brep as { getSubShapes?: (h: unknown, kind: string) => unknown[] }
    const h = brepOf(last)
    if (h !== undefined && kernel.getSubShapes) {
      m.faceCount = kernel.getSubShapes(h, 'face').length
    }
  } catch {
    m.faceCount = -1
  }
  return m
}

/** 同时度量脚本所有输出（如 splitByPlane 的 positive/negative） */
async function runScriptAll(code: string): Promise<Record<string, M>> {
  const runtime = createRuntime(createNodePorts(), 'brep')
  const res = await runtime.execute(code)
  const out: Record<string, M> = {}
  for (const [name, shape] of res.outputs as Map<string, Shape>) {
    if (!shape || !shape.positions || shape.positions.length === 0) {
      out[name] = { vol: 0, area: 0, tri: 0, faceGroups: 0, bbox: [0, 0, 0], ok: false, failedAt: 'no-shape-output', faceCount: 0 }
      continue
    }
    const m = computeMetrics(shape)
    try {
      const kernel = getBackends().kernel.brep as { getSubShapes?: (h: unknown, kind: string) => unknown[] }
      const h = brepOf(shape)
      if (h !== undefined && kernel.getSubShapes) m.faceCount = kernel.getSubShapes(h, 'face').length
    } catch {
      m.faceCount = -1
    }
    out[name] = m
  }
  return out
}

const SHELL_FULL = 'let p = cad.box(20*MM, 20*MM, 20*MM, { centered: true })\nlet s = cad.shell(p, { openFaces: [], thickness: 2 })'
const SHELL_TOP = 'let p = cad.box(20*MM, 20*MM, 20*MM, { centered: true })\nlet s = cad.shell(p, { openFaces: ">Z", thickness: 2 })'
const SHELL_THIN = 'let p = cad.box(30*MM, 20*MM, 10*MM, { centered: true })\nlet s = cad.shell(p, { openFaces: ">Z", thickness: 1 })'
const SHELL_TWO = 'let p = cad.box(20*MM, 20*MM, 20*MM, { centered: true })\nlet s = cad.shell(p, { openFaces: "|Z", thickness: 2 })'
const SPLIT = 'let p = cad.box(20*MM, 20*MM, 20*MM, { centered: true })\nlet { positive, negative } = cad.splitByPlane(p, { point: [0, 0, 5], normal: [0, 0, 1] })'
const SPLIT_SKEW = 'let p = cad.box(20*MM, 20*MM, 20*MM, { centered: true })\nlet { positive, negative } = cad.splitByPlane(p, { point: [2, 3, 4], normal: [1, 1, 0] })'

describe('smlib shell/split 缺陷探针（观测）', () => {
  beforeAll(async () => {
    await registerOcctBrepEngine()
  }, 120000)

  it('shell 全封闭薄壁：occt vs smlib', async () => {
    const a = await runScript(SHELL_FULL)
    __resetEngineRegistriesForTests()
    await registerSmlibBrepEngine()
    const b = await runScript(SHELL_FULL)
    console.log(`[shell-full] occt ${JSON.stringify(a)}`)
    console.log(`[shell-full] smlib ${JSON.stringify(b)}`)
    console.log(`  预期：20³ 盒厚 2 → 体积 5184，面积 6×平面（16×16×5）`)
  }, 120000)

  it('shell 移除顶面：occt vs smlib', async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const a = await runScript(SHELL_TOP)
    __resetEngineRegistriesForTests()
    await registerSmlibBrepEngine()
    const b = await runScript(SHELL_TOP)
    console.log(`[shell-top] occt ${JSON.stringify(a)}`)
    console.log(`[shell-top] smlib ${JSON.stringify(b)}`)
  }, 120000)

  it('shell 长条薄壁(30×20×10, 厚1, 去顶面)：occt vs smlib', async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const a = await runScript(SHELL_THIN)
    __resetEngineRegistriesForTests()
    await registerSmlibBrepEngine()
    const b = await runScript(SHELL_THIN)
    console.log(`[shell-thin] occt ${JSON.stringify(a)}`)
    console.log(`[shell-thin] smlib ${JSON.stringify(b)}`)
  }, 120000)

  it('shell 去上下两顶面(|Z)：occt vs smlib', async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const a = await runScript(SHELL_TWO)
    __resetEngineRegistriesForTests()
    await registerSmlibBrepEngine()
    const b = await runScript(SHELL_TWO)
    console.log(`[shell-two] occt ${JSON.stringify(a)}`)
    console.log(`[shell-two] smlib ${JSON.stringify(b)}`)
  }, 120000)

  it('splitByPlane Z=5：occt vs smlib', async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const a = await runScript(SPLIT)
    __resetEngineRegistriesForTests()
    await registerSmlibBrepEngine()
    const b = await runScript(SPLIT)
    console.log(`[split] occt ${JSON.stringify(a)}`)
    console.log(`[split] smlib ${JSON.stringify(b)}`)
    console.log(`  预期：两半体积和 ≈ 8000，各半 7 面（6 原面裁切 + 1 剖切面）`)
  }, 120000)

  it('splitByPlane 斜切(法向[1,1,0])：occt vs smlib', async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const a = await runScript(SPLIT_SKEW)
    __resetEngineRegistriesForTests()
    await registerSmlibBrepEngine()
    const b = await runScript(SPLIT_SKEW)
    console.log(`[split-skew] occt ${JSON.stringify(a)}`)
    console.log(`[split-skew] smlib ${JSON.stringify(b)}`)
  }, 120000)

  it('替代方案：半空间布尔交实现 Z=5 分割（smlib）', async () => {
    __resetEngineRegistriesForTests()
    await registerSmlibBrepEngine()
    const s =
      'let p = cad.box(20*MM, 20*MM, 20*MM, { centered: true })\n' +
      'let pos = cad.intersect(p, cad.box(20*MM, 20*MM, 5*MM, { point: [0, 0, 7.5] }))\n' +
      'let neg = cad.intersect(p, cad.box(20*MM, 20*MM, 15*MM, { point: [0, 0, -2.5] }))'
    const b = await runScriptAll(s)
    console.log(`[split-bool] smlib pos=${JSON.stringify(b['pos'])} neg=${JSON.stringify(b['neg'])}`)
    console.log(`  预期：pos(高5半)=2000, neg(高15半)=6000`)
  }, 120000)

  it('splitByPlane Z=5 逐半面数/度量（occt vs smlib）', async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const a = await runScriptAll(SPLIT)
    __resetEngineRegistriesForTests()
    await registerSmlibBrepEngine()
    const b = await runScriptAll(SPLIT)
    console.log(`[split-both] occt pos=${JSON.stringify(a['positive'])} neg=${JSON.stringify(a['negative'])}`)
    console.log(`[split-both] smlib pos=${JSON.stringify(b['positive'])} neg=${JSON.stringify(b['negative'])}`)
    console.log(`  预期：pos=2000/6面+剖面=7面/1200面积；neg=6000/7面/2000面积`)
  }, 120000)
})
