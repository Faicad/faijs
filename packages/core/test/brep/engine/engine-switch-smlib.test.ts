/**
 * engine-switch-smlib — smlib（usd-brep SM_API）第三 BREP 引擎 P1 验收
 *
 * 方案文档 §6 P1 验收："engine-switch 测试可在 smlib 会话下建 box/union 并出 mesh"。
 * 与 engine-switch.test.ts 同构：同一段 faijs 脚本、同一个 runtime 执行路径
 * （registry → ensureBrepChain → api → brep ops），只是注册 smlib 引擎。
 *
 * P1 能力面：生命周期、图元、布尔（副本化）、变换、测量、meshShape/wireframe、
 * getSubShapes（face/edge）。本测试覆盖验收锚 + 红线验证：
 * - meshShape 的 faceGroups face hash 与 getSubShapes('face') 的 subShapeHashes 同源
 *   （方案文档 §4.4：同一 SmFace* 指针 → 同一 hash，拓扑提取可回查）；
 * - 布尔副本化后用户句柄（part0/part1）仍可用（SmApiBoolean* 原地消耗式已隔离）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { ExecutionResult } from '../../../src/cad-runtime/runtime'
import type { HostPorts } from '../../../src/cad-runtime/ports'
import { asPartName } from '../../../src/identity'
import { __resetEngineRegistriesForTests, getActiveBrepEngineId } from '../../../src/brep/engine/registry'
import { registerSmlibBrepEngine, SMLIB_BREP_ENGINE_ID } from '../../../src/brep/engine/adapters/smlib'
import { registerOcctBrepEngine } from '../../../src/brep/engine/adapters/occt'
import { createSmlibPrimitives } from '../../../src/smlib-kernel/smlibKernel'
import { createEditorRuntime } from '../../support/editor-ops'

/** 同一段 faijs 脚本：构造（box×2）→ 布尔（union）→ 显式保留 part0。 */
const SCRIPT = `let part0 = cad.box(10, 20, 30)
let part1 = cad.box(5, 5, 5, { at: [10, 10, 10] })
let part2 = cad.union(part0, part1)
part0.keep()
`

/** 简化宿主端口（box/union 不依赖 assets/fonts）。 */
function createNodePorts(): HostPorts {
  return { events: { emit: () => undefined } }
}

async function runWithEngine(): Promise<ExecutionResult> {
  __resetEngineRegistriesForTests()
  await registerSmlibBrepEngine()
  expect(getActiveBrepEngineId()).toBe(SMLIB_BREP_ENGINE_ID)
  const runtime = createEditorRuntime(createNodePorts(), 'brep')
  return runtime.execute(SCRIPT)
}

