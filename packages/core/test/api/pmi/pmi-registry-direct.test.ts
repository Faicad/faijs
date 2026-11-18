/**
 * @vitest-environment node
 *
 * PMI 注册表（`api/pmi/registry.ts`）直呼单元测试——历史 L1 缺口补账：
 * `addPmiItem` / `ownPmiOf` / `collectPmiOf` / `pmiOf` / `clearPmiOfPart` /
 * `registerPmiParents` / `resetPmiRegistry`。
 *
 * 行为语义（与 pmi-propagation.test.ts 的脚本级用例互补）：注册表按产出语句 id
 * 索引；没有产出语句的零件走 `byUnowned` 兼容路径；无名 Shape 上的标注先进
 * pending，语句出口 flush 归位；`pmiOf` 注册表查不到时回退读 `shape.pmi` 字段。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  addPmiItem,
  addPendingPmiItem,
  flushPendingPmi,
  ownPmiOf,
  collectPmiOf,
  pmiOf,
  clearPmiOfPart,
  registerPmiParents,
  resetPmiRegistry,
} from '../../../src/api/pmi/registry'
import { generalNote } from '../../../src/api/pmi/types'
import { asPartName } from '../../../src/identity'

describe('PMI 注册表直呼（registry 单元）', () => {
  beforeEach(() => {
    resetPmiRegistry()
  })
  afterEach(() => {
    resetPmiRegistry()
  })

  it('addPmiItem → ownPmiOf / collectPmiOf 读回（unowned 兼容路径）', () => {
    addPmiItem(asPartName('p0'), generalNote({ items: [{ text: '锐边倒钝' }] }))
    expect(ownPmiOf(asPartName('p0'))).toHaveLength(1)
    expect(ownPmiOf(asPartName('p0'))[0]!.kind).toBe('generalNote')
    // 无血缘登记时 collectPmiOf == ownPmiOf（无上游可继承）
    expect(collectPmiOf(asPartName('p0'))).toHaveLength(1)
    // 未登记零件返回空数组，不抛
    expect(ownPmiOf(asPartName('pX'))).toEqual([])
  })

  it('clearPmiOfPart 清空该零件并阻断后续读回', () => {
    addPmiItem(asPartName('p0'), generalNote({ items: [{ text: 'x' }] }))
    clearPmiOfPart(asPartName('p0'))
    expect(ownPmiOf(asPartName('p0'))).toEqual([])
    expect(collectPmiOf(asPartName('p0'))).toEqual([])
  })

  it('addPendingPmiItem + flushPendingPmi：无名产物的标注归位到零件名下', () => {
    addPendingPmiItem(generalNote({ items: [{ text: '钻后毛刺' }] }))
    // flush 之前不挂在任何零件上
    expect(ownPmiOf(asPartName('drilled'))).toEqual([])
    flushPendingPmi(asPartName('drilled'))
    expect(ownPmiOf(asPartName('drilled'))).toHaveLength(1)
    // flush 后 pending 清空：再 flush 别的零件不会重复收到
    flushPendingPmi(asPartName('other'))
    expect(ownPmiOf(asPartName('other'))).toEqual([])
  })

  it('pmiOf：undefined → undefined；注册表无记录且无 pmi 字段 → undefined', () => {
    expect(pmiOf(undefined)).toBeUndefined()
    expect(pmiOf({})).toBeUndefined()
  })

  it('pmiOf 兼容回退：无名 Shape 自带 pmi 字段时原样读出', () => {
    const local = { pmi: { items: [generalNote({ items: [{ text: '纯数据标注' }] })] } }
    expect(pmiOf(local)?.items).toHaveLength(1)
    expect(pmiOf(local)!.items[0]!.kind).toBe('generalNote')
  })

  it('registerPmiParents：无名字的输入不登记父语句（不抛、不产生幽灵继承）', () => {
    registerPmiParents('s1' as never, [{}])
    addPmiItem(asPartName('p0'), generalNote({ items: [{ text: 'x' }] }))
    // 父登记失败不影响当前零件的读写
    expect(collectPmiOf(asPartName('p0'))).toHaveLength(1)
  })
})
