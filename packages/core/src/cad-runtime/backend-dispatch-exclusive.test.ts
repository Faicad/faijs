/**
 * backend-dispatch — 槽位互斥不变量（方案 2026-10-01 §3.2）
 *
 * 一个 Shape 只能携带**一种**链身份（BREP 精度链 / 网格实体 / 网格链面），不得同时
 * 携带两种：那意味着"这个零件既在精度链又在近似链上"，之后无论按哪一侧分派都是错的。
 * 这是**设计缺陷**而非可恢复状态，故在分派前置直接抛错，不给运行时"选边站"的机会。
 *
 * 注意：正常路径下这种状态**写不出来**（`attachMeshSolid` / `attachBrep` 两侧都
 * 已把互斥钉在写入点）。本用例直写身份槽来构造非法态，验证分派前的兜底校验
 * 确实会拦住它——这是最后一道闸，不是唯一一道。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { solid } from '../shape'
import { ensureSlot, attachMeshSolid, hasBrep, hasMeshSolid } from '../shape'
import { assertShapeSlotExclusive } from './backend-dispatch'
import type { Shape } from '../mesh/types'

const mesh = (): Shape => solid({ positions: new Float32Array(9), indices: new Uint32Array(3) })

describe('assertShapeSlotExclusive', () => {
  it('纯 mesh 零件（只有 meshSolid）放行', () => {
    const s = mesh()
    attachMeshSolid(s, 1)
    expect(() => assertShapeSlotExclusive([s])).not.toThrow()
  })

  it('纯 BREP 零件（只有 solid）放行', () => {
    const s = mesh()
    ensureSlot(s).solid = 1
    expect(() => assertShapeSlotExclusive([s])).not.toThrow()
  })

  it('两槽并存 → 抛 E_SHAPE_SLOT_EXCLUSIVE', () => {
    const s = mesh()
    // 绕过写入点校验，直接构造非法态（模拟第三方库/未来路径的误用）
    const slot = ensureSlot(s)
    slot.solid = 1
    slot.meshSolid = 2
    expect(hasBrep(s) && hasMeshSolid(s)).toBe(true)
    expect(() => assertShapeSlotExclusive([s])).toThrow(/E_SHAPE_SLOT_EXCLUSIVE/)
  })

  it('网格链面与 BREP 句柄并存 → 同样抛 E_SHAPE_SLOT_EXCLUSIVE（第三种链身份）', () => {
    const s = mesh()
    const slot = ensureSlot(s)
    slot.solid = 1
    slot.meshFace = 2
    expect(() => assertShapeSlotExclusive([s])).toThrow(/E_SHAPE_SLOT_EXCLUSIVE/)
  })

  it('写入点本身也拦：已有 BREP 句柄的形状不得再登记网格实体身份', () => {
    const b = mesh()
    ensureSlot(b).solid = 3
    expect(() => attachMeshSolid(b, 4)).toThrow(/E_SHAPE_SLOT_EXCLUSIVE/)
  })

  it('反向写入点的守卫同样存在（attachBrep 侧，经 fromBrep 不可达，属防御性）', () => {
    // attachBrep 是私有函数（shape.ts 刻意不导出——禁止绕开它手写登记）。
    // 其互斥守卫因此只能直接读源码确认；这里用源码断言把它钉住，防止被顺手删掉。
    // 2026-10-01 Phase 3：守卫从"只查网格实体"扩到"查两种网格链身份"（meshSolid /
    // meshFace），消息因此改为 mesh-chain handle。
    const src = readFileSync(new URL('../shape.ts', import.meta.url), 'utf-8')
    expect(src).toMatch(/E_SHAPE_SLOT_EXCLUSIVE: shape already carries a mesh-chain handle/)
  })
})
