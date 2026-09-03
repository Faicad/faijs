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
 *  3. P23 接线断言：产物经 `api/generated/script-face.ts` 接进 `api/index.ts` 与
 *     `api/api-namespace.ts`（B1 三源一致，§4.2 ②）；script-face / manifest 两份
 *     生成文件与 arg-spec 的 `scriptFace: true` 条目同步。
 *  4. 各投影条目的产出形态正确（type 重导出 / brep-op compatOp(projectBrepOp(…)) /
 *     query 导出函数）。
 *
 * Run: npx vitest run src/api/generated/surface-mechanism.test.ts
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  generateModule,
  generateScriptFace,
  generateScriptFaceManifest,
  PROJECTED_MODULES,
  scriptFaceEntries,
} from '../../../scripts/gen-l3-surface'
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

  it('P23：script-face / manifest 两份接线产物与 arg-spec 同步（改 scriptFace 标记必须重跑 gen 脚本）', () => {
    const face = readFileSync(fileURLToPath(new URL('./script-face.ts', import.meta.url)), 'utf-8')
    const manifest = readFileSync(fileURLToPath(new URL('./script-face-manifest.ts', import.meta.url)), 'utf-8')
    expect(generateScriptFace()).toBe(face)
    expect(generateScriptFaceManifest()).toBe(manifest)
  })

  it('P23：script-face 条目必须是 brep-op 且不在 faijs 特有 op 集合中（防同名二义）', () => {
    const index = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf-8')
    const ns = readFileSync(fileURLToPath(new URL('../api-namespace.ts', import.meta.url)), 'utf-8')
    expect(index).toMatch(/from '\.\/generated\/script-face'/)
    expect(ns).toMatch(/scriptFaceOps/)
    const faijsOps = new Set([
      'box', 'sphere', 'cylinder', 'cone', 'wedge',
      'text', 'screw', 'svgExtrude', 'sdf', 'load',
      'translate', 'rotate_euler', 'scale',
      'fai_drill', 'fai_extrude', 'engrave', 'chamfer', 'knurl',
      'union', 'subtract', 'intersect',
      'fai_split', 'group', 'assembly', 'copy',
      'faceNormal', 'bboxCenter', 'bboxMin', 'bboxMax',
      'asset',
    ])
    for (const e of scriptFaceEntries()) {
      expect(e.kind, `${e.name}`).toBe('brep-op')
      expect(faijsOps.has(e.name), `${e.name} 与 faijs 特有 op 同名（§6.3 红线：一个名字一份实现）`).toBe(false)
    }
  })

  it('各投影条目的产出形态正确（type 重导出 / brep-op compatOp(projectBrepOp(…)) / query 导出函数）', () => {
    for (const m of PROJECTED_MODULES) {
      if (!MODULES.has(m)) continue
      const artifact = artifactOf(m)
      for (const e of ARG_SPEC.filter((e) => e.kind !== 'skip' && (e.module ?? 'topology') === m)) {
        const esc = desc(e.name)
        if (e.kind === 'type') {
          expect(artifact, `${m}:${e.name}`).toMatch(new RegExp(`export type \\{ ${esc} \\} from '`))
        } else if (e.kind === 'brep-op') {
          expect(artifact, `${m}:${e.name}`).toMatch(new RegExp(`export const ${esc} = compatOp\\(`))
          expect(artifact, `${m}:${e.name}`).toMatch(new RegExp(`projectBrepOp\\('${esc}'`))
          // brep-op 产物必须走 P21 的双形态投影包装 + P22 的语句边界桥（§4.3.2）
          expect(artifact, `${m}:${e.name}`).toMatch(/'A'|'B1'|'B2'/)
        } else if (e.kind === 'query') {
          expect(artifact, `${m}:${e.name}`).toMatch(new RegExp(`export function ${esc}\\(`))
        }
      }
    }
  })
})