import { describe, expect, it } from 'vitest'
import { CAM_TOOLPATH_TOOL_HEAD_NAME, flattenCamToolpathProgram } from '../src/simulator.js'
import { buildLinearToolpathPath, makeEmptyCamToolpathProgram, makeFlatEndMillCutter } from '../src/types.js'
import { normalizeCamMachineProfile } from '../src/profile.js'

const MACHINE = normalizeCamMachineProfile({ name: 'Test Mill', maxSpindleRPM: 24000, safeParkZ: 15 })

describe('flattenCamToolpathProgram', () => {
  it('flattens paths into ordered segments with cumulative distances', () => {
    const program = makeEmptyCamToolpathProgram({ operationId: 'op', operationName: 'Op', machine: MACHINE, safeZ: 15 })
    program.paths.push(
      buildLinearToolpathPath({
        id: 'p1',
        operationId: 'op',
        operationName: 'Op',
        positions: [[0, 0, 0], [10, 0, 0], [10, 10, 0]],
        cutter: makeFlatEndMillCutter({ diameter: 3 }),
        feedRate: 800,
        plungeRate: 200,
        spindleRPM: 12000,
      }),
    )
    const segments = flattenCamToolpathProgram(program)
    expect(segments.length).toBe(2)
    expect(segments[0].start).toEqual([0, 0, 0])
    expect(segments[0].end).toEqual([10, 0, 0])
    expect(segments[0].startDistance).toBe(0)
    expect(segments[0].endDistance).toBe(10)
    expect(segments[1].startDistance).toBe(10)
    expect(segments[1].endDistance).toBeCloseTo(20, 4)
    expect(segments[0].kind).toBe('cut')
  })

  it('returns [] for empty/null programs', () => {
    expect(flattenCamToolpathProgram(null)).toEqual([])
    expect(flattenCamToolpathProgram(undefined)).toEqual([])
  })
})

describe('simulator constants', () => {
  it('exposes stable group/tool-head names', () => {
    expect(CAM_TOOLPATH_TOOL_HEAD_NAME).toMatch(/^__CAM_TOOLPATH/)
  })
})
