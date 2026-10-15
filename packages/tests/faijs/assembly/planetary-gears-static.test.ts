/**
 * planetary-gears-static — 行星齿轮组静态装配的 BREP e2e（真实齿轮 + 真内核 + 脚本全链路）
 *
 * 回答同一个问题在**真实几何**层的答案：行星齿轮组（太阳轮 + 内齿圈 + n 个均布行星轮）
 * 的静态装配，`cad.assembly` 约束词汇 + global solver 在 .fai.js 全链路
 * （求解 → 引擎应用 → mesh 烘焙）上成立吗？
 *
 * 结论（本文件钉住）：**成立**。零件均以自身原点建模（与 animation 三节脚本形态一致），
 * 规范约束集 = `fixed(太阳轮)` + `coincident(point-point)`（行星轮心 ↔ 太阳轮本地系
 * 轨道点）+ `fixedRotation(每件)`，齿圈再加 `coincident` 定心 + `fixedRotation` 定姿；
 * `solver: 'global'` 必填（fixedRotation 只有 global 支持）。求解后行星轮轮心精确
 * 落在均布轨道点（orbitR = sun.r0 + planet.r0 = 30），齿圈恒等不动。
 *
 * 与 core 位姿层验证的分工（单向依赖：core 测试不 import gears，本文件才 import）：
 * - `packages/core/test/api/assembly/planetary-static.test.ts`：位姿精度、欠定诊断、
 *   GOTCHA 集（快照引用、免内核）；
 * - 本文件：真实 BREP 齿轮 + 脚本 DSL + 引擎应用 + mesh 烘焙的端到端几何事实。
 *
 * 能力边界（有意不断言）：齿的啮合相位（面内转角）约束词汇表达不了，属运动侧
 * （animation 的 `anim.joint.phase`）——本文件只验静态位置，不验啮合。
 *
 * 参数取 animation demo planetary_gear 同款（module=2 / 18-12-42 / 3 行星轮）：
 *   orbitR = 2·(18+12)/2 = 30；θ_i = i·120° →
 *   p0 (30, 0)、p1 (−15, 25.98076211353316)、p2 (−15, −25.98076211353316)。
 *
 * 运行：npx vitest run packages/tests/faijs/assembly/planetary-gears-static.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { asPartName } from '@faicad/faijs/identity'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import type { CadRuntime, ExecutionResult } from '@faicad/faijs/cad-runtime/runtime'
import * as gears from '@faicad/faijs-gears'
import { createEditorRuntime } from '../_support/editor-runtime'

/** 行星轮系几何量（module=2 / sun 18 / planet 12 / ring 42 / 3 行星轮）。 */
const MODULE = 2
const SUN_TEETH = 18
const PLANET_TEETH = 12
const RING_TEETH = SUN_TEETH + PLANET_TEETH * 2 // 42
const WIDTH = 8
const RIM_WIDTH = 4
const ORBIT_R = (MODULE * (SUN_TEETH + PLANET_TEETH)) / 2 // 30（= sun.r0 + planet.r0）
const N_PLANETS = 3
const SUN_TIP_R = (MODULE * SUN_TEETH) / 2 + MODULE // 20
const PLANET_TIP_R = (MODULE * PLANET_TEETH) / 2 + MODULE // 14

/** mesh 烘焙容差：齿面弦差 + 求解器 LM 精度（位姿层实测 ≤2e-5）远小于此。 */
const MESH_EPS = 0.05

/** 第 i 个行星轮的轨道点（太阳轮本地系 = 世界系，太阳轮 fixed 恒等）。 */
function orbitPoint(i: number): [number, number] {
  const a = (2 * Math.PI * i) / N_PLANETS
  return [ORBIT_R * Math.cos(a), ORBIT_R * Math.sin(a)]
}

/**
 * 规范脚本（animation 侧将镜像此形态）：
 * 齿轮全部以自身原点建模 → 安装位姿全部由约束解算，脚本里不写任何默认安装位置。
 */
const PLANETARY_SCRIPT = [
  "import * as gears from '@faicad/faijs-gears'",
  `let sun = gears.spurGear({ module: ${MODULE}, teeth_number: ${SUN_TEETH}, width: ${WIDTH} })`,
  `let p0 = gears.spurGear({ module: ${MODULE}, teeth_number: ${PLANET_TEETH}, width: ${WIDTH} })`,
  `let p1 = gears.spurGear({ module: ${MODULE}, teeth_number: ${PLANET_TEETH}, width: ${WIDTH} })`,
  `let p2 = gears.spurGear({ module: ${MODULE}, teeth_number: ${PLANET_TEETH}, width: ${WIDTH} })`,
  `let ring = gears.ringGear({ module: ${MODULE}, teeth_number: ${RING_TEETH}, width: ${WIDTH}, rim_width: ${RIM_WIDTH} })`,
  'let asm0 = cad.assembly({',
  "  name: 'planetary',",
  "  solver: 'global',",
  '  members: [sun, p0, p1, p2, ring],',
  '  constraints: [',
  "    { type: 'fixed', part: 'sun' },",
  "    { type: 'coincident', a: { part: 'ring', point: [0, 0, 0] }, b: { part: 'sun', point: [0, 0, 0] } },",
  "    { type: 'fixedRotation', part: 'ring' },",
  ...Array.from({ length: N_PLANETS }, (_, i) => {
    const [x, y] = orbitPoint(i)
    return [
      `    { type: 'coincident', a: { part: 'p${i}', point: [0, 0, 0] }, b: { part: 'sun', point: [${x}, ${y}, 0] } },`,
      `    { type: 'fixedRotation', part: 'p${i}' },`,
    ].join('\n')
  }),
  '  ],',
  '})',
  'asm0.do_assemble()',
].join('\n')

