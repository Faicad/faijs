/**
 * allocate-id 单元测试（Phase 3 命名规则）
 *
 * Phase 3 规则（§4）：
 * - 单入单出 → 复用输入名
 * - 无输入/单输出 → 新名 partN
 * - 多输出（split）→ 新 partN / part(N+1)
 * - group/assembly → 取消 grp_N，按「无输入/单输出」拿新 partN
 * - void op → 不调用 allocateStatementId
 */
import { describe, it, expect } from 'vitest'
import {
  allocateStatementId,
  allocateSplitIds,
  isPartVmId,
  isPartId,
  getModelNum,
  getVersionNum,
  type AllocateIdContext,
} from './allocate-id'
import type { CadStatement } from './types'
import { asStmtId, asPartName } from '../identity'

function makeStmt(id: string, op: string, inputs: string[] = [], outputs?: string[]): CadStatement {
  return {
    id: asStmtId(id),
    op,
    args: {},
    inputs: inputs.map(asPartName),
    outputs: (outputs ?? [id]).map(asPartName),
  }
}

function ctx(statements: CadStatement[] = []): AllocateIdContext {
  return { statements }
}

describe('allocateStatementId (Phase 3)', () => {
  it('无输入的创建型 op → 新名 part0', () => {
    expect(allocateStatementId('box', [], ctx())).toBe('part0')
    expect(allocateStatementId('sphere', [], ctx())).toBe('part0')
    expect(allocateStatementId('load', [], ctx())).toBe('part0')
  })

  it('已有语句时 → 模型号递增', () => {
    const stmts = [makeStmt('s1', 'box', [], ['part0'])]
    expect(allocateStatementId('sphere', [], ctx(stmts))).toBe('part1')
  })

  it('单入单出 → 复用输入名', () => {
    const stmts = [makeStmt('s1', 'box', [], ['part0'])]
    expect(allocateStatementId('drill', ['part0'], ctx(stmts))).toBe('part0')
  })

  it('同模型多次操作 → 始终复用输入名', () => {
    const stmts = [
      makeStmt('s1', 'box', [], ['part0']),
      makeStmt('s2', 'drill', ['part0'], ['part0']),
    ]
    expect(allocateStatementId('extrude', ['part0'], ctx(stmts))).toBe('part0')
  })

  it('布尔 → 新模型（2→1 算无输入/单输出）', () => {
    const stmts = [
      makeStmt('s1', 'box', [], ['part0']),
      makeStmt('s2', 'sphere', [], ['part1']),
    ]
    expect(allocateStatementId('boolean', ['part0', 'part1'], ctx(stmts))).toBe('part2')
  })

  it('布尔后继续操作 → 复用布尔结果名', () => {
    const stmts = [
      makeStmt('s1', 'box', [], ['part0']),
      makeStmt('s2', 'sphere', [], ['part1']),
      makeStmt('s3', 'boolean', ['part0', 'part1'], ['part2']),
    ]
    expect(allocateStatementId('drill', ['part2'], ctx(stmts))).toBe('part2')
  })

  it('输入为旧 st_* 格式 → 仍复用输入名（Phase 3 不检查格式）', () => {
    const stmts: CadStatement[] = []
    expect(allocateStatementId('drill', ['st_somePart_1'], ctx(stmts))).toBe('st_somePart_1')
  })

  it('空 inputs 但 op 非创建型 → 仍分配新模型', () => {
    expect(allocateStatementId('drill', [], ctx())).toBe('part0')
  })

  it('多模型场景：box → sphere → subtract → drill', () => {
    const stmts: CadStatement[] = []
    // 1. box
    const boxId = allocateStatementId('box', [], ctx(stmts))
    expect(boxId).toBe('part0')
    stmts.push(makeStmt('s1', 'box', [], [boxId]))

    // 2. sphere
    const sphereId = allocateStatementId('sphere', [], ctx(stmts))
    expect(sphereId).toBe('part1')
    stmts.push(makeStmt('s2', 'sphere', [], [sphereId]))

    // 3. subtract (boolean) — 2→1 走新名
    const boolId = allocateStatementId('boolean', [boxId, sphereId], ctx(stmts))
    expect(boolId).toBe('part2')
    stmts.push(makeStmt('s3', 'boolean', [boxId, sphereId], [boolId]))

    // 4. drill on boolean result — 复用输入名
    const drillId = allocateStatementId('drill', [boolId], ctx(stmts))
    expect(drillId).toBe('part2')
  })

  it('getMaxModelNum 从 outputs 扫描（不依赖 stmt.id）', () => {
    // stmt.id 是 sN（Phase 3），但 outputs 里有 part3
    const stmts = [
      makeStmt('s1', 'box', [], ['part0']),
      makeStmt('s2', 'sphere', [], ['part3']),  // 跳号验证
    ]
    // 下一个新模型应该是 part4（而非 part1）
    expect(allocateStatementId('box', [], ctx(stmts))).toBe('part4')
  })
})

