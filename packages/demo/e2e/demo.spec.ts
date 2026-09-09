import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

/**
 * E2E tests for the faijs CAD demo.
 *
 * The dev server is started by playwright.config.ts (vite on :8899).
 * On page load the demo auto-runs the default "box-boolean" example, so
 * every test first waits for the initial run to complete ("OK — brep: ...").
 */

const SELECTOR = {
  editor: '#code-editor',
  runBtn: '#run-btn',
  openBtn: '#open-btn',
  openDirBtn: '#open-dir-btn',
  fileInput: '#file-input',
  exampleSelect: '#example-select',
  statusBar: '#status-bar',
  btnStep: '#btn-step',
  btnStl: '#btn-stl',
  canvasBrep: '#canvas-brep',
  canvasMesh: '#canvas-mesh',
}

const EXAMPLE_SNIPPETS: Record<string, string> = {
  'box-boolean': 'cad.box(20, 20, 20, { centered: true })',
  'drill-test': 'cad.cylinder(5, 20, { centered: true',
  'text-engrave': "cad.text(part0, { text: 'HELLO'",
  'transform-chain': 'cad.rotate_euler(part0, { anglesDeg: [0, 0, 30] }',
}

async function waitForStatusOk(page: Page, timeout = 120_000) {
  await expect(page.locator(SELECTOR.statusBar)).toContainText('OK — brep:', { timeout })
  await expect(page.locator(SELECTOR.statusBar)).toContainText('| mesh:')
}

async function runCode(page: Page) {
  await page.locator(SELECTOR.runBtn).click()
  await waitForStatusOk(page)
}

// ── Open Folder（browser ProjectLoader 多文件 §4.5）e2e helpers ──
// Playwright 无法驱动真实 showDirectoryPicker 系统对话框；OPFS 根与 picker 返回
// 的目录句柄**接口同构**（kind/entries()/getDirectoryHandle/getFileHandle/getFile）。
// 方案：addInitScript 把 showDirectoryPicker stub 为返回 OPFS 根，文件树用真实
// OPFS API（createWritable）写入 → 全链路真实数据流。

/** stub showDirectoryPicker → OPFS 根（须在 page.goto() 之前调用）。 */
function stubShowDirectoryPickerAsOpfs(page: Page) {
  return page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      value: async () => (navigator as unknown as { storage: { getDirectory(): unknown } }).storage.getDirectory(),
      configurable: true,
    })
  })
}

/** 在 OPFS 根页面上重建项目树（先清空，再递归建目录 + 写文件）。 */
async function seedOpfsProject(page: Page, files: Record<string, string>) {
  await page.evaluate(async (entries) => {
    const root = await (navigator as any).storage.getDirectory()
    for await (const [name] of root.entries()) {
      await root.removeEntry(name, { recursive: true }).catch(() => {})
    }
    for (const [rel, text] of Object.entries(entries)) {
      const segs = rel.split('/')
      let dir = root
      for (const seg of segs.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(seg, { create: true })
      }
      const fh = await dir.getFileHandle(segs[segs.length - 1], { create: true })
      const w = await fh.createWritable()
      await w.write(text)
      await w.close()
    }
  }, files)
}

/** 读取某个 .fai.js 项目目录树：相对项目根 POSIX key → 源码文本（供 OPFS 种子）。 */
async function readFaiProjectTree(dirUrl: URL): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  const walk = async (dir: URL, base: string) => {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        const sub = new URL(`${ent.name}/`, dir)
        await walk(sub, base ? `${base}/${ent.name}` : ent.name)
      } else if (ent.name.endsWith('.fai.js')) {
        files[base ? `${base}/${ent.name}` : ent.name] = await readFile(new URL(ent.name, dir), 'utf-8')
      }
    }
  }
  await walk(dirUrl, '')
  // 排序固定顺序（readdir 顺序不保证）
  const out: Record<string, string> = {}
  for (const key of Object.keys(files).sort()) out[key] = files[key]
  return out
}

