/**
 * DXF 导入测试（移植自 brepjs dxfImportFns，2026-10-17）。
 *
 * GOTCHA（faijs-openscad example013 根因留档）：DXF 组码流必须**严格两行一组
 * 配对遍历**（组码一行、值一行，游标 i += 2）。逐行扫描 + 特判的写法在遇到
 * `999` 注释头、HEADER 变量段时会游标错位，实体整段漏读 → "no wires"。
 */
import { describe, expect, it } from 'vitest'
import { parseDxfEntities, dxfEntitiesToWires, importDxf } from '../src/brep/dxf/dxf-import'
import type { BrepEngineApi, BrepHandle } from '../src/brep/engine/primitives'

/** 最小 mock 内核：记录调用，makeWire 返回递增句柄。 */
function mockKernel() {
  let handle = 1
  const calls: string[] = []
  const edgesMade: Array<{ kind: string; a?: unknown; b?: unknown; center?: unknown; r?: number }> = []
  const kernel = {
    makeLineEdge(a: unknown, b: unknown) {
      calls.push('makeLineEdge')
      edgesMade.push({ kind: 'line', a, b })
      return handle++ as unknown as BrepHandle
    },
    makeCircleEdge(center: unknown, _normal: unknown, r: number) {
      calls.push('makeCircleEdge')
      edgesMade.push({ kind: 'circle', center, r })
      return handle++ as unknown as BrepHandle
    },
    makeCircleArc(center: unknown, _normal: unknown, r: number) {
      calls.push('makeCircleArc')
      edgesMade.push({ kind: 'arc', center, r })
      return handle++ as unknown as BrepHandle
    },
    makeWire(edges: BrepHandle[]) {
      calls.push(`makeWire(${edges.length})`)
      return handle++ as unknown as BrepHandle
    },
  } as unknown as BrepEngineApi
  return { kernel, calls, edgesMade }
}

/** 一个带 999 注释头 + HEADER 段的最小 DXF（example013 同构形态）。 */
const SAMPLE_DXF = `999
dxflib 2.0.4.8
  0
SECTION
  2
HEADER
  9
$ACADVER
  1
AC1015
  0
ENDSEC
  0
SECTION
  2
ENTITIES
  0
LINE
  8
OUTLINE
 10
0.0
 20
0.0
 11
10.0
 21
0.0
  0
LINE
  8
OUTLINE
 10
10.0
 20
0.0
 11
10.0
 21
10.0
  0
LINE
  8
OUTLINE
 10
10.0
 20
10.0
 11
0.0
 21
10.0
  0
LINE
  8
OUTLINE
 10
0.0
 20
10.0
 11
0.0
 21
0.0
  0
CIRCLE
  8
HOLES
 10
5.0
 20
5.0
 40
1.0
  0
ENDSEC
  0
EOF
`

describe('parseDxfEntities（严格配对遍历）', () => {
  it('999 注释头 + HEADER 段不干扰 ENTITIES 段提取', () => {
    const parsed = parseDxfEntities(SAMPLE_DXF)
    expect(parsed.lines).toHaveLength(4)
    expect(parsed.circles).toHaveLength(1)
  })

  it('LINE 实体读出正确的组码坐标', () => {
    const parsed = parseDxfEntities(SAMPLE_DXF)
    const first = parsed.lines[0]
    expect(first.layer).toBe('OUTLINE')
    expect(parseFloat(first.data.get(10)!)).toBeCloseTo(0)
    expect(parseFloat(first.data.get(21)!)).toBeCloseTo(0)
  })

  it('没有 ENTITIES 段时返回空（不抛错）', () => {
    const parsed = parseDxfEntities('0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n')
    expect(parsed.lines).toHaveLength(0)
    expect(parsed.circles).toHaveLength(0)
  })

  it('LWPOLYLINE 顶点序列（10/20 重复组码）不被 Map 覆盖', () => {
    const dxf = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', 'P',
      '10', '0', '20', '0',
      '10', '4', '20', '0',
      '10', '4', '20', '4',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n')
    const parsed = parseDxfEntities(dxf)
    expect(parsed.polylines).toHaveLength(1)
    expect(parsed.polylines[0]).toHaveLength(3)
  })
})

describe('dxfEntitiesToWires（内核组线）', () => {
  it('LINE 环 + CIRCLE → 内核收到 5 条边并 makeWire', () => {
    const { kernel, calls, edgesMade } = mockKernel()
    const result = dxfEntitiesToWires(kernel, parseDxfEntities(SAMPLE_DXF))
    expect(result.ok).toBe(true)
    expect(calls.filter((c) => c === 'makeLineEdge')).toHaveLength(4)
    expect(calls.filter((c) => c === 'makeCircleEdge')).toHaveLength(1)
    expect(calls.some((c) => c.startsWith('makeWire'))).toBe(true)
    // 圆心/半径正确落到内核调用
    const circle = edgesMade.find((e) => e.kind === 'circle') as { center: { x: number; y: number }; r: number }
    expect(circle.center.x).toBeCloseTo(5)
    expect(circle.r).toBeCloseTo(1)
  })

  it('全空实体 → err(DXF_IMPORT_FAILED) 而非抛异常', () => {
    const { kernel } = mockKernel()
    const result = dxfEntitiesToWires(kernel, { lines: [], circles: [], arcs: [], polylines: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('DXF_IMPORT_FAILED')
  })

  it('layer 过滤只保留指定图层', () => {
    const { kernel, calls } = mockKernel()
    const result = importDxf(kernel, SAMPLE_DXF, 'OUTLINE')
    expect(result.ok).toBe(true)
    expect(calls.filter((c) => c === 'makeLineEdge')).toHaveLength(4)
    expect(calls.filter((c) => c === 'makeCircleEdge')).toHaveLength(0)
  })
})
