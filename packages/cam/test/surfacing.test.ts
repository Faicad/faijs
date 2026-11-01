import { describe, expect, it } from 'vitest'
import { generateSurfacingToolpath } from '../src/surfacing.js'
import type { SurfacingParams } from '../src/surfacing.js'
import { normalizeCamMachineProfile } from '../src/profile.js'
import { trianglesFromMesh } from '../src/geometry.js'
import { makeBoxMesh } from './helpers.js'

const MACHINE = normalizeCamMachineProfile({ name: 'Test Mill', maxSpindleRPM: 24000, safeParkZ: 15 })

function boxTriangles() {
  // center [0,0,5] → box spans z ∈ [0,10] (matches roughing test z-range)
  const mesh = makeBoxMesh([20, 20, 10], [0, 0, 5])
  return trianglesFromMesh(mesh.positions, mesh.indices)
}

function run(params: SurfacingParams = {}) {
  const triangles = boxTriangles()
  return generateSurfacingToolpath({
    operationId: 'finish',
    operationName: 'Finish',
    machine: MACHINE,
    params,
    faceTriangles: triangles,
    obstacleTriangles: triangles,
  })
}

describe('generateSurfacingToolpath — box end-to-end', () => {
  it('generates a non-empty toolpath over a 20x20x10 box', () => {
    const program = run({ rasterDirection: 'Both' })
    expect(program.paths.length).toBeGreaterThan(0)
    expect(program.summary.pathCount).toBe(program.paths.length)
    expect(program.summary.pointCount).toBeGreaterThan(10)
    expect(program.bounds).not.toBeNull()
    expect(program.safeZ).toBeGreaterThanOrEqual(15)
    // +Z up: toolpath never dips below the stock bottom
    for (const path of program.paths) {
      for (const point of path.points) {
        expect(point.position[2]).toBeGreaterThanOrEqual(-0.05)
      }
    }
  })

  it('is deterministic (same inputs → identical output)', () => {
    const a = run({ rasterDirection: 'X' })
    const b = run({ rasterDirection: 'X' })
    expect(a.paths.length).toBe(b.paths.length)
    expect(JSON.stringify(a.bounds)).toBe(JSON.stringify(b.bounds))
  })

  it('rasterDirection Both produces more paths than X alone', () => {
    const single = run({ rasterDirection: 'X' })
    const both = run({ rasterDirection: 'Both' })
    expect(both.paths.length).toBeGreaterThan(single.paths.length)
  })

  it('returns an empty program with warnings when no faces are selected', () => {
    const program = generateSurfacingToolpath({
      operationId: 'finish',
      operationName: 'Finish',
      machine: MACHINE,
      params: {},
      faceTriangles: [],
      obstacleTriangles: boxTriangles(),
    })
    expect(program.paths).toEqual([])
    expect(program.warnings.length).toBeGreaterThan(0)
  })

  it('clamps spindleRPM to machine max', () => {
    const program = run({ spindleRPM: 99999 })
    expect(program.spindleRPM).toBe(MACHINE.maxSpindleRPM)
  })

  it('degrades an oversized sampling grid to an empty program with a warning', () => {
    const triangles = boxTriangles()
    const program = generateSurfacingToolpath({
      operationId: 'x',
      operationName: 'X',
      machine: MACHINE,
      // minSampleSpacing below ~0.0001 blows past the 4M cell gate on a 20x20 area
      params: { sampleSpacing: 0.0001, minSampleSpacing: 0.0001 },
      faceTriangles: triangles,
      obstacleTriangles: triangles,
    })
    expect(program.paths).toEqual([])
    expect(program.warnings.some((warning) => /too dense/i.test(warning))).toBe(true)
  })

  it('gcode contains modal setup, spindle and end commands', () => {
    const program = run()
    expect(program.gcode).toContain('G21')
    expect(program.gcode).toContain('G90')
    expect(program.gcode).toContain('M3')
    expect(program.gcode).toContain('M5')
    expect(program.gcode).toContain('M2')
    expect(program.gcode).toContain('F')
  })
})
