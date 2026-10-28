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
import { getBrepApi } from '../../src/brep/handle-bridge'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getActiveBrepEngine } from '../../src/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { primitiveToBrepSolid, brepSolidToStep } from '../../src/primitives/brep-primitives'
import type { BrepHandle } from '../../src/brep/engine/types'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import {
  translateBrep, rotateBrep, scaleBrep,
  fuseBrep, cutBrep, commonBrep,
  drillBrep, splitBrep,
  solidToShape, getSolidBoundingBox,
  createBrepChainState, initBrepChainState,
  releaseBrepChainState,
  isCadFormat,
} from '../../src/brep'
import type { Shape } from '../../src/mesh/types'
import { executeScript } from '../helpers'
import { ensureTestFontLoader } from '@faicad/faijs/brep/text/fontTestHelper'
import { asPartName } from '../../src/identity'

let kernel: BrepEngineApi

beforeAll(async () => {
  await registerOcctBrepEngine()
  const brep = await getActiveBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepEngineId: 'occt' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
  // 走真正的 L1 契约面。此前这里是 `getKernel() as unknown as BrepEngineApi`
  // ——原生 occt 句柄冒充 L1 面（违反本仓「禁止 as BrepEngineApi 跨层断言」），
  // 只在 `transform`/`generalTransform` 这类两边同名的成员上侥幸可用；一旦
  // brep-ops 用上 L1 中立名（如 `copyShape`）就会 `is not a function`。
  kernel = getBrepApi()
  // 注入 fs 字体加载器（BREP text 操作需要）
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
  return primitiveToBrepSolid(kernel, 'box', { width: size, depth: size, height: size, centered: true }).solid
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
    // box 契约：X=width, Y=depth, Z=height（裁决 7）
    // So box(10, 20, 30, {centered:true}) → X=10, Y=20, Z=30
    const box = primitiveToBrepSolid(kernel, 'box', { width: 10, depth: 20, height: 30, centered: true }).solid
    try {
      const rotated = rotateBrep(kernel, box, [0, 0, 90])
      const bb = getSolidBoundingBox(kernel, rotated)
      // After 90° Z rotation: X←Y, Y←-X, Z stays
      // Original: X=10, Y=20, Z=30 → Rotated: X=20, Y=10, Z=30
      expect(bb.max[0] - bb.min[0]).toBeCloseTo(20, 1)
      expect(bb.max[1] - bb.min[1]).toBeCloseTo(10, 1)
      expect(bb.max[2] - bb.min[2]).toBeCloseTo(30, 1)
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
        planeDistance: 0,
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
        planeDistance: 0,
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
// 由语句链重新推导。遇到 mesh-only op（knurl/sdf）→ 链断裂；删除该 op → 链自动愈合。
// 严禁把"已断裂"作为脱离链的零件状态单独持久化（那会造成"无法回退"）。

describe('BREP chain reversibility (§1.6: mesh-only op breakage is derived from statement chain)', () => {
  it('executeScript(box → drill, brep) → solid in cache', async () => {
    const code = [
      'const s1 = cad.box(20, 20, 20, { centered: true })',
      'const s2 = cad.fai_drill(s1, { diameter: 6, depth: 0, position: [0, 0, 10], direction: "normal", faceNormal: [0, 0, 1], holeType: "simple" })',
    ].join('\n')

    const result = await executeScript(code)
    expect(result.brepChain.solidCache.has(asPartName('s2'))).toBe(true)
    expect(result.brepChain.kernel).not.toBeNull()

    // Clean up solid handles
    if (result.brepChain) {
      releaseBrepChainState(result.brepChain)
    }
  })

  it('executeScript(box → drill → text deco → subtract, brep) → chain stays active (creator + cut implemented)', async () => {
    // BREP 链中遇到 creator（cad.text）+ 二元 cut（cad.subtract）→ 链不断裂。
    const code = [
      'const s1 = cad.box(20, 20, 20, { centered: true })',
      'const s2 = cad.fai_drill(s1, { diameter: 6, depth: 0, position: [0, 0, 10], direction: "normal", faceNormal: [0, 0, 1], holeType: "simple" })',
      'const deco = cad.text({ text: "A", size: 10, depth: 1 })',
      'const s3 = cad.subtract(s2, deco)',
    ].join('\n')
    const result = await executeScript(code)

    // 验证链未断裂（box/drill/creator/cut 均有 solid）
    expect(result.brepChain.solidCache.has(asPartName('s1'))).toBe(true)
    expect(result.brepChain.solidCache.has(asPartName('s2'))).toBe(true)
    expect(result.brepChain.solidCache.has(asPartName('s3'))).toBe(true)

    // Clean up
    releaseBrepChainState(result.brepChain)
  })

  it('executeScript(dxfExtrude 负向 depth + subtract): 真的从面上切出一个凹坑（不是静默空操作）', async () => {
    // DXF 源与 text/svg 共用同一套「居中 → 对齐法向 → 贴面 → 布尔」，
    // 差别只在轮廓解析。这条用例钉住两件事：
    //   ① cad.dxfExtrude 能从脚本面走通（资产解析 / dxfToSolid / cut 全链路）；
    //   ② 真的切出了坑 —— 体积下降量在「10×10×2 的面积×深度」量级，
    //      既不是 0（静默空操作）也不是穿（把箱体打穿）。
    // 凹陷 = 负向 depth（实体推入面内），再 cad.subtract(target, deco)。
    // 方框用 4 顶点 LWPOLYLINE（不含重复收尾点）——顺带覆盖收尾边补全。
    const DXF = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', 'P', '90', '0',
      '10', '0', '20', '0',
      '10', '10', '20', '0',
      '10', '10', '20', '10',
      '10', '0', '20', '10',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n')
    const code = [
      'const s1 = cad.box(20, 20, 20, { centered: true })',
      `const deco = cad.dxfExtrude({ dxf: ${JSON.stringify(DXF)}, depth: -2, targetLongSide: 10, faceCenter: [0, 0, 10], faceNormal: [0, 0, 1] })`,
      'const s2 = cad.subtract(s1, deco)',
    ].join('\n')

    const result = await executeScript(code)
    const s1 = result.brepChain.solidCache.get(asPartName('s1')) as BrepHandle
    const s2 = result.brepChain.solidCache.get(asPartName('s2')) as BrepHandle
    expect(s2).toBeDefined()

    // 贴面口径：凹坑从 z=10 面往内 depth=2（减掉 0.01 的避共面余量）。
    // 10×10 的坑 × 2 深 ≈ 200（顶面 0.01 在实体外，故略少）。
    const removed = kernel.getVolume(s1) - kernel.getVolume(s2)
    expect(removed).toBeGreaterThan(150)
    expect(removed).toBeLessThan(250)
    // 坑底在实体内 → 点位应是空的；同一位置的原箱体是实的。
    expect(kernel.containsPoint(s1, { x: 0, y: 0, z: 9 }, 1e-6)).toBe(true)
    expect(kernel.containsPoint(s2, { x: 0, y: 0, z: 9 }, 1e-6)).toBe(false)

    releaseBrepChainState(result.brepChain)
  }, 120_000)

  it('executeScript(text 带 faceCenter/faceNormal): 文字真的落在指定面上（与刻字同一套对齐）', async () => {
    // 文字建模的"先选面"能力：`cad.text` 给了 faceCenter/faceNormal 时，
    // 走统一的 placeOnFace（居中 → 旋到法向 → 移面心）。
    // 这里钉住行为，不钉实现：
    //   ① 厚度 2 的文字贴在 z=10 面**外**（底面贴面、整块凸出）→ bbox.min.z ≈ 10；
    //   ② `depth/2` 沿法向推开，所以 bbox 落在 [10, 12] 而不是跨过面；
    //   ③ 不给 faceCenter 时仍是历史行为（z ∈ [-d/2, d/2]、y 从 0 向上）。
    const code = [
      'const t1 = cad.text({ text: "Hi", size: 10, depth: 2, faceCenter: [0, 0, 10], faceNormal: [0, 0, 1] })',
    ].join('\n')
    const result = await executeScript(code)
    const t1 = result.brepChain.solidCache.get(asPartName('t1')) as BrepHandle
    expect(t1).toBeDefined()

    const bb = kernel.getBoundingBox(t1, false)
    // 贴在 z=10 面上、往 +Z 凸出 depth=2 → z ∈ [10, 12]（允许一点数值噪声）
    expect(bb.zmin).toBeGreaterThan(9.9)
    expect(bb.zmin).toBeLessThan(10.1)
    expect(bb.zmax).toBeGreaterThan(11.5)
    expect(bb.zmax).toBeLessThan(12.5)
    // 面内居中：X/Y 关于 faceCenter（0,0）对称 —— 文字中心落在面心，不是从面心向 +X 长
    expect(Math.abs(bb.xmin + bb.xmax)).toBeLessThan(1)
    expect(Math.abs(bb.ymin + bb.ymax)).toBeLessThan(1)

    releaseBrepChainState(result.brepChain)
  }, 120_000)

  it('executeScript(svgExtrude 带 faceCenter/faceNormal): SVG 真的落在指定面上', async () => {
    // 「矢量刻字」的"先选面"能力：cad.svgExtrude 现在也认 faceCenter/faceNormal，
    // 走与 cad.text 同一个 placeOnFace（居中 → 旋到法向 → 移面心），朝向一致。
    const svg = '<svg viewBox="0 0 100 100"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z"/></svg>'
    const code = [
      `const s1 = cad.svgExtrude({ svg: ${JSON.stringify(svg)}, depth: 2, targetLongSide: 20, faceCenter: [0, 0, 10], faceNormal: [0, 0, 1] })`,
    ].join('\n')
    const result = await executeScript(code)
    const s1 = result.brepChain.solidCache.get(asPartName('s1')) as BrepHandle
    expect(s1).toBeDefined()

    const bb = kernel.getBoundingBox(s1, false)
    // 贴在 z=10 面外、深度 2 → z ∈ [10, 12]
    expect(bb.zmin).toBeGreaterThan(9.9)
    expect(bb.zmin).toBeLessThan(10.1)
    expect(bb.zmax).toBeGreaterThan(11.5)
    expect(bb.zmax).toBeLessThan(12.5)
    // 面内居中：X/Y 关于 faceCenter（0,0）对称
    expect(Math.abs(bb.xmin + bb.xmax)).toBeLessThan(1)
    expect(Math.abs(bb.ymin + bb.ymax)).toBeLessThan(1)

    releaseBrepChainState(result.brepChain)
  }, 120_000)

  it('executeScript(text/svgExtrude 负向 depth): 实体落在面另一侧（标准面凹陷=负向拉伸）', async () => {
    // 标准面 + 凹陷 = 负向拉伸出来的独立实体（方向翻转，不布尔、不禁用），
    // 与草图负向拉伸同逻辑。钉住：depth<0 时实体在面心 -Z 侧（zmax ≈ faceCenter.z）。
    const svg = '<svg viewBox="0 0 100 100"><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z"/></svg>'
    const code = [
      'const t1 = cad.text({ text: "Hi", size: 10, depth: -2, faceCenter: [0, 0, 10], faceNormal: [0, 0, 1] })',
      `const s1 = cad.svgExtrude({ svg: ${JSON.stringify(svg)}, depth: -2, targetLongSide: 20, faceCenter: [0, 0, 10], faceNormal: [0, 0, 1] })`,
    ].join('\n')
    const result = await executeScript(code)
    const t1 = result.brepChain.solidCache.get(asPartName('t1')) as BrepHandle
    const s1 = result.brepChain.solidCache.get(asPartName('s1')) as BrepHandle
    expect(t1).toBeDefined()
    expect(s1).toBeDefined()

    const bbT = kernel.getBoundingBox(t1, false)
    const bbS = kernel.getBoundingBox(s1, false)
    // 两者都凹入面下方：zmax ≈ 10（底面贴面心），zmin ≈ 8（深度 2 向内）
    for (const bb of [bbT, bbS]) {
      expect(bb.zmax).toBeGreaterThan(9.9)
      expect(bb.zmax).toBeLessThan(10.1)
      expect(bb.zmin).toBeGreaterThan(7.5)
      expect(bb.zmin).toBeLessThan(8.5)
    }

    releaseBrepChainState(result.brepChain)
  }, 120_000)

  it('executeScript(text 多字符 compound 经 cad.subtract 直接吃掉): 退休 engrave 逐 solid 拆的前提', async () => {
    // 多字符文字是 compound（不相交字母 fuse 后仍是 compound）。BREP 路径的
    // cad.subtract 把每个输入都当工具送 kernel.cut，OCCT 减法原生支持 compound 工具，
    // 所以"物体面 + 凹陷"可直接 cad.subtract(target, deco) 而无需先 fuse 成单 solid。
    const code = [
      'const box = cad.box(40, 40, 40, { centered: true })',
      'const t1 = cad.text({ text: "Hi", size: 10, depth: 3, faceCenter: [0, 0, 20], faceNormal: [0, 0, 1] })',
      'const cut = cad.subtract(box, t1)',
    ].join('\n')
    const result = await executeScript(code)
    const cut = result.brepChain.solidCache.get(asPartName('cut')) as BrepHandle
    expect(cut).toBeDefined()
    const bb = kernel.getBoundingBox(cut, false)
    // 原 box 高 40（-20..20），从顶面 z=20 挖掉一个沿 +Z 凸出的字（z ∈ [20,23]）→
    // 被挖后实体最高应仍在 20（顶面被掏了个坑，整体不增不减）
    expect(bb.zmax).toBeLessThan(20.5)
    expect(bb.zmax).toBeGreaterThan(19.5)
    releaseBrepChainState(result.brepChain)
  }, 120_000)

  it('executeScript without any mesh-only op → solid still in cache (chain healed, not persistent)', async () => {
    // 核心测试：BREP 状态不是持久状态。每次 executeScript 创建新的 BrepChainState，
    // 删除 mesh-only 语句后重放 → solidCache 仍有 drill solid
    const code = [
      'const s1 = cad.box(20, 20, 20, { centered: true })',
      'const s2 = cad.fai_drill(s1, { diameter: 6, depth: 0, position: [0, 0, 10], direction: "normal", faceNormal: [0, 0, 1], holeType: "simple" })',
      // 没有 mesh-only op — 链应保持活跃
    ].join('\n')

    const result = await executeScript(code)
    expect(result.brepChain.solidCache.has(asPartName('s2'))).toBe(true)

    // Clean up
    if (result.brepChain) {
      releaseBrepChainState(result.brepChain)
    }
  })

  it('STEP export from unbroken BREP chain contains ADVANCED_FACE (not POLYGONAL_FACE)', async () => {
    // 验证未断裂的 BREP 链终端 solid 导出为原生 STEP（精确曲面）
    const code = [
      'const s1 = cad.box(20, 20, 20, { centered: true })',
      'const s2 = cad.fai_drill(s1, { diameter: 6, depth: 0, position: [0, 0, 10], direction: "normal", faceNormal: [0, 0, 1], holeType: "simple" })',
    ].join('\n')

    const result = await executeScript(code)
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
