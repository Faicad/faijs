import * as THREE from 'three'
import { makeScrew } from '../../primitives/screw/screw'
import { getScrewSpec } from '../../primitives/screw/screw-db'
import {
  computeBoolean,
  geoToManifoldMesh,
  manifoldMeshToGeo,
} from '../../boolean/csg-backend'
import { deriveNormals } from '../../boolean/deriveNormals'
import type { ManifoldMeshData } from '../../boolean/csg-backend'
import type { DrillDirection, DrillHoleParams } from '../../components/drill-hole/drill-types'

/** Rotation matrix: +90° around X — converts Y-up vertex data to Z-up. */
const ROT_Y_TO_Z = new THREE.Matrix4().makeRotationX(Math.PI / 2)

/**
 * Build a Z-up hole geometry centered on the origin, with axial direction along Z.
 *
 * - simple: CylinderGeometry rotated to Z-up
 * - screw: makeScrew() already returns Z-up
 *
 * Tolerance is applied as a radial expansion (tolerance/2 on radius).
 */
export function buildHoleGeometry(
  params: DrillHoleParams,
  height: number,
): THREE.BufferGeometry {
  const toleranceRadius = params.tolerance / 2

  // ── simple: CylinderGeometry → rotate to Z-up ──
  if (params.holeType === 'simple') {
    const r = params.diameter / 2 + toleranceRadius
    const geo = new THREE.CylinderGeometry(r, r, height, 32)
    geo.applyMatrix4(ROT_Y_TO_Z)
    return geo
  }

  // ── screw: makeScrew() already returns Z-up ──
  if (params.holeType === 'screw') {
    const geo = makeScrew({
      system: params.screwSystem,
      specIdx: params.screwSpecIdx,
      thread: params.screwThread,
      pitchCustom: 0,
      length: height,
      head: params.screwHead,
      nRad: 32,
    })

    // Center the screw on origin. makeScrew extends from Z=0 to Z=height
    // for the body, plus headHeight = spec.dia for the head (if present).
    // The total length = height + headHeight, so center by half that.
    const spec = getScrewSpec(params.screwSystem, params.screwSpecIdx)
    const headHeight = params.screwHead !== 'none' ? spec.dia : 0
    const totalLength = height + headHeight
    geo.translate(0, 0, -totalLength / 2)

    // For screw with head: makeScrew places the head at the +Z end (top of
    // the screw), but for a drill hole the head must be at the -Z end — the
    // entry point at the surface. Reflect Z to put the head at the entry side,
    // and reverse triangle winding to maintain correct normals.
    if (params.screwHead !== 'none') {
      const pos = geo.getAttribute('position')
      for (let i = 0; i < pos.count; i++) {
        pos.setZ(i, -pos.getZ(i))
      }
      pos.needsUpdate = true

      // Fix winding order: reflection flips triangle orientation
      const idx = geo.index!
      const arr = idx.array as Uint16Array | Uint32Array
      for (let i = 0; i < arr.length; i += 3) {
        const tmp = arr[i + 1]
        arr[i + 1] = arr[i + 2]
        arr[i + 2] = tmp
      }
      idx.needsUpdate = true
    }

    // Apply tolerance: scale radially (X and Y in Z-up space)
    const baseRadius = spec.dia / 2
    if (toleranceRadius > 0 && baseRadius > 0) {
      const scale = 1 + toleranceRadius / baseRadius
      geo.scale(scale, scale, 1)
    }
    return geo
  }

  // Fallback (should not reach)
  const geo = new THREE.CylinderGeometry(params.diameter / 2, params.diameter / 2, height, 32)
  geo.applyMatrix4(ROT_Y_TO_Z)
  return geo
}

/**
 * Compute the through-hole height by raycasting against the target mesh's bbox.
 * Returns { height, center } so the cylinder exactly spans the model thickness
 * along the drill direction, without extending outside.
 */