let runtime: CadRuntime
let result: ExecutionResult

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createEditorRuntime(createNodePorts(), 'brep')
  runtime.registerLib('gears', gears as never, {
    autoLift: true,
    packageName: '@faicad/faijs-gears',
  })
  result = await runtime.execute(PLANETARY_SCRIPT, { topology: 'auto' })
}, 300000)

interface BBox {
  min: [number, number, number]
  max: [number, number, number]
}

function bboxOf(name: string): BBox {
  const p = result.outputs.get(asPartName(name)) as { positions?: ArrayLike<number> } | undefined
  expect(p, `output shape '${name}'`).toBeDefined()
  const ps = p!.positions as ArrayLike<number>
  expect(ps.length, `positions of '${name}'`).toBeGreaterThan(0)
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < ps.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const v = ps[i + c]
      if (v < min[c]) min[c] = v
      if (v > max[c]) max[c] = v
    }
  }
  return { min, max }
}

/** bbox 的 XY 中心（(min+max)/2）——与齿相位无关的安装位置读数。 */
function centerXY(b: BBox): [number, number] {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2]
}

describe('行星齿轮组静态装配 BREP e2e（真实齿轮 + global solver）', () => {
  it('脚本全链路无失败：齿轮构建 → 约束求解 → do_assemble 应用', () => {
    expect(result.failedAt, result.failedAt?.message).toBeUndefined()
  })

  it('行星轮轮心精确落在均布轨道点（建模全在原点，安装位姿由约束解算）', () => {
    for (let i = 0; i < N_PLANETS; i++) {
      const b = bboxOf(`p${i}`)
      const [cx, cy] = centerXY(b)
      const [ox, oy] = orbitPoint(i)
      expect(
        Math.hypot(cx - ox, cy - oy),
        `p${i} bbox center (${cx}, ${cy}) vs orbit point (${ox}, ${oy})`,
      ).toBeLessThan(MESH_EPS)
      // 行星轮确实被搬离原点（未装配时会与太阳轮重叠在 (0,0)）
      expect(Math.hypot(cx, cy)).toBeCloseTo(ORBIT_R, 1)
      // 尺寸仍是 12 齿齿轮：bbox 半宽 ≈ 齿顶半径 14（mesh 弦差内容差 <0.5）
      expect((b.max[0] - b.min[0]) / 2).toBeGreaterThan(PLANET_TIP_R - 0.5)
      expect((b.max[0] - b.min[0]) / 2).toBeLessThan(PLANET_TIP_R + 0.5)
      expect((b.max[1] - b.min[1]) / 2).toBeGreaterThan(PLANET_TIP_R - 0.5)
      expect((b.max[1] - b.min[1]) / 2).toBeLessThan(PLANET_TIP_R + 0.5)
      // 轴向无位移：z 仍是建模区间 [0, width]
      expect(b.min[2]).toBeCloseTo(0, 3)
      expect(b.max[2]).toBeCloseTo(WIDTH, 3)
    }
  })

  it('齿圈恒等不动（concentric + coincident 定心 + fixedRotation 定姿，冗余但一致）', () => {
    const b = bboxOf('ring')
    const [cx, cy] = centerXY(b)
    expect(Math.hypot(cx, cy), `ring bbox center (${cx}, ${cy})`).toBeLessThan(MESH_EPS)
    // 齿圈尺寸仍在（rim 外半径 = rd + rim_width > 40），没被搬走或缩放
    expect((b.max[0] - b.min[0]) / 2).toBeGreaterThan(40)
    expect(b.min[2]).toBeCloseTo(0, 3)
    expect(b.max[2]).toBeCloseTo(WIDTH, 3)
  })

  it('太阳轮锚定不动（fixed：求解器锁整件，位姿 = 建模位姿）', () => {
    const b = bboxOf('sun')
    const [cx, cy] = centerXY(b)
    expect(Math.hypot(cx, cy), `sun bbox center (${cx}, ${cy})`).toBeLessThan(MESH_EPS)
    expect((b.max[0] - b.min[0]) / 2).toBeCloseTo(SUN_TIP_R, 0)
  })
})

describe('GOTCHA：fixedRotation 走缺省 solver（chain）在脚本全链路响亮失败', () => {
  it('不写 solver: global → 语句失败并带 only supported by the global solver（不静默降级）', async () => {
    const chainRuntime = createEditorRuntime(createNodePorts(), 'brep')
    try {
      // 便宜零件（圆柱）就够验证分派行为——真齿轮路径由上面三个用例覆盖
      const code = [
        'let c0 = cad.cylinder(10, 20, { centered: false })',
        'let c1 = cad.cylinder(4, 10, { centered: true, at: [30, 0, 5] })',
        'let asm0 = cad.assembly({ name: "A", members: [c0, c1], constraints: [',
        "  { type: 'fixed', part: 'c0' },",
        "  { type: 'fixedRotation', part: 'c1' },",
        '] })',
        'asm0.do_assemble()',
      ].join('\n')
      const r = await chainRuntime.execute(code, { topology: 'auto' })
      expect(r.failedAt).toBeDefined()
      expect(String(r.failedAt?.message ?? '')).toMatch(/only supported by the 'global' solver/)
    } finally {
      chainRuntime.dispose()
    }
  }, 120000)
})
