/**
 * Phase 0.8 覆盖率探针：**「无名字面」基线**（Phase 0 的最后一步）。
 *
 * 见 `docs/plans/2026-09-22-topology-identity-development-plan.md` §5 Phase 0 的 0.8 行。
 * 用途与 G3 进度尺同源：把"命名机制现在覆盖到哪儿"变成可复跑的数字，
 * 之后每个阶段只需回答"semantic 加了多少、positional/empty 减了多少"。
 *
 * ## 为什么分三档，而不是"有名 vs 无名"
 *
 * 今天有名字的面里，**大量是位置兜底名**（`extrude:face_3` = "第 3 张面"）——它名字非空，
 * 却不承载任何设计意图：设计目标（§4.2 `RoleName`）是**语义局部名**（`cap:top` / `wall:3`）。
 * `extrude` 的 6 张面全是 `extrude:face_N` ⇒ 按"有名/无名"统计会得出"6/6 全覆盖"的**假结论**。
 * ⇒ 三档：`semantic`（真词汇）/ `positional`（`<op>:face_<N>` 兜底）/ `empty`（`''`）。
 * **Phase 1.7 之后 positional 必须归零**（删 `box:`/`extrude:` 前缀的同时淘汰位置兜底名）。
 *
 * ## Phase 0.8 实测基线（2026-09-22）

 * | 链 | 被查 part | 面数 | naming 行 | semantic | positional | empty |
 * |---|---|---|---|---|---|---|
 * | `box` | part0 | 6 | 6 | **6** | 0 | 0 |
 * | `box → fillet` | part1 | 7 | 7 | 6 | 0 | **1**（过渡面） |
 * | `sketch → extrude` | part1 | 6 | 6 | **0** | **6** | 0 |
 * | `box → cylinder → subtract` | part2 | 7 | 7 | **7** | 0 | 0 |
 * | `box → cylinder → cut`（投影） | part2 | 7 | 7 | 0 | 0 | **7** |
 * | `sketch → extrude → subtract` | part3 | 7 | 7 | 1 | 6 | 0 |
 * | `sketch → extrude → cut`（投影） | part3 | 7 | 7 | 0 | 0 | **7** |
 * | **合计** | | **47** | **47** | **20** | **12** | **15** |
 *
 * ## Phase 1 基线回填（2026-09-22，1.6/1.7/1.8/1.12 落地后重测）
 *
 * 位置兜底名已删（positional 归零）、词汇换型为无 op 前缀语义名、无身份行从
 * `role: ''` 改为显式 `role: null`（G6/D6/S4）。三档判据相应更新：null 档判
 * `role == null`（`''` 兜底已不存在，`POSITIONAL_RE` 保留作防回归哨兵）。
 *
 * | 链 | 被查 part | 面数 | naming 行 | semantic | positional | null |
 * |---|---|---|---|---|---|---|
 * | `box` | part0 | 6 | 6 | **6** | 0 | 0 |
 * | `box → fillet` | part1 | 7 | 7 | 6 | 0 | **1**（过渡面，身份待 Phase 3） |
 * | `sketch → extrude` | part1 | 6 | 6 | **6**（bottom/top/wall:0-3） | 0 | 0 |
 * | `box → cylinder → subtract` | part2 | 7 | 7 | **7** | 0 | 0 |
 * | `box → cylinder → cut`（投影） | part2 | 7 | 7 | 0 | 0 | **7** |
 * | `sketch → extrude → subtract` | part3 | 7 | 7 | **7**（wall:i + lateral） | 0 | 0 |
 * | `sketch → extrude → cut`（投影） | part3 | 7 | 7 | 0 | 0 | **7** |
 * | **合计** | | **47** | **47** | **32** | **0** | **15** |
 *
 * 进度读数：semantic 20→32、positional 12→0、null 15 不变——
 * `extrude` 的 construct 枚举器把 6 个位置名换成语义名（+6），其 subtract
 * 链上原 6 个位置名同批转正（+6）；`cut`（投影）7+7 全 null 是 Phase 2/3
 * 接线（D11 naming 声明）的存量，不是本轮回退。
 *
 * ## ⚠️ 基线里最刺眼的一条：`cut`（投影）与 `subtract`（faijs 自有）命名能力不同
 *
 * 同样几何、同样输入：
 *
 * - `cad.subtract(part0, part1)` ⇒ 孔壁拿到 **`cylinder:lateral`**、origin = **`part1`（工具件）**，
 *   基体 6 面保留 `box:*` ⇒ **7/7 semantic**；
 * - `cad.cut(part0, part1)` ⇒ **7/7 全空**。
 *
 * 机理：`subtract` 是 faijs 双 op，BREP 路径走 `booleanWithRoleTable`
 * （`brep/face-evolution.ts:311`，`*WithHistory` + A/B 双流合流）；`cut` 是 **brepjs 投影**
 * （`arg-spec.ts:2785`，reason 原文就写着"faijs 用 subtract（不同名）"），走裸内核布尔、**不传 role 表**。
 *
 * 更强的证据在第 6/7 行：输入已经有 1 semantic + 6 positional，经 `cut` 后**全部变空**——
 * 说明投影布尔不是"没能力命名"，而是**把输入的命名表整个丢掉了**。
 *
 * ⇒ 这直接给 Phase 2/3 增加一项**必须做的事**：D11 的强制判据是
 * `kind === 'brep-op' && scriptFace === true`，而 `cut` 正是这样的条目（`scriptFace: true`）
 * ⇒ **它必须声明 `naming`**，那么它的实现也必须接上 role 表通路。
 * 否则任何用 brepjs 兼容名（`cut`/`fuse`/`intersect`）写的 `.fai.js` 永远全部无名，
 * 而用 faijs 名（`subtract`…）写的却有名字——**同几何、两套命名能力**，是必须收敛的分叉。
 *
 * 顺带确认（对第 7 项的独立佐证）：**现有实现早就是对的**——孔壁挂工具件的
 * `cylinder:lateral`，与内核把孔壁归账为"工具侧面改型后继"完全一致。
 * 计划原文提的 `hole:<j>`（挂 cut 名下）若照做，是**相对现状的退步**。
 *
 * ## 另一个已成立的不变式
 *
 * 7 条链**行数 == 面数**（`rowsGap` 全 0）⇒ 今天的命名表**没有"漏行"**问题；
 * 缺口只在"行的内容"（空 / 位置名），不在"行数"。这条钉住后，
 * 后续阶段若出现行数 < 面数，就是**新引入的**漏表缺陷，而不是历史包袱。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { asPartName, type PartName } from '@faicad/faijs/identity'
import type { CadRuntime, ExecutionResult } from '@faicad/faijs/cad-runtime/runtime'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
import { createEditorRuntime } from '../_support/editor-runtime'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

const SQUARE = `{ contours: [{ segments: [
  { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
  { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
  { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
  { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },
], closed: true }] }`

/** 位置兜底名的形状：`<op>:face_<N>`（Phase 1.7 之后应当消失）。 */
const POSITIONAL_RE = /:face_\d+$/

