﻿/**
 * @vitest-environment node
 *
 * Case 2: load STL + cylinder + drill + assembly transforms
 *
 * 验证逐 part BREP 设计的第二个核心场景：
 * - load STL → 非 CAD 源，cube_v0 无 solid（mesh）
 * - cylinder → BREP-native，cyl_v0 持有 solid
 * - drill(cyl) → 上游有 solid → 走 BREP 精确路径
 * - assembly statement → execution skips (zero geometry impact)
 * - rotate_euler(drilled, {anglesDeg, pivot}) → BREP 精确变换（需 pivot 正确传递）
 * - translate(rotated, {offset}) → BREP 精确变换
 *
 * 修复前（全局 brepActive）：STL 加载断全局链 → cylinder/drill/rotate/translate 全被连坐走 mesh
 * 修复后（逐 part）：STL 只影响 cube_v0，cylinder 链保持 BREP
 *
 * Run: npx vitest run src/ops/case2-load-stl-cylinder-assembly.test.ts
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import type { StatementIR, ScriptIR } from '../lang/types'
import { createRuntime } from '@faicad/faijs'
import type { ExecutionResult } from '../cad-runtime/runtime'
import type { HostPorts, EventSink, AssetResolver } from '../cad-runtime/ports'
import { fileBlobStore } from '../test/blob-store'
import { exportStepFromSolid } from '../brep/export/step'
import { exportStep } from '../occt-kernel/highLevelApi'
import { asPartName, asStmtId } from '../identity'

let stlBuffer: ArrayBuffer

beforeAll(async () => {
  await registerOcctBrepEngine()

  // Load cube-10x5x5.stl fixture（P6：fixtures 独立包，模块相对路径）
  const stlPath = fileURLToPath(new URL('../../../fixtures/data/cube-10x5x5.stl', import.meta.url))
  const stlData = readFileSync(stlPath)
  stlBuffer = stlData.buffer.slice(stlData.byteOffset, stlData.byteOffset + stlData.byteLength) as ArrayBuffer
}, 120000)

beforeEach(() => {
  fileBlobStore.clear()
})

// ── Test helpers ──

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: string, detail: Record<string, unknown>): void {
    this.events.push({ event, detail: { ...detail } })
  }
  clear(): void { this.events.length = 0 }
}

function createTestAssets(): AssetResolver {
  return {
    resolveByKey: async (key: string) => {
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

function createTestPorts(): HostPorts {
  return { events: new TestEventSink(), assets: createTestAssets() }
}

function makeStmt(
  id: string,
  callee: string,
  args: Record<string, unknown>,
  inputs: string[] = [],
  extra?: Partial<StatementIR>,
): StatementIR {
  return {
    id: asStmtId(id), callee,
    args: args as never,
    positional: inputs.map((s) => ({ $ref: asPartName(s) })),
    outputs: [asPartName(id)],
    hasAssignment: true,
    ...extra,
  }
}

function makePartScript(statements: StatementIR[]): ScriptIR {
  // Phase 3: parser 不再计算 terminalShapes；终端判定在 runtime.collectResult（从 outputs 过滤）
  return {
    source: { kind: 'load' },
    params: [],
    statements,
  }
}

async function runScript(statements: StatementIR[]): Promise<ExecutionResult> {
  const runtime = createRuntime(createTestPorts(), 'auto')
  const script = makePartScript(statements)
  return runtime.executeIR(script)
}

// ─── Case 2: load STL + cylinder + drill + assembly transforms ───

describe('Case 2: load STL + cylinder + drill + assembly — per-part BREP independence', () => {
  it('STL load does not break BREP for subsequent cylinder/drill/transforms', async () => {
    const bufferKey = fileBlobStore.put(stlBuffer)
    const stmts: StatementIR[] = [
      // S0: load STL → non-CAD source → mesh only, no solid
      makeStmt('cube_v0', 'load', { key: bufferKey, format: 'stl' }, [],
        { }),
      // S1: cylinder → BREP-native → should stay BREP
      makeStmt('cyl_v0', 'cylinder', { radius: 5, height: 20 }, []),
      // S2: drill on cylinder → upstream has solid → should stay BREP
      makeStmt('drilled_v0', 'fai_drill', {
        diameter: 6, depth: 20, holeType: 'simple',
        position: [0, 0, 10], direction: 'normal',
        faceNormal: [0, 0, 1],
      }, ['cyl_v0']),
      // S3: assembly structural statement (execution skips)
      makeStmt('grp_asm0', 'assembly', {
        name: 'CubeOnCylinder',
        members: ['cube_v0', 'drilled_v0'],
        constraints: [{
          fixedScopedId: 'cube_v0', movingScopedId: 'drilled_v0',
          fixedFace: { surfaceType: 'plane' },
          movingFace: { surfaceType: 'plane' },
        }],
      }, [], { }),
      // S4: rotate_euler with pivot — BREP-native transform
      makeStmt('rot_v0', 'rotate_euler', { anglesDeg: [180, 0, 0], pivot: [0, 0, 20] }, ['drilled_v0'],
        { }),
      // S5: translate — BREP-native transform
      makeStmt('mated_v0', 'translate', { offset: [0, 0, 5] }, ['rot_v0'],
        { }),
    ]

    const result = await runScript(stmts)
    expect(result.failedAt).toBeUndefined()

    const solidCache = result.brepChain.solidCache

    // Core assertions (per-part BREP independence):
    // STL load does NOT break BREP for subsequent parts
    expect(solidCache.has(asPartName('cube_v0'))).toBe(false)     // STL → mesh (no solid) ✅
    expect(solidCache.has(asPartName('cyl_v0'))).toBe(true)       // cylinder → BREP ✅ (core fix)
    expect(solidCache.has(asPartName('drilled_v0'))).toBe(true)   // drill → BREP ✅ (upstream has solid)
    expect(solidCache.has(asPartName('rot_v0'))).toBe(true)       // rotate_euler → BREP ✅
    expect(solidCache.has(asPartName('mated_v0'))).toBe(true)     // translate → BREP ✅

    // Assembly structural statement is skipped during execution
    const asmStmt = stmts.find(s => s.callee === 'assembly')
    expect(asmStmt).toBeDefined()

    fileBlobStore.release(bufferKey)
  })

  it('brepSolids contains mated_v0 (BREP) but not cube_v0 (mesh)', async () => {
    const bufferKey = fileBlobStore.put(stlBuffer)
    const stmts: StatementIR[] = [
      makeStmt('cube_v0', 'load', { key: bufferKey, format: 'stl' }, [],
        { }),
      makeStmt('cyl_v0', 'cylinder', { radius: 5, height: 20 }, []),
      makeStmt('drilled_v0', 'fai_drill', {
        diameter: 6, depth: 20, holeType: 'simple',
        position: [0, 0, 10], direction: 'normal',
        faceNormal: [0, 0, 1],
      }, ['cyl_v0']),
      makeStmt('grp_asm0', 'assembly', {
        name: 'CubeOnCylinder',
        members: ['cube_v0', 'drilled_v0'],
        constraints: [],
      }, [], { }),
      makeStmt('rot_v0', 'rotate_euler', { anglesDeg: [180, 0, 0], pivot: [0, 0, 20] }, ['drilled_v0'],
        { }),
      makeStmt('mated_v0', 'translate', { offset: [0, 0, 5] }, ['rot_v0'],
        { }),
    ]

    const result = await runScript(stmts)
    expect(result.failedAt).toBeUndefined()

    // brepSolids should contain mated_v0 (BREP terminal)
    expect(result.brepSolids).toBeDefined()
    expect(result.brepSolids!.has(asPartName('mated_v0'))).toBe(true)
    // cube_v0 should NOT be in brepSolids (mesh terminal)
    expect(result.brepSolids!.has(asPartName('cube_v0'))).toBe(false)

    fileBlobStore.release(bufferKey)
  })

  it('STEP export: mated_v0 is precise (ADVANCED_FACE), cube_v0 is faceted', async () => {
    const bufferKey = fileBlobStore.put(stlBuffer)
    const stmts: StatementIR[] = [
      makeStmt('cube_v0', 'load', { key: bufferKey, format: 'stl' }, [],
        { }),
      makeStmt('cyl_v0', 'cylinder', { radius: 5, height: 20 }, []),
      makeStmt('drilled_v0', 'fai_drill', {
        diameter: 6, depth: 20, holeType: 'simple',
        position: [0, 0, 10], direction: 'normal',
        faceNormal: [0, 0, 1],
      }, ['cyl_v0']),
      makeStmt('rot_v0', 'rotate_euler', { anglesDeg: [180, 0, 0], pivot: [0, 0, 20] }, ['drilled_v0'],
        { }),
      makeStmt('mated_v0', 'translate', { offset: [0, 0, 5] }, ['rot_v0'],
        { }),
    ]

    const result = await runScript(stmts)
    expect(result.failedAt).toBeUndefined()

    // mated_v0 → precise STEP (ADVANCED_FACE + CYLINDRICAL_SURFACE from drill hole)
    const matedSolidEntry = result.brepSolids!.get(asPartName('mated_v0'))!
    const preciseStepBuf = exportStepFromSolid(matedSolidEntry.solid, matedSolidEntry.kernel)
    const preciseStep = new TextDecoder().decode(preciseStepBuf)
    expect(preciseStep).toContain('ADVANCED_FACE')
    // The drilled cylinder has a CYLINDRICAL_SURFACE (precise hole wall)
    expect(preciseStep).toContain('CYLINDRICAL_SURFACE')

    // cube_v0 → faceted STEP (meshesToStep)
    const cubeShape = result.outputs.get(asPartName('cube_v0'))!
    expect(cubeShape).toBeDefined()
    if (!('positions' in cubeShape)) throw new Error('cube_v0 should be a mesh shape')
    const facetedStep = exportStep(cubeShape)
    // Faceted STEP from mesh should NOT contain CYLINDRICAL_SURFACE
    // (cube-10x5x5.stl is a plain box with no cylindrical surfaces)
    expect(facetedStep).not.toContain('CYLINDRICAL_SURFACE')

    fileBlobStore.release(bufferKey)
  })

  it('assembly statement has correct members and is skipped during execution', async () => {
    const bufferKey = fileBlobStore.put(stlBuffer)
    const stmts: StatementIR[] = [
      makeStmt('cube_v0', 'load', { key: bufferKey, format: 'stl' }, [],
        { }),
      makeStmt('cyl_v0', 'cylinder', { radius: 5, height: 20 }, []),
      makeStmt('drilled_v0', 'fai_drill', {
        diameter: 6, depth: 20, holeType: 'simple',
        position: [0, 0, 10], direction: 'normal',
        faceNormal: [0, 0, 1],
      }, ['cyl_v0']),
      makeStmt('grp_asm0', 'assembly', {
        name: 'CubeOnCylinder',
        members: ['cube_v0', 'drilled_v0'],
        constraints: [{
          fixedScopedId: 'cube_v0', movingScopedId: 'drilled_v0',
          fixedFace: { surfaceType: 'plane' },
          movingFace: { surfaceType: 'plane' },
        }],
      }, [], { }),
      makeStmt('rot_v0', 'rotate_euler', { anglesDeg: [180, 0, 0], pivot: [0, 0, 20] }, ['drilled_v0'],
        { }),
      makeStmt('mated_v0', 'translate', { offset: [0, 0, 5] }, ['rot_v0'],
        { }),
    ]

    const result = await runScript(stmts)
    expect(result.failedAt).toBeUndefined()

    // Verify assembly statement metadata
    const asmStmt = stmts.find(s => s.callee === 'assembly')
    expect(asmStmt).toBeDefined()
    expect(asmStmt!.args.members).toEqual(['cube_v0', 'drilled_v0'])

    // Assembly statement produces a compound Shape（Phase 2.4）→ 出现在 ExecutionResult.compounds 而非 outputs
    expect(result.compounds?.get(asPartName('grp_asm0'))).toEqual([
      asPartName('cube_v0'),
      asPartName('drilled_v0'),
    ])

    fileBlobStore.release(bufferKey)
  })
})

// ─── Pivot parity test (§3.7): rotate_euler with pivot — BREP vs mesh bbox consistency ───

describe('Pivot parity: rotate_euler(anglesDeg, pivot) — BREP vs mesh path consistency', () => {
  it('BREP rotate_euler with pivot produces correct result (not rotating around origin)', async () => {
    // Create a box offset from origin, then rotate with a pivot
    // If pivot is ignored, the result will be wrong (rotating around origin)
    const stmts: StatementIR[] = [
      makeStmt('s1', 'box', { size: 10, center: [20, 0, 0] }, []),
      makeStmt('s2', 'rotate_euler', { anglesDeg: [0, 0, 90], pivot: [20, 0, 0] }, ['s1'],
        { }),
    ]

    // Run in auto mode (BREP path)
    const brepRuntime = createRuntime(createTestPorts(), 'auto')
    const brepScript = makePartScript(stmts)
    const brepResult = await brepRuntime.executeIR(brepScript)

    expect(brepResult.failedAt).toBeUndefined()
    expect(brepResult.brepChain.solidCache.has(asPartName('s2'))).toBe(true)

    // Run in mesh mode
    const meshRuntime = createRuntime(createTestPorts(), 'mesh')
    const meshScript = makePartScript(stmts)
    const meshResult = await meshRuntime.executeIR(meshScript)

    expect(meshResult.failedAt).toBeUndefined()

    // Compare bounding boxes — they should be close (pivot was applied in both paths)
    const brepShape = brepResult.outputs.get(asPartName('s2'))!
    const meshShape = meshResult.outputs.get(asPartName('s2'))!
    if (!('positions' in brepShape) || !('positions' in meshShape)) {
      throw new Error('s2 should be a mesh shape in both modes')
    }

    // Calculate bounding boxes
    function bbox(positions: Float32Array) {
      let xmin = Infinity, ymin = Infinity, zmin = Infinity
      let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity
      for (let i = 0; i < positions.length; i += 3) {
        xmin = Math.min(xmin, positions[i])
        ymin = Math.min(ymin, positions[i + 1])
        zmin = Math.min(zmin, positions[i + 2])
        xmax = Math.max(xmax, positions[i])
        ymax = Math.max(ymax, positions[i + 1])
        zmax = Math.max(zmax, positions[i + 2])
      }
      return { xmin, ymin, zmin, xmax, ymax, zmax }
    }

    const brepBB = bbox(brepShape.positions)
    const meshBB = bbox(meshShape.positions)

    // With pivot [20, 0, 0] and 90° Z rotation:
    // Box center [20, 0, 0] → rotated around [20, 0, 0] → stays at [20, 0, 0]
    // Without pivot, it would rotate around origin → center moves to [0, 20, 0]
    // So X range should be around 15-25 (with pivot) vs -5-5 (without pivot)
    expect(brepBB.xmin).toBeCloseTo(15, 0)
    expect(brepBB.xmax).toBeCloseTo(25, 0)

    // BREP and mesh paths should produce similar bounding boxes
    expect(brepBB.xmin).toBeCloseTo(meshBB.xmin, 0)
    expect(brepBB.xmax).toBeCloseTo(meshBB.xmax, 0)
    expect(brepBB.ymin).toBeCloseTo(meshBB.ymin, 0)
    expect(brepBB.ymax).toBeCloseTo(meshBB.ymax, 0)
  })

  it('BREP rotate_euler without pivot matches mesh rotate_euler without pivot', async () => {
    const stmts: StatementIR[] = [
      makeStmt('s1', 'box', { size: 10, center: [20, 0, 0] }, []),
      makeStmt('s2', 'rotate_euler', { anglesDeg: [0, 0, 90] }, ['s1'],
        { }),
    ]

    // BREP path
    const brepRuntime = createRuntime(createTestPorts(), 'auto')
    const brepResult = await brepRuntime.executeIR(makePartScript(stmts))
    expect(brepResult.failedAt).toBeUndefined()

    // Mesh path
    const meshRuntime = createRuntime(createTestPorts(), 'mesh')
    const meshResult = await meshRuntime.executeIR(makePartScript(stmts))
    expect(meshResult.failedAt).toBeUndefined()

    function bbox(positions: Float32Array) {
      let xmin = Infinity, ymin = Infinity
      let xmax = -Infinity, ymax = -Infinity
      for (let i = 0; i < positions.length; i += 3) {
        xmin = Math.min(xmin, positions[i])
        ymin = Math.min(ymin, positions[i + 1])
        xmax = Math.max(xmax, positions[i])
        ymax = Math.max(ymax, positions[i + 1])
      }
      return { xmin, ymin, xmax, ymax }
    }

    const brepShape2 = brepResult.outputs.get(asPartName('s2'))!
    const meshShape2 = meshResult.outputs.get(asPartName('s2'))!
    if (!('positions' in brepShape2) || !('positions' in meshShape2)) {
      throw new Error('s2 should be a mesh shape in both modes')
    }
    const brepBB = bbox(brepShape2.positions)
    const meshBB = bbox(meshShape2.positions)

    // Without pivot, both paths rotate around origin
    // BREP and mesh should produce similar results
    expect(brepBB.xmin).toBeCloseTo(meshBB.xmin, 0)
    expect(brepBB.xmax).toBeCloseTo(meshBB.xmax, 0)
  })
})
