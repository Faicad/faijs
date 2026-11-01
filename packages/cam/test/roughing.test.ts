import { describe, expect, it } from 'vitest'
import { buildRoughingSlices, buildSliceShadowLoops, generateRoughingToolpath } from '../src/roughing.js'
import type { RoughingParams } from '../src/roughing.js'
import { normalizeCamMachineProfile } from '../src/profile.js'
import { trianglesFromMesh } from '../src/geometry.js'
import { makeBoxMesh } from './helpers.js'

const MACHINE = normalizeCamMachineProfile({ name: 'Test Mill', maxSpindleRPM: 24000, safeParkZ: 15 })

function boxTriangles() {
  // center [0,0,5] → box spans z ∈ [0,10] (matches the z-range of buildRoughingSlices(10,0,2))
  const mesh = makeBoxMesh([20, 20, 10], [0, 0, 5])
  return trianglesFromMesh(mesh.positions, mesh.indices)
}

function run(params: RoughingParams = {}) {
  return generateRoughingToolpath({
    operationId: 'rough',
    operationName: 'Rough',
    machine: MACHINE,
    params,
    triangles: boxTriangles(),
  })
}

describe('buildRoughingSlices', () => {
  it('walks from top down to bottom in stepDown increments', () => {
    const slices = buildRoughingSlices(10, 0, 2)
    expect(slices.length).toBe(5)
    expect(slices[0].topZ).toBe(10)
    expect(slices[0].bottomZ).toBe(8)
    expect(slices[slices.length - 1].bottomZ).toBe(0)
    expect(slices.every((s) => s.index >= 1)).toBe(true)
  })

  it('produces a single slice when range is smaller than stepDown', () => {
    const slices = buildRoughingSlices(10, 9.5, 2)
    expect(slices.length).toBe(1)
  })
})

describe('buildSliceShadowLoops', () => {
  it('projects a closed XY loop for a box slice', () => {
    const slices = buildRoughingSlices(10, 0, 2)
    const loops = buildSliceShadowLoops(boxTriangles(), slices[0])
    expect(loops.length).toBeGreaterThan(0)
    const outer = loops.find((loop) => loop.role === 'outer')
    expect(outer).toBeDefined()
    expect(outer!.points.length).toBeGreaterThanOrEqual(3)
  })
})

describe('generateRoughingToolpath — box end-to-end', () => {
  it('generates one continuous path carrying all level loops', () => {
    const program = run({ stepDown: 2 })
    expect(program.paths.length).toBe(1)
    // 5 slices over z ∈ [0,10] with stepDown 2, all merged into one continuous path
    expect(program.summary.levelCount).toBe(5)
    expect(program.bounds).not.toBeNull()
    // the continuous path carries level loops at the stepDown grid depths
    // (bottomZ of each slice: 8, 6, 4, 2, 0 for a box spanning z ∈ [0,10])
    const validLevels = new Set([8, 6, 4, 2, 0])
    for (const path of program.paths) {
      expect(path.points.length).toBeGreaterThanOrEqual(3)
      const nonSafeZs = path.points
        .filter((point) => point.metadata?.safe !== true)
        .map((point) => Math.round(point.position[2] * 100) / 100)
      expect(nonSafeZs.length).toBeGreaterThanOrEqual(3)
      for (const z of nonSafeZs) {
        expect(validLevels.has(z)).toBe(true)
      }
    }
  })

  it('empty triangles produce an empty program with a warning', () => {
    const program = generateRoughingToolpath({
      operationId: 'rough',
      operationName: 'Rough',
      machine: MACHINE,
      params: {},
      triangles: [],
    })
    expect(program.paths).toEqual([])
    expect(program.warnings.length).toBeGreaterThan(0)
  })

  it('gcode contains plunge and cut commands', () => {
    const program = run({ stepDown: 2 })
    expect(program.gcode).toContain('G21')
    expect(program.gcode).toContain('M3')
    expect(program.gcode).toContain('M2')
  })
})
