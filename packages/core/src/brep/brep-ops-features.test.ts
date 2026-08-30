/**
 * @vitest-environment node
 *
 * BREP 特征操作单元测试 (Phase 2)
 *
 * 测试内容：
 * 1. BREP 变换操作（translateBrep/rotateBrep/scaleBrep）
 * 2. BREP 布尔操作（fuseBrep/cutBrep/commonBrep）
 * 3. BREP 钻孔操作（drillBrep — 圆柱通孔/盲孔）
 * 4. BREP 平面分割操作（splitBrep）
 * 5. BREP 拉伸操作（extrudeBrep）
 * 6. BREP 链状态管理（createBrepChainState/releaseBrepChainState）
 * 7. BREP 特征链的 STEP 导出精确曲面验证
 * 8. BREP 链断裂逻辑（isDrillBrepCapable/isSplitBrepCapable）
 *
 * 运行：npx vitest run src/mesh/mesh-api.test.ts
 */

// ─── OCCT stdout 噪声过滤 ───
const occtOrigLog = console.log
console.log = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  const isOcctNoise =
    msg.includes('Statistics on Transfer') ||
    msg.includes('Transfer Mode =') ||
    msg.includes('Transferring Shape') ||
    msg.includes('WorkSession') ||
    /^\*{4,}/.test(msg) ||
    msg.startsWith(' Step File Name')
  if (isOcctNoise || msg.trim() === '') return
  occtOrigLog(...args)
}

import { describe, it, expect, beforeAll } from 'vitest'
import { getKernel } from '../occt-kernel/occtKernel'
import { registerOcctBrepEngine } from './engine/adapters/occt'
import { primitiveToBrepSolid, brepSolidToStep } from '../primitives/brep-primitives'
import type { BrepHandle } from './engine/types'
import type { BrepEngineApi } from './engine/primitives'
import {
  translateBrep, rotateBrep, scaleBrep,
  fuseBrep, cutBrep, commonBrep,
  drillBrep, splitBrep,
  solidToShape, getSolidBoundingBox,
  createBrepChainState, initBrepChainState,
  releaseBrepChainState,
  isCadFormat,
} from '../brep'
import type { Shape } from '../mesh/types'
import { executeScript } from '../test-helpers'
import { ensureTestFontLoader } from '../brep/text/fontTestHelper'
import type { StatementIR, ScriptIR } from '../lang/types'
import { asPartName, asStmtId } from '../identity'

let kernel: BrepEngineApi

beforeAll(async () => {
  await registerOcctBrepEngine()
  kernel = getKernel() as unknown as BrepEngineApi
  // 注入 fs 字体加载器（BREP text/engrave 操作需要）
  ensureTestFontLoader()
}, 120000)

// ── 辅助函数 ──

function shapeVertexCount(s: Shape): number {
  return s.positions.length / 3
}

function shapeTriangleCount(s: Shape): number {
  return s.indices.length / 3
}

function shapeBoundingBox(s: Shape) {
  let xmin = Infinity, ymin = Infinity, zmin = Infinity
  let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity
  for (let i = 0; i < s.positions.length; i += 3) {
    const x = s.positions[i], y = s.positions[i + 1], z = s.positions[i + 2]
    if (x < xmin) xmin = x; if (y < ymin) ymin = y; if (z < zmin) zmin = z
    if (x > xmax) xmax = x; if (y > ymax) ymax = y; if (z > zmax) zmax = z
  }
  return { min: [xmin, ymin, zmin] as [number, number, number], max: [xmax, ymax, zmax] as [number, number, number] }
}

function makeBox(size = 20): BrepHandle {
  return primitiveToBrepSolid(kernel, 'cube', { size }).solid
}

function makeCylinder(radius: number, height: number): BrepHandle {
  return primitiveToBrepSolid(kernel, 'cylinder', { radius, height }).solid
}

// ── BREP 变换操作 ──

