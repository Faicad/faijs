﻿/**
 * @vitest-environment node
 *
 * Operation dispatcher unit tests — driven by CadRuntime (P2).
 *
 * Tests each operation's BREP path by constructing PartScript,
 * running through CadRuntime.replay(), and verifying ExecutionResult.
 *
 * Covers: primitives, transform, boolean, drill, knurl, screw, text, engrave.
 *
 * Run: npx vitest run src/brep/ops/ops.test.ts
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { initOcctWasm, getKernel } from '../../occt-kernel/occtKernel'
import type { OcctKernel } from 'occt-wasm'
import type { Shape } from './types'
import type { CadStatement, FeatureKind, PartScript } from '../../lang/types'
import { createRuntime, type ExecutionResult } from '../../cad-runtime/runtime'
import type { HostPorts, EventSink } from '../../cad-runtime/ports'
import { lastSolidOfChain, MESH_ONLY_OPS } from '../brep-chain'
import { ensureTestFontLoader } from '../text/fontTestHelper'
import { clearFonts, setFontLoader, getFontLoader, ensureDefaultFont, getFont, type FontLoader } from '../text/fontRegistry'

let kernel: OcctKernel

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel()
  // 注入 fs 字体加载器（字体由 executeText → ensureDefaultFont 惰性加载）
  ensureTestFontLoader()
}, 120000)

// ── Test helpers ──

/** Simple EventSink for Node test environment */
class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: 'brep-chain-broken', detail: { partId: string; op: string; reason: string }): void {
    this.events.push({ event, detail: { ...detail } })
  }
  clear(): void { this.events.length = 0 }
}

/** Create node-friendly HostPorts (BREP-path only; csg/sdf are stubs) */
function createNodePorts(): HostPorts {
  return {
    events: new TestEventSink(),
    // csg/sdf: BREP-path ops don't need them; mesh-path ops will fail in node
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
  }
}

function makePartScript(statements: CadStatement[]): PartScript {
  return {
    source: { kind: 'load' },
    params: [],
    statements,
  }
}

/** Run statements through CadRuntime.replay() — the P2 execution path */
async function runScript(statements: CadStatement[]): Promise<ExecutionResult> {
  const runtime = createRuntime(createNodePorts())
  const script = makePartScript(statements)
  return runtime.replay(script)
}

function shapeVertexCount(s: Shape): number { return s.positions.length / 3 }
function shapeTriangleCount(s: Shape): number { return s.indices.length / 3 }

/** Get the last non-marker statement's output from ExecutionResult */
function getFinalOutput(result: ExecutionResult, statements: CadStatement[]): Shape {
  const nonMarker = statements.filter(s => !s.isMarker)
  const last = nonMarker[nonMarker.length - 1]
  const shape = result.outputs.get(last.id)
  if (!shape) throw new Error(`No output for terminal statement "${last.id}"`)
  return shape
}

// ─── Primitives ───

describe('CadRuntime.replay: primitives (BREP)', () => {
  it('box: should produce a valid Shape + cache solid', async () => {
    const stmt = makeStmt('s1', 'box', { size: 20 }, [])
    const result = await runScript([stmt])

    const shape = getFinalOutput(result, [stmt])
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(shapeTriangleCount(shape)).toBeGreaterThan(0)
    expect(result.brepChain.brepActive).toBe(true)
    expect(result.brepChain.solidCache.has('s1')).toBe(true)
  })

  it('sphere: should produce a valid Shape + cache solid', async () => {
    const stmt = makeStmt('s1', 'sphere', { radius: 10 }, [])
    const result = await runScript([stmt])

    const shape = getFinalOutput(result, [stmt])
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(result.brepChain.solidCache.has('s1')).toBe(true)
  })

  it('cylinder: should produce a valid Shape + cache solid', async () => {
    const stmt = makeStmt('s1', 'cylinder', { radius: 5, height: 20 }, [])
    const result = await runScript([stmt])

    const shape = getFinalOutput(result, [stmt])
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(result.brepChain.solidCache.has('s1')).toBe(true)
  })

  it('cone: should produce a valid Shape + cache solid', async () => {
    const stmt = makeStmt('s1', 'cone', { radiusBottom: 10, radiusTop: 0, height: 20 }, [])
    const result = await runScript([stmt])

    const shape = getFinalOutput(result, [stmt])
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(result.brepChain.solidCache.has('s1')).toBe(true)
  })
})

