/**
 * surface-mechanism — P13a 生成层机制 + P14 分片扩展的「最小结构测试」（E5）
 *
 * 设计文档：docs/plans/2026-09-02-faijs-api-surface-completion.md §E5 / §5.2
 *
 * 本套件不初始化 wasm（结构性验证，机制适配表 ↔ 产物 的静态一致性联动）：
 *  1. 同步守卫：对 PROJECTED_MODULES 里每个模块，`generateModule(m)` 的产物
 *     == 已提交的 `api/generated/<m>.ts`（漂移即失败，改 arg-spec 后必须重跑
 *     `npx tsx packages/core/scripts/gen-l3-surface.ts`，与 api-dts-sync.test.ts 同款模式）。
 *  2. 基线反向护栏：每个模块 ARG_SPEC 的每条非 skip 条目必须存在于 upstream-surface.json
 *     的同模块面（U7 零遗漏；generateModule 自身也校验，这里显式断言）。
 *  3. 目录独立性（P13 范围）：产物是**独立文件**，不接入 api/index.ts ——
 *     index/namespace 键集合相等（U7 断言 C）由 P14 全量铺开的 E12 终态负责，
 *     此期提前接入只会破坏断言。锁住「产物独立」避免误接入。
 *  4. 各投影条目的产出形态正确（type 重导出 / brep-op defineOp / query 导出函数）。
 *
 * Run: npx vitest run src/api/generated/surface-mechanism.test.ts
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { generateModule, PROJECTED_MODULES } from '../../../scripts/gen-l3-surface'
import { ARG_SPEC } from '../surface/arg-spec'

const artifactOf = (module: string): string =>
  readFileSync(fileURLToPath(new URL(`./${module}.ts`, import.meta.url)), 'utf-8')

// 已在分片内登记条目的模块（= 被生成/守卫覆盖的模块面）；P13 兼容缺省 module='topology'。
const MODULES = new Set(ARG_SPEC.filter((e) => e.kind !== 'skip').map((e) => e.module ?? 'topology'))

const desc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('生成层机制（E5，P13a 机制 / P14 分片）', () => {
  it('各模块产物与当前 arg-spec 由生成器同步（改 arg-spec 必须重跑 gen 脚本）', () => {
    for (const m of PROJECTED_MODULES) {
      if (!MODULES.has(m)) continue
      expect(generateModule(m), `模块 ${m} 漂移`).toBe(artifactOf(m))
    }
  })

  it('每个投影条目都在 upstream-surface.json 的对应模块基线中找到（U7 反向护栏）', () => {
    const raw = JSON.parse(
      readFileSync(fileURLToPath(new URL('../surface/upstream-surface.json', import.meta.url)), 'utf-8'),
    ) as { symbols: Array<{ name: string; kind: 'value' | 'type'; module: string }> }
    for (const m of PROJECTED_MODULES) {
      if (!MODULES.has(m)) continue
      const base = new Set(raw.symbols.filter((s) => s.module === m).map((s) => s.name))
      const projected = ARG_SPEC.filter((e) => e.kind !== 'skip' && (e.module ?? 'topology') === m)
      for (const e of projected) {
        expect(base.has(e.name), `arg-spec 条目 ${m}:${e.name} 不在 surface 基线中`).toBe(true)
      }
    }
  })

  it('产物是独立模块，不写入 api/index.ts（接入属 P14/E12，避免提前破 U7 断言 C）', () => {
    const index = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf-8')
    const ns = readFileSync(fileURLToPath(new URL('../api-namespace.ts', import.meta.url)), 'utf-8')
    expect(index).not.toMatch(/from '\.\/generated/)
    expect(ns).not.toMatch(/from '\.\.\/generated/)
  })

  it('各投影条目的产出形态正确（type 重导出 / brep-op defineOp / query 导出函数）', () => {
    for (const m of PROJECTED_MODULES) {
      if (!MODULES.has(m)) continue
      const artifact = artifactOf(m)
      for (const e of ARG_SPEC.filter((e) => e.kind !== 'skip' && (e.module ?? 'topology') === m)) {
        const esc = desc(e.name)
        if (e.kind === 'type') {
          expect(artifact, `${m}:${e.name}`).toMatch(new RegExp(`export type \\{ ${esc} \\} from '`))
        } else if (e.kind === 'brep-op') {
          expect(artifact, `${m}:${e.name}`).toMatch(new RegExp(`export const ${esc} = defineOp\\(\\{`))
          expect(artifact, `${m}:${e.name}`).toMatch(/brep: \(\.\.\.args: unknown\[\]\) => /)
          // brep-op 产物必须经 l3-bridge 桥接（借入/适配/调用）
          expect(artifact, `${m}:${e.name}`).toMatch(/borrowBrepjsShape|adoptBrepjsProduct|callBrepjs/)
        } else if (e.kind === 'query') {
          expect(artifact, `${m}:${e.name}`).toMatch(new RegExp(`export function ${esc}\\(`))
        }
      }
    }
  })
})