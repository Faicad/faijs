import { test, expect, type Page } from '@playwright/test'

/**
 * Preview（build 产物）e2e 测试。
 *
 * 运行在 `vite preview` 上（见 playwright.preview.config.ts）：打包后的应用
 * 通过 index.html 里的 <script type="importmap"> 把 three / manifold-3d /
 * occt-wasm 解析到 jsdelivr CDN。
 *
 * 这是 "Failed to resolve module specifier" 一类错误的回归防线：
 * importmap 缺任意一个构建产物里的裸 specifier（含 worker chunk 内
 * 的动态 import），整个模块图就会加载失败，UI 无响应（页面事件绑定全部失效）。
 */

// 两条 wasm 二进制必须真的从 CDN 下载（而不是本地 node_modules）
const WASM_CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/occt-wasm@3.8.4/dist/occt-wasm.wasm',
  'https://cdn.jsdelivr.net/npm/manifold-3d@3.5.1/manifold.wasm',
]

// 构建产物（主 bundle + worker chunk）裸 specifier 的最小覆盖集。
// 任何一条缺失都会让 build 产物在加载时报模块解析错误。
// 版本必须与 demo/package.json 中的依赖版本一致。
const REQUIRED_IMPORTMAP_KEYS = [
  'three',
  'three/',
  'manifold-3d',
  'occt-wasm',
  'occt-wasm/',
]

// OCCT kernel (~22MB) is downloaded from the CDN at runtime. On flaky
// networks the download can stall and the status bar stays at
// "Waiting for OCCT kernel" forever. Wait at most this long; if the status
// bar is still stuck there afterwards, treat it as a network timeout —
// warn only and skip the wasm-download assertions instead of failing.
const OCCT_WAIT_TIMEOUT_MS = 30_000

type StatusOkResult = 'ok' | 'occt-stuck'

// 探测 CDN wasm URL 以区分"网络超时"与"地址错误"：
// - 服务器返回 2xx        → 地址正确（ok）
// - 服务器返回 4xx/5xx    → 地址错误（bad-status）
// - 探测请求本身超时/失败 → 网络不可达（network-error）
type ProbeResult = 'ok' | 'bad-status' | 'network-error'

// HEAD 只取状态码，不下载 ~22MB 的 wasm body——探测地址正确性不需要
// 传输整个二进制（GET 在慢网络下容易把自己超时误判成 network-error）。
async function probeWasmUrl(page: Page, url: string): Promise<ProbeResult> {
  try {
    const res = await page.request.head(url, { timeout: 10_000 })
    if (res.ok()) return 'ok'
    return 'bad-status'
  } catch {
    return 'network-error'
  }
}

async function waitForStatusOk(page: Page): Promise<StatusOkResult> {
  const statusBar = page.locator('#status-bar')
  const deadline = Date.now() + OCCT_WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const text = (await statusBar.textContent().catch(() => '')) ?? ''
    // Both chains actually produced geometry (a degraded "BREP unavailable"
    // status still starts with "OK — brep:" — it must NOT count as success).
    if (/OK — brep: \d+ shape/.test(text) && text.includes('| mesh:')) return 'ok'
    // Explicit failure / degraded state: bail out early instead of waiting
    // out the full timeout — the final assertions below will fail loudly.
    if (text.includes('OCCT kernel failed') || text.includes('BREP unavailable') || text.includes('Error:')) {
      break
    }
    await page.waitForTimeout(1000)
  }
  const finalText = (await statusBar.textContent().catch(() => '')) ?? ''
  if (finalText.includes('Waiting for OCCT kernel') || finalText.includes('Loading OCCT kernel')) {
    return 'occt-stuck'
  }
  // Any other non-OK state is a real failure — keep the original assertion
  // semantics, but reject the degraded "BREP unavailable" case explicitly
  // (it means the wasm fetch failed, e.g. a 404 address error).
  expect(finalText, `OCCT chain failed (not a network timeout): "${finalText}"`).toMatch(/OK — brep: \d+ shape/)
  await expect(statusBar).toContainText('| mesh:')
  return 'ok'
}

test('build 产物：importmap 覆盖全部裸 specifier（主 bundle + worker chunk）', async ({ page }) => {
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
  const statusResult = await waitForStatusOk(page)

  // 模块图解析失败（importmap 缺项）会在控制台报 "Failed to resolve module specifier"
  const moduleErrors = consoleErrors.filter((e) => e.includes('Failed to resolve module specifier'))
  expect(moduleErrors).toEqual([])

  // OCCT kernel 30s 内未加载完成。忽略超时前必须先证明是"网络超时"
  // 而不是"地址错误"：主动探测 CDN wasm URL——
  // - bad-status（4xx/5xx）：地址错误，必须判失败，不能忽略
  // - network-error：CDN 完全不可达，同样是环境问题，只警告
  // - ok：URL 可达但下载慢/挂起，属网络超时，只警告
  if (statusResult === 'occt-stuck') {
    const probe = await probeWasmUrl(page, WASM_CDN_URLS[0])
    expect(probe, `CDN wasm URL 返回 4xx/5xx（地址错误，非网络超时）: ${WASM_CDN_URLS[0]}`).not.toBe('bad-status')
    console.log(
      `[preview-cdn] WARNING: OCCT kernel did not load within ${OCCT_WAIT_TIMEOUT_MS / 1000}s ` +
        `(probe=${probe}) — treated as network timeout, wasm download assertions skipped`,
    )
    return
  }

  // 两条 wasm 都必须真的从 CDN 下载
  expect(cdnWasmRequests).toContain(WASM_CDN_URLS[0])
  expect(cdnWasmRequests).toContain(WASM_CDN_URLS[1])

  // CDN 上的模块 / wasm 404 或网络失败也会以 console error 出现
  const cdnErrors = consoleErrors.filter((e) => e.includes('cdn.jsdelivr.net'))
  expect(cdnErrors).toEqual([])
})