describe('BREP transform ops', () => {
  it('translateBrep: translates solid by offset', () => {
    const box = makeBox(20)
    try {
      const translated = translateBrep(kernel, box, [50, 0, 0])
      const bb = getSolidBoundingBox(kernel, translated)
      expect(bb.min[0]).toBeCloseTo(40, 1) // -10 + 50 = 40
      expect(bb.max[0]).toBeCloseTo(60, 1) // 10 + 50 = 60
      kernel.release(translated)
    } finally {
      kernel.release(box)
    }
  })

  it('rotateBrep: rotates solid 90° around Z', () => {
    // cubeToCadSolid maps size [w,h,d] to X=w, Y=d, Z=h (Y/Z swap)
    // So size [10, 20, 30] → X=10, Y=30, Z=20
    const box = primitiveToBrepSolid(kernel, 'cube', { size: [10, 20, 30] }).solid
    try {
      const rotated = rotateBrep(kernel, box, [0, 0, 90])
      const bb = getSolidBoundingBox(kernel, rotated)
      // After 90° Z rotation: X←Y, Y←-X, Z stays
      // Original: X=10, Y=30, Z=20 → Rotated: X=30, Y=10, Z=20
      expect(bb.max[0] - bb.min[0]).toBeCloseTo(30, 1)
      expect(bb.max[1] - bb.min[1]).toBeCloseTo(10, 1)
      expect(bb.max[2] - bb.min[2]).toBeCloseTo(20, 1)
      kernel.release(rotated)
    } finally {
      kernel.release(box)
    }
  })

  it('scaleBrep: uniform scale by factor 2', () => {
    const box = makeBox(10)
    try {
      const scaled = scaleBrep(kernel, box, 2)
      const bb = getSolidBoundingBox(kernel, scaled)
      expect(bb.max[0] - bb.min[0]).toBeCloseTo(20, 1)
      expect(bb.max[1] - bb.min[1]).toBeCloseTo(20, 1)
      expect(bb.max[2] - bb.min[2]).toBeCloseTo(20, 1)
      kernel.release(scaled)
    } finally {
      kernel.release(box)
    }
  })

  it('scaleBrep: non-uniform scale produces valid result', () => {
    const box = makeBox(10)
    try {
      const scaled = scaleBrep(kernel, box, [2, 1, 3])
      const shape = solidToShape(kernel, scaled)
      expect(shapeVertexCount(shape)).toBeGreaterThan(0)
      expect(shapeTriangleCount(shape)).toBeGreaterThan(0)
      // Bounding box should be larger than original in at least one dimension
      const bb = shapeBoundingBox(shape)
      expect(bb.max[0] - bb.min[0]).toBeGreaterThan(10) // X scaled by 2
      kernel.release(scaled)
    } finally {
      kernel.release(box)
    }
  })
})

// ── BREP 布尔操作 ──

describe('BREP boolean ops', () => {
  it('fuseBrep: two boxes → larger solid', () => {
    const box1 = makeBox(20)
    const box2 = translateBrep(kernel, makeBox(20), [10, 0, 0])
    try {
      const fused = fuseBrep(kernel, box1, box2)
      const bb = getSolidBoundingBox(kernel, fused)
      // box1: -10..10, box2: 0..20 → fused: -10..20 (30 wide)
      expect(bb.max[0] - bb.min[0]).toBeCloseTo(30, 1)
      kernel.release(fused)
    } finally {
      kernel.release(box1)
      kernel.release(box2)
    }
  })

  it('cutBrep: subtract cylinder from box', () => {
    const box = makeBox(20)
    const cyl = makeCylinder(3, 30) // taller than box
    try {
      const result = cutBrep(kernel, box, cyl)
      const shape = solidToShape(kernel, result)
      // Should have more triangles than a plain box (due to hole)
      expect(shapeTriangleCount(shape)).toBeGreaterThan(12) // plain box = 12 triangles
      // Bounding box should still be ~20
      const bb = shapeBoundingBox(shape)
      expect(bb.max[0] - bb.min[0]).toBeCloseTo(20, 0)
      kernel.release(result)
    } finally {
      kernel.release(box)
      kernel.release(cyl)
    }
  })

  it('commonBrep: intersection of two overlapping boxes', () => {
    const box1 = makeBox(20)
    const box2 = translateBrep(kernel, makeBox(20), [5, 0, 0])
    try {
      const common = commonBrep(kernel, box1, box2)
      const bb = getSolidBoundingBox(kernel, common)
      // Overlap region: x=−10..15 (width 15), full 20 in y and z
      expect(bb.max[0] - bb.min[0]).toBeCloseTo(15, 1)
      expect(bb.max[1] - bb.min[1]).toBeCloseTo(20, 1)
      expect(bb.max[2] - bb.min[2]).toBeCloseTo(20, 1)
      kernel.release(common)
    } finally {
      kernel.release(box1)
      kernel.release(box2)
    }
  })
})

