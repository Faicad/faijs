/**
 * G3 抗重放链（6 条）—— Phase 0.5 建立的「进度尺」
 *
 * 本文件是开发计划的 G3 判据载体（`docs/plans/2026-09-22-topology-identity-development-plan.md` §3.1）。
 * 它**刻意在现在就是红的**：先让「机制干不了它唯一该干的事」变成可复跑的数字，
 * 之后每一阶段只需回答一句"G3 又绿了几条"。
 *
 * ## G3 的判据（不是"解析成功"）
 *
 * 计划原文：**判据不是「解析成功」，是「解析到的面与首次捕获语义等价」**。
 * 落到可执行的三层断言（`expectReplayStable`）：
 *
 * | # | 断言 | 含义 | 为什么不能省 |
 * |---|---|---|---|
 * | **T1** | 角色词汇集跨重放**不变** | 同一 op 图 ⇒ 同一批局部名 | 参数变了名字就变，等于引用不可重放 |
 * | **T2** | A 轮捕获的 ref，在 B 轮解析到的面，B 轮给它的名字与 A 轮**相同** | 端到端身份等价 | 只断言"能解析"会放过"解析到错的面"——最难查的一类 |
 * | **T3** | 解析到的面几何语义一致（`surfaceType`） | 防 T2 靠名字对、几何错 | 名字可能对而面已不是同一张 |
 *
 * T0（前置）：两次执行本身必须成功。它今天**应当已经通过**——若 T0 就红，
 * 说明红的不是命名机制而是链路本身，必须先修链路（否则进度尺失去意义）。
 *
 * ## 与阶段的关系（期望的绿灯节奏）
 *
 * | 链 | 覆盖类别 | 计划中预期转绿于 |
 * |---|---|---|
 * | L1 | `construct` + `kernel`/`byAdjacency` | Phase 3 |
 * | L2 | `construct` 递归词汇 + `kernel`(布尔) | Phase 3 |
 * | L3 | `replicate(k)` | Phase 2（声明）/3 |
 * | L4 | `subdivide` | Phase 3 |
 * | L5 | `kernel`（组合布尔）+ 3d_editor 真实负载 | Phase 3 |
 * | L6 | 端到端身份化引用（role 字面量进脚本） | Phase 3 |
 *
 * ## Phase 0.5 实测基线（2026-09-22）
 *
 * **6/6 红，全部红在 T0.5（目标词汇未落地），T0 链路本身 6/6 通。**
 *
 * | 链 | T0 链路 | 首次执行实测 role 集合 | 红的性质 |
 * |---|---|---|---|
 * | L1 | ✅ | `extrude:face_0…5` + `''` | 只有**位置兜底名**（`opType:face_N`），且 fillet 过渡面 role 为空 |
 * | L2 | ✅ | `['']` | 产物**完全无名** |
 * | L3 | ✅ | `['']` | 产物**完全无名** |
 * | L4 | ✅ | `['']` | 产物**完全无名** |
 * | L5 | ✅ | `['']` | 产物**完全无名**（连 box 的 6 个语义 role 都丢了） |
 * | L6 | ✅ | `box:left/front/back/right/top/bottom` + `''` | 继承面有名字，**唯一缺的是新造面**（倒角过渡面 role=`''`） |
 *
 * 读数：**4/6 条链今天产出的是完全无名（或仅位置名）的形状**；L6 只差"新造面词汇"一步。
 * 这就是后续每阶段"G3 又绿了几条"的比较基准。
 *
 * ## ⚠️ 一条跨阶段耦合（本文件暴露，实现时必须同时处理）
 *
 * L5/L6 的脚本里要写 **role 字面量**（R2：role 必须能写进 `.fai.js`）。Phase 1.7 会删掉
 * `box:` / `extrude:` 前缀（`box:top` → `top`），届时**脚本里的字面量会失效**——
 * 迁移器 `migrateTopoRef` 只处理**数据**（3d_editor 场景），不管脚本源码。
 * ⇒ 为把改动收敛到一处，本文件把这类字面量提为文件顶部常量（`LEGACY_BOX_*_ROLE`），
 * Phase 1.7 只需改常量与这里的注释，不必翻遍每个 `it`。
 *
 * 使用真实 OCCT（`beforeAll registerOcctBrepEngine`）。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { asPartName, type PartName } from '@faicad/faijs/identity'
import { HASH_UPPER_BOUND } from '@faicad/faijs/brep/face-evolution'
import { resolveTopoRef, type ResolutionContext } from '@faicad/faijs/topology/naming'
import type { FaceTopoRef, PartNaming, RoleTable } from '@faicad/faijs/topology/naming/types'
import type { CadRuntime, ExecutionResult } from '@faicad/faijs/cad-runtime/runtime'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

// ── Phase 1.7 待改的字面量（集中一处，见文件头注） ──
/** 脚本里消费侧引用的 role 字面量（今天是带前缀的形态）。 */
const LEGACY_BOX_TOP_ROLE = 'box:top'
const LEGACY_BOX_FRONT_ROLE = 'box:front'

