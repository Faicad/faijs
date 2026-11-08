/**
 * fai_drill_tapper e2e (.fai.js, BREP/OCCT) — 两串攻丝孔端到端 round-trip
 *
 * 覆盖（真实 OCCT，beforeAll registerOcctBrepEngine，editor runtime brep 模式）：
 * - fixture 脚本（box + fai_drill 参照 + fai_drill_tapper）经完整 cad-runtime 执行：
 *   parse → dispatch → brep 路径 → outputs 形状带 BREP 槽。
 * - 几何等价：tapper 体积 ≡ fai_drill simple 同径参照（π·1.25²·20 的底孔切除）。
 * - PMI round-trip：pmiThreads(tapped 形状) 恰 1 条，label 'M3-6H 通（底孔 Φ2.5 通，攻丝）'，
 *   axis 朝下 [0,0,-1]、process 'tapped'。
 *
 * 注：features/features.test.ts 走 mesh 模式，而 fai_drill_tapper 是 brep-only op，
 * 故本 fixture 不放 features/ 目录、由本文件以 brep 模式驱动。
 *
 * Run: npx vitest run faijs/tapper/tapper.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { extractMetadata } from '@faicad/faijs/lang/metadata-extractor'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { hasBrep } from '@faicad/faijs/shape'
import { pmiThreads } from '@faicad/faijs/api/pmi/query'
import type { Shape } from '@faicad/faijs/mesh/types'
import type { CadRuntime, ExecutionResult } from '@faicad/faijs/cad-runtime/runtime'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
import type { BrepHandle } from '@faicad/faijs/brep/engine/types'
import { createEditorRuntime } from '../_support/editor-runtime'

/** `analyzeCode` 已迁至宿主层（A4）；旧实现即 extractMetadata(code).lines。 */
const analyzeCode = (code: string) => extractMetadata(code).lines

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

const FIXTURE = join(fileURLToPath(new URL('.', import.meta.url)), 'tapper-tapped-hole.fai.js')

function volumeOf(result: ExecutionResult, part: 'ref' | 'tapped'): number {
  const kernel = result.brepChain.kernel as BrepEngineApi
  const solid = result.brepChain.solidCache.get(part as never) as BrepHandle | undefined
  if (!solid) throw new Error(`no BREP solid for ${part}`)
  return kernel.getVolume(solid)
}

describe('fai_drill_tapper e2e (BREP/OCCT)', () => {
  let runtime: CadRuntime
  let result: ExecutionResult
  let tappedShape: Shape | undefined

  beforeAll(async () => {
    runtime = createEditorRuntime(createNodePorts(), 'brep')
    result = await runtime.execute(readFileSync(FIXTURE, 'utf-8'), { topology: 'auto' })
    tappedShape = result.outputs.get('tapped' as never) as Shape | undefined
  }, 300000)

  it('fixture：parse 出 ≥3 条几何语句', () => {
    const summaries = analyzeCode(readFileSync(FIXTURE, 'utf-8'))
    expect(summaries.filter(s => s.hasAssignment).length).toBeGreaterThanOrEqual(3)
  })

  it('执行成功：无 failedAt，tapped 形状带 BREP 槽', () => {
    expect(result.failedAt).toBeUndefined()
    expect(tappedShape).toBeDefined()
    expect(hasBrep(tappedShape!)).toBe(true)
  })

  it('几何等价：tapper 体积 ≡ fai_drill simple Φ2.5 通孔参照', () => {
    expect(volumeOf(result, 'tapped')).toBeCloseTo(volumeOf(result, 'ref'), 6)
  })

  it('PMI round-trip：恰 1 条螺纹孔，label/axis/process 与契约一致', () => {
    const items = pmiThreads(tappedShape!)
    expect(items.length).toBe(1)
    const item = items[0]!
    expect(item.label).toBe('M3-6H 通（底孔 Φ2.5 通，攻丝）')
    expect(item.axis.direction).toEqual([0, 0, -1])
    expect(item.process).toBe('tapped')
  })
})
