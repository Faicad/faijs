/**
 * api/split-by-plane-naming — 多产物 op 具名产物（positive/negative）的身份登记
 *
 * `splitByPlane` 声明 `outputs: ['positive','negative']`，产物是 `Record<string, Shape>`。
 * 语言层两种写法都必须能用成员作后续 op 的输入：
 *   · 契约写法（解构）：`const { positive, negative } = cad.splitByPlane(...)`
 *   · 成员访问：`const sp = cad.splitByPlane(...); cad.translate(sp.negative, ...)`
 *
 * 2026-10-27：成员访问写法此前不登记成员 PartName，后续 op 触发血缘 N1
 * （`E_TOPO_UNTRACKED_INPUT`）。修复在 `cad-runtime/direct-executor.ts` 的
 * `registerOutputIdentity`——多产物 Record 的成员逐个登记 `<var>.<key>`。
 * 本用例在 occt / smlib 两引擎各钉一遍（该缺陷与内核无关）。
 *
 * Run: npx vitest run test/api/split-by-plane-naming.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { registerSmlibBrepEngine } from '../../src/brep/engine/adapters/smlib'
import { createEditorRuntime } from '../support/editor-ops'

const BOX = `const b = cad.box(10, 10, 10)`

/** 契约写法：解构具名产物。 */
const DESTRUCTURE = `${BOX}
const { positive, negative } = cad.splitByPlane(b, { point: [0, 0, 5], normal: [0, 0, 1] })
const t = cad.translate(negative, { offset: [1, 0, 0] })
t.keep()
`

/** 成员访问写法：先存整体，再取成员作输入。 */
const MEMBER = `${BOX}
const sp = cad.splitByPlane(b, { point: [0, 0, 5], normal: [0, 0, 1] })
const t = cad.translate(sp.negative, { offset: [1, 0, 0] })
t.keep()
`

function createNodePorts(): HostPorts {
  return { events: { emit: () => undefined } }
}

async function run(register: () => Promise<void> | void, code: string): Promise<ExecutionResult> {
  __resetEngineRegistriesForTests()
  await register()
  const runtime = createEditorRuntime(createNodePorts(), 'brep')
  return runtime.execute(code)
}

describe('splitByPlane 具名产物身份登记（解构 / 成员访问）', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('occt · 解构写法', async () => {
    const r = await run(registerOcctBrepEngine, DESTRUCTURE)
    expect(r.failedAt).toBeUndefined()
  }, 300_000)

  it('occt · 成员访问写法 sp.negative', async () => {
    const r = await run(registerOcctBrepEngine, MEMBER)
    expect(r.failedAt).toBeUndefined()
  }, 300_000)

  it('smlib · 解构写法', async () => {
    const r = await run(registerSmlibBrepEngine, DESTRUCTURE)
    expect(r.failedAt).toBeUndefined()
  }, 300_000)

  it('smlib · 成员访问写法 sp.negative', async () => {
    const r = await run(registerSmlibBrepEngine, MEMBER)
    expect(r.failedAt).toBeUndefined()
  }, 300_000)
})