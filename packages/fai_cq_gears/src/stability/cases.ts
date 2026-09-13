/**
 * stability — T3 stability-test case definitions (plan §9.3).
 *
 * Port of cq_gears `tests/stability/test_*.py`: per-class `gen_params`
 * (deterministic PRNG) and the build invariants (isSolid / volume bounds /
 * bbox directions with BBOX_CHECK_TOL = 0.5). Only the 5 classes cq covers.
 *
 * Failure tags: PRECALC / BUILDING / NOT_SOLID / VOLUME / BBOX_Z / BBOX_XY /
 * TIMEOUT (TIMEOUT is applied by the runner's spawnSync isolation, not here —
 * a hung wasm build cannot be interrupted in-process).
 */

import { Rng } from '../rng'
import {
  spurGearGeometry, ringGearGeometry, rackGearGeometry, wormGeometry,
  bevelGearGeometry,
  type SpurGearGeometry, type RackGearGeometry, type WormGeometry,
  type BevelGearGeometry,
} from '../profile'
import {
  buildSpurGearSolid, buildHerringboneGearSolid,
} from '../spur_gear'
import { buildRingGearSolid } from '../ring_gear'
import { buildHerringboneRingGearSolid } from '../ring_gear'
import {
  buildRackGearSolid,
} from '../rack_gear'
import { buildWormSolid } from '../worm_gear'
import { buildBevelGearSolid } from '../bevel_gear'
import type { GearKernel } from '@faicad/cq-compat'

/** Failure tags, verbatim from cq `tests/stability/utils.py`. */
export type StabilityTag =
  | 'PRECALC' | 'BUILDING' | 'NOT_SOLID' | 'VOLUME' | 'BBOX_Z' | 'BBOX_XY'

/** bbox tolerance, verbatim cq `BBOX_CHECK_TOL = 0.5` (mm). */
export const BBOX_CHECK_TOL = 0.5

/** One generated stability case. */
export interface StabilityCase {
  /** class id, e.g. `spur` / `herringbone` / `ring` / … */
  gear: string
  /** build params (names verbatim from the Python `__init__`). */
  params: Record<string, number>
}

/** Result of one case's invariants check (thrown as `StabilityFailure`). */
export class StabilityFailure extends Error {
  constructor(public readonly tag: StabilityTag, message: string) {
    super(`${tag}: ${message}`)
  }
}

interface BBoxLike {
  xmin: number; xmax: number
  ymin: number; ymax: number
  zmin: number; zmax: number
}

/** Spur-family invariants (cq `test_spur_gear.py`): volume in [π·w·rd², π·w·ra²). */
function checkSpur(
  g: SpurGearGeometry, volume: number, bb: BBoxLike, zAxis: 'z' | 'x' = 'z',
): void {
  const width = g.width
  const vmax = width * Math.PI * g.ra ** 2
  const vmin = width * Math.PI * g.rd ** 2
  if (!(vmin < volume && volume < vmax)) {
    throw new StabilityFailure('VOLUME', `v=${volume} not in (${vmin}, ${vmax})`)
  }
  const zLen = zAxis === 'z' ? bb.zmax - bb.zmin : bb.xmax - bb.xmin
  if (Math.abs(width - zLen) > BBOX_CHECK_TOL) {
    throw new StabilityFailure('BBOX_Z', `width=${width} vs axis=${zLen}`)
  }
  const maxd = Math.max(bb.xmax - bb.xmin, bb.ymax - bb.ymin)
  if (Math.abs(g.ra * 2 - maxd) > BBOX_CHECK_TOL) {
    throw new StabilityFailure('BBOX_XY', `ra*2=${g.ra * 2} vs maxd=${maxd}`)
  }
}

