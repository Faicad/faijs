/**
 * P 四（4.4）e2e — 真实 libLoader 自动装载 @faicad/gear-lib-demo 完整命名空间。
 *
 * 回归焦点（lib-id）：自动装载会把包的真实 exports 原样注册——其中包含一个
 * module-namespace 子对象 `mockBrep`。computeLibId 对任意导出值做 `String()`
 * 时，module-namespace exotic 对象（无 toString/toPrimitive）会抛
 * "Cannot convert object to primitive value"，直接炸掉 registerLib/register 过程。
 * 本测试以完整命名空间走 execute → autoLoadLibs → registerLib 链路，
 * 证明整包装载、库调用、cad.union 全链路可用。
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import * as gearPkg from '@faicad/gear-lib-demo'
import type { StdlibNamespace } from '@faicad/faijs-core/runtime-state'
import type { LibLoader } from '@faicad/faijs-core/cad-runtime/ports'

/** 与浏览器 demo 等价的 libLoader：完整命名空间，不走手工投影。 */
const loader: LibLoader = {
  loadLib: async () => gearPkg as unknown as StdlibNamespace,
  listLibs: () => ['gear-lib-demo'],
  options: { compat: true },
}

const SCRIPT = [
  "import * as gear from 'gear-lib-demo'",
  'let g1 = gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })',
  'let t1 = gear.thread({ radius: 5, pitch: 1, height: 20 })',
  'let u1 = cad.union(g1, t1)',
].join('\n')

describe('P四 4.4 autoLoadLibs with the full gear-lib-demo namespace', () => {
  let result: Awaited<ReturnType<ReturnType<typeof createRuntime>['execute']>>

  beforeAll(async () => {
    await registerOcctBrepEngine()
    const runtime = createRuntime({ ...createNodePorts(), libLoader: loader }, 'auto')
    result = await runtime.execute(SCRIPT)
  }, 240000)

  it('① 自动装载 + 整包执行成功（含 module-namespace 子对象的 lib-id 计算）', () => {
    expect(result.failedAt).toBeUndefined()
    expect(result.outputs.size).toBe(3)
    expect(result.terminals.length).toBe(3)
  })
})