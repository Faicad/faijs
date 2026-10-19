/**
 * P0 前缀重放式 update 增量执行测试
 *
 * 覆盖（§7 测试计划）：
 * 1. 等价对拍（核心）：改中间语句参数 / 末尾追加 / 改参数行 / 只改注释 / 增删空行
 * 2. 零变更：update(c, c) → executedLines 为空、changed 为空
 * 3. 重赋值链（回归 §4.3 公式）
 * 4. 闸门退化：删除语句（G2）、oldCode 不一致（G3）
 * 5. keep 隔离
 * 6. 失败降级
 *
 * 测试风格参照 function-execute.test.ts（内联代码字符串 + makeRuntime()）。
 * mesh 模式（无 occt-wasm 依赖）执行快速路径。
 *
 * 后端覆盖（2026-10-19 补）：语义用例（P0-5 起的增量等价、零变更、重赋值链、
 * 闸门退化、失败降级）在两个后端各跑一遍——`vm`（new Function）与 `interpreter`
 * （AST 解释器）。小程序端固定 `execBackend:'interpreter'`
 * （见 3d_editor:packages/platform/src/weapp/faijs.worker.ts），而原套件只在默认
 * `vm` 下跑，解释器的「前缀 ctx 复用 + InterpClosure 保留 + 重赋值链清理」没有被钉过。
 * 参数化而非另开一份，避免两端用例各自漂移。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import { DirectExecutor } from '../../src/cad-runtime/direct-executor'
import { stableFingerprint } from '../../src/cad-runtime/content-key'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { isMeshShape } from '../../src/mesh/types'
import { computeContentKey } from '../../src/cad-runtime/content-key'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

/** 执行后端：vm = new Function；interpreter = AST 解释器（小程序端唯一可用）。 */
type Backend = 'vm' | 'interpreter'
const BACKENDS: readonly Backend[] = ['vm', 'interpreter']

function makeRuntime(mode: 'mesh' | 'auto' = 'mesh', execBackend: Backend = 'vm'): CadRuntime {
  return new CadRuntime(defaultPorts(), mode, { cad: createApiNamespaceWithEditorOps() }, { execBackend })
}

/** 收集 mesh 输出内容 key（名序排序；几何一致性判定）。 */
function fingerprintOutputs(result: Awaited<ReturnType<CadRuntime['execute']>>): string[] {
  const keys: string[] = []
  for (const [name, shape] of result.outputs) {
    if (isMeshShape(shape)) keys.push(`${name}:${computeContentKey(shape.positions, shape.indices)}`)
  }
  return keys.sort()
}

/** 全量执行基线：fresh runtime execute(newCode) → result。 */
async function fullBaseline(newCode: string, execBackend: Backend = 'vm') {
  const rt = makeRuntime('mesh', execBackend)
  const result = await rt.execute(newCode)
  return {
    outputs: fingerprintOutputs(result),
    terminals: result.terminals.map((t) => String(t.id)).sort(),
    changed: result.changed?.map(String).sort(),
  }
}

// ── P0-1: unitRanges + endLine ──

describe('P0-1: unitRanges + endLine', () => {
  const rt = makeRuntime()
  const cadNs = createApiNamespaceWithEditorOps()

  beforeAll(async () => {
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  })

  it('扁平行 → 每行一个单行区间', () => {
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const code = [
      'let part0 = cad.box(10, 10, 10, { centered: true })',
      'let part1 = cad.sphere({ radius: 5 })',
    ].join('\n')
    const { ranges, lineOffset } = ex.unitRanges(code)
    expect(lineOffset).toBe(0)
    expect(ranges).toHaveLength(2)
    expect(ranges[0]).toEqual({ lineNo: 1, endLine: 1 })
    expect(ranges[1]).toEqual({ lineNo: 2, endLine: 2 })
  })

  it('块 → 起始行到结束行（闭区间）', () => {
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const code = [
      'for (let i = 0; i < 3; i++) {',
      '  let p = cad.box(i + 1, i + 1, i + 1)',
      '}',
    ].join('\n')
    const { ranges, lineOffset } = ex.unitRanges(code)
    expect(lineOffset).toBe(0)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].lineNo).toBe(1)
    expect(ranges[0].endLine).toBe(3)
  })

  it('函数定义 → 闭合区间', () => {
    const ex = new DirectExecutor({ namespaces: { cad: cadNs } })
    const code = [
      'function myFn(a) {',
      '  return cad.scale(a, 2)',
      '}',
      'let part0 = cad.box(10, 10, 10, { centered: true })',
    ].join('\n')
    const { ranges } = ex.unitRanges(code)
    expect(ranges).toHaveLength(2)
    expect(ranges[0].lineNo).toBe(1)
    expect(ranges[0].endLine).toBe(3)
    expect(ranges[1].lineNo).toBe(4)
    expect(ranges[1].endLine).toBe(4)
  })
})