/** Ring-family invariants (cq `test_ring_gear.py`): `rim_r = rd + rim_width`. */
function checkRing(g: SpurGearGeometry & { rimR: number }, volume: number, bb: BBoxLike): void {
  const vcyl = g.width * Math.PI * g.rimR ** 2
  const vmax = vcyl - g.width * Math.PI * g.ra ** 2
  const vmin = vcyl - g.width * Math.PI * g.rd ** 2
  if (!(vmin < volume && volume < vmax)) {
    throw new StabilityFailure('VOLUME', `v=${volume} not in (${vmin}, ${vmax})`)
  }
  if (Math.abs(g.width - (bb.zmax - bb.zmin)) > BBOX_CHECK_TOL) {
    throw new StabilityFailure('BBOX_Z', `width=${g.width} vs z=${bb.zmax - bb.zmin}`)
  }
  const maxd = Math.max(bb.xmax - bb.xmin, bb.ymax - bb.ymin)
  if (Math.abs(g.rimR * 2 - maxd) > BBOX_CHECK_TOL) {
    throw new StabilityFailure('BBOX_XY', `rim_r*2=${g.rimR * 2} vs maxd=${maxd}`)
  }
}

/** Rack invariants (cq `test_rack_gear.py`). */
function checkRack(g: RackGearGeometry & { toothHeight: number }, volume: number, bb: BBoxLike): void {
  const vmax = g.length * g.width * (g.height + g.toothHeight)
  const vmin = g.length * g.width * g.height
  if (!(vmin < volume && volume < vmax)) {
    throw new StabilityFailure('VOLUME', `v=${volume} not in (${vmin}, ${vmax})`)
  }
  if (Math.abs(g.width - (bb.zmax - bb.zmin)) > BBOX_CHECK_TOL) {
    throw new StabilityFailure('BBOX_Z', `width=${g.width} vs z=${bb.zmax - bb.zmin}`)
  }
  const ydim = g.height + g.toothHeight
  if (Math.abs(ydim - (bb.ymax - bb.ymin)) > BBOX_CHECK_TOL ||
      Math.abs(g.length - (bb.xmax - bb.xmin)) > BBOX_CHECK_TOL) {
    throw new StabilityFailure('BBOX_XY', `y=${bb.ymax - bb.ymin} x=${bb.xmax - bb.xmin}`)
  }
}

/** Worm invariants (cq `test_worm.py`, axis along X). */
function checkWorm(g: WormGeometry, volume: number, bb: BBoxLike): void {
  const vmax = g.length * Math.PI * g.ra ** 2
  const vmin = g.length * Math.PI * g.rd ** 2
  if (!(vmin < volume && volume < vmax)) {
    throw new StabilityFailure('VOLUME', `v=${volume} not in (${vmin}, ${vmax})`)
  }
  if (Math.abs(g.length - (bb.xmax - bb.xmin)) > BBOX_CHECK_TOL) {
    throw new StabilityFailure('BBOX_Z', `length=${g.length} vs x=${bb.xmax - bb.xmin}`)
  }
  const maxd = Math.max(bb.zmax - bb.zmin, bb.ymax - bb.ymin)
  if (Math.abs(g.ra * 2 - maxd) > BBOX_CHECK_TOL) {
    throw new StabilityFailure('BBOX_XY', `ra*2=${g.ra * 2} vs maxd=${maxd}`)
  }
}