// ── BREP 钻孔操作 ──

describe('BREP drill op', () => {
  it('drillBrep: through hole (depth=0) in box', () => {
    const box = makeBox(20)
    try {
      const result = drillBrep(kernel, box, {
        diameter: 6,
        depth: 0, // through hole
        position: [0, 0, 10], // top face center
        direction: [0, 0, -1], // downward
        faceNormal: [0, 0, 1], // top face normal
      })
      const shape = solidToShape(kernel, result)
      // Should have more triangles than plain box (hole walls)
      expect(shapeTriangleCount(shape)).toBeGreaterThan(12)
      // Bounding box unchanged
      const bb = shapeBoundingBox(shape)
      expect(bb.max[2] - bb.min[2]).toBeCloseTo(20, 0)
      kernel.release(result)
    } finally {
      kernel.release(box)
    }
  })

  it('drillBrep: blind hole (depth>0) in box', () => {
    const box = makeBox(20)
    try {
      const result = drillBrep(kernel, box, {
        diameter: 5,
        depth: 8, // blind hole, 8mm deep
        position: [0, 0, 10], // top face center
        direction: [0, 0, -1],
        faceNormal: [0, 0, 1],
      })
      const shape = solidToShape(kernel, result)
      expect(shapeTriangleCount(shape)).toBeGreaterThan(12)
      // Bounding box unchanged
      const bb = shapeBoundingBox(shape)
      expect(bb.max[2] - bb.min[2]).toBeCloseTo(20, 0)
      kernel.release(result)
    } finally {
      kernel.release(box)
    }
  })

  it('drillBrep: hole on side face (X direction)', () => {
    const box = makeBox(20)
    try {
      const result = drillBrep(kernel, box, {
        diameter: 4,
        depth: 0,
        position: [10, 0, 0], // right face center
        direction: [-1, 0, 0], // inward
        faceNormal: [1, 0, 0], // right face normal
      })
      const shape = solidToShape(kernel, result)
      expect(shapeTriangleCount(shape)).toBeGreaterThan(12)
      kernel.release(result)
    } finally {
      kernel.release(box)
    }
  })

  it('drillBrep: resulting solid exports as STEP with CYLINDRICAL_SURFACE', () => {
    const box = makeBox(20)
    try {
      const result = drillBrep(kernel, box, {
        diameter: 6,
        depth: 0,
        position: [0, 0, 10],
        direction: [0, 0, -1],
        faceNormal: [0, 0, 1],
      })
      try {
        const step = brepSolidToStep(kernel, result)
        // Should have ADVANCED_FACE (not POLYGONAL_FACE)
        expect(step).toContain('ADVANCED_FACE')
        expect(step).not.toContain('POLYGONAL_FACE')
        // Should have CYLINDRICAL_SURFACE (the hole wall)
        expect(step).toContain('CYLINDRICAL_SURFACE')
        // Should also have PLANE (box faces)
        expect(step).toContain('PLANE')
      } finally {
        kernel.release(result)
      }
    } finally {
      kernel.release(box)
    }
  })
})

// ── BREP 平面分割操作 ──

