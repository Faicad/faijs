/**
 * module-registry — 多文件注册表单测（无几何：ModuleRunner 用 canned ctx 假实现）。
 *
 * 覆盖：named 绑定 gate（liveShapes/fns）、缺失绑定、命名空间 seed、循环依赖、
 * moduleKey 归一、依赖执行失败归并。几何链路（A-8/A-9/A-10）见 tests 包 multifile。
 */
import { describe, it, expect } from 'vitest'
import {
  ModuleRegistry,
  ModuleRegistryError,
  normalizeModuleKey,
  isRelativeSpecifier,
  type ModuleRunResult,
} from './module-registry'
import type { ProjectLoader } from './ports'

function memLoader(map: Record<string, string>): ProjectLoader {
  return { listModules: () => Object.keys(map), readSource: async (k) => map[k] }
}

/** 空 ctx 的假执行（无几何用例）。 */
function emptyRunner(): (code: string) => Promise<ModuleRunResult> {
  return async () => ({
    listCtxKeys: () => [],
    getCtxVar: () => undefined,
    listKeepLines: () => [],
    getKeepByLine: () => undefined,
  })
}

const FAKE_SHAPE = { positions: [0, 0, 0], indices: [0] }

describe('normalizeModuleKey / isRelativeSpecifier', () => {
  it('相对 specifier 归一（去 ./ ../ 前缀；按 baseKey 目录拼接）', () => {
    expect(normalizeModuleKey('./bp.fai.js')).toBe('bp.fai.js')
    expect(normalizeModuleKey('../x/a.fai.js', 'sub/b.fai.js')).toBe('x/a.fai.js')
    expect(normalizeModuleKey('/abs.fai.js')).toBe('abs.fai.js')
    expect(normalizeModuleKey('a/./b.fai.js')).toBe('a/b.fai.js')
    expect(normalizeModuleKey('./lib/bp.fai.js', 'main.fai.js')).toBe('lib/bp.fai.js')
  })
  it('裸 specifier 不算相对（libLoader 通道）', () => {
    expect(isRelativeSpecifier('./x')).toBe(true)
    expect(isRelativeSpecifier('../x')).toBe(true)
    expect(isRelativeSpecifier('gear-lib-demo')).toBe(false)
    expect(isRelativeSpecifier('@scope/pkg')).toBe(false)
  })
})

