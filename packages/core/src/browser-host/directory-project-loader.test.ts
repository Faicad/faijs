/**
 * directory-project-loader — 浏览器 ProjectLoader 单测（node 环境）
 *
 * 浏览器 File System Access API 在 node 不可用 → 用**内存 fake handle** 构造
 * `FsDirectoryHandleLike`（纯对象实现 entries()/getDirectoryHandle/getFileHandle，
 * 不依赖 DOM/File）。
 *
 * 覆盖：递归枚举 + 跳过规则 + key 形态、readSource 命中/缺失、越界防御、
 * refresh() 反映文件增删、与 ModuleRegistry 的集成冒烟（seed 绑定正确）。
 */
import { describe, it, expect } from 'vitest'
import {
  createDirectoryProjectLoader,
  type FsDirectoryHandleLike,
  type FsEntryHandleLike,
  type FsFileHandleLike,
} from './directory-project-loader'
import { ModuleRegistry, type ModuleRunResult } from '../cad-runtime/module-registry'

// ── 内存 fake handle 构造 ──

type FsNode =
  | { kind: 'directory'; children: Map<string, FsNode> }
  | { kind: 'file'; text: string }

function makeDir(): FsNode {
  return { kind: 'directory', children: new Map() }
}

/** 由 Record<posixPath, text> 构造内存目录树句柄（路径按 `/` 切分逐段建目录）。 */
function createFakeRoot(files: Record<string, string>): FsDirectoryHandleLike {
  const root = makeDir()
  for (const [key, text] of Object.entries(files)) {
    const segs = key.split('/')
    let node = root
    for (const seg of segs.slice(0, -1)) {
      let next = node.kind === 'directory' ? node.children.get(seg) : undefined
      if (!next) {
        next = makeDir()
        if (node.kind === 'directory') node.children.set(seg, next)
      }
      node = next
    }
    if (node.kind === 'directory') node.children.set(segs[segs.length - 1], { kind: 'file', text })
  }
  return handleFor(root)
}

function handleFor(node: FsNode): FsEntryHandleLike {
  if (node.kind === 'file') {
    return {
      kind: 'file',
      getFile: async () => ({ text: async () => node.text }),
    }
  }
  return {
    kind: 'directory',
    entries: async function* entries(): AsyncIterable<[string, FsEntryHandleLike]> {
      for (const [name, child] of node.children) {
        yield [name, handleFor(child)]
      }
    },
    getDirectoryHandle: async (name) => {
      const child = node.children.get(name)
      if (!child || child.kind !== 'directory') throw new DOMException(`not a directory: ${name}`, 'NotFoundError')
      return handleFor(child) as FsDirectoryHandleLike
    },
    getFileHandle: async (name) => {
      const child = node.children.get(name)
      if (!child || child.kind !== 'file') throw new DOMException(`not a file: ${name}`, 'NotFoundError')
      return handleFor(child) as FsFileHandleLike
    },
  }
}

/** 可变内存文件系统：持有一个活的目录树，测试可通过 write/delete 模拟外部改动。 */
interface FakeFs {
  root: FsDirectoryHandleLike
  write(posix: string, text: string): void
  delete(posix: string): void
}

function createFakeFs(files: Record<string, string>): FakeFs {
  const root = makeDir()
  const descend = (key: string, create: boolean): { node: FsNode; name: string } => {
    const segs = key.split('/')
    let node = root
    for (const seg of segs.slice(0, -1)) {
      let next = node.kind === 'directory' ? node.children.get(seg) : undefined
      if (!next && create) {
        next = makeDir()
        if (node.kind === 'directory') node.children.set(seg, next)
      }
      if (!next || next.kind !== 'directory') throw new Error(`no such directory: ${seg}`)
      node = next
    }
    return { node, name: segs[segs.length - 1] }
  }
  for (const [key, text] of Object.entries(files)) {
    const { node, name } = descend(key, true)
    if (node.kind === 'directory') node.children.set(name, { kind: 'file', text })
  }
  return {
    root: handleFor(root) as FsDirectoryHandleLike,
    write: (key, text) => {
      const { node, name } = descend(key, true)
      if (node.kind === 'directory') node.children.set(name, { kind: 'file', text })
    },
    delete: (key) => {
      const { node, name } = descend(key, false)
      if (node.kind === 'directory') node.children.delete(name)
    },
  }
}

// ── 供 ModuleRegistry 集成用的 canned runner ──

async function shapeRunner(code: string): Promise<ModuleRunResult> {
  const names: string[] = []
  for (const line of code.split('\n')) {
    const m = line.match(/^let ([A-Za-z_][A-Za-z0-9_]*)\s*=\s*cad\./)
    if (m) names.push(m[1])
  }
  return {
    listCtxKeys: () => names,
    getCtxVar: (n: string) => (names.includes(n) ? { positions: [0, 0, 0], indices: [0, 0, 0] } : undefined),
    listKeepLines: () => [],
    getKeepByLine: () => undefined,
  }
}

// ── 用例 ──

