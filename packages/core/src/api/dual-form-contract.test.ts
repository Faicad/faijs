/**
 * P1/P2 双形态契约验收（裁决 4 / §4.2 / §4.5）
 *
 * 验证「两种写法必须产出完全相同的几何」（不是近似兼容）：
 * - sphere：`cad.sphere(5, { at, segments })`（brepjs 位置形态）≡
 *   `cad.sphere({ radius: 5, center, segments })`（faijs 对象形态）
 * - translate：`cad.translate(p, [x,y,z])` ≡ `cad.translate(p, { offset: [x,y,z] })`
 *
 * 两种形态在 **mesh 与 brep 两个后端** 下逐一断言（execute 全路径：解析 →
 * 双形态归一 → 各后端消费）。
 *
 * Run: npx vitest run src/api/dual-form-contract.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../cad-runtime/runtime'
import { createApiNamespace } from './api-namespace'
import type { HostPorts } from '../cad-runtime/ports'
import { asPartName } from '../identity'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import type { Shape } from '../mesh/types'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

/** 以指定后端模式执行源码，取 part0 的 mesh Shape（执行失败直接抛）。 */
async function runShape(code: string, mode: 'mesh' | 'brep'): Promise<Shape> {
  const rt = new CadRuntime(defaultPorts(), mode, { cad: createApiNamespace() })
  const result = await rt.execute(code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const shape = result.outputs.get(asPartName('part0'))
  if (!shape) throw new Error(`no output for part0 (${JSON.stringify(code)})`)
  return shape as Shape
}

interface Box {
  min: [number, number, number]
  max: [number, number, number]
  volume: number
  triangleCount: number
}

function computeMetrics(s: Shape): Box {
  const { positions, indices } = s
  const min = [Infinity, Infinity, Infinity] as [number, number, number]
  const max = [-Infinity, -Infinity, -Infinity] as [number, number, number]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k]
      if (v < min[k]) min[k] = v
      if (v > max[k]) max[k] = v
    }
  }
  // 有符号体积（四面体求和，绝对值的 1/6）
  let volume6 = 0
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3
    const b = indices[i + 1] * 3
    const c = indices[i + 2] * 3
    const ux = positions[b] - positions[a]
    const uy = positions[b + 1] - positions[a + 1]
    const uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a]
    const vy = positions[c + 1] - positions[a + 1]
    const vz = positions[c + 2] - positions[a + 2]
    volume6 +=
      positions[a] * (uy * vz - uz * vy) +
      positions[a + 1] * (uz * vx - ux * vz) +
      positions[a + 2] * (ux * vy - uy * vx)
  }
  return { min, max, volume: Math.abs(volume6) / 6, triangleCount: indices.length / 3 }
}

const TOL = 1e-4

function expectBoxEqual(a: Box, b: Box, label: string): void {
  for (let k = 0; k < 3; k++) {
    expect(Math.abs(a.min[k] - b.min[k]), `${label} min[${k}]`).toBeLessThan(TOL)
    expect(Math.abs(a.max[k] - b.max[k]), `${label} max[${k}]`).toBeLessThan(TOL)
  }
  expect(Math.abs(a.volume - b.volume), `${label} volume`).toBeLessThan(TOL * 1000)
}

describe('P1/P2 双形态契约（同一几何，两种写法）', () => {
  for (const mode of ['mesh', 'brep'] as const) {
    describe(`mode=${mode}`, () => {
      it('sphere 位置形态 `sphere(5,{at,segments})` ≡ 对象形态 `sphere({radius,center,segments})`', async () => {
        const positional = await runShape(
          'let part0 = cad.sphere(5, { at: [0, 0, 10], segments: 32 })\n',
          mode,
        )
        const objectForm = await runShape(
          'let part0 = cad.sphere({ radius: 5, center: [0,0,10], segments: 32 })\n',
          mode,
        )
        expectBoxEqual(computeMetrics(objectForm), computeMetrics(positional), 'sphere')
        // 球心应在 [0,0,10]：bbox 中心 = at（32 段三角化的采样偏差 ≤ ~0.03，容差 0.05）
        const m = computeMetrics(objectForm)
        const c = [(m.min[0] + m.max[0]) / 2, (m.min[1] + m.max[1]) / 2, (m.min[2] + m.max[2]) / 2]
        expect(Math.abs(c[0])).toBeLessThan(0.05)
        expect(Math.abs(c[1])).toBeLessThan(0.05)
        expect(Math.abs(c[2] - 10)).toBeLessThan(0.05)
      })

      it('translate 位置形态 `translate(p,[x,y,z])` ≡ 对象形态 `translate(p,{offset})`', async () => {
        const base = 'let part0 = cad.sphere(4, { segments: 24 })\n'
        const positional = await runShape(
          base + 'part0 = cad.translate(part0, [10, 0, 5])\n',
          mode,
        )
        const objectForm = await runShape(
          base + 'part0 = cad.translate(part0, { offset: [10, 0, 5] })\n',
          mode,
        )
        expectBoxEqual(computeMetrics(objectForm), computeMetrics(positional), 'translate')
      })

      it('sphere 裸位置形态 `sphere(5)` ≡ 对象形态 `sphere({radius:5})`', async () => {
        const positional = await runShape('let part0 = cad.sphere(5)\n', mode)
        const objectForm = await runShape('let part0 = cad.sphere({ radius: 5 })\n', mode)
        expectBoxEqual(computeMetrics(objectForm), computeMetrics(positional), 'sphere bare')
      })

      it('scale 位置形态 `scale(p,2,{center})` ≡ 对象形态 `scale(p,{factor:2,center})`（P6 §4.6 裁决 2）', async () => {
        const base = 'let part0 = cad.box(20, 20, 20, { centered: true })\n'
        const positional = await runShape(base + 'part0 = cad.scale(part0, 2, { center: [4, 0, 0] })\n', mode)
        const objectForm = await runShape(base + 'part0 = cad.scale(part0, { factor: 2, center: [4, 0, 0] })\n', mode)
        expectBoxEqual(computeMetrics(objectForm), computeMetrics(positional), 'scale dual-form')
      })

      it('scale3d 位置形态 `scale3d(p,[2,1,0.5])` ≡ 对象形态 `scale3d(p,{factor:[2,1,0.5]})`（P6）', async () => {
        const base = 'let part0 = cad.box(20, 20, 20, { centered: true })\n'
        const positional = await runShape(base + 'part0 = cad.scale3d(part0, [2, 1, 0.5])\n', mode)
        const objectForm = await runShape(base + 'part0 = cad.scale3d(part0, { factor: [2, 1, 0.5] })\n', mode)
        expectBoxEqual(computeMetrics(objectForm), computeMetrics(positional), 'scale3d dual-form')
      })

      it('负例: scale3d(p,2) 标量 factor → E_ARGS_FORM 提示 scale（P6 裁决 2）', async () => {
        const base = 'let part0 = cad.box(20, 20, 20, { centered: true })\n'
        await expect(runShape(base + 'part0 = cad.scale3d(part0, 2)\n', mode)).rejects.toThrow(/E_ARGS_FORM/)
      })
    })
  }
})