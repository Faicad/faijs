import { test, expect } from '@playwright/test'

/**
 * probe-cdn-kernel.spec.ts — 诊断探针（非回归门禁）
 *
 * test 1：页面上下文直接 import CDN sheetmetal 调 author（已证实 cdnOk:true）。
 * test 2：完整复刻 demo UI 流程（选 sheetmetal-demo 示例 → 自动运行），
 *         抓 status 文本 + 注册表状态 + 页面 console，定位与探针的差异。
 */
test('probe: globalThis kernel registry state on demo page', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await expect(page.locator('#status-bar')).toContainText('OK — brep:', { timeout: 120_000 })

  const probe = await page.evaluate(async () => {
    const g = globalThis as unknown as Record<string, unknown>
    const reg = g['__FAICAD_FAIJS_KERNEL_REGISTRY__'] as
      | { stateVersion?: number; defaultKernelId?: string | null; frozen?: boolean; kernels?: unknown[] }
      | undefined
    let cdnErr = ''
    let cdnOk = false
    try {
      const sm = (await import('https://cdn.jsdelivr.net/npm/@faicad/sheetmetal@0.13.2/+esm')) as {
        author: (p: unknown) => unknown
        solidOf: (p: unknown) => unknown
      }
      const part = sm.author({
        thickness: 1,
        base: { length: 40, width: 30 },
        flanges: [
          { id: 'fx', length: 15, angleDeg: 90, rule: { innerRadius: 2, kFactor: 0.44 }, side: 'xmax' },
        ],
      })
      sm.solidOf(part)
      cdnOk = true
    } catch (err) {
      cdnErr = err instanceof Error ? err.message : String(err)
    }
    return {
      registryPresent: !!reg,
      stateVersion: reg?.stateVersion,
      defaultKernelId: reg?.defaultKernelId ?? null,
      frozen: reg?.frozen ?? null,
      kernelCount: Array.isArray(reg?.kernels) ? reg.kernels.length : (reg?.kernels as { size?: number })?.size ?? null,
      cdnOk,
      cdnErr,
    }
  })

  console.log('PROBE:', JSON.stringify(probe, null, 2))
  expect(probe.registryPresent, 'globalThis kernel registry should exist after host bind').toBe(true)
})

test('probe: demo UI sheetmetal flow with console capture', async ({ page }) => {
  test.setTimeout(180_000)
  const logs: string[] = []
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text().slice(0, 300)}`))
  page.on('pageerror', (err) => logs.push(`[pageerror] ${String(err).slice(0, 300)}`))

  await page.goto('/')
  await expect(page.locator('#status-bar')).toContainText('OK — brep:', { timeout: 120_000 })
  await page.locator('#example-select').selectOption('sheetmetal-demo')
  // selectOption 自动运行；轮询 status 直到出现 mesh 段（成功或失败都会出现）
  await expect(page.locator('#status-bar')).toContainText('| mesh:', { timeout: 120_000 })
  const status = await page.locator('#status-bar').textContent()
  console.log('UI-STATUS:', status)
  console.log('CONSOLE-LOGS:\n' + logs.filter((l) => /kernel|registry|faicad|error|failed/i.test(l)).join('\n'))
})
