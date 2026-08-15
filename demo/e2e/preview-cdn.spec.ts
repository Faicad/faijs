import { test, expect, type Page } from '@playwright/test'

/**
 * Preview（build 产物）e2e 测试。
 *
 * 运行在 `vite preview` 上（见 playwright.preview.config.ts）：打包后的应用
 * 通过 index.html 里的 <script type="importmap"> 把 three / manifold-3d /
 * occt-wasm 及其传递闭包解析到 jsdelivr CDN。
 *
 * 这是 "Failed to resolve module specifier" 一类错误的回归防线：
 * importmap 缺任意一个 manifold-3d 静态闭包里的裸 specifier，整个模块图
 * 就会加载失败，UI 无响应（页面事件绑定全部失效）。
 */

// 两条 wasm 二进制必须真的从 CDN 下载（而不是本地 node_modules）
const WASM_CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/occt-wasm@3.7.0/dist/occt-wasm.wasm',
  'https://cdn.jsdelivr.net/npm/manifold-3d@3.5.1/manifold.wasm',
]

// manifold-3d 静态加载闭包的裸 specifier 最小覆盖集。
// 任何一条缺失都会让 build 产物在加载时报模块解析错误。
// 版本必须与 demo/package.json 中的依赖版本一致。
const REQUIRED_IMPORTMAP_KEYS = [
  'three',
  'three/',
  'manifold-3d',
  'manifold-3d/',
  'occt-wasm',
  'occt-wasm/',
  '@gltf-transform/core',
  '@gltf-transform/functions',
  '@gltf-transform/extensions',
  'ktx-parse',
  'ndarray',
  'ndarray-ops',
  'ndarray-lanczos',
  'ndarray-pixels',
  'property-graph',
  '@jridgewell/trace-mapping',
  '@jridgewell/resolve-uri',
  '@jridgewell/sourcemap-codec',
  'convert-source-map',
  'fast-xml-parser',
  'fflate',
  '@jscadui/3mf-export',
]

async function waitForStatusOk(page: Page, timeout = 120_000) {
  await expect(page.locator('#status-bar')).toContainText('OK — brep:', { timeout })
  await expect(page.locator('#status-bar')).toContainText('| mesh:')
}

test('build 产物：importmap 覆盖 manifold-3d 全部静态闭包', async ({ page }) => {
  const html = await (await page.request.get('/')).text()
  const importmap = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)
  expect(importmap, 'index.html 必须包含 importmap').not.toBeNull()
  for (const key of REQUIRED_IMPORTMAP_KEYS) {
    const re = new RegExp(`"${key}"\\s*:`)
    expect(importmap![1], `importmap 缺少 "${key}" 的映射`).toMatch(re)
  }
})

test('preview：两条链路 wasm 均从 CDN 加载，无模块解析错误，成功出模', async ({ page }) => {
  const consoleErrors: string[] = []
  const cdnWasmRequests: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('request', (req) => {
    if (WASM_CDN_URLS.includes(req.url())) cdnWasmRequests.push(req.url())
  })

  await page.goto('/')
  await waitForStatusOk(page)

  // 两条 wasm 都必须真的从 CDN 下载
  expect(cdnWasmRequests).toContain(WASM_CDN_URLS[0])
  expect(cdnWasmRequests).toContain(WASM_CDN_URLS[1])

  // 模块图解析失败（importmap 缺项）会在控制台报 "Failed to resolve module specifier"
  const moduleErrors = consoleErrors.filter((e) => e.includes('Failed to resolve module specifier'))
  expect(moduleErrors).toEqual([])

  // CDN 上的模块 / wasm 404 或网络失败也会以 console error 出现
  const cdnErrors = consoleErrors.filter((e) => e.includes('cdn.jsdelivr.net'))
  expect(cdnErrors).toEqual([])
})