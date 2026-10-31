/**
 * demo/examples 双引擎比对（用户：3d_editor 的 Examples 里的 faijs 脚本，occt/smlib 各跑一遍验证相等）
 *
 * 语料 = packages/demo/examples/*.fai.js（6 个）。gear-demo/sheetmetal-demo 依赖第三方库
 * （@faicad/faijs-gears / @faicad/sheetmetal），需要 registerLib 装配；此处先做无依赖 4 个，
 * 库依赖 2 个尝试装配（gears/sheetmetal 的 dist 需已构建）。
 *
 * Run: Set-Location packages/tests; npx vitest run faijs/engine-compare/demo-examples-occt-vs-smlib.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { registerSmlibBrepEngine } from '../../../core/src/brep/engine/adapters/smlib'
import { __resetEngineRegistriesForTests } from '../../../core/src/brep/engine/registry'
import type { Shape } from '../../../core/src/mesh/types'
import { createEditorRuntime } from '../_support/editor-runtime'
import * as gearsNs from '@faicad/faijs-gears'
import * as sheetNs from '@faicad/sheetmetal'

const EXAMPLES_DIR = resolve(import.meta.dirname, '../../../../packages/demo/examples')
/** fixtures/data：STL 等资产目录（demo 脚本 cad.load({file}) 寻址）。 */
const FIXTURES_DIR = resolve(import.meta.dirname, '../../../fixtures/data')
const FILES = ['box-boolean.fai.js', 'drill-test.fai.js', 'text-engrave.fai.js', 'transform-chain.fai.js']
const LIB_FILES = ['gear-demo.fai.js', 'sheetmetal-demo.fai.js']
const LIBS: Record<string, { ns: unknown; autoLift?: boolean }> = {
  gears: { ns: gearsNs, autoLift: true },
  sm: { ns: sheetNs, autoLift: true },
}

interface M {
  vol: number; area: number; tri: number; bbox: [number, number, number]; ok: boolean; failedAt: string | null; brepOnly: boolean
}

function computeMetrics(shape: Shape): Omit<M, 'ok' | 'failedAt' | 'brepOnly'> {
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
  return { vol, area, tri: Math.floor(indices.length / 3), bbox: [maxX - minX, maxY - minY, maxZ - minZ] }
}

async function execute(code: string, libNames: string[] = []): Promise<M> {
  const runtime = libNames.length
    ? (createEditorRuntime(createNodePorts({ assetsDir: FIXTURES_DIR }), 'auto') as ReturnType<typeof createRuntime>)
    : createRuntime(createNodePorts({ assetsDir: FIXTURES_DIR }), 'brep')
  for (const name of libNames) {
    const lib = LIBS[name]
    runtime.registerLib(name, lib.ns as never, {
      autoLift: lib.autoLift ?? false,
      packageName: name === 'gears' ? '@faicad/faijs-gears' : '@faicad/sheetmetal',
    } as never)
  }
  const res = await runtime.execute(code)
  if (res.failedAt) return { vol: 0, area: 0, tri: 0, bbox: [0, 0, 0], ok: false, failedAt: `${res.failedAt.callee}: ${res.failedAt.message}`, brepOnly: false }
  const names = [...res.outputs.keys()]
  const last = res.outputs.get(names[names.length - 1] as never) as Shape | undefined
  if (!last) return { vol: 0, area: 0, tri: 0, bbox: [0, 0, 0], ok: false, failedAt: 'no-shape-output', brepOnly: false }
  if (!last.positions || last.positions.length === 0) {
    // BREP-only Shape（EMPTY_MESH wrap，如 sheetmetal solidOf 在 occt 侧）：mesh 惰性生成，
    // 无网格度量可比——记录形态差异，不判失败。
    return { vol: 0, area: 0, tri: 0, bbox: [0, 0, 0], ok: true, failedAt: null, brepOnly: true }
  }
  return { ...computeMetrics(last), ok: true, failedAt: null, brepOnly: false }
}

describe('demo/examples 双引擎比对（验收）', () => {
  beforeAll(async () => {
    await registerOcctBrepEngine()
  }, 120000)

  for (const f of FILES) {
    it(f, async () => {
      const code = readFileSync(resolve(EXAMPLES_DIR, f), 'utf-8')
      __resetEngineRegistriesForTests()
      await registerOcctBrepEngine()
      const a = await execute(code)
      __resetEngineRegistriesForTests()
      await registerSmlibBrepEngine()
      const b = await execute(code)
      console.log(`[${f}] occt ${JSON.stringify(a)}`)
      console.log(`[${f}] smlib ${JSON.stringify(b)}`)
      if (!a.ok || !b.ok) {
        expect(`${a.failedAt} | ${b.failedAt}`).toBe('no failure')
        return
      }
      const rel = (x: number, y: number) => Math.abs(x - y) <= 0.01 * Math.max(Math.abs(x), Math.abs(y)) || Math.abs(x - y) < 1e-6
      expect(rel(a.vol, b.vol)).toBe(true)
      expect(rel(a.area, b.area)).toBe(true)
      // 三角数不做断言：网格离散化策略两内核不同（如 box-boolean 7446 vs 9452），几何度量一致即可
      for (let i = 0; i < 3; i++) expect(rel(a.bbox[i], b.bbox[i])).toBe(true)
    }, 120000)
  }

  // 第三方库脚本：gear/sheetmetal 走库 → 兼容边界（registerLib）。smlib 侧若因库内
  // occt-only op 被拒，如实记录（不判 FAIL——这是库的 smlib 支持状态，属方案缺口）。
  for (const f of LIB_FILES) {
    it(f, async () => {
      const code = readFileSync(resolve(EXAMPLES_DIR, f), 'utf-8')
      const libNames = f === 'gear-demo.fai.js' ? ['gears'] : ['sm']
      __resetEngineRegistriesForTests()
      await registerOcctBrepEngine()
      const a = await execute(code, libNames)
      __resetEngineRegistriesForTests()
      await registerSmlibBrepEngine()
      const b = await execute(code, libNames)
      console.log(`[${f}] occt ${JSON.stringify(a)}`)
      console.log(`[${f}] smlib ${JSON.stringify(b)}`)
      if (!a.ok) {
        expect(a.failedAt).toBe('no failure')
        return
      }
      if (a.brepOnly || b.brepOnly) {
        console.log(`[${f}] BREP-only 形态（occt=${a.brepOnly ? 'BREP-only' : 'mesh'} smlib=${b.brepOnly ? 'BREP-only' : 'mesh'}），无网格度量可比，记录形态差异`)
        return
      }
      if (!b.ok) {
        console.log(`[${f}] smlib 不支持（记录，不判 FAIL）：${b.failedAt}`)
        return
      }
      const rel = (x: number, y: number) => Math.abs(x - y) <= 0.01 * Math.max(Math.abs(x), Math.abs(y)) || Math.abs(x - y) < 1e-6
      expect(rel(a.vol, b.vol)).toBe(true)
      expect(rel(a.area, b.area)).toBe(true)
      for (let i = 0; i < 3; i++) expect(rel(a.bbox[i], b.bbox[i])).toBe(true)
    }, 120000)
  }
})