describe('createDirectoryProjectLoader: 枚举', () => {
  it('listModules 递归枚举全部 .fai.js（POSIX key，排序稳定）', async () => {
    const loader = await createDirectoryProjectLoader(
      createFakeRoot({
        'a.fai.js': '',
        'sub/b.fai.js': '',
        'sub/deep/c.fai.js': '',
      }),
    )
    expect(loader.listModules()).toEqual(['a.fai.js', 'sub/b.fai.js', 'sub/deep/c.fai.js'])
  })

  it('跳过 node_modules/dist/.git/`点`目录 与非 .fai.js 文件', async () => {
    const root = createFakeRoot({
      'keep.fai.js': '',
      'node_modules/dep/x.fai.js': '',
      'dist/y.fai.js': '',
      'out/z.fai.js': '',
      '.git/config.fai.js': '',
      '.workbuddy/w.fai.js': '',
      '.hidden/h.fai.js': '',
      'notes.txt': '',
      'plain.js': '',
    })
    const loader = await createDirectoryProjectLoader(root)
    expect(loader.listModules()).toEqual(['keep.fai.js'])
  })

  it('空目录 → 空清单', async () => {
    const loader = await createDirectoryProjectLoader(createFakeRoot({}))
    expect(loader.listModules()).toEqual([])
  })
})

describe('createDirectoryProjectLoader: readSource', () => {
  const FILES = {
    'config.fai.js': 'const OUTX = 100',
    'parts/a.fai.js': 'let a = cad.box(1, 1, 1)',
  }

  it('命中 key 返回文本', async () => {
    const loader = await createDirectoryProjectLoader(createFakeRoot(FILES))
    expect(await loader.readSource('parts/a.fai.js')).toBe('let a = cad.box(1, 1, 1)')
    expect(await loader.readSource('config.fai.js')).toBe('const OUTX = 100')
  })

  it('不存在的 key（含目录 key）→ 抛错（越界防御，不触底读取）', async () => {
    const root = createFakeRoot(FILES)
    const loader = await createDirectoryProjectLoader(root)
    await expect(loader.readSource('nope.fai.js')).rejects.toThrow(/escapes the project/)
    // 目录 key 不在清单中 → 同样拒绝
    await expect(loader.readSource('parts')).rejects.toThrow(/escapes the project/)
  })

  it('越界防御：../ 与深逃逸归一产物不在清单 → 拒绝', async () => {
    const loader = await createDirectoryProjectLoader(createFakeRoot(FILES))
    await expect(loader.readSource('../x.fai.js')).rejects.toThrow(/escapes the project/)
    await expect(loader.readSource('a/../../x.fai.js')).rejects.toThrow(/escapes the project/)
  })
})

describe('createDirectoryProjectLoader: refresh', () => {
  it('refresh 后新增文件出现、删除文件消失', async () => {
    const fs = createFakeFs({ 'a.fai.js': 'let t = 1' })
    const loader = await createDirectoryProjectLoader(fs.root)
    expect(loader.listModules()).toEqual(['a.fai.js'])

    // 外部写入新模块（模拟外部编辑器新增文件）→ 待 refresh 后方见
    fs.write('b/part.fai.js', 'let b = 2')
    expect(loader.listModules()).toEqual(['a.fai.js'])
    await loader.refresh()
    expect(loader.listModules()).toEqual(['a.fai.js', 'b/part.fai.js'])
    expect(await loader.readSource('b/part.fai.js')).toBe('let b = 2')

    // 删除模块（模拟外部删除文件）→ refresh 后消失
    fs.delete('a.fai.js')
    await loader.refresh()
    expect(loader.listModules()).toEqual(['b/part.fai.js'])
  })
})

describe('createDirectoryProjectLoader: 与 ModuleRegistry 集成（多文件冒烟）', () => {
  it('带相对 import 的入口经 ModuleRegistry 载入 → 绑定正确', async () => {
    const loader = await createDirectoryProjectLoader(
      createFakeRoot({
        'parts/b.fai.js': 'let bp = cad.box(10, 10, 10, { centered: true })',
      }),
    )
    const registry = new ModuleRegistry(loader, shapeRunner)
    const imports: import('../lang/metadata-extractor').UiMetadata['imports'] = [
      { kind: 'named', bindings: ['bp'], localName: 'bp', specifier: './parts/b.fai.js', lineNo: 1 },
    ]
    const seed = await registry.resolveImports(imports, 'main.fai.js')
    // 模块 key 归一 + loader 枚举命中 + 绑定 gate → seed.bp 为模块产出的 shape
    expect(Object.keys(seed)).toEqual(['bp'])
    expect(seed.bp).toEqual({ positions: [0, 0, 0], indices: [0, 0, 0] })
  })

  it('缺失模块 → MODULE_NOT_FOUND（真实 loader 枚举兜底）', async () => {
    const loader = await createDirectoryProjectLoader(createFakeRoot({ 'parts/a.fai.js': 'let a = 1' }))
    const registry = new ModuleRegistry(loader, shapeRunner)
    await expect(
      registry.resolveImports(
        [{ kind: 'named', bindings: ['bp'], localName: 'bp', specifier: './parts/nope.fai.js', lineNo: 1 }],
        'main.fai.js',
      ),
    ).rejects.toMatchObject({ code: 'MODULE_NOT_FOUND' })
  })
})