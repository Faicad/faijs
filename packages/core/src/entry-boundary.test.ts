/**
 * entry-boundary.test.ts — 宿主入口边界守卫（docs/plans/2026-09-20-weapp-host-entry-design.md）
 *
 * 防止 brepkit（weapp 专用）符号再次渗入 browser umbrella：
 * 2026-09-20 3d_editor npm run dev 报 "Failed to resolve import brepkit-wasm"，
 * 根因是 browser.ts re-export 了 brepkitWasm（其 node 分支 import('brepkit-wasm')
 * 被 vite 静态解析，而 weapp 专用 npm 包在 web 侧不存在）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const srcDir = path.dirname(fileURLToPath(import.meta.url))

describe('weapp entry export surface (whitelist)', async () => {
  const weappModule = await import('./weapp')
  const actual = new Set(Object.keys(weappModule))

  // Only what the weapp worker host actually imports. Adding a symbol here
  // requires updating the whitelist — deliberate friction against re-leak.
  const WHITELIST = [
    'setBrepkitWasmInitFn',
    'initBrepkitWasm',
    'isBrepkitInitialized',
    'registerBrepkitBrepEngine',
    'BREPKIT_BREP_ENGINE_ID',
    'ensureBrepkitDefaultEngine',
    'registerBrepEngine',
    'hasBrepEngine',
    'getBrepEngine',
    'getActiveBrepEngineId',
    'freezeEngineRegistries',
    'createRuntime',
    'createApiNamespace',
  ]

  it('exports exactly the whitelisted symbols', () => {
    const extra = [...actual].filter((k) => !WHITELIST.includes(k))
    const missing = WHITELIST.filter((k) => !actual.has(k))
    expect(extra, `weapp entry leaked extra symbols: ${extra.join(', ')}`).toEqual([])
    expect(missing, `weapp entry is missing symbols: ${missing.join(', ')}`).toEqual([])
  })
})

describe('browser umbrella must not contain brepkit', () => {
  const browserSrc = readFileSync(path.join(srcDir, 'browser.ts'), 'utf-8')

  it('browser.ts has no brepkit re-exports', () => {
    const offending = browserSrc
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /brepkit/i.test(line) && /^\s*export/.test(line))
    expect(offending, `brepkit re-exports found in browser.ts: ${JSON.stringify(offending)}`).toEqual([])
  })

  it('built dist/browser.js (if present) does not import brepkit modules', () => {
    const distBrowser = path.resolve(srcDir, '../../dist/browser.js')
    let code: string
    try {
      code = readFileSync(distBrowser, 'utf-8')
    } catch {
      return // dist not built yet; source-level guard above is authoritative pre-build
    }
    expect(code).not.toMatch(/from\s+['"][^'"]*brepkit-kernel/)
    expect(code).not.toMatch(/from\s+['"][^'"]*adapters\/brepkit/)
  })
})

describe('weapp worker host constraints (3d_editor side)', () => {
  const workerSrc = readFileSync(
    path.resolve(srcDir, '../../../../3d_editor/packages/platform/src/weapp/faijs.worker.ts'),
    'utf-8',
  )

  it('weapp worker must not import the browser umbrella', () => {
    expect(workerSrc).not.toMatch(/from\s+['"]@faicad\/faijs(-core)?\/browser['"]/)
  })

  it('weapp worker imports brepkit symbols from the weapp entry, not deep paths', () => {
    // After migration the worker should use '@faicad/faijs/weapp' (or faijs-core/weapp)
    // for brepkit symbols; deep brepkit-kernel imports are the old leaky path.
    expect(workerSrc).not.toMatch(/from\s+['"]@faicad\/faijs(-core)?\/brepkit-kernel\//)
  })
})
