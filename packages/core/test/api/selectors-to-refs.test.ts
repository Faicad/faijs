/**
 * @vitest-environment node
 *
 * selectors-to-refs — 桥（选择器 → 句柄 → TopoRef）单测（方案 2026-10-12 §3.2 / P0）。
 *
 * 覆盖：
 * 1. 面选择器 `">Z"` / `"|Z"` → `FaceTopoRef[]`，origin/role 由命名层分配（非空）；
 * 2. **身份一致性**：`">Z"` 解析出的 (origin, role) 与 `cad.faceRef(p0, 顶面)` 完全一致
 *    —— 桥产出的引用就是命名层对该面的引用，等价性锚点；
 * 3. 边选择器 `"|Z"`（box 的四条竖边）→ `EdgeTopoRef[]`，每条的 faces 对齐全；
 * 4. 顶点选择器 `">Z"` → `P3[]`，坐标在 z=10 平面；
 * 5. 选择器命中无名实体（无 role 血统）→ 抛 `TopoRefError`（R1：不静默降级）。
 *
 * 命名上下文来自 CadRuntime 执行产物（活 Shape 带 slot/roleTable/血缘）——
 * 裸 solid 句柄没有命名槽，桥的输入必须是执行产物。
 *
 * Run: npx vitest run test/api/selectors-to-refs.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import type { Shape } from '../../src/mesh/types'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import { createApiNamespace } from '../../src/api/api-namespace'
import { TopoRefError } from '../../src/topology/naming'
import {
  resolveSelectorToFaceRefs,
  resolveSelectorToEdgeRefs,
  resolveSelectorToVertexPts,
} from '../../src/api/selectors-to-refs'
import { faceRef } from '../../src/api/face-ref'

let kernel: ReturnType<typeof getBrepApi>

beforeAll(async () => {
  await initOcctWasm()
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
  // CadRuntime.execute 会按 registry 配置 backends（feature-family 同款路径）；
  // 先跑一个最小脚本触发配置，之后 getBrepApi 才可用。
  await run('const p0 = cad.box(1,1,1)\n')
  kernel = getBrepApi()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function run(code: string) {
  const rt = new CadRuntime(ports(), 'brep', { cad: createApiNamespace() })
  const result = await rt.execute(code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  return result.outputs
}

/** 执行脚本取回命名产物（box 位于原点一角，20×20×10，顶面 z=10）。 */
async function box20(): Promise<Shape> {
  const outputs = await run('const p0 = cad.box(20,20,10)\n')
  const s = outputs.get(asPartName('p0'))
  if (!s) throw new Error('no p0 output')
  return s as Shape
}

/** 枚举 faceRef(p0, k) 找到 hint.center.z == 10 的顶面（内核枚举序不写死）。 */
function topFaceRefOf(p0: Shape): { origin: string; role: string } {
  for (let k = 1; k <= 6; k++) {
    const ref = faceRef(p0, k)
    if (Math.abs((ref.hint?.center?.[2] ?? 0) - 10) < 1e-6) {
      return { origin: ref.origin, role: ref.role }
    }
  }
  throw new Error('no top face found among faceRef(p0, 1..6)')
}

describe('resolveSelectorToFaceRefs（选择器 → 句柄 → FaceTopoRef）', () => {
  it('">Z"（Z 极值面）→ 单面引用，origin/role 由命名层分配', async () => {
    const p0 = await box20()
    const refs = resolveSelectorToFaceRefs(p0, '>Z')
    expect(refs).toHaveLength(1)
    expect(refs[0].kind).toBe('face')
    expect(refs[0].origin).toBeTruthy()
    expect(refs[0].role).toBeTruthy()
    expect(refs[0].hint?.center?.[2]).toBeCloseTo(10, 6)
  })

  it('身份一致性：">Z" 的 (origin, role) == 命名层对顶面的 faceRef', async () => {
    const p0 = await box20()
    const bySelector = resolveSelectorToFaceRefs(p0, '>Z')[0]
    const byOrdinal = topFaceRefOf(p0)
    expect(bySelector.origin).toBe(byOrdinal.origin)
    expect(bySelector.role).toBe(byOrdinal.role)
  })

  it('"|Z"（法向平行 Z 的平面面）→ 顶+底两张引用', async () => {
    const p0 = await box20()
    const refs = resolveSelectorToFaceRefs(p0, '|Z')
    expect(refs).toHaveLength(2)
    for (const r of refs) {
      expect(r.kind).toBe('face')
      expect(r.origin).toBeTruthy()
      expect(r.role).toBeTruthy()
    }
  })

  it('网格链/无名实体输入 → 抛 TopoRefError（不静默降级）', async () => {
    // 无命名槽的裸 solid 包装成 Shape：桥应报 E_TOPO_NOT_FOUND（无命名上下文）
    // 而不是硬取序号。构造：无脚本执行、无 slot 的裸句柄。
    const { primitiveToBrepSolid } = await import('../../src/primitives/brep-primitives')
    const { solidToShape } = await import('../../src/brep/brep-ops')
    const { fromBrep } = await import('../../src/shape')
    const { solid } = primitiveToBrepSolid(kernel!, 'box', { width: 20, depth: 20, height: 10 })
    const naked = fromBrep(solidToShape(kernel!, solid), { solid })
    expect(() => resolveSelectorToFaceRefs(naked, '>Z')).toThrow(TopoRefError)
  })
})

describe('resolveSelectorToEdgeRefs（选择器 → 句柄 → EdgeTopoRef）', () => {
  it('"|Z"（切线平行 Z 的边）→ 四条竖边，faces 对齐全', async () => {
    const p0 = await box20()
    const refs = resolveSelectorToEdgeRefs(p0, '|Z')
    expect(refs).toHaveLength(4)
    for (const r of refs) {
      expect(r.kind).toBe('edge')
      expect(r.faces).toHaveLength(2)
      for (const q of r.faces) {
        expect(q.origin).toBeTruthy()
        expect(q.role).toBeTruthy()
      }
      expect(r.hint).toBeDefined()
    }
  })
})

describe('resolveSelectorToVertexPts（选择器 → 顶点坐标）', () => {
  it('">Z"（Z 极值顶点）→ 四个角点，坐标在 z=10 平面', async () => {
    const p0 = await box20()
    const pts = resolveSelectorToVertexPts(p0, '>Z')
    expect(pts).toHaveLength(4)
    for (const p of pts) {
      expect(p.z).toBeCloseTo(10, 6)
      expect([0, 20]).toContain(p.x)
      expect([0, 20]).toContain(p.y)
    }
  })
})
