/**
 * kernel-pitfalls.test.ts — 「最初理解是错的」守卫测试集（内核级）。
 *
 * 存在理由：W3 期间大量发现是靠**临时探针脚本**得到的（`makeWire` 乱序丢边、
 * `getVolume` 对螺旋面求积混叠、`cut` 近重合单向失败……）。临时脚本用完即删，
 * 后人重蹈覆辙。本文件把这些发现固化成**永久回归锁**：每条用例的标题就是
 * 「错误认知 → 实测真相」，断言红 = 有人（或内核升级）又踩回去了。
 *
 * 数据来源：`scripts/kernel-pitfalls-probe.ts`（可复跑重采样，只打印不 assert）。
 * 相关分析：docs/analysis/2026-09-14-cq-warehouse-thread-probe.md、
 *           docs/analysis/2026-09-14-cq-warehouse-kernel-probe.md。
 *
 * ⚠️ 与 `kernel-conformance.test.ts` 的分工：
 *   - conformance = 「成员在不在、签名对不对」（正向契约）；
 *   - 本文件 = 「行为是否反直觉」（反向认知陷阱）。
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { BrepHandle } from '@faicad/faijs-core'
import { requireKernel, type WarehouseKernel } from './kernel'
import { setupWarehouseKernel } from './test-setup'
import { circleWireXY, circleWireXZ, closeLoop, meshVolume, orientOutward, polygonWire } from './primitives'
import { isoThread } from './thread'
import { V, boxFaces, degeneratePolygonWire, squareEdges } from './testing/pitfall-fixtures'

let k: WarehouseKernel

beforeAll(async () => {
  await setupWarehouseKernel()
  k = requireKernel() as WarehouseKernel
})

const edgeCount = (w: BrepHandle): number => k.getSubShapes(w, 'edge').length

/** 异步 execFile —— 子进程跑，**不阻塞** vitest worker 的事件循环。 */
const runProbe = promisify(execFile)
/** 复现台脚本路径与本包目录（cwd 供子进程解析 `tsx` 加载器）。 */
const PROBE_SCRIPT = fileURLToPath(new URL('../scripts/kernel-pitfalls-probe.ts', import.meta.url))
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))

/**
 * 在**子进程**里跑探针的某一段，取回其机读 JSON 输出。
 *
 * 为什么必须走子进程：近重合 B 样条布尔单次实测 **55–61s**，已逼近/超过 vitest
 * worker 的 `onTaskUpdate` RPC 超时（birpc 固定 6e4 ms，**不可配置**；过期的超时定时器
 * 会在下一轮事件循环的 timers 阶段先于 port 消息触发，故 `setImmediate` 之类让出无用）。
 * 放进子进程后 worker 全程 `await` I/O，事件循环不被阻塞，该超时无从触发。
 * @param section - 探针段号（如 `'4j'`）。
 * @returns 该段打印的 JSON 对象。
 */
async function runProbeSection<T>(section: string): Promise<T> {
  const { stdout } = await runProbe(process.execPath, ['--import', 'tsx', PROBE_SCRIPT, section], {
    cwd: PACKAGE_DIR,
    timeout: 300_000,
  })
  const line = stdout.trim().split('\n').filter(Boolean).at(-1)
  if (line === undefined) throw new Error(`probe section ${section} produced no output`)
  return JSON.parse(line) as T
}

/** 惰性缓存的 raw/raw 螺纹体（M6×1×10，两端 raw）——多次复用，避免重复构体。 */
let rawSolidCache: BrepHandle | null = null
function rawSolid(): BrepHandle {
  if (!rawSolidCache)
    rawSolidCache = isoThread({
      major_diameter: 6,
      pitch: 1,
      length: 10,
      end_finishes: ['raw', 'raw'],
    }).handle!
  return rawSolidCache
}