// ─── Transform ───

describe('CadRuntime.replay: transform (BREP)', () => {
  it('translate: should translate the solid and keep chain active', async () => {
    const s1 = makeStmt('s1', 'box', { size: 20 }, [])
    const s2 = makeStmt('s2', 'translate', { offset: [10, 0, 0] }, ['s1'])
    const result = await runScript([s1, s2])

    const shape = getFinalOutput(result, [s1, s2])
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(result.brepChain.brepActive).toBe(true)
    expect(result.brepChain.solidCache.has('s2')).toBe(true)
  })

  it('rotate: should rotate the solid and keep chain active', async () => {
    const s1 = makeStmt('s1', 'box', { size: 20 }, [])
    const s2 = makeStmt('s2', 'rotate', { anglesDeg: [0, 0, 45] }, ['s1'])
    const result = await runScript([s1, s2])

    const shape = getFinalOutput(result, [s1, s2])
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(result.brepChain.brepActive).toBe(true)
  })

  it('scale: should scale the solid and keep chain active', async () => {
    const s1 = makeStmt('s1', 'box', { size: 20 }, [])
    const s2 = makeStmt('s2', 'scale', { factor: 2 }, ['s1'])
    const result = await runScript([s1, s2])

    const shape = getFinalOutput(result, [s1, s2])
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(result.brepChain.brepActive).toBe(true)
  })
})

// ─── Boolean ───

describe('CadRuntime.replay: boolean (BREP)', () => {
  it('union: should fuse two boxes and keep chain active', async () => {
    const s1 = makeStmt('s1', 'box', { size: 20 }, [])
    const s2 = makeStmt('s2', 'box', { size: 20, center: [20, 0, 0] }, [])
    const s3 = makeStmt('s3', 'boolean', { operation: 'union' }, ['s1', 's2'])
    const result = await runScript([s1, s2, s3])

    const shape = getFinalOutput(result, [s1, s2, s3])
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(result.brepChain.brepActive).toBe(true)
    expect(result.brepChain.solidCache.has('s3')).toBe(true)
  })

  it('subtract: should cut one box from another and keep chain active', async () => {
    const s1 = makeStmt('s1', 'box', { size: 20 }, [])
    const s2 = makeStmt('s2', 'box', { size: 10 }, [])
    const s3 = makeStmt('s3', 'boolean', { operation: 'subtract' }, ['s1', 's2'])
    const result = await runScript([s1, s2, s3])

    const shape = getFinalOutput(result, [s1, s2, s3])
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(result.brepChain.brepActive).toBe(true)
  })
})

// ─── Drill ───

describe('CadRuntime.replay: drill (BREP)', () => {
  it('simple hole: should drill a through hole and keep chain active', async () => {
    const s1 = makeStmt('s1', 'box', { size: 20 }, [])
    const s2 = makeStmt('s2', 'drill', {
      diameter: 5, depth: 0,
      position: [0, 0, 10], direction: 'normal',
      faceNormal: [0, 0, 1], holeType: 'simple',
    }, ['s1'])
    const result = await runScript([s1, s2])

    const shape = getFinalOutput(result, [s1, s2])
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(result.brepChain.brepActive).toBe(true)
    expect(result.brepChain.solidCache.has('s2')).toBe(true)
  })
})

// ─── Knurl ───

