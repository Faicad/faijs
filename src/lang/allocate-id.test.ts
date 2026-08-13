/**
 * allocate-id 单元测试
 */
import { describe, it, expect } from 'vitest'
import {
  allocateStatementId,
  allocateSplitIds,
  isPartVmId,
  getModelNum,
  getVersionNum,
  type AllocateIdContext,
} from './allocate-id'
import type { CadStatement } from './types'

function makeStmt(id: string, op: string, inputs: string[] = [], outputs?: string[]): CadStatement {
  return {
    id,
    op,
    args: {},
    inputs,
    feature: { kind: 'primitive', label: op, createdBy: 'user' },
    outputs,
  }
}

function ctx(statements: CadStatement[] = []): AllocateIdContext {
  return { statements }
}

describe('allocateStatementId', () => {
  it('无输入的创建型 op → 新模型 partN_v0', () => {
    expect(allocateStatementId('box', [], ctx())).toBe('part0_v0')
    expect(allocateStatementId('sphere', [], ctx())).toBe('part0_v0')
    expect(allocateStatementId('load', [], ctx())).toBe('part0_v0')
  })

  it('已有语句时 → 模型号递增', () => {
    const stmts = [makeStmt('part0_v0', 'box')]
    expect(allocateStatementId('sphere', [], ctx(stmts))).toBe('part1_v0')
  })

  it('有输入 → 跟随 inputs[0] 的模型号，版本 +1', () => {
    const stmts = [makeStmt('part0_v0', 'box')]
    expect(allocateStatementId('drill', ['part0_v0'], ctx(stmts))).toBe('part0_v1')
  })

  it('同模型多次操作 → 版本递增', () => {
    const stmts = [
      makeStmt('part0_v0', 'box'),
      makeStmt('part0_v1', 'drill', ['part0_v0']),
    ]
    expect(allocateStatementId('extrude', ['part0_v1'], ctx(stmts))).toBe('part0_v2')
  })

  it('布尔 → 新模型', () => {
    const stmts = [
      makeStmt('part0_v0', 'box'),
      makeStmt('part1_v0', 'sphere'),
    ]
    expect(allocateStatementId('boolean', ['part0_v0', 'part1_v0'], ctx(stmts))).toBe('part2_v0')
  })

  it('布尔后继续操作 → 跟随布尔结果的模型号', () => {
    const stmts = [
      makeStmt('part0_v0', 'box'),
      makeStmt('part1_v0', 'sphere'),
      makeStmt('part2_v0', 'boolean', ['part0_v0', 'part1_v0']),
    ]
    expect(allocateStatementId('drill', ['part2_v0'], ctx(stmts))).toBe('part2_v1')
  })

  it('输入为旧 st_* 格式 → 分配新模型', () => {
    const stmts: CadStatement[] = []
    expect(allocateStatementId('drill', ['st_somePart_1'], ctx(stmts))).toBe('part0_v0')
  })

  it('空 inputs 但 op 非创建型 → 仍分配新模型', () => {
    expect(allocateStatementId('drill', [], ctx())).toBe('part0_v0')
  })

  it('多模型场景：box → sphere → subtract → drill', () => {
    const stmts: CadStatement[] = []
    // 1. box
    const boxId = allocateStatementId('box', [], ctx(stmts))
    expect(boxId).toBe('part0_v0')
    stmts.push(makeStmt(boxId, 'box'))

    // 2. sphere
    const sphereId = allocateStatementId('sphere', [], ctx(stmts))
    expect(sphereId).toBe('part1_v0')
    stmts.push(makeStmt(sphereId, 'sphere'))

    // 3. subtract (boolean)
    const boolId = allocateStatementId('boolean', [boxId, sphereId], ctx(stmts))
    expect(boolId).toBe('part2_v0')
    stmts.push(makeStmt(boolId, 'boolean', [boxId, sphereId]))

    // 4. drill on boolean result
    const drillId = allocateStatementId('drill', [boolId], ctx(stmts))
    expect(drillId).toBe('part2_v1')
  })
})

describe('allocateSplitIds', () => {
  it('分割 → 两个新模型', () => {
    const stmts = [makeStmt('part0_v0', 'box')]
    const { front, back } = allocateSplitIds(ctx(stmts))
    expect(front).toBe('part1_v0')
    expect(back).toBe('part2_v0')
  })

  it('空场景 → part0_v0 和 part1_v0', () => {
    const { front, back } = allocateSplitIds(ctx())
    expect(front).toBe('part0_v0')
    expect(back).toBe('part1_v0')
  })
})

describe('工具函数', () => {
  it('isPartVmId', () => {
    expect(isPartVmId('part0_v0')).toBe(true)
    expect(isPartVmId('part12_v3')).toBe(true)
    expect(isPartVmId('st_somePart_1')).toBe(false)
    expect(isPartVmId('part0')).toBe(false)
  })

  it('getModelNum', () => {
    expect(getModelNum('part0_v0')).toBe(0)
    expect(getModelNum('part5_v2')).toBe(5)
    expect(getModelNum('st_x_1')).toBeNull()
  })

  it('getVersionNum', () => {
    expect(getVersionNum('part0_v0')).toBe(0)
    expect(getVersionNum('part5_v2')).toBe(2)
    expect(getVersionNum('st_x_1')).toBeNull()
  })
})
