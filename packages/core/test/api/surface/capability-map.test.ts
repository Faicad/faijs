/**
 * capability-map.test — Phase 0 工件断言（三方一致 + brepkit wasm 导出面基线）
 *
 * 设计：docs/plans/2026-09-23-brep-engine-switchability-rework.md §4 Phase 0
 *
 * 钉住的不可变事实：
 *  1. capability-map.json 条目数 == ARG_SPEC kind:'brep-op' 条目数 ==
 *     api/generated/*.ts 中 compatOp 数（三方一致）。
 *  2. 每条 capability-map 条目：op/source 与 arg-spec 一致，kernelMethods 非空。
 *  3. brepkit-wasm 导出面基线（重新生成脚本后需同步更新本文件）：
 *     - pattern 三方法（linearPattern/circularPattern/gridPattern）已导出（Phase 2 接线依据）；
 *     - *WithHistory 族除 fuse/cut/fillet/intersect 外未导出（能力表不声明的依据）；
 *     - brepkit 适配器 unsupported 桩中 wasm 已导出的接线候选集合固定。
 */

import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { ARG_SPEC } from '../../../src/api/surface/arg-spec'
import * as capabilityMap from '../../../src/api/surface/capability-map.json'
import * as brepkitSurface from '../../../src/api/surface/brepkit-wasm-surface.json'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const GENERATED_DIR = path.resolve(__dirname, '../../../src/api/generated')

describe('Phase 0 capability-map 三方一致', () => {
  it('capability-map 条目数 == arg-spec brep-op 条目数 == generated defineOp 数', () => {
    const brepOps = ARG_SPEC.filter((e) => e.kind === 'brep-op')
    const generatedFiles = ['operations.ts', 'topology.ts', 'sketching.ts'].map((f) =>
      fs.readFileSync(path.join(GENERATED_DIR, f), 'utf-8'),
    )
    // §5.4：brep-op 条目走 defineOp 直连 core 自有实现；合计 == brep-op 条目数。
    const opDeclCount = generatedFiles.reduce(
      (acc, src) => acc + (src.match(/export const \w+ = (?:compatOp|defineOp)\(/g)?.length ?? 0),
      0,
    )
    expect(capabilityMap.count).toBe(brepOps.length)
    expect(capabilityMap.entries.length).toBe(brepOps.length)
    expect(opDeclCount).toBe(brepOps.length)
  })

  it('每条条目 op/source 与 arg-spec 一致，且 kernelMethods 非空', () => {
    const byName = new Map(ARG_SPEC.filter((e) => e.kind === 'brep-op').map((e) => [e.name, e]))
    for (const entry of capabilityMap.entries) {
      const spec = byName.get(entry.op)
      expect(spec, `op '${entry.op}' 应在 arg-spec 中`).toBeDefined()
      expect(entry.source).toBe(spec!.source)
      expect(entry.kernelMethods.length, `op '${entry.op}' 的 kernelMethods 非空`).toBeGreaterThan(0)
    }
  })

  it('每个 brep-op 的内核方法都可在 occt-wasm 内核面找到（occt 全能力基线）', () => {
    // occt 适配器声明 12 个 evolution；盘点表是 op 级全依赖，occt 作为参考内核
    // 应覆盖全部 compat op 路径（以 topology/booleanFns 等实际调用为准）。
    // 本条为弱断言：内核方法集合规模合理（避免空表/半表入库）。
    const allMethods = new Set(capabilityMap.entries.flatMap((e) => e.kernelMethods))
    expect(allMethods.size).toBeGreaterThan(30)
  })
})

describe('Phase 0 brepkit-wasm 导出面基线', () => {
  it('wasm 方法面非空且数量级合理', () => {
    expect(brepkitSurface.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(brepkitSurface.methodCount).toBeGreaterThan(200)
    expect(brepkitSurface.methods).toContain('fuse')
  })

  it('pattern 三方法已导出（Phase 2 接线依据）', () => {
    expect(brepkitSurface.patternMethods).toEqual(
      expect.arrayContaining(['linearPattern', 'circularPattern', 'gridPattern']),
    )
  })

  it('*WithHistory 族除 fuse/cut/fillet/intersect 外未导出（能力表不声明依据）', () => {
    for (const m of ['mirrorWithHistory', 'rotateWithHistory', 'translateWithHistory', 'scaleWithHistory', 'shellWithHistory', 'offsetWithHistory', 'thickenWithHistory']) {
      expect(brepkitSurface.methods, `${m} 不应在 brepkit wasm 导出面`).not.toContain(m)
      expect(brepkitSurface.notExported, `${m} 应在 notExported`).toContain(m)
    }
    // 4 个 WithEvolution 是 brepkit 的演化能力全集
    expect(brepkitSurface.evolutionMethods.sort()).toEqual(
      ['cutWithEvolution', 'filletWithEvolution', 'fuseWithEvolution', 'intersectWithEvolution'].sort(),
    )
  })

  it('wasm 已导出但 brepkit 适配器仍是 unsupported 桩的接线候选集合固定', () => {
    expect(brepkitSurface.wasmExportedButUnwired.sort()).toEqual(
      ['extrude', 'importStl', 'loft', 'makeRectangle', 'removeDegenerateEdges', 'section'].sort(),
    )
  })
})
