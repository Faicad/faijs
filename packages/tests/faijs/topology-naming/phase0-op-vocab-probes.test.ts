/**
 * Phase 0.4 探针（op 侧）：计划 §7 测定项第 **2** 项（`screw`）、第 **4** 项（`convexHull`）、
 * 第 **5** 项（`engrave`）。
 *
 * 见 `docs/plans/2026-09-22-topology-identity-development-plan.md` §7。每项分支已预置，
 * 本文件只负责**测出事实、选分支**。探针落成 `.test.ts`（AGENTS.md 铁律）。
 *
 * 这三项的共同判据：**该 op 有没有"能写进 `.fai.js`、且抗参数变化"的面词汇来源**。
 * 三个可能来源，优先级即此顺序（与设计 §4.4 一致）：
 *
 * 1. **内核权威**（`*WithHistory`）——最硬；
 * 2. **构造语义**（op 自己知道"第 i 条边扫出哪个面"）——次硬，`construct` 类走这条；
 * 3. 两者皆无 ⇒ `unmodeled(...)`（显式承认，不伪造）。
 *
 * 内核侧的那一半（第 1、7 项）在 `packages/core/src/brep/engine/phase0-kernel-probes.test.ts`。
 *
 * ## 第 2 项：`screw` 的面结构 —— 判据是"抗参数变化"
 *
 * `screw` 的 BREP 路径是 `makeCylinder` + `threadBrep` + 裸 `kernel.fuse`（`screw.ts`），
 * **不走带历史的布尔**⇒ 无内核权威。所以只能问构造语义：换一个**保拓扑**的参数
 * （`specIdx` 5→6，即 M5→M6，直径变、结构不变），面数与**逐面类型序列**必须不变。
 * 若变了，说明它的面结构随参数漂移，"第 i 个面"不是一个稳定坐标 ⇒ 分支 B。
 *
 * ## 第 4 项：`convexHull` 的词汇
 *
 * ⚠️ `kernel.hullFromPoints(points, 0.1)`（`vendored/brepjs/operations/convexHullFns.ts:47`）
 * 是**带容差**的凸包，且入参是**点集**（顺序由调用方给）。两项都要测：
 * (a) 保拓扑缩放（10→18）后逐面类型序列是否不变；
 * (b) 打乱点序后**面序**是否跟着变——若变，"第 i 个面"就不是稳定坐标，
 *     但脚本里的点序是字面量、跨重放固定，所以 (b) 只作**留档的风险**，不作为分支判据。
 *
 * ## 第 5 项：`engrave` 是否等价 `cut` 组合 —— 实测发现**它绕过了带历史的入口**
 *
 * `engrave.ts:145/147/155` 用的是裸 `kernel.fuse` / `kernel.cut` / `kernel.fuseAll`，
 * **不是** `cutWithHistory`。本项用**运行时探针**证实这一点（对内核实例计数），
 * 因为有源代码可读 ≠ 运行时真的走那条（且这是"分支 A 能不能直接复用 cut 的词汇"的关键）：
 *
 * - 若 `cutWithHistory` 被调用 ⇒ 分支 A 可**免费**复用 `cut` 的绑定与词汇；
 * - 若只调裸 `cut`（本项实测）⇒ 几何上确是 cut 组合（**分支 A 语义成立**），
 *   但要复用 cut 的词汇，**必须先把这个 op 改走带历史的布尔入口**（一件实现前提，不是新问题）。
 *
 * 使用真实 OCCT（`beforeAll registerOcctBrepEngine`）；`engrave` 需要字体（`ensureTestFontLoader`）。
 *
 * ⚠️ **运行成本**：`screw` 单次 BREP 执行约 20s（650 面、其中 616 张 bspline 螺纹面），
 * 本文件合计约 70–90s。同一脚本的重复执行已按脚本文本缓存（见 `typeCache`）。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { ensureTestFontLoader } from '@faicad/faijs/brep/text/fontTestHelper'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { brepOf } from '@faicad/faijs/shape'
import { asPartName, type PartName } from '@faicad/faijs/identity'
import type { Shape } from '@faicad/faijs/mesh/types'
import type { CadRuntime, ExecutionResult } from '@faicad/faijs/cad-runtime/runtime'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
import { createEditorRuntime } from '../_support/editor-runtime'

beforeAll(async () => {
  await registerOcctBrepEngine()
  ensureTestFontLoader()
}, 120000)

/**
 * 跑一段脚本并把结果的**读取**放在 runtime 存活期内。
 *
 * ⚠️ 必须这样：`runtime.dispose()` 会释放该 runtime 拥有的全部 BREP 句柄，
 * 之后再用句柄调内核 = `OcctError: getSubShapes: Invalid shape ID`（实测踩过）。
 * 句柄不是能带出 runtime 的普通值。
 * @param code - the .fai.js source.
 * @param read - callback reading the result while the runtime is alive.
 * @returns the callback's return value.
 */
