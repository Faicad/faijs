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
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { cliCheck, cliRun, cliView, parseArgs, selectExportableTerminals } from '../../src/node-host/cli'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { ensureTestFontLoader } from '@faicad/faijs/brep/text/fontTestHelper'

// CLI 测试注入 cad（L3 api/ 层）
const CAD_LIBS = { cad: createApiNamespaceWithEditorOps() }

beforeAll(async () => {
  await registerOcctBrepEngine()
  ensureTestFontLoader()
}, 120000)

// P6：CLI fixture 随 test/faijs 移入 packages/tests（模块相对，与 cwd 无关）
const FIXTURES_DIR = fileURLToPath(new URL('../../../tests/faijs', import.meta.url))
// 草稿目录放 OS 临时目录：宿主注入的 safe-delete shim 对「仓库内目录单轮删除 >50 文件」
// 有批量守卫（afterAll 递归清理会抛 SAFE_DELETE_BULK_CONFIRM_REQUIRED 把整个 suite 判失败），
// 而 os.tmpdir() 在豁免名单里（见用户级记忆的 safe-delete shim 条目）。
const TMP_DIR = join(tmpdir(), 'faijs-cli-tests')

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
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

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

  it('invalid .fai.js (unknown callee) → check ok=true (syntax gate only, runtime exposes)', async () => {
    const badCode = `export default async (cad) => {
  const part0 = cad.bogusFn({ size: 20 })
  return { shape: part0 }
}`
    const tmpFile = resolve(TMP_DIR, 'bad-symbol.fai.js')
    writeFileSync(tmpFile, badCode)
    // T5: check() only does syntax gating (acorn parse + statement summary).
    // Unknown callees pass check and surface at runtime.
    const { createRuntime } = await import('../../src/cad-runtime/runtime')
    const ports = { events: { emit: () => {} } } as never
    const runtime = createRuntime(ports, undefined, undefined)
    const result = runtime.check(badCode)
    expect(result.ok).toBe(true)
    runtime.dispose()
  })

  // D11 (2026-09-28): cliCheck adds the static unknown-op guard on top of
  // runtime.check — an op the cad namespace doesn't have must fail `check`
  // instead of passing clean and dying at run time with
  // "__ns.cad.x is not a function" (the fcstd-port A1 class of breakage:
  // host forgot to merge a library namespace).
  it('GOTCHA: cliCheck on unknown op → ok=false, stage symbol (runtime.check alone still passes)', () => {
    const badCode = `export default async (cad) => {
  const part0 = cad.bogusFn({ size: 20 })
  return { shape: part0 }
}`
    const tmpFile = resolve(TMP_DIR, 'cli-unknown-op.fai.js')
    writeFileSync(tmpFile, badCode)
    const result = cliCheck(tmpFile)
    expect(result.ok).toBe(false)
    const sym = result.errors.find((e) => e.stage === 'symbol')
    expect(sym).toBeDefined()
    expect(sym!.message).toContain('cad.bogusFn')
  })

  it('cliCheck with a host-missing library op (cad.sketch, unmerged host) → ok=false', () => {
    // The A1 regression shape: generated code calls cad.sketch but the host
    // never merged @faicad/faijs-sketch, so `sketch` is not in the symbol
    // table union. cliCheck must catch it statically.
    const code = `export default async (cad) => {
  const s0 = cad.sketch({ geoms: [] })
  return { shape: s0 }
}`
    const tmpFile = resolve(TMP_DIR, 'cli-unmerged-sketch.fai.js')
    writeFileSync(tmpFile, code)
    const result = cliCheck(tmpFile)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.stage === 'symbol' && e.message.includes('cad.sketch'))).toBe(true)
  })

  // I-group (2026-10-03): the guard above is right about a MISSING op but
  // wrong about a host-MERGED one. `rebased-sweep.ts` merges the sketch and
  // draw namespaces and hands them to cliRun, yet every product's checkErrors
  // carried `unknown op: cad.sketch ...` because cliCheck had no way to learn
  // what the host merges — it only reads the static symbol table. A sweep that
  // trusts checkErrors then reads every runnable product as broken.
  it('cliCheck accepts an op the host declares via opts.libs (same namespace cliRun gets)', () => {
    const code = `export default async (cad) => {
  const s0 = cad.sketch({ geoms: [] })
  return { shape: s0 }
}`
    const tmpFile = resolve(TMP_DIR, 'cli-merged-sketch.fai.js')
    writeFileSync(tmpFile, code)
    const result = cliCheck(tmpFile, { libs: { cad: { sketch: () => ({}) } } })
    expect(result.errors.filter((e) => e.stage === 'symbol')).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('opts.libs does not mask a genuinely absent op', () => {
    const code = `export default async (cad) => {
  const s0 = cad.sketch({ geoms: [] })
  const p0 = cad.bogusFn({ size: 20 })
  return { shape: p0 }
}`
    const tmpFile = resolve(TMP_DIR, 'cli-merged-partial.fai.js')
    writeFileSync(tmpFile, code)
    const result = cliCheck(tmpFile, { libs: { cad: { sketch: () => ({}) } } })
    expect(result.ok).toBe(false)
    const sym = result.errors.find((e) => e.stage === 'symbol')
    expect(sym!.message).toContain('cad.bogusFn')
  })
})

