/**
 * node 出口（@faicad/faijs/node）导出面测试：fs-project-loader。
 *
 * Electron utility 进程经由该出口取 createFsProjectLoader（目录工程装载），
 * findProjectRoot / projectKeyOf 用于入口 moduleKey 计算。导出缺失 = 消费方
 * 无法装配目录工程 → 本测试直接从公共出口 `../node` 导入，锁住导出面。
 *
 * Run: npx vitest run src/node-host/fs-project-loader.test.ts
 */

import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// Import from the public entry (src/node.ts), NOT from node-host internals —
// what this test locks is the export surface of the ./node package entry.
import { createFsProjectLoader, findProjectRoot, projectKeyOf } from '../node'

const tempDirs: string[] = []
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'faijs-fs-project-loader-'))
  tempDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

describe('@faicad/faijs/node export surface', () => {
  it('exports createFsProjectLoader / findProjectRoot / projectKeyOf as functions', () => {
    expect(typeof createFsProjectLoader).toBe('function')
    expect(typeof findProjectRoot).toBe('function')
    expect(typeof projectKeyOf).toBe('function')
  })
})

describe('createFsProjectLoader', () => {
  it('lists .fai.js modules as sorted POSIX relative keys and reads source verbatim', async () => {
    const root = makeTempDir()
    mkdirSync(join(root, 'parts', 'sub'), { recursive: true })
    writeFileSync(join(root, 'main.fai.js'), 'export const a = 1')
    writeFileSync(join(root, 'parts', 'sub', 'gear.fai.js'), 'export const b = 2')
    writeFileSync(join(root, 'readme.md'), 'not a module')
    writeFileSync(join(root, 'parts', 'helper.js'), 'wrong extension')

    const loader = createFsProjectLoader(root)
    expect(loader.listModules()).toEqual(['main.fai.js', 'parts/sub/gear.fai.js'])
    await expect(loader.readSource('main.fai.js')).resolves.toBe('export const a = 1')
    await expect(loader.readSource('parts/sub/gear.fai.js')).resolves.toBe('export const b = 2')
  })

  it('rejects keys escaping the project root', async () => {
    const root = makeTempDir()
    const loader = createFsProjectLoader(root)
    await expect(loader.readSource('../outside.fai.js')).rejects.toThrow(/escapes the project root/)
  })
})

describe('findProjectRoot / projectKeyOf', () => {
  it('finds the nearest ancestor with package.json and yields a POSIX relative entry key', () => {
    const root = makeTempDir()
    writeFileSync(join(root, 'package.json'), '{}')
    const nested = join(root, 'src', 'deep')
    mkdirSync(nested, { recursive: true })
    const entry = join(nested, 'assembly.fai.js')
    writeFileSync(entry, 'export const part = 1')

    expect(findProjectRoot(entry)).toBe(root)
    expect(projectKeyOf(root, entry)).toBe('src/deep/assembly.fai.js')
  })
})
