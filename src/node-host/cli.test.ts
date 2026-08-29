/**
 * @vitest-environment node
 *
 * faijs-cli 测试 (P3-7)
 *
 * 测试内容：
 * 1. cliCheck: 合法 .faijs → ok=true
 * 2. cliCheck: 非法 .faijs → ok=false
 * 3. cliRun: 执行 .faijs → 产出 STL
 * 4. cliRun: 执行 .faijs → 产出 STEP (BREP mode)
 * 5. parseArgs: 命令行参数解析
 *
 * Run: npx vitest run src/node-host/cli.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cliCheck, cliRun, parseArgs } from './cli'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import { ensureTestFontLoader } from '../brep/text/fontTestHelper'

beforeAll(async () => {
  await initOcctWasm()
  ensureTestFontLoader()
}, 120000)

const FIXTURES_DIR = resolve(process.cwd(), 'test/faijs')
const TMP_DIR = resolve(process.cwd(), 'test/tmp-faijs-cli')

// Ensure tmp directory exists
beforeAll(() => {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true })
  }
})

// Cleanup after tests
afterAll(() => {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true, force: true })
  }
})

// Need to import afterAll
import { afterAll } from 'vitest'

describe('cliCheck: dryRun validation', () => {
  it('valid .faijs file → ok=true', () => {
    const filePath = resolve(FIXTURES_DIR, 'boolean/box-boolean.faijs')
    const result = cliCheck(filePath)
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.script).toBeDefined()
    expect(result.script!.callees).toContain('box')
    expect(result.script!.callees).toContain('sphere')
    expect(result.script!.callees).toContain('subtract')
  })

  it('invalid .faijs (parse error) → ok=false', () => {
    const badCode = `export default async (cad) => {
  const part0 = cad.box({ size: 20
}`
    // Write temp file
    const tmpFile = resolve(TMP_DIR, 'bad-parse.faijs')
    writeFileSync(tmpFile, badCode)
    const result = cliCheck(tmpFile)
    expect(result.ok).toBe(false)
    expect(result.errors[0].stage).toBe('parse')
  })

  it('invalid .faijs (symbol error: unknown callee) → ok=false', () => {
    const badCode = `export default async (cad) => {
  const part0 = cad.bogusFn({ size: 20 })
  return { shape: part0 }
}`
    const tmpFile = resolve(TMP_DIR, 'bad-symbol.faijs')
    writeFileSync(tmpFile, badCode)
    const result = cliCheck(tmpFile)
    expect(result.ok).toBe(false)
    const symbolErrors = result.errors.filter((e) => e.stage === 'symbol')
    expect(symbolErrors.length).toBeGreaterThan(0)
  })
})

describe('cliRun: execute and export', () => {
  it('box-boolean.faijs → STL multi-terminal output (keep-syntax 后 subtract 保留源且隐藏)', async () => {
    const filePath = resolve(FIXTURES_DIR, 'boolean/box-boolean.faijs')
    const outPath = resolve(TMP_DIR, 'box-boolean.stl')

    const result = await cliRun(filePath, outPath, { mode: 'auto' })

    expect(result.ok).toBe(true)
    expect(result.outputFormat).toBe('stl')
    // keep-syntax §2.5：subtract 函数体 exec.keepHidden(inputs) → part0/part1 保留（隐藏）
    // DAG 叶子 = part0/part1(hidden)/part2 三个终端 → 多终端导出（<out>_i_<name>.<ext>）
    expect(existsSync(`${TMP_DIR}/box-boolean.stl_0_part0.stl`)).toBe(true)
    expect(existsSync(`${TMP_DIR}/box-boolean.stl_1_part1.stl`)).toBe(true)
    expect(existsSync(`${TMP_DIR}/box-boolean.stl_2_part2.stl`)).toBe(true)

    // Verify STL file is non-empty and has valid header
    const buf = readFileSync(`${TMP_DIR}/box-boolean.stl_2_part2.stl`)
    expect(buf.length).toBeGreaterThan(84) // at least header + count
    // STL header: first 80 bytes
    const header = buf.slice(0, 10).toString('utf-8')
    expect(header).toContain('Faicad')
  }, 60000)

  it('box-boolean.faijs → STEP multi-terminal output (brep mode)', async () => {
    const filePath = resolve(FIXTURES_DIR, 'boolean/box-boolean.faijs')
    const outPath = resolve(TMP_DIR, 'box-boolean.step')

    const result = await cliRun(filePath, outPath, { mode: 'brep' })

    expect(result.ok).toBe(true)
    expect(result.outputFormat).toBe('step')
    // 多终端导出：subtract 产物（part2）是唯一带 BREP solid 的终端
    const part2File = `${TMP_DIR}/box-boolean.step_2_part2.step`
    expect(existsSync(part2File)).toBe(true)

    // Verify STEP file contains STEP content
    const content = readFileSync(part2File, 'utf-8')
    expect(content).toContain('ISO-10303-21')
    expect(content).toContain('ADVANCED_FACE')
  }, 60000)

  it('text-engrave.faijs → single terminal STL output', async () => {
    // box → part0；translate 保名复用 part0；text(part0) 是 creator → 新名 part1
    // DAG leaf: part0 被 text 消耗 → 非终端；part1 是唯一终端
    // 单终端 → 直接写到 outPath
    const filePath = resolve(FIXTURES_DIR, 'features/text-engrave.faijs')
    const outPath = resolve(TMP_DIR, 'text-engrave.stl')

    const result = await cliRun(filePath, outPath, { mode: 'auto' })

    expect(result.ok).toBe(true)
    expect(existsSync(outPath)).toBe(true)

    const buf = readFileSync(outPath)
    expect(buf.length).toBeGreaterThan(84)
  }, 60000)
})

describe('parseArgs', () => {
  it('parses check command', () => {
    const result = parseArgs(['node', 'cli.ts', 'check', 'model.faijs'])
    expect(result.command).toBe('check')
    expect(result.file).toBe('model.faijs')
  })

  it('parses run command with --out', () => {
    const result = parseArgs(['node', 'cli.ts', 'run', 'model.faijs', '--out', 'output.stl'])
    expect(result.command).toBe('run')
    expect(result.file).toBe('model.faijs')
    expect(result.out).toBe('output.stl')
  })

  it('parses --mode option', () => {
    const result = parseArgs(['node', 'cli.ts', 'run', 'model.faijs', '--out', 'out.step', '--mode', 'brep'])
    expect(result.mode).toBe('brep')
  })

  it('parses --assets option', () => {
    const result = parseArgs(['node', 'cli.ts', 'run', 'model.faijs', '--out', 'out.stl', '--assets', './assets/'])
    expect(result.assetsDir).toBe('./assets/')
  })

  it('returns null for unknown command', () => {
    const result = parseArgs(['node', 'cli.ts', 'unknown', 'model.faijs'])
    expect(result.command).toBe(null)
  })

  it('returns null for no args', () => {
    const result = parseArgs(['node', 'cli.ts'])
    expect(result.command).toBe(null)
  })
})