describe('BREP split op', () => {
  it('splitBrep: splits box into two halves', () => {
    const box = makeBox(20)
    try {
      const result = splitBrep(kernel, box, {
        normal: [0, 0, 1],
        originOffset: 0,
        planeCenter: [0, 0, 0],
      })
      try {
        // Front (z>0) should be half the box: 10 high
        const frontBB = getSolidBoundingBox(kernel, result.front)
        expect(frontBB.max[2]).toBeGreaterThan(0)
        expect(frontBB.min[2]).toBeGreaterThanOrEqual(-0.001) // at or near 0

        // Back (z<0) should be the other half
        const backBB = getSolidBoundingBox(kernel, result.back)
        expect(backBB.min[2]).toBeLessThan(0)
        expect(backBB.max[2]).toBeLessThanOrEqual(0.001) // at or near 0
      } finally {
        kernel.release(result.front)
        kernel.release(result.back)
      }
    } finally {
      kernel.release(box)
    }
  })

  it('splitBrep: front half exports as STEP with PLANE (cut face)', () => {
    const box = makeBox(20)
    try {
      const result = splitBrep(kernel, box, {
        normal: [0, 0, 1],
        originOffset: 0,
        planeCenter: [0, 0, 0],
      })
      try {
        const step = brepSolidToStep(kernel, result.front)
        expect(step).toContain('ADVANCED_FACE')
        expect(step).not.toContain('POLYGONAL_FACE')
        expect(step).toContain('PLANE')
      } finally {
        kernel.release(result.front)
        kernel.release(result.back)
      }
    } finally {
      kernel.release(box)
    }
  })
})

// ── BREP 链状态管理 ──

describe('BREP chain state management', () => {
  it('createBrepChainState: creates empty state with kernel=null', () => {
    const state = createBrepChainState()
    expect(state.solidCache.size).toBe(0)
    expect(state.kernel).toBeNull()
  })

  it('initBrepChainState: creates state with initialized kernel', async () => {
    const state = await initBrepChainState()
    expect(state.kernel).not.toBeNull()
    state.solidCache.clear()
  })

  it('releaseBrepChainState: releases all handles and clears solidCache', () => {
    const state = createBrepChainState()
    const solid1 = makeBox(20)
    const solid2 = makeBox(10)
    state.solidCache.set(asPartName('stmt-1'), solid1)
    state.solidCache.set(asPartName('stmt-2'), solid2)

    // Persistent SolidCache 方案：keepIds 已删除，release 语义为全量释放 + 清空
    releaseBrepChainState(state)
    expect(state.solidCache.size).toBe(0)
  })
})

// ── isCadFormat 静态判定（BREP 能力集合已随 src/ops/ 删除，Phase 2.5） ──

  it('isCadFormat: step format → true', () => {
    expect(isCadFormat({ format: 'step' }, true)).toBe(true)
    expect(isCadFormat({ format: 'stp' }, true)).toBe(true)
    expect(isCadFormat({ format: 'brep' }, true)).toBe(true)
  })

  it('isCadFormat: 3mf/stl/iges format → false', () => {
    expect(isCadFormat({ format: '3mf' }, true)).toBe(false)
    expect(isCadFormat({ format: 'stl' }, true)).toBe(false)
    expect(isCadFormat({ format: 'obj' }, true)).toBe(false)
    expect(isCadFormat({ format: 'iges' }, true)).toBe(false)
  })

  it('isCadFormat: non-source buffer → false', () => {
    expect(isCadFormat({ format: 'step' }, false)).toBe(false)
  })

  it('isCadFormat: no format, infer from path/url extension', () => {
    expect(isCadFormat({ path: 'model.step' }, true)).toBe(true)
    expect(isCadFormat({ path: 'model.stp' }, true)).toBe(true)
    expect(isCadFormat({ path: 'model.3mf' }, true)).toBe(false)
    expect(isCadFormat({ path: 'model' }, true)).toBe(false)
    expect(isCadFormat({ url: 'https://example.com/model.step' }, true)).toBe(true)
    expect(isCadFormat({ url: 'https://example.com/model.3mf' }, true)).toBe(false)
  })

// ── BREP 特征链 STEP 导出精确曲面验证 ──