// ── 助手 ──

/** 从 ExecutionResult 构建某 part 的解析上下文（同 topology-naming.test.ts）。 */
function ctxOf(result: ExecutionResult, part: PartName): ResolutionContext {
  const chain = result.brepChain
  const kernel = chain.kernel
  const solid = chain.solidCache.get(part)
  if (!kernel || !solid) throw new Error(`[G3] no BREP solid for ${part}`)

  const handles = kernel.getSubShapes(solid, 'face')
  const hashes = kernel.subShapeHashes(solid, 'face', HASH_UPPER_BOUND)
  const faces = hashes.map((hash, i) => ({ ordinal: i + 1, hash, handle: handles[i] }))
  const roleTable = chain.roleTableCache?.get(part) as RoleTable | undefined
  return { kernel: kernel as BrepEngineApi, faces, roleTable }
}

function namingOf(result: ExecutionResult, part: PartName): PartNaming {
  const naming = result.naming?.get(part)
  if (!naming) throw new Error(`[G3] no naming table for ${part}`)
  return naming
}

/** 该 part 命名表里的 role 保序去重列表（跨重放要相等的东西）。 */
function rolesOf(result: ExecutionResult, part: PartName): string[] {
  return [...new Set(namingOf(result, part).faceNaming.map((f) => f.role))]
}

/** ordinal（1 起）→ 该次执行给这张面起的名字。表与序号按下标对齐（types.ts:161）。 */
function roleAtOrdinal(result: ExecutionResult, part: PartName, ordinal: number): string {
  const row = namingOf(result, part).faceNaming[ordinal - 1]
  if (!row) throw new Error(`[G3] naming table shorter than ordinal ${ordinal} for ${part}`)
  return row.role
}

/**
 * 从首次执行捕获一个 TopoRef（模拟宿主拾取 → 存进场景）。
 *
 * **按 role 精确匹配、`origin` 从行里取**——这样本文件不必知道 origin 是 PartName
 * （今天）还是 StmtId（Phase 1.6 之后），Phase 1 换 origin 类型时本文件零改动。
 */
function captureByRole(result: ExecutionResult, part: PartName, role: string): FaceTopoRef {
  const row = namingOf(result, part).faceNaming.find((f) => f.role === role)
  if (!row) {
    throw new Error(
      `[G3] 首次执行里没有 role '${role}'（${part}）——该 op 的词汇表尚未落地。` +
        `现有 role：${JSON.stringify(rolesOf(result, part))}`,
    )
  }
  return { kind: 'face', origin: row.origin, role: row.role, hint: row.hint }
}

/** 同上，但按前缀匹配（`replica[1]/…`、`splinter(…)#…` 这类复合名）。 */
function captureByRolePrefix(result: ExecutionResult, part: PartName, prefix: string): FaceTopoRef {
  const row = namingOf(result, part).faceNaming.find((f) => f.role.startsWith(prefix))
  if (!row) {
    throw new Error(
      `[G3] 首次执行里没有以 '${prefix}' 开头的 role（${part}）——该 op 的词汇表尚未落地。` +
        `现有 role：${JSON.stringify(rolesOf(result, part))}`,
    )
  }
  return { kind: 'face', origin: row.origin, role: row.role, hint: row.hint }
}

/**
 * G3 核心断言：**A 轮捕获 → B 轮改参重放**。
 *
 * @param label - 链名（T1/T2 失败信息里带上，便于一眼定位是哪条链）
 * @param runA - 首次执行的 ExecutionResult
 * @param runB - 改参重放后的 ExecutionResult
 * @param part - 被追踪的产物名（两次执行同名）
 * @param capture - 从 runA 捕获 ref 的函数（目标词汇表尚未落地时会 throw，属预期红）
 * @param requiredRoles - 目标词汇表里**必须存在**的 role（T0.5：词汇表缺失即红）
 */