describe('allocateStatementId: group/assembly（Phase 3: 取消 grp_N）', () => {
  it('group op → 新名 part0（空场景）', () => {
    expect(allocateStatementId('group', [], ctx())).toBe('part0')
  })

  it('assembly op → 新名 part0（空场景）', () => {
    expect(allocateStatementId('assembly', [], ctx())).toBe('part0')
  })

  it('已有语句时 → 递增', () => {
    const stmts = [
      makeStmt('s1', 'box', [], ['part0']),
      makeStmt('s2', 'cylinder', [], ['part1']),
    ]
    expect(allocateStatementId('assembly', [], ctx(stmts))).toBe('part2')
  })

  it('group 后继续分配 part → 不冲突', () => {
    const stmts = [
      makeStmt('s1', 'box', [], ['part0']),
      makeStmt('s2', 'group', [], ['part1']),
    ]
    // 新 part 应该是 part2
    expect(allocateStatementId('box', [], ctx(stmts))).toBe('part2')
  })
})

describe('allocateSplitIds (Phase 3)', () => {
  it('分割 → 两个新模型（无 _vM 后缀）', () => {
    const stmts = [makeStmt('s1', 'box', [], ['part0'])]
    const { front, back } = allocateSplitIds(ctx(stmts))
    expect(front).toBe('part1')
    expect(back).toBe('part2')
  })

  it('空场景 → part0 和 part1', () => {
    const { front, back } = allocateSplitIds(ctx())
    expect(front).toBe('part0')
    expect(back).toBe('part1')
  })
})

describe('工具函数', () => {
  it('isPartVmId — 仅旧名 partN_vM', () => {
    expect(isPartVmId('part0_v0')).toBe(true)
    expect(isPartVmId('part12_v3')).toBe(true)
    expect(isPartVmId('st_somePart_1')).toBe(false)
    expect(isPartVmId('part0')).toBe(false)
  })

  it('isPartId — 新名 partN', () => {
    expect(isPartId('part0')).toBe(true)
    expect(isPartId('part12')).toBe(true)
    expect(isPartId('part0_v0')).toBe(false)
    expect(isPartId('st_somePart_1')).toBe(false)
  })

  it('getModelNum — 兼容旧名和新名', () => {
    expect(getModelNum('part0_v0')).toBe(0)
    expect(getModelNum('part5_v2')).toBe(5)
    expect(getModelNum('part3')).toBe(3)
    expect(getModelNum('st_x_1')).toBeNull()
  })

  it('getVersionNum — 仅旧名有版本号', () => {
    expect(getVersionNum('part0_v0')).toBe(0)
    expect(getVersionNum('part5_v2')).toBe(2)
    expect(getVersionNum('part3')).toBeNull()
    expect(getVersionNum('st_x_1')).toBeNull()
  })
})
