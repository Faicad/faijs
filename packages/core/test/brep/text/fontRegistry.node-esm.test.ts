/**
 * Regression guard for the Node-ESM `opentype.js` interop bug.
 *
 * `opentype.js` is a UMD+ESM dual package with **no** `exports` map. Node ESM
 * therefore resolves its UMD `main`, and a namespace import only exposes
 * `{ default }` — leaving `opentype.parse` undefined. Bundlers (vitest / vite)
 * resolve the ESM `module` build instead and expose the named exports directly,
 * which is exactly why the in-process suite never caught this: the failure only
 * surfaced when the CLI ran core's *source* through tsx under Node ESM.
 *
 * The in-process vitest path cannot reproduce the bug, so this test spawns a
 * real Node-ESM child (`node --import tsx`) and drives `loadFont` on the exact
 * failing resolution path. If the interop shim regresses, the child throws
 * "Failed to parse font data: opentype.parse is not a function".
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const registryPath = fileURLToPath(new URL('../../../src/brep/text/fontRegistry.ts', import.meta.url))
const fontPath = fileURLToPath(new URL('../../../src/assets/fonts/OpenSans-Regular.ttf', import.meta.url))

describe('fontRegistry under Node ESM', () => {
  it('parses a font when opentype.js resolves through its UMD (CJS) entry', () => {
    const script = [
      `const { loadFont } = await import(${JSON.stringify(pathToFileURL(registryPath).href)})`,
      `const { readFileSync } = await import('node:fs')`,
      `const b = readFileSync(${JSON.stringify(fontPath)})`,
      `const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)`,
      `await loadFont(ab, 'default', true)`,
      `process.stdout.write('ok')`,
    ].join(';')

    const out = execFileSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', script],
      { cwd: repoRoot, encoding: 'utf8' },
    )

    expect(out.trim()).toBe('ok')
  }, 60000)
})
