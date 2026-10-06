/**
 * mesh-solid-topology — 网格实体（STL → 近似拓扑）的规范构造与可用性
 *
 * 为什么必须钉住（AGENTS.md「与预期不一致的 API 用法必须留档为测试」）：
 * 本方案（docs/plans/2026-10-01-mesh-solid-brepkit-mesh-ops-and-approximate-topology.md）
 * 的全部下游能力（对识别出的边倒圆角、在识别出的平面上拉伸）都建立在一条**唯一的**
 * 网格实体构造顺序上：
 *
 *     importStl → weldShellsAndFaces(tol) → unifyFaces()
 *
 * 这三个调用的顺序**不可交换**，且每一步的中间态都有反直觉行为：
 *
 * | 状态 | 面 | 边 | validate | fillet |
 * |---|---|---|---|---|
 * | `importStl` 直出 | 12 | 36（每条三角形边各占一条） | 1（不合法） | 0/36 全拒绝 |
 * | `+ unifyFaces`（**跳过 weld**） | 6 | 36 | 1 | 体积归零 → **实体已损坏** |
 * | `+ weldShellsAndFaces` | 12 | 18（边被缝成共享边） | 0（合法） | 可用 |
 * | `+ weld → unify` | 6 | 12 | 0 | 12/12 成功 |
 *
 * 这些结论无法从 API 名字推出，且内核版本升级可能悄悄改变它们——故固化为防回归测试。
 * 校验用「跨内核版本稳定」的观测量：面/边/顶点计数、`validateSolid` 返回值、
 * `volume`，以及 fillet 是否整体成功（不以磨圆后的面数为准）。
 *
 * 另一个实测方言（2026-10-01）：`unifyFaces(solid)` 是**原地修改**，返回值是
 * **被合并的面数**（不是新句柄）——写成 `const s = unifyFaces(s)` 会拿到一个
 * 恰好落在合法句柄区间里的数字，后续全部查询打在一个**无关实体**上且不报错。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createBrepkitPrimitives, disposeBrepkit, getBrepkitKernel, type BrepkitPrimitives } from '../../src/brepkit-kernel/brepkitKernel'

/** STL 焊接容差：与模型尺度绑定（10mm 盒用 1e-4），不写死极小值。 */
const WELD_TOL = 1e-4

interface RawSolid {
  /** brepkit 内核裸句柄（**不是** faijs BrepHandle——本文件的另两条轴不涉及句柄标签）。 */
  handle: number
  faces: number
  edges: number
  vertices: number
  volume: number
  validate: number
}

