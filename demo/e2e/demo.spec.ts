import { readFile } from 'node:fs/promises'
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
  fileInput: '#file-input',
  exampleSelect: '#example-select',
  statusBar: '#status-bar',
  btnStep: '#btn-step',
  btnStl: '#btn-stl',
  canvasBrep: '#canvas-brep',
  canvasMesh: '#canvas-mesh',
}

const EXAMPLE_SNIPPETS: Record<string, string> = {
  'box-boolean': 'cad.box({ size: 20 })',
  'drill-test': 'cad.cylinder({ radius: 5, height: 20',
  'text-engrave': "cad.text(part0, { text: 'HELLO'",
  'transform-chain': 'cad.rotate(part0, { anglesDeg: [0, 0, 30] }',
}

async function waitForStatusOk(page: Page, timeout = 120_000) {
  await expect(page.locator(SELECTOR.statusBar)).toContainText('OK — brep:', { timeout })
  await expect(page.locator(SELECTOR.statusBar)).toContainText('| mesh:')
}

async function runCode(page: Page) {
  await page.locator(SELECTOR.runBtn).click()
  await waitForStatusOk(page)
}

test.describe('faijs demo', () => {
  test('页面加载：标题、默认示例代码、初始状态栏', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle('faijs — CAD Scripting Demo')
    await expect(page.locator(SELECTOR.editor)).toHaveValue(/cad\.box\(\{ size: 20 \}\)/)
    await expect(page.locator(SELECTOR.exampleSelect)).toHaveValue('box-boolean')
    // 下载按钮初始为 disabled（尚无成功运行结果）
    await expect(page.locator(SELECTOR.btnStep)).toBeDisabled()
    await expect(page.locator(SELECTOR.btnStl)).toBeDisabled()
  })

  test('加载后自动运行默认示例，状态栏显示 OK 与形状统计', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)
    const status = await page.locator(SELECTOR.statusBar).textContent()
    // Phase 3: 终端 = 活跃 Shape 变量（box + sphere + subtract 三个都是 Shape → 3 个终端）
    expect(status).toMatch(/OK — brep: 3 shape\(s\), \d+ verts, \d+ triangles \| mesh: 3 shape\(s\)/)
    expect(page.locator(SELECTOR.statusBar)).toHaveClass(/success/)
  })

  test('dev：两条链路 wasm 均从本地 node_modules 加载（非 CDN）', async ({ page }) => {
    // 与 preview-cdn.spec.ts 的 CDN 断言互为正反：dev 模式 manifold/occt wasm
    // 必须走 vite dev server 的本地文件（main.ts 的 import.meta.env.DEV 分支）。
    // worker 内发起的 wasm 请求同样会被 page.on('request') 捕获。
    const wasmRequests: string[] = []
    page.on('request', (req) => {
      if (req.url().endsWith('.wasm')) wasmRequests.push(req.url())
    })

    await page.goto('/')
    await waitForStatusOk(page)

    const local = (path: string) => new URL(path, 'http://localhost:8899').toString()
    expect(wasmRequests).toContain(local('/node_modules/occt-wasm/dist/occt-wasm.wasm'))
    expect(wasmRequests).toContain(local('/node_modules/manifold-3d/manifold.wasm'))
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

  test('打开本地 .faijs 文件：编辑器载入文件内容并立即执行', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)

    const snippet = `let part0 = cad.box({ size: 7 })\nlet part1 = cad.cylinder({ radius: 2, height: 12, center: [0, 0, 0] })\nlet part2 = cad.subtract(part0, part1)`
    await page.locator(SELECTOR.fileInput).setInputFiles({
      name: 'custom-part.faijs',
      mimeType: 'text/plain',
      buffer: Buffer.from(snippet),
    })

    await waitForStatusOk(page)
    // 文件内容已载入编辑器，且示例下拉切到文件名
    await expect(page.locator(SELECTOR.editor)).toHaveValue(/cad\.cylinder\(/)
    await expect(page.locator(SELECTOR.exampleSelect)).toHaveValue('__file__')
    await expect(page.locator(`${SELECTOR.exampleSelect} option[value="__file__"]`)).toHaveText('custom-part.faijs')
    const status = await page.locator(SELECTOR.statusBar).textContent()
    // box + cylinder + subtract → 3 个活跃 Shape 终端
    expect(status).toMatch(/OK — brep: 3 shape\(s\)/)
  })

  test('切到内置示例后，可切回已打开的文件（内容与文件名保留）', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)

    const snippet = `let part0 = cad.box({ size: 7 })\nlet part1 = cad.cylinder({ radius: 2, height: 12, center: [0, 0, 0] })\nlet part2 = cad.subtract(part0, part1)`
    await page.locator(SELECTOR.fileInput).setInputFiles({
      name: 'custom-part.faijs',
      mimeType: 'text/plain',
      buffer: Buffer.from(snippet),
    })
    await waitForStatusOk(page)

    // 切到内置示例：编辑器变为示例内容
    await page.locator(SELECTOR.exampleSelect).selectOption('drill-test')
    await waitForStatusOk(page)
    await expect(page.locator(SELECTOR.editor)).toHaveValue(/cad\.cylinder\(\{ radius: 5, height: 20/)

    // 切回 __file__：恢复文件内容，下拉仍显示文件名
    await page.locator(SELECTOR.exampleSelect).selectOption('__file__')
    await waitForStatusOk(page)
    await expect(page.locator(SELECTOR.editor)).toHaveValue(/cad\.cylinder\(\{ radius: 2, height: 12/)
    await expect(page.locator(SELECTOR.exampleSelect)).toHaveValue('__file__')
    await expect(page.locator(`${SELECTOR.exampleSelect} option[value="__file__"]`)).toHaveText('custom-part.faijs')
  })

  test('打开非 .faijs 文件：状态栏显示错误', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)

    await page.locator(SELECTOR.fileInput).setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    })
    await expect(page.locator(SELECTOR.statusBar)).toContainText('is not a .faijs file', { timeout: 30_000 })
    await expect(page.locator(SELECTOR.statusBar)).toHaveClass(/error/)
  })

  test('Run 按钮：编辑代码后运行并显示新统计', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)

    await page.locator(SELECTOR.editor).fill(`let part0 = cad.box({ size: 10 })
let part1 = cad.sphere({ radius: 4, center: [2, 0, 0] })
let part2 = cad.subtract(part0, part1)`)
    await page.locator(SELECTOR.runBtn).click()
    await waitForStatusOk(page)

    const status = await page.locator(SELECTOR.statusBar).textContent()
    // box + sphere + subtract → 3 个活跃 Shape 终端
    expect(status).toMatch(/OK — brep: 3 shape\(s\)/)
    // 运行完成后内容无变化 → Run 按钮自动置灰
    await expect(page.locator(SELECTOR.runBtn)).toBeDisabled()
  })

  test('Run 按钮状态：加载后置灰、手动修改后可用、运行后再次置灰', async ({ page }) => {
    await page.goto('/')
    await waitForStatusOk(page)

    // 页面加载即自动运行 → 内容无变化 → 按钮置灰
    await expect(page.locator(SELECTOR.runBtn)).toBeDisabled()

    // 手动修改代码 → 按钮恢复可用
    await page.locator(SELECTOR.editor).fill(`let part0 = cad.box({ size: 3 })`)
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

    await page.locator(SELECTOR.editor).fill(`let part0 = cad.box({ size: 6 })`)
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
})
