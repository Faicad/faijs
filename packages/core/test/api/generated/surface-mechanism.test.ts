/**
 * surface-mechanism — P13a 生成层机制 + P14 分片扩展的「最小结构测试」（E5）
 *
 * L3 投影机制与基线反向护栏
 *
 * 本套件不初始化 wasm（结构性验证，机制适配表 ↔ 产物 的静态一致性联动）：
 *  1. 同步守卫：对 PROJECTED_MODULES 里每个模块，`generateModule(m)` 的产物
 *     == 已提交的 `api/generated/<m>.ts`（漂移即失败，改 arg-spec 后必须重跑
 *     `npx tsx packages/core/scripts/gen-l3-surface.ts`，与 api-dts-sync.test.ts 同款模式）。

 *  2. P23 接线断言：产物经 `api/generated/script-face.ts` 接进 `api/index.ts` 与
 *     `api/api-namespace.ts`（B1 三源一致，§4.2 ②）；script-face / manifest 两份
 *     生成文件与 arg-spec 的 `scriptFace: true` 条目同步。
 *  3. 各投影条目的产出形态正确（type 重导出 / brep-op compatOp(projectBrepOp(…)) /
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
import { ARG_SPEC } from '../../../src/api/surface/arg-spec'

const artifactOf = (module: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../src/api/generated/${module}.ts`, import.meta.url)), 'utf-8')

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


  it('P23：script-face / manifest 两份接线产物与 arg-spec 同步（改 scriptFace 标记必须重跑 gen 脚本）', () => {
const face = readFileSync(fileURLToPath(new URL('../../../src/api/generated/script-face.ts', import.meta.url)), 'utf-8')
const manifest = readFileSync(fileURLToPath(new URL('../../../src/api/generated/script-face-manifest.ts', import.meta.url)), 'utf-8')
    expect(generateScriptFace()).toBe(face)
    expect(generateScriptFaceManifest()).toBe(manifest)
  })

  it('P23/P25：script-face 条目是 brep-op / faijs 自研视图投影 / query 查询 op，且不在 faijs 特有 op 集合中（防同名二义）', () => {
    const index = readFileSync(fileURLToPath(new URL('../../../src/api/index.ts', import.meta.url)), 'utf-8')
    const ns = readFileSync(fileURLToPath(new URL('../../../src/api/api-namespace.ts', import.meta.url)), 'utf-8')
    expect(index).toMatch(/from '\.\/generated\/script-face'/)
    expect(ns).toMatch(/scriptFaceOps/)
    const faijsOps = new Set([
      'box', 'sphere', 'cylinder', 'cone', 'wedge',
      'text', 'screw', 'svgExtrude', 'sdf', 'load',
      'translate', 'rotate_euler', 'scale', 'scale3d',
      'fai_drill', 'fai_extrude', 'engrave', 'chamfer', 'knurl',
      'union', 'subtract', 'intersect',
      'fai_split', 'group', 'assembly', 'copy',
      'faceNormal', 'bboxCenter', 'bboxMin', 'bboxMax',
      'asset',
    ])
    // kind 白名单：brep-op（compat 投影）/ faijs（自研视图投影）/ query（上游查询函数，
    // 如 getShapeKind / isValid / isEmpty / isEqualShape / isSameShape——b0c4a92 起进脚本面）。
    for (const e of scriptFaceEntries()) {
      expect(['brep-op', 'faijs', 'query'].includes(e.kind), `${e.name}（kind=${e.kind}）`).toBe(true)
      expect(faijsOps.has(e.name), `${e.name} 与 faijs 特有 op 同名（§6.3 红线：一个名字一份实现）`).toBe(false)
    }
  })

  it('各投影条目的产出形态正确（type 重导出 / brep-op defineOp 直连 / query 导出函数）', () => {
    for (const m of PROJECTED_MODULES) {
      if (!MODULES.has(m)) continue
      const artifact = artifactOf(m)
      for (const e of ARG_SPEC.filter((e) => e.kind !== 'skip' && (e.module ?? 'topology') === m)) {
        const esc = desc(e.name)
        if (e.kind === 'type') {
          expect(artifact, `${m}:${e.name}`).toMatch(new RegExp(`export type \\{ ${esc} \\} from '`))
        } else if (e.kind === 'brep-op') {
          // §5.4：brep-op 条目 defineOp 直连 core 自有实现（api/brep-operations/）。
          expect(artifact, `${m}:${e.name}`).toMatch(new RegExp(`export const ${esc} = defineOp\\(`))
          expect(artifact, `${m}:${e.name}`).toMatch(new RegExp(`brep: __own_${esc}Brep`))
        } else if (e.kind === 'query') {
          expect(artifact, `${m}:${e.name}`).toMatch(new RegExp(`export function ${esc}\\(`))
        } else if (e.kind === 'faijs') {
          // P25：faijs 自研符号 re-export 自手写 api/ 模块（非 compat 投影）。路径从
          // arg-spec 的 source 推导（与生成器 renderFaijs 的 `'../${file}'` 同规则），
          // 不写死单一模块目录：Phase 7 起测量 op（area/length）位于 api/measurement/，
          // 视图投影（viewCamera/projectView/projectSheet）仍在 api/view/。
          const file = e.source.split('#')[0]!
          expect(artifact, `${m}:${e.name}`).toMatch(new RegExp(`export \\{ ${esc} \\} from '\\.\\./${desc(file)}'`))
        }
      }
    }
  })
})