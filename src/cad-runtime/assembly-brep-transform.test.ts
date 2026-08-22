/**
 * @vitest-environment node
 *
 * Test: do_assemble transforms BREP solid (assembly position applied to solidCache)
 *
 * Bug: STEP export after assembly produces default position, not assembled position.
 * Root cause: verify that executeDoAssemble correctly transforms the BREP solid
 * in solidCache, and that result.brepSolids contains the transformed solid.
 *
 * Run: npx vitest run src/cad-runtime/assembly-brep-transform.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm, getKernel } from '../occt-kernel/occtKernel'
import { getSolidBoundingBox } from '../brep/brep-utils'
import type { OcctKernel } from 'occt-wasm'
import type { CadStatement, PartScript } from '../lang/types'
import { CadRuntime } from './runtime'
import type { HostPorts, EventSink } from './ports'
import { ensureTestFontLoader } from '../brep/text/fontTestHelper'

let kernel: OcctKernel

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel()
  ensureTestFontLoader()
}, 120000)

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: string, detail: Record<string, unknown>): void {
    this.events.push({ event, detail: { ...detail } })
  }
  clear(): void { this.events.length = 0 }
}

function createNodePorts(): HostPorts {
  return { events: new TestEventSink() }
}

function makeStmt(
  id: string,
  op: string,
  args: Record<string, unknown>,
  inputs: string[] = [],
  opts?: Partial<CadStatement>,
): CadStatement {
  return {
    id,
    op,
    args,
    inputs,
    feature: { kind: 'primitive', label: id, createdBy: 'user' },
    hasAssignment: true,
    returnType: 'new_shape',
    ...opts,
  }
}

describe('assembly BREP solid transform', () => {
  it('do_assemble transforms BREP solid (moving part position changes)', async () => {
    const ports = createNodePorts()
    const runtime = new CadRuntime(ports, 'auto')

    const script: PartScript = {
      params: [],
      terminalShapes: [
        { id: 'part0_v0', scopedId: 'file1:o1' },
        { id: 'part1_v0', scopedId: 'file1:o2' },
      ],
      statements: [
        makeStmt('part0_v0', 'cylinder', { radius: 10, height: 20, center: [0, 0, 0] }),
        makeStmt('part1_v0', 'box', { size: 20, center: [10, 0, 0] }),
        {
          id: 'grp_1',
          op: 'assembly',
          args: {
            name: 'Assembly1',
            members: ['part0_v0', 'part1_v0'],
            constraints: [{
              type: 'face_mate',
              fixedPartName: 'part0_v0',
              movingPartName: 'part1_v0',
              fixedFace: { faceId: '0.f0', surfaceType: 'plane', center: [-0.1, 0.04, 10], normal: [0, 0, 1] },
              movingFace: { faceId: 'o1.f6', surfaceType: 'plane', center: [10, 0, 10], normal: [0, 0, 1] },
            }],
          },
          inputs: [],
          feature: { kind: 'assembly', label: 'Assembly1', createdBy: 'user' },
          hasAssignment: false,
          returnType: 'void',
        },
        {
          id: 'grp_1_do',
          op: 'do_assemble',
          args: {},
          inputs: [],
          feature: { kind: 'do_assemble', label: 'do_assemble', createdBy: 'user' },
          hasAssignment: false,
          returnType: 'void',
          assemblyTarget: 'grp_1',
        },
      ],
    }

    const result = await runtime.execute(script)

    // Check BREP solids exist
    expect(result.brepSolids).toBeDefined()
    expect(result.brepSolids!.size).toBeGreaterThan(0)

    // The moving part (part1_v0) should have its solid transformed
    const movingSolid = result.brepSolids!.get('part1_v0')
    expect(movingSolid).toBeDefined()

    // Get bounding box of the moving solid AFTER assembly
    const bbox = getSolidBoundingBox(movingSolid!.kernel, movingSolid!.solid)
    console.log('Moving solid bbox after assembly:', bbox)

    // Before assembly: box center is [10,0,0], size 20
    // BBox before: [0..20, -10..10, -10..10], center [10, 0, 0]
    // After assembly: box top face [10,0,10] aligns with cylinder face [-0.1,0.04,10]
    // Translation: ~[-10.1, 0.04, 0]
    // BBox center after: ~[-0.1, 0.04, 0]
    const centerX = (bbox.min[0] + bbox.max[0]) / 2
    const centerY = (bbox.min[1] + bbox.max[1]) / 2
    const centerZ = (bbox.min[2] + bbox.max[2]) / 2
    console.log('Center after assembly:', [centerX, centerY, centerZ])

    // Verify the box moved — center X should no longer be 10
    expect(Math.abs(centerX - 10)).toBeGreaterThan(0.5)

    runtime.dispose()
  })

  it('append do_assemble transforms BREP solid (via executeAssemblyPass)', async () => {
    const ports = createNodePorts()
    const runtime = new CadRuntime(ports, 'auto')

    // First execute: create primitives only
    const scriptInit: PartScript = {
      params: [],
      terminalShapes: [
        { id: 'part0_v0', scopedId: 'file1:o1' },
        { id: 'part1_v0', scopedId: 'file1:o2' },
      ],
      statements: [
        makeStmt('part0_v0', 'cylinder', { radius: 10, height: 20, center: [0, 0, 0] }),
        makeStmt('part1_v0', 'box', { size: 20, center: [10, 0, 0] }),
      ],
    }

    await runtime.execute(scriptInit)

    // Now append assembly + do_assemble statements
    const scriptFull: PartScript = {
      params: [],
      terminalShapes: [
        { id: 'part0_v0', scopedId: 'file1:o1' },
        { id: 'part1_v0', scopedId: 'file1:o2' },
      ],
      statements: [
        makeStmt('part0_v0', 'cylinder', { radius: 10, height: 20, center: [0, 0, 0] }),
        makeStmt('part1_v0', 'box', { size: 20, center: [10, 0, 0] }),
        {
          id: 'grp_1',
          op: 'assembly',
          args: {
            name: 'Assembly1',
            members: ['part0_v0', 'part1_v0'],
            constraints: [{
              type: 'face_mate',
              fixedPartName: 'part0_v0',
              movingPartName: 'part1_v0',
              fixedFace: { faceId: '0.f0', surfaceType: 'plane', center: [-0.1, 0.04, 10], normal: [0, 0, 1] },
              movingFace: { faceId: 'o1.f6', surfaceType: 'plane', center: [10, 0, 10], normal: [0, 0, 1] },
            }],
          },
          inputs: [],
          feature: { kind: 'assembly', label: 'Assembly1', createdBy: 'user' },
          hasAssignment: false,
          returnType: 'void',
        },
        {
          id: 'grp_1_do',
          op: 'do_assemble',
          args: {},
          inputs: [],
          feature: { kind: 'do_assemble', label: 'do_assemble', createdBy: 'user' },
          hasAssignment: false,
          returnType: 'void',
          assemblyTarget: 'grp_1',
        },
      ],
    }

    // Append: execute assembly + do_assemble
    const result = await runtime.append(scriptFull, ['grp_1', 'grp_1_do'])

    // Check BREP solids exist
    expect(result.brepSolids).toBeDefined()
    const movingSolid = result.brepSolids?.get('part1_v0')
    expect(movingSolid).toBeDefined()

    // Get bounding box of the moving solid AFTER assembly
    const bbox = getSolidBoundingBox(movingSolid!.kernel, movingSolid!.solid)
    console.log('Moving solid bbox after append do_assemble:', bbox)

    const centerX = (bbox.min[0] + bbox.max[0]) / 2
    const centerY = (bbox.min[1] + bbox.max[1]) / 2
    console.log('Center after append do_assemble:', [centerX, centerY])

    // Verify the box moved — center X should no longer be 10
    expect(Math.abs(centerX - 10)).toBeGreaterThan(0.5)

    runtime.dispose()
  })
})