interface CoverageRow {
  /** 链名 */
  label: string
  code: string
  /** 被查 part（该链的最终产物） */
  part: string
  /** 期望的覆盖计数（Phase 0.8 实测值） */
  expect: { total: number; semantic: number; positional: number; empty: number }
}

const ROWS: readonly CoverageRow[] = [
  {
    label: 'box',
    code: `const part0 = cad.box(20, 20, 20, { centered: true })`,
    part: 'part0',
    expect: { total: 6, semantic: 6, positional: 0, empty: 0 },
  },
  {
    label: 'box → fillet',
    // 圆角过渡面在权威映射里没有任何来源（Phase 0.4 实测）⇒ 唯一 null（身份待 Phase 3）
    code: `const part0 = cad.box(20, 20, 20, { centered: true })
           const part1 = cad.fillet(part0, { edges: [cad.edgeRef(part0, 2)], radius: 2 })`,
    part: 'part1',
    expect: { total: 7, semantic: 7, positional: 0, empty: 0 },
  },
  {
    label: 'sketch → extrude',
    // Phase 1 后：construct 枚举器落地（bottom/top/wall:0-3），位置兜底名已删
    code: `const part0 = cad.profile(${SQUARE})
           const part1 = cad.extrude(part0, [0, 0, 10])`,
    part: 'part1',
    expect: { total: 6, semantic: 6, positional: 0, empty: 0 },
  },
  {
    label: 'box → cylinder → subtract（faijs 双 op）',
    code: `const part0 = cad.box(20, 20, 20, { centered: true })
           const part1 = cad.cylinder(3, 30, { centered: true })
           const part2 = cad.subtract(part0, part1)`,
    part: 'part2',
    expect: { total: 7, semantic: 7, positional: 0, empty: 0 },
  },
  {
    label: 'box → cylinder → cut（Phase 3 handwritten cut）',
    // Phase 3: cut overridden with handwritten boolean.ts:cut → roleTable propagation
    code: `const part0 = cad.box(20, 20, 20, { centered: true })
           const part1 = cad.cylinder(3, 30, { centered: true })
           const part2 = cad.cut(part0, part1)`,
    part: 'part2',
    expect: { total: 7, semantic: 7, positional: 0, empty: 0 },
  },
  {
    label: 'sketch → extrude → subtract（faijs 双 op）',
    // Phase 1 后：extrude 的 wall:i + cylinder 的 lateral 全语义
    code: `const part0 = cad.profile(${SQUARE})
           const part1 = cad.extrude(part0, [0, 0, 10])
           const part2 = cad.cylinder(3, 30, { centered: true, at: [5, 5, 0] })
           const part3 = cad.subtract(part1, part2)`,
    part: 'part3',
    expect: { total: 7, semantic: 7, positional: 0, empty: 0 },
  },
  {
    label: 'sketch → extrude → cut（Phase 3 handwritten cut）',
    // Phase 3: cut overridden with handwritten boolean.ts:cut → roleTable propagation
    code: `const part0 = cad.profile(${SQUARE})
           const part1 = cad.extrude(part0, [0, 0, 10])
           const part2 = cad.cylinder(3, 30, { centered: true, at: [5, 5, 0] })
           const part3 = cad.cut(part1, part2)`,
    part: 'part3',
    expect: { total: 7, semantic: 7, positional: 0, empty: 0 },
  },
]

