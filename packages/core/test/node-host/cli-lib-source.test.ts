/**
 * cli-lib-source — the node host's library-source probe order is part of the
 * determinism scan contract, not an implementation detail.
 *
 * `CadRuntime.runDeterminismGate` hands whatever `ports.libLoader.loadSource()`
 * returns to `scanDeterminism(..., { strict: true })`, which **throws** on TS
 * syntax ("type stripping is not supported; libraries must ship compiled JS").
 * The node host must therefore probe the shipped artifact first: a `file:`
 * self-link or a workspace link resolves the package dir to the repo root,
 * where `src/index.ts` is always present — probing it first made the gate
 * unsatisfiable for every such library.
 *
 * Observed 2026-10-15 in the standalone `faijs-cadquery` repo: every
 * `cliRun` of a `.fai.js` mirror died with
 * `[determinism] library source is not valid plain JavaScript at line 160:7`,
 * because the repo's documented dev self-link (`"@faicad/faijs-cadquery":
 * "file:."`) points `pkgDir` at the repo root.
 *
 * Two values are pinned, per the repo rule for defect tests:
 *   - `dist/index.js` (what ships) MUST pass the strict scan;
 *   - `src/index.ts` (what does not ship) MUST still throw — that negative case
 *     is the contract itself, so the strict gate keeps its teeth.
 *
 * Needs `dist/` built, exactly like the CLI it guards (`npm run build` runs
 * before tests in CI).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { withCliLibLoader } from '../../src/node-host/cli'
import { scanDeterminism } from '../../src/lang/determinism-scanner'
import type { HostPorts } from '../../src/cad-runtime/ports'

/** `@faicad/faijs-gears` is a workspace member: pkgDir holds src/ AND dist/. */
const WORKSPACE_LIB = '@faicad/faijs-gears'

const SCAN_OPTS = { strict: true, extraNamespaces: ['gears'] }

function loadSource() {
  const loader = withCliLibLoader({} as HostPorts).libLoader
  if (!loader?.loadSource) throw new Error('cliPortsLibLoader must implement loadSource')
  return loader.loadSource
}

describe('cliPortsLibLoader.loadSource — ship-first probe order', () => {
  it('hands the strict scanner compiled JS, not the TS source', async () => {
    const src = await loadSource()(WORKSPACE_LIB)
    expect(src).toBeTypeOf('string')
    expect(() => scanDeterminism(src!, SCAN_OPTS)).not.toThrow()
  })

  it('negative control: that package\'s src/index.ts still trips the strict contract', () => {
    const ts = readFileSync(
      fileURLToPath(new URL(`../../../../packages/faijs-gears/src/index.ts`, import.meta.url)),
      'utf-8',
    )
    expect(() => scanDeterminism(ts, SCAN_OPTS)).toThrow(
      /library source is not valid plain JavaScript/,
    )
  })
})
