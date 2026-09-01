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

/** 编译一段 .fai.js 文本，返回模块文本 + 元数据。 */
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
    expect(code).toContain('ctx.part0 = await ns.cad.box({ size: ctx.r })')
  })

  it('CallRefIR 翻译为 await ns.cad.<callee>(...)；嵌套 asset 走 await ns.cad.asset(key)', async () => {
    const { code } = compileText(`
      const part0 = await cad.box({ size: [10, 20, 5] })
      const part1 = await cad.drill(part0, {
        depth: 3,
        position: cad.faceCenter(part0, [5, 20, 2.5], 2),
      })
      const part2 = await cad.svgExtrude({ svg: cad.asset('logo.svg'), depth: 2, targetLongSide: 20 })
    `)
    expect(code).toContain('position: await ns.cad.faceCenter(ctx.part0, [5, 20, 2.5], 2)')
    expect(code).toContain('await ns.cad.asset("logo.svg")')
  })

  it('split 多输出：解构 { front, back } 并写两个 ctx 键', async () => {
    const { code } = compileText(`
      const part0 = await cad.box({ size: [10, 20, 5] })
      const { front: part1, back: part2 } = await cad.split(part0, { cutMode: 'plane' })
    `)
    expect(code).toContain('const { front, back } = await ns.cad.split(ctx.part0, { cutMode: "plane" })')
    expect(code).toContain('ctx.part1 = front')
    expect(code).toContain('ctx.part2 = back')
  })

  it('boolean 归一取消：cad.union 编译为 ns.cad.union(input1, input2)（空 args 槽不发射）', async () => {
    const { code } = compileText(`
      const part0 = await cad.box({ size: [10, 20, 5] })
      const part1 = await cad.box({ size: [5, 5, 5] })
      const part2 = await cad.union(part0, part1)
    `)
    expect(code).toContain('ctx.part2 = await ns.cad.union(ctx.part0, ctx.part1)')
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
    // split 引用 part0 → parser 保留词法名（drill 产出 part1 而非复用 part0），
    // part0 由 box(s2) 定义 → deps ['s2']
    expect(byId.get('s4')!.deps).toEqual(['s2'])
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
      const grp1 = await cad.group({ name: 'G', members: [part0, part1] })
      grp1.add_constraint({ type: 'face_mate' })
      grp1.do_assemble()
    `
    const { statements, script } = compileText(text)
    // parser 保留词法名：group 语句写入 grp1（不再分配 partN）
    const groupMeta = statements.find((s) => s.sourceIndex !== undefined && script.statements[s.sourceIndex].callee === 'group')!
    expect(groupMeta).toBeDefined()
    expect(groupMeta.writes).toEqual(['grp1'])
    // group 的 deps 含成员语句（members 是 VarRefIR，经通用扫描收集）
    expect(groupMeta.deps).toEqual(['s1', 's2'])
    // add_constraint / do_assemble 无写入
    for (let i = 0; i < statements.length; i++) {
      const meta = statements[i]
      if (meta.sourceIndex === undefined) continue
      const stmt = script.statements[meta.sourceIndex]
      if (stmt.callee === 'add_constraint' || stmt.callee === 'do_assemble') {
        expect(meta.writes).toEqual([])
      }
    }
  })
})
