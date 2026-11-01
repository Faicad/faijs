import { describe, expect, it } from 'vitest'
import {
  buildLinearToolpathPath,
  makeBallEndMillCutter,
  makeEmptyCamToolpathProgram,
  makeFlatEndMillCutter,
  normalizeCamOrientation,
  roundCamCoord,
  summarizeCamToolpathProgram,
  unionCamBounds,
} from '../src/types.js'
import { normalizeCamMachineProfile } from '../src/profile.js'

describe('roundCamCoord', () => {
  it('quantizes to 1e-4 and strips -0', () => {
    expect(roundCamCoord(1.00001)).toBe(1)
    expect(roundCamCoord(-0)).toBe(0)
    expect(roundCamCoord(3.14159)).toBeCloseTo(3.1416, 4)
  })
})

describe('cutter factories', () => {
  it('builds flat end mill with radius = diameter / 2', () => {
    const cutter = makeFlatEndMillCutter({ diameter: 3.175, cuttingLength: 25, id: 'c1' })
    expect(cutter.kind).toBe('flat-endmill')
    expect(cutter.diameter).toBe(3.175)
    expect(cutter.radius).toBeCloseTo(1.5875, 4)
    expect(cutter.cuttingLength).toBe(25)
    expect(cutter.id).toBe('c1')
  })

  it('builds ball end mill', () => {
    const cutter = makeBallEndMillCutter({ diameter: 2, id: 'c2' })
    expect(cutter.kind).toBe('ball-endmill')
    expect(cutter.radius).toBe(1)
  })

  it('absorbs negative diameters and quantizes sub-resolution values', () => {
    expect(makeFlatEndMillCutter({ diameter: -5 }).diameter).toBe(5)
    // values below the 1e-4 quantization resolution round to 0
    expect(makeFlatEndMillCutter({ diameter: 0 }).diameter).toBe(0)
    expect(makeFlatEndMillCutter({ diameter: 0.00001 }).diameter).toBe(0)
  })
})

describe('normalizeCamOrientation', () => {
  it('defaults tool axis to -Z and normalizes unit length', () => {
    const orientation = normalizeCamOrientation({ toolAxis: [0, 0, -10] })
    expect(orientation.toolAxis).toEqual([0, 0, -1])
  })

  it('keeps forward vector normalized', () => {
    const orientation = normalizeCamOrientation({ toolAxis: [0, 0, -1], forward: [0, 4, 0] })
    expect(orientation.forward).toEqual([0, 1, 0])
  })
})

describe('buildLinearToolpathPath', () => {
  it('builds one segment per consecutive pair and rounds points', () => {
    const path = buildLinearToolpathPath({
      id: 'p1',
      operationId: 'op1',
      operationName: 'Op 1',
      positions: [[0, 0, 0], [1.00001, 0, 0], [2, 0, 0]],
      cutter: makeFlatEndMillCutter({ diameter: 3.175 }),
      feedRate: 800,
      plungeRate: 200,
      spindleRPM: 12000,
    })
    expect(path.points.length).toBe(3)
    expect(path.segments.length).toBe(2)
    expect(path.points[1].position[0]).toBe(1)
    expect(path.segments[0].kind).toBe('cut')
    expect(path.segments[0].cutter?.kind).toBe('flat-endmill')
  })
})

describe('makeEmptyCamToolpathProgram', () => {
  it('produces an empty program with defaults and normalized machine', () => {
    const program = makeEmptyCamToolpathProgram({ operationId: 'x', operationName: 'X' })
    expect(program.schemaVersion).toBe(1)
    expect(program.units).toBe('mm')
    expect(program.coordinateSystem).toBe('machine')
    expect(program.paths).toEqual([])
    expect(program.gcode).toBe('')
    expect(program.machine.name).toBe(normalizeCamMachineProfile(null).name)
    expect(program.summary.warningCount).toBe(0)
    expect(program.bounds).toBeNull()
  })

  it('honors warnings and safeZ', () => {
    const program = makeEmptyCamToolpathProgram({
      operationId: 'x',
      operationName: 'X',
      safeZ: 12,
      warnings: ['w1'],
      machine: normalizeCamMachineProfile({ safeParkZ: 15 }),
    })
    expect(program.safeZ).toBe(12)
    expect(program.warnings).toEqual(['w1'])
    expect(program.summary.warningCount).toBe(1)
  })
})

describe('summarizeCamToolpathProgram', () => {
  it('computes path/point/segment counts and cut vs rapid length', () => {
    const path = buildLinearToolpathPath({
      id: 'p1',
      operationId: 'op1',
      operationName: 'Op 1',
      positions: [[0, 0, 0], [0, 0, -5], [10, 0, -5]],
      cutter: makeFlatEndMillCutter({ diameter: 3 }),
      feedRate: 800,
      plungeRate: 200,
      spindleRPM: 12000,
    })
    const summary = summarizeCamToolpathProgram({ paths: [path], warningCount: 0 })
    expect(summary.pathCount).toBe(1)
    expect(summary.pointCount).toBe(3)
    expect(summary.segmentCount).toBe(2)
    // both segments are 'cut' → all motion counted as cut length = 5 + 10
    expect(summary.estimatedCutLength).toBeCloseTo(15, 2)
    expect(summary.estimatedRapidLength).toBe(0)
    expect(summary.warningCount).toBe(0)
  })
})

describe('unionCamBounds', () => {
  it('returns null for empty list and unions the rest', () => {
    expect(unionCamBounds([])).toBeNull()
    const bounds = unionCamBounds([
      { min: [0, 0, 0], max: [1, 1, 1] },
      { min: [2, 2, 2], max: [3, 3, 3] },
    ])
    expect(bounds).toEqual({ min: [0, 0, 0], max: [3, 3, 3] })
  })
})
