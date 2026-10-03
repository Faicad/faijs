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

describe('weapp entry export surface (shared face computed + weapp-specific literals)', async () => {
  const weappModule = await import('./weapp')
  const envAgnosticModule = await import('./env-agnostic')
  const actual = new Set(Object.keys(weappModule))

  // Shared face = whatever env-agnostic exports, computed (not hand-listed) so
  // the two surfaces can never drift apart (weapp plan §9.1 step 3).
  const shared = new Set(Object.keys(envAgnosticModule))

  // weapp-specific face: only what the weapp worker host actually imports.
  // Adding a symbol here requires updating this literal — deliberate friction
  // against re-leak. (createApiNamespace was dropped in §9.2: createRuntime is
  // now the with-cad variant, hosts no longer need to hand-register cad.)
  const WEAPP_SPECIFIC = [
    'setBrepkitWasmInitFn',
    'initBrepkitWasm',
    'isBrepkitInitialized',
    'registerBrepkitBrepEngine',
    'BREPKIT_BREP_ENGINE_ID',
    'ensureBrepkitDefaultEngine',
    'registerBrepkitMeshEngine',
    'BREPKIT_MESH_ENGINE_ID',
    'ensureBrepkitMeshBackend',
    'registerBrepEngine',
    'hasBrepEngine',
    'getBrepEngine',
    'getActiveBrepEngineId',
    'freezeEngineRegistries',
    'registerMeshEngine',
    'getMeshEngine',
    'getActiveMeshEngineId',
    'isMeshEngineRegistered',
    'getMeshSolidBackend',
    'MeshSolidRegistry',
    'normalizeMeshSolid',
    'describeMeshSolid',
    'buildMeshSolidTopology',
    'weldToleranceFor',
    'assertShapeSlotExclusive',
    'createRuntime',
  ]
  const expected = new Set([...shared, ...WEAPP_SPECIFIC])

  it('exports exactly the shared surface plus the weapp-specific whitelist', () => {
    const extra = [...actual].filter((k) => !expected.has(k))
    const missing = [...expected].filter((k) => !actual.has(k))
    expect(extra, `weapp entry leaked extra symbols: ${extra.join(', ')}`).toEqual([])
    expect(missing, `weapp entry is missing symbols: ${missing.join(', ')}`).toEqual([])
  })

  it('env-agnostic dependency graph is free of three / node / brepkit / wasm loaders', () => {
    const src = readFileSync(path.join(srcDir, 'env-agnostic.ts'), 'utf-8')
    // The shared surface must stay environment-agnostic: no three (weapp main
    // thread holds its own copy — a second one via this entry is a hard
    // failure), no node builtins, no brepkit, no wasm/platform loaders.
    expect(src).not.toMatch(/from\s+['"]three/)
    expect(src).not.toMatch(/from\s+['"]node:/)
    expect(src).not.toMatch(/from\s+['"][^'"]*brepkit/i)
    expect(src).not.toMatch(/from\s+['"]\.\/(mesh|brepkit-kernel|occt-kernel|browser-host|node-host)\//)
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

// NOTE: the former "weapp worker host constraints" describe block read the
// sibling 3d_editor checkout via a relative path — impossible on CI (faijs is
// checked out alone) and forbidden by scripts/check-test-fs-scope.mjs. That
// guard belongs to the 3d_editor repo's own test suite; do not reintroduce it
// here.