test.describe('faijs demo', () => {
  test('页面加载：标题、默认示例代码、初始状态栏', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle('faijs — CAD Scripting Demo')
    await expect(page.locator(SELECTOR.editor)).toHaveValue(/cad\.box\(20, 20, 20, \{ centered: true \}\)/)
    await expect(page.locator(SELECTOR.exampleSelect)).toHaveValue('box-boolean')
    // 下载按钮初始为 disabled（尚无成功运行结果）
    await expect(page.locator(SELECTOR.btnStep)).toBeDisabled()
    await expect(page.locator(SELECTOR.btnStl)).toBeDisabled()
  })

  test('加载后自动运行默认示例，状态栏显示 OK 与形状统计', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)
    const status = await page.locator(SELECTOR.statusBar).textContent()
    // DAG leaf: box + sphere + subtract → 仅 subtract 终端 (1 个)
    expect(status).toMatch(/OK — brep: 1 shape\(s\), \d+ verts, \d+ triangles \| mesh: 1 shape\(s\)/)
    expect(page.locator(SELECTOR.statusBar)).toHaveClass(/success/)
  })

  test('dev：两条链路 wasm 均从本地加载（非 CDN）', async ({ page }) => {
    // 与 preview-cdn.spec.ts 的 CDN 断言互为正反：dev 模式 manifold/occt wasm
    // 必须走 vite dev server 的本地文件（main.ts 的 import.meta.env.DEV 分支，
    // wasmAssets() 中间件把 /wasm/* 映射到 node_modules 物理文件）。
    // worker 内发起的 wasm 请求同样会被 page.on('request') 捕获。
    const wasmRequests: string[] = []
    page.on('request', (req) => {
      if (req.url().endsWith('.wasm')) wasmRequests.push(req.url())
    })

    await page.goto('/')
    await waitForStatusOk(page)

    const local = (path: string) => new URL(path, 'http://localhost:8899').toString()
    expect(wasmRequests).toContain(local('/wasm/occt-wasm.wasm'))
    expect(wasmRequests).toContain(local('/wasm/manifold.wasm'))
    expect(wasmRequests.length).toBeGreaterThanOrEqual(2)
    // 一条 CDN 请求都不许出现（dev 模式必须全部本地加载）
    expect(wasmRequests.every((u) => u.startsWith('http://localhost:8899/'))).toBe(true)
  })

  test('切换示例：编辑器内容更新并自动运行', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)

    for (const [value, snippet] of Object.entries(EXAMPLE_SNIPPETS)) {
      await page.locator(SELECTOR.exampleSelect).selectOption(value)
      await expect(page.locator(SELECTOR.editor)).toHaveValue(new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      await waitForStatusOk(page)
    }
  })

  test('gear-demo：libLoader 自动装载，brep 成功、mesh 显式不可用', async ({ page }) => {
    // gear 库是 brep-only（compatOp）；mesh 模式必须 E_MESH_UNSUPPORTED（无回退）。
    // 不在 EXAMPLE_SNIPPETS 中做「切换示例」通用断言（mesh 不 OK），单独断言。
    await page.goto('/')
    await waitForStatusOk(page)

    await page.locator(SELECTOR.exampleSelect).selectOption('gear-demo')
    await expect(page.locator(SELECTOR.editor)).toHaveValue(/import \* as gear from 'gear-lib-demo'/)
    // import specifier + packageName 严格一致 → autoLoadlibs 在 execute 阶段装载 'gear' 绑定
    await waitForStatusOk(page)
    const status = await page.locator(SELECTOR.statusBar).textContent()
    // gear.external + gear.thread + cad.union → union 终端 1 个
    expect(status).toMatch(/OK — brep: 1 shape\(s\)/)
    // mesh 链路显式不可用（E_MESH_UNSUPPORTED，非静默回退）
    expect(status).toMatch(/mesh: (Failed|Mesh unavailable)/i)
    // BREP 链 alive → STEP 可导出
    await expect(page.locator(SELECTOR.btnStep)).toBeEnabled()
    await expect(page.locator(SELECTOR.btnStl)).toBeDisabled()
    // STEP 文件确实含 ADVANCED_FACE（BREP 真几何）
    const stepDownload = page.waitForEvent('download')
    await page.locator(SELECTOR.btnStep).click()
    const step = await stepDownload
    const stepText = new TextDecoder().decode(await readFile(await step.path()))
    expect(stepText.startsWith('ISO-10303-21')).toBe(true)
    expect(stepText).toContain('ADVANCED_FACE')
  })

  test('sheetmetal-demo：libLoader 自动装载，brep 成功、mesh 显式不可用', async ({ page }) => {
    // sheetmetal 是 brep-only（compatOp）；mesh 模式必须 E_MESH_UNSUPPORTED（无回退）。
    await page.goto('/')
    await waitForStatusOk(page)

    await page.locator(SELECTOR.exampleSelect).selectOption('sheetmetal-demo')
    await expect(page.locator(SELECTOR.editor)).toHaveValue(/import \* as sm from 'sheetmetal'/)
    await waitForStatusOk(page)
    const status = await page.locator(SELECTOR.statusBar).textContent()
    // sm.author + sm.solidOf → solidOf 终端 1 个
    expect(status).toMatch(/OK — brep: 1 shape\(s\)/)
    // mesh 链路显式不可用（E_MESH_UNSUPPORTED，非静默回退）
    expect(status).toMatch(/mesh: (Failed|Mesh unavailable)/i)
    // BREP 链 alive → STEP 可导出
    await expect(page.locator(SELECTOR.btnStep)).toBeEnabled()
    await expect(page.locator(SELECTOR.btnStl)).toBeDisabled()
    // STEP 文件确实含 ADVANCED_FACE（BREP 真几何）
    const stepDownload = page.waitForEvent('download')
    await page.locator(SELECTOR.btnStep).click()
    const step = await stepDownload
    const stepText = new TextDecoder().decode(await readFile(await step.path()))
    expect(stepText.startsWith('ISO-10303-21')).toBe(true)
    expect(stepText).toContain('ADVANCED_FACE')
  })

  test('打开本地 .fai.js 文件：编辑器载入文件内容并立即执行', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)

    const snippet = `let part0 = cad.box(7, 7, 7, { centered: true })\nlet part1 = cad.cylinder(2, 12, { centered: true, at: [0, 0, 0] })\nlet part2 = cad.subtract(part0, part1)`
    await page.locator(SELECTOR.fileInput).setInputFiles({
      name: 'custom-part.fai.js',
      mimeType: 'text/plain',
      buffer: Buffer.from(snippet),
    })

    await waitForStatusOk(page)
    // 文件内容已载入编辑器，且示例下拉切到文件名
    await expect(page.locator(SELECTOR.editor)).toHaveValue(/cad\.cylinder\(/)
    await expect(page.locator(SELECTOR.exampleSelect)).toHaveValue('__file__')
    await expect(page.locator(`${SELECTOR.exampleSelect} option[value="__file__"]`)).toHaveText('custom-part.fai.js')
    const status = await page.locator(SELECTOR.statusBar).textContent()
    // box + cylinder + subtract → 仅 subtract 终端 (DAG leaf)
    expect(status).toMatch(/OK — brep: 1 shape\(s\)/)
  })

  test('打开 mini_lathe axk.fai.js：cq-compat 自动装载，brep 成功、mesh 显式不可用', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)

    // axk.fai.js 现为多文件项目的一部分（第 2 行 `import * as config from
    // '../config.fai.js'`），单文件打开没有目录上下文无法解析兄弟模块；多文件
    // 装配已在下方「Open Folder 装配」用例覆盖。这里保留该用例的原初意图——cq-compat
    // 自动装载 + brep 产出几何、mesh 显式不可用——用与 axk 等价的自包含段验证：
    // 同一组 cq-compat 原语（extrude / rect / fillet / val；fillet 为 brep-only，
    // mesh 链路 E_MESH_UNSUPPORTED）。
    const snippet = [
      `import * as cq from '@faicad/cq-compat'`,
      `let axk_wp = cq.extrude(cq.rect(cq.Workplane('XY'), 30, 20), 4)`,
      `axk_wp = cq.fillet(cq.edges(axk_wp, '|Z'), 1)`,
      `let axk = cq.val(axk_wp)`,
    ].join('\n')
    await page.locator(SELECTOR.fileInput).setInputFiles({
      name: 'axk.fai.js',
      mimeType: 'text/plain',
      buffer: Buffer.from(snippet),
    })

    await waitForStatusOk(page)
    // 文件内容已载入编辑器，import specifier 为完整 scoped 名 '@faicad/cq-compat'
    await expect(page.locator(SELECTOR.editor)).toHaveValue(/import \* as cq from '@faicad\/cq-compat'/)
    await expect(page.locator(SELECTOR.exampleSelect)).toHaveValue('__file__')
    const status = await page.locator(SELECTOR.statusBar).textContent()
    // cq-compat 自动装载后 brep 链路真实产出几何（不再报 unregistered library）
    expect(status).toMatch(/OK — brep: 1 shape\(s\)/)
    // mesh 链路显式不可用（cq-compat fillet 等走 brep-only compatOp，E_MESH_UNSUPPORTED）
    expect(status).toMatch(/mesh: (Failed|Mesh unavailable)/i)
  })

  test('切到内置示例后，可切回已打开的文件（内容与文件名保留）', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)

    const snippet = `let part0 = cad.box(7, 7, 7, { centered: true })\nlet part1 = cad.cylinder(2, 12, { centered: true, at: [0, 0, 0] })\nlet part2 = cad.subtract(part0, part1)`
    await page.locator(SELECTOR.fileInput).setInputFiles({
      name: 'custom-part.fai.js',
      mimeType: 'text/plain',
      buffer: Buffer.from(snippet),
    })
    await waitForStatusOk(page)

    // 切到内置示例：编辑器变为示例内容
    await page.locator(SELECTOR.exampleSelect).selectOption('drill-test')
    await waitForStatusOk(page)
    await expect(page.locator(SELECTOR.editor)).toHaveValue(/cad\.cylinder\(5, 20, { centered: true, at: \[0, 0, 0\] }\)/)

    // 切回 __file__：恢复文件内容，下拉仍显示文件名
    await page.locator(SELECTOR.exampleSelect).selectOption('__file__')
    await waitForStatusOk(page)
    await expect(page.locator(SELECTOR.editor)).toHaveValue(/cad\.cylinder\(2, 12, { centered: true, at: \[0, 0, 0\] }\)/)
    await expect(page.locator(SELECTOR.exampleSelect)).toHaveValue('__file__')
    await expect(page.locator(`${SELECTOR.exampleSelect} option[value="__file__"]`)).toHaveText('custom-part.fai.js')
  })

  test('打开非 .fai.js 文件：状态栏显示错误', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)

    await page.locator(SELECTOR.fileInput).setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    })
    await expect(page.locator(SELECTOR.statusBar)).toContainText('is not a .fai.js file', { timeout: 30_000 })
    await expect(page.locator(SELECTOR.statusBar)).toHaveClass(/error/)
  })

  test('Run 按钮：编辑代码后运行并显示新统计', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)

    await page.locator(SELECTOR.editor).fill(`let part0 = cad.box(10, 10, 10, { centered: true })
let part1 = cad.sphere({ radius: 4, center: [2, 0, 0] })
let part2 = cad.subtract(part0, part1)`)
    await page.locator(SELECTOR.runBtn).click()
    await waitForStatusOk(page)

    const status = await page.locator(SELECTOR.statusBar).textContent()
    // box + sphere + subtract → 仅 subtract 终端 (DAG leaf)
    expect(status).toMatch(/OK — brep: 1 shape\(s\)/)
    // 运行完成后内容无变化 → Run 按钮自动置灰
    await expect(page.locator(SELECTOR.runBtn)).toBeDisabled()
  })

  test('Run 按钮状态：加载后置灰、手动修改后可用、运行后再次置灰', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)

    // 页面加载即自动运行 → 内容无变化 → 按钮置灰
    await expect(page.locator(SELECTOR.runBtn)).toBeDisabled()

    // 手动修改代码 → 按钮恢复可用
    await page.locator(SELECTOR.editor).fill(`let part0 = cad.box(3, 3, 3, { centered: true })`)
    await expect(page.locator(SELECTOR.runBtn)).toBeEnabled()

    // 点击运行 → 完成后内容无变化 → 再次置灰
    await page.locator(SELECTOR.runBtn).click()
    await waitForStatusOk(page)
    await expect(page.locator(SELECTOR.runBtn)).toBeDisabled()

    // 切换内置示例 → 自动运行 → 保持置灰
    await page.locator(SELECTOR.exampleSelect).selectOption('drill-test')
    await waitForStatusOk(page)
    await expect(page.locator(SELECTOR.runBtn)).toBeDisabled()
  })

  test('Ctrl+Enter 快捷键运行编辑器代码', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)

    await page.locator(SELECTOR.editor).fill(`let part0 = cad.box(6, 6, 6, { centered: true })`)
    await page.locator(SELECTOR.editor).press('Control+Enter')
    await waitForStatusOk(page)

    const status = await page.locator(SELECTOR.statusBar).textContent()
    expect(status).toMatch(/1 shape\(s\)/)
  })

  test('无效代码：状态栏显示 Error，不产出几何', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)

    await page.locator(SELECTOR.editor).fill(`let part0 = cad.box({`)
    await page.locator(SELECTOR.runBtn).click()

    await expect(page.locator(SELECTOR.statusBar)).toContainText('Error', { timeout: 30_000 })
    await expect(page.locator(SELECTOR.statusBar)).toHaveClass(/error/)
    // 运行（失败）后内容无变化 → Run 按钮同样置灰
    await expect(page.locator(SELECTOR.runBtn)).toBeDisabled()
  })

  test('成功运行后 STEP/STL 下载按钮可用并产出有效文件', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)

    // 成功运行后两个下载按钮应被启用
    await expect(page.locator(SELECTOR.btnStep)).toBeEnabled()
    await expect(page.locator(SELECTOR.btnStl)).toBeEnabled()

    // STEP：文本格式，以 ISO-10303-21 头开始，包含 ADVANCED_FACE
    const stepDownload = page.waitForEvent('download')
    await page.locator(SELECTOR.btnStep).click()
    const step = await stepDownload
    expect(step.suggestedFilename()).toMatch(/\.step$/i)
    const stepText = new TextDecoder().decode(await readFile(await step.path()))
    expect(stepText.startsWith('ISO-10303-21')).toBe(true)
    expect(stepText).toContain('ADVANCED_FACE')

    // STL：binary 格式，头部 + 三角形数量一致
    const stlDownload = page.waitForEvent('download')
    await page.locator(SELECTOR.btnStl).click()
    const stl = await stlDownload
    expect(stl.suggestedFilename()).toMatch(/\.stl$/i)
    const stlBuf = await readFile(await stl.path())
    const triCount = stlBuf.readUInt32LE(80)
    expect(stlBuf.length).toBe(84 + triCount * 50)
    expect(triCount).toBeGreaterThan(0)
  })

  test('两个 3D 视图实际渲染了不同几何内容', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)

    const shot = async (sel: string) => (await page.locator(sel).screenshot()).length

    // box-boolean 渲染后，两个 canvas 都有实质内容（非纯背景）
    const brepBox = await shot(SELECTOR.canvasBrep)
    const meshBox = await shot(SELECTOR.canvasMesh)
    expect(brepBox).toBeGreaterThan(1_000)
    expect(meshBox).toBeGreaterThan(1_000)

    // 切换示例后渲染内容应发生变化（证明 canvas 真正随运行结果更新）
    await page.locator(SELECTOR.exampleSelect).selectOption('drill-test')
    await waitForStatusOk(page)
    const brepDrill = await shot(SELECTOR.canvasBrep)
    expect(brepDrill).not.toBe(brepBox)
  })

  // ── Open Folder（browser ProjectLoader，多文件相对 import）──

  test('Open Folder：mini_lathe 装配（brep 多文件相对 import）自动运行 + STEP 导出', async ({ page }) => {
    // OPFS stub 必须早于 page.goto（初始化脚本在首次导航时注入）
    await stubShowDirectoryPickerAsOpfs(page)
    await page.goto('/')
    await waitForStatusOk(page)

    // 从仓库读取 mini_lathe 项目根整树 → OPFS 写入（真实数据流）
    const miniLathe = await readFaiProjectTree(new URL('../../mini_lathe/', import.meta.url))
    expect(Object.keys(miniLathe).length).toBeGreaterThan(5)
    await seedOpfsProject(page, miniLathe)

    // 打开文件夹：默认入口 = src/assembly.fai.js，自动载入并运行
    await page.locator(SELECTOR.openDirBtn).click()
    await expect(page.locator(SELECTOR.exampleSelect)).toHaveValue('__proj:src/assembly.fai.js', { timeout: 30_000 })
    await expect(
      page.locator(`${SELECTOR.exampleSelect} option[value="__proj:src/assembly.fai.js"]`),
    ).toContainText('src/assembly.fai.js')
    await expect(page.locator(SELECTOR.editor)).toHaveValue(/import \* as cq from '@faicad\/cq-compat'/)

    // 自动运行：brep 装配 OK；mesh 链路显式不可用（cq-compat brep-only）
    await expect(page.locator(SELECTOR.statusBar)).toContainText('Project:', { timeout: 180_000 })
    await expect(page.locator(SELECTOR.statusBar)).toContainText('OK — brep:', { timeout: 180_000 })
    const status = await page.locator(SELECTOR.statusBar).textContent()
    expect(status).toMatch(/Project: \S+ \(src\/assembly\.fai\.js\) — OK — brep: \d+ shape\(s\)/)
    expect(status).toMatch(/mesh: (Failed|Mesh unavailable)/i)

    // 装配有 BREP solid → STEP 真实 ADVANCED_FACE
    await expect(page.locator(SELECTOR.btnStep)).toBeEnabled()
    const stepDownload = page.waitForEvent('download')
    await page.locator(SELECTOR.btnStep).click()
    const step = await stepDownload
    const stepText = new TextDecoder().decode(await readFile(await step.path()))
    expect(stepText.startsWith('ISO-10303-21')).toBe(true)
    expect(stepText).toContain('ADVANCED_FACE')
  })

  test('Open Folder：纯 cad 多文件项目，brep+mesh 双链都 OK', async ({ page }) => {
    await stubShowDirectoryPickerAsOpfs(page)
    await page.goto('/')
    await waitForStatusOk(page)

    const meshProj = await readFaiProjectTree(new URL('fixtures/mesh-project/', import.meta.url))
    expect(Object.keys(meshProj)).toEqual(['src/assembly.fai.js', 'src/parts/part_a.fai.js', 'src/parts/part_b.fai.js'])
    await seedOpfsProject(page, meshProj)

    await page.locator(SELECTOR.openDirBtn).click()
    await expect(page.locator(SELECTOR.exampleSelect)).toHaveValue('__proj:src/assembly.fai.js', { timeout: 30_000 })
    await expect(page.locator(SELECTOR.statusBar)).toContainText('Project:', { timeout: 180_000 })
    await expect(page.locator(SELECTOR.statusBar)).toContainText('OK — brep:', { timeout: 180_000 })
    const status = await page.locator(SELECTOR.statusBar).textContent()
    // box + box（dual-op）→ 双链都产出几何；mesh 不回退（不再 E_MESH_UNSUPPORTED）
    expect(status).toMatch(/Project: \S+ \(src\/assembly\.fai\.js\) — OK — brep: \d+ shape\(s\)/)
    expect(status).not.toMatch(/mesh: (fail|Mesh unavailable)/i)
    expect(status).toMatch(/mesh: \d+ shape\(s\)/)

    // 渲染：两个 canvas 都有实质内容
    const shot = async (sel: string) => (await page.locator(sel).screenshot()).length
    expect(await shot(SELECTOR.canvasBrep)).toBeGreaterThan(1_000)
    expect(await shot(SELECTOR.canvasMesh)).toBeGreaterThan(1_000)
  })

  test('Open Folder 空目录：提示“没有 .fai.js”，不进入项目模式', async ({ page }) => {
    await stubShowDirectoryPickerAsOpfs(page)
    await page.goto('/')
    await waitForStatusOk(page)

    await seedOpfsProject(page, {}) // 清空
    await page.locator(SELECTOR.openDirBtn).click()
    await expect(page.locator(SELECTOR.statusBar)).toContainText('没有 .fai.js 文件', { timeout: 30_000 })
    await expect(page.locator(SELECTOR.statusBar)).toHaveClass(/error/)
  })

  test('Open Folder 后切回内置示例：仍走单文件路径（无 Project 前缀）；再切回恢复项目模式', async ({ page }) => {
    await stubShowDirectoryPickerAsOpfs(page)
    await page.goto('/')
    await waitForStatusOk(page)

    const meshProj = await readFaiProjectTree(new URL('fixtures/mesh-project/', import.meta.url))
    await seedOpfsProject(page, meshProj)
    await page.locator(SELECTOR.openDirBtn).click()
    await expect(page.locator(SELECTOR.statusBar)).toContainText('Project:', { timeout: 180_000 })

    // 切回内置示例 → 单文件模式：无 Project 前缀
    await page.locator(SELECTOR.exampleSelect).selectOption('drill-test')
    await waitForStatusOk(page)
    const single = await page.locator(SELECTOR.statusBar).textContent()
    expect(single).not.toContain('Project:')
    expect(single).toMatch(/OK — brep: 1 shape\(s\)/)

    // 再切回项目入口 → 恢复项目模式
    await page.locator(SELECTOR.exampleSelect).selectOption('__proj:src/assembly.fai.js')
    await expect(page.locator(SELECTOR.editor)).toHaveValue(/cad\.union/, { timeout: 30_000 })
    await expect(page.locator(SELECTOR.statusBar)).toContainText('Project:', { timeout: 180_000 })
  })
})
