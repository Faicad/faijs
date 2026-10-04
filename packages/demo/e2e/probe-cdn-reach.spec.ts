import { test, expect } from '@playwright/test'

// 一次性探针：验证浏览器内 fastly.jsdelivr.net / registry.npmmirror.com 可达性
// （PowerShell 实测：cdn.jsdelivr.net 超时、fastly.jsdelivr.net 200、npmmirror 200）
test('probe: browser-side reachability of CDN fallback endpoints', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const out: Record<string, string> = {}
    const targets: Array<[string, string]> = [
      ['fastly-esm-head', 'https://fastly.jsdelivr.net/npm/@faicad/faijs@0.22.2/+esm'],
      ['fastly-esm-get', 'https://fastly.jsdelivr.net/npm/@faicad/faijs@0.22.2/+esm'],
      ['npmmirror-latest', 'https://registry.npmmirror.com/@faicad/faijs/latest'],
      ['npmmirror-nosuch', 'https://registry.npmmirror.com/@faicad/no-such-lib-demo/latest'],
      ['data-jsdelivr-resolved', 'https://data.jsdelivr.com/v1/packages/npm/@faicad/faijs/resolved?specifier=latest'],
    ]
    for (const [key, url] of targets) {
      try {
        const r = await fetch(url, { method: key.endsWith('-head') ? 'HEAD' : 'GET' })
        const text = await r.text().catch(() => '')
        out[key] = `${r.status} len=${text.length} ${text.slice(0, 120).replace(/\n/g, ' ')}`
      } catch (err) {
        out[key] = `FAIL ${err instanceof Error ? err.message : String(err)}`
      }
    }
    return out
  })
  console.log('PROBE-REACH:', JSON.stringify(results, null, 2))
  expect(results['fastly-esm-get']).toMatch(/^200/)
})
