/**
 * @vitest-environment node
 *
 * 验证 buildSolidTopologyRuntime 能在 svgToSolid 产出的 solid 上正常运行。
 * 这是浏览器端 BREP execution 的关键步骤——如果这里失败，浏览器端拓扑重建也会失败。
 */

const occtOrigLog = console.log
console.log = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  if (msg.includes('Statistics on Transfer') || msg.includes('Transfer Mode') || msg.trim() === '') return
  occtOrigLog(...args)
}

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { initOcctWasm, getKernel } from '../../occt-kernel/occtKernel'
import type { BrepEngineApi } from '../engine/primitives'
import { svgToSolid } from './svg-to-solid'
import { buildSolidTopologyRuntime } from '../brep-topology'

let kernel: BrepEngineApi

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel() as unknown as BrepEngineApi
}, 120000)

describe('buildSolidTopologyRuntime with SVG-derived solid', () => {
  const logoSvg = readFileSync(fileURLToPath(new URL('../../../../fixtures/data/svg/logo111.svg', import.meta.url)), 'utf-8')

  it('should build topology from logo111.svg solid without errors', () => {
    const solid = svgToSolid(kernel, logoSvg, { depth: 5, targetLongSide: 20 })
    expect(solid).toBeDefined()

    // This is the critical test — if this throws, we've found the browser-side failure
    const topo = buildSolidTopologyRuntime(kernel, solid)
    expect(topo).toBeDefined()
    expect(topo.runtime).toBeDefined()
    expect(topo.runtime.faces.length).toBeGreaterThan(0)
    expect(topo.mesh.positions.length).toBeGreaterThan(0)
    expect(topo.mesh.indices.length).toBeGreaterThan(0)

    console.log('[TEST] topology faces:', topo.runtime.faces.length)
    console.log('[TEST] mesh positions:', topo.mesh.positions.length)

    kernel.release(solid)
  })

  it('should build topology from simple rectangle SVG solid', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z"/></svg>'
    const solid = svgToSolid(kernel, svg, { depth: 5, targetLongSide: 20 })
    const topo = buildSolidTopologyRuntime(kernel, solid)
    expect(topo.runtime.faces.length).toBeGreaterThan(0)
    kernel.release(solid)
  })
})
