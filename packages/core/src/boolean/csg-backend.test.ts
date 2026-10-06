import { describe, it, expect, vi } from 'vitest'
import {
  setCsgBackend,
  computeBoolean,
  computeSplit,
} from './csg-backend'

function fakeBackend() {
  return {
    boolean: vi.fn(async (op: string, meshes: unknown[]) => ({ op, meshes })),
    splitPlane: vi.fn(async (m: unknown, p: unknown) => ({ front: { m, p }, back: { m, p } })),
    splitDovetail: vi.fn(),
    splitDowel: vi.fn(),
    splitStraightTenon: vi.fn(),
    dispose: vi.fn(),
  } as never
}

describe('setCsgBackend + routing', () => {
  it('routes computeBoolean to the injected backend', async () => {
    const b: any = fakeBackend()
    setCsgBackend(b as never)
    const meshes = [{ id: 1 } as never, { id: 2 } as never]
    await computeBoolean(meshes, 'union')
    expect(b.boolean).toHaveBeenCalledTimes(1)
    expect(b.boolean.mock.calls[0][0]).toBe('union')
    expect(b.boolean.mock.calls[0][1]).toBe(meshes)
  })

  it('routes computeSplit through splitPlane and unpacks front/back', async () => {
    const b: any = fakeBackend()
    setCsgBackend(b as never)
    b.splitPlane.mockResolvedValue({ front: 'F', back: 'B' })
    const r = await computeSplit({} as never, [0, 0, 1], 2)
    expect(r).toEqual({ front: 'F', back: 'B' })
    expect(b.splitPlane.mock.calls[0][1]).toEqual({ normal: [0, 0, 1], offset: 2 })
  })
})