// ── M6: 语句分隔契约（钉住「; 与换行等价」的实测结论） ──
//
// GOTCHA: 曾有下游把「一行里用 `;` 分隔多条语句」误判成「首条之后被静默截断」，
// 进而推断 `.fai.js` 是「换行分隔」语言。实测（0.29.5 / 0.29.6 一致）不成立：
// 语句切分由 acorn 完成，`;` 与换行在语法层等价。真正会抛错的是「单行无分隔符」，
// 那是正确的 JS 行为，不是静默截断。本组钉住该契约，防止误判卷土重来。

describe('M6: 语句分隔契约（; ≡ 换行）', () => {
  const ex = new DirectExecutor({ namespaces: { cad: createApiNamespaceWithEditorOps() } })

  it('单行分号分隔 → 三条 unit，与换行版条数一致', () => {
    const oneLine = 'let a = cad.box(1,1,1); let b = cad.box(2,2,2); let c = cad.box(3,3,3)'
    const multiLine = 'let a = cad.box(1,1,1)\nlet b = cad.box(2,2,2)\nlet c = cad.box(3,3,3)'
    const a = ex.unitRanges(oneLine)
    const b = ex.unitRanges(multiLine)
    expect(a.ranges).toHaveLength(3)
    expect(b.ranges).toHaveLength(3)
    // 分号版三条同处第 1 行；换行版逐行递进——单位数不受分隔符种类影响。
    expect(a.ranges).toEqual([
      { lineNo: 1, endLine: 1 },
      { lineNo: 1, endLine: 1 },
      { lineNo: 1, endLine: 1 },
    ])
    expect(b.ranges).toEqual([
      { lineNo: 1, endLine: 1 },
      { lineNo: 2, endLine: 2 },
      { lineNo: 3, endLine: 3 },
    ])
  })

  it('单行无分隔符 → SyntaxError（正确 JS 行为，非静默截断）', () => {
    expect(() => ex.unitRanges('let a = cad.box(1,1,1) let b = cad.box(2,2,2)')).toThrow(/Unexpected token/)
  })
})

// ── P0-2: replayFrom ──

describe('P0-2: replayFrom', () => {
  const rt = makeRuntime()
  const cadNs = createApiNamespaceWithEditorOps()

  beforeAll(async () => {
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  })

  it('replayFrom(code, 1) 的结果与 execute(code) 全量一致', async () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.sphere({ radius: 10 })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n')

    const exFull = new DirectExecutor({ namespaces: { cad: cadNs } })
    const fullOut = await exFull.execute(code)
    expect(fullOut.failedAt).toBeUndefined()

    const exReplay = new DirectExecutor({ namespaces: { cad: cadNs } })
    const replayOut = await exReplay.replayFrom(code, 1)
    expect(replayOut.failedAt).toBeUndefined()

    const fpFn = (ex: DirectExecutor): string[] => {
      const keys: string[] = []
      for (const [name, v] of Object.entries(ex.ctx)) {
        if (isMeshShape(v)) keys.push(`${name}:${computeContentKey(v.positions, v.indices)}`)
      }
      return keys.sort()
    }
    expect(fpFn(exReplay)).toEqual(fpFn(exFull))
  })
})

// ── P0-3: stableFingerprint ──

