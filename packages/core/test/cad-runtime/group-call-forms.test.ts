/**
 * @vitest-environment node
 *
 * group / assembly 双调用形态（2026-10-23）：
 *   · 对象形态（既有契约）：`cad.group({ name?, members? })` —— 回归保护
 *   · 位置参数形态（新增兼容）：`cad.group(a, b, ...)` —— 归一化为 members
 *
 * 断言两种形态在 ExecutionResult 面（compounds / terminals / outputs /
 * compoundNames）完全等价，并在 mesh / brep 两种模式下一致（group 是结构壳、
 * 无独立几何，结构面必须不随链路漂移）。
 *
 * Run: npx vitest run test/cad-runtime/group-call-forms.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { asPartName } from '../../src/identity'
import { getKernel } from '../../src/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { HostPorts, EventSink, ExecutionMode } from '../../src/cad-runtime/ports'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: unknown }> = []
  emit(event: string, detail: unknown): void {
    this.events.push({ event, detail })
  }
  clear(): void {
    this.events.length = 0
  }
}

function makeRuntime(mode: ExecutionMode): CadRuntime {
  return new CadRuntime({ events: new TestEventSink() } as HostPorts, mode, {
    cad: createApiNamespaceWithEditorOps(),
  })
}

async function run(mode: ExecutionMode, code: string) {
  const runtime = makeRuntime(mode)
  return { runtime, result: await runtime.execute(code) }
}

/** 结构面快照：compounds（key→成员序）+ terminals（有序）+ compoundNames。 */
function structureOf(result: { compounds?: Map<string, string[]>; terminals?: Array<{ id: string }>; compoundNames?: Map<string, string> }) {
  return {
    compounds: JSON.stringify([...(result.compounds ?? new Map()).entries()]),
    terminals: (result.terminals ?? []).map((t) => t.id).join(','),
    names: JSON.stringify([...(result.compoundNames ?? new Map()).entries()]),
  }
}

