import { test, expect } from '@playwright/test'

/**
 * probe: demo UI sheetmetal flow + network capture — #9 诊断
 * 记录 demo 运行期间所有 jsdelivr/fetch 请求与 CDN import 目标，
 * 对比探针直连成功路径，找出 demo UI 失败分叉点。
 */
test('probe: capture demo CDN requests during sheetmetal run', async ({ page }) => {
  test.setTimeout(180_000)
  const reqs: string[] = []
  page.on('request', (r) => {
    const u = r.url()
    if (/jsdelivr|faicad|esm/.test(u)) reqs.push(u)
  })
  const logs: string[] = []
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text().slice(0, 200)}`))
  page.on('pageerror', (err) => logs.push(`[pageerror] ${String(err).slice(0, 200)}`))

  await page.goto('/')
  await expect(page.locator('#status-bar')).toContainText('OK — brep:', { timeout: 120_000 })
  reqs.length = 0
  logs.length = 0
  await page.locator('#example-select').selectOption('sheetmetal-demo')
  await expect(page.locator('#status-bar')).toContainText('| mesh:', { timeout: 120_000 })
  console.log('UI-STATUS:', await page.locator('#status-bar').textContent())
  console.log('REQS:\n' + reqs.join('\n'))
  console.log('ERR-LOGS:\n' + logs.filter((l) => /error|failed|kernel/i.test(l)).join('\n'))
})
