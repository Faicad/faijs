/**
 * BREP 与 Mesh 实现等价性测试
 *
 * 验证原则：
 * 1. 同一 ScriptIR 分别以 'brep' 和 'mesh' 模式执行
 * 2. 两个结果的最终 mesh 几何指标偏差 < 1/1000
 * 3. 指标包括：包围盒、体积、表面积
 *
 * 已知差异（不纳入等价性测试）：
 * - screw：mesh 用正弦近似齿形，BREP 用 ISO 60° V 型齿（齿形不同）— 尺寸已统一，齿形差异允许
 * - knurl/sdf：mesh-only op，无 BREP 实现
 *
 * 运行：npx vitest run src/brep-mesh-equivalence.test.ts
 */

// ── OCCT stdout 噪声过滤 ──
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
import { registerOcctBrepEngine } from './brep/engine/adapters/occt'
import { createRuntime } from '@faicad/faijs'
import type { ExecutionResult } from './cad-runtime/runtime'
import { createNodePorts } from './node-host'
import type { ExecutionMode } from './cad-runtime/ports'
import type { Shape } from './mesh/types'
import { ensureTestFontLoader } from './brep/text/fontTestHelper'
import type { StatementIR, ScriptIR } from './lang/types'
import { asStmtId, asPartName } from './identity'

beforeAll(async () => {
  await registerOcctBrepEngine()
  ensureTestFontLoader()
}, 120000)

// ── 测试辅助 ──

function makeStmt(
  id: string,
  callee: string,
  args: Record<string, unknown>,
  inputs: string[] = [],
): StatementIR {
  return {
    id: asStmtId(id), callee,
    args: args as any,
    positional: inputs.map((s) => ({ $ref: asPartName(s) })),
    outputs: [asPartName(id)],
    hasAssignment: true,
  }
}

function makePartScript(statements: StatementIR[]): ScriptIR {
  return {
    source: { kind: 'load' },
    params: [],
    statements,
  }
}

