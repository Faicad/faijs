/**
 * fillet per-edge breakdown — OCCT 内核（web 默认）对照契约（2026-10-16）。
 *
 * 见 fillet-per-edge-brepkit.test.ts 的文件头（同一用户主线 bug 的双内核对照）。
 * OCCT 断言：sketch+extrude 长方体 12 条边逐条圆角全部健康（execute 成功 + 体积>0）。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { createNodePorts } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { asPartName, type PartName } from '@faicad/faijs/identity'
import type { CadRuntime, ExecutionResult } from '@faicad/faijs/cad-runtime/runtime'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
import { createEditorRuntime } from '../_support/editor-runtime'

const SKETCH_EXTRUDE = `
  const sk0 = cad.sketch({ shapes:[{kind:'rect', cx:0, cy:0, w:26, d:34}], constraints:[], plane:'XZ' })
  const part0 = cad.extrude(sk0, { length:10, normal:[0,-1,0] })
`

async function edgeRefsOf(runtime: CadRuntime, code: string): Promise<Array<{ ei: number; faces: unknown }>> {
  const base = await runtime.execute(code, { topology: 'auto' })
  expect(base.failedAt, 'sketch+extrude 基线').toBeUndefined()
  const rows = base.naming?.get(asPartName('part0'))?.edgeNaming ?? []
  expect(rows.length, 'edgeNaming 行数应为 12').toBe(12)
  const refs: Array<{ ei: number; faces: unknown }> = []
  for (let ei = 0; ei < rows.length; ei++) {
    const faces = rows[ei].faces
    if (Array.isArray(faces) && faces.length >= 2) refs.push({ ei, faces })
  }
  return refs
}

function volumeOf(result: ExecutionResult, partName: PartName): number {
  const kernel = result.brepChain.kernel as BrepEngineApi
  const solid = result.brepChain.solidCache.get(partName)
  if (!solid) throw new Error(`no BREP solid for ${partName}`)
  return kernel.getVolume(solid)
}

describe('fillet per-edge breakdown（OCCT 内核 = web 默认）', () => {
  let runtime: CadRuntime

  beforeAll(async () => {
    await registerOcctBrepEngine()
  }, 120000)

  beforeEach(() => {
    runtime = createEditorRuntime(createNodePorts(), 'brep')
  })
  afterEach(() => runtime.dispose())

  it('T-E1: sketch+extrude 长方体 12 条边逐条圆角（radius 2）全部健康', async () => {
    const refs = await edgeRefsOf(runtime, SKETCH_EXTRUDE)
    expect(refs.length).toBe(12)
    for (const { ei, faces } of refs) {
      const code = `${SKETCH_EXTRUDE}\nconst part1 = cad.fillet(part0, { edges: [{kind:'edge',faces:${JSON.stringify(faces)},hint:{kind:'edge'}}], radius: 2 })`
      const res = await runtime.execute(code, { topology: 'auto' })
      expect(res.failedAt, `edge#${ei} execute 失败`).toBeUndefined()
      expect(res.brepChain.solidCache.has(asPartName('part1')), `edge#${ei} 无 BREP 实体`).toBe(true)
      const vol = volumeOf(res, asPartName('part1'))
      expect(vol, `edge#${ei} 体积退化`).toBeGreaterThan(0)
    }
  })
})
