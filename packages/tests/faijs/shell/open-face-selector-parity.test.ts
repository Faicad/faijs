/**
 * open-face-selector-parity — 抽壳"按选择器移除面"的双引擎逐值等价（含 `|Z` 回归）
 *
 * 钉住的缺陷（2026-10-28）：smlib 上 `cad.shell(p, { openFaces: "|Z", thickness: 2 })`
 * 直接 `E_OP_FAILED: memory access out of bounds`（wasm trap），而同一内核的
 * `L1 shell(solid, [faceA, faceB], …)` 对全部 15 种双面组合都正常。
 *
 * 真因不在抽壳，在**选择器解析**：`"|Z"` 是 ParallelDirSelector，需要面的外向法向
 * ⇒ `orientedFaceNormal` ⇒ `getBoundingBox(face)`，而 smlib 适配器把 SmFace* 喂给了
 * `SmApiBrepBoundingBox(const SmBrep*)`（C++ 类型混淆）→ trap；修好后再撞
 * `containsPoint` 未实现。两处都在适配器层修（见 smlibKernel.ts 的 faceHandles /
 * containsPoint 注释），本测试钉住**用户可见语义**：双引擎逐值相等。
 *
 * ⚠️ 与 smlib-shell-split-probe.test.ts 的分工：那个是**观测探针**（不设断言），
 * 本文件是**回归门禁**（逐值断言）。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs/brep/engine/adapters/occt'
import { registerSmlibBrepEngine } from '@faicad/faijs/brep/engine/adapters/smlib'
import { __resetEngineRegistriesForTests } from '@faicad/faijs/brep/engine/registry'
import { brepOf } from '@faicad/faijs/shape'
import { getBackends } from '@faicad/faijs/runtime-state'
import type { Shape } from '@faicad/faijs/mesh/types'

interface ShellMetrics {
  vol: number
  area: number
  tri: number
  bbox: [number, number, number]
  faceCount: number
  failedAt: string | null
}

/** 三角化体积/面积/包围盒 + 内核面数（与 probe 同口径，便于交叉核对）。 */
function metrics(shape: Shape): Omit<ShellMetrics, 'failedAt'> {
  const { positions, indices } = shape
  let area = 0
  let vol = 0
  for (let t = 0; t < Math.floor(indices.length / 3); t++) {
    const i0 = indices[t * 3]!, i1 = indices[t * 3 + 1]!, i2 = indices[t * 3 + 2]!
    const x0 = positions[i0 * 3]!, y0 = positions[i0 * 3 + 1]!, z0 = positions[i0 * 3 + 2]!
    const x1 = positions[i1 * 3]!, y1 = positions[i1 * 3 + 1]!, z1 = positions[i1 * 3 + 2]!
    const x2 = positions[i2 * 3]!, y2 = positions[i2 * 3 + 1]!, z2 = positions[i2 * 3 + 2]!
    const cx = (y1 - y0) * (z2 - z0) - (z1 - z0) * (y2 - y0)
    const cy = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0)
    const cz = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
    area += Math.hypot(cx, cy, cz) / 2
    vol += (x0 * (y1 * z2 - z1 * y2) + y0 * (z1 * x2 - x1 * z2) + z0 * (x1 * y2 - y1 * x2)) / 6
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]!); const y = positions[i + 1]!; const z = positions[i + 2]!
    minY = Math.min(minY, y); minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, positions[i]!); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z)
  }
  let faceCount = 0
  const kernel = getBackends().kernel.brep as { getSubShapes?: (h: unknown, kind: string) => unknown[] }
  const h = brepOf(shape)
  if (h !== undefined && kernel.getSubShapes) faceCount = kernel.getSubShapes(h, 'face').length
  return { vol, area, tri: Math.floor(indices.length / 3), bbox: [maxX - minX, maxY - minY, maxZ - minZ], faceCount }
}

