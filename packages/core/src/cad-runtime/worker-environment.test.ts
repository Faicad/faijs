/**
 * Worker-like environment tests — faijs worker 迁移（方案 §7 阶段 5）
 *
 * 验证原则：
 * 1. 本测试运行于 vitest node 环境——无 window / document / localStorage，
 *    与专用 Web Worker 环境一致（worker-like）。测试开头显式钉死该前提。
 * 2. 同一段脚本分别经 browser 宿主路径（createBrowserPorts({ useWorker: false,
 *    events: 零 DOM EventSink })）与 node 宿主路径（createNodePorts）执行，
 *    断言两条路径的 mesh 产出逐字节一致（positions/indices 全元素相等 +
 *    computeContentKey 相等）。
 * 3. 同一段脚本分别以 mesh 模式与 brep 模式执行，断言最终 mesh 几何指标
 *    一致（包围盒偏差 < 1/1000、体积/表面积相对偏差 < 1/1000）。
 *
 * 与 brep-mesh-equivalence.test.ts 的分工：那份钉死「op 矩阵上 mesh/BREP 两实现
 * 等价」；本文件钉死「同一实现跨宿主环境（browser-safe 入口 vs node 宿主）
 * 产出一致」，即 worker 内执行栈的环境安全性。
 *
 * 运行：npx vitest run src/cad-runtime/worker-environment.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime } from '@faicad/faijs'
import { createBrowserPorts } from '../browser-host'
import { createNodePorts } from '../node-host'
import type { HostPorts } from './ports'
import type { ExecutionResult } from './runtime'
import type { ExecutionMode } from './ports'
import type { Shape } from '../mesh/types'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { ensureTestFontLoader } from '../brep/text/fontTestHelper'
import { computeContentKey } from './content-key'
import { asPartName } from '../identity'

// ── worker-like 环境前提钉死 ──
// 若未来有人在 vitest 配置里给本文件换上 DOM 环境，这里立刻失败——
// 那会使「worker 内无 DOM」的验证失去意义。
describe('environment', () => {
  it('runs without window/document/localStorage (worker-like)', () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
    expect(typeof localStorage).toBe('undefined')
  })
})

// ── 测试脚本 ──
// 覆盖：基础几何 + 布尔 + 变换（与 execute-code.test.ts 的 CODE 同源形态，
// box 用位置参数形态——对象形态 box({ size }) 已移除）。
const SCRIPT = [
  'let part0 = cad.box(20, 20, 20, { centered: true })',
  'let part1 = cad.sphere({ radius: 10 })',
  'let part2 = cad.union(part0, part1)',
  'let part3 = cad.translate(part2, { offset: [5, 0, 0] })',
].join('\n')

// ── 执行辅助 ──

/** 零 DOM EventSink：worker 侧将注入的 sink 形态（方案 §5.3 WorkerEventSink 的前提） */
function nullEventSink() {
  return { emit: () => {} }
}

type MeshByName = Map<string, { positions: Float32Array; indices: Uint32Array }>

/** 从执行结果提取纯 mesh outputs（compound 无 mesh，跳过），按 partName 排序返回 */
function extractMeshes(result: ExecutionResult): MeshByName {
  const out: MeshByName = new Map()
  for (const [name, shape] of result.outputs) {
    if (!('positions' in shape) || !('indices' in shape)) continue
    out.set(String(name), {
      positions: (shape as Shape).positions,
      indices: (shape as Shape).indices,
    })
  }
  if (out.size === 0) throw new Error('no mesh outputs produced')
  return out
}

async function runOnBrowserPath(mode: ExecutionMode): Promise<ExecutionResult> {
  const ports = await createBrowserPorts({ useWorker: false, events: nullEventSink() })
  const runtime = createRuntime(ports, mode)
  return runtime.execute(SCRIPT)
}

async function runOnNodePath(mode: ExecutionMode): Promise<ExecutionResult> {
  const ports = createNodePorts() as unknown as HostPorts | Promise<HostPorts>
  const resolved = await ports
  const runtime = createRuntime(resolved, mode)
  return runtime.execute(SCRIPT)
}

// ── 断言辅助 ──

/** 逐字节一致：长度相等 + 全元素相等 + computeContentKey 相等 */
function assertByteIdentical(a: MeshByName, b: MeshByName) {
  expect([...a.keys()].sort()).toEqual([...b.keys()].sort())
  for (const name of a.keys()) {
    const ma = a.get(name)!
    const mb = b.get(name)!
    expect(ma.positions.length, `${name} positions length`).toBe(mb.positions.length)
    expect(ma.indices.length, `${name} indices length`).toBe(mb.indices.length)
    for (let i = 0; i < ma.positions.length; i++) {
      if (ma.positions[i] !== mb.positions[i]) {
        throw new Error(
          `${name} positions differ at [${i}]: ${ma.positions[i]} !== ${mb.positions[i]}`,
        )
      }
    }
    for (let i = 0; i < ma.indices.length; i++) {
      if (ma.indices[i] !== mb.indices[i]) {
        throw new Error(`${name} indices differ at [${i}]: ${ma.indices[i]} !== ${mb.indices[i]}`)
      }
    }
    // computeContentKey 是项目几何内容寻址的权威 hash，双保险
    expect(computeContentKey(ma.positions, ma.indices), `${name} contentKey`)
      .toBe(computeContentKey(mb.positions, mb.indices))
  }
}

// ── 几何指标（mesh vs brep 等价断言用） ──

