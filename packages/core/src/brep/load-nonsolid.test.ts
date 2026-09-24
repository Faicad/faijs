/**
 * `loadBrep` with `allowNonSolid` — importing frozen geometry that is not a solid.
 *
 * A FreeCAD `.brp` asset is a frozen BREP and is NOT guaranteed to hold a solid:
 * Draft wires, faces and shells are frozen the same way. The platform import op
 * `cad.import_brep` always opts into this relaxed path (C6: non-solid is
 * first-class), so a wire/face/shell imports cleanly and only fails later at a
 * use site that requires a solid (e.g. a boolean).
 *
 * The pair of fixtures is the point: the same code path must keep importing a
 * real solid unchanged, so a mis-classified asset degrades into "slightly too
 * permissive", not into a wrong result.
 *
 * Run: npx vitest run src/brep/load-nonsolid.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import type { BrepEngineApi } from './engine/primitives'
import { loadBrep } from './brep-ops'

let kernel: BrepEngineApi

beforeAll(async () => {
  // Phase 4 收窄：initOcctWasm 返回原生 OcctKernel，L1 契约面由适配器组合提供——
  // 测试直接驱动 loadBrep（L1 面）需品牌转换（运行时同构）。
  kernel = (await initOcctWasm()) as unknown as BrepEngineApi
}, 180000)

function fixture(name: string): ArrayBuffer {
  const bytes = readFileSync(
    fileURLToPath(new URL(`../../../fixtures/data/brp/${name}`, import.meta.url)),
  )
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

describe('loadBrep — frozen assets without a solid', () => {
  it('rejects a wireframe asset by default', () => {
    expect(() => loadBrep(kernel, fixture('draft-wire.brp'))).toThrow(/no solid sub-shapes/)
  })

  it('imports it as addressable geometry when allowNonSolid is set', () => {
    const { solid, shape } = loadBrep(
      kernel, fixture('draft-wire.brp'), undefined, undefined, undefined, { allowNonSolid: true },
    )
    // The handle IS the wire shape (no wrapping compound), and it survives as a
    // queryable sub-shape — downstream transform/group needs `brepOf` to work.
    expect(kernel.getSubShapes(solid, 'wire').length).toBeGreaterThan(0)
    expect(kernel.getSubShapes(solid, 'edge').length).toBeGreaterThan(0)
    // GOTCHA (2026-09-21): a wireframe with no face tessellates to NOTHING.
    // `meshShape` only triangles faces, and this asset's table is
    // `Ve Ve Ed Ve Ed Wi` — zero `Fa`. So the import succeeds and the handle is
    // fully queryable, but the display mesh comes out empty; drawing wires
    // would need the kernel's `wireframe()` edge channel, which `Shape` does
    // not carry. Pinned here rather than papered over: an asset with a face
    // (Array001: `Fa` + `Wi`) does tessellate, so this is about face-less
    // assets only. Displaying them is a separate, still-open gap.
    expect(shape.positions.length).toBe(0)
  })

  it('keeps importing a real solid through the same flag', () => {
    const { solid } = loadBrep(
      kernel, fixture('boss-solid.brp'), undefined, undefined, undefined, { allowNonSolid: true },
    )
    expect(kernel.getSubShapes(solid, 'solid').length).toBeGreaterThan(0)
  })

  it('pins the downstream limit: a non-solid operand cannot be booleaned', () => {
    // GOTCHA: OCCT's fuse rejects a wireframe operand outright. This is why the
    // relaxed import is safe for transform/group chains but NOT for a boolean
    // chain — a caller that pipes one into cad.subtract gets a loud failure,
    // never a silently wrong part.
    const wire = loadBrep(
      kernel, fixture('draft-wire.brp'), undefined, undefined, undefined, { allowNonSolid: true },
    )
    const solid = loadBrep(kernel, fixture('boss-solid.brp'))
    expect(() => kernel.fuse(solid.solid, wire.solid)).toThrow()
  })
})