describe('P0-3: stableFingerprint', () => {
  it('等值同指纹', () => {
    expect(stableFingerprint({ a: 1, b: 2 })).toBe(stableFingerprint({ a: 1, b: 2 }))
  })

  it('键序无关', () => {
    expect(stableFingerprint({ a: 1, b: 2 })).toBe(stableFingerprint({ b: 2, a: 1 }))
  })

  it('变值异指纹', () => {
    expect(stableFingerprint({ a: 1 })).not.toBe(stableFingerprint({ a: 2 }))
  })

  it('null/undefined 归一化', () => {
    expect(stableFingerprint(undefined)).toBe(stableFingerprint(null))
  })

  it('循环引用不挂死', () => {
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj
    const fp = stableFingerprint(obj)
    expect(typeof fp).toBe('string')
    expect(fp.length).toBeGreaterThan(0)
  })

  it('函数与 Symbol 有确定降级规则', () => {
    const fn = (): void => {}
    const sym = Symbol('test')
    expect(typeof stableFingerprint(fn)).toBe('string')
    expect(typeof stableFingerprint(sym)).toBe('string')
    expect(stableFingerprint(fn)).toBe(stableFingerprint(fn))
  })

  it('Map 键序无关', () => {
    const m1 = new Map([['a', 1], ['b', 2]])
    const m2 = new Map([['b', 2], ['a', 1]])
    expect(stableFingerprint(m1)).toBe(stableFingerprint(m2))
  })

  it('数组保持顺序敏感', () => {
    expect(stableFingerprint([1, 2, 3])).not.toBe(stableFingerprint([3, 2, 1]))
  })
})

