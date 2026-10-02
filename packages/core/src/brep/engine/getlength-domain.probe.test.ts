/**
 * 实证与回归：L1 `getLength` 归一化为「唯一 edge 弧长之和」（2026-10-02）。
 *
 * 归一化前：occt `getLength(solid)` = 280（= Σ 面周长 = 2×140，OCC `LinearProperties`
 * 默认 `SkipShared=false` 按面遍历、共享边计两次）；brepkit = 20（首条边，值随构建历史
 * 漂移，另盒给 10）。两引擎互不相等，且都不是「实体边总长」。
 *
 * 归一化后：两引擎都 = 140；compound（两盒）= 152；两引擎的 `Σ face getLength` 都 = 280。
 *
 * 注意：**单个 face / wire 的值在两引擎间不可逐位比**——两引擎的边/面枚举顺序不同
 * （occt 的 edge[0] 长 5，brepkit 的 edge[0] 长 20，故同一对边构成的 wire 一个 15 一个
 * 30）。跨引擎一致性由「solid 全边求和」与「Σ face getLength」钉定，而非单元素。
 *
 * Run: npx vitest run src/brep/engine/getlength-domain.probe.test.ts
 */

import { describe, it, expect, afterAll } from 'vitest'
import { __resetEngineRegistriesForTests, getBrepEngine } from './registry'
import { registerOcctBrepEngine } from './adapters/occt'
import { registerBrepkitBrepEngine } from './adapters/brepkit'
import type { BrepEngineApi } from './primitives'
import type { BrepHandle } from './types'

const SOLID = 'solid (box 20×10×5)'
const COMPOUND = 'compound (2 boxes)'
const UNIQUE_SUM = 'Σ unique-edge curveLength'
const FACE_SUM = 'Σ face getLength'

interface Row {
  shape: string
  value?: number
  error?: string
  edgeCount?: number
}

async function probeEngine(register: () => Promise<void>): Promise<Map<string, Row>> {
  __resetEngineRegistriesForTests()
  await register()
  const api: BrepEngineApi = (await getBrepEngine()).primitives
  const rows: Row[] = []

  const box = api.makeBox(20, 10, 5)
  const edges = api.getSubShapes(box, 'edge')
  const faces = api.getSubShapes(box, 'face')

  const probe = (label: string, h: BrepHandle, edgeCount?: number): void => {
    const row: Row = { shape: label, edgeCount }
    try {
      row.value = api.getLength(h)
    } catch (e) {
      row.error = String((e as Error)?.message ?? e).slice(0, 120)
    }
    rows.push(row)
  }

  probe(SOLID, box, edges.length)
  probe('edge [0]', edges[0]!)
  if (edges.length >= 2) {
    try {
      probe('wire (2 edges)', api.makeWire([edges[0]!, edges[1]!]))
    } catch (e) {
      rows.push({ shape: 'wire (2 edges)', error: String((e as Error)?.message ?? e).slice(0, 120) })
    }
  }
  try {
    probe(COMPOUND, api.makeCompound([box, api.makeBox(1, 1, 1)]))
  } catch (e) {
    rows.push({ shape: COMPOUND, error: String((e as Error)?.message ?? e).slice(0, 120) })
  }

  // 唯一边求和（归一化目标口径）。
  let uniqueSum = 0
  for (const e of edges) {
    try {
      uniqueSum += api.curveLength(e)
    } catch {
      /* 该引擎不支持 curveLength */
    }
  }
  rows.push({ shape: UNIQUE_SUM, value: uniqueSum, edgeCount: edges.length })

  // 每个面的 getLength 之和：恒等于 2 × 唯一边求和（闭合流形每条边属 2 个面）。
  // 用来证明两引擎的 **face 口径一致**——单项因枚举顺序不同而不可比。
  let faceSum = 0
  for (const f of faces) {
    try {
      faceSum += api.getLength(f)
    } catch {
      /* 该引擎面不可测 */
    }
  }
  rows.push({ shape: FACE_SUM, value: faceSum, edgeCount: faces.length })

  console.log('\n' + JSON.stringify(rows) + '\n')
  return new Map(rows.map((r) => [r.shape, r]))
}

const EXPECT_SOLID = 140 // 4·(20+10+5) = 4·35
const EXPECT_COMPOUND = 152 // 140 + 12（1×1×1 盒）
const EXPECT_FACE_SUM = 280 // 2 × 140

function valueOf(rows: Map<string, Row>, key: string): number {
  const v = rows.get(key)?.value
  if (v === undefined) throw new Error(`probe row missing or unmeasurable: ${key}`)
  return v
}

function assertNormalized(rows: Map<string, Row>): void {
  expect(valueOf(rows, SOLID)).toBeCloseTo(EXPECT_SOLID, 6)
  expect(valueOf(rows, COMPOUND)).toBeCloseTo(EXPECT_COMPOUND, 6)
  expect(valueOf(rows, UNIQUE_SUM)).toBeCloseTo(EXPECT_SOLID, 6)
  expect(valueOf(rows, FACE_SUM)).toBeCloseTo(EXPECT_FACE_SUM, 6)
  // 归一化的定义性质：getLength(solid) === 唯一边求和。
  expect(valueOf(rows, SOLID)).toBeCloseTo(valueOf(rows, UNIQUE_SUM), 6)
}

describe('L1 getLength 归一化（唯一 edge 弧长之和）', () => {
  it('occt', async () => {
    const rows = await probeEngine(registerOcctBrepEngine)
    assertNormalized(rows)
  }, 180000)

  it('brepkit', async () => {
    const rows = await probeEngine(registerBrepkitBrepEngine)
    assertNormalized(rows)
  }, 180000)

  afterAll(() => {
    __resetEngineRegistriesForTests()
  })
})
