/**
 * assembly-compare P0b：order-centroid 配对（对齐
 * assembly-global-solver-plan.md §4.5）。
 *
 * 构造两个 STEP：同样的「小盒@原点 / 大盒@(100,0,0)」组合，但成员顺序互换。
 * - 'order-index' / 'names'：按（序数）名排序后按下标配对 → 把"小盒@原点"错配到
 *   "大盒@100" → 体积/质心不符 → 不等价。
 * - 'order-centroid'：按质心就近配对 → 小盒↔小盒、大盒↔大盒 → 等价。
 * 证明 order-centroid 对成员顺序/命名不敏感（跨命名比对所需）。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs-core/node'
import { getBackends } from '@faicad/faijs-core/runtime-state'
import { brepOf } from '@faicad/faijs-core/shape'
import { importAssemblyFromStep, collectLeafParts } from '@faicad/faijs-core'
import { asPartName } from '@faicad/faijs-core/identity'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as cq from './index'
import { compareAssemblyFiles } from './assembly-compare'

let fa: string
let fb: string

beforeAll(async () => {
  await registerOcctBrepEngine()
  const runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)
  const res = await runtime.execute([
    "import * as cq from '@faicad/cq-compat'",
    'let small = cq.val(cq.box(cq.Workplane("XY"), 10, 10, 10))',
    'let big = cq.val(cq.box(cq.Workplane("XY"), 30, 30, 30))',
  ].join('\n'))
  expect(res.failedAt).toBeUndefined()
  const small = res.outputs.get(asPartName('small')) as never
  const big = res.outputs.get(asPartName('big')) as never

  const kernel = getBackends().kernel.brep as {
    translate: (h: unknown, x: number, y: number, z: number) => unknown
    makeCompound: (a: unknown[]) => unknown
    exportStep: (h: unknown) => string
  }
  const s = brepOf(small)
  const b = brepOf(big)
  const sMoved = kernel.translate(s, 100, 0, 0)
  const bMoved = kernel.translate(b, 100, 0, 0)

  // fileA: 小盒@原点, 大盒@100
  const compA = kernel.makeCompound([s, bMoved])
  // fileB: 大盒@100, 小盒@原点（顺序互换）
  const compB = kernel.makeCompound([bMoved, s])

  const dir = mkdtempSync(join(tmpdir(), 'asm-cmp-'))
  fa = join(dir, 'a.stp')
  fb = join(dir, 'b.stp')
  writeFileSync(fa, kernel.exportStep(compA))
  writeFileSync(fb, kernel.exportStep(compB))

  // 健全性：导入后确为 2 个 leaf
  const exact = (buf: Buffer): ArrayBuffer => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const leavesA = collectLeafParts(await importAssemblyFromStep(exact(Buffer.from(kernel.exportStep(compA))))).filter(n => n.shapeHandle !== null)
  expect(leavesA.length).toBe(2)
}, 120000)

describe('cq-compat: assembly-compare pairing 模式', () => {
  it("order-index / names：按下标配对 → 错配 → 不等价", async () => {
    const rIdx = await compareAssemblyFiles(fa, fb, { pairing: 'order-index' })
    expect(rIdx.equivalent).toBe(false)
    const rNames = await compareAssemblyFiles(fa, fb, { pairing: 'names' })
    expect(rNames.equivalent).toBe(false)
  })

  it('order-centroid：按质心就近配对 → 小↔小、大↔大 → 等价', async () => {
    const r = await compareAssemblyFiles(fa, fb, { pairing: 'order-centroid' })
    expect(r.equivalent).toBe(true)
    // 每个 part 的体积/质心都应 match
    expect(r.parts.every(p => p.found && p.volume?.match && p.centerOfMass?.match)).toBe(true)
  })
})