/** 在指定模式下运行脚本，返回最终 Shape */
async function runMode(script: ScriptIR, mode: ExecutionMode): Promise<Shape> {
  const ports = createNodePorts()
  const runtime = createRuntime(ports, mode)
  const result: ExecutionResult = await runtime.executeIR(script)

  if (result.failedAt) {
    throw new Error(`Execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }

  const geoStmts = script.statements.filter(s => s.hasAssignment)
  const last = geoStmts[geoStmts.length - 1]
  const shape = result.outputs.get(last.outputs[0])
  if (!shape) throw new Error(`No output for terminal statement "${last.id}"`)
  // keep-syntax §5.1：outputs 含 compound；本测试断言的是 mesh 结果
  if (!('positions' in shape) || !('indices' in shape)) {
    throw new Error(`Output for "${last.id}" is not a mesh shape (compound?)`)
  }
  return shape
}

// ── 几何指标计算 ──

interface GeometricMetrics {
  bboxMin: [number, number, number]
  bboxMax: [number, number, number]
  volume: number
  surfaceArea: number
  triangleCount: number
  vertexCount: number
}

function computeMetrics(shape: Shape): GeometricMetrics {
  let xmin = Infinity, ymin = Infinity, zmin = Infinity
  let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity
  let volume = 0
  let surfaceArea = 0

  const { positions, indices } = shape

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (x < xmin) xmin = x; if (x > xmax) xmax = x
    if (y < ymin) ymin = y; if (y > ymax) ymax = y
    if (z < zmin) zmin = z; if (z > zmax) zmax = z
  }

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3
    const ib = indices[i + 1] * 3
    const ic = indices[i + 2] * 3
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2]
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2]
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2]

    // 三角面面积
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const crossX = uy * vz - uz * vy
    const crossY = uz * vx - ux * vz
    const crossZ = ux * vy - uy * vx
    const area = 0.5 * Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ)
    surfaceArea += area

    // 有符号体积（四面体）
    const signedVol = (ax * (by * cz - bz * cy) +
                       ay * (bz * cx - bx * cz) +
                       az * (bx * cy - by * cx)) / 6
    volume += signedVol
  }

  return {
    bboxMin: [xmin, ymin, zmin],
    bboxMax: [xmax, ymax, zmax],
    volume: Math.abs(volume),
    surfaceArea,
    triangleCount: indices.length / 3,
    vertexCount: positions.length / 3,
  }
}

/**
 * 容忍度说明：
 *
 * - BBOX_TOLERANCE = 1/1000：包围盒是几何外形的极值，两路径应高度一致。
 *
 * - VOLUME_TOLERANCE / SURFACE_TOLERANCE = 1/100 (1%)：
 *   BREP 路径用 OCCT meshShape 三角化（angularDeflection = 2π/32），
 *   mesh 路径用 THREE.js 32 段近似。两者都用 32 段但算法不同，
 *   多边形近似圆弧时体积/表面积偏差约 0.2%~0.6%（理论值：
 *   n=32 边形面积 / 圆面积 = n·sin(π/n) / π ≈ 0.9952 → 0.48% 偏差）。
 *   1% 容忍度覆盖此差异并留有余量。
 *   如需更严格一致性，可增加 segments 数（两条路径同步提高）。
 */
const BBOX_TOLERANCE = 0.001
const VOLUME_TOLERANCE = 0.01
const SURFACE_TOLERANCE = 0.01

function assertMetricsEquivalent(
  brep: GeometricMetrics,
  mesh: GeometricMetrics,
  label: string,
) {
  const bboxDiag = Math.sqrt(
    (mesh.bboxMax[0] - mesh.bboxMin[0]) ** 2 +
    (mesh.bboxMax[1] - mesh.bboxMin[1]) ** 2 +
    (mesh.bboxMax[2] - mesh.bboxMin[2]) ** 2,
  )
  const absTol = Math.max(bboxDiag * BBOX_TOLERANCE, 0.01)

  // 包围盒
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(brep.bboxMin[i] - mesh.bboxMin[i]), `${label} bboxMin[${i}]`).toBeLessThan(absTol)
    expect(Math.abs(brep.bboxMax[i] - mesh.bboxMax[i]), `${label} bboxMax[${i}]`).toBeLessThan(absTol)
  }

  // 体积
  const maxVol = Math.max(brep.volume, mesh.volume, 1)
  expect(Math.abs(brep.volume - mesh.volume) / maxVol, `${label} volume`).toBeLessThan(VOLUME_TOLERANCE)

  // 表面积
  const maxArea = Math.max(brep.surfaceArea, mesh.surfaceArea, 1)
  expect(Math.abs(brep.surfaceArea - mesh.surfaceArea) / maxArea, `${label} surfaceArea`).toBeLessThan(SURFACE_TOLERANCE)
}

/** 辅助：运行并比较两种模式 */
async function runAndCompare(statements: StatementIR[], label: string) {
  const script = makePartScript(statements)
  const brepShape = await runMode(script, 'brep')
  const meshShape = await runMode(script, 'mesh')

  const brepMetrics = computeMetrics(brepShape)
  const meshMetrics = computeMetrics(meshShape)

  // 基本有效性
  expect(brepMetrics.triangleCount, `${label} brep triangleCount`).toBeGreaterThan(0)
  expect(meshMetrics.triangleCount, `${label} mesh triangleCount`).toBeGreaterThan(0)

  assertMetricsEquivalent(brepMetrics, meshMetrics, label)
}

// ────────────────────────────────────────────────
// 测试用例
// ────────────────────────────────────────────────

// ── 基本体 ──

describe('BREP/Mesh equivalence: primitives', () => {
  it('box (cube)', async () => {
    await runAndCompare(
      [makeStmt('s1', 'box', { width: 20, depth: 20, height: 20, centered: true })],
      'box(size=20)',
    )
  })

  it('box (Vec3 size)', async () => {
    await runAndCompare(
      [makeStmt('s1', 'box', { width: 10, depth: 20, height: 30, centered: true })],
      'box([10,20,30])',
    )
  })

  it('box with center offset', async () => {
    await runAndCompare(
      [makeStmt('s1', 'box', { width: 20, depth: 20, height: 20, centered: true, at: [50, 0, 0] })],
      'box(center=[50,0,0])',
    )
  })

  it('sphere', async () => {
    await runAndCompare(
      [makeStmt('s1', 'sphere', { radius: 10 })],
      'sphere(r=10)',
    )
  })

  it('cylinder', async () => {
    await runAndCompare(
      [makeStmt('s1', 'cylinder', { radius: 10, height: 20 })],
      'cylinder(r=10,h=20)',
    )
  })

  it('cone (full cone)', async () => {
    await runAndCompare(
      [makeStmt('s1', 'cone', { radiusBottom: 10, radiusTop: 0, height: 20, centered: true })],
      'cone(rB=10,rT=0,h=20)',
    )
  })

  it('cone (truncated)', async () => {
    await runAndCompare(
      [makeStmt('s1', 'cone', { radiusBottom: 10, radiusTop: 5, height: 15, centered: true })],
      'cone(rB=10,rT=5,h=15)',
    )
  })

  it('wedge', async () => {
    await runAndCompare(
      [makeStmt('s1', 'wedge', { width: 20, height: 10, angle: 60, length: 50 })],
      'wedge(w=20,h=10,a=60,l=50)',
    )
  })
})

// ── box 契约验收（§4.1：X=width, Y=depth, Z=height，默认 min 角点在原点） ──

describe('box 契约: bbox 黄金值（双路径逐点一致）', () => {
  function assertBBox(shape: Shape, min: [number, number, number], max: [number, number, number], label: string) {
    const m = computeMetrics(shape)
    for (let i = 0; i < 3; i++) {
      expect(m.bboxMin[i]).toBeCloseTo(min[i], 6)
      expect(m.bboxMax[i]).toBeCloseTo(max[i], 6)
    }
    void label
  }

  for (const mode of ['brep', 'mesh'] as const) {
    describe(`${mode} 路径`, () => {
      it('box(30,20,10) → 默认 min 角点在原点（0,0,0）.. (30,20,10)（X=width,Y=depth,Z=height）', async () => {
        const shape = await runMode(makePartScript([makeStmt('s1', 'box', { width: 30, depth: 20, height: 10 })]), mode)
        assertBBox(shape, [0, 0, 0], [30, 20, 10], 'corner-origin')
      })

      it('box(30,20,10,{centered:true}) → 居中到原点 (-15,-10,-5)..(15,10,5)', async () => {
        const shape = await runMode(
          makePartScript([makeStmt('s1', 'box', { width: 30, depth: 20, height: 10, centered: true })]),
          mode,
        )
        assertBBox(shape, [-15, -10, -5], [15, 10, 5], 'centered')
      })

      it('box(30,20,10,{centered:true,at:[1,2,3]}) → at 优先，中心在 (1,2,3)', async () => {
        const shape = await runMode(
          makePartScript([makeStmt('s1', 'box', { width: 30, depth: 20, height: 10, centered: true, at: [1, 2, 3] })]),
          mode,
        )
        assertBBox(shape, [-14, -8, -2], [16, 12, 8], 'at-centers')
      })

      it('box({ size: 20 }) 旧形态 → E_ARGS_FORM + 新签名提示（该模式抛错）', async () => {
        const ports = createNodePorts()
        const runtime = createRuntime(ports, mode)
        // IR 层旧形态参数直抛（executeIR reject），错误信息含 E_ARGS_FORM + 新签名
        await expect(
          runtime.executeIR(makePartScript([{ ...makeStmt('s1', 'box', { size: 20 }), outputs: [] }])),
        ).rejects.toThrow(/E_ARGS_FORM/)
        await expect(
          runtime.executeIR(makePartScript([{ ...makeStmt('s1', 'box', { size: 20 }), outputs: [] }])),
        ).rejects.toThrow(/box\(width, depth, height/)
      })
    })
  }

  it('box(10,20,30,{centered:true})（不等边）双路径执行成功且逐点一致', async () => {
    await runAndCompare(
      [makeStmt('s2', 'box', { width: 10, depth: 20, height: 30, centered: true })],
      'box(10,20,30,{centered:true})',
    )
  })
})

// ── cone 契约验收（§4.1 P：`at` BASE 语义，默认底面在原点、+Z 延伸） ──

describe('cone 契约: bbox 黄金值（双路径逐点一致）', () => {
  function assertBBox(shape: Shape, min: [number, number, number], max: [number, number, number], label: string) {
    const m = computeMetrics(shape)
    for (let i = 0; i < 3; i++) {
      expect(m.bboxMin[i]).toBeCloseTo(min[i], 6)
      expect(m.bboxMax[i]).toBeCloseTo(max[i], 6)
    }
    void label
  }

  for (const mode of ['brep', 'mesh'] as const) {
    describe(`${mode} 路径`, () => {
      it('cone(30,20,10) → 默认底面在原点（BASE），bbox -30..30 × -30..30 × 0..20', async () => {
        const shape = await runMode(
          makePartScript([makeStmt('s1', 'cone', { radiusBottom: 30, radiusTop: 20, height: 10 })]),
          mode,
        )
        assertBBox(shape, [-30, -30, 0], [30, 30, 10], 'base-at-origin')
      })

      it('cone(30,0,20)（尖锥）默认底面在原点：z 0..20', async () => {
        const shape = await runMode(
          makePartScript([makeStmt('s1', 'cone', { radiusBottom: 30, radiusTop: 0, height: 20 })]),
          mode,
        )
        assertBBox(shape, [-30, -30, 0], [30, 30, 20], 'pointed-base')
      })

      it('cone(30,10,20,{centered:true}) → 居中：z ∈ [-10,10]', async () => {
        const shape = await runMode(
          makePartScript([makeStmt('s1', 'cone', { radiusBottom: 30, radiusTop: 10, height: 20, centered: true })]),
          mode,
        )
        assertBBox(shape, [-30, -30, -10], [30, 30, 10], 'centered')
      })

      it('cone(30,10,20,{at:[1,2,3]})… → at 为底面轴心，底面落在 (1,2,3)', async () => {
        const shape = await runMode(
          makePartScript([makeStmt('s1', 'cone', { radiusBottom: 30, radiusTop: 10, height: 20, at: [1, 2, 3] })]),
          mode,
        )
        assertBBox(shape, [-29, -28, 3], [31, 32, 23], 'at-base')
      })

      it('cone(30,10,20,{centered:true,at:[1,2,3]}) → at 变中心语义', async () => {
        const shape = await runMode(
          makePartScript([
            makeStmt('s1', 'cone', { radiusBottom: 30, radiusTop: 10, height: 20, centered: true, at: [1, 2, 3] }),
          ]),
          mode,
        )
        assertBBox(shape, [-29, -28, -7], [31, 32, 13], 'at-centred')
      })

      it('cone({ center }) 旧形态 → E_ARGS_FORM + 新签名提示（该模式抛错）', async () => {
        const ports = createNodePorts()
        const runtime = createRuntime(ports, mode)
        await expect(
          runtime.executeIR(
            makePartScript([
              { ...makeStmt('s1', 'cone', { radiusBottom: 10, radiusTop: 0, height: 20, center: [0, 0, 0] }), outputs: [] },
            ]),
          ),
        ).rejects.toThrow(/E_ARGS_FORM/)
        await expect(
          runtime.executeIR(
            makePartScript([
              { ...makeStmt('s1', 'cone', { radiusBottom: 10, radiusTop: 0, height: 20, center: [0, 0, 0] }), outputs: [] },
            ]),
          ),
        ).rejects.toThrow(/cone\(bottomRadius, topRadius, height/)
      })
    })
  }

  it('cone(30,10,20,{centered:true,at:[1,2,3]}) 双路径执行成功且逐点一致', async () => {
    await runAndCompare(
      [makeStmt('s2', 'cone', { radiusBottom: 30, radiusTop: 10, height: 20, centered: true, at: [1, 2, 3] })],
      'cone(30,10,20,{centered:true,at:[1,2,3]})',
    )
  })
})

// ── cylinder 契约验收（§4.3 A：`at` BASE 语义，默认底面在原点、+Z 延伸） ──

describe('cylinder 契约: bbox 黄金值（双路径逐点一致）', () => {
  function assertBBox(shape: Shape, min: [number, number, number], max: [number, number, number], label: string) {
    const m = computeMetrics(shape)
    for (let i = 0; i < 3; i++) {
      expect(m.bboxMin[i]).toBeCloseTo(min[i], 6)
      expect(m.bboxMax[i]).toBeCloseTo(max[i], 6)
    }
    void label
  }

  for (const mode of ['brep', 'mesh'] as const) {
    describe(`${mode} 路径`, () => {
      it('cylinder(30,20) → 默认底面在原点（BASE），bbox -30..30 × -30..30 × 0..20', async () => {
        const shape = await runMode(
          makePartScript([makeStmt('s1', 'cylinder', { radius: 30, height: 20 })]),
          mode,
        )
        assertBBox(shape, [-30, -30, 0], [30, 30, 20], 'base-at-origin')
      })

      it('cylinder(30,20,{centered:true}) → 居中：z ∈ [-10,10]', async () => {
        const shape = await runMode(
          makePartScript([makeStmt('s1', 'cylinder', { radius: 30, height: 20, centered: true })]),
          mode,
        )
        assertBBox(shape, [-30, -30, -10], [30, 30, 10], 'centered')
      })

      it('cylinder(30,20,{at:[1,2,3]})… → at 为底面轴心，底面落在 (1,2,3)', async () => {
        const shape = await runMode(
          makePartScript([makeStmt('s1', 'cylinder', { radius: 30, height: 20, at: [1, 2, 3] })]),
          mode,
        )
        assertBBox(shape, [-29, -28, 3], [31, 32, 23], 'at-base')
      })

      it('cylinder(30,20,{centered:true,at:[1,2,3]}) → at 变中心语义', async () => {
        const shape = await runMode(
          makePartScript([
            makeStmt('s1', 'cylinder', { radius: 30, height: 20, centered: true, at: [1, 2, 3] }),
          ]),
          mode,
        )
        assertBBox(shape, [-29, -28, -7], [31, 32, 13], 'at-centred')
      })

      it('cylinder({ center }) 旧形态 → E_ARGS_FORM + 新签名提示（该模式抛错）', async () => {
        const ports = createNodePorts()
        const runtime = createRuntime(ports, mode)
        const script = makePartScript([
          { ...makeStmt('s1', 'cylinder', { radius: 10, height: 20, center: [0, 0, 0] }), outputs: [] },
        ])
        await expect(runtime.executeIR(script)).rejects.toThrow(/E_ARGS_FORM/)
        await expect(runtime.executeIR(script)).rejects.toThrow(/cylinder\(radius, height/)
      })
    })
  }

  it('cylinder(30,20,{centered:true,at:[1,2,3]}) 双路径执行成功且逐点一致', async () => {
    await runAndCompare(
      [makeStmt('s2', 'cylinder', { radius: 30, height: 20, centered: true, at: [1, 2, 3] })],
      'cylinder(30,20,{centered:true,at:[1,2,3]})',
    )
  })
})

// ── 变换 ──

describe('BREP/Mesh equivalence: transforms', () => {
  it('translate', async () => {
    await runAndCompare([
      makeStmt('s1', 'box', { width: 20, depth: 20, height: 20, centered: true }),
      makeStmt('s2', 'translate', { offset: [10, 5, 3] }, ['s1']),
    ], 'box→translate')
  })

  it('rotate_euler (Z-axis)', async () => {
    await runAndCompare([
      makeStmt('s1', 'box', { width: 20, depth: 20, height: 20, centered: true }),
      makeStmt('s2', 'rotate_euler', { anglesDeg: [0, 0, 45] }, ['s1']),
    ], 'box→rotate(Z45)')
  })

  it('rotate_euler (multi-axis)', async () => {
    await runAndCompare([
      makeStmt('s1', 'box', { width: 10, depth: 20, height: 30, centered: true }),
      makeStmt('s2', 'rotate_euler', { anglesDeg: [30, 15, 45] }, ['s1']),
    ], 'box→rotate(30,15,45)')
  })

  it('scale3d (uniform)', async () => {
    await runAndCompare([
      makeStmt('s1', 'box', { width: 20, depth: 20, height: 20, centered: true }),
      makeStmt('s2', 'scale3d', { factor: 2 }, ['s1']),
    ], 'box→scale3d(2)')
  })

  it('scale3d (non-uniform)', async () => {
    await runAndCompare([
      makeStmt('s1', 'box', { width: 20, depth: 20, height: 20, centered: true }),
      makeStmt('s2', 'scale3d', { factor: [2, 1, 0.5] }, ['s1']),
    ], 'box→scale3d([2,1,0.5])')
  })

  it('translate → rotate_euler → scale3d (chained)', async () => {
    await runAndCompare([
      makeStmt('s1', 'cylinder', { radius: 10, height: 20 }),
      makeStmt('s2', 'translate', { offset: [5, 0, 0] }, ['s1']),
      makeStmt('s3', 'rotate_euler', { anglesDeg: [0, 90, 0] }, ['s2']),
      makeStmt('s4', 'scale3d', { factor: 1.5 }, ['s3']),
    ], 'cyl→translate→rotate→scale3d')
  })
})

// ── 布尔运算 ──

describe('BREP/Mesh equivalence: boolean operations', () => {
  it('union (box + box)', async () => {
    await runAndCompare([
      makeStmt('s1', 'box', { width: 20, depth: 20, height: 20, centered: true }),
      makeStmt('s2', 'box', { width: 20, depth: 20, height: 20, centered: true, at: [15, 0, 0] }),
      makeStmt('s3', 'union', {}, ['s1', 's2']),
    ], 'box+box union')
  })

  it('subtract (box - box)', async () => {
    await runAndCompare([
      makeStmt('s1', 'box', { width: 20, depth: 20, height: 20, centered: true }),
      makeStmt('s2', 'box', { width: 10, depth: 10, height: 10, centered: true }),
      makeStmt('s3', 'subtract', {}, ['s1', 's2']),
    ], 'box-box subtract')
  })

  it('intersect (box ∩ box)', async () => {
    await runAndCompare([
      makeStmt('s1', 'box', { width: 20, depth: 20, height: 20, centered: true }),
      makeStmt('s2', 'box', { width: 20, depth: 20, height: 20, centered: true, at: [10, 0, 0] }),
      makeStmt('s3', 'intersect', {}, ['s1', 's2']),
    ], 'box∩box intersect')
  })

  it('union (box + sphere)', async () => {
    await runAndCompare([
      makeStmt('s1', 'box', { width: 20, depth: 20, height: 20, centered: true }),
      makeStmt('s2', 'sphere', { radius: 10, center: [10, 0, 0] }),
      makeStmt('s3', 'union', {}, ['s1', 's2']),
    ], 'box+sphere union')
  })

  it('subtract (cylinder - sphere)', async () => {
    await runAndCompare([
      makeStmt('s1', 'cylinder', { radius: 10, height: 20 }),
      makeStmt('s2', 'sphere', { radius: 8 }),
      makeStmt('s3', 'subtract', {}, ['s1', 's2']),
    ], 'cyl-sphere subtract')
  })

  it('chained: box → drill → union', async () => {
    await runAndCompare([
      makeStmt('s1', 'box', { width: 20, depth: 20, height: 20, centered: true }),
      makeStmt('s2', 'fai_drill', {
        diameter: 5, depth: 0,
        position: [0, 0, 10], direction: 'normal',
        faceNormal: [0, 0, 1], holeType: 'simple',
      }, ['s1']),
      makeStmt('s3', 'box', { width: 15, depth: 15, height: 15, centered: true, at: [20, 0, 0] }),
      makeStmt('s4', 'union', {}, ['s2', 's3']),
    ], 'box→drill→union')
  })
})

// ── 钻孔 ──

describe('BREP/Mesh equivalence: drill', () => {
  it('simple through hole', async () => {
    await runAndCompare([
      makeStmt('s1', 'box', { width: 20, depth: 20, height: 20, centered: true }),
      makeStmt('s2', 'fai_drill', {
        diameter: 5, depth: 0,
        position: [0, 0, 10], direction: 'normal',
        faceNormal: [0, 0, 1], holeType: 'simple',
      }, ['s1']),
    ], 'box→drill(through)')
  })

  it('blind hole', async () => {
    await runAndCompare([
      makeStmt('s1', 'box', { width: 20, depth: 20, height: 20, centered: true }),
      makeStmt('s2', 'fai_drill', {
        diameter: 5, depth: 8,
        position: [0, 0, 10], direction: 'normal',
        faceNormal: [0, 0, 1], holeType: 'simple',
      }, ['s1']),
    ], 'box→drill(blind)')
  })

  it('multiple holes', async () => {
    await runAndCompare([
      makeStmt('s1', 'box', { width: 30, depth: 30, height: 30, centered: true }),
      makeStmt('s2', 'fai_drill', {
        diameter: 5, depth: 0,
        position: [-8, -8, 15], direction: 'normal',
        faceNormal: [0, 0, 1], holeType: 'simple',
      }, ['s1']),
      makeStmt('s3', 'fai_drill', {
        diameter: 3, depth: 0,
        position: [8, 8, 15], direction: 'normal',
        faceNormal: [0, 0, 1], holeType: 'simple',
      }, ['s2']),
    ], 'box→drill→drill')
  })
})

// ── 端到端脚本 ──

describe('BREP/Mesh equivalence: end-to-end scripts', () => {
  it('box-boolean.fai.js (box - sphere)', async () => {
    await runAndCompare([
      makeStmt('s1', 'box', { width: 20, depth: 20, height: 20, centered: true }),
      makeStmt('s2', 'sphere', { radius: 8, center: [5, 0, 0] }),
      makeStmt('s3', 'subtract', {}, ['s1', 's2']),
    ], 'box-sphere (box-boolean.fai.js)')
  })

  it('complex chain: primitives + transforms + boolean', async () => {
    await runAndCompare([
      makeStmt('s1', 'cylinder', { radius: 10, height: 30 }),
      makeStmt('s2', 'box', { width: 25, depth: 25, height: 25, centered: true }),
      makeStmt('s3', 'translate', { offset: [0, 0, 5] }, ['s2']),
      makeStmt('s4', 'intersect', {}, ['s1', 's3']),
      makeStmt('s5', 'sphere', { radius: 8, center: [0, 0, 15] }),
      makeStmt('s6', 'subtract', {}, ['s4', 's5']),
    ], 'cyl∩box-sphere')
  })
})

// ── 螺丝（screw）：尺寸一致性测试 ──
//
// 齿形差异（mesh 正弦近似 vs BREP ISO 60° V 型）允许，但其他维度必须一致：
// - 螺杆居中：bbox Z 从 -length/2 到 +length/2（+ headHeight if head != 'none'）
// - 头部尺寸：hex 半径 0.9×dia, hex 高 0.6×dia, chc 半径 1.0×dia, chc 高 0.5×dia
// - 螺纹峰半径 = dia/2（两路径一致）
//
// 测试方法：比较 bbox 各维度，不比较体积/表面积（齿形差异导致体积不同）。

describe('BREP/Mesh equivalence: screw (dimensions only, tooth shape differs)', () => {
  it('screw with hex head, coarse thread', async () => {
    const script = makePartScript([
      makeStmt('s1', 'screw', {
        system: 'metric', specIdx: 5, thread: 'coarse',
        length: 30, head: 'hex', nRad: 32,
      }),
    ])
    const brepShape = await runMode(script, 'brep')
    const meshShape = await runMode(script, 'mesh')
    const brepM = computeMetrics(brepShape)
    const meshM = computeMetrics(meshShape)

    // Both should produce valid geometry
    expect(brepM.triangleCount).toBeGreaterThan(0)
    expect(meshM.triangleCount).toBeGreaterThan(0)

    // Bbox Z: shank centered from -15 to +15, head extends to +15 + 0.6*6 = +18.6
    // BREP and mesh should have very close bbox Z extents
    const zTol = 1.0 // 1mm tolerance for thread lead-in/out differences
    expect(Math.abs(brepM.bboxMin[2] - meshM.bboxMin[2])).toBeLessThan(zTol)
    expect(Math.abs(brepM.bboxMax[2] - meshM.bboxMax[2])).toBeLessThan(zTol)

    // Bbox X/Y: thread peaks at rCrest = dia/2 = 3.0, head radius = 0.9*6 = 5.4
    // Both paths should have very close X/Y extents
    const xyTol = 1.0 // 1mm tolerance for hex head shape differences
    expect(Math.abs(brepM.bboxMax[0] - meshM.bboxMax[0])).toBeLessThan(xyTol)
    expect(Math.abs(brepM.bboxMax[1] - meshM.bboxMax[1])).toBeLessThan(xyTol)
  })

  it('screw with chc head, no thread', async () => {
    const script = makePartScript([
      makeStmt('s1', 'screw', {
        system: 'metric', specIdx: 5, thread: 'none',
        length: 20, head: 'chc', nRad: 32,
      }),
    ])
    const brepShape = await runMode(script, 'brep')
    const meshShape = await runMode(script, 'mesh')
    const brepM = computeMetrics(brepShape)
    const meshM = computeMetrics(meshShape)

    expect(brepM.triangleCount).toBeGreaterThan(0)
    expect(meshM.triangleCount).toBeGreaterThan(0)

    // No thread → shank is smooth cylinder, should be very close
    const tol = 0.5
    expect(Math.abs(brepM.bboxMin[2] - meshM.bboxMin[2])).toBeLessThan(tol)
    expect(Math.abs(brepM.bboxMax[2] - meshM.bboxMax[2])).toBeLessThan(tol)
    expect(Math.abs(brepM.bboxMax[0] - meshM.bboxMax[0])).toBeLessThan(tol)
    expect(Math.abs(brepM.bboxMax[1] - meshM.bboxMax[1])).toBeLessThan(tol)
  })

  it('screw with no head, no thread (plain cylinder)', async () => {
    const script = makePartScript([
      makeStmt('s1', 'screw', {
        system: 'metric', specIdx: 5, thread: 'none',
        length: 25, head: 'none', nRad: 32,
      }),
    ])
    const brepShape = await runMode(script, 'brep')
    const meshShape = await runMode(script, 'mesh')
    const brepM = computeMetrics(brepShape)
    const meshM = computeMetrics(meshShape)

    expect(brepM.triangleCount).toBeGreaterThan(0)
    expect(meshM.triangleCount).toBeGreaterThan(0)

    // Plain cylinder, no thread, no head → should be nearly identical
    const tol = 0.1
    expect(Math.abs(brepM.bboxMin[2] - meshM.bboxMin[2])).toBeLessThan(tol)
    expect(Math.abs(brepM.bboxMax[2] - meshM.bboxMax[2])).toBeLessThan(tol)
    expect(Math.abs(brepM.bboxMax[0] - meshM.bboxMax[0])).toBeLessThan(tol)
    expect(Math.abs(brepM.bboxMax[1] - meshM.bboxMax[1])).toBeLessThan(tol)
  })
})

// ── 文字（text）：bbox 一致性测试 ──
//
// R2 修复后，BREP 和 mesh 路径都使用 opentype.js + OpenSans Regular 字体。
// 字体来源已统一，但曲面向三角化的算法不同：
// - BREP：opentype 路径 → OCCT bezier/line edges → makeFace → extrude → OCCT tessellate
// - mesh：opentype 路径 → THREE.Shape → ExtrudeGeometry
//
// 因此 bbox 应高度一致（同一字体同一尺寸），但体积/表面积因曲线细分
// 算法不同会有差异（与基本体 parity 同理）。这里只比较 bbox。

describe('BREP/Mesh equivalence: text (bbox only, curve tessellation differs)', () => {
  it('text "ABC" with size=20, depth=5', async () => {
    const script = makePartScript([
      makeStmt('s1', 'text', {
        text: 'ABC',
        size: 20,
        depth: 5,
      }),
    ])
    const brepShape = await runMode(script, 'brep')
    const meshShape = await runMode(script, 'mesh')
    const brepM = computeMetrics(brepShape)
    const meshM = computeMetrics(meshShape)

    expect(brepM.triangleCount).toBeGreaterThan(0)
    expect(meshM.triangleCount).toBeGreaterThan(0)

    // bbox should be very close (same font, same size, same depth)
    // Use 1mm absolute tolerance for text (bezier tessellation differences)
    const tol = 1.0
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(brepM.bboxMin[i] - meshM.bboxMin[i]),
        `text bboxMin[${i}]`).toBeLessThan(tol)
      expect(Math.abs(brepM.bboxMax[i] - meshM.bboxMax[i]),
        `text bboxMax[${i}]`).toBeLessThan(tol)
    }
  })

  it('text "Hello" with size=15, depth=3', async () => {
    const script = makePartScript([
      makeStmt('s1', 'text', {
        text: 'Hello',
        size: 15,
        depth: 3,
      }),
    ])
    const brepShape = await runMode(script, 'brep')
    const meshShape = await runMode(script, 'mesh')
    const brepM = computeMetrics(brepShape)
    const meshM = computeMetrics(meshShape)

    expect(brepM.triangleCount).toBeGreaterThan(0)
    expect(meshM.triangleCount).toBeGreaterThan(0)

    const tol = 1.0
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(brepM.bboxMin[i] - meshM.bboxMin[i]),
        `text bboxMin[${i}]`).toBeLessThan(tol)
      expect(Math.abs(brepM.bboxMax[i] - meshM.bboxMax[i]),
        `text bboxMax[${i}]`).toBeLessThan(tol)
    }
  })

  it('text "X" with depth=1.5 (thin extrusion)', async () => {
    const script = makePartScript([
      makeStmt('s1', 'text', {
        text: 'X',
        size: 25,
        depth: 1.5,
      }),
    ])
    const brepShape = await runMode(script, 'brep')
    const meshShape = await runMode(script, 'mesh')
    const brepM = computeMetrics(brepShape)
    const meshM = computeMetrics(meshShape)

    expect(brepM.triangleCount).toBeGreaterThan(0)
    expect(meshM.triangleCount).toBeGreaterThan(0)

    // Depth (Z axis) should be very close
    const depthTol = 0.5
    expect(Math.abs(brepM.bboxMax[2] - brepM.bboxMin[2] - (meshM.bboxMax[2] - meshM.bboxMin[2])),
      'text depth (Z range)').toBeLessThan(depthTol)

    // X/Y bbox should be close (same font, same size)
    const xyTol = 1.0
    expect(Math.abs(brepM.bboxMax[0] - meshM.bboxMax[0]), 'text bboxMax[0]').toBeLessThan(xyTol)
    expect(Math.abs(brepM.bboxMax[1] - meshM.bboxMax[1]), 'text bboxMax[1]').toBeLessThan(xyTol)
  })
})