async function withRun<T>(code: string, read: (result: ExecutionResult) => T): Promise<T> {
  const runtime: CadRuntime = createEditorRuntime(createNodePorts(), 'brep')
  try {
    const result = await runtime.execute(code, { topology: 'auto' })
    return read(result)
  } finally {
    runtime.dispose()
  }
}

/**
 * 取某 part 的 BREP 句柄。
 *
 * ⚠️ **这些 op 的产物不落在 `brepChain.solidCache`**（实测：`screw`/`convexHull`/`engrave`
 * 执行成功但缓存为空——它们是 `defineOp`/`compatOp` 的**生产者**，产物经 `fromBrep`
 * 进的是运行时身份槽，不是链的 solidCache）。故按三个注册点依次找：
 * 链缓存 → `brepSolids`（终端实体的登记表）→ 运行时槽（`brepOf`）。
 * 命中哪个本身就是该 op 接线形态的观测值。
 */
function solidOf(result: ExecutionResult, part: PartName): { kernel: BrepEngineApi; solid: unknown } {
  const chain = result.brepChain
  const kernel = chain.kernel as BrepEngineApi | null
  if (!kernel) throw new Error(`[probe] 无 BREP 引擎（mode 非 brep？）`)

  const fromChain = chain.solidCache.get(part)
  if (fromChain) return { kernel, solid: fromChain }

  const fromTerminals = result.brepSolids?.get(part)?.solid
  if (fromTerminals) return { kernel, solid: fromTerminals }

  const shape = result.outputs.get(part)
  const fromSlot = shape ? brepOf(shape as Shape) : undefined
  if (fromSlot) return { kernel, solid: fromSlot }

  throw new Error(
    `[probe] ${part} 找不到 BREP 句柄（failedAt=${result.failedAt?.message ?? 'none'}）——` +
      `三个注册点（solidCache / brepSolids / 运行时槽）都没有`,
  )
}

/** 逐面类型序列（面枚举顺序）——"第 i 个面是什么几何"的最小可观测。 */
function faceTypes(result: ExecutionResult, part: PartName): string[] {
  const { kernel, solid } = solidOf(result, part)
  return kernel.getSubShapes(solid as never, 'face').map((h) => kernel.surfaceType(h))
}

/**
 * 内核方法调用计数器：**在真实内核实例上套一层**，返回各方法的调用次数与还原函数。
 *
 * 为什么必须运行时计数（而不是读源码）：`engrave` 有 3 处布尔调用（`kernel.cut` 等），
 * 但"代码里写了 `kernel.cut`"并不等于"运行时真的走它"（也可能早返回、走 mesh 分支）。
 * 这是本文件唯一能证明"绕过了带历史入口"的手段。
 * @param methods - 要计数的方法名。
 * @returns 计数表与还原函数。
 */