describe('BREP feature chain: STEP export precision', () => {
  it('box → drill: STEP has CYLINDRICAL_SURFACE (precise hole, not polygonal)', () => {
    const box = makeBox(20)
    try {
      const drilled = drillBrep(kernel, box, {
        diameter: 6,
        depth: 0,
        position: [0, 0, 10],
        direction: [0, 0, -1],
        faceNormal: [0, 0, 1],
      })
      try {
        const step = brepSolidToStep(kernel, drilled)
        expect(step).toContain('ADVANCED_FACE')
        expect(step).toContain('CYLINDRICAL_SURFACE')
        expect(step).not.toContain('POLYGONAL_FACE')
      } finally {
        kernel.release(drilled)
      }
    } finally {
      kernel.release(box)
    }
  })

  it('box → fuse(box): STEP has PLANE surfaces (boolean union)', () => {
    const box1 = makeBox(20)
    const box2 = translateBrep(kernel, makeBox(20), [10, 0, 0])
    try {
      const fused = fuseBrep(kernel, box1, box2)
      try {
        const step = brepSolidToStep(kernel, fused)
        expect(step).toContain('ADVANCED_FACE')
        expect(step).toContain('PLANE')
        expect(step).not.toContain('POLYGONAL_FACE')
      } finally {
        kernel.release(fused)
      }
    } finally {
      kernel.release(box1)
      kernel.release(box2)
    }
  })

  it('box → cut(cylinder): STEP has CYLINDRICAL_SURFACE (precise cut)', () => {
    const box = makeBox(20)
    const cyl = makeCylinder(4, 30)
    try {
      const cut = cutBrep(kernel, box, cyl)
      try {
        const step = brepSolidToStep(kernel, cut)
        expect(step).toContain('ADVANCED_FACE')
        expect(step).toContain('CYLINDRICAL_SURFACE')
        expect(step).not.toContain('POLYGONAL_FACE')
      } finally {
        kernel.release(cut)
      }
    } finally {
      kernel.release(box)
      kernel.release(cyl)
    }
  })
})

// ── solidToShape 辅助函数 ──

describe('solidToShape', () => {
  it('converts solid to valid Shape', () => {
    const box = makeBox(20)
    try {
      const shape = solidToShape(kernel, box)
      expect(shape.positions).toBeInstanceOf(Float32Array)
      expect(shape.indices).toBeInstanceOf(Uint32Array)
      expect(shapeVertexCount(shape)).toBeGreaterThan(0)
      expect(shapeTriangleCount(shape)).toBeGreaterThan(0)
    } finally {
      kernel.release(box)
    }
  })

  it('produces valid mesh for cylinder with segments param', () => {
    const cyl = makeCylinder(10, 20)
    try {
      const shape = solidToShape(kernel, cyl, 32)
      expect(shapeVertexCount(shape)).toBeGreaterThan(0)
      expect(shapeTriangleCount(shape)).toBeGreaterThan(0)
    } finally {
      kernel.release(cyl)
    }
  })
})

// ── getSolidBoundingBox ──

describe('getSolidBoundingBox', () => {
  it('returns correct bounding box for box', () => {
    const box = makeBox(20)
    try {
      const bb = getSolidBoundingBox(kernel, box)
      expect(bb.min[0]).toBeCloseTo(-10, 1)
      expect(bb.max[0]).toBeCloseTo(10, 1)
      expect(bb.min[1]).toBeCloseTo(-10, 1)
      expect(bb.max[1]).toBeCloseTo(10, 1)
      expect(bb.min[2]).toBeCloseTo(-10, 1)
      expect(bb.max[2]).toBeCloseTo(10, 1)
    } finally {
      kernel.release(box)
    }
  })

  it('returns correct bounding box for cylinder', () => {
    const cyl = makeCylinder(5, 10)
    try {
      const bb = getSolidBoundingBox(kernel, cyl)
      expect(bb.max[0] - bb.min[0]).toBeCloseTo(10, 1) // diameter
      expect(bb.max[2] - bb.min[2]).toBeCloseTo(10, 1) // height
    } finally {
      kernel.release(cyl)
    }
  })
})

// ── BREP 链断裂可逆性（§1.6: 删/改 mesh-only op → 链自动愈合）──
//
// 核心概念：BREP 链的断裂状态不是持久化在零件上的，而是每次 executeScript 时
// 由语句链重新推导。遇到 mesh-only op（engrave）→ 链断裂；删除该 op → 链自动愈合。
// 严禁把"已断裂"作为脱离链的零件状态单独持久化（那会造成"无法回退"）。

