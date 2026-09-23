/**
 * @vitest-environment node
 *
 * consume-input — 复制类 op 不消费输入 shape（与 copy 同级）
 *
 * 背景：faijs 的"消费"模型由函数体 keep 声明驱动（live-shapes.ts lineConsumes
 * C5 默认消费短路）。copy 通过 `keep(input)` 让输入保留为存活终端；复制类 op
 * （pattern / mirror / clone 等）同样声明 keep(input) ——
 * 本测试保证：全部 8 个脚本面复制类 op 执行后输入变量仍出现在 result.terminals，
 * 结果本身也是终端。（transformCopy 已摘出脚本面：arg-spec skip，见方案 §2.1 修订。）
 *
 * 另含角色表断言：4 个多副本 pattern（linearPattern / circularPattern /
 * gridPattern / rectangularPattern / mirrorJoin）执行后结果 roleTable 含
 * `replica[*]` 前缀条目，格式与 linearPattern 的 `replica[k]/<inner>` 对齐。
 *
 * 这是行为测试（端到端走 keep → keepByLine → computeLiveShapes 全链路），
 * 以 copy 为对照基线。
 *
 * Run: npx vitest run src/api/consume-input.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { CadRuntime } from '../cad-runtime/runtime'
import { createApiNamespace } from './api-namespace'
import { runtimeLineage } from '../topology/naming/lineage'
import type { ExecutionResult } from '../cad-runtime/runtime'
import type { RoleTable } from '../topology/naming/types'

let kernelReady = false

beforeAll(async () => {
  await registerOcctBrepEngine()
  kernelReady = true
}, 120000)

function makeRuntime(): CadRuntime {
  return new CadRuntime({ events: { emit() {} } }, undefined, { cad: createApiNamespace() })
}

async function run(code: string, imports?: Record<string, unknown>): Promise<ExecutionResult> {
  const runtime = makeRuntime()
  // composed 经 params 预置进 ctx（imports 仅服务多文件模块装载，非本场景）
  return runtime.execute(code, { params: imports })
}

/** 取 terminals 中的 part 名集合（人类可读，便于断言）。 */
function terminalIds(result: ExecutionResult): string[] {
  return result.terminals.map((t) => String(t.id))
}

// 复制类 op 的"输入不消费"对照程序：每个 op 都先建 box(s0)，再对 s0 做复制类变换，
// 断言 s0 仍出现在 terminals。
const PROGRAMS: Array<{ op: string; code: string; imports?: () => Record<string, unknown>; skip?: boolean }> = [
  {
    op: 'copy',
    code: ['const s0 = cad.box(20, 20, 20, { centered: true })', 'const s1 = cad.copy(s0)'].join('\n'),
  },
  {
    op: 'linearPattern',
    code: ['const s0 = cad.box(20, 20, 20, { centered: true })', 'const s1 = cad.linearPattern(s0, [1, 0, 0], 3, 20)'].join('\n'),
  },
  {
    op: 'circularPattern',
    code: ['const s0 = cad.box(20, 20, 20, { centered: true })', 'const s1 = cad.circularPattern(s0, [0, 0, 1], 4)'].join('\n'),
  },
  {
    op: 'gridPattern',
    code: ['const s0 = cad.box(20, 20, 20, { centered: true })', 'const s1 = cad.gridPattern(s0, [1, 0, 0], [0, 1, 0], 2, 2, 30, 30)'].join('\n'),
  },
  {
    op: 'rectangularPattern',
    code: [
      'const s0 = cad.box(20, 20, 20, { centered: true })',
      'const s1 = cad.rectangularPattern(s0, { xDir: [1, 0, 0], xCount: 2, xSpacing: 30, yDir: [0, 1, 0], yCount: 2, ySpacing: 30 })',
    ].join('\n'),
  },
  {
    op: 'mirrorJoin',
    // 偏置 box：镜像面 x=0 右侧，镜像后两份不重合（居中 box 会让两副本质心重合）
    code: ['const s0 = cad.box(10, 20, 20)', 'const s1 = cad.mirrorJoin(s0, { normal: [1, 0, 0] })'].join('\n'),
  },
  {
    op: 'mirror',
    code: ['const s0 = cad.box(20, 20, 20, { centered: true })', 'const s1 = cad.mirror(s0, { normal: [1, 0, 0] })'].join('\n'),
  },
  {
    op: 'clone',
    code: ['const s0 = cad.box(20, 20, 20, { centered: true })', 'const s1 = cad.clone(s0)'].join('\n'),
  },
  // transformCopy 不再是脚本面 op（arg-spec skip：ComposedTransform 在 .fai.js
  // 不可构造，仅保留 TS 库导出）——keep 覆盖为 8 个脚本面复制 op。
]