async function runOn(engine: 'occt' | 'smlib', code: string): Promise<ShellMetrics> {
  __resetEngineRegistriesForTests()
  if (engine === 'occt') await registerOcctBrepEngine()
  else await registerSmlibBrepEngine()
  const rt = createRuntime(createNodePorts(), 'brep')
  const res = await rt.execute(code)
  if (res.failedAt) {
    return { vol: 0, area: 0, tri: 0, bbox: [0, 0, 0], faceCount: 0, failedAt: `${res.failedAt.callee}: ${res.failedAt.message}` }
  }
  const names = [...res.outputs.keys()]
  const last = res.outputs.get(names[names.length - 1] as never) as Shape | undefined
  if (!last?.positions?.length) {
    return { vol: 0, area: 0, tri: 0, bbox: [0, 0, 0], faceCount: 0, failedAt: 'no-shape-output' }
  }
  return { ...metrics(last), failedAt: null }
}

const BOX = 'let p = cad.box(20*MM, 20*MM, 20*MM, { centered: true })\n'
const shellCode = (openFaces: string): string => `${BOX}let s = cad.shell(p, { openFaces: ${JSON.stringify(openFaces)}, thickness: 2 })`

describe('抽壳开面选择器：occt vs smlib 逐值等价', () => {
  beforeAll(async () => { await registerOcctBrepEngine() }, 180000)

  // 期望值（20³ 盒、壁厚 2，解析可算）：
  //   去 1 面   → 内腔 16×16×(16+2 壁厚方向贯通到开口面) = 4608 → 8000−4608 = 3392
  //   去相对 2 面 → 内腔 16×16×20 贯通 = 5120 → 8000−5120 = 2880
  //   面数 11 = 6 外 + 5 内（开口面只剩一圈侧壁）；10 = 6 外 + 4 内
  const cases: [string, { vol: number; area: number; faceCount: number }][] = [
    ['>Z', { vol: 3392, area: 3552, faceCount: 11 }],
    ['<Z', { vol: 3392, area: 3552, faceCount: 11 }],
    ['|Z', { vol: 2880, area: 3168, faceCount: 10 }],
    ['|X', { vol: 2880, area: 3168, faceCount: 10 }],
  ]

  for (const [sel, want] of cases) {
    it(`openFaces "${sel}"：两引擎都不崩且逐值相等`, async () => {
      const occt = await runOn('occt', shellCode(sel))
      const smlib = await runOn('smlib', shellCode(sel))
      expect(occt.failedAt, `occt 执行失败：${occt.failedAt}`).toBeNull()
      // 回归点：修复前这里是 "shell: E_OP_FAILED: memory access out of bounds"
      expect(smlib.failedAt, `smlib 执行失败：${smlib.failedAt}`).toBeNull()

      expect(occt.vol).toBeCloseTo(want.vol, 6)
      expect(smlib.vol).toBeCloseTo(want.vol, 6)
      expect(smlib.area).toBeCloseTo(want.area, 6)
      expect(smlib.tri).toBe(occt.tri)
      expect(smlib.faceCount).toBe(want.faceCount)
      expect(smlib.faceCount).toBe(occt.faceCount)
      for (let i = 0; i < 3; i++) expect(smlib.bbox[i]).toBeCloseTo(occt.bbox[i]!, 6)
    }, 180000)
  }

  it('全封闭抽壳：smlib = 向内薄壁实体（12 面，3904）；occt 当前是内腔体（已知差异，见分析文档）', async () => {
    // openFaces 空数组字面量（不是字符串 "[]"：那是选择器表达式，会被语法层拒绝）
    const closed = `${BOX}let s = cad.shell(p, { openFaces: [], thickness: 2 })`
    const smlib = await runOn('smlib', closed)
    const occt = await runOn('occt', closed)
    expect(smlib.failedAt).toBeNull()
    expect(smlib.vol).toBeCloseTo(3904, 6) // 8000 − 16³
    expect(smlib.area).toBeCloseTo(3936, 6) // 6×20² + 6×16²
    expect(smlib.faceCount).toBe(12) // 外面 6 + 内面 6
    // occt 侧行为由 occt-wasm 决定（空移除面 → 向内 offset 体 4096），不在本测试的
    // 修复范围；此处只钉"两引擎不同"，防止将来差异被静默当成等价。
    expect(occt.vol).not.toBeCloseTo(smlib.vol, 3)
  }, 180000)
})
