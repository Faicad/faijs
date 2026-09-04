/**
 * Arena-bounded regression test — repeated identical `execute()` of a bare
 * `cad.box` must not grow the occt-wasm live shape arena.
 *
 * Root cause fixed (docs/analysis/2026-09-04-compat-arena-handle-leak.md):
 * `getSubShapes()` returns each sub-shape as an independent arena slot that the
 * release path (topologyExt `buildSelectorManifest` / naming `assignRoles`) did
 * not reclaim before this fix — bare box grew ~+54 slots/exec, and that leaked
 * on every repeated execute (compat e2e ⑦ tripped its 200 bound).
 *
 * Run: npx vitest run src/cad-runtime/arena-bounded.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime } from '@faicad/faijs'
import { getKernel } from '../occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import type { HostPorts } from './ports'

function createNodePorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

describe('repeated bare cad.box execute keeps the kernel arena bounded', () => {
  it('10 identical box executes grow the live shape count by <= 100 (pre-fix: +540)', async () => {
    const kernel = getKernel() as unknown as { shapeCount: number }
    const runtime = createRuntime(createNodePorts(), 'auto')
    try {
      const warm = await runtime.execute('const part0 = cad.box({ size: 20 })')
      expect(warm.failedAt).toBeUndefined()
      const base = kernel.shapeCount
      for (let i = 0; i < 10; i++) {
        const res = await runtime.execute('const part0 = cad.box({ size: 20 })')
        expect(res.failedAt).toBeUndefined()
      }
      const growth = kernel.shapeCount - base
      expect(growth).toBeLessThanOrEqual(100)
    } finally {
      runtime.dispose()
    }
  }, 120000)
})