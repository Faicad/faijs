/**
 * faceBySelector — B′ 的桥：语义选择器 → FaceTopoRef。
 *
 * 钉住的核心契约：
 * 1. 轴向选择器（`>Z` 等）与 CadQuery 命名视图（`top` 等）都返回带
 *    origin/role 血统的 `FaceTopoRef`，不是裸几何量。
 * 2. 与按序号的 `faceRef` **同源**：`>Z` 选中的正是所有面里 z 最大的那张。
 * 3. 不支持的语法 / mesh 形状显式抛带码 `TopoRefError`，不静默近似。
 * 4. 脚本面端到端：`cad.faceBySelector(...)` 的结果可直接作为
 *    `addDatum` 的 `target`，PMI 数据模型仍是纯 `TopoRef`。
 *
 * 运行：npx vitest run packages/core/test/api/pmi/pmi-face-by-selector.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../../src/cad-runtime/runtime'
import { initOcctWasm } from '../../../src/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../../../src/brep/engine/adapters/occt'
import { createApiNamespaceWithEditorOps } from '../../support/editor-ops'
import { hostPorts } from '../../support/host-env'
import { asPartName } from '../../../src/identity'
import type { Shape } from '../../../src/mesh/types'
import { solid } from '../../../src/shape'
import { faceBySelector } from '../../../src/api/face-by-selector'
import { faceRef } from '../../../src/api/face-ref'
import { TopoRefError } from '../../../src/topology/naming'
import type { FaceTopoRef } from '../../../src/topology/naming/types'

beforeAll(async () => {
  await initOcctWasm()
  await registerOcctBrepEngine()
}, 120000)

function exec(code: string): Promise<ExecutionResult> {
  return new CadRuntime(hostPorts('node'), 'brep', { cad: createApiNamespaceWithEditorOps() }).execute(code)
}

async function boxShape(): Promise<Shape> {
  const result = await exec('let part0 = cad.box(10, 20, 30)\n')
  expect(result.failedAt).toBeUndefined()
  const shape = result.outputs.get(asPartName('part0'))
  expect(shape).toBeDefined()
  return shape as Shape
}

/** FaceHint 的 center 是可选的（行快照路径可能没采到），统一兜底成 -Infinity。 */
const coord = (r: FaceTopoRef, axis: 0 | 1 | 2): number => r.hint.center?.[axis] ?? -Infinity

describe('faceBySelector — 语义选择器 → FaceTopoRef', () => {
  it('六个轴向选择器都返回带血统的 FaceTopoRef，且方向关系正确', async () => {
    const shape = await boxShape()
    const [top, bottom, right, left, upper, lower] = ['>Z', '<Z', '>X', '<X', '>Y', '<Y']
      .map((s) => faceBySelector(shape, s))
    for (const r of [top, bottom, right, left, upper, lower]) {
      expect(r!.kind).toBe('face')
      expect(r!.origin.length).toBeGreaterThan(0)
      expect(r!.role.length).toBeGreaterThan(0)
      expect(r!.hint.kind).toBe('face')
    }
    expect(coord(top!, 2)).toBeGreaterThan(coord(bottom!, 2))
    expect(coord(right!, 0)).toBeGreaterThan(coord(left!, 0))
    expect(coord(upper!, 1)).toBeGreaterThan(coord(lower!, 1))
  })

  it('六个命名视图与对应轴向选择器指向同一个 role', async () => {
    const shape = await boxShape()
    const pairs: readonly [string, string][] = [
      ['top', '>Y'], ['bottom', '<Y'], ['front', '>Z'],
      ['back', '<Z'], ['right', '>X'], ['left', '<X'],
    ]
    for (const [view, axis] of pairs) {
      expect(faceBySelector(shape, view).role).toBe(faceBySelector(shape, axis).role)
    }
  })

  it('与 faceRef 同源：>Z 正是所有按序号枚举的面里 z 最大的那张', async () => {
    const shape = await boxShape()
    const all: FaceTopoRef[] = []
    for (let n = 1; n <= 6; n++) {
      try { all.push(faceRef(shape, n)) } catch { /* 无血统的面跳过，与 face-ref 测试同口径 */ }
    }
    expect(all.length).toBeGreaterThan(0)
    const maxZ = all.reduce((a, b) => (coord(b, 2) > coord(a, 2) ? b : a))
    const top = faceBySelector(shape, '>Z')
    expect(top.role).toBe(maxZ.role)
    expect(coord(top, 2)).toBe(coord(maxZ, 2))
  })

  it('不支持的语法显式抛 E_TOPO_NOT_FOUND', async () => {
    const shape = await boxShape()
    for (const bad of ['>Z[-2]', '+XY', '???']) {
      try {
        faceBySelector(shape, bad)
        expect.unreachable(`"${bad}" should throw`)
      } catch (e) {
        expect(e).toBeInstanceOf(TopoRefError)
        expect((e as { code: string }).code).toBe('E_TOPO_NOT_FOUND')
      }
    }
  })

  it('mesh 形状抛 E_TOPO_MESH_UNSUPPORTED', async () => {
    await boxShape() // 确保内核已注册，走到 hasBrep 分支而不是 getBrepApi 缺失分支
    const meshShape = solid({} as never)
    try {
      faceBySelector(meshShape, '>Z')
      expect.unreachable('should throw')
    } catch (e) {
      expect(e).toBeInstanceOf(TopoRefError)
      expect((e as { code: string }).code).toBe('E_TOPO_MESH_UNSUPPORTED')
    }
  })
})

describe('B′ 端到端：脚本里把选择器结果喂给 PMI target', () => {
  it('cad.faceBySelector(part0, ">Z") → addDatum → ExecutionResult.pmi', async () => {
    const result = await exec(`
let part0 = cad.box(10, 20, 30)
part0.addDatum({ identifier: 'A', datumType: 'datumPlane', target: cad.faceBySelector(part0, '>Z') })
`)
    expect(result.failedAt).toBeUndefined()
    const entry = result.pmi?.find((p) => String(p.part) === 'part0')
    expect(entry, 'part0 应有 PMI 条目').toBeDefined()
    const datum = entry!.items.find((i) => i.kind === 'datum')
    expect(datum).toBeDefined()
    expect(datum!.kind === 'datum' && datum!.target.kind).toBe('face')
    // TopoRef 是 face|edge 判别联合，`.role` 只在 FaceTopoRef 上——先收窄再访问
    expect(datum!.kind === 'datum' && datum!.target.kind === 'face' && datum!.target.role.length).toBeGreaterThan(0)
  })
})
