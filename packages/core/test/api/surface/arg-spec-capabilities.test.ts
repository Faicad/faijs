/**
 * arg-spec-capabilities.test — 生成面声明轴一致性（2026-10-08 改为 engines 单轴）
 *
 * 2026-10-08 变更：`capabilities` 声明轴（`arg-spec.ArgSpecEntry.capabilities`、
 * `BrepCapabilityName`、`BrepCapabilities`、`engineCapabilitySet`、
 * `firstMissingCapability`、`defineOp.capabilities`）已整体删除。op 是否可在某引擎上
 * 执行，一律由 `engines`（引擎身份白名单）表达。故本文件从「能力声明全覆盖 + 能力名
 * 合法性」改为：
 *
 *  1. **三方一致（生成面）**：`kind:'brep-op'` 条目数 == `generated/*.ts` 中
 *     `export const X = (compatOp|defineOp)(` 数（防漏防漂移）。
 *  2. **engines 合法性**：凡声明 `engines` 的条目，非空且每个 id ∈ `BREP_ENGINE_IDS`。
 *  3. **删除守卫**：全仓（arg-spec + 手写 op）不再出现 `capabilities` 声明，
 *     且 `ArgSpecEntry` 上不再有该键。
 *
 * 判决等价性（旧能力门判决 == 新 engines 判决）由
 * `test/brep/engine/engine-verdict-equivalence.test.ts` 逐 op 钉住。
 */

import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { ARG_SPEC } from '../../../src/api/surface/arg-spec'
import { BREP_ENGINE_IDS, type BrepEngineId } from '../../../src/brep/engine/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const CORE_SRC = path.resolve(__dirname, '..', '..', '..')

/** 读 core 源码（相对 packages/core）。 */
function srcOf(rel: string): string {
  return fs.readFileSync(path.join(CORE_SRC, rel), 'utf-8')
}

/** 声明式 `capabilities:`（行首缩进 + 键名），排除注释与字符串里的提及。 */
const CAPABILITY_DECL = /^[ \t]*capabilities\s*:\s?/m

describe('生成面三方一致：arg-spec ↔ generated', () => {
  it('brep-op 条目数 == generated defineOp/compatOp 数', () => {
    const brepOps = ARG_SPEC.filter((e) => e.kind === 'brep-op')
    const generated = ['operations.ts', 'topology.ts', 'sketching.ts'].map((f) =>
      srcOf(`src/api/generated/${f}`),
    )
    // §5.4：brep-op 条目走 defineOp 直连 core 自有实现；合计 == brep-op 条目数。
    const opDeclCount = generated.reduce(
      (acc, src) => acc + (src.match(/export const \w+ = (?:compatOp|defineOp)\(/g)?.length ?? 0),
      0,
    )
    expect(brepOps.length).toBeGreaterThan(0)
    expect(opDeclCount).toBe(brepOps.length)
  })

  it('凡声明 engines 的 brep-op：非空且 id ∈ BREP_ENGINE_IDS', () => {
    const legal = new Set<string>(BREP_ENGINE_IDS)
    const declaring = ARG_SPEC.filter((e) => e.kind === 'brep-op' && e.engines !== undefined)
    expect(declaring.length).toBeGreaterThan(0)
    for (const e of declaring) {
      expect(e.engines!.length, `op '${e.name}' engines 非空`).toBeGreaterThan(0)
      for (const id of e.engines!) {
        expect(legal, `op '${e.name}' 引擎 id '${id}' ∈ BREP_ENGINE_IDS`).toContain(id as BrepEngineId)
      }
    }
  })
})

describe('删除守卫：capabilities 声明轴不再出现', () => {
  it('ARG_SPEC 每条条目都没有 capabilities 键', () => {
    for (const e of ARG_SPEC) {
      expect(Object.keys(e), `条目 '${e.name}' 仍带 capabilities 键`).not.toContain('capabilities')
    }
  })

  it('arg-spec.ts 源码没有 capabilities 字段声明', () => {
    expect(srcOf('src/api/surface/arg-spec.ts')).not.toMatch(CAPABILITY_DECL)
  })

  it('手写 op 源文件没有 capabilities 字段声明（含 pattern / boolean / shell / sketch op）', () => {
    const files = [
      'src/api/boolean.ts',
      'src/api/pattern.ts',
      'src/api/shell.ts',
      'src/api/draft.ts',
      'src/api/fillet.ts',
      'src/api/fillet-variable.ts',
      'src/api/profile.ts',
      'src/api/punch-hole.ts',
      'src/api/replicate.ts',
      'src/api/section-by-plane.ts',
      'src/api/sketch-on-face.ts',
      'src/api/sketch-on-plane.ts',
      'src/api/split-by-plane.ts',
      'src/api/split.ts',
      'src/api/transform.ts',
      'src/api/surface/arg-spec.ts',
    ]
    for (const f of files) {
      expect(srcOf(f), `${f} 仍有 capabilities 声明`).not.toMatch(CAPABILITY_DECL)
    }
    expect(srcOf('../sketch/src/op.ts'), '../sketch/src/op.ts 仍有 capabilities 声明').not.toMatch(
      CAPABILITY_DECL,
    )
  })

  it('brep/engine 适配器与 registry 类型不再携带 capabilities 对象', () => {
    for (const f of [
      'src/brep/engine/adapters/occt.ts',
      'src/brep/engine/adapters/brepkit.ts',
      'src/brep/engine/adapters/brep-mock.ts',
      'src/brep/engine/registry.ts',
      'src/brep/brep-chain.ts',
      'src/runtime-state.ts',
    ]) {
      expect(srcOf(f), `${f} 仍有 capabilities 声明`).not.toMatch(/^[ \t]*(readonly )?capabilities\s*[?:]/m)
    }
  })
})

describe('B 批降级定案：mirror / rotate / ellipsoid 为中立 op', () => {
  it('三者既不挂 engines 白名单，也没有任何能力声明', () => {
    const byName = new Map(ARG_SPEC.filter((e) => e.kind === 'brep-op').map((e) => [e.name, e]))
    for (const n of ['mirror', 'rotate', 'ellipsoid']) {
      const e = byName.get(n)
      expect(e, `arg-spec 缺条目 '${n}'`).toBeDefined()
      expect(e!.engines ?? [], `'${n}' 不应挂 engines`).not.toContain('occt')
      expect(Object.keys(e!), `'${n}' 不应带 capabilities`).not.toContain('capabilities')
    }
  })
})
