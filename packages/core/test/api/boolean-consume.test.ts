/**
 * @vitest-environment node
 *
 * 布尔族语义契约（2026-10-22）：**消费输入** + **别名是同一函数对象**。
 *
 * 三件事各由一层钉住：
 * 1. 存活判定层：`union` / `subtract` / `intersect` 都不保留源，`terminals` 只剩结果件；
 *    要留源必须在脚本里写独立语句 `<var>.keep()` / `<var>.keepHidden()`。
 * 2. 实现层：`cut` 与 `subtract`、`fuse` 与 `union` 是**同一个函数对象**
 *    （`boolean.ts` 末尾 `export const cut = subtract`），不是第二份实现。
 * 3. 生成物层：`fuse` 不再是 BREP 投影符号（arg-spec 里 `kind: 'skip'`），
 *    但仍在 `cad` 命名空间与符号表里（脚本面可调用）。
 *
 * 走 mesh 模式：本用例只验语义与终端集合，不需要 OCCT（也就无需 120s 内核初始化）。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { brepOf } from '../../src/shape'
import { getBrepApi } from '../../src/brep/handle-bridge'
import type { Shape } from '../../src/mesh/types'
import type { BrepHandle } from '../../src/brep/engine/types'
import { asPartName } from '../../src/identity'
import { createRuntime } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import { union, subtract, intersect, cut, fuse } from '../../src/api'
import { ARG_SPEC } from '../../src/api/surface/arg-spec'
import * as scriptFace from '../../src/api/generated/script-face'
import symbolTable from '../../src/lang/symbol-table.generated'

const PORTS: HostPorts = { events: { emit: (): void => { /* no events asserted here */ } } }

/** 执行一段脚本（mesh 模式），断言无失败并返回结果。 */
async function runMesh(code: string): Promise<ExecutionResult> {
  const runtime = createRuntime(PORTS, 'mesh')
  const result = await runtime.execute(code)
  expect(result.failedAt).toBeUndefined()
  return result
}

/** 终端 id 排序后返回，便于整集比对。 */
function terminalIds(result: ExecutionResult): string[] {
  return result.terminals.map((t) => String(t.id)).sort()
}

const BOX = 'let part0 = cad.box(20, 20, 20, { centered: true })'
const SPHERE = 'let part1 = cad.sphere({ radius: 8 })'

describe('boolean family: consumes its inputs', () => {
  it('union: 两个输入都进结果，terminals 只剩并集', async () => {
    const result = await runMesh([BOX, SPHERE, 'let part2 = cad.union(part0, part1)'].join('\n'))
    expect(terminalIds(result)).toEqual(['part2'])
    // outputs 仍含全部 Shape 变量（中间结果只是不进 terminals，不是被抹掉）
    expect([...result.outputs.keys()].map(String).sort()).toEqual(['part0', 'part1', 'part2'])
  })

  it('subtract: 主体与工具都进结果，terminals 只剩差集', async () => {
    const result = await runMesh([BOX, SPHERE, 'let part2 = cad.subtract(part0, part1)'].join('\n'))
    expect(terminalIds(result)).toEqual(['part2'])
  })

  it('intersect: 两个输入都进结果，terminals 只剩交集', async () => {
    const result = await runMesh([BOX, SPHERE, 'let part2 = cad.intersect(part0, part1)'].join('\n'))
    expect(terminalIds(result)).toEqual(['part2'])
  })

  it('消费是默认值，不是禁令：独立 keep 语句把输入留回来', async () => {
    const result = await runMesh(
      [BOX, SPHERE, 'let part2 = cad.subtract(part0, part1)', 'part0.keepHidden()'].join('\n'),
    )
    expect(terminalIds(result)).toEqual(['part0', 'part2'])
    const byId = new Map(result.terminals.map((t) => [String(t.id), t]))
    expect(byId.get('part0')!.hidden).toBe(true)
    expect(byId.get('part2')!.hidden).toBeUndefined()
  })
})

