/**
 * kernel-nut-probe.ts — W4（Nut / Washer）所需内核语义的可复跑测量台。
 *
 * 用途（方案 §8-W2 顺序铁律「先 probe 后开发」）：W4 的构造路径依赖 4 个
 * `BrepEngineApi` 基类原语（`extrude` / `fuse` / `common` / `makeCylinder`）与
 * 2 个本包声明成员（`revolve` / `makeNonPlanarFace`），但它们在 W2/W3 只经
 * 部分 probe。本脚本把 W4 真正要用的**语义**量一遍，断言常量取自本脚本输出。
 *
 * 运行：npx tsx scripts/kernel-nut-probe.ts [段号,...]   （省略 = 全部）
 * 结论载体（回归锁）：src/kernel-conformance.test.ts（正向契约）、
 * src/kernel-pitfalls.test.ts（陷阱 8 = 段 7 的 revolve 拓扑）、
 * src/nut.test.ts（段 8 = threaded GProps 混叠的三角化裁定）。
 *
 * ⚠️ 本脚本只**打印**、不 assert —— 它是证据生成器；断言在测试里。
 */

import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import { exportStepFromSolids } from '@faicad/faijs-core'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupWarehouseKernel } from '../src/test-setup'
import { requireKernel, type WarehouseKernel } from '../src/kernel'
import {
  MESH_ANGULAR_DEFLECTION,
  MESH_LINEAR_DEFLECTION,
  polygonWire,
  volumeOf,
} from '../src/primitives'
import { hexNut } from '../src/nut'
import { isoThread } from '../src/thread'

let k: WarehouseKernel
const V = (x: number, y: number, z: number): BrepVec3 => ({ x, y, z })
const AXIS_Z = { point: V(0, 0, 0), direction: V(0, 0, 1) }

function line(label: string, value: unknown): void {
  console.log(`${label.padEnd(58)} ${String(value)}`)
}

/** 安全求值（number）——抛错/NaN 都变成可读字符串。 */
function n(fn: () => number): string {
  try {
    const v = fn()
    return Number.isFinite(v) ? v.toFixed(6) : String(v)
  } catch (e) {
    return `THROW(${String(e).split('\n')[0]!.slice(0, 56)})`
  }
}

/** 安全求值（任意）——用于「应当抛错」的探针。 */
function tryDo(fn: () => unknown): string {
  try {
    fn()
    return 'no-throw'
  } catch (e) {
    return `THROW(${String(e).split('\n')[0]!.slice(0, 56)})`
  }
}

/** XY 平面闭合矩形 wire（z 固定）。 */
function rectWire(w: number, h: number, z = 0): BrepHandle {
  return polygonWire([V(0, 0, z), V(w, 0, z), V(w, h, z), V(0, h, z)])
}

