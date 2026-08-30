/**
 * B4 — mock 库 fixture：mesh 版（B4）
 *
 * 设计文档：docs/plans/2026-08-29-faijs-module-runtime-plan.md §7.3 B4 / §4.4
 *
 * 模拟第三方库模块（`import * as mech from 'mech-lib'` 的目标）：
 * - 带 `contractVersion`（= CONTRACT_VERSION，registerLib 校验通过）
 * - 函数从 faijs SDK（@faicad/faijs/sdk）构造 Shape
 * - 本文件是 **mesh 版**：产物用 `solid()` 构造，无 BREP 槽
 *
 * 与真实库的差异：真实库打包后走构建期预 bundle / CDN external（B2/B3），
 * 这里直接以源码形态注册，验证 registerLib → ns.<binding>.<callee> 全链路。
 */

import { solid, CONTRACT_VERSION, type SolidShape } from '@faicad/faijs-core/sdk'

/** Adapter contract version, checked against CONTRACT_VERSION by registerLib. */
export const contractVersion = CONTRACT_VERSION

/**
 * Build a cube as a faijs SolidShape with no BREP slot (mesh only).
 * @param params - configuration for the cube; `size` is the edge length.
 * @returns the cube as a mesh-based faijs SolidShape.
 */
export function makeHeadstock(params: { size: number }): SolidShape {
  const s = params.size / 2
  const positions = new Float32Array([
    -s, -s, -s, s, -s, -s, s, s, -s, -s, s, -s,
    -s, -s, s, s, -s, s, s, s, s, -s, s, s,
  ])
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
  ])
  return solid({ positions, indices })
}

/**
 * Build a sphere as a faijs SolidShape with no BREP slot (mesh only),
 * approximated by subdivision to demonstrate mesh-only library diversity.
 * @param params - configuration for the sphere; `radius` is the sphere radius.
 * @returns the sphere as a mesh-based faijs SolidShape.
 */
export function makeBall(params: { radius: number }): SolidShape {
  const r = params.radius
  const positions: number[] = []
  const indices: number[] = []
  const segments = 12
  for (let i = 0; i <= segments; i++) {
    const phi = (Math.PI * i) / segments
    for (let j = 0; j <= segments; j++) {
      const theta = (2 * Math.PI * j) / segments
      positions.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
      )
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j
      const b = a + segments + 1
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  return solid({
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  })
}
