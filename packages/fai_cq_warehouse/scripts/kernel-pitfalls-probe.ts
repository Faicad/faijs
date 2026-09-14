/**
 * kernel-pitfalls-probe.ts — 内核「反直觉行为」可复跑测量台（W3 知识资产）。
 *
 * 用途：把 W3 期间靠临时脚本发现、随后被写进注释/分析文档的每一条**错误认知**，
 * 重新量一遍并打印原始数字。`src/kernel-pitfalls.test.ts` 的断言常量即取自本
 * 脚本输出；内核升级后先跑本脚本重新采样，再决定断言是否需要跟着改。
 *
 * 运行：npx tsx scripts/kernel-pitfalls-probe.ts [段号,...]   （省略段号 = 全部）
 * 结论载体（回归锁）：src/kernel-pitfalls.test.ts
 * 分析文档：docs/analysis/2026-09-14-cq-warehouse-thread-probe.md
 *
 * ⚠️ 本脚本只**打印**、不 assert —— 它是证据生成器；断言在测试里。
 */

import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import { setupWarehouseKernel } from '../src/test-setup'
import { requireKernel, type WarehouseKernel } from '../src/kernel'
import * as P from '../src/primitives'
import { isoThread } from '../src/thread'

let k: WarehouseKernel
const V = (x: number, y: number, z: number): BrepVec3 => ({ x, y, z })

