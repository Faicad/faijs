/**
 * arg-spec-capabilities.test — Phase 1 断言（能力声明全覆盖 + 能力名合法性）
 *
 * 设计：docs/plans/2026-09-23-brep-engine-switchability-rework.md §4 Phase 1 / §8.2
 *
 * 钉住的事实（单一真源 = arg-spec.ts）：
 *  1. `kind: 'brep-op'` 条目数 == 已声明 capabilities 的条目数 ==
 *     generated/*.ts 中 `export const X = compatOp(` 数（三方一致，防漏防漂移）。
 *  2. 每条 compat op 的 capabilities 非空，且每个名字 ∈ BrepCapabilityName
 *     （5 族布尔 + BrepEvolutionKind 真名 + BrepMethodKind 真名——从 types.ts 提取）。
 *  3. 手写 brep-only op（pattern.ts linearPattern、boolean.ts union/cut/subtract/
 *     intersect）声明真名能力。
 *  4. 兼容性事实（P3 冲突消除的证据）：vendored compat op 的 transform 调用
 *     `*WithHistory` 真名——mirror/rotate/translate/scale 的 capabilities 是
 *     `*WithHistory`，不是裸名。
 */

import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { ARG_SPEC } from './arg-spec'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const CORE_SRC = path.resolve(__dirname, '..', '..', '..')

/** 从 types.ts 源码提取 BrepCapabilityName 合法全集（5 族布尔 + evolution 真名 + method 真名）。 */
function legalCapabilityNames(): Set<string> {
  const types = fs.readFileSync(path.join(CORE_SRC, 'src', 'brep', 'engine', 'types.ts'), 'utf-8')
  const names = new Set<string>(['heal', 'directEdit', 'advSurface', 'assembly', 'meshLift'])
  const evo = types.slice(types.indexOf('export type BrepEvolutionKind'), types.indexOf('export type BrepMethodKind'))
  for (const m of evo.matchAll(/'([a-zA-Z]+)'/g)) names.add(m[1])
  const method = types.slice(types.indexOf('export type BrepMethodKind'), types.indexOf('export interface BrepCapabilities'))
  for (const m of method.matchAll(/'([a-zA-Z]+)'/g)) names.add(m[1])
  return names
}

describe('Phase 1 三方一致：arg-spec ↔ 声明 ↔ 生成物', () => {
  it('brep-op 条目数 == (capabilities+engines) 条目数 == generated compatOp 数', () => {
    const brepOps = ARG_SPEC.filter((e) => e.kind === 'brep-op')
    const declared = brepOps.filter((e) => e.capabilities?.length)
    // Phase 5（D11）：平台 op 声明 engines 取代 capabilities（互斥，D11-7）——
    // 「能力声明全覆盖」= capabilities 条目 ∪ engines 条目 = 全部 brep-op。
    const engined = brepOps.filter((e) => e.engines?.length)
    const generated = ['operations.ts', 'topology.ts', 'sketching.ts'].map((f) =>
      fs.readFileSync(path.join(CORE_SRC, 'src', 'api', 'generated', f), 'utf-8'),
    )
    const compatOpCount = generated.reduce(
      (acc, src) => acc + (src.match(/export const \w+ = compatOp\(/g)?.length ?? 0),
      0,
    )
    expect(brepOps.length).toBeGreaterThan(0)
    // 无 op 同时声明 capabilities 与 engines（D11-7 互斥在 assertLibConforms 也抛错）
    expect(brepOps.filter((e) => e.capabilities?.length && e.engines?.length)).toHaveLength(0)
    expect(declared.length + engined.length).toBe(brepOps.length) // 100% 声明
    expect(compatOpCount).toBe(brepOps.length)
  })
})

describe('Phase 1 能力名合法性：每条 compat op 声明非空且合法', () => {
  const legal = legalCapabilityNames()
  const legalEngineIds = new Set(['occt', 'brepkit', 'brep_mock'])

  it('每条 brep-op 的 capabilities（或 engines）非空且名字合法', () => {
    const brepOps = ARG_SPEC.filter((e) => e.kind === 'brep-op')
    for (const e of brepOps) {
      if (e.capabilities?.length) {
        for (const c of e.capabilities) {
          expect(legal, `op '${e.name}' 能力名 '${c}' ∈ BrepCapabilityName`).toContain(c)
        }
      } else {
        // Phase 5（D11）：engines 条目必须非空且 id ∈ BREP_ENGINE_IDS
        expect(e.engines?.length, `op '${e.name}' engines 非空`).toBeGreaterThan(0)
        for (const id of e.engines!) {
          expect(legalEngineIds, `op '${e.name}' 引擎 id '${id}' ∈ BREP_ENGINE_IDS`).toContain(id)
        }
      }
    }
  })

  it('P3 冲突消除证据：transform 族 compat op 声明平台归属 engines（非裸能力名）', () => {
    const byName = new Map(ARG_SPEC.filter((e) => e.kind === 'brep-op').map((e) => [e.name, e]))
    // Phase 5（D11）起平台 op 不再声明 capabilities（occt-only 方法不属 L1）：
    // mirror/rotate/ellipsoid 的平台身份改由 engines: ['occt'] 表达。
    expect(byName.get('mirror')!.engines).toContain('occt')
    expect(byName.get('rotate')!.engines).toContain('occt')
    expect(byName.get('ellipsoid')!.engines).toContain('occt')
  })
})

describe('Phase 1 手写 brep-only op 声明', () => {
  it('pattern.ts linearPattern 声明 capabilities: [linearPattern]', () => {
    const src = fs.readFileSync(path.join(CORE_SRC, 'src', 'api', 'pattern.ts'), 'utf-8')
    expect(src).toMatch(/capabilities: \['linearPattern'\],/)
  })

  it('boolean.ts union/cut/subtract/intersect 声明 *WithHistory 真名', () => {
    const src = fs.readFileSync(path.join(CORE_SRC, 'src', 'api', 'boolean.ts'), 'utf-8')
    expect(src).toMatch(/capabilities: \['fuseWithHistory'\],/)
    expect(src.match(/capabilities: \['cutWithHistory'\],/g)?.length).toBe(2) // cut + subtract
    expect(src).toMatch(/capabilities: \['intersectWithHistory'\],/)
  })
})
