/**
 * C3 — brepjs 兼容层端到端场景验收（faijs 侧，断言 1–4）
 *
 * 设计文档：docs/plans/2026-08-29-faijs-module-runtime-plan.md §7.4 C3
 *
 * 场景（与 §7.4 六项断言一致）：
 *  ```
 *  import * as gear from 'brepjs-gear'
 *  let part0 = gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })
 *  let part1 = cad.box({ size: [48, 48, 8] })
 *  let part2 = cad.union(part0, part1)
 *  ```
 *
 * 六项断言（§7.4）：
 *  1. part0 是 BREP（hasBrep === true，精确几何、非 faceted）
 *  2. cad.union 的路径是 BREP（dispatchPath == 'brep'，不是 mesh；结果保留 BREP 槽，
 *     与 b7 同样的精确布尔，不混合降到 mesh）
 *  3. UNION 结果导出 STEP 是精确的（含 `ADVANCED_FACE`，不是 faceted 的 POLYGONAL）
 *  4. 几何交叉校验：brepjs GearResult 字段（pitch=48, tip=52）与网格外径吻合
 *  5. （3d_editor 侧 / C4）timeline 对 brepjs-gear.external 只读
 *  6. （3d 入口 / C4）snapshot export/restore 几何一致
 *  —— 断言 5/6 属于 3d_editor（C4），faijs 侧单测只覆盖 1–4；C4 交付时在 3d_editor repo 验证。
 *
 * Run: npx vitest run test/faijs/libs/c3-brepjs-scenario.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { parseScript } from '@faicad/faijs-core'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs-core/node'
import { initOcctWasm } from '@faicad/faijs-core'
import { hasBrep } from '@faicad/faijs-core/shape'
import { dispatchPath } from '@faicad/faijs-core/cad-runtime/backend-dispatch'
import { makeExternalGear } from 'brepjs'
import * as gear from './brepjs-gear'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import type { PartName } from '@faicad/faijs-core/identity'

let runtime: ReturnType<typeof createRuntime>
let script: ReturnType<typeof parseScript>['script']
let result: Awaited<ReturnType<ReturnType<typeof createRuntime>['execute']>>

beforeAll(async () => {
  await initOcctWasm()
  runtime = createRuntime(createNodePorts(), 'auto')
  runtime.registerLib('gear', gear as never)
  const { script: s } = parseScript([
    "import * as gear from 'brepjs-gear'",
    'let part0 = gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })',
    'let part1 = cad.box({ size: [48, 48, 8] })',
    'let part2 = cad.union(part0, part1)',
  ].join('\n'))
  script = s
  result = await runtime.execute(script)
}, 120000)

function shapeOf(partId: string): Shape {
  const shape = result.outputs.get(partId as PartName)
  if (!shape) throw new Error(`no output for ${partId}`)
  return shape as Shape
}

describe('C3 brepjs 端到端场景验收（断言 1–4）', () => {
  it('断言1: part0 是 BREP（hasBrep === true，几何非空）', () => {
    expect(result.failedAt).toBeUndefined()
    const p0 = shapeOf('part0')
    expect(hasBrep(p0)).toBe(true)
    expect(p0.positions.length).toBeGreaterThan(0)
    expect(p0.indices.length).toBeGreaterThan(0)
  })

  it('断言2: cad.union 走 BREP 路径（dispatchPath(part0,part1) == "brep"，非 mesh）', () => {
    const p0 = shapeOf('part0')
    const p1 = shapeOf('part1')
    expect(hasBrep(p1)).toBe(true)
    // dispatchPath 静态判定：auto 模式 + 全部输入 hasBrep + 有 brep 实现 → brep
    // （union 的 BREP 实现存在且同获注入；这里传一个非空实现占位即可验证判定逻辑）
    const path = dispatchPath([p0, p1], () => undefined)
    expect(path).toBe('brep')
    // 且 union 结果保留 BREP 槽——精确布尔，非混合降到 mesh（与 b7 双向）
    const p2 = shapeOf('part2')
    expect(hasBrep(p2)).toBe(true)
  })

  it('断言3: UNION 结果导出 STEP 是精确的（含 ADVANCED_FACE，非 faceted）', () => {
    const entry = result.brepSolids?.get('part2' as PartName)
    expect(entry).toBeDefined()
    const step = entry!.kernel.exportStep(entry!.solid)
    expect(step).toContain('ADVANCED_FACE')
    // faceted 导出走 meshesToStep → 每个三角面 buildTriFace，不含 ADVANCED_FACE
    expect(step).not.toContain('POLY_FACE')
  })

  it('断言4: 几何交叉校验（brepjs GearResult 字段）pitch=48/tip=52/其它直径', () => {
    const r = makeExternalGear({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })
    if (!r.ok) throw new Error('brepjs makeExternalGear failed: ' + String(r.error))
    const { pitchDiameter, tipDiameter, baseDiameter, rootDiameter } = r.value
    expect(pitchDiameter).toBeCloseTo(48, 6) // m×z = 2×24
    expect(tipDiameter).toBeCloseTo(52, 6)  // m×(z+2) = 2×26
    expect(baseDiameter).toBeGreaterThan(0)
    expect(rootDiameter).toBeGreaterThan(0)
    // adapter 网格外径 ≈ tip/2（容忍三角化边界）
    const p0 = shapeOf('part0')
    let xyMax = -Infinity
    for (let i = 0; i < p0.positions.length; i += 3) {
      const x = Math.abs(p0.positions[i])
      const y = Math.abs(p0.positions[i + 1])
      const m = Math.max(x, y)
      if (m > xyMax) xyMax = m
    }
    expect(xyMax).toBeGreaterThan(tipDiameter / 2 - 1)
    expect(xyMax).toBeLessThanOrEqual(tipDiameter / 2 + 1)
  })
})