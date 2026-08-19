/**
 * @vitest-environment node
 *
 * SVG extrude operation comprehensive tests.
 *
 * Tests:
 * 1. BREP path: svgExtrude with SVG string → valid solid
 * 2. Mesh path: svgExtrude with SVG string → valid mesh
 * 3. AssetRef resolution via ports.assets
 * 4. BREP/mesh bbox equivalence
 * 5. Error: no svg provided
 *
 * Run: npx vitest run src/ops/svgExtrude.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import { createRuntime } from '../cad-runtime/runtime'
import type { ExecutionResult } from '../cad-runtime/runtime'
import type { HostPorts, EventSink, AssetResolver } from '../cad-runtime/ports'
import { ensureTestFontLoader } from '../brep/text/fontTestHelper'
import { fileBlobStore } from '../test/blob-store'
import type { Shape } from './types'
import type { CadStatement, FeatureKind, PartScript } from '../lang/types'

// Polyfill DOMParser for Node.js — SVGLoader.parse needs it
import { DOMParser as NodeDOMParser } from '@xmldom/xmldom'
if (typeof (globalThis as any).DOMParser === 'undefined') {
  ;(globalThis as any).DOMParser = NodeDOMParser
}

let svgLogoText: string

beforeAll(async () => {
  await initOcctWasm()
  ensureTestFontLoader()

  // Load logo111.svg from test/fixtures/svg/
  const svgPath = resolve(__dirname, '..', '..', 'test', 'fixtures', 'svg', 'logo111.svg')
  svgLogoText = readFileSync(svgPath, 'utf-8')
}, 120000)

// ── Test helpers ──

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: string, detail: Record<string, unknown>): void {
    this.events.push({ event, detail: { ...detail } })
  }
  clear(): void { this.events.length = 0 }
}

function createTestAssets(svgKey?: string, svgText?: string): AssetResolver {
  return {
    resolveByKey: async (key: string) => {
      if (key === svgKey && svgText) {
        const bytes = new TextEncoder().encode(svgText).buffer as ArrayBuffer
        return { bytes, format: 'svg' }
      }
      const bytes = fileBlobStore.get(key)
      if (!bytes) throw new Error(`test: asset key not found: ${key}`)
      return { bytes, format: undefined }
    },
    resolveFile: async (path: string) => {
      const fs = await import('node:fs/promises')
      const buf = await fs.readFile(path)
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    },
    resolveUrl: async (url: string) => {
      const res = await fetch(url)
      return res.arrayBuffer()
    },
  }
}

function makeStmt(
  id: string,
  op: string,
  args: Record<string, unknown>,
  inputs: string[] = [],
  featureKind?: FeatureKind,
): CadStatement {
  return {
    id, op,
    args: args as any,
    inputs,
    feature: { kind: featureKind ?? 'primitive', label: op, createdBy: 'user' },
    hasAssignment: true,
    returnType: 'new_shape',
  }
}

function makePartScript(statements: CadStatement[]): PartScript {
  return { source: { kind: 'load' }, params: [], statements }
}

async function runScript(
  statements: CadStatement[],
  mode: 'mesh' | 'auto' | 'brep' = 'auto',
  svgKey?: string,
): Promise<ExecutionResult> {
  const ports: HostPorts = {
    events: new TestEventSink(),
    assets: createTestAssets(svgKey, svgLogoText),
  }
  const runtime = createRuntime(ports, mode)
  return runtime.execute(makePartScript(statements))
}

function shapeVertexCount(s: Shape): number { return s.positions.length / 3 }
function shapeTriangleCount(s: Shape): number { return s.indices.length / 3 }

function getFinalOutput(result: ExecutionResult, statements: CadStatement[]): Shape {
  const geoStmts = statements.filter(s => s.hasAssignment && (s.returnType ?? 'new_shape') === 'new_shape')
  const last = geoStmts[geoStmts.length - 1]
  const shape = result.outputs.get(last.id)
  if (!shape) throw new Error(`No output for terminal statement "${last.id}"`)
  return shape
}

function computeBBox(positions: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    min[0] = Math.min(min[0], positions[i])
    min[1] = Math.min(min[1], positions[i + 1])
    min[2] = Math.min(min[2], positions[i + 2])
    max[0] = Math.max(max[0], positions[i])
    max[1] = Math.max(max[1], positions[i + 1])
    max[2] = Math.max(max[2], positions[i + 2])
  }
  return { min, max }
}

const SVG_ASSET_KEY = 'test-svg-logo'

// ─── Tests ───

describe('svgExtrude: BREP path', () => {
  it('svgExtrude with AssetRef → valid solid + BREP chain active', async () => {
    const stmts = [
      makeStmt('s1', 'svgExtrude', {
        svg: { $asset: SVG_ASSET_KEY },
        depth: 5,
        targetLongSide: 20,
      }),
    ]

    const result = await runScript(stmts, 'brep', SVG_ASSET_KEY)
    expect(result.failedAt).toBeUndefined()
    expect(result.brepChain.solidCache.size).toBeGreaterThan(0)

    const shape = getFinalOutput(result, stmts)
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(shapeTriangleCount(shape)).toBeGreaterThan(0)
  })
})

describe('svgExtrude: mesh path', () => {
  it('svgExtrude with AssetRef → valid mesh (mesh mode)', async () => {
    const stmts = [
      makeStmt('s1', 'svgExtrude', {
        svg: { $asset: SVG_ASSET_KEY },
        depth: 5,
        targetLongSide: 20,
      }),
    ]

    const result = await runScript(stmts, 'mesh', SVG_ASSET_KEY)
    expect(result.failedAt).toBeUndefined()

    const shape = getFinalOutput(result, stmts)
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(shapeTriangleCount(shape)).toBeGreaterThan(0)
  })
})

describe('svgExtrude: BREP/mesh equivalence', () => {
  it('logo111.svg: BREP and mesh produce equivalent bbox', async () => {
    const stmts = [
      makeStmt('s1', 'svgExtrude', {
        svg: { $asset: SVG_ASSET_KEY },
        depth: 5,
        targetLongSide: 20,
      }),
    ]

    const brepResult = await runScript(stmts, 'brep', SVG_ASSET_KEY)
    const meshResult = await runScript(stmts, 'mesh', SVG_ASSET_KEY)

    expect(brepResult.failedAt).toBeUndefined()
    expect(meshResult.failedAt).toBeUndefined()

    const brepShape = getFinalOutput(brepResult, stmts)
    const meshShape = getFinalOutput(meshResult, stmts)

    const brepBB = computeBBox(brepShape.positions)
    const meshBB = computeBBox(meshShape.positions)

    // bbox should be close (same SVG, same depth, same targetLongSide)
    const tol = 2.0 // 2mm tolerance for SVG curve tessellation differences
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(brepBB.min[i] - meshBB.min[i])).toBeLessThan(tol)
      expect(Math.abs(brepBB.max[i] - meshBB.max[i])).toBeLessThan(tol)
    }
  })
})

describe('svgExtrude: depth and targetLongSide variations', () => {
  it('different depth → different Z bbox', async () => {
    const stmts5 = [
      makeStmt('s1', 'svgExtrude', {
        svg: { $asset: SVG_ASSET_KEY },
        depth: 5,
        targetLongSide: 20,
      }),
    ]
    const stmts10 = [
      makeStmt('s1', 'svgExtrude', {
        svg: { $asset: SVG_ASSET_KEY },
        depth: 10,
        targetLongSide: 20,
      }),
    ]

    const result5 = await runScript(stmts5, 'brep', SVG_ASSET_KEY)
    const result10 = await runScript(stmts10, 'brep', SVG_ASSET_KEY)

    const shape5 = getFinalOutput(result5, stmts5)
    const shape10 = getFinalOutput(result10, stmts10)

    const bb5 = computeBBox(shape5.positions)
    const bb10 = computeBBox(shape10.positions)

    // depth 10 should have larger Z extent than depth 5
    const z5 = bb5.max[2] - bb5.min[2]
    const z10 = bb10.max[2] - bb10.min[2]
    expect(z10).toBeGreaterThan(z5)
  })
})

describe('svgExtrude: STEP export verification (BREP)', () => {
  it('svgExtrude solid exports as ADVANCED_FACE', async () => {
    const { getKernel } = await import('../occt-kernel/occtKernel')
    const kernel = getKernel()

    const stmts = [
      makeStmt('s1', 'svgExtrude', {
        svg: { $asset: SVG_ASSET_KEY },
        depth: 5,
        targetLongSide: 20,
      }),
    ]

    const result = await runScript(stmts, 'brep', SVG_ASSET_KEY)
    expect(result.brepSolids).toBeDefined()

    const solidEntry = result.brepSolids!.get('s1')!
    const step = kernel.exportStep(solidEntry.solid)
    expect(step).toContain('ADVANCED_FACE')
  })
})