export function computeThroughHoleDimensions(
  position: THREE.Vector3,
  direction: THREE.Vector3,
  bbox: THREE.Box3,
): { height: number; center: THREE.Vector3 } {
  const dir = direction.clone().normalize()

  // Manual slab-method intersection: compute distances along dir to bbox entry/exit.
  // This handles edge cases where position is exactly on the bbox boundary
  // (Ray.intersectBox returns null in those cases).
  const p = position
  const d = dir
  let tNear = -Infinity
  let tFar = Infinity

  // X slab
  if (Math.abs(d.x) > 1e-12) {
    const t1 = (bbox.min.x - p.x) / d.x
    const t2 = (bbox.max.x - p.x) / d.x
    tNear = Math.max(tNear, Math.min(t1, t2))
    tFar = Math.min(tFar, Math.max(t1, t2))
  } else if (p.x < bbox.min.x || p.x > bbox.max.x) {
    // Parallel to X slab and outside — no intersection
    return { height: 0, center: position.clone() }
  }

  // Y slab
  if (Math.abs(d.y) > 1e-12) {
    const t1 = (bbox.min.y - p.y) / d.y
    const t2 = (bbox.max.y - p.y) / d.y
    tNear = Math.max(tNear, Math.min(t1, t2))
    tFar = Math.min(tFar, Math.max(t1, t2))
  } else if (p.y < bbox.min.y || p.y > bbox.max.y) {
    return { height: 0, center: position.clone() }
  }

  // Z slab
  if (Math.abs(d.z) > 1e-12) {
    const t1 = (bbox.min.z - p.z) / d.z
    const t2 = (bbox.max.z - p.z) / d.z
    tNear = Math.max(tNear, Math.min(t1, t2))
    tFar = Math.min(tFar, Math.max(t1, t2))
  } else if (p.z < bbox.min.z || p.z > bbox.max.z) {
    return { height: 0, center: position.clone() }
  }

  // Clamp: if position is inside or on boundary, tNear <= 0 <= tFar
  // Forward distance = tFar (exit point along +dir)
  // Backward distance = -tNear (exit point along -dir, i.e. behind us)
  const forwardDist = tFar > 0 ? tFar : 0
  const backwardDist = tNear < 0 ? -tNear : 0

  const height = forwardDist + backwardDist
  const center = position.clone()
    .add(dir.clone().multiplyScalar((forwardDist - backwardDist) / 2))

  return { height, center }
}

/**
 * Compute the blind-hole center: the hole entry is at the click point,
 * the hole extends inward by `depth`. The cylinder center is at
 * position + direction * (depth / 2).
 */
export function computeBlindHoleCenter(
  position: THREE.Vector3,
  direction: THREE.Vector3,
  depth: number,
): THREE.Vector3 {
  return position.clone().add(direction.clone().normalize().multiplyScalar(depth / 2))
}

/**
 * Orient and position a Z-up hole geometry (axial along Z) to world space.
 * Returns a new geometry with the transform baked in.
 */
export function positionHoleGeometry(
  geo: THREE.BufferGeometry,
  direction: THREE.Vector3,
  center: THREE.Vector3,
): THREE.BufferGeometry {
  const result = geo.clone()
  // Rotate Z axis to direction
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    direction.clone().normalize(),
  )
  result.applyQuaternion(quat)
  // Translate to center
  result.translate(center.x, center.y, center.z)
  return result
}

/**
 * Resolve the drill direction based on params.direction and the face normal.
 *
 * - 'normal': inward direction = negated face normal
 * - 'x'/'y'/'z': axis-aligned, flipped to point INTO the material
 *   (i.e. opposite to the face normal)
 */
export function resolveDrillDirection(
  direction: DrillDirection,
  faceNormal: THREE.Vector3,
): THREE.Vector3 {
  if (direction === 'normal') {
    return faceNormal.clone().negate().normalize()
  }

  // Axis-aligned direction
  const axisDir = new THREE.Vector3(
    direction === 'x' ? 1 : 0,
    direction === 'y' ? 1 : 0,
    direction === 'z' ? 1 : 0,
  )

  // Flip to point INTO the material (opposite to face normal)
  if (axisDir.dot(faceNormal) > 0) {
    axisDir.negate()
  }
  return axisDir
}