function expectReplayStable(
  label: string,
  runA: ExecutionResult,
  runB: ExecutionResult,
  part: PartName,
  capture: (result: ExecutionResult) => FaceTopoRef,
  requiredRoles: readonly string[] = [],
): void {
  // T0：链路本身必须能跑（今天应通过；红了说明问题不在命名机制）
  expect(runA.failedAt, `[${label}] 首次执行失败：${runA.failedAt?.message}`).toBeUndefined()
  expect(runB.failedAt, `[${label}] 改参重放失败：${runB.failedAt?.message}`).toBeUndefined()

  // T0.5：目标词汇表必须出现（这就是"声明成本"在链上的体现）。
  // 不用 expect().toContain —— 失败信息里要带上**完整** role 集合，
  // 本文件是进度尺，红的理由必须是可读的（"缺哪个、当前有哪些"）。
  const rolesA = rolesOf(runA, part)
  const missing = requiredRoles.filter((role) => !rolesA.includes(role))
  if (missing.length > 0) {
    throw new Error(
      `[${label}] 目标词汇未落地：缺 ${JSON.stringify(missing)}（${part}）。` +
        `当前 role 集合：${JSON.stringify(rolesA)}`,
    )
  }

  // T1：角色词汇集跨重放不变
  expect(rolesOf(runB, part), `[${label}] 角色词汇集在改参后变化 ⇒ 引用不可重放`).toEqual(rolesA)

  // T2：捕获的 ref 在重放后解析到"同名面"
  const ref = capture(runA)
  const resolved = resolveTopoRef(ref, ctxOf(runB, part))
  const roleAfter = roleAtOrdinal(runB, part, resolved.ordinal)
  expect(roleAfter, `[${label}] 重放后 ref 落到别的面（捕获 '${ref.role}'）`).toBe(ref.role)

  // 解析到的行必须仍属同一 origin 链根（防止"名字对上但换了来源"）
  const rowAfter = namingOf(runB, part).faceNaming[resolved.ordinal - 1]!
  expect(rowAfter.origin, `[${label}] 重放后 ref 的来源变了`).toBe(ref.origin)

  // T3：几何语义一致
  expect(rowAfter.hint.surfaceType, `[${label}] 重放后解析到的面类型变了`).toBe(ref.hint.surfaceType)
}

// ── 脚本片段 ──

const SQUARE = `{ contours: [{ segments: [
  { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
  { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
  { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
  { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },
], closed: true }] }`