describe('boolean aliases: one function object, no second implementation', () => {
  it('cut IS subtract', () => {
    expect(cut).toBe(subtract)
  })

  it('fuse IS union', () => {
    expect(fuse).toBe(union)
  })

  it('cad.cut 与 cad.subtract 产出逐字节相同的网格', async () => {
    const viaSubtract = await runMesh([BOX, SPHERE, 'let part2 = cad.subtract(part0, part1)'].join('\n'))
    const viaCut = await runMesh([BOX, SPHERE, 'let part2 = cad.cut(part0, part1)'].join('\n'))
    const a = viaSubtract.outputs.get(asPartName('part2'))!
    const b = viaCut.outputs.get(asPartName('part2'))!
    if (!('positions' in a) || !('indices' in b)) throw new Error('expected mesh products')
    expect(Array.from(b.positions)).toEqual(Array.from(a.positions))
    expect(Array.from(b.indices)).toEqual(Array.from(a.indices as ArrayLike<number>))
  })

  it('别名继承变参：cut(a, b, c) 真的减两次（不是静默吞掉第三参）', async () => {
    const variadic = await runMesh(
      [
        BOX,
        SPHERE,
        'let part2 = cad.box(6, 30, 6, { centered: true })',
        'let part3 = cad.cut(part0, part1, part2)',
        'let part4 = cad.subtract(part0, part1, part2)',
      ].join('\n'),
    )
    const viaCut = variadic.outputs.get(asPartName('part3'))!
    const viaSubtract = variadic.outputs.get(asPartName('part4'))!
    if (!('positions' in viaCut) || !('positions' in viaSubtract)) throw new Error('expected mesh products')
    expect(Array.from(viaCut.positions)).toEqual(Array.from(viaSubtract.positions))
  })
})

describe('boolean aliases: projection bookkeeping', () => {
  it("arg-spec 把 fuse / cut 都标成 'skip'（别名不参与 BREP 投影再生）", () => {
    for (const name of ['fuse', 'cut']) {
      const entry = ARG_SPEC.find((e) => e.name === name)
      expect(entry, `${name} should stay in arg-spec as a skip entry`).toBeDefined()
      expect(entry!.kind).toBe('skip')
      expect(entry!.scriptFace).not.toBe(true)
      expect(entry!.reason).toContain('alias')
    }
  })

  it('script-face 生成物不再导出 fuse（否则会与手写别名抢同一个名字）', () => {
    expect(Object.keys(scriptFace.scriptFaceOps)).not.toContain('fuse')
  })

  it('符号表仍然认识 fuse / cut —— 脚本面可调用面不变', () => {
    expect(symbolTable).toHaveProperty('fuse')
    expect(symbolTable).toHaveProperty('cut')
    expect(symbolTable).toHaveProperty('union')
    expect(symbolTable).toHaveProperty('subtract')
  })
})

describe('cad.extrude combine:"cut" equivalence (BREP)', () => {
  beforeAll(async () => {
    await initOcctWasm()
  }, 120000)

  it('combine:"cut" equals the two-step extrude + subtract result', async () => {
    const SQUARE = JSON.stringify([{ segments: [
      { kind: 'line', x1: 0, y1: 0, x2: 2, y2: 0 },
      { kind: 'line', x1: 2, y1: 0, x2: 2, y2: 2 },
      { kind: 'line', x1: 2, y1: 2, x2: 0, y2: 2 },
      { kind: 'line', x1: 0, y1: 2, x2: 0, y2: 0 },
    ], closed: true }])
    const runtime = createRuntime(PORTS, 'brep')
    const result = await runtime.execute(`
      let base = cad.box(10, 10, 20, { centered: false })
      let sk = cad.profile({ contours: ${SQUARE} })
      let direct = cad.extrude(sk, { upTo: 'last', baseFeature: base, combine: 'cut' })
      let base2 = cad.box(10, 10, 20, { centered: false })
      let sk2 = cad.profile({ contours: ${SQUARE} })
      let tool = cad.extrude(sk2, { upTo: 'last', baseFeature: base2 })
      let twoStep = cad.subtract(base2, tool)
    `)
    expect(result.failedAt).toBeUndefined()
    const direct = result.outputs.get(asPartName('direct')) as Shape
    const twoStep = result.outputs.get(asPartName('twoStep')) as Shape
    const k = getBrepApi()
    expect(k.getVolume(brepOf(direct) as BrepHandle)).toBeCloseTo(k.getVolume(brepOf(twoStep) as BrepHandle), 2)
    expect(k.getVolume(brepOf(direct) as BrepHandle)).toBeCloseTo(2000 - 4 * 20, 2)
  })
})
