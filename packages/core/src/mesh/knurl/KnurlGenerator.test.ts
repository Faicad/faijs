/**
 * KnurlGenerator.test.ts — the knurling displacement pipeline orchestration.
 *
 * Covers:
 *   - KNURL_DEFAULTS (every field's documented default)
 *   - applyKnurDisplacement(geometry, params, onProgress, boundsOverride):
 *       - throws when no texture loader is injected (Node fallback returns null),
 *       - throws when the injected loader yields null,
 *       - rethrows a wrapped error when the loader rejects (console.error is spied
 *         so the run stays stderr-silent),
 *       - produces a displaced BufferGeometry when a loader is injected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as THREE from 'three'
import {
  applyKnurlDisplacement,
  KNURL_DEFAULTS,
  type KnurlParams,
  type KnurlBounds,
} from './KnurlGenerator'
import { setKnurlTextureLoader } from './textureLoader'
import { MODE_TRIPLANAR } from './mapping'

const BOUNDS_OVERRIDE: KnurlBounds = {
  min: new THREE.Vector3(0, 0, 0),
  max: new THREE.Vector3(1, 1, 1),
  size: new THREE.Vector3(1, 1, 1),
  center: new THREE.Vector3(0.5, 0.5, 0.5),
}

function unitTriangle(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
  return g
}

const defaultParams = (): KnurlParams => ({ ...KNURL_DEFAULTS })

describe('KNURL_DEFAULTS', () => {
  it('exposes the documented default knurling parameters', () => {
    expect(KNURL_DEFAULTS.textureHeight).toBe(0.5)
    expect(KNURL_DEFAULTS.invertDisplacement).toBe(false)
    expect(KNURL_DEFAULTS.refineLength).toBe(1.0)
    expect(KNURL_DEFAULTS.scaleU).toBe(0.15)
    expect(KNURL_DEFAULTS.scaleV).toBe(0.15)
    expect(KNURL_DEFAULTS.mappingMode).toBe(MODE_TRIPLANAR)
    expect(KNURL_DEFAULTS.offsetU).toBe(0)
    expect(KNURL_DEFAULTS.offsetV).toBe(0)
    expect(KNURL_DEFAULTS.rotation).toBe(0)
    expect(KNURL_DEFAULTS.bottomAngleLimit).toBe(5)
    expect(KNURL_DEFAULTS.topAngleLimit).toBe(0)
    expect(KNURL_DEFAULTS.mappingBlend).toBe(1)
    expect(KNURL_DEFAULTS.seamBandWidth).toBe(0.5)
    expect(KNURL_DEFAULTS.faceWeights).toBeNull()
  })
})

describe('applyKnurlDisplacement', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Silence any library logging so tests stay stderr-clean; also proves the
    // error path is reached when the loader rejects.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
    setKnurlTextureLoader(null)
  })

  it('throws when no texture loader is injected', async () => {
    await expect(applyKnurlDisplacement(unitTriangle(), defaultParams())).rejects.toThrow(
      /No texture data available/,
    )
  })

  it('throws when the injected loader resolves to null', async () => {
    setKnurlTextureLoader(async () => null)
    await expect(applyKnurlDisplacement(unitTriangle(), defaultParams())).rejects.toThrow(
      /No texture data available/,
    )
  })

  it('wraps and rethrows the error when the loader rejects', async () => {
    setKnurlTextureLoader(async () => {
      throw new Error('boom')
    })
    await expect(applyKnurlDisplacement(unitTriangle(), defaultParams())).rejects.toThrow(
      /Failed to load knurling texture/,
    )
    expect(errorSpy).toHaveBeenCalled() // the wrapped error did log via console.error
  })

  it('produces a displaced BufferGeometry when a loader is injected', async () => {
    setKnurlTextureLoader(async () => ({
      data: new Uint8ClampedArray(4 * 4 * 4).fill(255), // 4x4 solid white
      width: 4,
      height: 4,
    }))
    const params = defaultParams()
    const stages: string[] = []
    const out = await applyKnurlDisplacement(
      unitTriangle(),
      params,
      (stage) => {
        if (!stages.includes(stage)) stages.push(stage)
      },
      BOUNDS_OVERRIDE,
    )
    expect(out).toBeInstanceOf(THREE.BufferGeometry)
    expect(out.attributes.position.count).toBeGreaterThan(0)
    expect(out.attributes.normal.count).toBe(out.attributes.position.count)
    // Pipeline reports texture -> subdivide -> displace.
    expect(stages).toContain('texture')
    expect(stages).toContain('displace')
  })
})