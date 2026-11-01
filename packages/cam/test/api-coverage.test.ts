import { describe, it, expect } from 'vitest'
import { makeShapeFixture } from './helpers.js'
// ── L1: every exported API must be referenced from tests ──
import {
  CAM_OPERATION_TYPE_ROUGHING,
  CAM_OPERATION_TYPE_SHADOW_CUTTER,
  CAM_OPERATION_TYPE_SURFACING,
  CAM_TOOLPATH_SCHEMA_VERSION,
  CAM_TOOLPATH_SIMULATOR_GROUP_NAME,
  EPS,
  boundsFromLoopsAndZ,
  buildDepthLevels,
  buildShadowLoops,
  cross2,
  finiteNumber,
  loopsFromEdges,
  makeEmptyShadowResult,
  makeSteppedLoopPath,
  mergeOuterOffsetLoops,
  normalizeCamControllerFlavor,
  normalizeCamStockMode,
  offsetPolygon,
  positiveNumber,
  projectedShadowLoopsFromTriangles,
  resolveFaceTriangles,
  roundCamPoint,
  roundCoord,
  splitMachineMacroLines,
  unionContoursWithClipper,
  unionProjectedShadowLoops,
} from '../src/index.js'
// ── L2: option-container parameters must be covered at call sites ──
import {
  buildLinearToolpathPath,
  makeBallEndMillCutter,
  makeEmptyCamToolpathProgram,
  makeFlatEndMillCutter,
  summarizeCamToolpathProgram,
  roundCamCoord,
} from '../src/index.js'
import { buildSliceShadowLoops } from '../src/roughing.js'
import { declareMachine, declareOperation, declareStock, takeCamBuild } from '../src/collect.js'
import { generateToolpathForDeclaration, machineDeclToProfile } from '../src/generate.js'
import { trianglesFromMesh } from '../src/geometry.js'
import { normalizeCamMachineProfile } from '../src/profile.js'

