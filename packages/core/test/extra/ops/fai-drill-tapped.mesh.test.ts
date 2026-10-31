/**
 * ops/fai_drill — `holeType:'tapped'` 在 **mesh 链**的行为。
 *
 * mesh 链没有拓扑身份（`cad.faceRef` 直接抛 `E_TOPO_MESH_UNSUPPORTED`），所以
 * 螺纹孔标注必须靠 `axis` 定位器工作——这正是本文件要钉住的点：
 * 1. tapped 也产出 `PmiThreadHole`（两类信息齐全）；
 * 2. `target` 缺省（不伪造一个解析不了的面引用）；
 * 3. 几何只钻底孔：与同参数 simple 的三角数一致。
 *
 * 运行：npx vitest run test/extra/ops/fai-drill-tapped.mesh.test.ts
 */

import { describe, it, expect } from 'vitest'
import { configureBackends, CONTRACT_VERSION } from '../../../src/runtime-state'
import { geoToManifoldMesh } from '../../../src/boolean/csg-backend'
import { boxGeometry } from '../../../src/mesh/meshdata/parametric'
import type { Shape } from '../../../src/mesh/types'
import { fai_drill } from '../../../src/extra/ops/fai_drill'
import { pmiThreads } from '../../../src/api/pmi/query'

/** mesh-only 后端装配：强制走 mesh 实现（无 BREP 内核）。 */
configureBackends({
  contractVersion: CONTRACT_VERSION,
  config: { mode: 'mesh' },
  kernel: { brep: undefined, csg: undefined, sdf: undefined },
  fonts: undefined,
  texture: undefined,
  assets: undefined,
  events: { emit: () => undefined },
} as unknown as Parameters<typeof configureBackends>[0])

/** 40×40×20 的块（z ∈ [-10, 10]）。 */
function block(): Shape {
  return geoToManifoldMesh(boxGeometry(40, 40, 20))
}

async function drill(shape: Shape, params: Record<string, unknown>): Promise<Shape> {
  return (await fai_drill(shape, { position: [0, 0, 10], direction: 'z', ...params })) as Shape
}

describe('fai_drill tapped — mesh 链', () => {
  it('几何只钻底孔：三角数与同参数 simple 一致', async () => {
    const plain = await drill(block(), { diameter: 5, depth: 16, holeType: 'simple' })
    const tapped = await drill(block(), { diameter: 5, depth: 16, holeType: 'tapped', screwSpecIdx: 5, threadDepth: 14 })
    expect(tapped.indices.length).toBe(plain.indices.length)
  })

  it('产出螺纹孔标注：两类信息齐全，且不伪造拓扑引用', async () => {
    const tapped = await drill(block(), { holeType: 'tapped', screwSpecIdx: 5, depth: 16, threadDepth: 14 })
    const items = pmiThreads(tapped)
    expect(items).toHaveLength(1)
    const item = items[0]!
    expect(item.pilot).toEqual({ diameter: 5, depth: 16 })
    expect(item.thread.nominalDiameter).toBe(6)
    expect(item.thread.depth).toBe(14)
    expect(item.process).toBe('tapped')
    expect(item.axis.origin).toEqual([0, 0, 10])
    expect(item.axis.direction).toEqual([0, 0, -1])
    // mesh 链没有 role 血统 ⇒ 不给 target（消费者用 axis 定位）
    expect(item.target).toBeUndefined()
  })

  it('多次钻孔后标注累积', async () => {
    let p = block()
    p = await drill(p, { position: [-8, 0, 10], holeType: 'tapped', screwSpecIdx: 5, depth: 12, threadDepth: 9 })
    p = await drill(p, { position: [8, 0, 10], holeType: 'tapped', screwSpecIdx: 5, depth: 12, threadDepth: 9 })
    expect(pmiThreads(p)).toHaveLength(2)
  })
})
