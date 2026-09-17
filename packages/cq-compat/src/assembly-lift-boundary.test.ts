/**
 * cq-compat 装配函数的 op 提升边界 —— 已知缺陷回归守卫（BLOCKED）
 *
 * GOTCHA（2026-09-17 实测确证）：`runtime.registerLib('cq', cq, …)` 时 cq-compat
 * 命名空间不含任何 dual-op（无 `defineOp` 导出）→ `hasDualOp`=false →
 * `runtime.ts:401` 推断 `lift = true` → `admitCompatLib` 用 `compatOp` 提升**每个**
 * 裸导出函数（brep-only）。`compatOp` 的适配器（`api/internal/compat-op.ts`
 * `buildAdapter`）在调用实现前先 `borrowDeep` 实参：
 *
 *     faijs Shape → 借用视图 { wrapped, disposed, delete, onDispose }
 *
 * 该视图 `isShape`=false、`brepOf`=undefined（实测日志见下），于是
 * `resolveFaceSelector` 跳过 BREP 分支，落到 `workplane.ts:631` 的整形状 bbox 兜底
 * → `cad.bboxMax` → `mesh/query.ts:20` 读 `shape.vertices` 为 undefined
 * → `TypeError: Cannot read properties of undefined (reading 'length')`，
 * 再由 `define-op.ts:199 toOpFailure` 包成
 * `[faijs/op] constraint: E_OP_FAILED: Cannot read properties of undefined (reading 'length')`。
 *
 * 实测证据（diag 输出）：
 *     A. real Shape   -> OK center=[0.000, 0.000, 8.000]
 *     B. borrowed view: isShape=false brepOf=false keys=wrapped,disposed,delete,onDispose
 *     B. borrowed view -> FAIL: TypeError … reading 'length'
 *         at Object.boundingBox (packages/core/src/mesh/query.ts:20:39)
 *         at Object.bboxMax (packages/core/src/api/geom.ts:130:14)
 *         at bboxMax (packages/cq-compat/src/workplane.ts:353:14)
 *         at resolveFaceSelector (packages/cq-compat/src/workplane.ts:631:15)
 *
 * 影响：真实 `assembly.fai.js` 经 `runtime.execute` 跑时，**第一条约束**（c1，源文件
 * 第 10 行 `cq.constraint("bp", ">Z", bottom_plate, "mb", "<Z", middle_bottom, "Plane")`）
 * 即失败（`failedAt = { index: 6, lineNo: 10, callee: 'constraint', code: 'E_OP_FAILED' }`），
 * 因此 mini_lathe 的 P3 端到端验收无法通过。
 * **直接调用**（不经 op 提升，如 `cq.constraint(...)` 在测试进程内）则完全正常——这正是
 * 「单测全绿、e2e 红」的根因。
 *
 * 本文件断言的是**当前（有缺陷）行为**：修好之后这两个用例会转为失败，届时请翻转断言
 * 并删除本守卫。修法方向见
 * `docs/handover/2026-09-17-assembly-global-solver-handover.md`。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs-core/node'
import { isShape, brepOf } from '@faicad/faijs-core/shape'
import { asPartName } from '@faicad/faijs-core/identity'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import { createFsProjectLoader, projectKeyOf } from '../../core/src/node-host/fs-project-loader'
import { borrowBrepjsShape } from '../../core/src/api/internal/l3-bridge'
import { resolveFaceSelector } from './workplane'
import * as cq from './index'

/** 定位 mini_lathe 项目根（vitest 下 import.meta.url 解析基准不定，故多候选探测）。 */
function findMiniLatteRoot(): string {
  const here = fileURLToPath(new URL('.', import.meta.url))
  const candidates = [
    resolve(process.cwd(), '../mini_lathe'),
    resolve(here, '../../mini_lathe'),
    resolve(here, '../../../mini_lathe'),
  ]
  for (const c of candidates) {
    if (existsSync(join(c, 'out/ref/mini_lathe_poses.json'))) return c
  }
  throw new Error(`mini_lathe root not found; candidates: ${candidates.join(', ')}`)
}

let ML: string | null = null
try {
  ML = findMiniLatteRoot()
} catch {
  ML = null
}
const ASM_FILE = ML ? join(ML, 'src/assembly.fai.js') : ''
/** mini_lathe 是仓内固定语料，缺失即跳过（本守卫非 CI 关键路径）。 */
const skip = ML === null

let bp: Shape
let mb: Shape

beforeAll(async () => {
  if (skip) return
  await registerOcctBrepEngine()
  const ports = { ...createNodePorts(), projectLoader: createFsProjectLoader(ML!) }
  const runtime = createRuntime(ports, 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)
  const code = [
    "import * as cq from '@faicad/cq-compat'",
    "import { bottom_plate } from './parts/bottom_plate.fai.js'",
    "import { middle_bottom } from './parts/middle_bottom.fai.js'",
  ].join('\n')
  const r = await runtime.execute(code, { entryKey: projectKeyOf(ML!, ASM_FILE) })
  if (r.failedAt) throw new Error(`load parts failed: ${r.failedAt.message}`)
  bp = r.outputs.get(asPartName('bottom_plate')) as Shape
  mb = r.outputs.get(asPartName('middle_bottom')) as Shape
}, 240000)

describe.skipIf(skip)('cq-compat 装配 op 提升边界（已知缺陷守卫）', () => {
  it('对照：真实 faijs Shape 走 BREP 分支并解析成功', async () => {
    const { center } = await resolveFaceSelector(bp, '>Z')
    expect(center[2]).toBeCloseTo(8, 6)
    const low = await resolveFaceSelector(mb, '<Z')
    expect(low.normal).toEqual([0, 0, -1])
  })

  it('借用的 brepjs 视图不是 faijs Shape（isShape=false / brepOf=undefined）', () => {
    const bv = borrowBrepjsShape(bp)
    expect(isShape(bv as never)).toBe(false)
    expect(brepOf(bv as never)).toBeFalsy()
  })

  it('已知缺陷守卫：借用视图喂给 resolveFaceSelector → 落到 bbox 兜底并崩溃（修复后本用例应失败）', async () => {
    const bv = borrowBrepjsShape(bp)
    await expect(resolveFaceSelector(bv as never, '>Z')).rejects.toThrow(/reading 'length'/)
  })

  it('已知缺陷守卫：runtime.execute 下真实装配在 c1 处失败（修复后本用例应失败）', async () => {
    await registerOcctBrepEngine()
    const ports = { ...createNodePorts(), projectLoader: createFsProjectLoader(ML!) }
    const runtime = createRuntime(ports, 'brep')
    runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)
    // 等价于 assembly.fai.js 的 c1：经 op 提升路径调用 constraint。
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      "import { bottom_plate } from './parts/bottom_plate.fai.js'",
      "import { middle_bottom } from './parts/middle_bottom.fai.js'",
      "let c1 = cq.constraint(\"bp\", \">Z\", bottom_plate, \"mb\", \"<Z\", middle_bottom, \"Plane\")",
      'let result = c1',
    ].join('\n')
    const r = await runtime.execute(code, { entryKey: projectKeyOf(ML!, ASM_FILE) })
    if (!r.failedAt) throw new Error('BUG FIXED: constraint 已能经 op 提升路径执行——请翻转本守卫')
    expect(r.failedAt.callee).toBe('constraint')
    expect(r.failedAt.message).toMatch(/reading 'length'/)
  }, 240000)
})