interface GeometricMetrics {
  bboxMin: [number, number, number]
  bboxMax: [number, number, number]
  volume: number
  surfaceArea: number
}

function computeMetrics(shape: Shape): GeometricMetrics {
  let xmin = Infinity, ymin = Infinity, zmin = Infinity
  let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity
  let volume = 0
  let surfaceArea = 0

  const { positions, indices } = shape
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (x < xmin) xmin = x; if (x > xmax) xmax = x
    if (y < ymin) ymin = y; if (y > ymax) ymax = y
    if (z < zmin) zmin = z; if (z > zmax) zmax = z
  }
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3
    const ib = indices[i + 1] * 3
    const ic = indices[i + 2] * 3
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2]
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2]
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2]

    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const crossX = uy * vz - uz * vy
    const crossY = uz * vx - ux * vz
    const crossZ = ux * vy - uy * vx
    const area = 0.5 * Math.sqrt(crossX ** 2 + crossY ** 2 + crossZ ** 2)
    surfaceArea += area
    volume += (ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - az * by)) / 6
  }
  return {
    bboxMin: [xmin, ymin, zmin],
    bboxMax: [xmax, ymax, zmax],
    volume: Math.abs(volume),
    surfaceArea,
  }
}

const BBOX_TOLERANCE = 0.001   // 相对包围盒对角线
const METRIC_TOLERANCE = 0.001 // 相对值

function assertMeshBrepEquivalent(meshShape: Shape, brepShape: Shape) {
  const m = computeMetrics(meshShape)
  const b = computeMetrics(brepShape)

  const diag = Math.sqrt(
    (m.bboxMax[0] - m.bboxMin[0]) ** 2 +
    (m.bboxMax[1] - m.bboxMin[1]) ** 2 +
    (m.bboxMax[2] - m.bboxMin[2]) ** 2,
  )
  const bboxAbsTol = Math.max(diag * BBOX_TOLERANCE, 0.01)
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(m.bboxMin[i] - b.bboxMin[i])).toBeLessThanOrEqual(bboxAbsTol)
    expect(Math.abs(m.bboxMax[i] - b.bboxMax[i])).toBeLessThanOrEqual(bboxAbsTol)
  }

  const volRel = Math.abs(m.volume - b.volume) / Math.max(m.volume, 1e-9)
  const areaRel = Math.abs(m.surfaceArea - b.surfaceArea) / Math.max(m.surfaceArea, 1e-9)
  expect(volRel, 'volume relative deviation').toBeLessThan(METRIC_TOLERANCE)
  expect(areaRel, 'surface area relative deviation').toBeLessThan(METRIC_TOLERANCE)
}

/** 取最后一个终端的 mesh shape（与 brep-mesh-equivalence.test.ts 同口径） */
function lastMeshShape(result: ExecutionResult): Shape {
  if (result.failedAt) {
    throw new Error(`Execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const shapeNames = [...result.outputs.keys()]
  if (shapeNames.length === 0) throw new Error('No geometry outputs')
  const last = shapeNames[shapeNames.length - 1]
  const shape = result.outputs.get(last)
  if (!shape || !('positions' in shape) || !('indices' in shape)) {
    throw new Error(`Output for "${last}" is not a mesh shape (compound?)`)
  }
  return shape as Shape
}

// ── brep 模式需要 OCCT ──
beforeAll(async () => {
  await registerOcctBrepEngine()
  ensureTestFontLoader()
}, 120000)

// ── 测试 ──

describe('worker-like environment: browser path vs node baseline', () => {
  it('mesh 模式：同一段脚本两条宿主路径产出逐字节一致的 mesh', async () => {
    const browserResult = await runOnBrowserPath('mesh')
    const nodeResult = await runOnNodePath('mesh')

    expect(browserResult.failedAt ?? null).toBeNull()
    expect(nodeResult.failedAt ?? null).toBeNull()

    assertByteIdentical(extractMeshes(browserResult), extractMeshes(nodeResult))
  })

  it('brep 模式：同一段脚本两条宿主路径产出逐字节一致的 mesh', async () => {
    const browserResult = await runOnBrowserPath('brep')
    const nodeResult = await runOnNodePath('brep')

    expect(browserResult.failedAt ?? null).toBeNull()
    expect(nodeResult.failedAt ?? null).toBeNull()

    assertByteIdentical(extractMeshes(browserResult), extractMeshes(nodeResult))
  })

  it('两条路径 terminals 一致（执行结构不受宿主环境影响）', async () => {
    const browserResult = await runOnBrowserPath('mesh')
    const nodeResult = await runOnNodePath('mesh')

    expect(browserResult.terminals.map((t) => String(t.id)))
      .toEqual(nodeResult.terminals.map((t) => String(t.id)))
    // 脚本定义了 part0..part3，终端应齐全
    for (const part of ['part0', 'part1', 'part2', 'part3']) {
      expect(browserResult.outputs.has(asPartName(part))).toBe(true)
    }
  })
})

describe('worker-like environment: mesh vs brep mode equivalence', () => {
  it('同一段脚本 mesh 版与 brep 版最终 mesh 几何指标一致（< 1/1000）', async () => {
    const meshResult = await runOnBrowserPath('mesh')
    const brepResult = await runOnBrowserPath('brep')

    expect(meshResult.failedAt ?? null).toBeNull()
    expect(brepResult.failedAt ?? null).toBeNull()

    assertMeshBrepEquivalent(lastMeshShape(meshResult), lastMeshShape(brepResult))
  })
})