describe('cliRun: execute and export', () => {
  it('box-boolean.fai.js → STL 单文件输出（隐藏源默认不导出）', async () => {
    const filePath = resolve(FIXTURES_DIR, 'boolean/box-boolean.fai.js')
    const outPath = resolve(TMP_DIR, 'box-boolean.stl')

    const result = await cliRun(filePath, outPath, { mode: 'auto', libs: CAD_LIBS })

    expect(result.ok).toBe(true)
    expect(result.outputFormat).toBe('stl')
    // keep-syntax §2.5：subtract 函数体 exec.keepHidden(inputs) → part0/part1 保留但 hidden。
    // 隐藏终端在导出层被剔除 ⇒ 只剩可见终端 part2 一个 → 单终端直接写 outPath。
    // 修复前这里会产出 out.stl_0_part0 / _1_part1 / _2_part2 三份（隐藏源泄漏 → solids 1vsN）。
    expect(existsSync(outPath)).toBe(true)
    expect(existsSync(`${TMP_DIR}/box-boolean.stl_0_part0.stl`)).toBe(false)
    expect(existsSync(`${TMP_DIR}/box-boolean.stl_1_part1.stl`)).toBe(false)
    expect(existsSync(`${TMP_DIR}/box-boolean.stl_2_part2.stl`)).toBe(false)

    // Verify STL file is non-empty and has valid header
    const buf = readFileSync(outPath)
    expect(buf.length).toBeGreaterThan(84) // at least header + count
    // STL header: first 80 bytes
    const header = buf.slice(0, 10).toString('utf-8')
    expect(header).toContain('Faicad')
  }, 60000)

  it('box-boolean.fai.js → STEP 单文件输出（brep mode，隐藏源不落盘）', async () => {
    const filePath = resolve(FIXTURES_DIR, 'boolean/box-boolean.fai.js')
    const outPath = resolve(TMP_DIR, 'box-boolean.step')

    const result = await cliRun(filePath, outPath, { mode: 'brep', libs: CAD_LIBS })

    expect(result.ok).toBe(true)
    expect(result.outputFormat).toBe('step')
    // 单终端（可见的 part2）→ 直接写 outPath；隐藏的 part0/part1 不再各写一份
    expect(existsSync(outPath)).toBe(true)
    expect(existsSync(`${TMP_DIR}/box-boolean.step_0_part0.step`)).toBe(false)
    expect(existsSync(`${TMP_DIR}/box-boolean.step_1_part1.step`)).toBe(false)

    // Verify STEP file contains STEP content
    const content = readFileSync(outPath, 'utf-8')
    expect(content).toContain('ISO-10303-21')
    expect(content).toContain('ADVANCED_FACE')
  }, 60000)

  it('纯网格零件（STL 导入）→ STEP 导出仍可用（mesh 重建通路）', async () => {
    // 2026-10-02 曾把这条通路从导出入口整体摘掉（E_STEP_MESH_PART）：网格零件被
    // 结构性拒绝导出 STEP。该改动已撤销——脚本面纯网格模型导 STEP 必须照旧可用，
    // 本用例钉住它，防止再次被无声摘掉。
    const tmpFile = resolve(TMP_DIR, 'mesh-load.fai.js')
    writeFileSync(tmpFile, "let a = await cad.load({ file: 'cube-10x5x5.stl' })")
    const outPath = resolve(TMP_DIR, 'mesh-load.step')
    const meshAssets = fileURLToPath(new URL('../../../fixtures/data', import.meta.url))

    const result = await cliRun(tmpFile, outPath, {
      mode: 'auto',
      libs: CAD_LIBS,
      assetsDir: meshAssets,
    })

    expect(result.ok, result.error ?? '').toBe(true)
    expect(result.outputFormat).toBe('step')
    expect(existsSync(outPath)).toBe(true)
    const content = readFileSync(outPath, 'utf-8')
    expect(content).toContain('ISO-10303-21')
    // 网格零件经 reconstructSolidFromMesh 重建后按精确 BREP 形态写出。
    expect(content).toContain('ADVANCED_FACE')
  }, 120000)

  it('装配兜底导出（writeAssemblyStep fallback）同样剔除隐藏终端', async () => {
    // 空成员 group → mesh-less 结构 compound 且 memberNames 为空 ⇒ 走 writeAssemblyStep 的
    // 「导出全部 brepSolids」兜底路径——这正是隐藏源最容易被顺手带出去的地方。
    const code = [
      `let part0 = cad.box(20, 20, 20, { centered: true })`,
      `let part1 = cad.sphere({ radius: 8, center: [0, 0, 0] })`,
      `let part2 = cad.subtract(part0, part1)`,
      `let g = cad.group({ name: 'g', members: [] })`,
    ].join('\n')
    const tmpFile = resolve(TMP_DIR, 'asm-fallback.fai.js')
    const visiblePath = resolve(TMP_DIR, 'asm-fallback.step')
    const allPath = resolve(TMP_DIR, 'asm-fallback-hidden.step')
    writeFileSync(tmpFile, code)

    const visible = await cliRun(tmpFile, visiblePath, { mode: 'brep', libs: CAD_LIBS })
    const all = await cliRun(tmpFile, allPath, { mode: 'brep', libs: CAD_LIBS, includeHidden: true })
    expect(visible.ok).toBe(true)
    expect(all.ok).toBe(true)

    // ADVANCED_BREP_SHAPE_REPRESENTATION 数量 = 导出实体数（带内腔的 subtract 结果也记 1）。
    const solidCount = (p: string) =>
      (readFileSync(p, 'utf-8').match(/ADVANCED_BREP_SHAPE_REPRESENTATION/g) ?? []).length
    expect(solidCount(visiblePath)).toBe(1) // 兜底只带出可见终端 part2
    expect(solidCount(allPath)).toBe(3) // includeHidden 才恢复 part0/part1/part2
  }, 60000)

  it('includeHidden:true → 显式取回旧行为（隐藏源一并导出，多终端）', async () => {
    const filePath = resolve(FIXTURES_DIR, 'boolean/box-boolean.fai.js')
    const outPath = resolve(TMP_DIR, 'box-boolean-hidden.stl')

    const result = await cliRun(filePath, outPath, { mode: 'auto', libs: CAD_LIBS, includeHidden: true })

    expect(result.ok).toBe(true)
    // 3 个终端（含 2 个 hidden）→ 多终端导出（<out>_i_<name>.<ext>）
    expect(existsSync(`${TMP_DIR}/box-boolean-hidden.stl_0_part0.stl`)).toBe(true)
    expect(existsSync(`${TMP_DIR}/box-boolean-hidden.stl_1_part1.stl`)).toBe(true)
    expect(existsSync(`${TMP_DIR}/box-boolean-hidden.stl_2_part2.stl`)).toBe(true)
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

  it('parses view command with --view', () => {
    const result = parseArgs(['node', 'cli.ts', 'view', 'model.fai.js', '--out', 'out.svg', '--view', 'iso'])
    expect(result.command).toBe('view')
    expect(result.file).toBe('model.fai.js')
    expect(result.out).toBe('out.svg')
    expect(result.view).toBe('iso')
  })

  it('parses view command with --sheet and --part', () => {
    const result = parseArgs(['node', 'cli.ts', 'view', 'model.fai.js', '--out', 'out.svg', '--sheet', 'front,top,right,iso', '--part', 'part0'])
    expect(result.command).toBe('view')
    expect(result.sheet).toBe('front,top,right,iso')
    expect(result.part).toBe('part0')
  })

  it('parses --include-hidden flag', () => {
    const result = parseArgs(['node', 'cli.ts', 'run', 'model.fai.js', '--out', 'out.stl', '--include-hidden'])
    expect(result.includeHidden).toBe(true)
  })

  it('returns null for no args', () => {
    const result = parseArgs(['node', 'cli.ts'])
    expect(result.command).toBe(null)
  })
})

describe('selectExportableTerminals: 导出层隐藏终端判据（单一事实来源）', () => {
  const T = (id: string, hidden?: boolean) => ({ id, ...(hidden ? { hidden: true } : {}) })

  it('默认剔除 hidden 终端，保留其余（顺序不变）', () => {
    const { exportable, hiddenCount } = selectExportableTerminals([
      T('part0', true),
      T('part1', true),
      T('part2'),
    ])
    expect(exportable.map((t) => t.id)).toEqual(['part2'])
    expect(hiddenCount).toBe(2)
  })

  it('includeHidden:true → 全部保留（含 hidden）', () => {
    const all = [T('part0', true), T('part1'), T('part2', true)]
    const { exportable, hiddenCount } = selectExportableTerminals(all, true)
    expect(exportable).toEqual(all)
    expect(hiddenCount).toBe(2)
  })

  it('全部隐藏 → exportable 为空、hiddenCount=总数（上层据此报错而非静默回退）', () => {
    const { exportable, hiddenCount } = selectExportableTerminals([T('a', true), T('b', true)])
    expect(exportable).toEqual([])
    expect(hiddenCount).toBe(2)
  })

  it('无 hidden → 原样返回（零回归）', () => {
    const { exportable, hiddenCount } = selectExportableTerminals([T('a'), T('b')])
    expect(exportable.map((t) => t.id)).toEqual(['a', 'b'])
    expect(hiddenCount).toBe(0)
  })

  it('空集合 → 空、hiddenCount=0', () => {
    const { exportable, hiddenCount } = selectExportableTerminals([])
    expect(exportable).toEqual([])
    expect(hiddenCount).toBe(0)
  })
})

describe('cliView: execute and project view SVG', () => {
  // 20×30×40 centered box：front 视图（xz 平面投影）宽 20、高 40，margin=1 → viewBox "-11 -21 22 42"
  // 单行脚本：part0 是唯一顶层变量 → 唯一终端（顶层未消费变量都是终端）
  const BOX_CODE = `let part0 = cad.box(20, 30, 40, { centered: true })`

  it('writes single-view SVG (default front) with correct viewBox', async () => {
    const tmpFile = resolve(TMP_DIR, 'view-box.fai.js')
    writeFileSync(tmpFile, BOX_CODE)
    const outPath = resolve(TMP_DIR, 'view-box.svg')

    const result = await cliView(tmpFile, outPath, { libs: CAD_LIBS })

    expect(result.ok).toBe(true)
    expect(result.outputFiles).toEqual([outPath])
    const svg = readFileSync(outPath, 'utf-8')
    expect(svg).toContain('<svg')
    expect(svg).toContain('viewBox="-11 -21 22 42"')
    // 可见实线路径存在
    expect(svg).toContain('<path d=')
  }, 60000)

  it('writes iso view with hidden dashed lines', async () => {
    const tmpFile = resolve(TMP_DIR, 'view-iso.fai.js')
    writeFileSync(tmpFile, BOX_CODE)
    const outPath = resolve(TMP_DIR, 'view-iso.svg')

    const result = await cliView(tmpFile, outPath, { libs: CAD_LIBS, view: 'iso' })

    expect(result.ok).toBe(true)
    const svg = readFileSync(outPath, 'utf-8')
    expect(svg).toContain('stroke-dasharray')
    expect(svg).toContain('opacity="0.6"')
  }, 60000)

  it('writes a multi-view sheet (front,top,right,iso) with nested svg cells and labels', async () => {
    const tmpFile = resolve(TMP_DIR, 'view-sheet.fai.js')
    writeFileSync(tmpFile, BOX_CODE)
    const outPath = resolve(TMP_DIR, 'view-sheet.svg')

    const result = await cliView(tmpFile, outPath, { libs: CAD_LIBS, sheet: ['front', 'top', 'right', 'iso'] })

    expect(result.ok).toBe(true)
    const svg = readFileSync(outPath, 'utf-8')
    expect(svg).toContain('<svg x=')
    for (const label of ['front', 'top', 'right', 'iso']) {
      expect(svg).toContain(`>${label}</text>`)
    }
  }, 60000)

  it('supports --part to project a specific shape variable', async () => {
    const tmpFile = resolve(TMP_DIR, 'view-part.fai.js')
    writeFileSync(tmpFile, BOX_CODE)
    const outPath = resolve(TMP_DIR, 'view-part.svg')

    const result = await cliView(tmpFile, outPath, { libs: CAD_LIBS, part: 'part0' })

    expect(result.ok).toBe(true)
    expect(existsSync(outPath)).toBe(true)
  }, 60000)

  it('writes one file per terminal for multi-terminal scripts', async () => {
    const code = [
      `let part0 = cad.box(10, 10, 10, { centered: true })`,
      `let part1 = cad.box(20, 20, 20, { centered: true })`,
      `let result = part1`,
    ].join('\n')
    const tmpFile = resolve(TMP_DIR, 'view-multi.fai.js')
    writeFileSync(tmpFile, code)
    const outPath = resolve(TMP_DIR, 'view-multi.svg')

    const result = await cliView(tmpFile, outPath, { libs: CAD_LIBS })

    // 顶层未消费变量都是终端：part0 / part1（被 result 引用但非函数消费）/ result → 3 个文件
    expect(result.ok).toBe(true)
    expect(result.outputFiles).toHaveLength(3)
    for (const f of result.outputFiles!) expect(existsSync(f)).toBe(true)
    // 命名后缀：<out>_<i>_<name>.svg
    expect(result.outputFiles![0]).toContain('view-multi.svg_0_part0.svg')
  }, 60000)

  it('隐藏终端不投影（keep/keepHidden 保留的源几何不落盘）', async () => {
    // subtract 函数体 keepHidden(part0, part1) → 只有 part2 可见。
    // 修复前：part0/part1(hidden)/part2 三个终端各写一份 svg（隐藏源泄漏）；
    // 修复后：只剩可见终端 part2 → 单文件直写 outPath。
    const code = [
      `let part0 = cad.box(20, 20, 20, { centered: true })`,
      `let part1 = cad.sphere({ radius: 8, center: [5, 0, 0] })`,
      `let part2 = cad.subtract(part0, part1)`,
    ].join('\n')
    const tmpFile = resolve(TMP_DIR, 'view-hidden.fai.js')
    writeFileSync(tmpFile, code)
    const outPath = resolve(TMP_DIR, 'view-hidden.svg')

    const result = await cliView(tmpFile, outPath, { libs: CAD_LIBS })

    expect(result.ok).toBe(true)
    expect(result.outputFiles).toEqual([outPath])
    expect(existsSync(`${TMP_DIR}/view-hidden.svg_0_part0.svg`)).toBe(false)
    expect(existsSync(`${TMP_DIR}/view-hidden.svg_1_part1.svg`)).toBe(false)
  }, 60000)

  it('reports E_BREP_ONLY_INPUT when the shape has no BREP slot (mesh mode)', async () => {
    const tmpFile = resolve(TMP_DIR, 'view-mesh.fai.js')
    writeFileSync(tmpFile, BOX_CODE)
    const outPath = resolve(TMP_DIR, 'view-mesh.svg')

    const result = await cliView(tmpFile, outPath, { libs: CAD_LIBS, mode: 'mesh' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('E_BREP_ONLY_INPUT')
    expect(existsSync(outPath)).toBe(false)
  }, 60000)

  it('reports unknown view direction as an error', async () => {
    const tmpFile = resolve(TMP_DIR, 'view-bogus.fai.js')
    writeFileSync(tmpFile, BOX_CODE)
    const outPath = resolve(TMP_DIR, 'view-bogus.svg')

    const result = await cliView(tmpFile, outPath, { libs: CAD_LIBS, view: 'bogus' as never })

    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
    expect(existsSync(outPath)).toBe(false)
  }, 60000)

  it('reports missing --part target as an error', async () => {
    const tmpFile = resolve(TMP_DIR, 'view-nopart.fai.js')
    writeFileSync(tmpFile, BOX_CODE)
    const outPath = resolve(TMP_DIR, 'view-nopart.svg')

    const result = await cliView(tmpFile, outPath, { libs: CAD_LIBS, part: 'nope' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('nope')
  }, 60000)
})

// [PAUSED] occt-wasm XCAF kernel 开发暂时搁置：下列两层 STEP 导入/导出 round-trip
// 依赖 occt-wasm 的 XCAF 通道（xcafImportSTEP / importAssemblyFromStep），
// 恢复开发前整体 skip，见 docs/plans/2026-10-05-occt-wasm-xcaf-part-metadata.md。
describe.skip('cliRun: assembly STEP export preserves member names', () => {
  it('cad.assembly with explicit memberNames exports members under those names', async () => {
    const code = [
      `let part0 = cad.box(10, 10, 10, { centered: true })`,
      `let part1 = cad.box(10, 10, 10, { centered: true, at: [20, 0, 0] })`,
      `let asm = cad.assembly({ name: 'A', members: [part0, part1], memberNames: ['left', 'right'] })`,
      `let result = asm`,
    ].join('\n')
    const tmpFile = resolve(TMP_DIR, 'asm-export.fai.js')
    writeFileSync(tmpFile, code)
    const outPath = resolve(TMP_DIR, 'asm-export.step')

    const result = await cliRun(tmpFile, outPath, { mode: 'brep', libs: CAD_LIBS })
    expect(result.ok).toBe(true)
    expect(result.outputFormat).toBe('step')

    const { initOcctWasm, importAssemblyFromStep, collectLeafParts, releaseAssemblyTree } = await import('@faicad/faijs')
    const kernel = await initOcctWasm()
    const buf = readFileSync(outPath)
    const nodes = await importAssemblyFromStep(buf.buffer as ArrayBuffer)
    try {
      const leaves = collectLeafParts(nodes).filter((n) => n.shapeHandle !== null)
      const names = leaves.map((l) => l.name).sort()
      expect(names).toEqual(['left', 'right'])
    } finally {
      // Release the imported tree (API shape per importAssemblyFromStep contract)
      releaseAssemblyTree(kernel, nodes)
    }
  }, 60000)
})

describe.skip('cliRun: assembly do_assemble with explicit short memberNames', () => {
  // 回归：solve/do_assemble 应用变换后，solidCache 必须以成员"变量名"键同步
  // （shapeToName 反查），不能用 CadQuery 风格短名 memberNames——否则变量名键
  // 仍指向已 release 的悬空句柄，导出阶段 buildBrepTopology → INVALID_SHAPE_ID。
  // 修复前本测试 failedAt；修复后求解位姿应用 + STEP 导出成功且成员名保真。
  it('applies solved transforms and exports without INVALID_SHAPE_ID', async () => {
    const code = [
      `let part0 = cad.box(10, 10, 10, { centered: true })`,
      `let part1 = cad.box(10, 10, 10, { centered: true, at: [0, 0, 20] })`,
      `let asm = cad.assembly({ name: 'A', members: [part0, part1], memberNames: ['left', 'right'], constraints: [{ type: 'mate', a: { part: 'left', face: { surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] } }, b: { part: 'right', face: { surfaceType: 'plane', center: [0, 0, 15], normal: [0, 0, -1] } } }] })`,
      `asm.do_assemble()`,
      `let result = asm`,
    ].join('\n')
    const tmpFile = resolve(TMP_DIR, 'asm-solve-short-names.fai.js')
    writeFileSync(tmpFile, code)
    const outPath = resolve(TMP_DIR, 'asm-solve-short-names.step')

    const result = await cliRun(tmpFile, outPath, { mode: 'brep', libs: CAD_LIBS })
    expect(result.ok).toBe(true)
    expect(result.outputFormat).toBe('step')

    const { initOcctWasm, importAssemblyFromStep, collectLeafParts, releaseAssemblyTree } = await import('@faicad/faijs')
    const kernel = await initOcctWasm()
    const buf = readFileSync(outPath)
    const nodes = await importAssemblyFromStep(buf.buffer as ArrayBuffer)
    try {
      const leaves = collectLeafParts(nodes).filter((n) => n.shapeHandle !== null)
      const names = leaves.map((l) => l.name).sort()
      expect(names).toEqual(['left', 'right'])
    } finally {
      releaseAssemblyTree(kernel, nodes)
    }
  }, 60000)
})
