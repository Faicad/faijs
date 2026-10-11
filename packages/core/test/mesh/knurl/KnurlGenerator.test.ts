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
 *       - produces a displaced Shape when a loader is injected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Vec3 as Vec3C } from '../../../src/math3d'
import {
  applyKnurlDisplacement,
  KNURL_DEFAULTS,
  type KnurlParams,
  type KnurlBounds,
} from '../../../src/mesh/knurl/KnurlGenerator'
import { setKnurlTextureLoader } from '../../../src/mesh/knurl/textureLoader'
import { MODE_TRIPLANAR } from '../../../src/mesh/knurl/mapping'
import { isMeshShape, type Shape } from '../../../src/mesh/types'

const BOUNDS_OVERRIDE: KnurlBounds = {
  min: new Vec3C(0, 0, 0),
  max: new Vec3C(1, 1, 1),
  size: new Vec3C(1, 1, 1),
  center: new Vec3C(0.5, 0.5, 0.5),
}

function unitTriangle(): Shape {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const indices = new Uint32Array([0, 1, 2])
  return { positions: pos, indices }
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

  it('produces a displaced Shape when a loader is injected', async () => {
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
    expect(isMeshShape(out)).toBe(true)
    expect(out.positions.length / 3).toBeGreaterThan(0)
    expect(out.normals!.length / 3).toBe(out.positions.length / 3)
    // Pipeline reports texture -> subdivide -> displace.
    expect(stages).toContain('texture')
    expect(stages).toContain('displace')
  })
})