// 两个后端各跑一遍（见文件头「后端覆盖」）。
for (const backend of BACKENDS) {
  // ── P0-5/P0-6: update 增量等价对拍 ──

  describe('P0-5/P0-6: update 增量等价对拍', () => {
    const base = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.sphere({ radius: 10 })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n')

    it('① 改中间一条语句的尺寸参数 → 增量与全量一致', async () => {
      const rt = makeRuntime('mesh', backend)
      await rt.execute(base)
      const newCode = [
        'let part0 = cad.box(30, 30, 30, { centered: true })',
        'let part1 = cad.sphere({ radius: 10 })',
        'let part2 = cad.union(part0, part1)',
      ].join('\n')
      const result = await rt.update(base, newCode)
      const baseline = await fullBaseline(newCode, backend)
      expect(fingerprintOutputs(result)).toEqual(baseline.outputs)
      expect(result.terminals.map((t) => String(t.id)).sort()).toEqual(baseline.terminals)
    })

    it('③ 末尾追加一条语句 → 增量与全量一致', async () => {
      const rt = makeRuntime('mesh', backend)
      await rt.execute(base)
      const newCode = base + '\nlet part3 = cad.box(5, 5, 5, { centered: true })'
      const result = await rt.update(base, newCode)
      const baseline = await fullBaseline(newCode, backend)
      expect(fingerprintOutputs(result)).toEqual(baseline.outputs)
      expect(result.terminals.map((t) => String(t.id)).sort()).toEqual(baseline.terminals)
    })

    it('⑤ 改参数行（字面量）→ 增量与全量一致', async () => {
      const codeWithParam = [
        'let size = 20',
        'let part0 = cad.box(size, size, size, { centered: true })',
      ].join('\n')
      const rt = makeRuntime('mesh', backend)
      await rt.execute(codeWithParam)
      const newCode = [
        'let size = 30',
        'let part0 = cad.box(size, size, size, { centered: true })',
      ].join('\n')
      const result = await rt.update(codeWithParam, newCode)
      const baseline = await fullBaseline(newCode, backend)
      expect(fingerprintOutputs(result)).toEqual(baseline.outputs)
    })

    it('⑥ 只改注释 → 零变更路径，outputs 不变', async () => {
      const code = [
        '// this is a comment',
        'let part0 = cad.box(10, 10, 10, { centered: true })',
      ].join('\n')
      const rt = makeRuntime('mesh', backend)
      const first = await rt.execute(code)
      const newCode = [
        '// changed comment',
        'let part0 = cad.box(10, 10, 10, { centered: true })',
      ].join('\n')
      const result = await rt.update(code, newCode)
      expect(result.failedAt).toBeUndefined()
      expect(fingerprintOutputs(result)).toEqual(fingerprintOutputs(first))
      // 注释变更导致 firstDiff=0 → startLine=2 (let part0)，重放第 2 行。
      // changed 应包含被重放的语句产出（part0），但 outputs 不变（参数未变）。
      expect(result.changed).toContain('part0')
    })

    it('⑦ 只增删空行 → 零变更路径，outputs 不变', async () => {
      const code = [
        'let part0 = cad.box(10, 10, 10, { centered: true })',
        '',
        'let part1 = cad.sphere({ radius: 5 })',
      ].join('\n')
      const rt = makeRuntime('mesh', backend)
      const first = await rt.execute(code)
      // Remove the blank line
      const newCode = [
        'let part0 = cad.box(10, 10, 10, { centered: true })',
        'let part1 = cad.sphere({ radius: 5 })',
      ].join('\n')
      const result = await rt.update(code, newCode)
      expect(result.failedAt).toBeUndefined()
      expect(fingerprintOutputs(result)).toEqual(fingerprintOutputs(first))
    })

    // 增量真实性：beforeStatement 只在重放区间触发——前缀真的没执行，而不是
    // "看起来像增量、其实全量重跑"。缺这条时，退化实现也能让上面的等价断言全绿。
    it('⑧ 重放区间从首个变更单元开始（前缀单元不进执行循环）', async () => {
      // 改末条：只有第 3 行执行
      const rt = makeRuntime('mesh', backend)
      await rt.execute(base)
      const lastChanged = base.replace('cad.union(part0, part1)', 'cad.translate(part0, { offset: [0, 0, 1] })')
      const lastReplayed: number[] = []
      const lastResult = await rt.update(base, lastChanged, {
        beforeStatement: (_id, line) => lastReplayed.push(line),
      })
      expect(lastResult.failedAt).toBeUndefined()
      expect(lastReplayed).toEqual([3])

      // 改中间（第 2 行）：重放 [2, 3]，第 1 行仍不执行
      const midChanged = base.replace('radius: 10', 'radius: 14')
      const midReplayed: number[] = []
      const midResult = await rt.update(lastChanged, midChanged, {
        beforeStatement: (_id, line) => midReplayed.push(line),
      })
      expect(midResult.failedAt).toBeUndefined()
      expect(midReplayed).toEqual([2, 3])
    })
  })

  // ── 零变更路径 ──

  describe('P0-7: 零变更路径', () => {
    it('update(c, c) → executedLines 为空、changed 为空、outputs 与上轮相同', async () => {
      const code = [
        'let part0 = cad.box(10, 10, 10, { centered: true })',
        'let part1 = cad.sphere({ radius: 5 })',
      ].join('\n')
      const rt = makeRuntime('mesh', backend)
      const first = await rt.execute(code)
      const result = await rt.update(code, code)
      expect(result.failedAt).toBeUndefined()
      expect(result.changed).toBeUndefined()
      expect(fingerprintOutputs(result)).toEqual(fingerprintOutputs(first))
      expect(result.terminals.map((t) => String(t.id)).sort()).toEqual(
        first.terminals.map((t) => String(t.id)).sort(),
      )
    })
  })

  // ── 重赋值链（回归 §4.3 公式） ──

  describe('重赋值链：replayKeys 不误删前缀产出', () => {
    it('前缀 partA = cad.box(...) + 重放区间 partA = cad.subtract(partA, ...) → 结果与全量一致', async () => {
      const code = [
        'let partA = cad.box(20, 20, 20, { centered: true })',
        'let partB = cad.sphere({ radius: 8 })',
        'partA = cad.subtract(partA, partB)',
      ].join('\n')
      const rt = makeRuntime('mesh', backend)
      await rt.execute(code)
      // Change partB's radius (line 2) which forces replay from line 2
      const newCode = [
        'let partA = cad.box(20, 20, 20, { centered: true })',
        'let partB = cad.sphere({ radius: 12 })',
        'partA = cad.subtract(partA, partB)',
      ].join('\n')
      const result = await rt.update(code, newCode)
      const baseline = await fullBaseline(newCode, backend)
      expect(fingerprintOutputs(result)).toEqual(baseline.outputs)
    })
  })

  // ── 闸门退化 ──

  describe('闸门退化', () => {
    it('G2: 删除语句 → 退化为全量，结果与全量一致', async () => {
      const code = [
        'let part0 = cad.box(20, 20, 20, { centered: true })',
        'let part1 = cad.sphere({ radius: 10 })',
        'let part2 = cad.union(part0, part1)',
      ].join('\n')
      const rt = makeRuntime('mesh', backend)
      await rt.execute(code)
      // Delete the last line
      const newCode = [
        'let part0 = cad.box(20, 20, 20, { centered: true })',
        'let part1 = cad.sphere({ radius: 10 })',
      ].join('\n')
      const result = await rt.update(code, newCode)
      const baseline = await fullBaseline(newCode, backend)
      expect(fingerprintOutputs(result)).toEqual(baseline.outputs)
    })

    it('G3: oldCode 与内部基准不一致 → 退化为全量', async () => {
      const code = 'let part0 = cad.box(10, 10, 10, { centered: true })'
      const rt = makeRuntime('mesh', backend)
      await rt.execute(code)
      // Pass a wrong oldCode
      const wrongOld = 'let part0 = cad.box(999, 999, 999, { centered: true })'
      const newCode = 'let part0 = cad.box(20, 20, 20, { centered: true })'
      const result = await rt.update(wrongOld, newCode)
      const baseline = await fullBaseline(newCode, backend)
      expect(fingerprintOutputs(result)).toEqual(baseline.outputs)
    })
  })

  // ── 失败降级 ──

  describe('失败降级', () => {
    it('重放区间内注入失败语句 → 最终结果与全量失败一致', async () => {
      const code = [
        'let part0 = cad.box(10, 10, 10, { centered: true })',
        'let part1 = cad.sphere({ radius: 5 })',
      ].join('\n')
      const rt = makeRuntime('mesh', backend)
      await rt.execute(code)
      // Inject a failure in the second line
      const newCode = [
        'let part0 = cad.box(10, 10, 10, { centered: true })',
        'let part1 = cad.no_such_op(part0)',
      ].join('\n')
      const result = await rt.update(code, newCode)
      expect(result.failedAt).toBeDefined()
      expect(result.failedAt?.callee).toBe('no_such_op')
      // Compare with full baseline failure
      const baselineRt = makeRuntime('mesh', backend)
      const baseline = await baselineRt.execute(newCode)
      expect(baseline.failedAt).toBeDefined()
      expect(baseline.failedAt?.callee).toBe(result.failedAt?.callee)
      // 被降级的那一轮必须如实标记：宿主据此知道"这次没增量成功"。
      expect(result.execution.path).toBe('full')
      expect(result.execution.reason).toBe('replay-failed')
    })
  })

  // ── 执行路径观测（execution：宿主判定增量的唯一证据）──

  describe('执行路径观测', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.sphere({ radius: 10 })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n')

    it('execute → full，全部单元重放', async () => {
      const rt = makeRuntime('mesh', backend)
      const r = await rt.execute(code)
      expect(r.execution).toEqual({ path: 'full', replayedUnits: 3, skippedUnits: 0 })
    })

    it('update 改末条 → incremental，prefix 单元计入 skipped', async () => {
      const rt = makeRuntime('mesh', backend)
      await rt.execute(code)
      const newCode = code.replace('cad.union(part0, part1)', 'cad.translate(part0, { offset: [0, 0, 1] })')
      const r = await rt.update(code, newCode)
      expect(r.execution).toEqual({
        path: 'incremental',
        startLine: 3,
        replayedUnits: 1,
        skippedUnits: 2,
      })
    })

    it('update 同码 → noop + zero-change（零执行）', async () => {
      const rt = makeRuntime('mesh', backend)
      await rt.execute(code)
      const r = await rt.update(code, code)
      expect(r.execution).toEqual({
        path: 'noop',
        reason: 'zero-change',
        replayedUnits: 0,
        skippedUnits: 3,
      })
    })

    it('update 删行 → full + lines-decreased（G2 如实降级）', async () => {
      const rt = makeRuntime('mesh', backend)
      await rt.execute(code)
      const newCode = code.split('\n').slice(0, 2).join('\n')
      const r = await rt.update(code, newCode)
      expect(r.execution.path).toBe('full')
      expect(r.execution.reason).toBe('lines-decreased')
      expect(r.execution.skippedUnits).toBe(0)
    })

    it('update oldCode 与内部基准不一致 → full + old-code-mismatch（G3）', async () => {
      const rt = makeRuntime('mesh', backend)
      await rt.execute(code)
      const wrongOld = code.replace('20, 20, 20', '999, 999, 999')
      const newCode = code.replace('radius: 10', 'radius: 12')
      const r = await rt.update(wrongOld, newCode)
      expect(r.execution.path).toBe('full')
      expect(r.execution.reason).toBe('old-code-mismatch')
    })

    it('含相对 import → full + relative-imports（G4）', async () => {
      const rt = makeRuntime('mesh', backend)
      await rt.execute(code)
      const newCode = `import helper from './helper.fai.js'\n${code}`
      const r = await rt.update(code, newCode)
      expect(r.execution.path).toBe('full')
      expect(r.execution.reason).toBe('relative-imports')
    })
  })
}
