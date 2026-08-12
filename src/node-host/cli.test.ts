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
import { initOcctWasm } from '../occt/occtKernel'
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
    const filePath = resolve(FIXTURES_DIR, 'box-boolean.faijs')
    const result = cliCheck(filePath)
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.script).toBeDefined()
    expect(result.script!.ops).toContain('box')
    expect(result.script!.ops).toContain('sphere')
    expect(result.script!.ops).toContain('boolean')
  })

  it('invalid .faijs (parse error) → ok=false', () => {
    const badCode = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20
}`
    // Write temp file
    const tmpFile = resolve(TMP_DIR, 'bad-parse.faijs')
    writeFileSync(tmpFile, badCode)
    const result = cliCheck(tmpFile)
    expect(result.ok).toBe(false)
    expect(result.errors[0].stage).toBe('parse')
  })

  it('invalid .faijs (schema error) → ok=false', () => {
    const badCode = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20, bogusField: 99 })
  return { shape: part0_v0 }
}`
    const tmpFile = resolve(TMP_DIR, 'bad-schema.faijs')
    writeFileSync(tmpFile, badCode)
    const result = cliCheck(tmpFile)
    expect(result.ok).toBe(false)
    const schemaErrors = result.errors.filter((e) => e.stage === 'schema')
    expect(schemaErrors.length).toBeGreaterThan(0)
  })
})

describe('cliRun: execute and export', () => {
  it('box-boolean.faijs → STL output', async () => {
    const filePath = resolve(FIXTURES_DIR, 'box-boolean.faijs')
    const outPath = resolve(TMP_DIR, 'box-boolean.stl')

    const result = await cliRun(filePath, outPath, { mode: 'auto' })

    expect(result.ok).toBe(true)
    expect(result.outputFormat).toBe('stl')
    expect(existsSync(outPath)).toBe(true)

    // Verify STL file is non-empty and has valid header
    const buf = readFileSync(outPath)
    expect(buf.length).toBeGreaterThan(84) // at least header + count
    // STL header: first 80 bytes
    const header = buf.slice(0, 10).toString('utf-8')
    expect(header).toContain('Faicad')
  }, 60000)

  it('box-boolean.faijs → STEP output (brep mode)', async () => {
    const filePath = resolve(FIXTURES_DIR, 'box-boolean.faijs')
    const outPath = resolve(TMP_DIR, 'box-boolean.step')

    const result = await cliRun(filePath, outPath, { mode: 'brep' })

    expect(result.ok).toBe(true)
    expect(result.outputFormat).toBe('step')
    expect(existsSync(outPath)).toBe(true)

    // Verify STEP file contains STEP content
    const content = readFileSync(outPath, 'utf-8')
    expect(content).toContain('ISO-10303-21')
    expect(content).toContain('ADVANCED_FACE')
  }, 60000)

  it('text-engrave.faijs → STL output', async () => {
    const filePath = resolve(FIXTURES_DIR, 'text-engrave.faijs')
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
