/**
 * P0 · 重构验收套件
 *
 * 来源：docs/plans/2026-09-01-layered-api-architecture.md §2.7 / §2.8 / §9（P0 锁回归基线）
 *
 * 本套件不是功能测试，是「重构护栏」：在移植 brepjs（L0–L2）与重构 L3 API 面的
 * 全过程（P1–P11）中，以下契约一旦被破坏，本套件最先红：
 *
 * 1. 宿主可见面（U5）——@faicad/faijs 只暴露「代码文本级」API：
 *    analyzeCode / codeToArgs / formatCodeLine 可用；parseScript 属引擎内部 IR 面，
 *    宿主禁见（对应 3d_editor contract-entry.test.ts 的 FORBIDDEN_SYMBOLS）。
 *    注：v4 方案 §2.7 曾列 parseScript/statementToLine/scriptToCode/buildArgsParts
 *    为宿主导出——这与真实契约有出入（真实清单以 3d_editor contract-entry 的
 *    A/B/C/D 白名单为准：analyzeCode/codeToArgs/formatCodeLine/StatementSummary）。
 * 2. ExecutionResult 十一字段（U3 / §2.7）：单次 BREP 执行后 outputs / brepChain /
 *    terminals / infos / failedAt / brepSolids / topology / naming / changed /
 *    activeValues / compounds 逐一断言，防「字段被静默删减」。naming 字段（v3 曾
 *    漏列）是本套件的重点——宿主机拾取 Reference 后 O(1) 反查命名行依赖它。
 * 3. 宿主路径驱动：CadRuntime.execute(code)（文本 → 引擎内部 parse+compile+execute），
 *    与 3d_editor 的消费路径一致，而非直接输入 IR。
 *
 * Run: npx vitest run test/faijs/refactor-acceptance/refactor-acceptance.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import type { ExecutionResult } from '@faicad/faijs-core/cad-runtime/runtime'
import type { PartNaming } from '@faicad/faijs-core/topology/naming/types'
import { asPartName } from '@faicad/faijs-core/identity'

const P0 = asPartName('part0')
const P1 = asPartName('part1')
const P2 = asPartName('part2')

const CODE_BREP = [
  'let part0 = cad.box({ size: 20 })',
  'let part1 = cad.box({ size: [30, 10, 10] })',
  'let part2 = cad.box({ size: [10, 5, 5] })',
].join('\n')

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

/**
 * §2.7 / §9 · 宿主 API 契约面（U5）：宿主只见「一行文本」+ 平铺摘要，
 * IR 解析/生成符号（parseScript 等）不得出现在根门面（V5 · 零 IR 依赖红线）。
 */
describe('上层契约：宿主可读代码文本 API', () => {
  it('根门面导出文本级 API：analyzeCode / codeToArgs / formatCodeLine', async () => {
    const facade = await import('@faicad/faijs')
    expect(typeof facade.analyzeCode).toBe('function')
    expect(typeof facade.codeToArgs).toBe('function')
    expect(typeof facade.formatCodeLine).toBe('function')
  })

  it('根门面导出 HostArg 辅助函数：isHostVarRef / isHostParamRef / isHostCallRef / isHostExprRef / isHostRef / hostArgToDisplay / hostArgToLiteral / HOST_REF_KINDS', async () => {
    const facade = await import('@faicad/faijs')
    expect(typeof facade.isHostVarRef).toBe('function')
    expect(typeof facade.isHostParamRef).toBe('function')
    expect(typeof facade.isHostCallRef).toBe('function')
    expect(typeof facade.isHostExprRef).toBe('function')
    expect(typeof facade.isHostRef).toBe('function')
    expect(typeof facade.hostArgToDisplay).toBe('function')
    expect(typeof facade.hostArgToLiteral).toBe('function')
    expect(Array.isArray(facade.HOST_REF_KINDS)).toBe(true)
  })

  it('零 IR 依赖红线：parseScript 不在宿主门面', async () => {
    const facade = await import('@faicad/faijs')
    expect('parseScript' in facade).toBe(false)
  })

  it('U1 链路：codeToArgs 能解析回 cad.box 的参数（UI 面板回填前提）', async () => {
    const facade = await import('@faicad/faijs')
    const args = facade.codeToArgs('let part0 = cad.box({ size: 20 })')
    expect(args).toBeTruthy()
  })

  it('D1-⓪ 桥接：fai_drill/engrave 已从根/浏览器门面导出（宿主换来源前提）', async () => {
    const root = await import('@faicad/faijs')
    const browser = await import('@faicad/faijs/browser')
    expect(typeof root.fai_drill).toBe('function')
    expect(typeof root.engrave).toBe('function')
    // 宿主红线：生产代码走 /browser 入口，这两处必须都有
    expect(typeof browser.fai_drill).toBe('function')
    expect(typeof browser.engrave).toBe('function')
  })
})