describe('陷阱 1：makeWire 不校验连通性（乱序喂边会静默丢边，且不抛错）', () => {
  it('顺序喂 4 边 → 4 条；乱序喂 → 静默掉 1 条、无异常', () => {
    const { A, B, C, D } = squareEdges(k)
    // 错误认知：以为 makeWire 会把边排好、或有缺口就抛错（上游 assembleEdges 的 List 语义）
    expect(edgeCount(k.makeWire([A, B, C, D])), '顺序相接 → 全保留').toBe(4)

    // 实测真相：内核是**逐边**语义——接不上当前开口端的边被静默丢弃。
    // 这正是 cq-compat phase2 记录的「4 边入 → 3 边出」
    //（docs/plans/2026-09-08-cq-compat-parity-phase2.md，那边用 reorderForWireAssembly 兜住）。
    expect(() => k.makeWire([A, C, B, D]), '丢边不抛错').not.toThrow()
    expect(edgeCount(k.makeWire([A, C, B, D])), '[A,C,B,D] → 3').toBe(3)
    expect(edgeCount(k.makeWire([C, A, B, D])), '[C,A,B,D] → 3').toBe(3)
    expect(edgeCount(k.makeWire([A, B, D, C])), '[A,B,D,C] 恰好都能接上 → 4').toBe(4)
  })

  it('触发条件是「接不上当前开口端」，不是「一律丢弃」——完全悬空的边反而被保留', () => {
    const e1 = k.makeLineEdge(V(0, 0, 0), V(1, 0, 0))
    const e2 = k.makeLineEdge(V(1, 0, 0), V(1, 1, 0))
    const e3 = k.makeLineEdge(V(5, 5, 0), V(6, 5, 0)) // 与前者完全不接触
    expect(edgeCount(k.makeWire([e1, e2, e3])), '喂 3 条（e3 悬空）→ 仍 3 条').toBe(3)
    expect(edgeCount(k.makeWire([e1, e3])), '两条互不接触 → 2 条').toBe(2)
  })

  it('重复边被去重（不是简单累加）', () => {
    const e1 = k.makeLineEdge(V(0, 0, 0), V(1, 0, 0))
    const e2 = k.makeLineEdge(V(1, 0, 0), V(1, 1, 0))
    expect(edgeCount(k.makeWire([e1, e2, e1]))).toBe(2)
  })
})

describe('陷阱 2：sew 出的闭壳 makeSolid 后朝向朝内（vol 为负）', () => {
  it('平面闭壳 1e-6..1e-3 均能缝成单壳，但 makeSolid 体积是 −8（必须 orientOutward 翻正）', () => {
    const faces = boxFaces(k, 2)
    for (const tol of [1e-6, 1e-3]) {
      const shell = k.sew(faces, tol)
      // ⚠️ 订正旧注释：平面壳在 1e-6 下**照常缝合**（并非「1e-6 完全不缝合」）。
      expect(k.getSubShapes(shell, 'shell').length, `sew(tol=${tol}) 单壳`).toBe(1)
      // 错误认知：以为 sew + makeSolid 直接给出朝外实体。
      expect(k.getVolume(k.makeSolid(shell)), `tol=${tol} 朝向为负`).toBeCloseTo(-8, 3)
      // 真相：必须翻正（primitives.orientOutward / solidFromFaces 已内建）。
      expect(k.getVolume(orientOutward(k.makeSolid(shell))), `tol=${tol} 翻正后 +8`).toBeCloseTo(8, 3)
    }
  })
})

describe('陷阱 3：getVolume(BRepGProp) 对螺旋 B 样条面求积混叠 —— mesh 才是真值', () => {
  it('raw/raw 螺纹体：GProps 与三角化体积差 >10%（端部为平面则不混叠）', () => {
    const h = rawSolid()
    const gprops = k.getVolume(h) // 先量 GProps —— 别被三角化影响（见陷阱 7/8 的 bbox 污染）
    const mesh = meshVolume(h)
    expect(mesh, '三角化体积为正').toBeGreaterThan(0)
    // 错误认知：以为 getVolume 是可靠真值（W3 最初就拿它当基准）。
    // 实测：raw/raw GProps=49.961599 vs mesh=43.680666 → 相对差 14.379%
    //（A 侧 Python/OCCT 同源：49.961532 / 43.680000）。
    expect(Math.abs(gprops - mesh) / mesh, '螺旋面混叠 >10%').toBeGreaterThan(0.1)

    // 对照：端部是**平面**（square/square）时不混叠 —— 证明锅在螺旋 B 样条面，不在内核本身。
    const sq = isoThread({
      major_diameter: 6,
      pitch: 1,
      length: 10,
      end_finishes: ['square', 'square'],
    }).handle!
    const g2 = k.getVolume(sq)
    const m2 = meshVolume(sq)
    expect(Math.abs(g2 - m2) / m2, '平面端不混叠 <0.1%').toBeLessThan(0.001)
  })

  it('三角化体积对 deflection 收敛（GProps 不收敛：随长度非单调）', () => {
    const h = rawSolid()
    const vols = [0.05, 0.01, 0.002].map((d) => meshVolume(h, { linearDeflection: d }))
    for (const v of vols) expect(Math.abs(v - 43.68) / 43.68, `deflection 扫描值 ${v}`).toBeLessThan(0.005)
    const spread = (Math.max(...vols) - Math.min(...vols)) / (vols.reduce((a, b) => a + b, 0) / vols.length)
    expect(spread, '三角化在容差间稳定').toBeLessThan(0.005)
  })
})