describe('ModuleRegistry: named 绑定 gate + seed', () => {
  const loader = memLoader({
    'bp.fai.js': 'let bp = cad.box(10, 10, 10, { centered: true })',
  })

  it('live shape 绑定 → seed 含值', async () => {
    const run = async (code: string): Promise<ModuleRunResult> => {
      void code
      return {
        listCtxKeys: () => ['bp'],
        getCtxVar: () => FAKE_SHAPE,
        listKeepLines: () => [],
        getKeepByLine: () => undefined,
      }
    }
    const reg = new ModuleRegistry(loader, run)
    const seed = await reg.resolveImports([{ kind: 'named', bindings: ['bp'], localName: 'bp', specifier: './bp.fai.js', lineNo: 1 }])
    expect(Object.keys(seed)).toEqual(['bp'])
    expect(seed.bp).toBe(FAKE_SHAPE)
  })

  it('缺失绑定 → BINDING_NOT_EXPORTED（带 lineNo/callee）', async () => {
    const run = async (code: string): Promise<ModuleRunResult> => {
      void code
      return { listCtxKeys: () => ['bp'], getCtxVar: () => FAKE_SHAPE, listKeepLines: () => [], getKeepByLine: () => undefined }
    }
    const reg = new ModuleRegistry(loader, run)
    await expect(
      reg.resolveImports([{ kind: 'named', bindings: ['nope'], localName: 'nope', specifier: './bp.fai.js', lineNo: 3 }]),
    ).rejects.toMatchObject({ code: 'BINDING_NOT_EXPORTED', lineNo: 3, callee: 'nope' })
  })

  it('函数绑定（fns）→ seed 含函数', async () => {
    const fn = async (): Promise<void> => {}
    const run = async (code: string): Promise<ModuleRunResult> => {
      void code
      return { listCtxKeys: () => ['lift'], getCtxVar: () => fn, listKeepLines: () => [], getKeepByLine: () => undefined }
    }
    const loaderFn = memLoader({ 'fn.fai.js': 'function lift(s) { return s }' })
    const reg = new ModuleRegistry(loaderFn, run)
    const seed = await reg.resolveImports([{ kind: 'named', bindings: ['lift'], localName: 'lift', specifier: './fn.fai.js', lineNo: 1 }])
    expect(seed.lift).toBe(fn)
  })

  it('命名空间 import → seed 为 values+fns 合并视图', async () => {
    const fn = async (): Promise<void> => {}
    const run = async (code: string): Promise<ModuleRunResult> => {
      void code
      return {
        listCtxKeys: () => ['bp', 'lift'],
        getCtxVar: (name) => (name === 'lift' ? fn : FAKE_SHAPE),
        listKeepLines: () => [],
        getKeepByLine: () => undefined,
      }
    }
    const reg = new ModuleRegistry(memLoader({ 'm.fai.js': 'let bp = 0\nfunction lift(){}' }), run)
    const seed = await reg.resolveImports([{ kind: 'namespace', bindings: ['m'], localName: 'm', specifier: './m.fai.js', lineNo: 1 }])
    expect((seed.m as Record<string, unknown>).bp).toBe(FAKE_SHAPE)
    expect((seed.m as Record<string, unknown>).lift).toBe(fn)
  })

  it('重复 resolveImports 命中缓存（同一模块只执行一次）', async () => {
    const seen: string[] = []
    const fn = async (): Promise<void> => {}
    const run = async (code: string): Promise<ModuleRunResult> => {
      seen.push(code)
      return { listCtxKeys: () => ['f'], getCtxVar: () => fn, listKeepLines: () => [], getKeepByLine: () => undefined }
    }
    const loaderM = memLoader({ 'm.fai.js': 'function f() {}\nlet a = 1' })
    const reg = new ModuleRegistry(loaderM, run)
    const imports = [{ kind: 'named' as const, bindings: ['f'], localName: 'f', specifier: './m.fai.js', lineNo: 1 }]
    await reg.resolveImports(imports)
    await reg.resolveImports(imports)
    expect(seen.length).toBe(1) // 第二次 resolveImports 命中缓存，模块不重跑
  })
})

describe('ModuleRegistry: 循环 / 缺失模块 / 依赖执行失败', () => {
  it('循环依赖 → MODULE_CYCLE（消息带路径）', async () => {
    const loader = memLoader({
      'a.fai.js': "import { b } from './b.fai.js'\nlet a = 1",
      'b.fai.js': "import { a } from './a.fai.js'\nlet b = 2",
    })
    const reg = new ModuleRegistry(loader, emptyRunner())
    await expect(
      reg.resolveImports([{ kind: 'named', bindings: ['a'], localName: 'a', specifier: './a.fai.js', lineNo: 1 }]),
    ).rejects.toMatchObject({ code: 'MODULE_CYCLE' })
  })

  it('模块缺失 → MODULE_NOT_FOUND', async () => {
    const reg = new ModuleRegistry(memLoader({ 'a.fai.js': 'let a = 1' }), emptyRunner())
    await expect(
      reg.resolveImports([{ kind: 'named', bindings: ['x'], localName: 'x', specifier: './nope.fai.js', lineNo: 2 }]),
    ).rejects.toMatchObject({ code: 'MODULE_NOT_FOUND' })
  })

  it('依赖执行失败 → runner 的 ModuleRegistryError 上抛（MODULE_EXEC_FAILED）', async () => {
    const loader = memLoader({ 'bad.fai.js': 'let b = cad.no_such()' })
    const reg = new ModuleRegistry(loader, async () => {
      throw new ModuleRegistryError('MODULE_EXEC_FAILED', 'dependency module failed at line 1: boom', { lineNo: 1, callee: 'no_such' })
    })
    await expect(
      reg.resolveImports([{ kind: 'named', bindings: ['b'], localName: 'b', specifier: './bad.fai.js', lineNo: 1 }]),
    ).rejects.toMatchObject({ code: 'MODULE_EXEC_FAILED', lineNo: 1 })
  })
})
