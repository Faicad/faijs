/**
 * @vitest-environment node
 *
 * S4 剩余 C4（5 项）中 4 项的**处置探针**（长期保留，可重复跑）——方案 §3.4.3 / §3.4.5。
 *
 * 这四项不是「新增 op」，而是判定为 **C3（能力已由现 op 覆盖）**。判定必须可复现，
 * 故每条处置都钉住「原生方法」与「现有脚本 op」的**等价证据**：
 *
 *   1. `cutAll`              → `cad.subtract(a,b,c)`（链式）/ `cad.boolean([a],[b,c],'cut')`
 *   2. `sweepAdvanced`       → `cad.sweep(..., { …sweepFull 字段 })`（SweepFullOptions ⊇ SweepAdvancedOptions）
 *   3. `sweepOriented`       → `cad.sweep(..., { orientation, up })`
 *   4. `chamferAsymmetric`   → `cad.chamfer(..., { type:'twoDistances', width1, width2 })`
 *
 * ⚠️ 为什么这四项**不能**落成 C2（op 直调）：`chamfer` / `subtract` 是**中立 op**
 * （brepkit 也要能跑），在它们的实现体里插 occt 原生调用会造出 **L3 违规**
 * （平台裸调但 op 未声明 `engines:['occt']`）——扫描器 `scan-occt-op-coverage.ts:383-395`
 * 的判定即此。故正确处置是 C3 + 等价证据，不是硬塞直调。
 *
 * 钉住的事实：
 *   A. 原生 `cutAll(A,[B,C])` 与链式 `subtract(A,B,C)` 体积相等（A − (B∪C) = ((A−B)−C)）；
 *   B. 原生 `sweepAdvanced` 与 `sweepFull`（同一 options）体积相等；
 *      原生 `sweepOriented(mode,up)` 与 `sweepFull({mode,up})` 体积相等；
 *      ⇒ `sweepFull` 是二者的严格超集，脚本面只需 `sweep` 一个符号；
 *   C. 原生 `chamferAsymmetric(d1,d2,refFace)` 与 `chamfer` 的 `twoDistances` 换算
 *      （§3.5：dF/dO + β → chamferDistAngle(dF,θ)）体积相等 ⇒ `twoDistances` 即
 *      非对称倒角，`referenceFace` 的取舍由 `EdgeTopoRef.faces` 的**顺序**表达。
 *
 * Run: npx vitest run test/api/occt-s4-c4-disposition.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { initOcctWasm, getOcctKernel } from '../../src/occt-kernel/occtKernel'
import type { ShapeHandle } from 'occt-wasm'
import type { Shape } from '../../src/mesh/types'
import { __resetEngineRegistriesForTests, getBrepEngine } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { solidToShape } from '../../src/brep/brep-ops'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { brepOf, fromBrep } from '../../src/shape'
import type { BrepHandle } from '../../src/brep/engine/types'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'
import { angleBetweenNormals, materialDihedralFromNormalAngle, chamferAngleFromDistances } from '../../src/api/chamfer-math'

let boxA: Shape

beforeAll(async () => {
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
  await initOcctWasm()
  const brep = await getBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepEngineId: 'occt' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
  boxA = adopt(getBrepApi().makeBox(10, 10, 10))
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

function adopt(h: BrepHandle): Shape {
  return fromBrep(solidToShape(getBrepApi(), h), { solid: h })
}

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

function exec(mode: ExecutionMode, code: string) {
  return new CadRuntime(ports(), mode, { cad: createApiNamespaceWithEditorOps() }).execute(code)
}

function volumeOf(s: Shape): number {
  return getBrepApi().getVolume(brepOf(s) as never)
}

/** 与 chamfer.ts `faceMidNormal` 同口径：面 UV 中点的外法向。 */
function faceMidNormal(f: BrepHandle): [number, number, number] {
  const k = getBrepApi()
  const uv = k.uvBounds(f)
  const n = k.surfaceNormal(f, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2)
  return [n.x, n.y, n.z]
}