describe('cad.group 双调用形态（mesh 模式）', () => {
  it('位置参数 cad.group(a, b) 与对象形态 cad.group({ members }) 结构面等价', async () => {
    const positional = await run('mesh', [
      'const a = cad.box(10, 10, 10, { centered: true })',
      'const b = cad.box(20, 20, 20, { centered: true })',
      'const g = cad.group(a, b)',
    ].join('\n'))
    const object = await run('mesh', [
      'const a = cad.box(10, 10, 10, { centered: true })',
      'const b = cad.box(20, 20, 20, { centered: true })',
      'const g = cad.group({ members: [a, b] })',
    ].join('\n'))

    // 成员被 keep 保留为终端、group 本身是 compound 终端
    expect(positional.result.terminals?.map((t) => t.id)).toEqual(['a', 'b', 'g'])
    expect(object.result.terminals?.map((t) => t.id)).toEqual(['a', 'b', 'g'])
    expect(structureOf(positional.result)).toEqual(structureOf(object.result))
    expect(positional.result.compounds?.get(asPartName('g'))).toEqual([asPartName('a'), asPartName('b')])
    // 成员几何仍在 outputs（keep 保留）
    expect(positional.result.outputs.get(asPartName('a'))).toBeDefined()
    expect(positional.result.outputs.get(asPartName('b'))).toBeDefined()
  })

  it('位置参数 + setName → compoundNames 携带显示名（与对象形态同口径）', async () => {
    const code = [
      'const a = cad.box(10, 10, 10, { centered: true })',
      'const b = cad.box(20, 20, 20, { centered: true })',
      'const g = cad.group(a, b)',
      'g.setName("皮卡丘")',
    ].join('\n')
    const { result } = await run('mesh', code)
    expect(result.compounds?.get(asPartName('g'))).toEqual([asPartName('a'), asPartName('b')])
    expect(result.compoundNames?.get(asPartName('g'))).toBe('皮卡丘')
  })

  it('单成员位置参数 cad.group(a) → 单成员组（此前是空组，无存量依赖）', async () => {
    const { result } = await run('mesh', [
      'const a = cad.box(10, 10, 10, { centered: true })',
      'const g = cad.group(a)',
    ].join('\n'))
    expect(result.compounds?.get(asPartName('g'))).toEqual([asPartName('a')])
    expect(result.terminals?.map((t) => t.id)).toEqual(['a', 'g'])
  })

  it('对象形态回归：name / members / 空对象 / 空调用行为不变', async () => {
    const named = await run('mesh', [
      'const a = cad.box(10, 10, 10, { centered: true })',
      'const g = cad.group({ name: "G", members: [a] })',
    ].join('\n'))
    expect(named.result.compounds?.get(asPartName('g'))).toEqual([asPartName('a')])
    // 既有契约：name 参数进 behavior.name，不进 compoundNames（后者只由 setName 写 meta.name）
    expect(named.result.compoundNames?.size ?? 0).toBe(0)

    const emptyObj = await run('mesh', [
      'const a = cad.box(10, 10, 10, { centered: true })',
      'const g = cad.group({})',
    ].join('\n'))
    expect(emptyObj.result.compounds?.get(asPartName('g'))).toEqual([])

    const emptyCall = await run('mesh', [
      'const a = cad.box(10, 10, 10, { centered: true })',
      'const g = cad.group()',
    ].join('\n'))
    expect(emptyCall.result.compounds?.get(asPartName('g'))).toEqual([])
  })

  it('位置参数形态不产生 group_o<n> 成员副本（结构壳不展开）', async () => {
    const { result } = await run('mesh', [
      'const a = cad.box(10, 10, 10, { centered: true })',
      'const b = cad.box(20, 20, 20, { centered: true })',
      'const g = cad.group(a, b)',
    ].join('\n'))
    const terminalIds = (result.terminals ?? []).map((t) => t.id)
    expect(terminalIds.filter((id) => id.startsWith('g_o'))).toEqual([])
    expect(terminalIds).toEqual(['a', 'b', 'g'])
  })

  it('位置参数形态产物满足宿主消费侧组判定（weapp applyExecuteResult 不再抛错）', async () => {
    // 防回归：2026-10-23 用户皮卡丘脚本（cad.group 位置参数）在 weapp 抛
    // 「terminals 里有 g，但 outputs 里没有它的几何」——根因是位置参数下 group
    // 产出空成员 compound，宿主 groupStructuresOf 判它非组。本用例模拟宿主消费
    // 判定：每个无几何输出的终端必须被认作「用户组」或经 outputs 提供几何，
    // 否则即为可复现该报错的数据缺陷。
    const { result } = await run('mesh', [
      'const a = cad.box(10, 10, 10, { centered: true })',
      'const b = cad.box(20, 20, 20, { centered: true })',
      'const g = cad.group(a, b)',
      'g.setName("皮卡丘")',
    ].join('\n'))

    const terminalSet = new Set((result.terminals ?? []).map((t) => t.id))
    const groups = new Map<string, string[]>()
    for (const [id, members] of result.compounds ?? []) {
      if (members.length === 0) continue
      if (!members.every((m) => terminalSet.has(m))) continue
      groups.set(id, [...members])
    }
    for (const t of result.terminals ?? []) {
      const id = t.id
      if (result.outputs?.has(id)) continue
      expect(groups.has(id), `终端 ${id} 既无几何输出也不被认作用户组`).toBe(true)
    }
    expect(groups.get('g')).toEqual(['a', 'b'])
    expect(result.compoundNames?.get('g')).toBe('皮卡丘')
  })

  it('用户皮卡丘式组合：成员含 union 产物，位置参数 group 仍完整保留', async () => {
    // 贴近 2026-10-23 用户脚本：尾巴 = union 结果，group 成员里含它。union 消费
    // 其输入（a/b），keep 保留 union 产物与另一成员 → terminals 只含存活件与组。
    const { result } = await run('mesh', [
      'const a = cad.box(10, 10, 10, { centered: true })',
      'const b = cad.box(20, 20, 20, { centered: true })',
      'const c = cad.box(5, 5, 5, { centered: true })',
      'const tail = cad.union(a, b)',
      'const g = cad.group(tail, c)',
    ].join('\n'))
    expect(result.terminals?.map((t) => t.id).sort()).toEqual(['c', 'g', 'tail'])
    expect(result.compounds?.get('g')).toEqual(['tail', 'c'])
    // 消费侧判定：无几何终端只有 g，且被认作用户组
    const terminalSet = new Set((result.terminals ?? []).map((t) => t.id))
    const groups = new Map<string, string[]>()
    for (const [id, members] of result.compounds ?? []) {
      if (members.length === 0) continue
      if (!members.every((m) => terminalSet.has(m))) continue
      groups.set(id, [...members])
    }
    for (const t of result.terminals ?? []) {
      const id = t.id
      if (result.outputs?.has(id)) continue
      expect(groups.has(id), `终端 ${id} 既无几何输出也不被认作用户组`).toBe(true)
    }
  })
})

