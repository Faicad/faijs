/**
 * brepkit 下球面的两张面行必须各自独立。
 *
 * 回归背景（2026-10-25）：brepkit 没有 hash API，面指纹是适配器**合成**的
 * （`getAnalyticSurfaceParams | faceArea`）。同一张球面在 brepkit 里被拆成两个半球面
 * ——两面的解析参数（sphere/center/radius）与面积（各 157.08）**完全相同**，于是指纹
 * 相撞；`topologyExt` 旧实现用 `Map.set` 只保留最后一个条目，两张面行拿到同一段三角形，
 * center/normal/bbox 全同 → 面粒度点选永远点不出上半球（端侧 `probe-weapp-ops` 的
 * 「sphere 面行几何」断言就是从这条红起来的）。
 *
 * 修法：面组按 hash 存**队列**，同指纹的多张面按产出顺序一一取用（faceGroups 的顺序
 * 与 `getSubShapes(shape,'face')` 同源，都是 `getSolidFaces` 的一次遍历）。
 *
 * 为什么不是"把 UV 域塞进指纹"：brepkit 的 `getSurfaceDomain` 返回**曲面自然域**，
 * 两个半球都是 [0,2π]×[-π/2,π/2]，塞进去也分不开（实测）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { createEditorRuntime } from '../support/editor-ops'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerBrepkitBrepEngine, registerBrepkitMeshEngine } from '../../src/brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../../src/brepkit-kernel/brepkitKernel'

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

describe('brepkit: 球面两张面行各自独立', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    await registerBrepkitMeshEngine()
  })
  afterAll(() => { disposeBrepkit() })

  it('两个半球面的三角形区间 / center / bbox 互不相同', async () => {
    const rt = createEditorRuntime(ports(), 'auto')
    const result = await rt.execute('let p = cad.sphere({ radius: 5, centered: true })')
    expect(result.failedAt).toBeUndefined()

    const faces = result.topology?.get(asPartName('p'))?.data.faces ?? []
    expect(faces.length).toBe(2)

    // 三角形区间必须两两不重叠（撞指纹时两者指向同一段）。
    const runs = faces.map((f) => [f.triangleStart, f.triangleCount] as const)
    for (const [start, count] of runs) expect(count).toBeGreaterThan(0)
    const [a, b] = runs
    expect(a, 'face[0] missing').toBeDefined()
    expect(b, 'face[1] missing').toBeDefined()
    const a0 = a![0]!, a1 = a![1]!, b0 = b![0]!, b1 = b![1]!
    const overlap = Math.max(0, Math.min(a0 + a1, b0 + b1) - Math.max(a0, b0))
    expect(overlap, `两个半球的三角形区间重叠了 ${overlap} 个三角形`).toBe(0)
    // 合起来应当覆盖整个显示 mesh。
    const pShape = result.outputs.get(asPartName('p'))
    const displayTris = (pShape && 'indices' in pShape ? pShape.indices.length : 0) / 3
    expect(a1 + b1).toBe(displayTris)

    // 几何也必须分开：上下半球的面心在 z 上反号，bbox 不跨零。
    const zs = faces.map((f) => f.center?.[2] ?? 0)
    expect(Math.sign(zs[0] ?? 0)).not.toBe(Math.sign(zs[1] ?? 0))
    for (const f of faces) {
      const bb = f.bbox
      expect(bb).toBeTruthy()
      // 半球 bbox 只在 z 的一侧（容差内允许贴 z=0 的赤道）
      const crossesZero = bb!.min[2] < -1e-6 && bb!.max[2] > 1e-6
      expect(crossesZero, `半球面 bbox 跨过了赤道：${JSON.stringify(bb)}`).toBe(false)
    }
  }, 120000)
})