function line(label: string, value: unknown): void {
  console.log(`${label.padEnd(56)} ${String(value)}`)
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

/** 原始折线 wire（**不**做 closeLoop 去重）——用于复现零长边陷阱。 */
function rawPolygonWire(pts: BrepVec3[]): BrepHandle {
  const edges: BrepHandle[] = []
  for (let i = 0; i < pts.length; i++) edges.push(k.makeLineEdge(pts[i]!, pts[(i + 1) % pts.length]!))
  return k.makeWire(edges)
}

/** 2×2×2 立方体的 6 张平面 face（闭壳，用于 sew/朝向陷阱）。 */
function boxFaces(size = 2): BrepHandle[] {
  const s = size
  const quad = (a: BrepVec3, b: BrepVec3, c: BrepVec3, d: BrepVec3) =>
    k.makeFace(P.polygonWire([a, b, c, d]))
  return [
    quad(V(0, 0, 0), V(s, 0, 0), V(s, s, 0), V(0, s, 0)),
    quad(V(0, 0, s), V(s, 0, s), V(s, s, s), V(0, s, s)),
    quad(V(0, 0, 0), V(s, 0, 0), V(s, 0, s), V(0, 0, s)),
    quad(V(s, 0, 0), V(s, s, 0), V(s, s, s), V(s, 0, s)),
    quad(V(s, s, 0), V(0, s, 0), V(0, s, s), V(s, s, s)),
    quad(V(0, s, 0), V(0, 0, 0), V(0, 0, s), V(0, s, s)),
  ]
}

const R = 3
/** 螺旋带的两行同参数采样点（半径恒为 R）。 */
function helixRow(dz: number, n = 96): BrepVec3[] {
  const pts: BrepVec3[] = []
  for (let i = 0; i <= n * 10; i++) {
    const th = (2 * Math.PI * i) / n
    pts.push({ x: R * Math.cos(th), y: R * Math.sin(th), z: i / n + dz })
  }
  return pts
}

const sections: Record<string, () => void> = {
  '1': () => {
    console.log('\n== 陷阱 1：makeWire 不校验连通性（也不丢弃/不抛错） ==')
    const e1 = k.makeLineEdge(V(0, 0, 0), V(1, 0, 0))
    const e2 = k.makeLineEdge(V(1, 0, 0), V(1, 1, 0))
    const e3 = k.makeLineEdge(V(5, 5, 0), V(6, 5, 0)) // 与前者不接触
    const w = (edges: BrepHandle[]) => k.makeWire(edges)
    line('makeWire([e1,e2]) 边数', k.getSubShapes(w([e1, e2]), 'edge').length)
    line('makeWire([e1,e2,e3]) 边数（喂 3，e3 悬空）', k.getSubShapes(w([e1, e2, e3]), 'edge').length)
    line('makeWire([e1,e3]) 边数（两条互不接触）', k.getSubShapes(w([e1, e3]), 'edge').length)
    line('makeWire([e2,e1]) 边数（乱序）', k.getSubShapes(w([e2, e1]), 'edge').length)
    line('makeWire([e1,e2,e1]) 边数（重复边）', k.getSubShapes(w([e1, e2, e1]), 'edge').length)
    line('返回物子 wire 数（[e1,e3]）', k.getSubShapes(w([e1, e3]), 'wire').length)
    line('→ 悬空输入是否抛错', tryDo(() => w([e1, e3])))

    // 正方形四边，按不同顺序喂：检验「加不进当前开口端」是否真的会丢边
    const P00 = V(0, 0, 0)
    const P10 = V(1, 0, 0)
    const P11 = V(1, 1, 0)
    const P01 = V(0, 1, 0)
    const A = k.makeLineEdge(P00, P10)
    const B = k.makeLineEdge(P10, P11)
    const C = k.makeLineEdge(P11, P01)
    const D = k.makeLineEdge(P01, P00)
    const orders: Array<[string, BrepHandle[]]> = [
      ['[A,B,C,D] 顺序', [A, B, C, D]],
      ['[A,C,B,D] 乱序（C 接不上 B 前）', [A, C, B, D]],
      ['[C,A,B,D] 乱序', [C, A, B, D]],
      ['[A,B,D,C] 乱序', [A, B, D, C]],
    ]
    for (const [name, edges] of orders) line(`4 边 ${name} → 边数`, k.getSubShapes(w(edges), 'edge').length)

    // 真实几何缺口（phase2 记录的场景）：3 条边、第 2 条与第 1 条差 0.35
    const g1 = k.makeLineEdge(V(0, 0, 0), V(1, 0, 0))
    const g2 = k.makeLineEdge(V(1.35, 0, 0), V(2, 0, 0)) // 与 g1 差 0.35
    const g3 = k.makeLineEdge(V(2, 0, 0), V(2, 1, 0))
    line('带 0.35 缺口的 3 边 → 边数', k.getSubShapes(w([g1, g2, g3]), 'edge').length)
  },

  '2': () => {
    console.log('\n== 陷阱 2：sew 平面闭壳 → makeSolid 朝向朝内（vol 为负） ==')
    const faces = boxFaces(2)
    for (const tol of [1e-6, 1e-5, 1e-4, 1e-3, 1e-2]) {
      const shell = k.sew(faces, tol)
      const nFace = k.getSubShapes(shell, 'face').length
      const nShell = k.getSubShapes(shell, 'shell').length
      line(
        `sew(tol=${tol}) face=${nFace} shell=${nShell} makeSolid→vol=${n(() => k.getVolume(k.makeSolid(shell)))}`,
        '',
      )
    }
    line('（真值 +8；负号 = 朝向朝内，必须 orientOutward 翻正）', '')
  },

  '3': () => {
    console.log('\n== 陷阱 3：getVolume(GProps) 对螺旋 B 样条面求积混叠 ==')
    const cases: Array<[string, Parameters<typeof isoThread>[0]]> = [
      ['raw/raw', { major_diameter: 6, pitch: 1, length: 10, end_finishes: ['raw', 'raw'] }],
      ['fade/fade', { major_diameter: 6, pitch: 1, length: 10, end_finishes: ['fade', 'fade'] }],
      ['square/square', { major_diameter: 6, pitch: 1, length: 10, end_finishes: ['square', 'square'] }],
    ]
    for (const [name, spec] of cases) {
      const h = isoThread(spec).handle!
      const gprops = k.getVolume(h)
      const mesh = P.meshVolume(h)
      line(`${name} GProps=${gprops.toFixed(6)} mesh=${mesh.toFixed(6)} 相对差=${((Math.abs(gprops - mesh) / mesh) * 100).toFixed(3)}%`, '')
    }
    const h = isoThread({ major_diameter: 6, pitch: 1, length: 10, end_finishes: ['raw', 'raw'] }).handle!
    line('三角化收敛性（deflection → mesh 体积）：', '')
    for (const d of [0.05, 0.02, 0.01, 0.005, 0.002, 0.001]) {
      line(`  deflection=${d}  meshVolume=`, P.meshVolume(h, { linearDeflection: d }).toFixed(6))
    }
    line(`  （对照 A 侧 GProps=49.961532 / mesh=43.680000）`, '')
  },

  '4': () => {
    console.log('\n== 陷阱 4：近重合 B 样条体上 cut 不对称（单向失败） ==')
    const base = isoThread({ major_diameter: 6, pitch: 1, length: 10, end_finishes: ['raw', 'raw'] }).handle!
    for (const eps of [1e-7, 1e-6, 1e-5]) {
      line(
        `eps=${eps} cut(a,b)=${n(() => k.getVolume(k.cut(base, k.translate(base, eps, 0, 0))))} cut(b,a)=${n(() => k.getVolume(k.cut(k.translate(base, eps, 0, 0), base)))}`,
        '',
      )
    }
    line('（真值：a−b 与 b−a 应同为零——单向给 44.48 即失败）', '')
  },

  '5': () => {
    console.log('\n== 陷阱 5：revolve 轮廓须在含轴平面（XY 圆盘退化） ==')
    const axis = { point: V(0, 0, 0), direction: V(0, 0, 1) }
    line('revolve(XY 圆盘 绕过心 Z 轴) 体积', n(() => k.getVolume(k.revolve(P.circleWireXY(1, V(0, 0, 0)), axis, 2 * Math.PI))))
    line('revolve(XZ 圆 R=10) 体积（环体 2π²Rr²=197.392）', n(() => k.getVolume(k.revolve(P.circleWireXZ(1, 10), axis, 2 * Math.PI))))
  },

  '6': () => {
    console.log('\n== 陷阱 6：闭合点列的零长末边 → makeLineEdge 直接抛错 ==')
    const dup = [V(0, 0, 0), V(1, 0, 0), V(1, 1, 0), V(0, 1, 0), V(0, 0, 0)]
    line('rawPolygonWire(未去重 5 点)', tryDo(() => rawPolygonWire(dup)))
    line('  （对照）polygonWire(去重后) 边数', k.getSubShapes(P.polygonWire(dup), 'edge').length)
    line('  polygonWire makeFace 面积（正方形应 1）', n(() => k.getSurfaceArea(k.makeFace(P.polygonWire(dup)))))
    line('closeLoop 5→', P.closeLoop(dup).length)
  },

  '7': () => {
    console.log('\n== 陷阱 7：ruledFace 面数/面积/参数守卫 ==')
    const rowA = [V(0, 0, 0), V(1, 0, 0), V(2, 0, 0)]
    const rowB = [V(0, 1, 1), V(1, 1, 1), V(2, 1, 1)]
    line('ruledFace 面数（应 1）', k.getSubShapes(P.ruledFace(rowA, rowB), 'face').length)
    line('ruledFace 面积（2×√2=2.828427）', n(() => k.getSurfaceArea(P.ruledFace(rowA, rowB))))
    line('ruledFace 行长不等', tryDo(() => P.ruledFace(rowA, rowB.slice(0, 2))))
    line('ruledFace <2 点', tryDo(() => P.ruledFace([V(0, 0, 0)], [V(0, 1, 0)])))
    line('bsplineSurface vs loft 外扩（r=3 → xmax 差）：', '')
    line('  bsplineSurface Δ =', n(() => k.getBoundingBox(k.bsplineSurface([...helixRow(-0.0625), ...helixRow(0.0625)], 2, helixRow(0).length)).xmax - R))
    const wireA = k.makeWire([k.approximatePoints(helixRow(-0.0625), 1e-6)])
    const wireB = k.makeWire([k.approximatePoints(helixRow(0.0625), 1e-6)])
    line('  loft(ruled) Δ =', n(() => k.getBoundingBox(k.loft([wireA, wireB], false, true)).xmax - R))
  },

  '8': () => {
    console.log('\n== 陷阱 8：orientOutward 的零体积即缝合失败 ==')
    const box = k.makeBox(2, 2, 2)
    line('orientOutward(正向 box) vol', n(() => k.getVolume(P.orientOutward(box))))
    line('orientOutward(反向 box) vol（应翻正为 8）', n(() => k.getVolume(P.orientOutward(k.reverseShape(box)))))
    line('orientOutward(零体积面)', tryDo(() => P.orientOutward(k.makeFace(P.polygonWire([V(0, 0, 0), V(1, 0, 0), V(1, 1, 0)])))))
  },

  // ── 陷阱 4 的机读段与对照段（勿删；限定结论边界 + 供测试复用）──
  //  4j：机读 JSON（供 src/kernel-pitfalls.test.ts 陷阱 4 的**子进程**断言）
  //  4b：粗采样螺旋**带体**退化（loft 出体积 0 的壳）→ 廉价替代不可行
  //  4t：量单次 cut 耗时 → 单次 55–61s，**已逼近/超过** vitest worker 的 60s RPC 超时
  //      （birpc 固定 6e4、不可配）→ 结论：该断言**必须放子进程**，不能留在 worker 内
  //  4c：近重合**圆柱**对称且快（<0.3s）→ 证明"单向失败"是 B 样条特有，非通用布尔缺陷
  //  4s：缩到 len=4/6 后**不再复现** → 该 bug 与螺旋圈数相关，不能靠缩规格提速
  '4j': () => {
    const a = isoThread({ major_diameter: 6, pitch: 1, length: 10, end_finishes: ['raw', 'raw'] }).handle!
    const b = k.translate(a, 1e-5, 0, 0)
    const t1 = Date.now()
    const ab = k.getVolume(k.cut(a, b))
    const t2 = Date.now()
    const ba = k.getVolume(k.cut(b, a))
    const t3 = Date.now()
    console.log(JSON.stringify({ ab, ba, abMs: t2 - t1, baMs: t3 - t2 }))
  },

  // 陷阱 4b：见上方对照段说明（结论：此廉价替代不可行）。
  '4b': () => {
    console.log('\n== 陷阱 4b：粗采样螺旋 B 样条带体的 cut 是否同样单向失败 ==')
    const N = 16 // 每圈采样点（thread 用 48）
    const turns = 10
    const R = 3
    const t = 0.5
    const rowOf = (r: number): BrepVec3[] => {
      const pts: BrepVec3[] = []
      for (let i = 0; i <= N * turns; i++) {
        const th = (2 * Math.PI * i) / N
        pts.push({ x: r * Math.cos(th), y: r * Math.sin(th), z: i / N })
      }
      return pts
    }
    const wA = k.makeWire([k.approximatePoints(rowOf(R), 1e-6)])
    const wB = k.makeWire([k.approximatePoints(rowOf(R - t), 1e-6)])
    const t0 = Date.now()
    const a = k.loft([wA, wB], true, true)
    line(`loft 带体 构建=${Date.now() - t0}ms 面数=${k.getSubShapes(a, 'face').length} 体积=${n(() => k.getVolume(a))}`, '')
    const b = k.translate(a, 1e-5, 0, 0)
    const t1 = Date.now()
    const ab = n(() => k.getVolume(k.cut(a, b)))
    const t2 = Date.now()
    const ba = n(() => k.getVolume(k.cut(b, a)))
    const t3 = Date.now()
    line(`cut(a,b)=${ab}(${t2 - t1}ms)  cut(b,a)=${ba}(${t3 - t2}ms)`, '')
  },

  '4t': () => {
    console.log('\n== 陷阱 4t：length=10 / eps=1e-5 单次 cut 耗时（对照 vitest 60s RPC 超时）==')
    const a = isoThread({ major_diameter: 6, pitch: 1, length: 10, end_finishes: ['raw', 'raw'] }).handle!
    const b = k.translate(a, 1e-5, 0, 0)
    const t1 = Date.now()
    const ab = k.getVolume(k.cut(a, b))
    const t2 = Date.now()
    const ba = k.getVolume(k.cut(b, a))
    const t3 = Date.now()
    line(`cut(a,b)=${ab.toFixed(6)} 耗时=${t2 - t1}ms`, '')
    line(`cut(b,a)=${ba.toFixed(6)} 耗时=${t3 - t2}ms`, '')
  },

  '4c': () => {
    console.log('\n== 陷阱 4c：近重合**圆柱**的 cut 是否同样单向失败（廉价对照）==')
    for (const eps of [1e-6, 1e-5, 1e-4, 1e-3]) {
      const a = k.makeCylinder(3, 10)
      const b = k.translate(a, eps, 0, 0)
      const t1 = Date.now()
      const ab = n(() => k.getVolume(k.cut(a, b)))
      const t2 = Date.now()
      const ba = n(() => k.getVolume(k.cut(b, a)))
      const t3 = Date.now()
      line(`eps=${eps} cut(a,b)=${ab}(${t2 - t1}ms) cut(b,a)=${ba}(${t3 - t2}ms)`, '')
    }
  },

  '4s': () => {
    console.log('\n== 陷阱 4s：小规格（length=4）近重合 cut 是否仍单向失败 + 耗时 ==')
    for (const len of [4, 6]) {
      const t0 = Date.now()
      const a = isoThread({ major_diameter: 6, pitch: 1, length: len, end_finishes: ['raw', 'raw'] }).handle!
      const tBuild = Date.now() - t0
      const b = k.translate(a, 1e-5, 0, 0)
      const t1 = Date.now()
      const ab = n(() => k.getVolume(k.cut(a, b)))
      const t2 = Date.now()
      const ba = n(() => k.getVolume(k.cut(b, a)))
      const t3 = Date.now()
      line(`len=${len} 构体=${tBuild}ms  cut(a,b)=${ab} (${t2 - t1}ms)  cut(b,a)=${ba} (${t3 - t2}ms)`, '')
    }
  },

  '9': () => {
    console.log('\n== 陷阱 9：线程实体的面在 1e-6 下是否可重缝（旧注释声称不可） ==')
    const solid = isoThread({ major_diameter: 6, pitch: 1, length: 10, end_finishes: ['raw', 'raw'] }).handle!
    const faces = k.getSubShapes(solid, 'face')
    line('线程实体面数', faces.length)
    for (const tol of [1e-6, 1e-4, 1e-3]) {
      const shell = k.sew(faces, tol)
      const nShell = k.getSubShapes(shell, 'shell').length
      line(`sew(tol=${tol}) shell=${nShell} makeSolid→vol=${n(() => k.getVolume(k.makeSolid(shell)))}`, '')
    }
  },
}

async function main(): Promise<void> {
  await setupWarehouseKernel()
  k = requireKernel() as WarehouseKernel
  const arg = process.argv[2]
  const keys = arg ? arg.split(',') : Object.keys(sections)
  for (const key of keys) {
    const fn = sections[key]
    if (!fn) {
      console.log(`(unknown section ${key})`)
      continue
    }
    fn()
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
