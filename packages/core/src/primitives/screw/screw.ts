import * as THREE from 'three'
import type { ScrewParams } from './screw-db'
import { getScrewSpec, threadToPitchMm, SCREW_HEAD_DIMS } from './screw-db'

/** Max axial rings */
const N_AX_MAX = 3200

/** Rings per full turn */
const N_PER_TURN = 32

/** Rotation matrix: +90° around X — converts Y-up vertex data to Z-up. */
const ROT_Y_TO_Z = new THREE.Matrix4().makeRotationX(Math.PI / 2)

/**
 * Modulo that always returns a positive result.
 */
function modPos(a: number, b: number): number {
  return ((a % b) + b) % b
}

/**
 * Thread radial profile: returns radial factor [0..1] at a given angular offset
 * from the thread peak. offset=0 → crest, offset=±π → root.
 * Uses a sinusoidal profile.
 */
function threadProfileFactor(offset: number): number {
  return (1 + Math.cos(offset)) / 2
}

/**
 * Generate screw geometry from parameters.
 * Internally Y-up (NASSCAD convention), then rotated to Z-up.
 * Thread ridge follows a helix: at each axial position, the crest occurs
 * at a specific angular phase; vertices near that phase get larger radius.
 *
 * @param params - the screw parameters (system, spec, thread, length, head, resolution).
 * @returns a Z-up BufferGeometry of the screw.
 */
