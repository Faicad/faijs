/**
 * @vitest-environment node
 *
 * faijs-cli 测试 (P3-7)
 *
 * 测试内容：
 * 1. cliCheck: 合法 .fai.js → ok=true
 * 2. cliCheck: 非法 .fai.js → ok=false
 * 3. cliRun: 执行 .fai.js → 产出 STL
 * 4. cliRun: 执行 .fai.js → 产出 STEP (BREP mode)
 * 5. parseArgs: 命令行参数解析
 *
 * Run: npx vitest run src/node-host/cli.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cliCheck, cliRun, parseArgs } from './cli'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { ensureTestFontLoader } from '../brep/text/fontTestHelper'
import { createApiNamespace } from '@faicad/faijs-core/api/api-namespace'

// P6/D1：CLI 测试注入 cad（L3 api/ 层，原 stdlib 取消）
const CAD_LIBS = { cad: createApiNamespace() }

beforeAll(async () => {
  await registerOcctBrepEngine()
  ensureTestFontLoader()
}, 120000)

// P6：CLI fixture 随 test/faijs 移入 packages/tests（模块相对，与 cwd 无关）
const FIXTURES_DIR = fileURLToPath(new URL('../../../tests/faijs', import.meta.url))
const TMP_DIR = fileURLToPath(new URL('../../../tests/tmp-faijs-cli', import.meta.url))

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
  it('valid .fai.js file → ok=true', () => {
    const filePath = resolve(FIXTURES_DIR, 'boolean/box-boolean.fai.js')
    const result = cliCheck(filePath)
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.script).toBeDefined()
    expect(result.script!.callees).toContain('box')
    expect(result.script!.callees).toContain('sphere')
    expect(result.script!.callees).toContain('subtract')
  })

  it('invalid .fai.js (parse error) → ok=false', () => {
    const badCode = `export default async (cad) => {
  const part0 = cad.box({ size: 20
}`
    // Write temp file
    const tmpFile = resolve(TMP_DIR, 'bad-parse.fai.js')
    writeFileSync(tmpFile, badCode)
    const result = cliCheck(tmpFile)
    expect(result.ok).toBe(false)
    expect(result.errors[0].stage).toBe('parse')
  })

  it('invalid .fai.js (symbol error: unknown callee) → ok=false (module path)', async () => {
    const badCode = `export default async (cad) => {
  const part0 = cad.bogusFn({ size: 20 })
  return { shape: part0 }
}`
    const tmpFile = resolve(TMP_DIR, 'bad-symbol.fai.js')
    writeFileSync(tmpFile, badCode)
    // T4: check() 缺省走语法门禁（direct），未知 callee 放行 → ok=true。
    // 保留 module 路径行为对照：显式指定 executor='module' 做符号预检。
    const { createRuntime } = await import('../cad-runtime/runtime')
    const ports = { events: { emit: () => {} } } as never
    const runtime = createRuntime(ports, undefined, undefined, { executor: 'module' })
    const result = runtime.check(badCode)
    expect(result.ok).toBe(false)
    const symbolErrors = result.errors.filter((e) => e.stage === 'symbol')
    expect(symbolErrors.length).toBeGreaterThan(0)
    runtime.dispose()
  })
})

describe('cliRun: execute and export', () => {
  it('box-boolean.fai.js → STL multi-terminal output (keep-syntax 后 subtract 保留源且隐藏)', async () => {
    const filePath = resolve(FIXTURES_DIR, 'boolean/box-boolean.fai.js')
    const outPath = resolve(TMP_DIR, 'box-boolean.stl')

    const result = await cliRun(filePath, outPath, { mode: 'auto', libs: CAD_LIBS })

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

  it('box-boolean.fai.js → STEP multi-terminal output (brep mode)', async () => {
    const filePath = resolve(FIXTURES_DIR, 'boolean/box-boolean.fai.js')
    const outPath = resolve(TMP_DIR, 'box-boolean.step')

    const result = await cliRun(filePath, outPath, { mode: 'brep', libs: CAD_LIBS })

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

  it('text-engrave.fai.js → single terminal STL output', async () => {
    // box → part0；translate 保名复用 part0；text(part0) 是 creator → 新名 part1
    // DAG leaf: part0 被 text 消耗 → 非终端；part1 是唯一终端
    // 单终端 → 直接写到 outPath
    const filePath = resolve(FIXTURES_DIR, 'features/text-engrave.fai.js')
    const outPath = resolve(TMP_DIR, 'text-engrave.stl')

    const result = await cliRun(filePath, outPath, { mode: 'auto', libs: CAD_LIBS })

    expect(result.ok).toBe(true)
    expect(existsSync(outPath)).toBe(true)

    const buf = readFileSync(outPath)
    expect(buf.length).toBeGreaterThan(84)
  }, 60000)
})

describe('parseArgs', () => {
  it('parses check command', () => {
    const result = parseArgs(['node', 'cli.ts', 'check', 'model.fai.js'])
    expect(result.command).toBe('check')
    expect(result.file).toBe('model.fai.js')
  })

  it('parses run command with --out', () => {
    const result = parseArgs(['node', 'cli.ts', 'run', 'model.fai.js', '--out', 'output.stl'])
    expect(result.command).toBe('run')
    expect(result.file).toBe('model.fai.js')
    expect(result.out).toBe('output.stl')
  })

  it('parses --mode option', () => {
    const result = parseArgs(['node', 'cli.ts', 'run', 'model.fai.js', '--out', 'out.step', '--mode', 'brep'])
    expect(result.mode).toBe('brep')
  })

  it('parses --assets option', () => {
    const result = parseArgs(['node', 'cli.ts', 'run', 'model.fai.js', '--out', 'out.stl', '--assets', './assets/'])
    expect(result.assetsDir).toBe('./assets/')
  })

  it('returns null for unknown command', () => {
    const result = parseArgs(['node', 'cli.ts', 'unknown', 'model.fai.js'])
    expect(result.command).toBe(null)
  })

  it('returns null for no args', () => {
    const result = parseArgs(['node', 'cli.ts'])
    expect(result.command).toBe(null)
  })
})