describe('陷阱 4：近重合 B 样条体上 cut 单向失败（a−b ≠ b−a）', () => {
  // ⚠️ 本陷阱两次布尔各需 ≈55s → **放子进程跑**（理由见 runProbeSection 注释；
  // 曾经在 worker 内直接跑，稳定触发 `Timeout calling "onTaskUpdate"`）。
  it('整体平移 1e-5 的两体：cut(a,b) 给 ≈44.5（几乎没减掉）、反向 cut(b,a) 给 0', async () => {
    const r = await runProbeSection<{ ab: number; ba: number }>('4j')
    // 错误认知：以为布尔差对称、近重合时两侧都接近空集（几何上 a−b 应为 ~0）。
    expect(Math.abs(r.ab), 'cut(a,b) 本应接近空，实测几乎没减掉').toBeGreaterThan(10)
    expect(Math.abs(r.ba), '反向 cut(b,a) 接近空').toBeLessThan(1)
  })
})

describe('陷阱 5：revolve 轮廓必须在含轴平面（XY 圆盘绕过心 Z 轴是退化输入）', () => {
  it('XY 圆盘 → 体积 ≈0；含轴平面（XZ）圆 → 环体 2π²Rr²', () => {
    const axis = { point: V(0, 0, 0), direction: V(0, 0, 1) }
    // 错误认知：拿 XY 平面圆盘绕圆心 Z 轴旋转求环体（probe 首版即踩此坑）。
    let degenerate = 0
    try {
      degenerate = k.getVolume(k.revolve(circleWireXY(1, V(0, 0, 0)), axis, 2 * Math.PI))
    } catch {
      // 抛错同样视为退化（不同内核版本表现可能不同）：保持 0，无需再赋值。
    }
    expect(Math.abs(degenerate), '退化输入 → 无实体').toBeLessThan(1e-6)

    const R = 10
    const r = 1
    expect(k.getVolume(k.revolve(circleWireXZ(r, R), axis, 2 * Math.PI))).toBeCloseTo(
      2 * Math.PI * Math.PI * R * r * r,
      3,
    )
  })
})

describe('陷阱 6：闭合点列的零长末边 → makeLineEdge 直接抛错', () => {
  it('未去重的闭合点列抛 construction failed；polygonWire 经 closeLoop 去重后正常', () => {
    const dup = [V(0, 0, 0), V(1, 0, 0), V(1, 1, 0), V(0, 1, 0), V(0, 0, 0)] // 末点与首点重合
    // 错误认知：把「首尾重合的闭合点列」直接展开成边（会多出一条零长边）。
    // ⚠️ 订正旧注释：抛错点是 **makeLineEdge**（不是 makeFace 的 `No geometry`）。
    expect(() => degeneratePolygonWire(k, dup)).toThrow(/construction failed/)

    const deduped = closeLoop(dup)
    expect(deduped, 'closeLoop 去掉退化末点').toHaveLength(4)
    expect(k.getSubShapes(polygonWire(dup), 'edge'), 'polygonWire 边数 = 顶点数').toHaveLength(4)
    expect(k.getSurfaceArea(k.makeFace(polygonWire(dup))), '单位正方形').toBeCloseTo(1, 9)
  })
})

describe('陷阱 7：线程实体的面在 1e-6 也能重缝（旧注释「1e-6 完全不缝合」未复现）', () => {
  it('取出 raw/raw 实体的 6 张面，在 1e-6 与 1e-3 下都缝成单壳且 makeSolid 可消费', () => {
    const solid = rawSolid()
    const faces = k.getSubShapes(solid, 'face')
    expect(faces.length, '螺纹实体面数').toBe(6)
    for (const tol of [1e-6, 1e-3]) {
      const shell = k.sew(faces, tol)
      expect(k.getSubShapes(shell, 'shell').length, `sew(tol=${tol})`).toBe(1)
      const vol = k.getVolume(k.makeSolid(shell))
      expect(Number.isFinite(vol), `tol=${tol} makeSolid 可用`).toBe(true)
      expect(Math.abs(vol)).toBeGreaterThan(0)
    }
  })
})