describe('cad.assembly 双调用形态（mesh 模式）', () => {
  it('位置参数 cad.assembly(a, b) 与对象形态结构面等价（无约束语义）', async () => {
    const positional = await run('mesh', [
      'const a = cad.box(10, 10, 10, { centered: true })',
      'const b = cad.box(20, 20, 20, { centered: true })',
      'const g = cad.assembly(a, b)',
    ].join('\n'))
    const object = await run('mesh', [
      'const a = cad.box(10, 10, 10, { centered: true })',
      'const b = cad.box(20, 20, 20, { centered: true })',
      'const g = cad.assembly({ members: [a, b] })',
    ].join('\n'))
    expect(structureOf(positional.result)).toEqual(structureOf(object.result))
    expect(positional.result.compounds?.get(asPartName('g'))).toEqual([asPartName('a'), asPartName('b')])
  })
})

describe('group 双调用形态：mesh / brep 链路结构面一致', () => {
  beforeAll(async () => {
    await registerOcctBrepEngine()
    getKernel()
  }, 120000)

  it('位置参数 cad.group(a, b) 在两种模式下结构面相同', async () => {
    const code = [
      'const a = cad.box(10, 10, 10, { centered: true })',
      'const b = cad.box(20, 20, 20, { centered: true })',
      'const g = cad.group(a, b)',
    ].join('\n')
    const mesh = await run('mesh', code)
    const brep = await run('brep', code)
    expect(structureOf(mesh.result)).toEqual(structureOf(brep.result))
    expect(brep.result.compounds?.get(asPartName('g'))).toEqual([asPartName('a'), asPartName('b')])
  })
})

describe('结构壳 group / assembly 不登记合并拓扑（2026-10-23）', () => {
  beforeAll(async () => {
    await registerOcctBrepEngine()
    getKernel()
  }, 120000)

  const pikachuLike = (groupCall: string) =>
    [
      'const a = cad.box(10, 10, 10, { centered: true })',
      'const b = cad.box(20, 20, 20, { centered: true })',
      `const g = ${groupCall}`,
      'g.setName("皮卡丘")',
    ].join('\n')

  it('mesh 模式：组终端不出现在 topology / naming（宿主 putResultTopology 不再误报顺序错）', async () => {
    const { result } = await run('mesh', pikachuLike('cad.group(a, b)'))
    // 组是结构壳：拓扑/命名里不得有组名——组节点无几何版本，宿主无从挂载合并拓扑。
    // mesh 模式整体不产拓扑（undefined 视为无），组名更不得出现。
    expect(result.topology?.has('g') ?? false).toBe(false)
    expect(result.naming?.has('g') ?? false).toBe(false)
  })

  it('brep 模式：成员各自有拓扑，组名仍不出现在 topology / naming', async () => {
    const { result } = await run('brep', pikachuLike('cad.group(a, b)'))
    expect(result.topology?.has('a')).toBe(true)
    expect(result.topology?.has('b')).toBe(true)
    expect(result.topology?.has('g')).toBe(false)
    expect(result.naming?.has('g')).toBe(false)
  })

  it('对象形态 cad.group({ members }) 同样不登记组拓扑（回归保护）', async () => {
    const { result } = await run('brep', pikachuLike('cad.group({ members: [a, b] })'))
    expect(result.topology?.has('a')).toBe(true)
    expect(result.topology?.has('b')).toBe(true)
    expect(result.topology?.has('g')).toBe(false)
  })

  it('位置参数 cad.assembly(a, b) 不登记装配合并拓扑', async () => {
    const { result } = await run('brep', [
      'const a = cad.box(10, 10, 10, { centered: true })',
      'const b = cad.box(20, 20, 20, { centered: true })',
      'const g = cad.assembly(a, b)',
    ].join('\n'))
    expect(result.topology?.has('g')).toBe(false)
    expect(result.naming?.has('g')).toBe(false)
  })
})