export function makeScrew(params: ScrewParams): THREE.BufferGeometry {
  const {
    system,
    specIdx,
    thread,
    pitchCustom,
    length,
    head,
    nRad,
  } = params

  const spec = getScrewSpec(system, specIdx)
  const pitch = threadToPitchMm(system, spec, thread, pitchCustom)
  const rCrest = spec.dia / 2
  const rRoot = thread === 'none' ? rCrest : rCrest * 0.85

  // Number of axial rings
  const nAxial = pitch > 0
    ? Math.min(Math.round(length / pitch * N_PER_TURN), N_AX_MAX)
    : 4
  const nAxialClamped = Math.max(3, nAxial)

  // Fade region rings for lead-in/lead-out
  const fadeRings = Math.min(N_PER_TURN, Math.max(2, Math.floor(nAxialClamped * 0.12)))

  // Head geometry
  const hasHead = head !== 'none'
  const headRings = hasHead ? Math.max(4, Math.floor(nRad / 4)) : 0
  const totalRings = nAxialClamped + headRings

  // Head dimensions (shared with BREP path via SCREW_HEAD_DIMS)
  const headHeight = hasHead
    ? spec.dia * (head === 'hex' ? SCREW_HEAD_DIMS.hex.heightFactor : SCREW_HEAD_DIMS.chc.heightFactor)
    : 0
  const headRadius = hasHead
    ? spec.dia * (head === 'hex' ? SCREW_HEAD_DIMS.hex.radiusFactor : SCREW_HEAD_DIMS.chc.radiusFactor)
    : 0

  const vPos: number[] = []
  const tris: number[] = []

  // ---- Generate body rings ----
  // Shank is centered: Y from -length/2 to +length/2 (head at +length/2 end)
  for (let i = 0; i < nAxialClamped; i++) {
    const t = nAxialClamped > 1 ? i / (nAxialClamped - 1) : 0
    const axialPos = t * length - length / 2  // Y position (centered)

    // Thread helix phase at this axial position
    const threadPhase = pitch > 0 ? (axialPos / pitch) * 2 * Math.PI : 0

    // Fade factor: thread depth ramps up/down
    let fade = 1
    if (i < fadeRings) {
      fade = i / fadeRings
    } else if (i > nAxialClamped - fadeRings) {
      fade = (nAxialClamped - 1 - i) / (fadeRings - 1)
    }
    fade = Math.max(0, Math.min(1, fade))

    for (let j = 0; j < nRad; j++) {
      const phi = (j / nRad) * 2 * Math.PI

      let r: number
      if (thread === 'none') {
        r = rCrest
      } else {
        // Angular offset from thread peak
        const offset = modPos(phi - threadPhase + Math.PI, 2 * Math.PI) - Math.PI
        const profile = threadProfileFactor(offset)
        r = rRoot + (rCrest - rRoot) * profile * fade
      }

      const x = r * Math.cos(phi)
      const z = r * Math.sin(phi)
      vPos.push(x, axialPos, z)
    }
  }

  // ---- Generate head rings ----
  if (hasHead) {
    for (let i = 0; i < headRings; i++) {
      const t = headRings > 1 ? i / (headRings - 1) : 0
      const axialPos = length / 2 + t * headHeight

      for (let j = 0; j < nRad; j++) {
        const phi = (j / nRad) * 2 * Math.PI

        // Head blends from body-top radius to larger head radius
        const headR = headRadius
        const blend = Math.min(1, t * 2)
        const r = rCrest + (headR - rCrest) * blend

        let rx = r * Math.cos(phi)
        let rz = r * Math.sin(phi)

        if (head === 'hex') {
          // Hex head: truncate to flat sides every 60°
          // Circumscribed circle r acts as the "corner-to-corner" radius;
          // the flat-to-flat distance is r * sqrt(3)
          const flatAngle = Math.PI / 3
          const seg = Math.floor(phi / flatAngle)
          const angleInSeg = phi - seg * flatAngle
          // Distance from center to flat side at this angle
          const cornerR = r
          const flatDist = cornerR * Math.cos(Math.PI / 6)  // flat-to-center distance
          const cosToFlat = Math.abs(Math.cos(angleInSeg - flatAngle / 2))
          const sideR = flatDist / Math.max(cosToFlat, 0.01)
          rx = sideR * Math.cos(phi)
          rz = sideR * Math.sin(phi)
        }

        vPos.push(rx, axialPos, rz)
      }
    }
  }

  // ---- Generate triangle indices ----
  function ringVertex(ring: number, seg: number): number {
    return ring * nRad + seg
  }

  // Connect adjacent rings
  for (let i = 0; i < totalRings - 1; i++) {
    for (let j = 0; j < nRad; j++) {
      const jNext = (j + 1) % nRad
      const a = ringVertex(i, j)
      const b = ringVertex(i, jNext)
      const c = ringVertex(i + 1, j)
      const d = ringVertex(i + 1, jNext)
      // Reversed winding: (a,c,b) and (c,d,b) → outward normals
      tris.push(a, c, b)
      tris.push(c, d, b)
    }
  }

  // Close top (cap) if no head
  if (!hasHead && nAxialClamped > 1) {
    const topRing = nAxialClamped - 1
    const centerIdx = vPos.length / 3
    vPos.push(0, length / 2, 0)  // centered: top is at +length/2
    for (let j = 0; j < nRad; j++) {
      const jNext = (j + 1) % nRad
      tris.push(ringVertex(topRing, j), centerIdx, ringVertex(topRing, jNext))
    }
  }

  // Close bottom (always cap)
  if (nAxialClamped > 1) {
    const centerIdx = vPos.length / 3
    vPos.push(0, -length / 2, 0)  // centered: bottom is at -length/2
    for (let j = 0; j < nRad; j++) {
      const jNext = (j + 1) % nRad
      tris.push(ringVertex(0, jNext), centerIdx, ringVertex(0, j))
    }
  }

  // Close head top
  if (hasHead) {
    const topRing = totalRings - 1
    const centerIdx = vPos.length / 3
    vPos.push(0, length / 2 + headHeight, 0)  // centered: head top at length/2 + headHeight
    for (let j = 0; j < nRad; j++) {
      const jNext = (j + 1) % nRad
      tris.push(ringVertex(topRing, j), centerIdx, ringVertex(topRing, jNext))
    }
  }

  // ---- Build BufferGeometry and rotate to Z-up ----
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vPos), 3))
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(tris), 1))
  geo.applyMatrix4(ROT_Y_TO_Z)

  return geo
}