describe('G3 抗重放链（当前应为红：这就是后续每阶段的进度尺）', () => {
  let runtime: CadRuntime

  beforeEach(() => {
    runtime = createRuntime(createNodePorts(), 'brep')
  })

  afterEach(() => {
    runtime.dispose()
  })

  /** 同一 runtime 实例跑两遍（增量重放路径——改参数时宿主走的就是它）。 */
  async function replay(codeA: string, codeB: string): Promise<[ExecutionResult, ExecutionResult]> {
    const a = await runtime.execute(codeA, { topology: 'auto' })
    const b = await runtime.execute(codeB, { topology: 'auto' })
    return [a, b]
  }

  it('L1 sketch → extrude → fillet：construct 词汇 + kernel/byAdjacency 过渡面', async () => {
    // 改参：只改拉伸高度（10 → 14），拓扑等价 ⇒ 局部名集合必须不变
    //
    // ⚠️ 计划 §3.1 把本链写成 `box → extrude → fillet`。实测**跑不通**：
    // `cad.extrude` 是 brepjs 投影（`operations/api.js#extrude`），入参必须是
    // face/wire（sketch 产物），传 solid 直接 `EXTRUDE_FAILED`
    // （`arg-spec.ts:1533` 只有一个 extrude，无 solid 版）。
    // ⇒ 本链改写成与 FCStd `Pad→Fillet` 真实负载同形（`sketch → extrude → fillet`，
    //    见 `edge-ref/edge-ref.test.ts` 的 "drives the FCStd Pad→Fillet shape"）。
    // 覆盖面不变：`construct`（profile→侧面）+ `kernel`+`byAdjacency`（过渡面）。
    const [a, b] = await replay(
      `
      const part0 = cad.sketch(${SQUARE})
      const part1 = cad.extrude(part0, [0, 0, 10])
      const part2 = cad.fillet(part1, { edges: [cad.edgeRef(part1, 2)], radius: 2 })
    `,
      `
      const part0 = cad.sketch(${SQUARE})
      const part1 = cad.extrude(part0, [0, 0, 14])
      const part2 = cad.fillet(part1, { edges: [cad.edgeRef(part1, 2)], radius: 2 })
    `,
    )
    // 目标词汇：fillet 的过渡面（§4.2 序列化示例 `gen:fillet:0`）
    expectReplayStable('L1', a, b, asPartName('part2'), (r) => captureByRole(r, asPartName('part2'), 'gen:fillet:0'), [
      'gen:fillet:0',
    ])
  })

  it('L2 sketch → extrude → cut：construct 递归词汇（profile 边序）+ kernel 布尔', async () => {
    // 改参：只改孔直径（3 → 4）；profile 的边序不受影响 ⇒ wall:<i> 必须稳定
    const [a, b] = await replay(
      `
      const part0 = cad.sketch(${SQUARE})
      const part1 = cad.extrude(part0, [0, 0, 10])
      const part2 = cad.cylinder(3, 30, { centered: true, at: [5, 5, 0] })
      const part3 = cad.cut(part1, part2)
    `,
      `
      const part0 = cad.sketch(${SQUARE})
      const part1 = cad.extrude(part0, [0, 0, 10])
      const part2 = cad.cylinder(4, 30, { centered: true, at: [5, 5, 0] })
      const part3 = cad.cut(part1, part2)
    `,
    )
    const part = asPartName('part3')
    // 目标词汇：profile 扫出的侧面 `wall:<i>`；cut 产生的孔壁 `hole:<j>`
    expectReplayStable('L2', a, b, part, (r) => captureByRole(r, part, 'wall:0'), ['wall:0', 'hole:0'])
  })

  it('L3 box → linearPattern(3)：replicate(k) 复合身份', async () => {
    // 改参：只改间距（20 → 30）；份数不变 ⇒ replica[k] 的 k 语义必须稳定
    const [a, b] = await replay(
      `
      const part0 = cad.box(10, 10, 10, { centered: true })
      const part1 = cad.linearPattern(part0, [1, 0, 0], 3, 20)
    `,
      `
      const part0 = cad.box(10, 10, 10, { centered: true })
      const part1 = cad.linearPattern(part0, [1, 0, 0], 3, 30)
    `,
    )
    const part = asPartName('part1')
    expectReplayStable('L3', a, b, part, (r) => captureByRolePrefix(r, part, 'replica[1]/'))
  })

  it('L4 box → split：subdivide 复合身份', async () => {
    // 改参：切刀位置（中心 → z=2）；片数不变 ⇒ splinter(#j) 必须稳定
    const [a, b] = await replay(
      `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.box(40, 40, 1, { centered: true, at: [0, 0, 0] })
      const part2 = cad.split(part0, [part1])
    `,
      `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.box(40, 40, 1, { centered: true, at: [0, 0, 2] })
      const part2 = cad.split(part0, [part1])
    `,
    )
    const part = asPartName('part2')
    expectReplayStable('L4', a, b, part, (r) => captureByRolePrefix(r, part, 'splinter('))
  })

  it('L5 box → fai_drill：kernel（组合布尔）+ 3d_editor 真实负载（38 个文件在用）', async () => {
    // 改参：只改孔径（4 → 6）；孔的拓扑结构不变 ⇒ hole:<j> 必须稳定
    const drill = (d: number): string => `
      const part0 = cad.box(20, 20, 20, { centered: true, at: [0, 0, 0] })
      const part1 = cad.fai_drill(part0, {
        diameter: ${d}, depth: 5, holeType: 'simple',
        position: [0, 0, 10], direction: 'normal',
        face: { kind: 'face', origin: 'part0', role: '${LEGACY_BOX_TOP_ROLE}', hint: { kind: 'face', surfaceType: 'plane' } },
      })
    `
    const [a, b] = await replay(drill(4), drill(6))
    const part = asPartName('part1')
    // 目标词汇：孔壁挂 **cut 那条语句**的 origin，role = `hole:<j>`（§7 第 7 项准则）
    expectReplayStable('L5', a, b, part, (r) => captureByRole(r, part, 'hole:0'), ['hole:0'])
  })

  it('L6 box →（role 字面量构造 edge ref）→ fillet：端到端身份化引用（R2）', async () => {
    // 改参：只改 box 尺寸（20 → 30）；role 字面量写在脚本里，必须仍然解析到同一张面
    const script = (size: number): string => `
      const part0 = cad.box(${size}, ${size}, ${size}, { centered: true })
      const part1 = cad.fillet(part0, {
        edges: [{
          kind: 'edge',
          faces: [
            { kind: 'face', origin: 'part0', role: '${LEGACY_BOX_TOP_ROLE}', hint: { kind: 'face', surfaceType: 'plane' } },
            { kind: 'face', origin: 'part0', role: '${LEGACY_BOX_FRONT_ROLE}', hint: { kind: 'face', surfaceType: 'plane' } },
          ],
          hint: { kind: 'edge' },
        }],
        radius: 2,
      })
    `
    const [a, b] = await replay(script(20), script(30))
    const part = asPartName('part1')
    expectReplayStable('L6', a, b, part, (r) => captureByRole(r, part, 'gen:fillet:0'), ['gen:fillet:0'])
  })
})
