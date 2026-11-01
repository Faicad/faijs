import { describe, expect, it } from 'vitest'
import {
  assertKnownKeys,
  normalizeCamMachineDecl,
  normalizeCamOperationDecl,
  normalizeCamStockDecl,
  normalizeCamToolDecl,
} from '../src/decl.js'
import { declareMachine, declareOperation, declareStock, resetCamBuild, takeCamBuild } from '../src/collect.js'
import { cam, machine, op, roughing, stock, surfacing } from '../src/lib.js'
import { machineDeclToProfile, generateToolpathForDeclaration } from '../src/generate.js'
import { makeShapeFixture } from './helpers.js'

describe('assertKnownKeys', () => {
  it('throws on unknown keys', () => {
    expect(() => assertKnownKeys({ unknown: 1 }, new Set(['known']), 'fn')).toThrow(/unknown option 'unknown'/)
  })

  it('passes when all keys are allowed', () => {
    expect(() => assertKnownKeys({ known: 1 }, new Set(['known']), 'fn')).not.toThrow()
  })
})

describe('decl normalization', () => {
  it('normalizes machine decl with defaults', () => {
    const decl = normalizeCamMachineDecl({ name: 'M', maxSpindleRPM: 30000 })
    expect(decl.name).toBe('M')
    expect(decl.maxSpindleRPM).toBe(30000)
    expect(decl.workBounds.x).toEqual([-100, 100])
    expect(decl.safeParkZ).toBe(15)
  })

  it('normalizes stock decl and rejects unknown types', () => {
    expect(normalizeCamStockDecl({ type: 'box', size: [1, 2, 3] }).size).toEqual([1, 2, 3])
    expect(() => normalizeCamStockDecl({ type: 'sphere' })).toThrow(/unsupported type/)
  })

  it('normalizes tool decl and rejects unknown tool types', () => {
    expect(normalizeCamToolDecl({ type: 'ball', diameter: 3 })).toMatchObject({ type: 'ball', diameter: 3 })
    expect(() => normalizeCamToolDecl({ type: 'diamond' })).toThrow(/unsupported tool type/)
  })

  it('operation decl requires target and validates surfacing tool type', () => {
    expect(() => normalizeCamOperationDecl({ name: 'x' }, 'surfacing', 'op.surfacing')).toThrow(/target/)
    expect(() =>
      normalizeCamOperationDecl({ name: 'x', target: 'p', tool: { type: 'flat', diameter: 3 } }, 'surfacing', 'op.surfacing'),
    ).toThrow(/ball/)
    const decl = normalizeCamOperationDecl(
      { name: 'x', target: 'p', tool: { type: 'ball', diameter: 3 }, rasterDirection: 'Y' },
      'surfacing',
      'op.surfacing',
    )
    expect(decl.rasterDirection).toBe('Y')
    // defaulted numerics are left undefined in the declaration; the algorithm
    // layer supplies fallbacks (0.8 for stepover)
    expect(decl.stepover).toBeUndefined()
  })
})

describe('collector', () => {
  it('collects declarations and takes the build', () => {
    resetCamBuild()
    declareMachine(normalizeCamMachineDecl({ name: 'M' }))
    declareStock(normalizeCamStockDecl({ type: 'box', size: [10, 10, 10] }))
    declareOperation(normalizeCamOperationDecl({ name: 'r', target: 'p', tool: { type: 'flat', diameter: 3 } }, 'roughing', 'op.roughing'))
    const build = takeCamBuild()
    expect(build.machine?.name).toBe('M')
    expect(build.stock?.type).toBe('box')
    expect(build.operations.length).toBe(1)
    expect(build.operations[0].kind).toBe('roughing')
    // after take, the collector is reset
    expect(takeCamBuild().operations).toEqual([])
  })
})

