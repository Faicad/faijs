/**
 * @vitest-environment node
 *
 * sweep 输出网格的**绕序一致性**（2026-10-21 真机破面回归）
 *
 * 背景（真机证据）：小程序里扫掠体显示"破面 / 面片感"，导出 STL 却看着正常。
 * 根因不是渲染器，也不是几何位置：`cad.sweep` 输出的三角网格里有一部分三角形
 * **以相同方向遍历共享边**（非流形绕序），而渲染层用 `FrontSide` 单面剔除 ——
 * 朝向反的那片被剔掉，表面就露出洞；STL 查看器通常双面渲染，所以看不见。
 *
 * 触发条件（真机参数，单因素实测）：
 *   · 截面 29×27 很大、路径第一段只有 16.3mm 且拐角偏转 35.7°
 *   · 缩截面到 8×8 或去掉拐角 → 0 冲突；两者同时成立才坏
 * 物理成因：拐角内侧截面扫过自身（截面半宽 × cot(拐角/2) ≈ 41mm ≫ 段长 16.3mm），
 * 侧壁平面的边界曲线自交，内核的扇形三角化把凹/自交多边形拆成交错三角形。
 *
 * 这条用例钉的是**输出契约**：无论内核产出什么，`cad.sweep` 交出的网格必须
 * 绕序一致（相邻三角形以相反方向遍历共享边）。faijs 已有 `unifyOrientation`
 * （`mesh/reconcile.ts`），缺的是把它接到 BREP 派生的网格出口上。
 *
 * 为什么断言自己数一遍、不调用 `unifyOrientation`：用被测实现做判据，
 * 算法一错测试就跟着错。
 *
 * Run: npx vitest run test/api/sweep-mesh-winding.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import type { Shape } from '../../src/mesh/types'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

beforeAll(async () => {
  __resetEngineRegistriesForTests()
  await registerBrepkitBrepEngine()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

function makeRuntime(mode: ExecutionMode): CadRuntime {
  return new CadRuntime(ports(), mode, { cad: createApiNamespaceWithEditorOps() })
}

async function exec(mode: ExecutionMode, code: string): Promise<ExecutionResult> {
  return makeRuntime(mode).execute(code)
}

/** 执行代码并取回命名产物（失败即抛，失败点带 callee）。 */
async function shapeOf(mode: ExecutionMode, code: string, part: string): Promise<Shape> {
  const result = await exec(mode, code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const s = result.outputs.get(asPartName(part))
  if (!s) throw new Error(`no output for ${part}`)
  return s as Shape
}

/**
 * 数出「绕序冲突」的无向边条数。
 *
 * 流形约定：一条无向边必须被两个三角形以**相反方向**遍历。同向 = 冲突
 * （那片三角形被单面渲染剔除，肉眼就是洞）。
 *
 * 先按位置焊接：内核可能把同一位置的顶点拆成多个索引，不焊接就认不出共边。
 * @param positions - flat XYZ vertex buffer.
 * @param indices - triangle index buffer.
 * @returns the number of undirected edges whose two triangles traverse it the same way.
 */
function windingConflicts(positions: Float32Array, indices: Uint32Array): number {
  const vtxCount = positions.length / 3
  const q = (v: number): number => Math.round(v * 1e4)
  const rep = new Int32Array(vtxCount)
  const weld = new Map<string, number>()
  for (let i = 0; i < vtxCount; i++) {
    const k = `${q(positions[i * 3])},${q(positions[i * 3 + 1])},${q(positions[i * 3 + 2])}`
    const seen = weld.get(k)
    if (seen === undefined) {
      weld.set(k, i)
      rep[i] = i
    } else {
      rep[i] = seen
    }
  }

  const edges = new Map<string, number[]>()
  const triCount = indices.length / 3
  for (let t = 0; t < triCount; t++) {
    const a = rep[indices[t * 3]!]!
    const b = rep[indices[t * 3 + 1]!]!
    const c = rep[indices[t * 3 + 2]!]!
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const lo = Math.min(u, v)
      const hi = Math.max(u, v)
      const k = `${lo}|${hi}`
      const dir = u === lo ? 1 : -1
      const arr = edges.get(k)
      if (arr) arr.push(dir)
      else edges.set(k, [dir])
    }
  }

  let conflicts = 0
  for (const dirs of edges.values()) {
    if (dirs.length === 2 && dirs[0] === dirs[1]) conflicts += 1
  }
  return conflicts
}

/** 真机原样的几何：大截面 + 锐拐角的两段折线路径（见文件头）。 */
const DEVICE_SCRIPT = [
  "let sk0 = cad.sketch({ shapes:[{kind:'rect', cx:-0.5, cy:-0.5, w:29, d:27}], constraints:[], plane:'XY' })",
  "let w0 = cad.sketchOnPlane({ contours:[{segments:[{kind:'line', x1:0, y1:0, x2:12, y2:-11},{kind:'line', x1:12, y1:-11, x2:17, y2:-35}]}], plane:{origin:[-0.5,-0.5,0], normal:[-1,0,0], xAxis:[0,0,1]}, as:'wire' })",
  'let part0 = cad.sweep(sk0, w0)',
].join('\n')

describe('sweep — 输出网格绕序一致性', () => {
  it('真机几何（大截面 29×27 + 锐拐角折线）：共享边必须被两侧三角形反向遍历', async () => {
    const s = await shapeOf('brep', DEVICE_SCRIPT, 'part0')
    // 网格非空才有意义（内核真出了体）。
    expect(s.indices.length).toBeGreaterThan(0)
    // 冲突 > 0 时，渲染层 FrontSide 会把那些三角形剔掉 —— 真机上就是可见的洞。
    expect(windingConflicts(s.positions, s.indices)).toBe(0)
  })

  it('小截面 8×8 走同一条折线：本来就 0 冲突（守住断言本身不产生假阳性）', async () => {
    const code = DEVICE_SCRIPT.replace('w:29, d:27', 'w:8, d:8').replace(
      'cx:-0.5, cy:-0.5',
      'cx:-4, cy:-4',
    )
    const s = await shapeOf('brep', code, 'part0')
    expect(windingConflicts(s.positions, s.indices)).toBe(0)
  })
})