describe('C4-1. cutAll ⇒ 链式 subtract / 一次 boolean（脚本级 + 原生对照）', () => {
  // A = [0,10]³；B = A+(5,0,0)；C = A+(0,5,0)
  // A − (B∪C)  = x∈[0,5] ∧ y∈[0,5] ⇒ 体积 5×5×10 = 250
  const SCRIPT =
    `let part0 = cad.box(10,10,10)\n` +
    `let part1 = cad.translate(part0, 5, 0, 0)\n` +
    `let part2 = cad.translate(part0, 0, 5, 0)\n` +
    `let part3 = cad.subtract(part0, part1, part2)\n` +
    `let part4 = cad.boolean([part0], [part1, part2], 'cut')\n`

  it('A1. 链式 cad.subtract(a,b,c) 体积 = 250', async () => {
    const r = await exec('brep', SCRIPT)
    expect(r.failedAt).toBeUndefined()
    expect(volumeOf(r.outputs.get(asPartName('part3')) as Shape)).toBeCloseTo(250, 3)
  })

  it('A2. 一次 cad.boolean([a],[b,c],cut) 体积 = 250（与链式同解）', async () => {
    const r = await exec('brep', SCRIPT)
    expect(r.failedAt).toBeUndefined()
    expect(volumeOf(r.outputs.get(asPartName('part4')) as Shape)).toBeCloseTo(250, 3)
  })

  it('A3. 原生 cutAll(A,[B,C]) 与链式 subtract 体积相等（C3 判定的证据）', () => {
    const k = getOcctKernel()
    const a = brepOf(boxA) as unknown as Parameters<typeof k.cutAll>[0]
    const b = k.translate(a, 5, 0, 0)
    const c = k.translate(a, 0, 5, 0)
    const oneShot = k.cutAll(a, [b, c])
    const chained = k.cut(k.cut(a, b), c)
    const volOne = k.getVolume(oneShot as never)
    const volChain = k.getVolume(chained as never)
    expect(volOne).toBeCloseTo(250, 3)
    expect(volChain).toBeCloseTo(volOne, 3)
    k.release(b)
    k.release(c)
    k.release(oneShot as never)
    k.release(chained as never)
  })
})

describe('C4-2. sweepAdvanced / sweepOriented ⇒ sweepFull（脚本级 + 原生对照）', () => {
  /**
   * 截面：半径 2 的圆（z=0 平面）；脊柱：z 向 50 长直线。
   *
   * 句柄品牌（GOTCHA）：occt 原生 `OcctKernel` 用的是 `ShapeHandle`，L1
   * `BrepEngineApi` 用的是 `BrepHandle` —— 两者都是 `number & { readonly [brand]: never }`
   * 但**品牌键不同**，互不可赋值。原生链路上全程用 `ShapeHandle`。
   */
  function profileAndSpine(): { w: ShapeHandle; sp: ShapeHandle } {
    const k = getOcctKernel()
    const circle = k.makeCircleEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 2)
    const w = k.makeWire([circle])
    const line = k.makeLineEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 50 })
    const sp = k.makeWire([line])
    k.release(circle)
    k.release(line)
    return { w, sp }
  }

  it('B1. 原生 sweepAdvanced 与 sweepFull（同一 options）体积相等', () => {
    const k = getOcctKernel()
    const { w, sp } = profileAndSpine()
    const opts = { mode: 0, withContact: true, withCorrection: true, maxDegree: 3, maxSegments: 8 }
    const adv = k.sweepAdvanced(w as never, sp as never, opts as never)
    const full = k.sweepFull(w as never, sp as never, opts as never)
    const va = k.getVolume(adv as never)
    const vf = k.getVolume(full as never)
    // 圆柱 π·2²·50 ≈ 628.3；只比体积相等，不比绝对值
    expect(va).toBeGreaterThan(600)
    expect(vf).toBeCloseTo(va, 3)
    k.release(adv as never)
    k.release(full as never)
    k.release(w)
    k.release(sp)
  })

  it('B2. 原生 sweepOriented(FixedUp, up=+Z) 与 sweepFull({mode:FixedUp,up}) 体积相等', () => {
    const k = getOcctKernel()
    const { w, sp } = profileAndSpine()
    const up = { x: 0, y: 0, z: 1 }
    const oriented = k.sweepOriented(w as never, sp as never, 2, up, undefined, undefined)
    const full = k.sweepFull(w as never, sp as never, { mode: 2, up } as never)
    const vo = k.getVolume(oriented as never)
    const vf = k.getVolume(full as never)
    expect(vo).toBeGreaterThan(600)
    expect(vf).toBeCloseTo(vo, 3)
    k.release(oriented as never)
    k.release(full as never)
    k.release(w)
    k.release(sp)
  })

  it('B3. 脚本面 sweep 接受 withContact / withCorrection（sweepFull 控制面补齐）', async () => {
    const r = await exec(
      'brep',
      `let part0 = cad.wire([[0,0,0],[0,0,50]])\n` +
        `let part1 = cad.profile({ contours: [{ segments: [` +
        `{ kind: 'line', x1: -4, y1: -4, x2: 4, y2: -4 },` +
        `{ kind: 'line', x1: 4, y1: -4, x2: 4, y2: 4 },` +
        `{ kind: 'line', x1: 4, y1: 4, x2: -4, y2: 4 },` +
        `{ kind: 'line', x1: -4, y1: 4, x2: -4, y2: -4 },` +
        `] }] })\n` +
        `let part2 = cad.sweep(part1, part0, { orientation: 'fixed', withContact: true, withCorrection: true })\n`,
    )
    expect(r.failedAt).toBeUndefined()
    // 8×8 截面 × 50 长 = 3200
    expect(volumeOf(r.outputs.get(asPartName('part2')) as Shape)).toBeCloseTo(3200, 1)
  })
})