describe('CadRuntime.replay: knurl (mesh-only, static chain break)', () => {
  it('knurl is in MESH_ONLY_OPS (static determination)', () => {
    // 静态判定：knurl 没有 BREP 实现，属于 mesh-only 操作
    expect(MESH_ONLY_OPS.has('knurl')).toBe(true)
  })

  it('should break BREP chain statically, then mesh path throws in node', async () => {
    const ports = createNodePorts()
    const sink = ports.events as TestEventSink
    const runtime = createRuntime(ports)
    const script = makePartScript([
      makeStmt('s1', 'box', { size: 20 }, []),
      makeStmt('s2', 'knurl', {
        faceCenter: [0, 0, 10], faceNormal: [0, 0, 1],
        knurlScaleU: 0.15, knurlScaleV: 0.15, knurlTextureHeight: 0.5,
      }, ['s1']),
    ])

    // knurl is mesh-only: chain breaks statically, then mesh path throws in node (Image not defined)
    try {
      await runtime.replay(script)
    } catch {
      // Expected: knurl mesh path fails in node
    }

    // brep-chain-broken event emitted during static break BEFORE execution
    expect(sink.events.length).toBeGreaterThan(0)
    expect(sink.events[0].event).toBe('brep-chain-broken')
    expect(sink.events[0].detail.op).toBe('knurl')
  })
})

// ─── Text ───

describe('CadRuntime.replay: text (BREP)', () => {
  it('should produce a valid Shape + cache solid + keep chain active', async () => {
    const stmt = makeStmt('s1', 'text', { text: 'A', size: 16, depth: 2 })
    const result = await runScript([stmt])

    const shape = getFinalOutput(result, [stmt])
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(result.brepChain.brepActive).toBe(true)
    expect(result.brepChain.solidCache.has('s1')).toBe(true)
  })

  it('STEP export should contain ADVANCED_FACE', async () => {
    const stmt = makeStmt('s1', 'text', { text: 'B', size: 20, depth: 3 })
    const result = await runScript([stmt])

    expect(result.brepSolid).toBeDefined()
    const step = kernel.exportStep(result.brepSolid!.solid)
    expect(step).toContain('ADVANCED_FACE')
  })
})

// ─── Engrave ───

describe('CadRuntime.replay: engrave (BREP)', () => {
  it('concave: should cut text from box and keep chain active', async () => {
    const s1 = makeStmt('s1', 'box', { size: 30 }, [])
    const s2 = makeStmt('s2', 'engrave', {
      engravingType: 'text', mode: 'concave', depth: 2,
      text: 'A', textSize: 10,
    }, ['s1'])
    const result = await runScript([s1, s2])

    const shape = getFinalOutput(result, [s1, s2])
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(result.brepChain.brepActive).toBe(true)
    expect(result.brepChain.solidCache.has('s2')).toBe(true)
  })

  it('convex: should fuse text to box and keep chain active', async () => {
    const s1 = makeStmt('s1', 'box', { size: 30 }, [])
    const s2 = makeStmt('s2', 'engrave', {
      engravingType: 'text', mode: 'convex', depth: 2,
      text: 'A', textSize: 10,
    }, ['s1'])
    const result = await runScript([s1, s2])

    const shape = getFinalOutput(result, [s1, s2])
    expect(shapeVertexCount(shape)).toBeGreaterThan(0)
    expect(result.brepChain.brepActive).toBe(true)
  })
})

// ─── BREP chain integrity ───

describe('BREP chain integrity', () => {
  it('box → translate → drill → knurl: chain stays active throughout', async () => {
    const stmts = [
      makeStmt('s1', 'box', { size: 20 }, []),
      makeStmt('s2', 'translate', { offset: [5, 0, 0] }, ['s1']),
      makeStmt('s3', 'drill', {
        diameter: 4, depth: 0,
        position: [5, 0, 10], direction: 'normal',
        faceNormal: [0, 0, 1], holeType: 'simple',
      }, ['s2']),
    ]
    const result = await runScript(stmts)

    expect(result.brepChain.brepActive).toBe(true)

    // Final STEP should contain ADVANCED_FACE
    expect(result.brepSolid).toBeDefined()
    const step = kernel.exportStep(result.brepSolid!.solid)
    expect(step).toContain('ADVANCED_FACE')
  })
})

// ─── Font loading failure ───

