/**
 * @vitest-environment node
 *
 * BREP 拓扑与 STEP_T 一致性测试 — 圆柱钻孔案例
 *
 * 核心验证：buildSolidTopologyRuntime 直接从 OCCT solid 生成的拓扑数据，
 * 与将同一 solid 导出为 STEP 再导入后生成的 STEP_T 拓扑数据一致。
 *
 * 运行时禁止 STEP round-trip，但测试中用 round-trip 验证同源算法的正确性。
 *
 * 运行：npx vitest run src/brep/brep-topology.test.ts
 */

// ─── OCCT stdout 噪声过滤 ───
const occtOrigLog = console.log
console.log = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  const isOcctNoise =
    msg.includes('Statistics on Transfer') ||
    msg.includes('Transfer Mode =') ||
    msg.includes('Transferring Shape') ||
    msg.includes('WorkSession') ||
    /^\*{4,}/.test(msg) ||
    msg.startsWith(' Step File Name')
  if (isOcctNoise || msg.trim() === '') return
  occtOrigLog(...args)
}

import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm, getKernel } from '../occt-kernel/occtKernel'
import { primitiveToBrepSolid } from '../primitives/brep-primitives'
import { buildSolidTopologyRuntime } from './brep-topology'
import { buildAssemblySelectorManifest } from '../occt-kernel/topologyExt'
import { buildSelectorRuntime } from '../topology/build-selector-runtime'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import type { SelectorRuntime } from '../topology/types'

let kernel: OcctKernel

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel()
}, 120000)

// ── 从 STEP 文件提取 STEP_T 拓扑数据（"正确答案"） ──

/**
 * 从 OCCT solid 导出 STEP 文件，再导入，提取 STEP_T 拓扑。
 * 产出的数据就是"正确的 STEP_T 拓扑数据"。
 */
function extractStepTTopology(k: OcctKernel, solid: ShapeHandle): SelectorRuntime {
  const stepText = k.exportStep(solid)
  const stepBuf = new TextEncoder().encode(stepText).buffer
  const importedShape = k.importStep(stepBuf)

  try {
    const bbox = k.getBoundingBox(importedShape, false)
    const diag = Math.sqrt(
      (bbox.xmax - bbox.xmin) ** 2 +
      (bbox.ymax - bbox.ymin) ** 2 +
      (bbox.zmax - bbox.zmin) ** 2,
    )
    const linearDeflection = Math.max(diag * 0.001, 0.01)
    const mesh = k.meshShape(importedShape, {
      linearDeflection,
      angularDeflection: 0.5,
    })

    const result = buildAssemblySelectorManifest([{
      labelPath: 'o1',
      shapeHandle: importedShape,
      meshWithGroups: mesh,
    }])

    const bundle = {
manifest: result.manifest as unknown as import('../topology/types').SelectorManifest,
  buffers: result.buffers as unknown as import('../topology/types').SelectorBuffers,
    }
    return buildSelectorRuntime(bundle, { scale: 1 })
  } finally {
    k.release(importedShape)
  }
}

// ── 测试案例 ──

describe('BREP 拓扑与 STEP_T 一致性: 圆柱钻孔', () => {
  it('buildSolidTopologyRuntime 与 STEP_T 拓扑数据一致', () => {
    // 创建圆柱体 → 钻孔
    const cylResult = primitiveToBrepSolid(kernel, 'cylinder', { radius: 10, height: 20 })
    const cylSolid = cylResult.solid
    try {
      const drillResult = primitiveToBrepSolid(kernel, 'cylinder', { radius: 3, height: 30 })
      const drillSolid = drillResult.solid
      try {
        const positionedDrill = kernel.translate(drillSolid, 0, 0, -5)
        const drilled = kernel.cut(cylSolid, positionedDrill)
        kernel.release(positionedDrill)
        try {
          const brep = buildSolidTopologyRuntime(kernel, drilled).runtime
          const stepT = extractStepTTopology(kernel, drilled)

          // 面数量一致
          expect(brep.faces.length).toBe(stepT.faces.length)

          // 面类型一致
          const brepTypes = brep.faces.map(f => f.surfaceType).sort()
          const stepTypes = stepT.faces.map(f => f.surfaceType).sort()
          expect(brepTypes).toEqual(stepTypes)

          // 必须有 2+ 圆柱面（外壁 + 孔壁）
          const cylFaces = brep.faces.filter(f => f.surfaceType === 'cylinder')
          expect(cylFaces.length).toBeGreaterThanOrEqual(2)

          // 必须有 2+ 平面面（顶面 + 底面）
          const planeFaces = brep.faces.filter(f => f.surfaceType === 'plane')
          expect(planeFaces.length).toBeGreaterThanOrEqual(2)

          // proxy buffers 长度一致
          expect(brep.proxy.faceRuns.length).toBe(stepT.proxy.faceRuns.length)
          expect(brep.proxy.edgePositions.length).toBe(stepT.proxy.edgePositions.length)
          expect(brep.proxy.edgeIndices.length).toBe(stepT.proxy.edgeIndices.length)

          // 边数量一致
          expect(brep.edges.length).toBe(stepT.edges.length)

          // 验证 STEP 导出为 ADVANCED_FACE（非三角化）
          const stepText = kernel.exportStep(drilled)
          expect(stepText).toContain('ADVANCED_FACE')
          expect(stepText).not.toContain('POLYGONAL_FACE')
        } finally {
          kernel.release(drilled)
        }
      } finally {
        kernel.release(drillSolid)
      }
    } finally {
      kernel.release(cylSolid)
    }
  })
})