/** Bevel invariants (cq `test_bevel_gear.py`): cone-frustum volume bounds. */
function checkBevel(g: BevelGearGeometry, volume: number, bb: BBoxLike): void {
  const { coneH, gammaF, gammaR, gsR, faceWidth } = g
  const fconeR = coneH * Math.tan(gammaF)
  const rconeR = coneH * Math.tan(gammaR)
  const tcH = Math.cos(gammaF) * (gsR - faceWidth)
  const tfconeR = tcH * Math.tan(gammaF)
  const trconeR = tcH * Math.tan(gammaR)
  const vmax = (Math.PI * (coneH / 3) * fconeR ** 2) - (Math.PI * (tcH / 3) * tfconeR ** 2)
  const vmin = (Math.PI * (coneH / 3) * rconeR ** 2) - (Math.PI * (tcH / 3) * trconeR ** 2)
  if (!(vmin < volume && volume < vmax)) {
    throw new StabilityFailure('VOLUME', `v=${volume} not in (${vmin}, ${vmax})`)
  }
  const width = coneH - Math.cos(gammaF) * (gsR - faceWidth)
  if (Math.abs(width - (bb.zmax - bb.zmin)) > BBOX_CHECK_TOL) {
    throw new StabilityFailure('BBOX_Z', `width=${width} vs z=${bb.zmax - bb.zmin}`)
  }
  const maxd = Math.max(bb.xmax - bb.xmin, bb.ymax - bb.ymin)
  if (Math.abs(fconeR * 2 - maxd) > BBOX_CHECK_TOL) {
    throw new StabilityFailure('BBOX_XY', `fcone_r*2=${fconeR * 2} vs maxd=${maxd}`)
  }
}

// ── gen_params (draw order + ranges verbatim from the cq test_*.py) ────────

/** Per-class case generator + invariants checker. */
export interface StabilitySuite {
  id: string
  /** Deterministic param sweep (same seed → same list). */
  genParams(seed: number, n: number): StabilityCase[]
  /** Build + check all invariants; throws `StabilityFailure` (or build error). */
  run(kernel: GearKernel, params: Record<string, number>): void
}

function f(r: Rng, min: number, max: number): number {
  return r.uniform(min, max)
}