const SECTIONS: Record<string, () => void> = {
  // ── 1：extrude 语义（nut_plan → 拉伸；上游 `.extrude(max_nut_height)`）──
  '1': () => {
    console.log('── 1: extrude(shape, dx, dy, dz) 语义 ──')
    const f = k.makeFace(rectWire(4, 2, 0))
    line('makeFace(4×2 rect) 面积', n(() => k.getSurfaceArea(f)))
    const s = k.extrude(f, 0, 0, 3)
    line('extrude(face, 0,0,3) 返回非空', String(!!s))
    line('extrude(face, 0,0,3) volume（4×2×3=24）', n(() => k.getVolume(s)))
    const bb = k.getBoundingBox(s)
    line('extrude(face, 0,0,3) bbox z', `${(bb.zmax - bb.zmin).toFixed(6)} (z ${bb.zmin.toFixed(3)}→${bb.zmax.toFixed(3)})`)
    line('extrude(face, 0,0,3) bbox x/y', `${(bb.xmax - bb.xmin).toFixed(6)} × ${(bb.ymax - bb.ymin).toFixed(6)}`)
    // 负方向
    line('extrude(face, 0,0,-3) volume', n(() => k.getVolume(k.extrude(f, 0, 0, -3))))
    // 非 Z 向量（斜拉）
    line('extrude(face, 1,0,0) volume（4×2×1=8）', n(() => k.getVolume(k.extrude(f, 1, 0, 0))))
    // wire 输入（上游先 add().toPending() 再 extrude；此处测 wire 直拉是否可行）
    line('extrude(wire, 0,0,3) volume', n(() => k.getVolume(k.extrude(rectWire(4, 2, 0), 0, 0, 3))))
    // 非平面轮廓（XZ 平面矩形）沿 X 拉
    const xz = polygonWire([V(2, 0, 0), V(4, 0, 0), V(4, 0, 5), V(2, 0, 5)])
    line('extrude(XZ wire, 0,0,3) volume', n(() => k.getVolume(k.extrude(xz, 0, 0, 3))))
  },

  // ── 2：fuse / common（make_nut 的 intersect + flange union）──
  '2': () => {
    console.log('── 2: fuse / common / cut 语义 ──')
    const a = k.makeBox(2, 2, 2)
    const b = k.translate(k.makeBox(2, 2, 2), 1, 0, 0)
    line('box(2³) volume', n(() => k.getVolume(a)))
    line('fuse(a, translate(b,1,0,0)) volume（8+8−4=12）', n(() => k.getVolume(k.fuse(a, b))))
    line('common(a, translate(b,1,0,0)) volume（1×2×2=4）', n(() => k.getVolume(k.common(a, b))))
    line('cut(a, translate(b,1,0,0)) volume（8−4=4）', n(() => k.getVolume(k.cut(a, b))))
    // 包含关系（nut ∩ blank：blank 完全含 nut）
    const small = k.makeBox(1, 1, 1)
    line('common(small, box) volume（小在内=1）', n(() => k.getVolume(k.common(small, a))))
    // 不相交
    const far = k.translate(k.makeBox(1, 1, 1), 10, 0, 0)
    line('common(far, box) volume（不相交）', n(() => k.getVolume(k.common(far, a))))
    line('fuse(far, box) volume（不相交=9）', n(() => k.getVolume(k.fuse(far, a))))
    // fuseAll
    line('fuseAll([box, b, far]) volume', n(() => k.getVolume(k.fuseAll([a, b, far]))))
  },

  // ── 3：revolve 多边形轮廓（nut/washer 主体；上游 `.toPending().revolve()`）──
  '3': () => {
    console.log('── 3: revolve(闭合轮廓 wire, axis, angleRad) 语义 ──')
    // (a) XZ 平面实心矩形（在轴上起）→ 实心圆柱 r=3 h=5 → π·9·5
    const solid = polygonWire([V(0, 0, 0), V(3, 0, 0), V(3, 0, 5), V(0, 0, 5)])
    line('revolve(实心矩形 r=3 h=5) volume（π·9·5=141.372）', n(() => k.getVolume(k.revolve(solid, AXIS_Z, 2 * Math.PI))))
    // (b) 管状（不贴轴）：r∈[2,4] h=5 → π(16−4)·5=188.496
    const tube = polygonWire([V(2, 0, 0), V(4, 0, 0), V(4, 0, 5), V(2, 0, 5)])
    line('revolve(管 2→4 h=5) volume（π·12·5=188.496）', n(() => k.getVolume(k.revolve(tube, AXIS_Z, 2 * Math.PI))))
    // (c) 上游 default_nut_profile 的形态：起点 (0,0) + 斜线（6 边形倒角轮廓）
    const chamfered = polygonWire([
      V(0, 0, 0), V(3, 0, 0), V(3.4, 0, 0.2), V(3.4, 0, 4.8), V(3, 0, 5), V(0, 0, 5),
    ])
    line('revolve(带倒角 6 点轮廓) volume', n(() => k.getVolume(k.revolve(chamfered, AXIS_Z, 2 * Math.PI))))
    // (d) 上游 washer_profile 形态：起点**不在轴**上（d1/2 起）→ 应为管
    const washer = polygonWire([V(3, 0, 0), V(6, 0, 0), V(6, 0, 2), V(3, 0, 2)])
    line('revolve(washer 3→6 h=2) volume（π·27·2=169.646）', n(() => k.getVolume(k.revolve(washer, AXIS_Z, 2 * Math.PI))))
    // (e) 部分角度
    line('revolve(实心矩形, π/2) volume（141.372/4=35.343）', n(() => k.getVolume(k.revolve(solid, AXIS_Z, Math.PI / 2))))
    // (f) 顺时针点序（反向轮廓）→ 体积符号
    const cw = polygonWire([V(0, 0, 0), V(0, 0, 5), V(3, 0, 5), V(3, 0, 0)])
    line('revolve(反序轮廓) volume（负=朝内）', n(() => k.getVolume(k.revolve(cw, AXIS_Z, 2 * Math.PI))))
    // (g) 退化：XY 平面轮廓绕 Z 轴（W3 已证体积 0）
    const xyDisc = k.makeFace(rectWire(2, 2, 0))
    line('revolve(XY 平面 face 绕 Z) volume', n(() => k.getVolume(k.revolve(xyDisc, AXIS_Z, 2 * Math.PI))))
    // (h) 未闭合 wire（缺最后一条边）→ 是否抛错 / 静默
    const open: BrepHandle[] = [
      k.makeLineEdge(V(0, 0, 0), V(3, 0, 0)),
      k.makeLineEdge(V(3, 0, 0), V(3, 0, 5)),
      k.makeLineEdge(V(3, 0, 5), V(0, 0, 5)),
    ]
    line('makeWire(未闭合 3 边)', tryDo(() => k.makeWire(open)))
    line('revolve(未闭合 wire)', tryDo(() => k.revolve(k.makeWire(open), AXIS_Z, 2 * Math.PI)))
  },

  // ── 4：makeNonPlanarFace（HeatSetNut knurl 的 makeNSidedSurface 替代）──
  '4': () => {
    console.log('── 4: makeNonPlanarFace(4 边扭面 wire) —— knurl 面替代 ──')
    // knurl 面形态：4 条边两两相对（inside/outside × bottom/top），呈扭曲四边形
    const e1 = k.makeLineEdge(V(3, 0, 0), V(3.2, 0, 5))
    const e2 = k.makeLineEdge(V(3.4, 0.5, 0), V(3.4, 0.5, 5))
    const e3 = k.makeLineEdge(V(3.4, 0.5, 5), V(3.2, 0, 5))
    const e4 = k.makeLineEdge(V(3, 0, 0), V(3.4, 0.5, 0))
    const w = k.makeWire([e1, e2, e3, e4])
    line('makeWire(4 边扭面)', tryDo(() => w))
    const f = k.makeNonPlanarFace(w)
    line('makeNonPlanarFace(4 边) 返回非空', String(!!f))
    line('makeNonPlanarFace 面积', n(() => k.getSurfaceArea(f)))
    line('makeNonPlanarFace 子边数', n(() => k.getSubShapes(f, 'edge').length))
    // 平面 4 边（退化：三点共面）也应能成面
    const flat = polygonWire([V(0, 0, 0), V(2, 0, 0), V(2, 2, 0), V(0, 2, 0)])
    line('makeNonPlanarFace(平面 4 边) 面积（=4）', n(() => k.getSurfaceArea(k.makeNonPlanarFace(flat))))
    // 只有 3 边
    const tri = k.makeWire([
      k.makeLineEdge(V(0, 0, 0), V(2, 0, 1)),
      k.makeLineEdge(V(2, 0, 1), V(0, 2, 0)),
      k.makeLineEdge(V(0, 2, 0), V(0, 0, 0)),
    ])
    line('makeNonPlanarFace(3 边) 面积', n(() => k.getSurfaceArea(k.makeNonPlanarFace(tri))))
  },

  // ── 5：makeCylinder / chamfer（nut 的 hole 与倒角路径）──
  '5': () => {
    console.log('── 5: makeCylinder / chamfer / makeBoxFromCorners ──')
    const cyl = k.makeCylinder(3, 10)
    line('makeCylinder(3,10) volume（π·9·10=282.743）', n(() => k.getVolume(cyl)))
    const bb = k.getBoundingBox(cyl)
    line('makeCylinder bbox z', `${bb.zmin.toFixed(3)}→${bb.zmax.toFixed(3)}`)
    line('cut(box, cyl) volume（孔）', n(() => {
      const box = k.makeBox(10, 10, 4)
      const hole = k.makeCylinder(3, 20)
      return k.getVolume(k.cut(box, hole))
    }))
    // chamfer 需要边
    const box = k.makeBox(4, 4, 4)
    const edges = k.getSubShapes(box, 'edge')
    line('box(4³) 边数', String(edges.length))
    line('chamfer(box, 全部 12 边, 0.5) volume', n(() => k.getVolume(k.chamfer(box, edges, 0.5))))
    line('makeBoxFromCorners((0,0,0),(2,2,2)) volume', n(() => k.getVolume(k.makeBoxFromCorners(V(0, 0, 0), V(2, 2, 2)))))
    line('makeCylinder 是否在 XZ 平面法向可旋转（rotate 用 transform）', tryDo(() => k.rotateShape ? 'has rotateShape' : 'no rotateShape'))
  },

  // ── 6：细查 cut(box, cylinder)（段 5 的数与解析不符，须定位）──
  '6': () => {
    console.log('── 6: cut(box, cylinder) 细查 ──')
    const box = k.makeBox(10, 10, 4)
    const bbB = k.getBoundingBox(box)
    line('box(10,10,4) volume', n(() => k.getVolume(box)))
    line('box bbox', `${(bbB.xmax - bbB.xmin).toFixed(3)} × ${(bbB.ymax - bbB.ymin).toFixed(3)} × ${(bbB.zmax - bbB.zmin).toFixed(3)}`)
    const cyl = k.makeCylinder(3, 20)
    const bbC = k.getBoundingBox(cyl)
    line('cyl(3,20) volume', n(() => k.getVolume(cyl)))
    line('cyl bbox', `${(bbC.xmax - bbC.xmin).toFixed(3)} × ${(bbC.ymax - bbC.ymin).toFixed(3)} × ${(bbC.zmax - bbC.zmin).toFixed(3)} z=${bbC.zmin.toFixed(2)}→${bbC.zmax.toFixed(2)}`)
    line('cut(box, cyl) volume（期望 400−113.097=286.903）', n(() => k.getVolume(k.cut(box, cyl))))
    line('cut(box, cyl) bbox', (() => { const b = k.getBoundingBox(k.cut(box, cyl)); return `${(b.xmax - b.xmin).toFixed(3)} × ${(b.ymax - b.ymin).toFixed(3)} × ${(b.zmax - b.zmin).toFixed(3)} z=${b.zmin.toFixed(2)}→${b.zmax.toFixed(2)}` })())
    // 同高圆柱（z 0→4）
    line('cut(box, cyl(3,4)) volume', n(() => k.getVolume(k.cut(box, k.makeCylinder(3, 4)))))
    // 用 translate 把圆柱挪到 box 中心
    line('cut(box, translate(cyl,−5,−5,0)) volume', n(() => {
      const c2 = k.translate(k.makeCylinder(3, 4), -0.0, -0.0, 0.0)
      return k.getVolume(k.cut(box, c2))
    }))
    // 反过来
    line('cut(cyl, box) volume（期望 π·9·4=113.097）', n(() => k.getVolume(k.cut(cyl, box))))
    // 换个半径为 1 的圆柱（避开与 box 的角）
    line('cut(box, cyl(1,4)) volume（期望 400−12.566=387.434）', n(() => k.getVolume(k.cut(box, k.makeCylinder(1, 4)))))
    line('common(box, cyl(3,20)) volume（期望 113.097）', n(() => k.getVolume(k.common(box, cyl))))
  },

  // ── 7：revolve 的**拓扑**是 shell 不是 solid（W4 实测的最贵陷阱）──
  '7': () => {
    console.log('── 7: revolve 返回 shell（不是 solid）→ 布尔静默出错 ──')
    const sect = (h: BrepHandle, t: 'solid' | 'shell'): number => k.getSubShapes(h, t).length

    // (a) 简单实心柱：r=3 h=5（触轴轮廓）
    const solidWire = polygonWire([V(0, 0, 0), V(3, 0, 0), V(3, 0, 5), V(0, 0, 5)])
    const rev = k.revolve(solidWire, AXIS_Z, 2 * Math.PI)
    line('revolve(实心柱) solids / shells', `${sect(rev, 'solid')} / ${sect(rev, 'shell')}`)
    line('revolve(实心柱) getVolume（真值 π·9·5=141.372）', n(() => k.getVolume(rev)))
    const revSolid = k.makeSolid(rev)
    line('makeSolid(rev) solids / shells', `${sect(revSolid, 'solid')} / ${sect(revSolid, 'shell')}`)
    line('makeSolid(rev) getVolume', n(() => k.getVolume(revSolid)))
    // 对照：非 revolve 的构造原语给的是 solid
    line('makeCylinder(3,5) solids / shells', `${sect(k.makeCylinder(3, 5), 'solid')} / ${sect(k.makeCylinder(3, 5), 'shell')}`)
    const box0 = k.makeFace(rectWire(6, 6, 0))
    line('makeBox(6,6,5) solids / shells', `${sect(k.makeBox(6, 6, 5), 'solid')} / ${sect(k.makeBox(6, 6, 5), 'shell')}`)
    void box0

    // (b) 布尔：壳当操作数 → 静默给错体积；转 solid 后正常
    const box = k.translate(k.makeBox(40, 40, 40), -20, -20, -10) // 完全包含 rev
    line('common(revShell, 包含盒) volume（应=141.372）', n(() => k.getVolume(k.common(rev, box))))
    line('common(revShell, 包含盒) 结果 solids', String(sect(k.common(rev, box), 'solid')))
    line('common(revSolid, 包含盒) volume（应=141.372）', n(() => k.getVolume(k.common(revSolid, box))))
    line('common(revSolid, 包含盒) 结果 solids', String(sect(k.common(revSolid, box), 'solid')))
    line('fuse(revShell, 包含盒) volume', n(() => k.getVolume(k.fuse(rev, box))))

    // (c) nut 形态：六角 plan ∩ 倒角旋转体（M6-1 iso4032 的轮廓常数）
    const cs = ((11.547005383792515 - 10) * Math.tan(Math.PI / 12)) / 2
    const nutProfile = polygonWire([
      V(0, 0, 0), V(5, 0, 0), V(5.772502691896257, 0, cs),
      V(5.772502691896257, 0, 5.2 - cs), V(5, 0, 5.2), V(0, 0, 5.2),
    ])
    const hex: BrepVec3[] = []
    for (let i = 0; i < 6; i++) {
      const o = (2 * Math.PI * i) / 6
      hex.push(V((11.547005383792515 / 2) * Math.cos(o), (11.547005383792515 / 2) * Math.sin(o), 0))
    }
    const plan = k.extrude(k.makeFace(polygonWire(hex)), 0, 0, 5.2)
    const blank = k.cut(plan, k.translate(k.makeCylinder(3, 5.2), 0, 0, 0))
    const nutShell = k.revolve(nutProfile, AXIS_Z, 2 * Math.PI)
    const nutSolid = k.makeSolid(nutShell)
    line('nut: common(shell, blank) volume', n(() => k.getVolume(k.common(nutShell, blank))))
    line('nut: common(shell, blank) 结果 solids', String(sect(k.common(nutShell, blank), 'solid')))
    line('nut: common(solid, blank) volume（A 侧解析 302.297726）', n(() => k.getVolume(k.common(nutSolid, blank))))
    line('nut: common(solid, blank) 结果 solids', String(sect(k.common(nutSolid, blank), 'solid')))
  },

  // ── 8：短内螺纹的 GProps 求积混叠（W4 threaded nut 逐例容差 override 的证据）──
  '8': () => {
    console.log('── 8: threaded nut 的 GProps vs 三角化（两侧 STEP 导入同一内核）──')
    const dir = mkdtempSync(join(tmpdir(), 'w4-probe8-'))
    const aPath = join(dir, 'a.step')
    const bPath = join(dir, 'b.step')

    // (a) A 侧参考 STEP：manifest 里 `nut-hex-m6-iso4032-threaded` 的 step 文件名 = id + '.step'
    const ref = fileURLToPath(new URL('../fixtures/reference/nut-hex-m6-iso4032-threaded.step', import.meta.url))
    writeFileSync(aPath, readFileSync(ref))
    // (b) B 侧：本包同类构造（simple=false → 真实螺旋内螺纹）
    const r = hexNut({ size: 'M6-1', fastener_type: 'iso4032', simple: false })
    writeFileSync(bPath, Buffer.from(exportStepFromSolids(k, [{ solid: r.handle, name: 'SOLID' }])))

    const buf = (p: string): ArrayBuffer => {
      const b = readFileSync(p)
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
    }
    const a = k.importStep(buf(aPath))
    const b = k.importStep(buf(bPath))

    const mc = (h: BrepHandle): { v: number; c: [number, number, number] } => {
      const mesh = k.tessellate(h, {
        linearDeflection: MESH_LINEAR_DEFLECTION,
        angularDeflection: MESH_ANGULAR_DEFLECTION,
      })
      const p = mesh.positions
      const idx = mesh.indices
      let v = 0
      let cx = 0
      let cy = 0
      let cz = 0
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const ax = p[idx[t]! * 3]!
        const ay = p[idx[t]! * 3 + 1]!
        const az = p[idx[t]! * 3 + 2]!
        const bx = p[idx[t + 1]! * 3]!
        const by = p[idx[t + 1]! * 3 + 1]!
        const bz = p[idx[t + 1]! * 3 + 2]!
        const gx = p[idx[t + 2]! * 3]!
        const gy = p[idx[t + 2]! * 3 + 1]!
        const gz = p[idx[t + 2]! * 3 + 2]!
        const vt = (ax * (by * gz - bz * gy) - ay * (bx * gz - bz * gx) + az * (bx * gy - by * gx)) / 6
        v += vt
        cx += (vt * (ax + bx + gx)) / 4
        cy += (vt * (ay + by + gy)) / 4
        cz += (vt * (az + bz + gz)) / 4
      }
      return { v, c: [cx / v, cy / v, cz / v] }
    }

    const gA = volumeOf(a)
    const gB = volumeOf(b)
    const mA = mc(a)
    const mB = mc(b)
    const comDelta = (x: { c: [number, number, number] }, y: { c: [number, number, number] }): number =>
      Math.max(...x.c.map((v, i) => Math.abs(v - y.c[i]!)))

    line('GProps 体积 A / B', `${gA.toFixed(6)} / ${gB.toFixed(6)}  相对差 ${(Math.abs(gA - gB) / gA).toExponential(3)}`)
    line('三角化体积 A / B', `${mA.v.toFixed(6)} / ${mB.v.toFixed(6)}  相对差 ${(Math.abs(mA.v - mB.v) / mA.v).toExponential(3)}`)
    line('三角化质心最大差', comDelta(mA, mB).toExponential(3))
    line('GProps 自偏差 A / B', `${(Math.abs(gA - mA.v) / gA).toExponential(3)} / ${(Math.abs(gB - mB.v) / gB).toExponential(3)}`)

    // (c) 归因：混叠来自**螺纹面本身**而非与 nut 的融合 —— B 侧独立内螺纹
    //     M6×1 L=5.2 的自偏差应显著大于 A 侧 L=10 的螺纹用例。
    const th = isoThread({ major_diameter: 6, pitch: 1, length: 5.2, external: false, end_finishes: ['fade', 'fade'] })
    if (th.handle) {
      const gt = volumeOf(th.handle)
      const mt = mc(th.handle).v
      line('B 侧独立内螺纹 M6x1 L=5.2 GProps / mesh', `${gt.toFixed(6)} / ${mt.toFixed(6)}  自偏差 ${(Math.abs(gt - mt) / gt).toExponential(3)}`)
    }
  },
}

async function main(): Promise<void> {
  const wanted = process.argv.slice(2)
  await setupWarehouseKernel()
  k = requireKernel() as WarehouseKernel
  const keys = wanted.length ? wanted : Object.keys(SECTIONS)
  for (const key of keys) {
    const fn = SECTIONS[key]
    if (!fn) {
      console.log(`(unknown section ${key})`)
      continue
    }
    fn()
    console.log('')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
