import { describe, it, expect } from 'vitest'
import { createPreviewExec } from '../../src/cad-runtime/preview-exec'

describe('createPreviewExec', () => {
  it('builds a mesh-mode context with null BREP kernel and empty chain', () => {
    const exec = createPreviewExec()
    expect(exec.mode).toBe('mesh')
    expect(exec.kernels.brep).toBeNull()
    expect(exec.brepChain.solidCache.size).toBe(0)
    expect(exec.brepChain.faceEvolutionCache?.size).toBe(0)
  })

  it('defaults events to a no-op emitter', () => {
    const exec = createPreviewExec()
    expect(() => exec.events.emit('part-brep-lost', { partName: 'p' as never, callee: 'test', reason: 'test' })).not.toThrow()
  })

  it('keeps the supplied ports and overrides events via ports', () => {
    let emitted = false
    const sdfPort = {} as never
    const exec = createPreviewExec({
      events: { emit: () => { emitted = true } } as never,
      sdf: sdfPort,
    })
    exec.events.emit('part-brep-lost', { partName: 'p' as never, callee: 'test', reason: 'test' })
    expect(emitted).toBe(true)
    expect(exec.ports.sdf).toBe(sdfPort)
  })
})