describe('lib (fai-script surface)', () => {
  it('machine/stock/op declare and collect through cam namespace', () => {
    resetCamBuild()
    cam.machine({ name: 'Mill', workBounds: { x: [0, 100], y: [0, 100], z: [0, 50] }, maxSpindleRPM: 20000, safeParkZ: 10 })
    cam.stock({ type: 'box', size: [60, 40, 20], center: [30, 20, 10] })
    cam.op.roughing({ name: 'R1', target: 'part1', tool: { type: 'flat', diameter: 3.175 }, stepDown: 1 })
    cam.op.surfacing({ name: 'F1', target: 'part1', tool: { type: 'ball', diameter: 3.175 }, faces: 'all' })
    const build = takeCamBuild()
    expect(build.machine?.name).toBe('Mill')
    expect(build.operations.map((o) => o.kind)).toEqual(['roughing', 'surfacing'])
    expect(build.operations[1].tool.type).toBe('ball')
  })

  it('throws on unknown option keys in cam namespace', () => {
    resetCamBuild()
    expect(() => machine({ name: 'M', bogus: 1 })).toThrow(/unknown option 'bogus'/)
    expect(() => stock({ type: 'box', bogus: 1 })).toThrow(/unknown option 'bogus'/)
    expect(() => roughing({ name: 'r', target: 'p', tool: { type: 'flat', diameter: 3 }, bogus: 1 })).toThrow(/unknown option 'bogus'/)
    expect(() => surfacing({ name: 's', target: 'p', tool: { type: 'ball', diameter: 3 }, bogus: 1 })).toThrow(/unknown option 'bogus'/)
  })

  it('independent function exports are the same as namespace members', () => {
    expect(typeof machine).toBe('function')
    expect(typeof stock).toBe('function')
    expect(op.roughing).toBe(roughing)
    expect(op.surfacing).toBe(surfacing)
  })
})

describe('generate (declaration → algorithm)', () => {
  it('maps machine decl to profile', () => {
    const profile = machineDeclToProfile(normalizeCamMachineDecl({ name: 'M', maxSpindleRPM: 30000 }))
    expect(profile.name).toBe('M')
    expect(profile.maxSpindleRPM).toBe(30000)
    expect(machineDeclToProfile(null).name).toBe('Generic 3 Axis Mill')
  })

  it('runs roughing on a shape fixture through the declaration path', () => {
    const decl = normalizeCamOperationDecl(
      { name: 'R1', target: 'box', tool: { type: 'flat', diameter: 3.175 }, stepDown: 2 },
      'roughing',
      'op.roughing',
    )
    const program = generateToolpathForDeclaration(decl, { shape: makeShapeFixture([20, 20, 10]) }, machineDeclToProfile(null))
    expect(program.paths.length).toBeGreaterThan(0)
    expect(program.operationName).toBe('R1')
  })

  it('runs surfacing with face selection through the declaration path', () => {
    // face 1 = top face (z=5 on a box centered at origin); vertical faces
    // cannot be surfaced top-down
    const decl = normalizeCamOperationDecl(
      { name: 'F1', target: 'box', tool: { type: 'ball', diameter: 3.175 }, faces: [1], rasterDirection: 'X' },
      'surfacing',
      'op.surfacing',
    )
    const program = generateToolpathForDeclaration(decl, { shape: makeShapeFixture([20, 20, 10]) }, machineDeclToProfile(null))
    expect(program.paths.length).toBeGreaterThan(0)
    // toolpath stays on the top plane
    for (const path of program.paths) {
      for (const point of path.points) {
        if (point.metadata?.safe !== true) {
          expect(point.position[2]).toBeCloseTo(5, 2)
        }
      }
    }
  })

  it("surfacing with faces 'all' uses whole-part triangles", () => {
    const decl = normalizeCamOperationDecl(
      { name: 'F1', target: 'box', tool: { type: 'ball', diameter: 3.175 }, faces: 'all' },
      'surfacing',
      'op.surfacing',
    )
    const program = generateToolpathForDeclaration(decl, { shape: makeShapeFixture([20, 20, 10]) }, machineDeclToProfile(null))
    expect(program.paths.length).toBeGreaterThan(0)
  })

  it('hard-errors when faces cannot be resolved on a shape without faceRanges', () => {
    const decl = normalizeCamOperationDecl(
      { name: 'F1', target: 'box', tool: { type: 'ball', diameter: 3.175 }, faces: [0] },
      'surfacing',
      'op.surfacing',
    )
    const shape = makeShapeFixture([20, 20, 10])
    delete (shape as any).faceRanges
    expect(() =>
      generateToolpathForDeclaration(decl, { shape }, machineDeclToProfile(null)),
    ).toThrow(/no faceRanges/)
  })

  it('hard-errors on entity-shaped face references', () => {
    const decl = normalizeCamOperationDecl(
      { name: 'F1', target: 'box', tool: { type: 'ball', diameter: 3.175 }, faces: [{ part: 'box', faceIndex: 0 }] },
      'surfacing',
      'op.surfacing',
    )
    expect(() =>
      generateToolpathForDeclaration(decl, { shape: makeShapeFixture([20, 20, 10]) }, machineDeclToProfile(null)),
    ).toThrow(/entity-shaped face references/)
  })
})
