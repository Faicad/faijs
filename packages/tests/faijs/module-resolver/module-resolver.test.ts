/**
 * module-resolver — 运行时模块解析（V5.2, plan §4.1 通道③ / §5.3）
 *
 * 验收锚点（roadmap §11 模块解析 + ecosystem-roadmap §10 V5.2 多版本 scopes）：
 * 1. 重写：多 import、重命名 import、字符串/注释里形似 import 的文本不误伤
 * 2. 未登记 specifier → 明确报错（不回退、不静默）
 * 3. 版本范围不满足 → 抛错
 * 4. V5.2 scopes：同库多版本（库A 用 gear@1、库B 用 @2）；最长前缀优先
 * 5. 相对说明符绝对化、保留前缀零替换、纯函数（无网络/IO）
 */

import { describe, it, expect } from 'vitest'
import {
  resolveImports,
  UnresolvedImportError,
  ImportVersionError,
  ModuleResolverError,
  splitVersionRange,
  satisfies,
  assertSatisfies,
} from '@faicad/faijs-core/module-resolver'

describe('module-resolver: rewrite 面', () => {
  it('多 import + 重命名 import 一起重写，其余代码原样保留', () => {
    const src = [
      "import * as gear from 'gear-lib-demo'",
      "import { makeLathe, tol as t } from 'sheetmetal'",
      'export const out = [gear, t]',
    ].join('\n')
    const res = resolveImports(src, {
      imports: {
        'gear-lib-demo': 'https://static.faicad.cn/libs/gear-lib-demo@1.4.0.js',
        'sheetmetal': { url: 'https://static.faicad.cn/libs/sheetmetal@2.0.1.js', version: '2.0.1' },
      },
    })
    expect(res.resolved['gear-lib-demo']).toBe('https://static.faicad.cn/libs/gear-lib-demo@1.4.0.js')
    expect(res.resolved['sheetmetal']).toBe('https://static.faicad.cn/libs/sheetmetal@2.0.1.js')
    // 只替换说明符，import 绑定与别名结构原样
    expect(res.code).toContain(`import * as gear from 'https://static.faicad.cn/libs/gear-lib-demo@1.4.0.js'`)
    expect(res.code).toContain(`import { makeLathe, tol as t } from 'https://static.faicad.cn/libs/sheetmetal@2.0.1.js'`)
    expect(res.code).toBe(`import * as gear from 'https://static.faicad.cn/libs/gear-lib-demo@1.4.0.js'\nimport { makeLathe, tol as t } from 'https://static.faicad.cn/libs/sheetmetal@2.0.1.js'\nexport const out = [gear, t]`) // no trailing newline (src joined with \n)
  })

  it('字符串/注释里形似 import 的文本不误伤', () => {
    const src = [
      "// import x from 'gear-lib-demo'",
      "const s = \"import { y } from 'gear-lib-demo'\"",
      "import { cad } from 'gear-lib-demo'",
      'export const z = [s, cad]',
    ].join('\n')
    const res = resolveImports(src, {
      imports: { 'gear-lib-demo': 'https://cdn/mech.js' },
    })
    expect(res.code).toContain("// import x from 'gear-lib-demo'")
    expect(res.code).toContain("const s = \"import { y } from 'gear-lib-demo'\"")
    expect(res.code).toContain("import { cad } from 'https://cdn/mech.js'")
  })

  it('纯函数：相同的输入得到相同的输出（无网络/IO）', () => {
    const src = "import m from 'gear-lib-demo'\nexport const a = m\n"
    const a = resolveImports(src, { imports: { 'gear-lib-demo': 'https://cdn/mech.js' } })
    const b = resolveImports(src, { imports: { 'gear-lib-demo': 'https://cdn/mech.js' } })
    expect(a.code).toBe(b.code)
    expect(a.code).toContain("from 'https://cdn/mech.js'")
    expect(a.resolved).toEqual(b.resolved)
  })
})

