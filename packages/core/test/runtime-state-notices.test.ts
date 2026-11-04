/**
 * 运行时提示（runtime notices）直呼单元测试——历史 L1 缺口补账：
 * `reportRuntimeNotice` / `takeRuntimeNotices`。
 *
 * 语义：op 内部的非致命提示先进运行时状态，宿主收尾时取走（take 即清空）。
 */
import { describe, expect, it } from 'vitest'
import { reportRuntimeNotice, takeRuntimeNotices } from '../src/runtime-state'

describe('reportRuntimeNotice / takeRuntimeNotices 直呼', () => {
  it('report 后 take 原序取回，take 即清空（不重复消费）', () => {
    reportRuntimeNotice('[faijs] 提示一')
    reportRuntimeNotice('[faijs] 提示二')
    expect(takeRuntimeNotices()).toEqual(['[faijs] 提示一', '[faijs] 提示二'])
    expect(takeRuntimeNotices()).toEqual([])
  })

  it('未 report 时 take 返回空数组', () => {
    expect(takeRuntimeNotices()).toEqual([])
  })
})