describe('BREP chain reversibility (§1.6: mesh-only op breakage is derived from statement chain)', () => {
  // 辅助：构造最小 StatementIR
  function makeStmt(
    id: string,
    callee: string,
    args: Record<string, unknown>,
    inputs: string[] = [],
  ): StatementIR {
    return {
      id: asStmtId(id),
      callee,
      args: args as any,
      inputs: inputs.map(asPartName),
      outputs: [asPartName(id)],
      hasAssignment: true,
    }
  }

  // 辅助：构造最小 ScriptIR
  function makeScript(statements: StatementIR[]): ScriptIR {
    return {
      params: [],
      source: { kind: 'load' },
      statements,
    }
  }

  it('executeScript(box → drill, brep) → solid in cache', async () => {
    const script = makeScript([
      makeStmt('s1', 'box', { size: 20 }, []),
      makeStmt('s2', 'drill', {
        diameter: 6, depth: 0,
        position: [0, 0, 10], direction: 'normal',
        faceNormal: [0, 0, 1], holeType: 'simple',
      }, ['s1']),
    ])

    const result = await executeScript(script)
    expect(result.brepChain.solidCache.has(asPartName('s2'))).toBe(true)
    expect(result.brepChain.kernel).not.toBeNull()

    // Clean up solid handles
    if (result.brepChain) {
      releaseBrepChainState(result.brepChain)
    }
  })

  it('executeScript(box → drill → engrave, brep) → chain stays active (BREP engrave implemented)', async () => {
    // 在 BREP 链中遇到 engrave → BREP 路径执行（textToSolid + boolean），链不断裂
    const script = makeScript([
      makeStmt('s1', 'box', { size: 20 }, []),
      makeStmt('s2', 'drill', {
        diameter: 6, depth: 0,
        position: [0, 0, 10], direction: 'normal',
        faceNormal: [0, 0, 1], holeType: 'simple',
      }, ['s1']),
      makeStmt('s3', 'engrave', {
        engravingType: 'text', mode: 'concave', depth: 1,
        text: 'A', textSize: 10,
      }, ['s2']),
    ])
    const result = await executeScript(script)

    // 验证链未断裂（box/drill/engrave 均有 solid）
    expect(result.brepChain.solidCache.has(asPartName('s1'))).toBe(true)
    expect(result.brepChain.solidCache.has(asPartName('s2'))).toBe(true)
    expect(result.brepChain.solidCache.has(asPartName('s3'))).toBe(true)

    // Clean up
    releaseBrepChainState(result.brepChain)
  })

  it('executeScript without engrave → solid still in cache (chain healed, not persistent)', async () => {
    // 核心测试：BREP 状态不是持久状态。每次 executeScript 创建新的 BrepChainState，
    // 删除 engrave 语句后重放 → solidCache 仍有 drill solid
    const script = makeScript([
      makeStmt('s1', 'box', { size: 20 }, []),
      makeStmt('s2', 'drill', {
        diameter: 6, depth: 0,
        position: [0, 0, 10], direction: 'normal',
        faceNormal: [0, 0, 1], holeType: 'simple',
      }, ['s1']),
      // 没有 engrave — 链应保持活跃
    ])

    const result = await executeScript(script)
    expect(result.brepChain.solidCache.has(asPartName('s2'))).toBe(true)

    // Clean up
    if (result.brepChain) {
      releaseBrepChainState(result.brepChain)
    }
  })

  it('STEP export from unbroken BREP chain contains ADVANCED_FACE (not POLYGONAL_FACE)', async () => {
    // 验证未断裂的 BREP 链终端 solid 导出为原生 STEP（精确曲面）
    const script = makeScript([
      makeStmt('s1', 'box', { size: 20 }, []),
      makeStmt('s2', 'drill', {
        diameter: 6, depth: 0,
        position: [0, 0, 10], direction: 'normal',
        faceNormal: [0, 0, 1], holeType: 'simple',
      }, ['s1']),
    ])

    const result = await executeScript(script)
    expect(result.brepChain.solidCache.has(asPartName('s2'))).toBe(true)

    // 获取终端 solid 并导出 STEP
    if (result.brepChain?.kernel && result.brepChain.solidCache.has(asPartName('s2'))) {
      const solid = result.brepChain.solidCache.get(asPartName('s2'))!
      const step = brepSolidToStep(result.brepChain.kernel, solid)
      expect(step).toContain('ADVANCED_FACE')
      expect(step).toContain('CYLINDRICAL_SURFACE')
      expect(step).not.toContain('POLYGONAL_FACE')

      // Clean up
      releaseBrepChainState(result.brepChain)
    } else {
      throw new Error('Terminal solid not found in brepChain')
    }
  })
})
