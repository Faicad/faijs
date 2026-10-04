/**
 * libs — the viewer's third-party library loader (the dynamic side of
 * `openFaiZip`).
 *
 * The engine loads a model's namespace imports lazily at execute time
 * (`autoLoadLibsFromImports` → `HostPorts.libLoader.loadLib`). This module
 * builds that loader for the viewer. Preset libraries (core, sketch,
 * faijs-extra — merged into the default `cad` namespace) never pass through it;
 * it serves scripts like `import * as gears from "@faicad/faijs-gears"` only.
 *
 * Dispatch follows the environment:
 * - a browser host gets `createBrowserLibLoader` (jsDelivr CDN dynamic
 *   `import()`, version-pinned `+esm` links when `versions` is provided);
 * - a Node host gets an internal whitelisted `import(pkg)` loader mirroring
 *   core's CLI loader semantics: per-library `faijs.autoLift` from each
 *   package's own `package.json`, plus `loadSource` for determinism scanning.
 *
 * **Access policy (user-decided, 2026-10-04):** every `@faicad/*` package is
 * allowed by default — no whitelist is required. Non-`@faicad/*` packages are
 * rejected (defence against look-alike stranger packages from an untrusted
 * `.fai.zip`). The Node branch enforces the scoped prefix directly; the
 * browser branch wraps core's loader (whose `libs` option, when omitted,
 * would otherwise allow everything) with the same check.
 *
 * The Node branches touch `node:` builtins, so they are reached only through
 * dynamic `import(/* @vite-ignore *​/)` calls behind an `inNodeEnv()` guard —
 * the same pattern `ensureSketchSolver` uses in `open-fai-zip.ts`. A browser
 * bundler never bundles the `node:` branch into a shipped chunk.
 */

import { createBrowserLibLoader } from '@faicad/faijs/browser'
import type { LibLoader } from '@faicad/faijs'
import type { LibNamespace } from '@faicad/faijs/runtime-state'
import type { FaiViewerLibsOptions } from './types'

/** Node runner detection (mirrors core's `hasBrowserWindow`). */
function inNodeEnv(): boolean {
  return typeof window === 'undefined' || typeof window.addEventListener !== 'function'
}

/** Allowed scoped prefix: every `@faicad/` package loads without a whitelist. */
const SCOPED_PREFIX = '@faicad/'

/**
 * Access policy shared by both branches: every `@faicad/*` package is allowed
 * by default; anything else is rejected. (User-decided 2026-10-04: no
 * whitelist parameter — all `@faicad` packages load without configuration.)
 */
function assertScoped(pkg: string, name: string): void {
  if (!pkg.startsWith(SCOPED_PREFIX)) {
    throw new Error(`package "${name}" is not a scoped @faicad/ library`)
  }
}

/**
 * Build the Node library loader.
 *
 * `import(pkg)` resolves through the host's module graph: the package must be
 * installed (or reachable) from the consumer. An unresolved package throws
 * `ERR_MODULE_NOT_FOUND`, which the runtime surfaces as a structured load
 * failure at the import statement — never a viewer throw.
 */