describe('api coverage — exported constants and helpers', () => {
  it('exposes operation type and schema constants', () => {
    expect(CAM_OPERATION_TYPE_ROUGHING).toBe('roughing')
    expect(CAM_OPERATION_TYPE_SURFACING).toBe('surfacing')
    expect(CAM_OPERATION_TYPE_SHADOW_CUTTER).toBe('shadow-cutter')
    expect(CAM_TOOLPATH_SCHEMA_VERSION).toBe(1)
    expect(CAM_TOOLPATH_SIMULATOR_GROUP_NAME).toBe('__CAM_TOOLPATH_SIMULATOR__')
  })

  it('exercises the exported geometry helpers', () => {
    expect(EPS).toBe(1e-7)
    expect(finiteNumber('nope', 3)).toBe(3)
    expect(finiteNumber(2.5, 3)).toBe(2.5)
    expect(positiveNumber(-2, 3)).toBe(2)
    expect(positiveNumber(0, 3)).toBeGreaterThanOrEqual(1e-7)
    expect(cross2([0, 0], [1, 0], [0, 1])).toBe(1)
    expect(cross2([0, 0], [0, 1], [1, 0])).toBe(-1)
    expect(roundCoord(1.23456)).toBe(1.2346)
    expect(roundCamPoint([1.23456, 2.34567, 3.45678])).toEqual([1.2346, 2.3457, 3.4568])
  })

  it('exercises the exported shadow/clipper helpers on a box', () => {
    const shape = makeShapeFixture([20, 20, 10])
    const triangles = trianglesFromMesh(shape.positions, shape.indices)
    const projected = projectedShadowLoopsFromTriangles(triangles)
    expect(projected.length).toBeGreaterThan(0)
    const unioned = unionContoursWithClipper(projected)
    expect(unioned.length).toBeGreaterThan(0)
    const shadow = buildShadowLoops(unioned)
    expect(shadow.some((loop) => loop.role === 'outer')).toBe(true)
    const outer = shadow.filter((loop) => loop.role === 'outer')
    const merged = mergeOuterOffsetLoops(shadow)
    expect(merged.length).toBeGreaterThanOrEqual(shadow.length)
    const offset = offsetPolygon(outer[0].points, 1)
    expect(offset.length).toBeGreaterThan(0)
    const stepped = makeSteppedLoopPath({
      id: 'step', operationId: 'op', operationName: 'Op',
      loop: outer[0], levels: [3, 1], safeZ: 15,
      cutter: makeFlatEndMillCutter({ diameter: 3 }), orientation: { toolAxis: [0, 0, 1] },
      feedRate: 800, plungeRate: 200, spindleRPM: 12000,
    })
    expect(stepped.points.length).toBeGreaterThan(outer[0].points.length)
    expect(unionProjectedShadowLoops(shadow).length).toBeGreaterThan(0)
    expect(boundsFromLoopsAndZ(shadow, 5, 0)).toMatchObject({ min: [-10, -10, 0], max: [10, 10, 5] })
    const levels = buildDepthLevels(5, 0, 2)
    // depth grid: topZ exclusive, bottomZ inclusive
    expect(levels).toEqual([3, 1, 0])
    expect(loopsFromEdges([{ a: [0, 0], b: [1, 0] }, { a: [1, 0], b: [1, 1] }, { a: [1, 1], b: [0, 0] }]).length).toBe(1)
    const empty = makeEmptyShadowResult({
      operationId: 'x', operationName: 'X', machine: normalizeCamMachineProfile(null),
      targetBounds: { min: [-10, -10, 0], max: [10, 10, 5] },
      cutter: makeFlatEndMillCutter({ diameter: 3 }), toolDiameter: 3,
      spindleRPM: 12000, warnings: [],
    })
    expect(empty.paths).toEqual([])
  })

  it('exercises profile, generate and gcode helpers', () => {
    expect(normalizeCamControllerFlavor('linuxcnc')).toBe('linuxcnc')
    expect(normalizeCamControllerFlavor('bogus')).toBe('grbl')
    expect(normalizeCamStockMode('fixed')).toBe('fixed')
    expect(normalizeCamStockMode('auto')).toBe('auto')
    expect(splitMachineMacroLines('G21\nG90')).toEqual(['G21', 'G90'])
    const shape = makeShapeFixture([20, 20, 10])
    const triangles = trianglesFromMesh(shape.positions, shape.indices)
    // faces: undefined → whole part (all option properties covered inline)
    const all = resolveFaceTriangles({
      name: 'S', kind: 'surfacing', target: 'box', tool: { type: 'ball', diameter: 3.175 },
      enabled: true, stepDown: 1, extraDepth: 0, faces: undefined, stepover: 0.8,
      stockAllowance: 0, linkClearance: 0.5, pathTolerance: 0.01, sampleSpacing: 0,
      minSampleSpacing: 0.05, flatnessCosLimit: 0.999, rasterDirection: 'Both',
      safeHeight: 5, feedRate: 800, plungeRate: 200, spindleRPM: 12000,
    }, shape, triangles)
    expect(all.length).toBe(triangles.length)
    // faces: [1] (top face index 1 of the box) → a 2-triangle range
    const top = resolveFaceTriangles({
      name: 'S', kind: 'surfacing', target: 'box', tool: { type: 'ball', diameter: 3.175 },
      enabled: true, stepDown: 1, extraDepth: 0, faces: [1], stepover: 0.8,
      stockAllowance: 0, linkClearance: 0.5, pathTolerance: 0.01, sampleSpacing: 0,
      minSampleSpacing: 0.05, flatnessCosLimit: 0.999, rasterDirection: 'Both',
      safeHeight: 5, feedRate: 800, plungeRate: 200, spindleRPM: 12000,
    }, shape, triangles)
    expect(top.length).toBe(2)
  })
})

