/**
 * brepkit-kernel/brepkitKernel.test — brepkit 适配器几何单测（node 直跑 wasm）
 *
 * AGENTS.md 流程第 2 步：先写单测验证几何层无错误，再落地实现。
 * 断言口径：体积/bbox/面组数按解析值容差对齐；拓扑分组必须完整覆盖三角形。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { createBrepkitPrimitives, disposeBrepkit, type BrepkitPrimitives } from './brepkitKernel'

// GOTCHA: brepkit-wasm 是有意的可选运行时注入（非声明依赖，见 brepkitWasm.ts 注释）——
// 未安装时套件必须整体 skip 而非 suite FAIL。但探测须在收集期同步完成：
// describe.skipIf 的条件在收集时求值，不能依赖 beforeAll 的异步结果（那时条件恒为 false）。
// 装了但初始化失败（真 bug）时 beforeAll 重新抛错，如实 FAIL，不静默掩盖。
const require = createRequire(import.meta.url)
let brepkitAvailable = false
try {
  require.resolve('brepkit-wasm')
  brepkitAvailable = true
} catch {
  brepkitAvailable = false
}

let api!: BrepkitPrimitives

beforeAll(async () => {
  try {
    api = await createBrepkitPrimitives()
  } catch (e) {
    // 未安装 → 套件 skip；已安装但初始化失败 → 原样抛出暴露。
    if (brepkitAvailable) throw e
  }
})

afterAll(() => {
  disposeBrepkit()
})

const EPS = 1e-3

const suite = describe.skipIf(!brepkitAvailable)

suite('brepkit 基本体', () => {
  it('makeBox 体积与 bbox 解析值一致（10×20×30 = 6000）', () => {
    const h = api.makeBox(10, 20, 30)
    expect(h).toBeGreaterThanOrEqual(0)
    const v = api.getVolume(h)
    expect(Math.abs(v - 6000)).toBeLessThan(0.5)
    const bb = api.getBoundingBox(h)
    expect(Math.abs((bb.xmax - bb.xmin) - 10)).toBeLessThan(EPS)
    expect(Math.abs((bb.ymax - bb.ymin) - 20)).toBeLessThan(EPS)
    expect(Math.abs((bb.zmax - bb.zmin) - 30)).toBeLessThan(EPS)
  })

  it('makeCylinder 体积 πr²h（r=5 h=10 → 250π）', () => {
    const h = api.makeCylinder(5, 10)
    const v = api.getVolume(h)
    expect(Math.abs(v - 250 * Math.PI)).toBeLessThan(0.5)
  })

  it('makeSphere 体积 4/3πr³（r=5）', () => {
    const h = api.makeSphere(5)
    const v = api.getVolume(h)
    expect(Math.abs(v - (4 / 3) * Math.PI * 125)).toBeLessThan(0.5)
  })
})

suite('brepkit 三角化（拓扑红线：几何与拓扑同源）', () => {
  it('meshShape 返回 positions/indices/faceGroups 且 faceGroups 完整覆盖三角形', () => {
    const h = api.makeBox(10, 20, 30)
    const m = api.meshShape(h, { linearDeflection: 0.5 })
    expect(m.vertexCount).toBeGreaterThan(0)
    expect(m.triangleCount).toBeGreaterThan(0)
    expect(m.positions.length).toBe(m.vertexCount * 3)
    expect(m.indices.length).toBe(m.triangleCount * 3)
    // 长方体恰 6 个面组
    expect(m.faceCount).toBe(6)
    expect(m.faceGroups!.length).toBe(6 * 3)
    // faceGroups 三元组 [start, count, hash]：start 单调递增、覆盖全部三角形
    const fg = m.faceGroups!
    expect(fg[0]).toBe(0)
    for (let i = 3; i < fg.length; i += 3) {
      expect(fg[i]).toBeGreaterThanOrEqual(fg[i - 3] + fg[i - 2])
    }
    expect(fg[fg.length - 3] + fg[fg.length - 2]).toBe(m.triangleCount)
  })

  it('wireframe 返回边折线（长方体 12 条边）', () => {
    const h = api.makeBox(10, 20, 30)
    const w = api.wireframe(h)
    expect(w.edgeCount).toBe(12)
    expect(w.points.length).toBeGreaterThan(0)
    expect(w.edgeGroups.length).toBe(12 * 3)
  })
})

suite('brepkit 布尔与面溯源', () => {
  it('cut：长方体切穿心圆柱，体积 = 1000 − 90π（圆柱 z 居中全贯穿）', () => {
    const box = api.makeBox(10, 10, 10)
    const cyl = api.makeCylinder(3, 20)
    // 圆柱默认 z 0..20；平移 (5,5,-5) 后 z -5..15，恰好对盒 z 0..10 全贯穿
    const moved = api.translate(cyl, 5, 5, -5)
    const r = api.cut(box, moved)
    const v = api.getVolume(r)
    expect(Math.abs(v - (1000 - 90 * Math.PI))).toBeLessThan(0.5)
  })

  it('fuse：两盒合并体积 = 相加（不重叠）', () => {
    const a = api.makeBox(10, 10, 10)
    const b = api.translate(api.makeBox(10, 10, 10), 10, 0, 0)
    const r = api.fuse(a, b)
    expect(Math.abs(api.getVolume(r) - 2000)).toBeLessThan(0.5)
  })

  it('fuseWithHistory 返回 evolution 数据（result + 数组字段）', () => {
    const a = api.makeBox(10, 10, 10)
    const b = api.translate(api.makeBox(10, 10, 10), 10, 0, 0)
    const hashU = 100000
    const ha = api.subShapeHashes(a, 'face', hashU)
    const evo = api.fuseWithHistory(a, b, ha, hashU)
    expect(evo.result).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(evo.modified)).toBe(true)
    expect(Array.isArray(evo.generated)).toBe(true)
    expect(Array.isArray(evo.deleted)).toBe(true)
  })

  it('fillet：长方体 4 条竖边倒圆角后体积变化', () => {
    const box = api.makeBox(10, 10, 10)
    const edges = api.getSubShapes(box, 'edge')
    expect(edges.length).toBe(12)
    const v0 = api.getVolume(box)
    const r = api.fillet(box, edges, 1)
    const v1 = api.getVolume(r)
    expect(v1).toBeLessThan(v0)
    expect(v1).toBeGreaterThan(v0 - 100)
  })
})

suite('brepkit 变换与查询', () => {
  it('translate 后 bbox 平移', () => {
    const h = api.makeBox(10, 10, 10)
    const moved = api.translate(h, 100, 0, 0)
    const bb = api.getBoundingBox(moved)
    expect(Math.abs(bb.xmin - 100)).toBeLessThan(EPS)
    expect(Math.abs(bb.xmax - 110)).toBeLessThan(EPS)
  })

  it('isSame / hashCode / subShapeHashes 基本契约', () => {
    const a = api.makeBox(10, 10, 10)
    expect(api.isSame(a, a)).toBe(true)
    expect(api.isSolid(a)).toBe(true)
    const faces = api.subShapeHashes(a, 'face', 100000)
    expect(faces.length).toBe(6)
    expect(new Set(faces).size).toBe(6) // 6 个面 hash 互异
  })

  it('surfaceType 识别平面', () => {
    const box = api.makeBox(10, 10, 10)
    const faces = api.getSubShapes(box, 'face')
    expect(faces.length).toBe(6)
    for (const f of faces) {
      expect(api.surfaceType(f)).toMatch(/plane/i)
    }
  })
})

suite('brepkit IO', () => {
  it('exportStep 产出含 MANIFOLD_SOLID_BREP 的 STEP 文本', () => {
    const h = api.makeBox(10, 10, 10)
    const step = api.exportStep(h)
    expect(step).toContain('MANIFOLD_SOLID_BREP')
  })
})

suite('brepkit 几何求值（Float64Array 返回归一化，2026-09-19 修复）', () => {
  // 回归：这些方法曾误以为返回 JSON 字符串而 JSON.parse，实际返回 Float64Array，
  // String(Float64Array) 变逗号拼接数字串导致 JSON.parse 在第一个逗号处崩溃。
  it('uvBounds 不抛错且返回有限值', () => {
    const h = api.makeBox(10, 10, 10)
    const face = api.getSubShapes(h, 'face')[0]
    const b = api.uvBounds(face)
    expect(Number.isFinite(b.uMin)).toBe(true)
    expect(Number.isFinite(b.uMax)).toBe(true)
    expect(b.uMax).toBeGreaterThan(b.uMin)
  })
  it('pointOnSurface / surfaceNormal 返回有限 vec3', () => {
    const h = api.makeBox(10, 10, 10)
    const face = api.getSubShapes(h, 'face')[0]
    const p = api.pointOnSurface(face, 0.5, 0.5)
    expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true)
    const n = api.surfaceNormal(face, 0.5, 0.5)
    expect([n.x, n.y, n.z].every(Number.isFinite)).toBe(true)
    // 法向量单位长度
    const len = Math.hypot(n.x, n.y, n.z)
    expect(Math.abs(len - 1)).toBeLessThan(0.01)
  })
  it('curveParameters / curvePointAtParam / curveTangent 不抛错', () => {
    const h = api.makeBox(10, 10, 10)
    const edge = api.getSubShapes(h, 'edge')[0]
    const range = api.curveParameters(edge)
    expect(Number.isFinite(range.first)).toBe(true)
    expect(Number.isFinite(range.last)).toBe(true)
    const mid = (range.first + range.last) / 2
    const p = api.curvePointAtParam(edge, mid)
    expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true)
    const t = api.curveTangent(edge, mid)
    expect([t.x, t.y, t.z].every(Number.isFinite)).toBe(true)
  })
  it('getCenterOfMass 长方体质心在原点', () => {
    const h = api.makeBox(10, 10, 10)
    const c = api.getCenterOfMass(h)
    // makeBox 角在 (0,0,0)，质心在 (5,5,5)
    expect(Math.abs(c.x - 5)).toBeLessThan(0.5)
    expect(Math.abs(c.y - 5)).toBeLessThan(0.5)
    expect(Math.abs(c.z - 5)).toBeLessThan(0.5)
  })
})

suite('brepkit 网格布尔回退检测（§5.4 链纪律）', () => {
  it('v1 白名单操作不触发 meshFallback（计数差为 0）', () => {
    const a = api.makeBox(10, 10, 10)
    const b = api.translate(api.makeCylinder(3, 20), 5, 5, 0)
    api.cut(a, b)
    // 白名单操作后不应有回退（fallback 计数 API 存在时）
    expect(api.getMeshFallbackCount()).toBe(0)
  })
})