/** The five cq-covered suites. */
export const STABILITY_SUITES: StabilitySuite[] = [
  {
    id: 'spur',
    genParams(seed, n) {
      const r = new Rng(seed)
      return Array.from({ length: n }, () => ({
        gear: 'spur',
        params: {
          module: f(r, 0.05, 10), teeth_number: r.intInclusive(3, 200),
          width: f(r, 0.1, 1000), pressure_angle: f(r, 0.5, 30),
          helix_angle: f(r, -70, 70),
        },
      }))
    },
    run(k, p) { checkSpur(spurGearGeometry(p as never), k.getVolume(buildSpurGearSolid(k, p as never)), k.getBoundingBox(buildSpurGearSolid(k, p as never), false)) },
  },
  {
    id: 'herringbone',
    genParams(seed, n) {
      const r = new Rng(seed + 1)
      return Array.from({ length: n }, () => ({
        gear: 'herringbone',
        params: {
          module: f(r, 0.05, 10), teeth_number: r.intInclusive(3, 200),
          width: f(r, 0.1, 1000), pressure_angle: f(r, 0.5, 30),
          helix_angle: f(r, -70, 70),
        },
      }))
    },
    run(k, p) { checkSpur(spurGearGeometry(p as never), k.getVolume(buildHerringboneGearSolid(k, p as never)), k.getBoundingBox(buildHerringboneGearSolid(k, p as never), false)) },
  },
  {
    id: 'ring',
    genParams(seed, n) {
      const r = new Rng(seed + 2)
      return Array.from({ length: n }, () => ({
        gear: 'ring',
        params: {
          module: f(r, 0.05, 10), teeth_number: r.intInclusive(3, 200),
          width: f(r, 0.1, 1000), rim_width: f(r, 0.1, 100),
          pressure_angle: f(r, 0.5, 30), helix_angle: f(r, -70, 70),
        },
      }))
    },
    run(k, p) {
      const g = ringGearGeometry(p as never)
      const s = buildRingGearSolid(k, p as never)
      checkRing({ ...g, rimR: g.rd + p.rim_width }, k.getVolume(s), k.getBoundingBox(s, true))
    },
  },
  {
    id: 'herringbone-ring',
    genParams(seed, n) {
      const r = new Rng(seed + 3)
      return Array.from({ length: n }, () => ({
        gear: 'herringbone-ring',
        params: {
          module: f(r, 0.05, 10), teeth_number: r.intInclusive(3, 200),
          width: f(r, 0.1, 1000), rim_width: f(r, 0.1, 100),
          pressure_angle: f(r, 0.5, 30), helix_angle: f(r, -70, 70),
        },
      }))
    },
    run(k, p) {
      const g = ringGearGeometry(p as never)
      const s = buildHerringboneRingGearSolid(k, p as never)
      checkRing({ ...g, rimR: g.rd + p.rim_width }, k.getVolume(s), k.getBoundingBox(s, true))
    },
  },
  {
    id: 'rack',
    genParams(seed, n) {
      const r = new Rng(seed + 4)
      return Array.from({ length: n }, () => ({
        gear: 'rack',
        params: {
          module: f(r, 0.05, 10), length: f(r, 0.1, 1000), width: f(r, 0.1, 1000),
          height: f(r, 0.1, 100), pressure_angle: f(r, 0.5, 30),
          helix_angle: f(r, -70, 70),
        },
      }))
    },
    run(k, p) {
      const g = rackGearGeometry(p as never)
      const s = buildRackGearSolid(k, p as never)
      checkRack({ ...g, toothHeight: g.toothHeight }, k.getVolume(s), k.getBoundingBox(s, true))
    },
  },
  {
    id: 'herringbone-rack',
    genParams(seed, n) {
      const r = new Rng(seed + 5)
      return Array.from({ length: n }, () => ({
        gear: 'herringbone-rack',
        params: {
          module: f(r, 0.05, 10), length: f(r, 0.1, 1000), width: f(r, 0.1, 1000),
          height: f(r, 0.1, 100), pressure_angle: f(r, 0.5, 30),
          helix_angle: f(r, -70, 70),
        },
      }))
    },
    run(k, p) {
      const g = rackGearGeometry(p as never)
      const s = buildRackGearSolid(k, p as never, { herringbone: true })
      checkRack({ ...g, toothHeight: g.toothHeight }, k.getVolume(s), k.getBoundingBox(s, true))
    },
  },
  {
    id: 'worm',
    genParams(seed, n) {
      // cq test_worm.py: THREADS 1..16, LENGTH 10..2000, LEAD_ANGLE_MIN 0.5,
      // ROOT_RADIUS_MIN 1.0, kd = 1.25 (GearBase).
      const r = new Rng(seed + 6)
      return Array.from({ length: n }, () => {
        const m = f(r, 0.05, 10)
        const nThreads = r.intInclusive(1, 16)
        const leadMax = (nThreads * m) / (2 * 1.25 * m + 2 * 1.0)
        return {
          gear: 'worm',
          params: {
            module: m,
            lead_angle: f(r, 0.5, leadMax),
            n_threads: nThreads,
            length: f(r, 10, 2000),
            pressure_angle: f(r, 0.5, 30),
          },
        }
      })
    },
    run(k, p) {
      const s = buildWormSolid(k, p as never)
      checkWorm(wormGeometry(p as never), k.getVolume(s), k.getBoundingBox(s, true))
    },
  },
  {
    id: 'bevel',
    genParams(seed, n) {
      // cq test_bevel_gear.py: cone_angle 1..80, face_width = gs_r * random(),
      // helix -70..70. gs_r comes from bevelGearGeometry (back-cone distance).
      const r = new Rng(seed + 7)
      return Array.from({ length: n }, () => {
        const p = {
          module: f(r, 0.05, 10), teeth_number: r.intInclusive(3, 200),
          cone_angle: f(r, 1, 80), face_width: 0, pressure_angle: f(r, 0.5, 30),
          helix_angle: f(r, -70, 70),
        }
        p.face_width = bevelGearGeometry(p).gsR * r.next()
        return { gear: 'bevel', params: p }
      })
    },
    run(k, p) {
      const s = buildBevelGearSolid(k, p as never)
      checkBevel(bevelGearGeometry(p as never), k.getVolume(s), k.getBoundingBox(s, true))
    },
  },
]

/** Find a suite by class id. */
export function stabilitySuite(id: string): StabilitySuite | undefined {
  return STABILITY_SUITES.find((s) => s.id === id)
}