describe('C4-3. chamferAsymmetric ⇒ chamfer(type:"twoDistances")', () => {
  /**
   * 取 boxA 的第 0 条边，找它的两个邻面；以 faces[0] 为参考面做 d1=1 / d2=2 的非对称倒角。
   * 两条路径对照：
   *   - 原生 `chamferAsymmetric(solid, edge, 1, 2, faces[0])`
   *   - `chamfer` 的 twoDistances 换算（§3.5）：β = 材料侧二面角，
   *     θ = chamferAngleFromDistances(dF,dO,β) → L1 `chamferDistAngle(solid, [edge], dF, θ)`
   */
  function edgeWithFaces(): { edge: BrepHandle; faces: BrepHandle[] } {
    const k = getBrepApi()
    const solid = brepOf(boxA) as BrepHandle
    const faces = k.getSubShapes(solid, 'face') as BrepHandle[]
    const edges = k.getSubShapes(solid, 'edge') as BrepHandle[]
    const edge = edges[0]!
    const adjacent = faces.filter((f) =>
      (k.getSubShapes(f, 'edge') as BrepHandle[]).some((e) => k.isSame(e, edge)),
    )
    return { edge, faces: adjacent }
  }

  it('C1. 第 0 条边恰有两个邻面（前置：盒体棱）', () => {
    const { faces } = edgeWithFaces()
    expect(faces.length).toBe(2)
  })

  it('C2. 原生 chamferAsymmetric 与 twoDistances 换算（chamferDistAngle）体积相等', () => {
    const k = getBrepApi()
    const ok = getOcctKernel()
    const solid = brepOf(boxA) as BrepHandle
    const { edge, faces } = edgeWithFaces()
    const d1 = 1
    const d2 = 2

    // 路径 1：原生非对称倒角（参考面 = faces[0]）
    const native = ok.chamferAsymmetric(
      solid as never,
      edge as never,
      d1,
      d2,
      faces[0] as never,
    ) as unknown as BrepHandle
    const volNative = k.getVolume(native)

    // 路径 2：§3.5 换算（与 api/chamfer.ts twoDistParams 同一组函数）
    const na = faceMidNormal(faces[0]!)
    const nb = faceMidNormal(faces[1]!)
    const dot = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]
    const beta = materialDihedralFromNormalAngle(angleBetweenNormals(dot))
    const thetaDeg = (chamferAngleFromDistances(d1, d2, beta) * 180) / Math.PI
    const converted = k.chamferDistAngle(solid, [edge], d1, thetaDeg)
    const volConverted = k.getVolume(converted)

    // 倒角后体积 < 1000 且 > 900（切掉的是一条棱上的小楔体）
    expect(volNative).toBeLessThan(1000)
    expect(volNative).toBeGreaterThan(900)
    expect(volConverted).toBeCloseTo(volNative, 3)

    k.release(native)
    k.release(converted)
  })

  it('C3. 脚本面 cad.chamfer(type:"twoDistances") 可执行且体积下降', async () => {
    const r = await exec(
      'brep',
      `let part0 = cad.box(10,10,10)\n` +
        // edges 用 cad.edgeRef(part0, 1) 合成（手写 role 字面量对不上 box 的命名槽，
        // 实测报 E_TOPO_NOT_FOUND）。序号 1 起，与 C1/C2 里 edges[0] 同一个次序口径。
        `let part1 = cad.chamfer(part0, { edges: [cad.edgeRef(part0, 1)], ` +
        `type:'twoDistances', width1:1, width2:2 })\n`,
    )
    expect(r.failedAt).toBeUndefined()
    const v = volumeOf(r.outputs.get(asPartName('part1')) as Shape)
    expect(v).toBeLessThan(1000)
    expect(v).toBeGreaterThan(900)
  })
})