export async function executeDrillHole(
  targetMesh: THREE.Mesh,
  params: DrillHoleParams,
  position: THREE.Vector3,
  faceNormal: THREE.Vector3,
): Promise<THREE.BufferGeometry> {
  targetMesh.updateMatrixWorld()
  return executeDrillHoleOnGeometry(
    targetMesh.geometry,
    targetMesh.matrixWorld,
    params,
    position,
    faceNormal,
  )
}

/**
 * Core drill computation that accepts geometry + world matrix directly.
 *
 * This avoids the need to temporarily swap mesh.geometry when the mesh
 * currently has a preview geometry on it. Callers that have the G0 geometry
 * in a separate BufferGeometry can use this directly.
 */
export async function executeDrillHoleOnGeometry(
  sourceGeometry: THREE.BufferGeometry,
  worldMatrix: THREE.Matrix4,
  params: DrillHoleParams,
  position: THREE.Vector3,
  faceNormal: THREE.Vector3,
): Promise<THREE.BufferGeometry> {
  // 1. Compute drill direction based on params.direction
  const direction = resolveDrillDirection(params.direction, faceNormal)

  // 2. Compute bbox from the source geometry (in world space)
  sourceGeometry.computeBoundingBox()
  const bbox = sourceGeometry.boundingBox!.clone()
  bbox.applyMatrix4(worldMatrix)
  const bboxSize = bbox.getSize(new THREE.Vector3())
  const bboxMax = Math.max(bboxSize.x, bboxSize.y, bboxSize.z)

  // 3. Clamp depth to valid range: [0, bboxMax]
  const safeDepth = Math.max(0, Math.min(params.depth, bboxMax))

  // 4. Compute hole height and center
  let holeHeight: number
  let holeCenter: THREE.Vector3

  if (safeDepth === 0) {
    // Through hole: clip to bbox
    const dims = computeThroughHoleDimensions(position, direction, bbox)
    // Add epsilon on both ends for clean CSG cut
    holeHeight = dims.height + 0.2 // 0.1mm each side
    holeCenter = dims.center
  } else {
    // Blind hole
    holeHeight = safeDepth
    holeCenter = computeBlindHoleCenter(position, direction, safeDepth)

    // For screw with head: the geometry is centered at (height + headHeight)/2,
    // so the entry (-totalLength/2) must map to position.  Adjust holeCenter
    // by direction * headHeight/2 to compensate.
    if (params.holeType === 'screw' && params.screwHead !== 'none') {
      const spec = getScrewSpec(params.screwSystem, params.screwSpecIdx)
      const headHeight = spec.dia
      holeCenter.add(direction.clone().normalize().multiplyScalar(headHeight / 2))
    }
  }

  // 5. Build hole geometry (Z-up, centered on origin)
  const holeGeo = buildHoleGeometry(params, holeHeight)

  // 6. Position hole geometry to world space
  const holeGeoWorld = positionHoleGeometry(holeGeo, direction, holeCenter)

  // 7. Clone source geometry and transform to world space
  const targetGeo = sourceGeometry.clone()
  targetGeo.applyMatrix4(worldMatrix)

  // 8. Convert to ManifoldMeshData
  const targetManifold: ManifoldMeshData = geoToManifoldMesh(targetGeo)
  const holeManifold: ManifoldMeshData = geoToManifoldMesh(holeGeoWorld)

  // 9. Execute CSG subtract
  const result = await computeBoolean([targetManifold, holeManifold], 'subtract')

  // 10. Convert back to BufferGeometry
  const resultGeo = manifoldMeshToGeo(result)

  // 11. Transform back to mesh local space
  const invMatrix = new THREE.Matrix4().copy(worldMatrix).invert()
  resultGeo.applyMatrix4(invMatrix)

  // Derive creased normals on the committed result so sharp edges stay sharp
  // (the old computeVertexNormals() averaged on the welded shared-vertex
  // topology and rounded them off). toCreasedNormals transforms correctly with
  // applyMatrix4 above, but we re-derive to guarantee the final geometry uses
  // the unified creased-normal logic regardless of the manifold output topology.
  const finalGeo = deriveNormals(resultGeo)
  resultGeo.dispose()

  // 12. Cleanup
  holeGeo.dispose()
  holeGeoWorld.dispose()
  targetGeo.dispose()

  return finalGeo
}
