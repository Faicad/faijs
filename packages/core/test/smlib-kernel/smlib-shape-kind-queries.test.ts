/**
 * smlib-shape-kind-queries — 句柄种类分派（包围盒）与点包含判定（node 直跑）
 *
 * 钉住的缺陷（2026-10-28，抽壳 `openFaces: "|Z"` 崩溃根因）：
 *
 * 1. `getBoundingBox` 曾对**任何**句柄都调 `SmApiBrepBoundingBox(const SmBrep*, …)`。
 *    内核把 solid / face / edge 的包围盒拆成三个独立 API（参数 ABI 相同、首参类型
 *    不同），把 `SmFace*` 喂 Brep 版就是 C++ 类型混淆。实测 20³ 盒的 6 个面：
 *    1 个面 wasm "memory access out of bounds" trap，其余返回**倒置盒**
 *    （zmin=20 / zmax=0）、**退化盒**（y 方向 0..0）或 **1e20 空盒哨兵**。
 *    修复：适配器登记借用面/边句柄（`getSubShapes` 即类型判别来源），按种类分派；
 *    未登记句柄显式抛错（绝不猜种类喂错 API）。
 *
 * 2. `containsPoint` 曾是 `unsupported` 桩（SMLib 无点分类 API）。而 CadQuery 面法向
 *    定向（`Face.normalAt()` 的 outward 探针）依赖它——没有它 `"|Z"` / `"#Z"` 整条
 *    方向选择器路径不可用。修复：三角化 + 射线奇偶（闭合流形）在适配层实现。
 *
 * GOTCHA（容易踩反的地方）：**smlib 的 `surfaceNormal` 不是外向法向**。它只反映
 * 曲面的构造朝向：基本体的 6 个面恰好都朝外，但抽壳/布尔产生的**内腔面**朝向与
 * 材料相反（实测 shell 内壁 x=2 给 −X，occt 给 +X）。所以"抽壳后法向/选择器错乱"
 * 不能靠读 surfaceNormal 修，必须走 containsPoint 定向 —— 这正是本文件第 3 个
 * describe 钉住的事实。
 *
 * Run: npx vitest run test/smlib-kernel/smlib-shape-kind-queries.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createSmlibPrimitives, type SmlibPrimitives } from '../../src/smlib-kernel/smlibKernel'
import type { BrepHandle } from '../../src/brep/engine/types'

let p: SmlibPrimitives
let box: BrepHandle
let faces: BrepHandle[]
let edges: BrepHandle[]

beforeAll(async () => {
  p = await createSmlibPrimitives()
  box = p.makeBox(20, 20, 20)
  faces = p.getSubShapes(box, 'face')
  edges = p.getSubShapes(box, 'edge')
}, 180000)

describe('getBoundingBox 按句柄种类分派', () => {
  it('solid：整体盒 = 20³', () => {
    const bb = p.getBoundingBox(box)
    expect(bb.xmax - bb.xmin).toBeCloseTo(20, 3)
    expect(bb.ymax - bb.ymin).toBeCloseTo(20, 3)
    expect(bb.zmax - bb.zmin).toBeCloseTo(20, 3)
  })

  it('face：6 个面各自退化为所在平面（修复前 1 个 trap、其余倒置/退化/1e20）', () => {
    expect(faces.length).toBe(6)
    // 盒子 6 个面：每个面的包围盒都在某个轴上退化（厚度 ≈ 0），另两轴 = 20。
    for (const f of faces) {
      const bb = p.getBoundingBox(f) // 修复前：其中一个面直接抛 wasm trap
      const ext = [bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin].sort((a, b) => a - b)
      expect(ext[0]!, '面在法向轴上退化').toBeLessThan(0.01)
      expect(ext[1]!, '面在切向轴 1 上跨满 20').toBeCloseTo(20, 2)
      expect(ext[2]!, '面在切向轴 2 上跨满 20').toBeCloseTo(20, 2)
      // 绝不出现倒置盒或 1e20 空盒哨兵（修复前的垃圾输出特征）
      expect(bb.xmax).toBeGreaterThanOrEqual(bb.xmin)
      expect(bb.ymax).toBeGreaterThanOrEqual(bb.ymin)
      expect(bb.zmax).toBeGreaterThanOrEqual(bb.zmin)
      expect(Math.abs(bb.xmin)).toBeLessThan(1000)
      expect(Math.abs(bb.zmax)).toBeLessThan(1000)
    }
  })

  it('edge：12 条棱边、每条在一条轴上长度 20', () => {
    expect(edges.length).toBe(12)
    for (const e of edges) {
      const bb = p.getBoundingBox(e)
      const ext = [bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin]
      const maxExt = Math.max(...ext)
      expect(maxExt, '棱边长度 = 20').toBeCloseTo(20, 2)
      expect(ext.filter((x) => x < 0.01).length, '棱边在另两轴退化').toBe(2)
    }
  })

  it('多种形状的面/边包围盒全部可算且不 trap、不产垃圾盒（回归网）', () => {
    const shapes = [p.makeBox(4, 4, 4), p.makeCylinder(5, 12), p.makeSphere(6)]
    for (const s of shapes) {
      for (const f of p.getSubShapes(s, 'face')) {
        const bb = p.getBoundingBox(f) // 修复前：部分面 wasm trap
        expect(bb.xmax).toBeGreaterThanOrEqual(bb.xmin)
        expect(bb.ymax).toBeGreaterThanOrEqual(bb.ymin)
        expect(bb.zmax).toBeGreaterThanOrEqual(bb.zmin)
        expect(Math.max(Math.abs(bb.xmin), Math.abs(bb.xmax))).toBeLessThan(1000)
      }
      for (const e of p.getSubShapes(s, 'edge')) {
        const bb = p.getBoundingBox(e)
        expect(bb.xmax).toBeGreaterThanOrEqual(bb.xmin)
        expect(bb.zmax).toBeGreaterThanOrEqual(bb.zmin)
      }
    }
  })
})

describe('containsPoint（三角化 + 射线奇偶）', () => {
  it('盒内/盒外/盒面上', () => {
    expect(p.containsPoint(box, { x: 10, y: 10, z: 10 }, 1e-9)).toBe(true)
    expect(p.containsPoint(box, { x: 1, y: 1, z: 1 }, 1e-9)).toBe(true)
    expect(p.containsPoint(box, { x: -1, y: 10, z: 10 }, 1e-9)).toBe(false)
    expect(p.containsPoint(box, { x: 10, y: 10, z: 25 }, 1e-9)).toBe(false)
    // 贴面外侧 ε：与 occt/brepkit 同口径（ε 出界即外部）
    expect(p.containsPoint(box, { x: 10, y: 10, z: 20.001 }, 1e-9)).toBe(false)
  })

  it('抽壳结果：壁内是"内"，内腔是"外"', () => {
    // 去顶面抽壳（20³，壁厚 2）：腔 = x,y∈[2,18]、z∈[2,20]
    let top = faces[0]!
    let best = -Infinity
    for (const f of faces) {
      const c = p.surfaceCenterOfMass(f)
      if (c.z > best) { best = c.z; top = f }
    }
    const shelled = p.shell(box, [top], 2, 1e-6)
    expect(p.getVolume(shelled)).toBeCloseTo(3392, 3)

    expect(p.containsPoint(shelled, { x: 1, y: 10, z: 10 }, 1e-9), '侧壁内').toBe(true)
    expect(p.containsPoint(shelled, { x: 10, y: 10, z: 1 }, 1e-9), '底壁内').toBe(true)
    expect(p.containsPoint(shelled, { x: 10, y: 10, z: 10 }, 1e-9), '内腔（空）').toBe(false)
    expect(p.containsPoint(shelled, { x: 2.5, y: 10, z: 10 }, 1e-9), '内腔贴内壁').toBe(false)
  })

  it('面/边句柄：显式失败（无"包含"语义，不猜）', () => {
    expect(() => p.containsPoint(faces[0]!, { x: 10, y: 10, z: 10 }, 1e-9)).toThrow(/only solid handles/)
  })
})

describe('GOTCHA：surfaceNormal 不是外向法向（内腔面朝向与材料相反）', () => {
  it('基本体外表面恰好朝外；抽壳内腔面朝材料', () => {
    const normalAtMid = (f: BrepHandle) => {
      const uv = p.uvBounds(f)
      return p.surfaceNormal(f, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2)
    }
    // 外表面：法向朝外（+Z 面 z=10 → n·z > 0）
    for (const f of faces) {
      const c = p.surfaceCenterOfMass(f)
      const n = normalAtMid(f)
      const dot = n.x * (c.x - 10) + n.y * (c.y - 10) + n.z * (c.z - 0)
      expect(dot, '基本体外表面法向朝外').toBeGreaterThanOrEqual(-1e-9)
    }
    // 内腔面：x=2 内壁的法向在 smlib 上是 −X（朝材料），occt 给 +X（朝腔内）。
    // 所以外向定向**必须**走 containsPoint 探针，不能直接信 surfaceNormal。
    let top = faces[0]!
    let best = -Infinity
    for (const f of faces) {
      const c = p.surfaceCenterOfMass(f)
      if (c.z > best) { best = c.z; top = f }
    }
    const shelled = p.shell(box, [top], 2, 1e-6)
    const inner = p.getSubShapes(shelled, 'face').filter((f) => {
      const c = p.surfaceCenterOfMass(f)
      return Math.abs(c.x - 2) < 1e-6 && Math.abs(c.z - 11) < 5
    })
    expect(inner.length, 'x=2 内壁存在且唯一').toBe(1)
    const n = normalAtMid(inner[0]!)
    expect(n.x, 'smlib 内壁表面法向朝材料（−X）').toBeLessThan(-0.99)
    // 但 containsPoint 探针能把它纠正为朝腔（+X）：这就是 orientedFaceNormal 的做法
    const probe = { x: 2 - 0.01, y: 10, z: 11 }
    expect(p.containsPoint(shelled, probe, 1e-9), '沿 −X 探针落在材料内 ⇒ 需翻转').toBe(true)
  })
})