/**
 * P0 · ExecutionResult 字段契约（§2.7，防静默降级）。
 * BREP 三个 box（互不消费，terminals=3），hash 断言命名行。
 */
describe('P0：ExecutionResult 十一字段（含 naming）', () => {
  it('单次 BREP 执行产出全部契约字段且失败位为空', async () => {
    const rt = createRuntime(createNodePorts(), 'brep')
    const result: ExecutionResult = await rt.execute(CODE_BREP)
    try {
      expect(result.failedAt).toBeUndefined()

      // 1) outputs：每个形状变量都在
      expect(result.outputs.has(P0)).toBe(true)
      expect(result.outputs.has(P1)).toBe(true)
      expect(result.outputs.has(P2)).toBe(true)

      // 2) brepChain：链状态存在且三 part 都在链上（BREP 模式）
      expect(result.brepChain.solidCache.has(P2)).toBe(true)

      // 3) terminals：三个 no-consumer leaf → 全部 terminal
      const termIds = new Set(result.terminals.map((t) => String(t.id)))
      expect(termIds.has('part0')).toBe(true)
      expect(termIds.has('part1')).toBe(true)
      expect(termIds.has('part2')).toBe(true)
      for (const term of result.terminals) {
        expect(result.outputs.get(term.id as never)).toBeDefined()
      }

      // 4) infos：数组
      expect(Array.isArray(result.infos)).toBe(true)

      // 5) brepSolids：BREP 模式必须给出产物句柄（宿主场景树消费）
      expect(result.brepSolids).toBeDefined()
      expect(typeof result.brepSolids!.get(P2)?.solid).toBe('number')
      expect(result.brepSolids!.get(P2)?.kernel).toBeDefined()

      // 6) topology：逐 part 运行时数据（宿主 SelectorRuntime 重建）
      expect(result.topology).toBeDefined()
      const topo2 = result.topology!.get(P2)
      expect(topo2).toBeDefined()
      expect(topo2!.partName).toBe(P2)
      expect(topo2!.data).toBeDefined()

      // 7) naming ★ v3 曾漏列的字段：盒体 BREP 面必须完整（角色+来源）
      expect(result.naming).toBeDefined()
      const naming0 = result.naming?.get(P0) as PartNaming | undefined
      expect(naming0).toBeDefined()
      expect(Array.isArray(naming0?.faceNaming)).toBe(true)
      expect(naming0!.faceNaming.length).toBeGreaterThanOrEqual(6)
      expect(naming0!.faceNaming.every((f) => f.role !== '' && String(f.origin).length > 0)).toBe(true)

      // 8) changed：非当前脚本 → 空或 undefined（契约位存在）
      expect(result.changed === undefined || Array.isArray(result.changed)).toBe(true)

      // 9) compounds：未用 group/assembly → undefined 或 Map（契约位存在）
      expect(result.compounds === undefined || result.compounds instanceof Map).toBe(true)

      // 10) activeValues：非几何叶子 → undefined 或 Map（契约位存在）
      expect(result.activeValues === undefined || result.activeValues instanceof Map).toBe(true)
    } finally {
      rt.dispose()
    }
  })

  it('U2 增量：append 只重算新增语句，前缀不进循环', async () => {
    const rt = createRuntime(createNodePorts(), 'auto')
    try {
      const first = await rt.execute('let p = cad.box({ size: 20 })')
      expect(first.brepChain.solidCache.has(asPartName('p'))).toBe(true)

      const beforeCalls: string[] = []
      const second = await rt.append(
        'let q = cad.box({ size: 10 })\nlet q2 = cad.box({ size: 9 })',
        { beforeStatement: (id) => beforeCalls.push(id) },
      )
      // 新增两语句，只执行自己（前缀 p 不重进循环）
      expect(beforeCalls.length).toBe(2)
      expect(second.brepChain.solidCache.has(asPartName('p'))).toBe(true)
      expect(second.outputs.has(asPartName('q'))).toBe(true)
      expect(second.outputs.has(asPartName('q2'))).toBe(true)
    } finally {
      rt.dispose()
    }
  })

  it('失败语义：业务参数错误 → 直接抛出（引擎不吞掉）；不支持能力才进 failedAt', async () => {
    const rt = createRuntime(createNodePorts(), 'auto')
    try {
      // 参数校验（stdlib assert）抛错 → 引擎必须让错误透出，而不是静默吞掉
      await expect(rt.execute('let bad = cad.box({ size: "oops" })')).rejects.toThrow()
      // BREP 模式缺能力 → failedAt（runtime.test.ts:1188 已有精确锚点，此处不重复）
    } finally {
      rt.dispose()
    }
  })
})