async function createNodeLibLoader(opts: FaiViewerLibsOptions): Promise<LibLoader> {
  // node:* builtins are imported dynamically behind the Node guard so a
  // browser-targeted bundler never sees them statically.
  const { createRequire } = await import(/* @vite-ignore */ 'node:module')
  const { readFileSync, existsSync } = await import(/* @vite-ignore */ 'node:fs')
  const { dirname, join } = await import(/* @vite-ignore */ 'node:path')
  const requireNode = createRequire(import.meta.url)

  const aliases: Record<string, string> = { ...(opts.aliases ?? {}) }

  /** specifier → npm package name. */
  const pkgOf = (name: string): string => aliases[name] ?? name

  /**
   * Locate a package's root directory without tripping on its `exports` map.
   *
   * `require.resolve(pkg/package.json)` fails with ERR_PACKAGE_PATH_NOT_EXPORTED
   * for packages whose `exports` does not list the `package.json` subpath (all
   * @faicad family packages today). Resolving the package's main entry instead
   * (always listed in `exports`), then walking up to the first `package.json`
   * whose `name` matches, yields the root in both symlinked-workspace and
   * installed-from-registry layouts. GOTCHA (2026-10-04): core's own CLI loader
   * (`cli.ts` `loadSource` / `readLibAutoLift`) uses the direct
   * `resolve(pkg/package.json)` form and therefore silently returns `undefined`
   * for every exported library — the viewer must not copy that behaviour.
   */
  function findPkgDir(pkg: string): string | undefined {
    try {
      const entry = requireNode.resolve(pkg)
      let dir = dirname(entry)
      for (let i = 0; i < 6; i++) {
        const pjPath = join(dir, 'package.json')
        if (existsSync(pjPath)) {
          try {
            const pj = JSON.parse(readFileSync(pjPath, 'utf8')) as { name?: string }
            if (pj.name === pkg) return dir
          } catch {
            // Unparseable package.json: keep walking up.
          }
        }
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
      }
    } catch {
      // Unresolvable package: caller handles `undefined`.
    }
    return undefined
  }

  /** Read `faijs.autoLift` from the library's own `package.json` (D3-autoLift).
   * Absent → `undefined` (runtime falls back to its `!hasDualOp` inference). */
  function readLibAutoLift(pkg: string): boolean | undefined {
    const pkgDir = findPkgDir(pkg)
    if (!pkgDir) return undefined
    try {
      const pj = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
        faijs?: { autoLift?: boolean }
      }
      const v = pj.faijs?.autoLift
      return typeof v === 'boolean' ? v : undefined
    } catch {
      return undefined
    }
  }

  return {
    loadLib: async (name: string) => {
      const pkg = pkgOf(name)
      assertScoped(pkg, name)
      return (await import(pkg)) as LibNamespace
    },

    listLibs: () => [...Object.keys(aliases), '@faicad/'],

    loadSource: async (name: string) => {
      const pkg = pkgOf(name)
      const pkgDir = findPkgDir(pkg)
      if (!pkgDir) return undefined
      // Compiled JS first: the runtime's determinism scan (`scanLibrarySource`,
      // strict mode) rejects TS sources outright ("libraries must ship compiled
      // JS"), and it runs against every @faicad/* import before loadLib.
      for (const p of [
        join(pkgDir, 'dist', 'index.js'),
        join(pkgDir, 'src', 'index.js'),
        join(pkgDir, 'src', 'index.ts'),
      ]) {
        if (existsSync(p)) return readFileSync(p, 'utf8')
      }
      return undefined
    },

    options: {
      // Lifting defaults to the runtime's `!hasDualOp(ns)` inference: bare
      // function libraries (gears, fasteners, sheetmetal) lift to the
      // script-facing shape automatically, dual-op libraries stay unlifted.
      // Each library overrides through its own `faijs.autoLift` declaration
      // (`autoLiftFor`), mirroring core's per-library D3 convention. Note this
      // deliberately differs from core's CLI loader, which defaults
      // `autoLift: false` and leaves undeclared bare-function libraries
      // un-lifted — a CLI-side limitation the viewer does not copy.
      autoLiftFor: (name: string) => readLibAutoLift(pkgOf(name)),
    },
  }
}

/**
 * Build the viewer's library loader for `openFaiZip`.
 *
 * @param opts - the `libs` config from `OpenFaiZipOptions`; `undefined` means
 *   dynamic loading is enabled with the loader defaults.
 * @returns the loader, or `undefined` when dynamic loading is disabled
 *   (`libs.enabled === false`) — unregistered library imports then fail as
 *   unbound namespaces at execution.
 */
export async function createViewerLibLoader(opts: FaiViewerLibsOptions | undefined): Promise<LibLoader | undefined> {
  if (opts?.enabled === false) return undefined
  if (inNodeEnv()) return createNodeLibLoader(opts ?? {})
  const inner = createBrowserLibLoader({
    cdnBase: opts?.cdnBase,
    versions: opts?.versions,
    aliases: opts?.aliases,
    importModule: opts?.importModule,
  })
  // Wrap core's loader with the shared access policy: core's `libs` option,
  // when omitted, allows ANY package — an untrusted `.fai.zip` must not reach
  // that. Every `@faicad/*` package loads by default; anything else is
  // rejected before any CDN import.
  const { loadLib, ...rest } = inner
  return {
    ...rest,
    loadLib: async (name: string) => {
      const pkg = opts?.aliases?.[name] ?? name
      assertScoped(pkg, name)
      return loadLib(name)
    },
  }
}
