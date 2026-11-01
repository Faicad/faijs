import { describe, expect, it } from 'vitest'
import { combineCamToolpathPrograms, generateGcodeForCamToolpathProgram } from '../src/gcode.js'
import { buildLinearToolpathPath, makeEmptyCamToolpathProgram, makeFlatEndMillCutter } from '../src/types.js'
import { normalizeCamMachineProfile } from '../src/profile.js'

const MACHINE = normalizeCamMachineProfile({ name: 'Test Mill', maxSpindleRPM: 24000, safeParkZ: 15 })

function makePath(operationId: string, z = 0) {
  return buildLinearToolpathPath({
    id: `${operationId}-P1`,
    operationId,
    operationName: operationId,
    positions: [[0, 0, z], [10, 0, z], [10, 10, z]],
    cutter: makeFlatEndMillCutter({ diameter: 3 }),
    feedRate: 800,
    plungeRate: 200,
    spindleRPM: 12000,
  })
}

describe('generateGcodeForCamToolpathProgram', () => {
  it('emits modal setup, header/footer macros and M-codes', () => {
    const program = makeEmptyCamToolpathProgram({
      operationId: 'op',
      operationName: 'Op',
      machine: MACHINE,
      safeZ: 15,
      cutter: makeFlatEndMillCutter({ diameter: 3 }),
      spindleRPM: 12000,
    })
    program.paths.push(makePath('op'))
    const gcode = generateGcodeForCamToolpathProgram(program)
    expect(gcode).toContain('G21')
    expect(gcode).toContain('G90')
    expect(gcode).toContain('G0')
    expect(gcode).toContain('M3')
    expect(gcode).toContain('M5')
    expect(gcode).toContain('M2')
    expect(gcode).toContain('S12000')
  })

  it('honors stripComments', () => {
    const program = makeEmptyCamToolpathProgram({
      operationId: 'op',
      operationName: 'Op',
      machine: normalizeCamMachineProfile({ stripComments: true }),
      safeZ: 15,
    })
    const gcode = generateGcodeForCamToolpathProgram(program)
    expect(gcode).not.toContain(';')
  })

  it('honors tokenSpacer=false (no spaces between words)', () => {
    const program = makeEmptyCamToolpathProgram({
      operationId: 'op',
      operationName: 'Op',
      machine: normalizeCamMachineProfile({ tokenSpacer: false }),
      safeZ: 15,
      spindleRPM: 12000,
    })
    program.paths.push(makePath('op'))
    const gcode = generateGcodeForCamToolpathProgram(program)
    expect(gcode).toContain('M3S12000')
  })
})

describe('combineCamToolpathPrograms', () => {
  it('combines paths, bounds and summaries from multiple programs', () => {
    const a = makeEmptyCamToolpathProgram({ operationId: 'a', operationName: 'A', machine: MACHINE, safeZ: 15 })
    a.bounds = { min: [-10, -10, 0], max: [10, 10, 0] }
    a.paths.push(makePath('a', 0))
    const b = makeEmptyCamToolpathProgram({ operationId: 'b', operationName: 'B', machine: MACHINE, safeZ: 15 })
    b.bounds = { min: [-10, -10, -2], max: [10, 10, 0] }
    b.paths.push(makePath('b', -2))
    const combined = combineCamToolpathPrograms({ programs: [a, b], machine: MACHINE })
    expect(combined.paths.length).toBe(2)
    // a combined program has no single operation name
    expect(combined.operationName).toBe('CAM Program')
    expect(combined.summary.pathCount).toBe(2)
    expect(combined.bounds).not.toBeNull()
    expect(combined.bounds!.min[2]).toBe(-2)
    expect(combined.bounds!.max[2]).toBe(0)
  })

  it('single program combine keeps identity', () => {
    const a = makeEmptyCamToolpathProgram({ operationId: 'a', operationName: 'A', machine: MACHINE, safeZ: 15 })
    a.paths.push(makePath('a'))
    const combined = combineCamToolpathPrograms({ programs: [a], machine: MACHINE })
    expect(combined.paths.length).toBe(1)
    expect(combined.operationName).toBe('A')
  })
})
