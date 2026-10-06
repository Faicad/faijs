import { describe, it, expect } from 'vitest'
import { setManifoldWasmUrl, getManifoldWasmUrl } from '../../src/mesh/manifold-loader'

describe('manifold-loader wasm URL setter/getter', () => {
  it('setManifoldWasmUrl then getManifoldWasmUrl returns it', () => {
    setManifoldWasmUrl('https://example.test/manifold.wasm')
    expect(getManifoldWasmUrl()).toBe('https://example.test/manifold.wasm')
  })

  it('returns undefined before any URL is set', () => {
    setManifoldWasmUrl(undefined as never)
    expect(getManifoldWasmUrl()).toBeUndefined()
  })

  it('replacing the URL updates the getter', () => {
    setManifoldWasmUrl('a.wasm')
    setManifoldWasmUrl('b.wasm')
    expect(getManifoldWasmUrl()).toBe('b.wasm')
  })
})