/**
 * zip-loader — zip 通道单测（Node 环境，零 DOM）
 *
 * 用 fflate.zipSync 在内存里构造 zip（不落盘、不依赖 DOM），覆盖（§6.2）：
 * 基本枚举、顶层包裹目录（不剥离）、跳过规则 + 目录条目忽略、反斜杠归一、
 * readSource 命中/越界（文案与 folder 通道一致）、refresh() no-op、
 * 损坏输入（cause 保留）、pickEntryKey 五条分支。
 */
import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import { createZipProjectLoader } from './zip-loader'
import { pickEntryKey } from './shared'

/** 把 { key: text } 打成 zip 字节（不落盘；直接给出 Uint8Array 给 loader）。 */
function zipBytes(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [key, text] of Object.entries(files)) {
    entries[key] = new TextEncoder().encode(text)
  }
  return zipSync(entries)
}

describe('createZipProjectLoader: 基础枚举', () => {
  it('清单恰为 .fai.js 条目，排序稳定，listModules 同步', async () => {
    const loader = await createZipProjectLoader(
      zipBytes({
        'src/assembly.fai.js': 'let a = 1',
        'src/parts/a.fai.js': 'let b = 2',
        'README.md': '# hi',
      }),
    )
    const modules = loader.listModules()
    expect(modules).not.toBeInstanceOf(Promise)
    expect(modules).toEqual(['src/assembly.fai.js', 'src/parts/a.fai.js'])
  })

  it('顶层包裹目录 → key 保留前缀不剥离（B3），pickEntryKey 后台规则命中', async () => {
    const loader = await createZipProjectLoader(
      zipBytes({
        'mini_lathe/src/assembly.fai.js': 'let a = 1',
        'mini_lathe/src/parts/a.fai.js': 'let b = 2',
      }),
    )
    expect(loader.listModules()).toEqual(['mini_lathe/src/assembly.fai.js', 'mini_lathe/src/parts/a.fai.js'])
    // §5.5-C 第 2 条（后缀 '/src/assembly.fai.js'）命中，不剥离也选中正确入口
    expect(pickEntryKey(loader.listModules())).toBe('mini_lathe/src/assembly.fai.js')
  })

  it('跳过 node_modules/dist/.git/点目录 与非 .fai.js；目录条目（/ 结尾）不进入清单', async () => {
    const loader = await createZipProjectLoader(
      zipBytes({
        'keep.fai.js': 'let a = 1',
        'node_modules/dep/x.fai.js': 'x',
        'dist/y.fai.js': 'y',
        'out/z.fai.js': 'z',
        '.git/config.fai.js': 'c',
        '.workbuddy/w.fai.js': 'w',
        '.hidden/h.fai.js': 'h',
        'notes.txt': 'n',
        'plain.js': 'p',
        // 目录条目（key 以 `/` 结尾）是防御性跳过；zipSync 会把它写成名为
        // `dir/` 的文件条目，unzipSync 读到 rawKey 以 `/` 结尾 → 跳过
        'empty-dir/': '',
      }),
    )
    expect(loader.listModules()).toEqual(['keep.fai.js'])
  })

  it('反斜杠路径归一为 POSIX key', async () => {
    const loader = await createZipProjectLoader(
      zipBytes({
        'src\\parts\\a.fai.js': 'let a = 1',
      }),
    )
    expect(loader.listModules()).toEqual(['src/parts/a.fai.js'])
  })
})

describe('createZipProjectLoader: readSource / refresh', () => {
  it('readSource 命中返回解码文本（含中文）；越界文案与 folder 逐字一致', async () => {
    const loader = await createZipProjectLoader(
      zipBytes({
        'src/config.fai.js': '// 中文注释\nconst OUTX = 100',
        'src/parts/a.fai.js': 'let a = cad.box(1, 1, 1)',
      }),
    )
    expect(await loader.readSource('src/config.fai.js')).toBe('// 中文注释\nconst OUTX = 100')
    expect(await loader.readSource('src/parts/a.fai.js')).toBe('let a = cad.box(1, 1, 1)')
    // B2：越界文案与 folder 通道逐字相同（escapeError 是两通道公共出厂）
    await expect(loader.readSource('nope.fai.js')).rejects.toThrow(
      `module "nope.fai.js" escapes the project (not in enumeration)`,
    )
    await expect(loader.readSource('nope.fai.js')).rejects.toThrow('escapes the project')
  })

  it('refresh() 是 no-op 且返回 Promise；调用后清单不变', async () => {
    const files = { 'a.fai.js': 'let a = 1' }
    const loader = await createZipProjectLoader(zipBytes(files))
    expect(loader.listModules()).toEqual(['a.fai.js'])
    const ret = loader.refresh()
    expect(ret).toBeInstanceOf(Promise)
    await ret
    expect(loader.listModules()).toEqual(['a.fai.js'])
  })
})

describe('createZipProjectLoader: 损坏输入', () => {
  it('非 zip 字节 → 抛错且 cause 保留', async () => {
    const notAZip = new TextEncoder().encode('definitely not a zip')
    await expect(createZipProjectLoader(notAZip)).rejects.toThrow(/^zip 解析失败: /)
    await expect(createZipProjectLoader(notAZip)).rejects.toMatchObject({ cause: expect.any(Error) })
  })
})

describe('pickEntryKey（§5.5-C，folder 与 zip 共用）', () => {
  const sorted = (arr: string[]) => [...arr].sort()

  it('第 1 条：精确 === src/assembly.fai.js', () => {
    const keys = sorted(['src/parts/a.fai.js', 'src/assembly.fai.js', 'b.fai.js'])
    expect(pickEntryKey(keys)).toBe('src/assembly.fai.js')
  })

  it('第 2 条：后缀 /src/assembly.fai.js（zip 顶层包裹目录）', () => {
    const keys = sorted(['mini_lathe/src/parts/a.fai.js', 'mini_lathe/src/assembly.fai.js'])
    expect(pickEntryKey(keys)).toBe('mini_lathe/src/assembly.fai.js')
  })

  it('第 3 条：精确或后缀 assembly.fai.js 兜底', () => {
    // 精确
    expect(pickEntryKey(sorted(['parts/b.fai.js', 'assembly.fai.js']))).toBe('assembly.fai.js')
    // 后缀
    const wrapped = sorted(['wrapped/parts/a.fai.js', 'wrapped/assembly.fai.js'])
    expect(pickEntryKey(wrapped)).toBe('wrapped/assembly.fai.js')
  })

  it('第 4 条：keys[0] 兜底（字典序第一个）', () => {
    const keys = sorted(['b.fai.js', 'a.fai.js', 'aa.fai.js'])
    expect(pickEntryKey(keys)).toBe('a.fai.js')
  })

  it('第 5 条：空清单 → null', () => {
    expect(pickEntryKey([])).toBeNull()
  })
})