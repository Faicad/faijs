/**
 * `createViewerLibLoader` unit tests — environment dispatch and loader contract.
 *
 * Runs in Node (vitest): the default branch is the internal node loader
 * (whitelist + aliases + `import(pkg)` + `loadSource`); the browser branch is
 * exercised by stubbing a `window` global and injecting `importModule`, so
 * `createBrowserLibLoader`'s CDN path is asserted without any network.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createViewerLibLoader } from './libs'

afterEach(() => vi.unstubAllGlobals())

describe('createViewerLibLoader — node branch', () => {
  it('returns undefined when libs.enabled === false', async () => {
    const loader = await createViewerLibLoader({ enabled: false })
    expect(loader).toBeUndefined()
  })

  it('rejects a non-scoped package when no explicit whitelist is given', async () => {
    const loader = (await createViewerLibLoader({}))!
    await expect(loader.loadLib('stranger-package')).rejects.toThrow(/not a scoped @faicad/)
  })

  it('rejects a package outside the whitelist when allow is given', async () => {
    const loader = (await createViewerLibLoader({ allow: ['@faicad/faijs-gears'] }))!
    await expect(loader.loadLib('@faicad/faijs-sketch')).rejects.toThrow(/not in the viewer library whitelist/)
  })

  it('loads a whitelisted installed package through an alias', async () => {
    const loader = (await createViewerLibLoader({
      allow: ['@faicad/faijs-gears'],
      aliases: { gears: '@faicad/faijs-gears' },
    }))!
    const ns = (await loader.loadLib('gears')) as { spurGear?: unknown }
    expect(typeof ns.spurGear).toBe('function')
  })

  it('reads loadSource from the installed package (determinism scanning)', async () => {
    const loader = (await createViewerLibLoader({ allow: ['@faicad/faijs-gears'] }))!
    const source = await loader.loadSource?.('@faicad/faijs-gears')
    expect(typeof source).toBe('string')
  })

  it('reports a missing package as a load failure (never a viewer throw)', async () => {
    const loader = (await createViewerLibLoader({ allow: ['@faicad/package-not-installed'] }))!
    await expect(loader.loadLib('@faicad/package-not-installed')).rejects.toThrow()
  })
})

describe('createViewerLibLoader — browser branch', () => {
  function stubBrowser(): void {
    vi.stubGlobal('window', { addEventListener: () => {} })
  }

  it('builds a CDN loader that injects importModule with a pinned +esm url', async () => {
    stubBrowser()
    const importModule = vi.fn(async (url: string) => ({ contractVersion: 0, spurGear: () => {} }))
    const loader = (await createViewerLibLoader({
      versions: { '@faicad/faijs-gears': '0.29.2' },
      aliases: { gears: '@faicad/faijs-gears' },
      importModule,
    }))!
    const ns = (await loader.loadLib('gears')) as { spurGear?: unknown }
    expect(typeof ns.spurGear).toBe('function')
    expect(importModule).toHaveBeenCalledWith('https://cdn.jsdelivr.net/npm/@faicad/faijs-gears@0.29.2/+esm')
  })

  it('rejects out-of-whitelist packages before any import', async () => {
    stubBrowser()
    const importModule = vi.fn(async () => ({}))
    const loader = (await createViewerLibLoader({ allow: ['@faicad/faijs-gears'], importModule }))!
    await expect(loader.loadLib('@faicad/faijs-sketch')).rejects.toThrow(/not in the browser library whitelist/)
    expect(importModule).not.toHaveBeenCalled()
  })
})