function countKernelCalls(methods: readonly string[]): { counts: Record<string, number>; restore: () => void } {
  const kernel = getKernel() as unknown as Record<string, unknown>
  const counts: Record<string, number> = {}
  const originals = new Map<string, unknown>()

  for (const name of methods) {
    const orig = kernel[name]
    counts[name] = 0
    originals.set(name, orig)
    const fn = orig as (...args: unknown[]) => unknown
    // 定义在实例上（遮蔽原型方法）⇒ op 内部 `kernel.cut(...)` 会命中本包装。
    kernel[name] = (...args: unknown[]) => {
      counts[name]++
      return fn.apply(kernel, args)
    }
  }

  return {
    counts,
    restore: () => {
      for (const [name, orig] of originals) {
        // 删掉实例上的遮蔽属性，恢复原型查找（比赋回更干净）
        delete kernel[name]
        void orig
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('§7 第 2 项：screw 的面结构（分支 A，但词表必须结构化）', () => {
  /**
   * 固定螺距 `pitchCustom`、长度与头型，只改公称直径（M5 → M6）。
   *
   * ⚠️ 必须用 `thread: 'custom'` 固定螺距：`thread: 'coarse'` 时**螺距本身随规格变**
   * （M5 粗牙 0.8 / M6 粗牙 1.0），改 `specIdx` 会同时改"圈数"，那就不是保拓扑变化了——
   * 实测过这一版：面数 420 → 520，但那是圈数变化的必然结果，**不能**据此判分支。
   */
  const screw = (specIdx: number, pitch = 0.8, len = 20): string => `
    const part0 = cad.screw({
      system: 'metric', specIdx: ${specIdx}, length: ${len},
      thread: 'custom', pitchCustom: ${pitch}, head: 'none',
    })
  `

  /**
   * 逐面类型序列，**按脚本文本缓存**。
   *
   * `screw` 单次 BREP 执行约 20s（650 面、其中 616 张 bspline 螺纹面），
   * 同一脚本在本文件里会被两个 `it` 用到（保拓扑对照 + 参数敏感性对照）⇒ 不缓存就白跑一遍。
   * 缓存的是**类型字符串数组**（不是句柄）⇒ 与 runtime 生命周期无关，可安全跨 `it` 复用。
   */
  const typeCache = new Map<string, string[]>()
  const typesOf = async (code: string): Promise<string[]> => {
    const hit = typeCache.get(code)
    if (hit) return hit
    const types = await withRun(code, (r) => {
      expect(r.failedAt, `执行失败：${r.failedAt?.message}`).toBeUndefined()
      return faceTypes(r, asPartName('part0'))
    })
    typeCache.set(code, types)
    return types
  }

  it('定螺距下 specIdx 5 → 6：面数与逐面类型序列完全不变（⇒ 分支 A）', async () => {
    const ta = await typesOf(screw(5))
    const tb = await typesOf(screw(6))

    // 实测（M5, pitch 0.8, L20, head none）：650 面 = 28 cylinder + 6 plane + 616 bspline
    // （螺纹被离散成 616 张 bspline 面；6 张平面是螺杆/螺纹的端盖与过渡平面）
    expect(ta).toHaveLength(650)
    const hist = (ts: readonly string[]): Record<string, number> => {
      const h: Record<string, number> = {}
      for (const t of ts) h[t] = (h[t] ?? 0) + 1
      return h
    }
    expect(hist(ta)).toEqual({ cylinder: 28, plane: 6, bspline: 616 })

    // 待测事实：只改公称直径 ⇒ 面数与逐面类型序列**完全不变** ⇒ "第 i 个面"是稳定坐标
    expect(tb.length).toBe(ta.length)
    expect(tb).toEqual(ta)
  })

  it('改螺距会改变面数（⇒ 词表必须按圈结构化，不能扁平下标）', async () => {
    // 实测：pitch 0.8 → 1.0（L20, M5）面数 650 → 521；长度 20 → 40（pitch 0.8）650 → 1275。
    // 两者都改变"圈数"⇒ 螺纹离散面数随之变，**扁平下标跨这些参数不稳**。
    const base = await typesOf(screw(5, 0.8, 20)) // 与上一条 it 共用缓存，不重复执行
    const coarser = await typesOf(screw(5, 1.0, 20))

    expect(base).toHaveLength(650)
    expect(coarser).toHaveLength(521)
    // ⚠️ 这两条若变红（面数不再随螺距变），说明螺纹离散化改了 ⇒ 重评"screw 词表能否用扁平下标"。
  })
})

describe('§7 第 4 项：convexHull 的词汇（保拓扑缩放 + 点序敏感性）', () => {
  /** 立方体 8 角点；`s` 为缩放。 */
  const hull = (s: number, order: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7]): string => {
    const pts = [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [0, 10, 0],
      [0, 0, 10],
      [10, 0, 10],
      [10, 10, 10],
      [0, 10, 10],
    ]
    const body = order.map((i) => `[${pts[i].map((c) => c * s).join(', ')}]`).join(', ')
    return `const part0 = cad.convexHull([${body}])`
  }

  const typesOf = (code: string): Promise<string[]> =>
    withRun(code, (r) => {
      expect(r.failedAt, `执行失败：${r.failedAt?.message}`).toBeUndefined()
      return faceTypes(r, asPartName('part0'))
    })

  it('缩放 1 → 1.8：面数与逐面类型序列不变（⇒ 分支 A）', async () => {
    const ta = await typesOf(hull(1))
    const tb = await typesOf(hull(1.8))

    // 实测：8 角点的凸包是**三角化**多面体——立方体每个正方形面被切成 2 个三角面 ⇒ 12 面
    // （不是直觉的 6 面）。这正是"构造词汇"必须面对的现实：凸包的面上没有"第 i 条输入边"这种
    // 语义，只能按下标；而按下标的前提是"下标抗参数变化"，即下面这条断言。
    expect(ta).toHaveLength(12)
    expect(ta.every((t) => t === 'plane'), `凸包面应全为平面，实测：${JSON.stringify([...new Set(ta)])}`).toBe(true)
    expect(tb).toEqual(ta)
  })

  it('打乱点序：面序是否跟随输入顺序变（留档风险，不作为分支判据）', async () => {
    // 同一个立方体，点序换成逆序
    const ta = await typesOf(hull(1))
    const tb = await typesOf(hull(1, [7, 6, 5, 4, 3, 2, 1, 0]))

    // 面数与类型多重集不受点序影响（几何对象相同）
    expect(tb.length).toBe(ta.length)
    expect([...tb].sort()).toEqual([...ta].sort())
    // ⚠️ 留档：脚本里的点序是字面量 ⇒ 跨重放固定，故"面序随输入点序变"不构成分支判据；
    // 但若将来要让 convexHull 的面词汇**与调用方点序无关**，需要按几何（法向）而非下标命名。
  })
})

describe('§7 第 5 项：engrave 是否等价 cut 组合（实测：几何等价，但绕过带历史入口）', () => {
  const ENGRAVE = `
    const part0 = cad.box(20, 20, 20, { centered: true })
    const part1 = cad.engrave(part0, { engravingType: 'text', mode: 'concave', depth: 1, text: 'A', textSize: 10 })
  `

  it('BREP 路径只调裸 kernel.cut，从不调 cutWithHistory（⇒ 复用 cut 词汇前须先换入口）', async () => {
    const spy = countKernelCalls(['cut', 'cutWithHistory', 'fuse', 'fuseWithHistory', 'fuseAll'])
    let failed: string | undefined
    try {
      failed = await withRun(ENGRAVE, (r) => r.failedAt?.message)
    } finally {
      spy.restore()
    }

    expect(failed, `执行失败：${failed}`).toBeUndefined()
    // 确实走了 BREP 布尔（不是 mesh 兜底）
    expect(spy.counts.cut + spy.counts.fuse, '一个布尔内核调用都没发生').toBeGreaterThan(0)
    // 待测事实：带历史的入口调用次数为 0
    expect(spy.counts.cutWithHistory).toBe(0)
    expect(spy.counts.fuseWithHistory).toBe(0)
  })

  it('刻出的凹槽是 op 内部工具体的产物：结果面远多于输入 6 面，且无权威账号可继承', async () => {
    const types = await withRun(ENGRAVE, (r) => {
      expect(r.failedAt, `执行失败：${r.failedAt?.message}`).toBeUndefined()
      return faceTypes(r, asPartName('part1'))
    })

    // 输入 box 6 面；刻字后新增凹槽底面 + 各笔画侧壁 ⇒ 面数显著增加
    expect(types.length).toBeGreaterThan(6)
    // 凹槽侧壁是平面、底面也是平面（'A' 的笔画为直边）；这里只断言"新增面确实进了结果"
    expect(types.filter((t) => t === 'plane').length).toBeGreaterThan(6)
  })
})
