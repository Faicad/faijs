/**
 * compileToModule 单元测试（VM 执行方案 Phase 1）
 *
 * 验证：
 * 1. 生成零 import ESM 文本可被动态 import() 加载（data: URL）
 * 2. 语句元数据（id / deps / writes）正确——deps 由 refs 翻译，含 $param 与 $geom.of
 * 3. 编译产物 fn 体形态（参数即变量 / ctx 引用 / $param/$geom/$asset 翻译）
 */

import { describe, it, expect } from 'vitest'
import { compileToModule } from './compile'
import { parseScript } from './parser'

/** 编译一段 .faijs 文本，返回模块文本 + 元数据。 */
function compileText(text: string) {
  const { script } = parseScript(text)
  return { script, ...compileToModule(script) }
}

/** 用 data: URL 动态 import 编译产物，验证零 import 模块可加载。 */
async function importCompiled(code: string) {
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  return import(/* @vite-ignore */ url)
}

describe('compileToModule: 模块文本', () => {
  it('生成零 import ESM 文本且可被动态 import 加载', async () => {
    const { code } = compileText(`
      const part0 = await cad.box({ size: [10, 20, 5] })
    `)
    expect(code).toContain('export const statements = [')
    expect(code).not.toContain('import ')
    const mod = await importCompiled(code)
    expect(Array.isArray(mod.statements)).toBe(true)
    expect(mod.statements.length).toBe(1)
  })

  it('参数即变量：const r = 20 编译为 ctx.r = 20；$param 翻译为 ctx 引用', async () => {
    const { code } = compileText(`
      const r = 20
      const part0 = await cad.box({ size: r })
    `)
    expect(code).toContain('ctx.r = 20')
    expect(code).toContain('ctx.part0 = await cad.box({ size: ctx.r }, exec)')
  })

  it('$geom 翻译为 cad.faceCenter(...exec)；$asset 翻译为 await cad.asset(key, exec)', async () => {
    const { code } = compileText(`
      const part0 = await cad.box({ size: [10, 20, 5] })
      const part1 = await cad.drill(part0, {
        depth: 3,
        position: cad.faceCenter(part0, [5, 20, 2.5], 2),
      })
      const part2 = await cad.svgExtrude({ svg: cad.asset('logo.svg'), depth: 2, targetLongSide: 20 })
    `)
    expect(code).toContain('cad.faceCenter(ctx.part0, [5,20,2.5], 2, exec)')
    expect(code).toContain('await cad.asset("logo.svg", exec)')
  })

  it('split 多输出：解构 { front, back } 并写两个 ctx 键', async () => {
    const { code } = compileText(`
      const part0 = await cad.box({ size: [10, 20, 5] })
      const { front: part1, back: part2 } = await cad.split(part0, { cutMode: 'plane' })
    `)
    expect(code).toContain('const { front, back } = await cad.split(ctx.part0, { cutMode: "plane" }, exec)')
    expect(code).toContain('ctx.part1 = front')
    expect(code).toContain('ctx.part2 = back')
  })

  it('boolean 多输入：cad.boolean(input1, input2, { operation }, exec)', async () => {
    const { code } = compileText(`
      const part0 = await cad.box({ size: [10, 20, 5] })
      const part1 = await cad.box({ size: [5, 5, 5] })
      const part2 = await cad.union(part0, part1)
    `)
    expect(code).toContain('cad.boolean(ctx.part0, ctx.part1, { operation: "union" }, exec)')
  })
})

describe('compileToModule: 语句元数据', () => {
  it('id 分配：参数占 s1..sK，语句 s(K+1)..s(K+N)', () => {
    const { statements } = compileText(`
      const r = 20
      const part0 = await cad.box({ size: r })
      const part1 = await cad.drill(part0, { depth: 3 })
    `)
    expect(statements.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  })

  it('deps：$param 引用 → 参数语句 id；inputs/$geom.of → 定义语句 id', () => {
    const { statements } = compileText(`
      const r = 20
      const part0 = await cad.box({ size: r })
      const part1 = await cad.drill(part0, { depth: 3, position: cad.faceCenter(part0, [5, 20, 2.5], 2) })
      const { front: part2, back: part3 } = await cad.split(part0, { cutMode: 'plane' })
    `)
    const byId = new Map(statements.map((s) => [String(s.id), s]))
    // part0 引用参数 r → deps ['s1']
    expect(byId.get('s2')!.deps).toEqual(['s1'])
    // part1 引用 part0（inputs + $geom.of）→ deps ['s2']（box 定义 part0）
    expect(byId.get('s3')!.deps).toEqual(['s2'])
    // split 引用 part0 → Phase 3 后 part0 被 drill(s3) 复写（单入单出复用名），deps ['s3']
    expect(byId.get('s4')!.deps).toEqual(['s3'])
  })

  it('writes：普通语句 [id]、split 双输出、参数 [name]、do_assemble 空', () => {
    const { statements } = compileText(`
      const r = 20
      const part0 = await cad.box({ size: r })
      const { front: part1, back: part2 } = await cad.split(part0, { cutMode: 'plane' })
    `)
    const byId = new Map(statements.map((s) => [String(s.id), s]))
    expect(byId.get('s1')!.writes).toEqual(['r'])
    expect(byId.get('s2')!.writes).toEqual(['part0'])
    expect(byId.get('s3')!.writes).toEqual(['part1', 'part2'])
  })

  it('group/assembly 语句写入 grp 变量；add_constraint/do_assemble 无写入', () => {
    const text = `
      const part0 = await cad.box({ size: [10, 20, 5] })
      const part1 = await cad.box({ size: [5, 5, 5] })
      const grp1 = await cad.group({ name: 'G', members: ['part0', 'part1'] })
      grp1.add_constraint({ type: 'face_mate' })
      grp1.do_assemble()
    `
    const { statements, script } = compileText(text)
    // Phase 3: group 语句写入 partN（取消 grp_N，按「无输入/单输出」规则拿新 partN）
    // 前两个 box → part0, part1；group → part2
    const groupMeta = statements.find((s) => s.sourceIndex !== undefined && script.statements[s.sourceIndex].op === 'group')!
    expect(groupMeta).toBeDefined()
    expect(groupMeta.writes).toEqual(['part2'])
    // group 的 deps 含成员语句
    expect(groupMeta.deps).toEqual(['s1', 's2'])
    // add_constraint / do_assemble 无写入
    for (let i = 0; i < statements.length; i++) {
      const meta = statements[i]
      if (meta.sourceIndex === undefined) continue
      const stmt = script.statements[meta.sourceIndex]
      if (stmt.op === 'add_constraint' || stmt.op === 'do_assemble') {
        expect(meta.writes).toEqual([])
      }
    }
  })
})
