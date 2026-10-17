/**
 * 宿主注入命名空间的「免 import」形态 —— 固化
 * `3d_editor/docs/plans/2026-10-15-weapp-assembly-animation-workbench-design.md` §4.4 的依据。
 *
 * 背景：小程序装配/动画工作台要把 `anim` 命名空间由宿主经 `registerLib` 注入，脚本里
 * **可以不写** `import * as anim from 'fai-animation'`（AI 生成的脚本更短，也少一个
 * specifier 要与宿主版本对齐）。设计文档当时只有**读码结论**：`registerLib(binding, ns)`
 * 之后注册名进 `namespaces`，元数据提取与安全扫描认它是已知名，调用位被重写为
 * `__ns.<binding>.<fn>(`。全仓没有一条测试证明它成立。
 *
 * 本文件把两条形态都钉住，并钉住「未注册名不可用」这个边界，使 §4.4 从读码结论变成
 * 可重复执行的证据：
 * - 免 import：`anim.motion(...)` 直接可用；
 * - 显式 import：`import * as anim from '<packageName>'` 照常工作（两条入口是同一机制的
 *   两侧，不是兼容层）；
 * - 未注册：`foo.motion(...)` 在**解析期**就被安全扫描拒绝（抛 `SEC_FREE_IDENT`），不是
 *   运行期 `failedAt`——注册是必要条件，且拒绝发生在更早的阶段。
 *
 * 后端取 `interpreter`——weapp worker 的被迫选择（禁 eval 环境），免 import 的文本重写
 * 必须在该后端下同样成立。
 */
import { describe, it, expect } from 'vitest'
import { createRuntime, type CadRuntime } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import type { LibNamespace } from '../../src/runtime-state'

interface MotionCall {
  name: string
  angle: number
}

/** 假的 anim 命名空间：记录调用参数，返回普通值（不需要几何）。 */
function makeAnimNs(calls: MotionCall[]): LibNamespace {
  return {
    motion: (name: string, angle: number) => {
      calls.push({ name, angle })
      return { name, angle }
    },
  }
}

/** interpreter 后端的 runtime + 已注册的 `anim` 命名空间。 */
function mkRuntime(calls: MotionCall[]): CadRuntime {
  const ports = { events: { emit: () => {} } } as unknown as HostPorts
  const rt = createRuntime(ports, 'mesh', undefined, { execBackend: 'interpreter' })
  rt.registerLib('anim', makeAnimNs(calls), { packageName: 'fai-animation', autoLift: false })
  return rt
}

describe('宿主注入命名空间：免 import 与显式 import 并存（interpreter 后端）', () => {
  it('免 import：脚本直接写 anim.motion(...) 即被解析为已注册命名空间的调用', async () => {
    const calls: MotionCall[] = []
    const r = await mkRuntime(calls).execute("let j = anim.motion('wave', 90)")
    expect(r.failedAt).toBeUndefined()
    // 调用真的执行了（不是被静态跳过）
    expect(calls).toEqual([{ name: 'wave', angle: 90 }])
  })

  it('显式 import：写 import 行同样可用（同一机制的另一侧，不是兼容层）', async () => {
    const calls: MotionCall[] = []
    const r = await mkRuntime(calls).execute(
      ["import * as anim from 'fai-animation'", "let j = anim.motion('spin', 180)"].join('\n'),
    )
    expect(r.failedAt).toBeUndefined()
    expect(calls).toEqual([{ name: 'spin', angle: 180 }])
  })

  it('未注册命名空间在解析期即被拒：foo.motion(...) 抛 SEC_FREE_IDENT（注册是必要条件）', async () => {
    const calls: MotionCall[] = []
    // 实测：未知命名空间不是运行期 failedAt，而是**解析/安全扫描期**抛 ParseError
    // （`runtime.ts:991` 的 extractMetadata → security-scanner）。比执行期更早、更响亮。
    await expect(mkRuntime(calls).execute("let j = foo.motion('wave', 90)")).rejects.toThrow(
      /SEC_FREE_IDENT[\s\S]*unknown identifier "foo"/,
    )
    expect(calls).toEqual([])
  })

  it('与后端无关：vm 后端下免 import 形态同样成立', async () => {
    const calls: MotionCall[] = []
    const ports = { events: { emit: () => {} } } as unknown as HostPorts
    const rt = createRuntime(ports, 'mesh', undefined, { execBackend: 'vm' })
    rt.registerLib('anim', makeAnimNs(calls), { packageName: 'fai-animation', autoLift: false })
    const r = await rt.execute("let j = anim.motion('wave', 90)")
    expect(r.failedAt).toBeUndefined()
    expect(calls).toEqual([{ name: 'wave', angle: 90 }])
  })
})