describe('api coverage — option-container parameters', () => {
  it('covers every cutter and toolpath-path option', () => {
    const ball = makeBallEndMillCutter({ diameter: 3.175, cuttingLength: 20, overallLength: 60, id: 'b1' })
    expect(ball.diameter).toBe(3.175)
    const flat = makeFlatEndMillCutter({ diameter: 6, cuttingLength: 20, overallLength: 60, id: 'f1' })
    expect(flat.diameter).toBe(6)
    const program = makeEmptyCamToolpathProgram({
      operationId: 'p',
      operationName: 'P',
      machine: normalizeCamMachineProfile(null),
      targetBounds: { min: [-10, -10, 0], max: [10, 10, 5] },
      safeZ: 15,
      cutter: ball,
      spindleRPM: 12000,
      warnings: [],
    })
    expect(program.targetBounds!.max[2]).toBe(5)
    const path = buildLinearToolpathPath({
      id: 'lin',
      operationId: 'op',
      operationName: 'Op',
      positions: [[0, 0, 0], [10, 0, 0]],
      orientation: { toolAxis: [0, 0, 1] },
      cutter: makeFlatEndMillCutter({ diameter: 3 }),
      feedRate: 800,
      plungeRate: 200,
      spindleRPM: 12000,
      segmentKind: 'cut',
      metadata: { safe: false, z: 0 },
    })
    expect(path.segments[0].kind).toBe('cut')
    const summary = summarizeCamToolpathProgram({
      paths: [path],
      targetCount: 2,
      triangleCount: 12,
      levelCount: 1,
      warningCount: 0,
      outlinePointCount: 4,
      offsetDistance: 0.5,
    })
    expect(summary.pathCount).toBe(1)
    expect(summary.pointCount).toBe(2)
    expect(summary.outlinePointCount).toBe(4)
    expect(summary.offsetDistance).toBe(0.5)
  })

  it('covers every slice option in buildSliceShadowLoops', () => {
    const shape = makeShapeFixture([20, 20, 10])
    const triangles = trianglesFromMesh(shape.positions, shape.indices)
    const loops = buildSliceShadowLoops(triangles, { index: 1, topZ: 5, bottomZ: 3 })
    expect(loops.some((loop) => loop.role === 'outer')).toBe(true)
  })

  it('covers every declaration option through the fai-script collector', () => {
    declareMachine({
      name: 'Mill',
      workBounds: { x: [-100, 100], y: [-100, 100], z: [0, 200] },
      maxSpindleRPM: 24000,
      safeParkZ: 15,
      controller: 'grbl',
      units: 'mm',
      defaultRapidRate: 2500,
      tokenSpacer: true,
      stripComments: false,
      header: 'G21',
      footer: 'M2',
    })
    declareStock({
      type: 'box',
      size: [30, 30, 20],
      radius: 0,
      height: 0,
      center: [0, 0, 5],
      target: 'box',
    })
    declareOperation({
      name: 'R1',
      kind: 'roughing',
      target: 'box',
      tool: { type: 'flat', diameter: 3.175, cuttingLength: 20 },
      enabled: true,
      stepDown: 1,
      extraDepth: 0,
      faces: undefined,
      stepover: 0.8,
      stockAllowance: 0,
      linkClearance: 0.5,
      pathTolerance: 0.01,
      sampleSpacing: 0,
      minSampleSpacing: 0.05,
      flatnessCosLimit: 0.999,
      rasterDirection: 'Both',
      safeHeight: 5,
      feedRate: 800,
      plungeRate: 200,
      spindleRPM: 12000,
    })
    const pending = takeCamBuild()
    expect(pending.machine!.name).toBe('Mill')
    expect(pending.stock!.type).toBe('box')
    expect(pending.operations.length).toBe(1)
  })

  it('covers every option in generateToolpathForDeclaration', () => {
    const profile = machineDeclToProfile({
      name: 'Mill',
      workBounds: { x: [-100, 100], y: [-100, 100], z: [0, 200] },
      maxSpindleRPM: 24000,
      safeParkZ: 15,
      controller: 'grbl',
      units: 'mm',
      defaultRapidRate: 2500,
      tokenSpacer: true,
      stripComments: false,
      header: 'G21',
      footer: 'M2',
    })
    expect(profile.name).toBe('Mill')
    const program = generateToolpathForDeclaration({
      name: 'S1',
      kind: 'surfacing',
      target: 'box',
      tool: { type: 'ball', diameter: 3.175, cuttingLength: 20 },
      enabled: true,
      stepDown: 1,
      extraDepth: 0,
      faces: [1],
      stepover: 0.8,
      stockAllowance: 0,
      linkClearance: 0.5,
      pathTolerance: 0.01,
      sampleSpacing: 0,
      minSampleSpacing: 0.05,
      flatnessCosLimit: 0.999,
      rasterDirection: 'X',
      safeHeight: 5,
      feedRate: 800,
      plungeRate: 200,
      spindleRPM: 12000,
    }, {
      shape: makeShapeFixture([20, 20, 10]),
    }, {
      name: 'Mill',
      maxSpindleRPM: 24000,
      safeParkZ: 15,
      controller: 'grbl',
      units: 'mm',
      defaultRapidRate: 2500,
      tokenSpacer: true,
      stripComments: false,
      header: 'G21',
      footer: 'M2',
    })
    expect(program.paths.length).toBeGreaterThan(0)
    // rounding helper used by the pipeline
    expect(roundCamCoord(1.23456)).toBe(1.2346)
  })
})