describe('mesh solid：STL → 规范化 → 近似拓扑可用', () => {
  let api: BrepkitPrimitives
  let k: ReturnType<typeof getBrepkitKernel>
  beforeAll(async () => { api = await createBrepkitPrimitives(); k = getBrepkitKernel() })
  afterAll(() => { disposeBrepkit() })

  const describeRaw = (handle: number): RawSolid => ({
    handle,
    faces: (Array.from(k.getSolidFaces(handle)) as number[]).length,
    edges: (Array.from(k.getSolidEdges(handle)) as number[]).length,
    vertices: (Array.from(k.getSolidVertices(handle)) as number[]).length,
    volume: Number(k.volume(handle, 0.05)),
    validate: Number(k.validateSolid(handle)),
  })

  const solidEdges = (handle: number): number[] => Array.from(k.getSolidEdges(handle)) as number[]

  describe('立方体 STL（10×10×10）', () => {
    /** 由 brepkit 自己导出 STL 再导入——不依赖任何外部 fixture 文件。 */
    const boxStl = (): Uint8Array => {
      const box = k.makeBox(10, 10, 10)
      return new Uint8Array(k.exportStl(box, 0.1))
    }

    it('importStl 直出：逐三角形成面、边不共享、严格校验不过、fillet 全拒绝', () => {
      const raw = describeRaw(k.importStl(boxStl()))
      // 每个三角形一张平面面 → 12 面；棱被拆成两条独立边 → 36 条
      expect(raw.faces).toBe(12)
      expect(raw.edges).toBe(36)
      expect(raw.vertices).toBe(8)
      // 体积已正确（顶点已按坐标焊过），但拓扑不合法
      expect(raw.volume).toBeCloseTo(1000, 3)
      expect(raw.validate).not.toBe(0)
      // 「no manifold edges」→ 内核拒绝倒圆角（这是「STL 直出不可用」的判据）
      expect(() => k.fillet(raw.handle, Uint32Array.from(solidEdges(raw.handle)), 1)).toThrow()
    })

    it('weldShellsAndFaces：边被缝成共享边（36→18），严格校验通过', () => {
      const raw = k.importStl(boxStl())
      const welded = k.weldShellsAndFaces(Uint32Array.from(Array.from(k.getSolidFaces(raw)) as number[]), WELD_TOL)
      const w = describeRaw(welded)
      expect(w.faces).toBe(12)
      // 棱两侧的重复边被缝成一条 → 12 条棱 + 每个面 2 条对角线（面仍未被合并）
      expect(w.edges).toBe(18)
      expect(w.vertices).toBe(8)
      expect(w.volume).toBeCloseTo(1000, 3)
      expect(w.validate).toBe(0)
    })

    it('GOTCHA：先 unifyFaces 后 weld 会损坏实体（体积归零）——顺序不可交换', () => {
      const raw = k.importStl(boxStl())
      // 错误顺序：不 weld 直接 unify（原地修改）
      k.unifyFaces(raw)
      const c = describeRaw(raw)
      // 面确实被合并了（12→6），看起来「成功」——但体积归零，实体已经废了。
      // 这正是当初误判「unify 就够了」的原因，故必须固化为防回归用例。
      expect(c.faces).toBe(6)
      expect(c.volume).toBeLessThan(1)
      expect(c.validate).not.toBe(0)
    })

    it('weld → unify：共面三角形合并成 6 个平面面、12 条边，fillet 12/12 成功', () => {
      const raw = k.importStl(boxStl())
      const welded = k.weldShellsAndFaces(Uint32Array.from(Array.from(k.getSolidFaces(raw)) as number[]), WELD_TOL)
      // unifyFaces 原地修改，**返回值是合并掉的面数**（6 = 12 面合并成 6 面），不是句柄
      expect(Number(k.unifyFaces(welded))).toBe(6)
      const u = describeRaw(welded)
      expect(u.faces).toBe(6)
      expect(u.edges).toBe(12)
      expect(u.vertices).toBe(8)
      expect(u.volume).toBeCloseTo(1000, 3)
      expect(u.validate).toBe(0)
      // 全部 12 条识别边可倒圆角（半径 1 < 最短棱 10/2）
      expect(() => k.fillet(welded, Uint32Array.from(solidEdges(welded)), 1)).not.toThrow()
    })

    it('规范化后的网格实体产出可用近似拓扑（面行/边行齐全，6 面 12 边）', () => {
      const raw = k.importStl(boxStl())
      const welded = k.weldShellsAndFaces(Uint32Array.from(Array.from(k.getSolidFaces(raw)) as number[]), WELD_TOL)
      k.unifyFaces(welded)
      // 经 L1 契约面（faijs 适配器）读取——句柄走 asHandle（solid 类，无类型标签）
      const solid = welded as never
      const mesh = api.meshShape(solid, { linearDeflection: 0.1, angularDeflection: 0.2 })
      expect(mesh.faceCount).toBe(6)
      expect(mesh.triangleCount).toBe(12)
      for (let i = 0; i < mesh.faceGroups!.length; i += 3) {
        expect(mesh.faceGroups![i + 1]! / 3).toBe(2) // 每个平面面 2 个三角形
      }
      expect(api.getSubShapes(solid, 'face').length).toBe(6)
      expect(api.getSubShapes(solid, 'edge').length).toBe(12)
      // 12 条边必须拿到 12 个互不相同的 hash（重复会把折线塌成一条）
      const edgeHashes = api.getSubShapes(solid, 'edge').map((e) => api.hashCode(e, 2147483647))
      expect(new Set(edgeHashes).size).toBe(12)
    })
  })

  describe('圆柱 STL（r=10, h=30）：曲面不还原，只是面片簇', () => {
    const cylStl = (): Uint8Array => {
      const cyl = k.makeCylinder(10, 30)
      return new Uint8Array(k.exportStl(cyl, 0.05))
    }

    it('weld → unify 后 34 个面（32 个侧面四边形 + 2 个端盖），逐条边可倒圆角', () => {
      const raw = k.importStl(cylStl())
      const rawInfo = describeRaw(raw)
      expect(rawInfo.faces).toBe(124) // 三角面片簇：124 个三角形面
      expect(rawInfo.validate).not.toBe(0)
      const welded = k.weldShellsAndFaces(Uint32Array.from(Array.from(k.getSolidFaces(raw)) as number[]), WELD_TOL)
      k.unifyFaces(welded)
      const u = describeRaw(welded)
      // 近似拓扑的如实结论：侧面 32 个四边形 + 上下端盖各 1 个面 = 34。
      // **不会**变成 1 张圆柱面（brepkit 不做曲面拟合，见方案 §2.3）。
      expect(u.faces).toBe(34)
      expect(u.edges).toBe(96) // 32 条竖向棱 + 两个端盖各 32 条边
      expect(u.vertices).toBe(64)
      expect(u.validate).toBe(0)
      // 体积 = 内接 32 边形棱柱（不是精确 πr²h，差 ≈0.64%）：这是「曲面只是面片近似」的量化证据。
      const n = 32
      const polygonalPrism = 0.5 * n * 100 * Math.sin((2 * Math.PI) / n) * 30
      expect(u.volume).toBeCloseTo(polygonalPrism, 0)

      // GOTCHA（2026-10-01 实测）：**逐条边**倒圆角 96/96 全部成功；但把 96 条边
      // **一次性**交给内核会被整体拒绝（"no fillet engine produced a changed, closed,
      // outward-oriented result"）——端盖那 64 条共面边链一次性磨圆会自交。
      // 故 mesh op 的 fillet 必须支持"逐边/分批"实现，或在一次请求里如实失败。
      const edges = solidEdges(welded)
      let ok = 0
      for (const e of edges) {
        try { k.fillet(welded, Uint32Array.from([e]), 1); ok++ } catch { /* 该边不可倒 */ }
      }
      expect(ok).toBe(96)
      expect(() => k.fillet(welded, Uint32Array.from(edges), 1)).toThrow()
    })
  })
})
