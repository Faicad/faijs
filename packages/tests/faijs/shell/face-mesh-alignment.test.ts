/**
 * face-mesh-alignment.test — 面身份单源化 I2/I3 不变量（跨 BREP 基本体）
 *
 * 方案：faijs/docs/plans/2026-10-20-face-identity-single-source-plan.md（P4 #1）
 *
 * 抓的缺陷（D2）：box 的 `faceRanges` 被按"契约序 +X/−X/+Y/−Y/+Z/−Z"重排
 * 了显示 mesh 的 indices，而拓扑面表（`faceRuns.faceRow` ↔ 行）仍按内核枚举序
 * （−X/+X/−Y/+Y/−Z/+Z）。两套编号成对对调，于是「面行 4（−Z，命名 bottom）」
 * 的 triangleStart 指向显示 mesh 里 +Z 的那两个三角形 → 点顶面得到 role:'bottom'。
 *
 * 本测试用**显示 mesh 自身**现场算每个面行区间的面积/质心/法向，与行自己记录的
 * area/center/normal 对照——这是唯一能抓住"区间 ↔ 行"错位的断言（比对区间数值
 * 相等的自检会全绿地放过它，因为 faceRanges 与 faceRuns 的数值确实一致）。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import type { Shape } from '@faicad/faijs/mesh/types'
import type { SelectorRuntime } from '@faicad/faijs/browser'
import { createEditorRuntime } from '../_support/editor-runtime'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

interface TriGeom {
  area: number
  center: [number, number, number]
  normal: [number, number, number]
}

/** 用显示 mesh 的 positions/indices 现场算某段三角形的面积、质心、单位法向。 */
function triGeometry(shape: Shape, triStart: number, triCount: number): TriGeom {
  const { positions, indices } = shape
  let area = 0
  let cx = 0
  let cy = 0
  let cz = 0
  let nx = 0
  let ny = 0
  let nz = 0
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[(triStart + t) * 3]!
    const i1 = indices[(triStart + t) * 3 + 1]!
    const i2 = indices[(triStart + t) * 3 + 2]!
    const ax = positions[i0 * 3]!; const ay = positions[i0 * 3 + 1]!; const az = positions[i0 * 3 + 2]!
    const bx = positions[i1 * 3]!; const by = positions[i1 * 3 + 1]!; const bz = positions[i1 * 3 + 2]!
    const dx = positions[i2 * 3]!; const dy = positions[i2 * 3 + 1]!; const dz = positions[i2 * 3 + 2]!
    const ux = bx - ax; const uy = by - ay; const uz = bz - az
    const vx = dx - ax; const vy = dy - ay; const vz = dz - az
    const crossX = uy * vz - uz * vy
    const crossY = uz * vx - ux * vz
    const crossZ = ux * vy - uy * vx
    const len = Math.hypot(crossX, crossY, crossZ)
    const triArea = len / 2
    area += triArea
    // 面积加权质心（三角形质心 = 顶点均值）
    cx += ((ax + bx + dx) / 3) * triArea
    cy += ((ay + by + dy) / 3) * triArea
    cz += ((az + bz + dz) / 3) * triArea
    nx += crossX; ny += crossY; nz += crossZ
  }
  const inv = area > 0 ? 1 / area : 0
  const nlen = Math.hypot(nx, ny, nz) || 1
  return {
    area,
    center: [cx * inv, cy * inv, cz * inv],
    normal: [nx / nlen, ny / nlen, nz / nlen],
  }
}

/** 读一条 faceRun 行：[occurrenceRow, primitiveIndex, triangleStart, triangleCount, faceRow] */
function readRun(runs: Uint32Array, columns: string[]) {
  const stride = columns.length
  const idx = (name: string) => columns.indexOf(name)
  const rows: Array<{ triangleStart: number; triangleCount: number; faceRow: number }> = []
  for (let o = 0; o + stride <= runs.length; o += stride) {
    rows.push({
      triangleStart: runs[o + idx('triangleStart')]!,
      triangleCount: runs[o + idx('triangleCount')]!,
      faceRow: runs[o + idx('faceRow')]!,
    })
  }
  return rows
}

/** I2/I3：每条面行的 (triangleStart, triangleCount) 覆盖的三角形，其几何必须等于该行自记的几何。 */
function assertRowMeshAligned(shape: Shape, runtime: SelectorRuntime, label: string): void {
  const columns = runtime.proxy.faceRunColumns
  const runs = readRun(runtime.proxy.faceRuns, columns)
  expect(runs.length, `${label}: 面表应有面行`).toBeGreaterThan(0)

  for (const run of runs) {
    const row = runtime.faces[run.faceRow]
    expect(row, `${label}: faceRow ${run.faceRow} 越界`).toBeDefined()
    const g = triGeometry(shape, run.triangleStart, run.triangleCount)

    expect(g.area, `${label}: 行 ${run.faceRow} 区间面积 ≠ 行自记面积`).toBeCloseTo(row.area as number, 2)
    // 法向同向（点积 ≈ 1）只对**平面**成立：曲面行的 normal 是代表性/参数法向
    // （圆柱侧面行为轴向 [0,0,1]），与 mesh 三角形法向（径向）本不同定义。
    const rn = row.normal as number[] | null
    expect(rn, `${label}: 行 ${run.faceRow} 缺 normal`).not.toBeNull()
    if (row.surfaceType === 'plane') {
      const dot = g.normal[0] * rn![0] + g.normal[1] * rn![1] + g.normal[2] * rn![2]
      expect(dot, `${label}: 行 ${run.faceRow} 区间法向 ≠ 行自记法向`).toBeGreaterThan(0.99)
    }

    const rc = row.center as number[] | null
    if (rc) {
      const d = Math.hypot(g.center[0] - rc[0], g.center[1] - rc[1], g.center[2] - rc[2])
      expect(d, `${label}: 行 ${run.faceRow} 区间质心 ≠ 行自记质心`).toBeLessThan(1e-3)
    }
  }
}

const CASES: Array<{ name: string; code: string }> = [
  { name: 'box(centered)', code: 'let part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })' },
  { name: 'box(BASE)', code: 'let part0 = cad.box(10 * MM, 20 * MM, 30 * MM)' },
  { name: 'cylinder', code: 'let part0 = cad.cylinder(10 * MM, 20 * MM, { segments: 16 })' },
  { name: 'cone', code: 'let part0 = cad.cone(10 * MM, 0 * MM, 20 * MM, { segments: 16 })' },
]

describe('BREP 面表行 ↔ 显示 mesh 几何自洽（occt）', () => {
  for (const c of CASES) {
    it(`${c.name}: 每行区间与行自身几何一致`, async () => {
      const rt = createEditorRuntime(createNodePorts(), 'brep')
      const result = await rt.execute(c.code)
      expect(result.failedAt).toBeUndefined()
      const partName = [...result.outputs.keys()][0]!
      const shape = result.outputs.get(partName) as Shape
      expect(shape).toBeDefined()

      const runtime = rt.buildBrepTopology(partName)
      expect(runtime, `${c.name}: 应产出 BREP 拓扑`).not.toBeNull()

      assertRowMeshAligned(shape, runtime!, c.name)
    })
  }
})