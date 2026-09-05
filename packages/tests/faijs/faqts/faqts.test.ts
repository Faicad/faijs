/**
 * faqts（faits `.ts`）执行测试 — Phase D（plan §7.5）
 *
 * 管线：.ts → sucrase 去类型（保留行号）→ acorn 解析 import → 说明符重写
 *      → 临时文件 → import() 整段执行 → 显式声明输出
 *
 * 验收点：
 * 1. 行号保留、去类型（转译正确且可错误定位）
 * 2. import 解析 / 说明符重写（裸名 → 宿主资源；保留前缀零替换）
 * 3. 整段一次执行 + 显式输出收集（export default 包裹、具名 export）
 * 4. faq⇄faq 互操作：faits 脚本产出 Shape 与宿主共享 kader 契约
 *
 * 运行：npx vitest run test/faijs/faqts/faqts.test.ts
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { transformFaqts } from '@faicad/faijs-core/faqts/transform'
import { findImports, rewriteImports } from '@faicad/faijs-core/faqts/imports'
import { runFaqts } from '@faicad/faijs-core/faqts/run'
import { executeFaqtsModuleInNode } from '@faicad/faijs-core/faqts/exec-node'
import { cad as hostCad } from '@faicad/faijs-core/mesh/index'
import type { Shape } from '@faicad/faijs-core/mesh/types'

const FIXTURE = fileURLToPath(new URL('./fixtures/mount-plate.ts', import.meta.url))
// faits 脚本经 rewrite 指向 core 的 mesh 入口（与宿主 cad 同源；纯 mesh 无需 OCCT）
const SRC_MESH_URL = new URL('../../../core/src/mesh/index.ts', import.meta.url).href

/** 裸名 → 本仓库可解析模块（等价于宿主 importmap/rewrite 通道） */
const HOST_REWRITE = (spec: string): string | undefined => {
  if (spec === '@faicad/faq' || spec === '@faicad/faq/sdk') return SRC_MESH_URL
  return undefined
}

function computeBBox(positions: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    min[0] = Math.min(min[0], positions[i])
    min[1] = Math.min(min[1], positions[i + 1])
    min[2] = Math.min(min[2], positions[i + 2])
    max[0] = Math.max(max[0], positions[i])
    max[1] = Math.max(max[1], positions[i + 1])
    max[2] = Math.max(max[2], positions[i + 2])
  }
  return { min, max }
}

describe('faqts transform', () => {
  it('去除类型但保留行号', () => {
    const src = "import type { Shape } from '@x/y/sdk';\nconst v: Shape = { p: 1 } as Shape;\n"
    const result = transformFaqts(src)
    expect(result.code.split('\n').length).toBe(src.split('\n').length)
    expect(result.code).not.toContain(': Shape')
    expect(result.code).not.toContain('import type')
  })

  it('fixture 转译后行号不漂移', () => {
    const src = readFileSync(FIXTURE, 'utf-8')
    const result = transformFaqts(src)
    expect(result.code.split('\n').length).toBe(src.split('\n').length)
    expect(result.code).toContain('export default')
  })
})

describe('faqts imports 解析处', () => {
  it('解析出 import span（含相对与裸名）', () => {
    const { code } = transformFaqts(
      "import { cad } from '@faicad/faq';\nimport x from 'https://esm.sh/thing';\nexport const out = [cad, x];\n",
    )
    const spans = findImports(code)
    const specs = spans.map(s => s.specifier)
    expect(specs).toContain('@faicad/faq')
    expect(specs).toContain('https://esm.sh/thing')
  })

  it('裸名经 rewrite 钩子映射', () => {
    const { code } = transformFaqts("import { cad } from '@faicad/faq';\nexport const marker = cad;\n")
    const out = rewriteImports(code, { rewrite: HOST_REWRITE })
    expect(out).toContain(`'${SRC_MESH_URL}'`)
  })

  it('相对说明符按 baseURL 绝对化', () => {
    const { code } = transformFaqts("import s from './shape.ts';\nexport const marker = s;\n")
    const base = new URL('.', import.meta.url).href
    const out = rewriteImports(code, { baseURL: base })
    expect(out).toMatch(/file:\/\/\/[^'"]*shape\.ts/)
  })

  it('保留前缀默认零替换（宿主 importmap 兜底）', () => {
    // `@faicad/faq` 家族默认不改写；引用其导出以抵抗 sucrase 的未用 import 剔除
    const { code } = transformFaqts("import { cad } from '@faicad/faq/sdk';\nexport const marker = cad;\n")
    const out = rewriteImports(code, {})
    expect(out).toContain("'@faicad/faq/sdk'")
  })
})

describe('faqts 执行（Node 临时模块）', () => {
  it('整段一次执行 + 显式输出收集', async () => {
    const src = "const double = (n: number) => n * 2\nconst triple = (x: number): number => x * 3\nexport const a = double(21)\nexport default { a, b: triple(2) }\n"
    const res = await runFaqts(src, { rewrite: HOST_REWRITE, execute: executeFaqtsModuleInNode })
    expect(res.namespace.a).toBe(42)
    expect(res.outputs.a).toBe(42)
    expect(res.outputs.b).toBe(6)
  })

  it('fixture 脚本产出 Shape 并与宿主共享 cad 契约（互操作）', async () => {
    const src = readFileSync(FIXTURE, 'utf-8')
    const res = await runFaqts(src, { rewrite: HOST_REWRITE, execute: executeFaqtsModuleInNode })
    const plate = res.outputs.plate as Shape | undefined
    const boss = res.outputs.boss as Shape | undefined
    expect(plate).toBeDefined()
    expect(boss).toBeDefined()
    expect(plate!.positions.length).toBeGreaterThan(0)
    expect(plate!.indices.length).toBeGreaterThan(0)

    // 宿主可用自家 camMath (同一 shader 契约) 再加工 faits 产物 → 互通
    const rework = hostCad.translate(plate!, [0, 0, 5])
    expect(rework.positions.length).toBeGreaterThan(0)

    const bb = computeBBox(plate!.positions)
    // box 契约（裁决 7）：X=width=size, Y=depth=size, Z=height=4（centered）；plate 为 20×20×4 平板。
    // 此处只断言"非退化 + 宿主可复算"，不绑定多余尺寸。
    expect(bb.max[0] - bb.min[0]).toBe(20)
    expect(bb.max[2] - bb.min[2]).toBe(4)
    expect(bb.max[0]).toBeGreaterThan(bb.min[0])
    expect(bb.max[2]).toBeGreaterThan(bb.min[2])
  })

  it('执行期错误透传（不吞错）', async () => {
    const src = "const f = () => { throw new Error('boom') }\nexport const r = f()\n"
    await expect(runFaqts(src, { rewrite: HOST_REWRITE, execute: executeFaqtsModuleInNode })).rejects.toThrow('boom')
  })
})