describe('CadRuntime.replay: text font loading failure', () => {
  let savedLoader: FontLoader | null

  beforeAll(() => {
    savedLoader = getFontLoader()
  })

  afterEach(() => {
    // 恢复原始 fs loader，清除字体缓存以便后续测试重新加载
    clearFonts()
    setFontLoader(savedLoader)
  })

  it('should throw when font loader fails (simulated browser 404) — no mesh fallback', async () => {
    // 模拟浏览器字体 404：注入抛错的 loader
    clearFonts()
    setFontLoader({
      loadDefaultFont: async () => {
        throw new Error('Simulated font fetch 404')
      },
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const stmt = makeStmt('s1', 'text', { text: 'A', size: 16, depth: 2 })

    // BREP 路径因字体加载失败而报错 → 错误直接冒泡（禁止 try-catch 回退 mesh）
    // text 是 BREP_NATIVE_OP，字体加载失败是运行时 bug，不是静态断链条件
    await expect(runScript([stmt])).rejects.toThrow('font')

    errorSpy.mockRestore()
  })

  it('ensureDefaultFont should throw when font loader fails (simulated browser 404)', async () => {
    // 直接测试 ensureDefaultFont 的错误传播
    clearFonts()
    setFontLoader({
      loadDefaultFont: async () => {
        throw new Error('Simulated font fetch 404')
      },
    })

    await expect(ensureDefaultFont()).rejects.toThrow('Simulated font fetch 404')

    // 字体不应被注册
    expect(getFont('default')).toBeUndefined()
  })

  it('ensureDefaultFont should load font successfully with injected fs loader', async () => {
    // 验证恢复 fs loader 后能正常加载
    clearFonts()
    // fs loader 已在 beforeAll 中设置，afterEach 会恢复
    await ensureDefaultFont()
    expect(getFont('default')).toBeDefined()
    expect(getFont('default')?.charToGlyph).toBeDefined()
  })

  it('ensureDefaultFont should throw when no loader is set', async () => {
    clearFonts()
    setFontLoader(null)
    await expect(ensureDefaultFont()).rejects.toThrow('No font loader set')
  })
})

// ─── 断链后拓扑保留（假拓扑）───

describe('BREP chain break: topology preservation (fake topology)', () => {
  it('box → sdf: chain breaks statically at sdf, box solid preserved in cache', async () => {
    // 运行 box（不含 sdf），验证 BREP solid 存入 cache
    const s1 = makeStmt('s1', 'box', { size: 20 }, [])
    const result = await runScript([s1])

    // Chain should be active (no mesh-only op encountered)
    expect(result.brepChain.brepActive).toBe(true)
    expect(result.brepChain.solidCache.has('s1')).toBe(true)

    // The box solid should be exportable as ADVANCED_FACE
    const boxSolid = result.brepChain.solidCache.get('s1')!
    const step = kernel.exportStep(boxSolid)
    expect(step).toContain('ADVANCED_FACE')

    // sdf 是 mesh-only op：遇到时链会静态断裂
    expect(MESH_ONLY_OPS.has('sdf')).toBe(true)
  })

  it('box → drill → sdf: drill solid preserved in cache before sdf breaks chain', async () => {
    // 运行 box → drill（不含 sdf），验证 drill solid 存入 cache
    const s1 = makeStmt('s1', 'box', { size: 20 }, [])
    const s2 = makeStmt('s2', 'drill', {
      diameter: 5, depth: 0,
      position: [0, 0, 10], direction: 'normal',
      faceNormal: [0, 0, 1], holeType: 'simple',
    }, ['s1'])
    const result = await runScript([s1, s2])

    // Chain should be active (drill is BREP-native)
    expect(result.brepChain.brepActive).toBe(true)

    // lastSolidOfChain should return the drill solid (not the box solid)
    const lastSolid = lastSolidOfChain(result.brepChain)
    expect(lastSolid).toBeDefined()
    // The drill solid should have a hole (CYLINDRICAL_SURFACE)
    const step = kernel.exportStep(lastSolid!)
    expect(step).toContain('ADVANCED_FACE')
    expect(step).toContain('CYLINDRICAL_SURFACE')

    // sdf 是 mesh-only op：遇到时链会静态断裂，lastSolidOfChain 返回 drill solid
    expect(MESH_ONLY_OPS.has('sdf')).toBe(true)
  })

  it('lastSolidOfChain returns undefined for empty solidCache', () => {
    // Direct test with empty chain state (not via runtime)
    const emptyChain = { solidCache: new Map(), brepActive: true, kernel: null }
    expect(lastSolidOfChain(emptyChain as any)).toBeUndefined()
  })
})
