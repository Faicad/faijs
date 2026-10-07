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
 *  4. 兼容性事实（P3 冲突消除的证据）：compat op 的 transform 调用
 *     `*WithHistory` 真名——mirror/rotate/translate/scale 的 capabilities 是
 *     `*WithHistory`，不是裸名。
 */

import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { ARG_SPEC } from '../../../src/api/surface/arg-spec'

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
  it('brep-op 条目数 == (capabilities ∪ engines) 条目数 == generated compatOp+selfhost defineOp 数', () => {
    const brepOps = ARG_SPEC.filter((e) => e.kind === 'brep-op')
    // 声明面：capabilities（能力依赖）与 engines（引擎白名单）是两条正交轴，可并存
    // （2026-09-24 撤销 D11-7 互斥）。故「100% 声明」= 每条 brep-op 至少命中一条轴，
    // 用 union 计数——不是两个集合各数一遍再相加（并存条目会被计两次）。
    const declared = brepOps.filter((e) => e.capabilities?.length || e.engines?.length)
    const generated = ['operations.ts', 'topology.ts', 'sketching.ts'].map((f) =>
      fs.readFileSync(path.join(CORE_SRC, 'src', 'api', 'generated', f), 'utf-8'),
    )
    // Phase 3（core-decouple §5.4）：selfhost 条目走 defineOp 直连，其余走 compatOp；合计 == brep-op 条目数。
    const opDeclCount = generated.reduce(
      (acc, src) => acc + (src.match(/export const \w+ = (?:compatOp|defineOp)\(/g)?.length ?? 0),
      0,
    )
    expect(brepOps.length).toBeGreaterThan(0)
    // 并存合法（2026-09-24 撤销 D11-7 互斥）：同时声明两条轴的条目允许存在，
    // 故此处不再断言"两者不同现"；下面用 union 计数（并存条目只计一次）。
    expect(declared.length).toBe(brepOps.length) // 100% 声明
    expect(opDeclCount).toBe(brepOps.length)
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

  it('P3 冲突消除证据：transform 族 op 平台身份随 B 批降级漂移（engines → capabilities）', () => {
    const byName = new Map(ARG_SPEC.filter((e) => e.kind === 'brep-op').map((e) => [e.name, e]))
    // 2026-09-26 B 批：mirror/rotate/ellipsoid 从 engines:['occt'] 白名单降级为能力路由
    // （clone 模式）——实现只用 L1 中立方法（kernel.mirror / getBrepApi().transform /
    // makeEllipsoid+translate），brepkit 已声明同名能力。现断言三者已摘除 engines 白名单、
    // 改挂 capabilities（与 clone 上一批降级同方向）。
    expect(byName.get('mirror')!.engines ?? []).not.toContain('occt')
    expect(byName.get('rotate')!.engines ?? []).not.toContain('occt')
    expect(byName.get('ellipsoid')!.engines ?? []).not.toContain('occt')
    expect(byName.get('mirror')!.capabilities).toContain('mirror')
    expect(byName.get('rotate')!.capabilities).toContain('transform')
    expect(byName.get('ellipsoid')!.capabilities).toContain('makeEllipsoid')
  })
})

describe('Phase 1 手写 brep-only op 声明', () => {
  it('pattern.ts linearPattern 声明 capabilities: [linearPattern]', () => {
    const src = fs.readFileSync(path.join(CORE_SRC, 'src', 'api', 'pattern.ts'), 'utf-8')
    expect(src).toMatch(/capabilities: \['linearPattern'\],/)
  })

  it('boolean.ts union/cut/subtract 声明 *WithHistory 真名；intersect 中立（按引擎静态降级）', () => {
    const src = fs.readFileSync(path.join(CORE_SRC, 'src', 'api', 'boolean.ts'), 'utf-8')
    expect(src).toMatch(/capabilities: \['fuseWithHistory'\],/)
    expect(src.match(/capabilities: \['cutWithHistory'\],/g)?.length).toBe(2) // cut + subtract
    // intersect 不再硬声明 intersectWithHistory（brepkit 无此历史方法）——
    // 由 booleanBrep 按引擎声明的能力集静态分派（occt 历史路径 / brepkit 裸 intersect）。
    expect(src).not.toMatch(/capabilities: \['intersectWithHistory'\],/)
  })
})
