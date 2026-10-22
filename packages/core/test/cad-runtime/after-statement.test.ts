/**
 * after-statement — 执行期流式预览钩子（2026-10-23 stream preview）
 *
 * 覆盖：
 * - afterStatement 逐**成功**单元触发（id = 's'+行号、行号正确；F1 重构后落账才触发）；
 * - 失败单元不触发本钩子，且执行失败不被吞（best-effort 只针对钩子自身）；
 * - 钩子抛错只记 console.error、不终止执行（F1 独立 try/catch）；
 * - 钩子返回 Promise 会被 await（背压语义：宿主让出收帧后再继续）；
 * - execute 全量路径（F2）与 update 增量重放路径（F3）都透传钩子；
 * - collectLiveSnapshot：执行中按行截断的中间视图 + 收尾终态与 result.terminals 一致；
 * - 无活跃执行时 collectLiveSnapshot 返回 []。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

const CODE = [
  'let part0 = cad.box(20, 20, 20, { centered: true })',
  'let part1 = cad.sphere({ radius: 10 })',
  'let part2 = cad.union(part0, part1)',
].join('\n')

let rt: CadRuntime

beforeEach(() => {
  // 每用例新实例：ctx 干净，collectLiveSnapshot 断言不受前例污染。
  // CadRuntime.execute 每次执行前自认领全局 backends（runtime.ts claimBackends），
  // 无需像 DirectExecutor 裸用那样先 warmup。
  rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespaceWithEditorOps() })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('afterStatement 钩子', () => {
  it('execute 逐成功单元触发（F2 全量路径），beforeStatement 照常共存', async () => {
    const after: Array<[string, number]> = []
    const before: string[] = []
    const out = await rt.execute(CODE, {
      beforeStatement: (id) => { before.push(id) },
      afterStatement: (id, lineNo) => { after.push([id, lineNo]) },
    })
    expect(out.failedAt).toBeUndefined()
    expect(after).toEqual([['s1', 1], ['s2', 2], ['s3', 3]])
    expect(before).toEqual(['s1', 's2', 's3'])
  })

  it('失败单元不触发 afterStatement，失败留在 failedAt', async () => {
    const calls: string[] = []
    // fillet 负半径在 op 层抛 OpError（E_FILLET_BAD_RADIUS）→ 留在 failedAt、
    // execute 正常 resolve。s1 已成功触发钩子，s2（失败单元）不触发。
    const badCode = [
      'let p = cad.box(10, 10, 10, { centered: true })',
      'let q = cad.fillet(p, { radius: -1 })',
    ].join('\n')
    const out = await rt.execute(badCode, {
      afterStatement: (id) => { calls.push(id) },
    })
    expect(out.failedAt).toBeTruthy()
    expect(out.failedAt!.lineNo).toBe(2)
    expect(calls).toEqual(['s1'])
  })

  it('钩子抛错是 best-effort：只记 console.error，不终止执行', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await rt.execute(CODE, {
      afterStatement: () => { throw new Error('channel down') },
    })
    expect(out.failedAt).toBeUndefined()
    expect(out.terminals.map((t) => t.id).sort()).toEqual(['part2'])
    // 断言必须在 mockRestore 之前（restore 会清空调用历史）
    expect(spy).toHaveBeenCalledTimes(3)
    spy.mockRestore()
  })

  it('返回 Promise 会被 await（背压生效：s3 在 s2 钩子 resolve 前不触发）', async () => {
    const events: string[] = []
    let releaseS2: () => void = () => {}
    const s2Gate = new Promise<void>((res) => { releaseS2 = res })
    const run = rt.execute(CODE, {
      afterStatement: (id) => {
        events.push(id)
        return id === 's2' ? s2Gate : undefined
      },
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(events).toEqual(['s1', 's2'])
    releaseS2()
    const out = await run
    expect(out.failedAt).toBeUndefined()
    expect(events).toEqual(['s1', 's2', 's3'])
  })

  it('update 增量重放路径透传（F3）', async () => {
    await rt.execute(CODE)
    const calls: string[] = []
    const newCode = CODE + '\nlet part3 = cad.box(3, 3, 3, { centered: true })'
    const out = await rt.update(CODE, newCode, {
      afterStatement: (id) => { calls.push(id) },
    })
    expect(out.failedAt).toBeUndefined()
    expect(calls).toEqual(['s4'])
    expect(out.terminals.map((t) => t.id).sort()).toEqual(['part2', 'part3'])
  })
})

describe('collectLiveSnapshot', () => {
  it('执行中按行截断的中间视图：s1→[part0]、s2→[part0,part1]、s3→[part2]', async () => {
    const seen = new Map<number, string[]>()
    const out = await rt.execute(CODE, {
      afterStatement: (_id, lineNo) => {
        seen.set(lineNo, rt.collectLiveSnapshot(lineNo).map((t) => t.id).sort())
      },
    })
    expect(out.failedAt).toBeUndefined()
    expect(seen.get(1)).toEqual(['part0'])
    expect(seen.get(2)).toEqual(['part0', 'part1'])
    expect(seen.get(3)).toEqual(['part2'])
  })

  it('收尾终态（不传行号）与 result.terminals 一致', async () => {
    const out = await rt.execute(CODE, { afterStatement: () => {} })
    const snap = rt.collectLiveSnapshot().map((t) => t.id).sort()
    expect(snap).toEqual(out.terminals.map((t) => t.id).sort())
  })

  it('getCurrentChanged：轮内累计、逐单元变化的 part 集', async () => {
    const seen = new Map<number, string[]>()
    await rt.execute(CODE, {
      afterStatement: (_id, lineNo) => {
        seen.set(lineNo, rt.getCurrentChanged().sort())
      },
    })
    // 轮内累计：s1 只含 part0；s2 含 part0+part1；s3 含全部三个（非单帧增量）
    expect(seen.get(1)).toEqual(['part0'])
    expect(seen.get(2)).toEqual(['part0', 'part1'])
    expect(seen.get(3)).toEqual(['part0', 'part1', 'part2'])
  })

  it('无活跃执行时 getCurrentChanged 返回 []', () => {
    const fresh = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespaceWithEditorOps() })
    expect(fresh.getCurrentChanged()).toEqual([])
  })

  it('无活跃执行时返回 []', () => {
    const fresh = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespaceWithEditorOps() })
    expect(fresh.collectLiveSnapshot()).toEqual([])
  })
})