interface Coverage {
  total: number
  rows: number
  semantic: number
  positional: number
  empty: number
  roles: string[]
}

/**
 * 跑一条链并统计三档覆盖。
 *
 * ⚠️ 读取必须在 runtime 存活期内（`dispose()` 会释放 BREP 句柄，
 * 此后调内核 = `OcctError: getSubShapes: Invalid shape ID`）。
 * @param row - the chain to measure.
 * @returns the coverage counts for its final part.
 */
async function measureUncached(row: CoverageRow): Promise<Coverage> {
  const runtime: CadRuntime = createEditorRuntime(createNodePorts(), 'brep')
  try {
    const result: ExecutionResult = await runtime.execute(row.code, { topology: 'auto' })
    expect(result.failedAt, `[${row.label}] 执行失败：${result.failedAt?.message}`).toBeUndefined()

    const part: PartName = asPartName(row.part)
    const kernel = result.brepChain.kernel as BrepEngineApi | null
    const solid = result.brepChain.solidCache.get(part)
    if (!kernel || !solid) throw new Error(`[${row.label}] ${row.part} 无 BREP 句柄`)

    const total = kernel.getSubShapes(solid, 'face').length
    const rows = result.naming?.get(part)?.faceNaming ?? []
    let semantic = 0
    let positional = 0
    let empty = 0
    for (const f of rows) {
      // Phase 1.7 后无身份行显式 `role: null`（`''` 兜底已删，D6/G6）
      if (f.role == null) empty++
      else if (POSITIONAL_RE.test(f.role)) positional++
      else semantic++
    }
    // GOTCHA (2026-09-24): `role` is nullable (an anonymous face has `role: null`,
    // Phase 1.7 / D6-G6). The `empty` counter above already accounts for those, so
    // the `roles` list carries only the real role names.
    return {
      total, rows: rows.length, semantic, positional, empty,
      roles: rows.map((f) => f.role).filter((r): r is string => r !== null),
    }
  } finally {
    runtime.dispose()
  }
}

/**
 * 按 `code|part` 记忆化：本文内同一链被查 4 次（逐链 / cut 对照 / 合计），
 * 不缓存则要跑 16 次 BREP（实测数分钟）。确定性探针 ⇒ 缓存安全。
 */
const cache = new Map<string, Promise<Coverage>>()
function measure(row: CoverageRow): Promise<Coverage> {
  const key = `${row.code}|${row.part}`
  let hit = cache.get(key)
  if (!hit) {
    hit = measureUncached(row)
    cache.set(key, hit)
  }
  return hit
}

describe('Phase 0.8：无名字面基线（progress ruler：semantic 升、positional/empty 降）', () => {
  for (const row of ROWS) {
    it(`${row.label}：${row.expect.semantic}/${row.expect.total} semantic 具名`, async () => {
      const c = await measure(row)

      expect(c.total, `[${row.label}] 面数变了 ⇒ 基线需重测`).toBe(row.expect.total)
      // 行数 == 面数：今天的命名表不漏行（若这条变红，是新引入的漏表缺陷）
      expect(c.rows, `[${row.label}] naming 行数 ${c.rows} != 面数 ${c.total}`).toBe(c.total)
      expect(
        { semantic: c.semantic, positional: c.positional, empty: c.empty },
        `[${row.label}] 三档分布漂移（roles=${JSON.stringify(c.roles)}）——若是改善，请更新基线`,
      ).toEqual({
        semantic: row.expect.semantic,
        positional: row.expect.positional,
        empty: row.expect.empty,
      })
    })
  }

  it('Phase 3: cut 与 subtract 命名能力收敛（cut 不再丢命名表）', async () => {
    const viaSubtract = await measure(ROWS[5])
    const viaCut = await measure(ROWS[6])

    expect(viaSubtract.semantic + viaSubtract.positional).toBeGreaterThan(0)
    // Phase 3: cut 现在走 handwritten boolean.ts:cut，做 roleTable 传播
    expect(viaCut.semantic).toBe(viaSubtract.semantic)
    expect(viaCut.empty).toBe(0)
  })

  it('合计基线：47 面中 47 semantic / 0 positional / 0 null（Phase 3 回填）', async () => {
    let total = 0
    let semantic = 0
    let positional = 0
    let empty = 0
    for (const row of ROWS) {
      const c = await measure(row)
      total += c.total
      semantic += c.semantic
      positional += c.positional
      empty += c.empty
    }

    expect({ total, semantic, positional, empty }).toEqual({
      total: 47,
      semantic: 47,
      positional: 0,
      empty: 0,
    })
  }, 120000)
})