describe('module-resolver: 未登记 / 版本错误面', () => {
  it('未登记的裸说明符 → UnresolvedImportError（不回退、不静默）', () => {
    const src = "import x from 'ghost-lib'\nexport const a = x\n"
    let err: unknown
    try {
      resolveImports(src, { imports: {} })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(UnresolvedImportError)
    const ue = err as UnresolvedImportError
    expect(ue.specifier).toBe('ghost-lib')
    expect(ue.message).toContain('ghost-lib')
    expect(() => resolveImports(src, { imports: {} })).toThrow(UnresolvedImportError)
  })

  it('裸名带版本范围 → 按登记版本校验，不满足即抛 ImportVersionError', () => {
    const src = "import x from 'mech@^2.0.0'\nexport const a = x\n"
    expect(() =>
      resolveImports(src, { imports: { 'mech': { url: 'https://cdn/mech@1.9.0.js', version: '1.9.0' } } }),
    ).toThrow(ImportVersionError)
  })

  it('版本满足时不抛错并成功重写', () => {
    const src = "import x from 'mech@^2.0.0'\nexport const a = x\n"
    const res = resolveImports(src, {
      imports: { 'mech': { url: 'https://cdn/mech@2.4.1.js', version: '2.4.1' } },
    })
    expect(res.resolved['mech@^2.0.0']).toBe('https://cdn/mech@2.4.1.js')
  })
})

describe('module-resolver: V5.2 多版本 scopes', () => {
  it('scope 按 importer 前缀选版本：库 A 用 gear@1、库 B 用 gear@2', () => {
    const libA = "import g from 'gear-lib-demo'\nexport const a = g\n"
    const libB = "import g from 'gear-lib-demo'\nexport const a = g\n"
    const opts = {
      imports: { 'gear-lib-demo': 'https://cdn/gear@1.0.0.js' },
      scopes: {
        'https://cdn/libs/lib-b': { 'gear-lib-demo': 'https://cdn/gear@2.0.0.js' },
      },
    }
    const ra = resolveImports(libA, { ...opts, importer: 'https://cdn/libs/lib-a/app.ts' })
    expect(ra.code).toContain('https://cdn/gear@1.0.0.js')
    const rb = resolveImports(libB, { ...opts, importer: 'https://cdn/libs/lib-b/whatever.ts' })
    expect(rb.code).toContain('https://cdn/gear@2.0.0.js')
  })

  it('scope 最长前缀优先于较短 scope', () => {
    const src = "import g from 'gear-lib-demo'\nexport const a = g\n"
    const res = resolveImports(src, {
      imports: { 'gear-lib-demo': 'https://cdn/gear@1.0.0.js' },
      scopes: {
        'https://cdn/libs': { 'gear-lib-demo': 'https://cdn/gear@1.9.0.js' },
        'https://cdn/libs/special': { 'gear-lib-demo': 'https://cdn/gear@3.0.0.js' },
      },
      importer: 'https://cdn/libs/special/a.ts',
    })
    expect(res.code).toContain('https://cdn/gear@3.0.0.js')
  })
})

describe('module-resolver: 相对路径 + 保留前缀', () => {
  it('相对说明符按 importer 目录绝对化', () => {
    const src = "import s from './shape.ts'\nexport const a = s\n"
    const res = resolveImports(src, {
      imports: {},
      importer: 'https://host/libs/lib-a/index.js',
    })
    expect(res.resolved['./shape.ts']).toBe('https://host/libs/lib-a/shape.ts')
  })

  it('保留前缀（@faicad/faijs 家族）零替换', () => {
    const src = "import { cad } from '@faicad/faq/sdk'\nexport const a = cad\n"
    const res = resolveImports(src, { imports: {} })
    expect(res.code).toContain("'@faicad/faq/sdk'")
  })
})

describe('version 极简语义', () => {
  it('精确/前缀/比较/区间/通配', () => {
    expect(satisfies('1.2.3', '1.2.3')).toBe(true)
    expect(satisfies('1.2.4', '1.2')).toBe(true)
    expect(satisfies('1.9.0', '1')).toBe(true)
    expect(satisfies('2.0.0', '^1.2.0')).toBe(false)
    expect(satisfies('1.9.0', '^1.0.0')).toBe(true)
    expect(satisfies('1.2.9', '^1.2.0')).toBe(true)
    expect(satisfies('1.2.3', '~1.2.0')).toBe(true)
    expect(satisfies('1.9.0', '~1.2.0')).toBe(false)
    expect(satisfies('1.2.3', '>=1.0.0')).toBe(true)
    expect(satisfies('1.2.3', '<1.0.0')).toBe(false)
    expect(satisfies('1.2.3', '>=1.0.0 <2.0.0')).toBe(true)
    expect(satisfies('1.2.3', '1.2 - 2.0.0')).toBe(true)
    expect(satisfies('3.0.0', '1.2 - 2.0.0')).toBe(false)
    expect(satisfies('1.2.3', '*')).toBe(true)
    expect(satisfies('1.2.3', 'latest')).toBe(true)
    // 版本不满足必须抛错
    expect(() => {
      assertSatisfies('1.9.0', '^2.0.0', 'mech')
    }).toThrow(/does not satisfy/)
  })

  it('包名与版本拆分', () => {
    expect(splitVersionRange('mech@^1.2.0')).toEqual({ name: 'mech', range: '^1.2.0' })
    expect(splitVersionRange('@scope/gear@~2.0')).toEqual({ name: '@scope/gear', range: '~2.0' })
    expect(splitVersionRange('@scope/gear')).toEqual({ name: '@scope/gear' })
  })
})

describe('module-resolver: V5.4 按需加载（大库动态切片）', () => {
  // 大库 `std-parts`（完整标准件数据库）只开放命名切片；模块图只 fetch 被引用的切片
  const partsRes = (extra: Record<string, string> = {}) => ({
    imports: { 'std-parts': 'https://cdn/std-parts/index.js' },
    slices: {
      'std-parts': {
        base: 'https://cdn/std-parts/',
        version: '3.1.0',
        exports: { 'bolts/iso4014': 'bolts/iso4014.js', 'nuts/iso4032': 'nuts/iso4032.js', ...extra },
      },
    },
  })

  it('切片子路径重写为独立 slice URL（宿主只 fetch 被引用的切片）', () => {
    const src = "import * as b from 'std-parts/bolts/iso4014'\nexport const a = b\n"
    const res = resolveImports(src, partsRes())
    expect(res.resolved['std-parts/bolts/iso4014']).toBe('https://cdn/std-parts/bolts/iso4014.js')
    expect(res.code).toContain("from 'https://cdn/std-parts/bolts/iso4014.js'")
  })

  it('库根面 `std-parts` 本身仍走 imports（未被切片吞并）', () => {
    const src = "import * as lib from 'std-parts'\nexport const a = lib\n"
    const res = resolveImports(src, partsRes())
    expect(res.resolved['std-parts']).toBe('https://cdn/std-parts/index.js')
    expect(res.code).toContain("from 'https://cdn/std-parts/index.js'")
  })

  it('未声明的切片子路径 → 明确抛错（不回退、不静默）', () => {
    const src = "import * as s from 'std-parts/bolts/m12'\nexport const a = s\n"
    let err: unknown
    try {
      resolveImports(src, partsRes())
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ModuleResolverError)
    expect((err as ModuleResolverError).message).toContain('std-parts/bolts/m12')
    expect((err as ModuleResolverError).message).toContain('not an exported slice')
  })

  it('切片带版本范围：满足 → 成功；不满足 → ImportVersionError', () => {
    const ok = resolveImports("import * as b from 'std-parts/bolts/iso4014@^3.0.0'\nexport const a = b\n", partsRes())
    expect(ok.resolved['std-parts/bolts/iso4014@^3.0.0']).toBe('https://cdn/std-parts/bolts/iso4014.js')
    expect(() =>
      resolveImports("import * as b from 'std-parts/bolts/iso4014@^4.0.0'\nexport const a = b\n", partsRes()),
    ).toThrow(ImportVersionError)
  })

  it('多个切片各自独立、可同时引用（各自 resolved）', () => {
    const src = [
      "import * as b from 'std-parts/bolts/iso4014'",
      "import * as n from 'std-parts/nuts/iso4032'",
      'export const out = [b, n]',
    ].join('\n')
    const res = resolveImports(src, partsRes())
    expect(res.resolved['std-parts/bolts/iso4014']).toBe('https://cdn/std-parts/bolts/iso4014.js')
    expect(res.resolved['std-parts/nuts/iso4032']).toBe('https://cdn/std-parts/nuts/iso4032.js')
  })

  it('切片文件名 URL 化：相对文件名按 base 绝对化', () => {
    const res = resolveImports("import * as x from 'std-parts/bolts/iso4014'\nexport const a = x\n", partsRes())
    expect(res.resolved['std-parts/bolts/iso4014']).toBe('https://cdn/std-parts/bolts/iso4014.js')
    // base 尾斜杠 + 相对文件名 → 直接拼接
    const src = "import * as y from 'std-parts/custom'\nexport const a = y\n"
    const res2 = resolveImports(src, partsRes({ custom: 'custom/c.js' }))
    expect(res2.resolved['std-parts/custom']).toBe('https://cdn/std-parts/custom/c.js')
  })

  it('纯函数：切片解析确定性（相同输入 → 相同输出，无网络/IO）', () => {
    const src = "import * as b from 'std-parts/bolts/iso4014'\nexport const a = b\n"
    const a = resolveImports(src, partsRes())
    const b = resolveImports(src, partsRes())
    expect(a.code).toBe(b.code)
    expect(a.resolved).toEqual(b.resolved)
  })
})