describe('smlib 引擎（第三 BREP 引擎，P1 内核桥验收）', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('box+union 成功 → ≥2 brepSolids + part2 meshShape 出 faceGroups', async () => {
    const result = await runWithEngine()
    expect(result.failedAt).toBeUndefined()
    expect(result.brepSolids).toBeDefined()
    // union 消费输入；part0 由独立声明保留 → part0 + part2
    expect(result.brepSolids!.size).toBeGreaterThanOrEqual(2)
    const entry = result.brepSolids!.get(asPartName('part2'))
    expect(entry).toBeDefined()
    const solid = entry!.solid

    // 测量（P1 面）：union 体积 > 单个 box（含重叠区容差）
    const vol = entry!.kernel.getVolume(solid)
    const vBox0 = 10 * 20 * 30 // 6000
    const vBox1 = 5 * 5 * 5 // 125
    expect(vol).toBeGreaterThan(vBox0)
    expect(vol).toBeLessThanOrEqual(vBox0 + vBox1 + 1e-6)

    // meshShape（P1 面）：非空网格 + faceGroups
    const mesh = entry!.kernel.meshShape(solid)
    expect(mesh.vertexCount).toBeGreaterThan(0)
    expect(mesh.triangleCount).toBeGreaterThan(0)
    expect(mesh.faceCount).toBeGreaterThan(0)
    expect(mesh.faceGroups!.length).toBe(mesh.faceCount! * 3)

    // 红线：faceGroups 的面 hash 与 getSubShapes('face') 的 subShapeHashes 同源
    const faces = entry!.kernel.getSubShapes(solid, 'face')
    expect(faces.length).toBe(mesh.faceCount)
    const faceHashes = entry!.kernel.subShapeHashes(solid, 'face', 2147483647)
    expect(faceHashes.length).toBe(faces.length)
    // faceGroups 里的 hash 集合 ⊆ subShapeHashes 集合（同指针同 hash）
    const groupHashes = new Set<number>()
    for (let i = 0; i < mesh.faceCount!; i++) groupHashes.add(mesh.faceGroups![i * 3 + 2])
    for (const h of groupHashes) expect(faceHashes).toContain(h)
  })

  it('布尔副本化：part0/part1 句柄在 union 后仍可查询（未被内核消耗）', async () => {
    const result = await runWithEngine()
    const entry0 = result.brepSolids!.get(asPartName('part0'))
    expect(entry0).toBeDefined()
    // part0 原 box：体积仍 6000（SmApiBoolean* 的 a 原地消耗已被副本化隔离）
    expect(entry0!.kernel.getVolume(entry0!.solid)).toBeCloseTo(6000, 3)
  })

  it('extrude：面实体沿 +Z 拉伸成体（P2 造型 op 级放行；engines 声明须含 smlib）', async () => {
    // 回归：cad.extrude 曾是 engines:['occt'] 声明，smlib 下走 D11 判定被挡
    // （E_MESH_UNSUPPORTED）。smlibKernel.extrude（CreateLinearSweepEx）已实现且
    // P2 kernel 级测试通过——op 声明漏加 smlib 是接线遗漏，本用例钉住修复。
    const SCRIPT_EXTRUDE = `let part0 = cad.profile({ contours: [{ segments: [
  { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
  { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 20 },
  { kind: 'line', x1: 10, y1: 20, x2: 0, y2: 20 },
  { kind: 'line', x1: 0, y1: 20, x2: 0, y2: 0 },
] }] })
let part1 = cad.extrude(part0, [0, 0, 5])
part1.keep()
`
    __resetEngineRegistriesForTests()
    await registerSmlibBrepEngine()
    const runtime = createEditorRuntime(createNodePorts(), 'brep')
    const result = await runtime.execute(SCRIPT_EXTRUDE)
    expect(result.failedAt).toBeUndefined()
    const entry1 = result.brepSolids!.get(asPartName('part1'))
    expect(entry1).toBeDefined()
    // 10 × 20 × 5 = 1000
    expect(entry1!.kernel.getVolume(entry1!.solid)).toBeCloseTo(1000, 3)
    // 网格封闭性（3d_editor worker-sim 用散度定理验证端侧草图链）：meshShape 网格的
    // 散度体积必须 ≈ 内核体积（缺失/反转面会让散度值偏离，worker-sim 曾实测 462.5/500）。
    const mesh = entry1!.kernel.meshShape(entry1!.solid)
    expect(mesh.vertexCount).toBeGreaterThan(0)
    let divVol = 0
    const pos = mesh.positions, idx = mesh.indices
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3
      const ax = pos[a], ay = pos[a + 1], az = pos[a + 2]
      const bx = pos[b], by = pos[b + 1], bz = pos[b + 2]
      const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2]
      divVol += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6
    }
    expect(Math.abs(divVol)).toBeCloseTo(1000, 0)
  })

  it('wire：点列造 1D 曲线（worker-sim 四操作段 cad.wire 复现；makeLineEdge/makeWire）', async () => {
    const SCRIPT_WIRE = `let w0 = cad.wire([[0,0,0],[0,0,25],[0,0,50]])
w0.keep()
`
    __resetEngineRegistriesForTests()
    await registerSmlibBrepEngine()
    const runtime = createEditorRuntime(createNodePorts(), 'brep')
    const result = await runtime.execute(SCRIPT_WIRE)
    expect(result.failedAt).toBeUndefined()
  })

  it.each([
    ['ellipse', "cad.sketch({ shapes:[{kind:'ellipse', rx:8, ry:5}], constraints:[], plane:'XY' })"],
    ['roundedRect', "cad.sketch({ shapes:[{kind:'roundedRect', w:10, d:8, r:2}], constraints:[], plane:'XY' })"],
    ['polygon', "cad.sketch({ shapes:[{kind:'polygon', n:6, r:8}], constraints:[], plane:'XY' })"],
    ['slot', "cad.sketch({ shapes:[{kind:'slot', w:10, d:4}], constraints:[], plane:'XY' })"],
    ['trapezoid', "cad.sketch({ shapes:[{kind:'trapezoid', w:12, h:8, a1:80 * DEGREE, a2:80 * DEGREE}], constraints:[], plane:'XY' })"],
  ])('全图元构面复现：%s 的 sketch 必须成面（worker-sim 全图元段）', async (label, line) => {
    __resetEngineRegistriesForTests()
    await registerSmlibBrepEngine()
    const runtime = createEditorRuntime(createNodePorts(), 'brep')
    const result = await runtime.execute(`${line}\n`)
    expect(result.failedAt).toBeUndefined()
  })

  it('探针：roundedRect 分步构面（内核级，定位 SM 1001）', async () => {
    const prim = await createSmlibPrimitives()
    const p = (x: number, y: number, z: number) => ({ x, y, z })
    // roundedRect w=10 d=8 r=2：角心 (±3,±2)，弧 90°。
    const lines = [
      prim.makeLineEdge(p(-3, -4, 0), p(3, -4, 0)),
      prim.makeLineEdge(p(5, -2, 0), p(5, 2, 0)),
      prim.makeLineEdge(p(3, 4, 0), p(-3, 4, 0)),
      prim.makeLineEdge(p(-5, 2, 0), p(-5, -2, 0)),
    ]
    const arcs = [
      prim.makeArcEdge(p(3, -4, 0), p(4.41421356, -3.41421356, 0), p(5, -2, 0)), // 右下
      prim.makeArcEdge(p(5, 2, 0), p(4.41421356, 3.41421356, 0), p(3, 4, 0)), // 右上
      prim.makeArcEdge(p(-3, 4, 0), p(-4.41421356, 3.41421356, 0), p(-5, 2, 0)), // 左上
      prim.makeArcEdge(p(-5, -2, 0), p(-4.41421356, -3.41421356, 0), p(-3, -4, 0)), // 左下
    ]
    // 打印 f1 组合（4 直线 + 1 弧）各曲线端点与端切向，对照"闭合/相切"。
    const diag = [...lines.slice(0, 1), arcs[0], ...lines.slice(1)]
    const fmt = (v: { x: number; y: number; z: number }) => `(${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)})`
    for (const c of diag) {
      const pr = prim.curveParameters(c)
      const t0 = pr.first
      const t1 = pr.last
      const p0 = prim.curvePointAtParam(c, t0)
      const p1 = prim.curvePointAtParam(c, t1)
      const d0 = prim.curveTangent(c, t0)
      const d1 = prim.curveTangent(c, t1)
      console.log(
        `  curve t[${t0.toFixed(3)},${t1.toFixed(3)}] start=${fmt(p0)} tan0=${fmt(d0)} | end=${fmt(p1)} tan1=${fmt(d1)}`,
      )
    }
    // 对照：makeCircleArc（同一圆心 (3,-2) r=2，270°→0°）应画 (3,-4)→(5,-2)。
    {
      const c2 = prim.makeCircleArc(p(3, -2, 0), p(0, 0, 1), 2, 270, 360)
      const pr = prim.curveParameters(c2)
      const s0 = prim.curvePointAtParam(c2, pr.first)
      const s1 = prim.curvePointAtParam(c2, pr.last)
      console.log(`  makeCircleArc 270→360: start=${fmt(s0)} end=${fmt(s1)}`)
    }
    // 分步：① 完整交替闭环（faijs roundedRectangleBlueprint 形态：直线/弧交错，
    // 4 直线 + 4 弧 = 圆角矩形真实轮廓）。注意：纯 4 直线（无弧）或部分弧的
    // 组合在几何上**不构成闭环**（圆角矩形的角在 (±3,±2)/(±5,±4) 半径 2 处，
    // 缺角弧即断开）——探针只对真实闭环断言。
    const alternating = [
      lines[0], arcs[0], lines[1], arcs[1], lines[2], arcs[2], lines[3], arcs[3],
    ]
    // 打印交替 8 条端点的闭合链（相邻曲线的端点是否配对）。
    for (let i = 0; i < alternating.length; i++) {
      const c = alternating[i]
      const pr = prim.curveParameters(c)
      const s0 = prim.curvePointAtParam(c, pr.first)
      const s1 = prim.curvePointAtParam(c, pr.last)
      const next = alternating[(i + 1) % alternating.length]
      const npr = prim.curveParameters(next)
      const ns0 = prim.curvePointAtParam(next, npr.first)
      console.log(`  #${i} end=${fmt(s1)} -> #${(i + 1) % 8} start=${fmt(ns0)}`)
    }
    const f3 = prim.makeFace(prim.makeWire(alternating))
    expect(f3).toBeDefined()
  })

  it('extrude：线性扫掠高度不被方向长度双重放大（SmApiCreateLinearSweep 不归一化 dir）', async () => {
    const prim = await createSmlibPrimitives()
    const p = (x: number, y: number, z: number) => ({ x, y, z })
    // 10×10 方形环 → face → extrude(0,0,5) → meshShape 的 z 高必须 ≈ 5
    //（回归：曾传 dir=(0,0,5)+dist=5 → 内核不归一化 → 挤出 25）。
    const square = [
      prim.makeLineEdge(p(0, 0, 0), p(10, 0, 0)),
      prim.makeLineEdge(p(10, 0, 0), p(10, 10, 0)),
      prim.makeLineEdge(p(10, 10, 0), p(0, 10, 0)),
      prim.makeLineEdge(p(0, 10, 0), p(0, 0, 0)),
    ]
    const face = prim.makeFace(prim.makeWire(square))
    const solid = prim.extrude(face, 0, 0, 5)
    // meshShape → 顶点 z 最大值（meshShape 原点三角缺陷只影响 z 下界，不影响 z 上界）
    const mesh = prim.meshShape(solid)
    let maxZ = -Infinity
    for (let i = 0; i < mesh.positions.length; i += 3) maxZ = Math.max(maxZ, mesh.positions[i + 2])
    expect(maxZ).toBeGreaterThan(4.9)
    expect(maxZ).toBeLessThan(5.1)
  })

  it('sweep：smlib 沿平面路径扫掠可用，与 occt 同体积（400）', async () => {
    // 2026-10-31 前这里是「必须 E_BREP_UNSUPPORTED」的反向用例：smlib 适配器
    // `unsupported('sweep')` + op 声明 engines:['occt']。内核其实一直有
    // SmApiCreateSweepAlongPlanarPath，只是没在 facade 导出；补导出 + 重编两套 wasm
    // 后三引擎同实现，用例改为正向（4×4 截面沿 +Z 扫 25 → 400）。
    const SCRIPT_SWEEP = `let s = cad.sketch({ shapes:[{kind:'rect', cx:0, cy:0, w:4, d:4}], constraints:[], plane:'XY' })
let w = cad.wire([[0,0,0],[0,0,25]])
let p = cad.sweep(s, w)
let v = cad.volume(p)
if (Math.abs(v - 400) > 0.5) throw 'volume=' + v
`
    __resetEngineRegistriesForTests()
    await registerSmlibBrepEngine()
    const smlibRes = await createEditorRuntime(createNodePorts(), 'brep').execute(SCRIPT_SWEEP)
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const occtRes = await createEditorRuntime(createNodePorts(), 'brep').execute(SCRIPT_SWEEP)
    expect(smlibRes.failedAt?.message ?? null).toBeNull()
    expect(occtRes.failedAt?.message ?? null).toBeNull()
  })
})
