/**
 * dependency-manifest — pin the published dependency surface of @faicad/faijs.
 *
 * brepkit is an optional engine: the default BREP chain runs on OCCT, and
 * `initBrepkitWasm()` resolves `brepkit-wasm` through a non-literal dynamic
 * import so a host can inject its own loader. Declaring it in `dependencies`
 * forces every consumer (including hosts that never register a brepkit engine)
 * to install a wasm package nobody loads. It belongs in devDependencies, where
 * the local test runner and CLI can still use it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

interface Manifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const here = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(
  readFileSync(join(here, '..', 'package.json'), 'utf8'),
) as Manifest

describe('@faicad/faijs published dependency surface', () => {
  it('never forces brepkit-wasm on a consumer install', () => {
    expect(manifest.dependencies?.['brepkit-wasm']).toBeUndefined()
  })

  it('keeps brepkit-wasm for the local test / CLI runner', () => {
    expect(manifest.devDependencies?.['brepkit-wasm']).toBeDefined()
  })
})