describe('copy-like ops must not consume their input shape', () => {
  for (const { op, code, imports } of PROGRAMS) {
    it(`${op}: input s0 remains a live terminal after the op`, async () => {
      expect(kernelReady).toBe(true)
      const result = await run(code, imports?.())
      expect(result.failedAt).toBeUndefined()
      const ids = terminalIds(result)
      expect(ids).toContain('s0')
      // 结果本身也必须是终端
      expect(ids).toContain('s1')
    })
  }
})

// ── 角色表断言：多副本 pattern 产出 replica[*] 条目 ─────────────────────────

/** 从执行结果 outputs 里取出变量对应的 Shape。 */
function shapeOf(result: ExecutionResult, name: string): unknown | undefined {
  return result.outputs.get(name as never)
}

/** 收集 roleTable 中带 replica 前缀的角色集合。 */
function replicaRoles(table: RoleTable | undefined): string[] {
  if (!table) return []
  const roles: string[] = []
  for (const inner of table.values()) for (const role of inner.keys()) roles.push(role)
  return roles
}

describe('multi-replica patterns build replica[*] role tables', () => {
  const CASES: Array<{ op: string; code: string; expectedLabels: string[]; skip?: boolean }> = [
    {
      op: 'linearPattern',
      code: ['const s0 = cad.box(20, 20, 20, { centered: true })', 'const s1 = cad.linearPattern(s0, [1, 0, 0], 3, 20)'].join('\n'),
      expectedLabels: ['replica[0]', 'replica[1]', 'replica[2]'],
    },
    {
      op: 'circularPattern',
      code: ['const s0 = cad.box(20, 20, 20, { centered: true })', 'const s1 = cad.circularPattern(s0, [0, 0, 1], 4)'].join('\n'),
      expectedLabels: ['replica[0]', 'replica[1]', 'replica[2]', 'replica[3]'],
    },
    {
      op: 'gridPattern',
      code: ['const s0 = cad.box(20, 20, 20, { centered: true })', 'const s1 = cad.gridPattern(s0, [1, 0, 0], [0, 1, 0], 2, 2, 30, 30)'].join('\n'),
      expectedLabels: ['replica[0_0]', 'replica[0_1]', 'replica[1_0]', 'replica[1_1]'],
    },
    {
      op: 'rectangularPattern',
      code: [
        'const s0 = cad.box(20, 20, 20, { centered: true })',
        'const s1 = cad.rectangularPattern(s0, { xDir: [1, 0, 0], xCount: 2, xSpacing: 30, yDir: [0, 1, 0], yCount: 2, ySpacing: 30 })',
      ].join('\n'),
      expectedLabels: ['replica[0_0]', 'replica[0_1]', 'replica[1_0]', 'replica[1_1]'],
    },
    {
      op: 'mirrorJoin',
      code: ['const s0 = cad.box(10, 20, 20)', 'const s1 = cad.mirrorJoin(s0, { normal: [1, 0, 0] })'].join('\n'),
      expectedLabels: ['replica[0]', 'replica[1]'],
    },
  ]

  for (const { op, code, expectedLabels } of CASES) {
    it(`${op}: roleTable has replica[*] entries matching the replica count`, async () => {
      expect(kernelReady).toBe(true)
      const result = await run(code)
      expect(result.failedAt).toBeUndefined()

      const shape = shapeOf(result, 's1') as { roleTable?: RoleTable } | undefined
      expect(shape).toBeDefined()
      // roleTable 权威落点：血缘图 part 键旁挂（1.10 前置③，shape.ts fromBrep 记录）
      const table = runtimeLineage.tableOfPart('s1' as never)
      expect(table).toBeDefined()

      const roles = replicaRoles(table as RoleTable)
      const labels = [...new Set(roles.map((r) => r.split('/')[0]!))]
      for (const label of expectedLabels) {
        expect(labels).toContain(label)
      }
      // 每个角色都带 inner 后缀（`replica[k]/<inner>` 格式，与 linearPattern 对齐）
      for (const role of roles) {
        expect(role).toMatch(/^replica\[[^\]]+\]\/.+/)
      }
    })
  }
})
