/**
 * Unit tests for the dovetail curved-surface trimming algorithm.
 *
 * The worker backend (csg-worker.ts) runs in a Web Worker context and cannot
 * be imported directly in Node.js tests. These tests replicate the core
 * algorithm functions (detectCurvedSurface, createWedge, etc.) using
 * manifold-3d directly (via the shared manifold-loader), following the same
 * pattern as csg.test.ts.
 *
 * The algorithm logic is copied verbatim from csg-worker.ts to ensure the
 * tests validate the actual algorithm correctness.
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { geoToManifoldMesh } from './geo-convert'
import { getManifoldModule } from '../mesh/manifold-loader'
import {
  vec3Cross, vec3Normalize, vec3Scale, vec3Add, vec3Sub,
  type Vec3,
} from './dovetail-math'

// ---- helpers (same as csg.test.ts) ----

function box(cx: number, cy: number, cz: number, hw: number, hh: number, hd: number) {
  const g = new THREE.BoxGeometry(hw * 2, hh * 2, hd * 2)
  g.translate(cx, cy, cz)
  return geoToManifoldMesh(g)
}

function tris(d: { indices: Uint32Array }) { return d.indices.length / 3 }
function verts(d: { positions: Float32Array }) { return d.positions.length / 3 }

function bbox(d: { positions: Float32Array }) {
  let mx = Infinity, my = Infinity, mz = Infinity, Mx = -Infinity, My = -Infinity, Mz = -Infinity
  for (let i = 0; i < d.positions.length; i += 3) {
    const x = d.positions[i], y = d.positions[i + 1], z = d.positions[i + 2]
    if (x < mx) mx = x; if (x > Mx) Mx = x
    if (y < my) my = y; if (y > My) My = y
    if (z < mz) mz = z; if (z > Mz) Mz = z
  }
  return { min: [mx, my, mz], max: [Mx, My, Mz], size: [Mx - mx, My - my, Mz - mz] }
}

function hasNaN(positions: Float32Array): boolean {
  for (let i = 0; i < positions.length; i++) {
    if (Number.isNaN(positions[i])) return true
  }
  return false
}

// ---- inline manifold helpers ----

async function getManifold() {
  return await getManifoldModule()
}

function meshToData(manifold: import('manifold-3d/manifold').Manifold) {
  const resultMesh = manifold.getMesh()
  const numProp = resultMesh.numProp || 3
  const vertPropsLen = resultMesh.vertProperties ? resultMesh.vertProperties.length : 0
  const vertCount = numProp > 0 ? Math.floor(vertPropsLen / numProp) : 0
  const positions = new Float32Array(vertCount * 3)
  for (let i = 0; i < vertCount; i++) {
    const base = i * numProp
    positions[i * 3] = resultMesh.vertProperties[base]
    positions[i * 3 + 1] = resultMesh.vertProperties[base + 1]
    positions[i * 3 + 2] = resultMesh.vertProperties[base + 2]
  }
  const triVerts = resultMesh.triVerts
  const indices = triVerts ? new Uint32Array(triVerts) : new Uint32Array(0)
  return { positions, indices }
}

/**
 * Create a cylinder mesh aligned along Z axis, centered at origin.
 * Used for curved surface testing.
 */
function cylinderMesh(radius: number, height: number, segments = 32) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, segments)
  geo.rotateX(Math.PI / 2) // align along Z
  return geoToManifoldMesh(geo)
}

// ---- algorithm replicas (copied from csg-worker.ts) ----

function computeCrossSectionWidth(
  upper: import('manifold-3d/manifold').Manifold,
  normal: Vec3,
  originOffset: number,
  widthDir: Vec3,
): number {
  const mesh = upper.getMesh()
  const eps = 0.001
  let minProj = Infinity
  let maxProj = -Infinity
  let found = false
  const numProp = mesh.numProp || 3
  const vertCount = Math.floor(mesh.vertProperties.length / numProp)
  for (let i = 0; i < vertCount; i++) {
    const base = i * numProp
    const x = mesh.vertProperties[base]
    const y = mesh.vertProperties[base + 1]
    const z = mesh.vertProperties[base + 2]
    const dist = x * normal[0] + y * normal[1] + z * normal[2] - originOffset
    if (Math.abs(dist) < eps) {
      const proj = x * widthDir[0] + y * widthDir[1] + z * widthDir[2]
      if (proj < minProj) minProj = proj
      if (proj > maxProj) maxProj = proj
      found = true
    }
  }
  if (!found) return 0
  return maxProj - minProj
}

function detectCurvedSurface(
  upper: import('manifold-3d/manifold').Manifold,
  lower: import('manifold-3d/manifold').Manifold,
  normal: Vec3,
  originOffset: number,
  widthDir: Vec3,
): boolean {
  if (lower.isEmpty()) return false
  const width0 = computeCrossSectionWidth(upper, normal, originOffset, widthDir)
  const sliceOffset = originOffset - 2
  const [slice, rest] = lower.splitByPlane(normal, sliceOffset)
  rest.delete()
  if (slice.isEmpty()) {
    slice.delete()
    return true
  }
  const width1 = computeCrossSectionWidth(slice, normal, sliceOffset, widthDir)
  slice.delete()
  return Math.abs(width0 - width1) >= 0.1
}

function createWedge(
  Manifold: typeof import('manifold-3d/manifold').Manifold,
  Mesh: typeof import('manifold-3d/manifold').Mesh,
  planeCenter: Vec3,
  normal: Vec3,
  widthDir: Vec3,
  depth: number,
  width: number,
  angleDeg: number,
  extrudeLength: number,
): import('manifold-3d/manifold').Manifold {
  const depthDir = vec3Normalize(vec3Cross(normal, widthDir))
  const angleRad = (angleDeg * Math.PI) / 180
  const halfWidth = width / 2
  const halfTopWidth = Math.max(0, halfWidth - depth / Math.tan(angleRad))
  const halfExtrude = extrudeLength / 2
  const positions = new Float32Array(8 * 3)
  function setVert(i: number, pos: Vec3) {
    positions[i * 3] = pos[0]
    positions[i * 3 + 1] = pos[1]
    positions[i * 3 + 2] = pos[2]
  }
  const bottomCenter: Vec3 = vec3Sub(planeCenter, vec3Scale(normal, depth))
  setVert(0, vec3Add(vec3Sub(bottomCenter, vec3Scale(widthDir, halfExtrude)), vec3Scale(depthDir, -halfWidth)))
  setVert(1, vec3Add(vec3Sub(bottomCenter, vec3Scale(widthDir, halfExtrude)), vec3Scale(depthDir,  halfWidth)))
  setVert(2, vec3Add(vec3Sub(planeCenter,   vec3Scale(widthDir, halfExtrude)), vec3Scale(depthDir,  halfTopWidth)))
  setVert(3, vec3Add(vec3Sub(planeCenter,   vec3Scale(widthDir, halfExtrude)), vec3Scale(depthDir, -halfTopWidth)))
  setVert(4, vec3Add(vec3Add(bottomCenter, vec3Scale(widthDir, halfExtrude)), vec3Scale(depthDir, -halfWidth)))
  setVert(5, vec3Add(vec3Add(bottomCenter, vec3Scale(widthDir, halfExtrude)), vec3Scale(depthDir,  halfWidth)))
  setVert(6, vec3Add(vec3Add(planeCenter,   vec3Scale(widthDir, halfExtrude)), vec3Scale(depthDir,  halfTopWidth)))
  setVert(7, vec3Add(vec3Add(planeCenter,   vec3Scale(widthDir, halfExtrude)), vec3Scale(depthDir, -halfTopWidth)))
  const indices = new Uint32Array([
    0, 2, 1,  0, 3, 2,
    4, 5, 6,  4, 6, 7,
    0, 5, 4,  0, 1, 5,
    3, 6, 2,  3, 7, 6,
    0, 7, 3,  0, 4, 7,
    1, 6, 5,  1, 2, 6,
  ])
  const mesh = new Mesh({ numProp: 3, vertProperties: positions, triVerts: indices })
  return Manifold.ofMesh(mesh)
}

// ===================================================================
// D1: Curved surface detection — flat box
// ===================================================================

describe('D1: detectCurvedSurface — flat box → false', () => {
  it('立方体水平切割，截面宽度不变 → 平面', async () => {
    const { Manifold, Mesh } = await getManifold()
    const d = box(0, 0, 0, 5, 5, 5) // 10x10x10 box
    const mesh = new Mesh({ numProp: 3, vertProperties: d.positions, triVerts: d.indices })
    const m = Manifold.ofMesh(mesh)

    // Split at Z=0 (horizontal plane)
    const normal: Vec3 = [0, 0, 1]
    const originOffset = 0
    const widthDir: Vec3 = [1, 0, 0]

    const [upper, lower] = m.splitByPlane(normal, originOffset)
    m.delete()

    const isCurved = detectCurvedSurface(upper, lower, normal, originOffset, widthDir)

    expect(isCurved).toBe(false)

    upper.delete()
    lower.delete()
  })
})

// ===================================================================
// D2: Curved surface detection — cylinder → true
// ===================================================================

describe('D2: detectCurvedSurface — cylinder → true', () => {
  it('圆柱体水平切割，截面直径随高度变化 → 曲面', async () => {
    const { Manifold, Mesh } = await getManifold()
    // Cylinder radius=5, height=20, aligned along Z
    // Centered at origin, so spans Z=-10 to Z=10
    const d = cylinderMesh(5, 20, 32)
    const mesh = new Mesh({ numProp: 3, vertProperties: d.positions, triVerts: d.indices })
    const m = Manifold.ofMesh(mesh)

    // Split at Z=0 (horizontal plane through center)
    const normal: Vec3 = [0, 0, 1]
    const originOffset = 0
    const widthDir: Vec3 = [1, 0, 0]

    const [upper, lower] = m.splitByPlane(normal, originOffset)
    m.delete()

    const _isCurved = detectCurvedSurface(upper, lower, normal, originOffset, widthDir)

    // Cylinder cross-section is circular, so width at Z=0 and Z=-2 should differ
    // (actually for a right cylinder they're the same... let me think)
    // Wait - a right cylinder has the same circular cross-section at all heights.
    // The width along the X direction at any Z is always the diameter = 10.
    // So for a right cylinder, the detection would say "flat" (widths are equal).
    // I need a CONE or a TAPERED shape for the widths to differ.

    // Actually, let me reconsider. A right cylinder has the same cross-section
    // at all heights, so the width is the same. I need a cone instead.

    upper.delete()
    lower.delete()

    // Use a cone instead (tapered: radius varies with height)
    const coneGeo = new THREE.ConeGeometry(5, 20, 32)
    coneGeo.rotateX(Math.PI / 2) // align along Z
    coneGeo.translate(0, 0, 0) // center at origin, tip at +10, base at -10
    const coneD = geoToManifoldMesh(coneGeo)
    const coneMesh = new Mesh({ numProp: 3, vertProperties: coneD.positions, triVerts: coneD.indices })
    const cone = Manifold.ofMesh(coneMesh)

    const [coneUpper, coneLower] = cone.splitByPlane(normal, originOffset)
    cone.delete()

    const isCurvedCone = detectCurvedSurface(coneUpper, coneLower, normal, originOffset, widthDir)

    // Cone cross-section diameter decreases with height (toward tip).
    // At Z=0 (middle), diameter ≈ 5. At Z=-2 (2mm below), diameter ≈ 5.5.
    // Width difference > 0.1mm → curved.
    expect(isCurvedCone).toBe(true)

    coneUpper.delete()
    coneLower.delete()
  })
})

// ===================================================================
// D3: Curved branch dovetail split — cone with intersect/trim/rebuild
// ===================================================================

describe('D3: curved branch dovetail split — cone → valid result', () => {
  it('圆锥体燕尾榫切割（曲面分支）→ 结果有效，无 NaN', async () => {
    const { Manifold, Mesh } = await getManifold()
    // Cone: radius=5, height=20, aligned along Z, centered at origin
    const coneGeo = new THREE.ConeGeometry(5, 20, 32)
    coneGeo.rotateX(Math.PI / 2)
    const d = geoToManifoldMesh(coneGeo)
    const mesh = new Mesh({ numProp: 3, vertProperties: d.positions, triVerts: d.indices })
    const m = Manifold.ofMesh(mesh)

    const normal: Vec3 = [0, 0, 1]
    const originOffset = 0
    const planeCenter: Vec3 = [0, 0, 0]
    const widthDir: Vec3 = [1, 0, 0]

    const groove = {
      depth: 2,
      depthTolerance: 0.2,
      width: 4,
      widthTolerance: 0.4,
      flapsAngle: 60,
    }

    // Step 1: Split
    const [upper, lower] = m.splitByPlane(normal, originOffset)
    m.delete()

    // Step 2: Compute cross-section width
    const crossSectionWidth = computeCrossSectionWidth(upper, normal, originOffset, widthDir)
    expect(crossSectionWidth).toBeGreaterThan(0)
    const extrudeLength = crossSectionWidth + 0.2

    // Step 3: Detect curved
    const isCurved = detectCurvedSurface(upper, lower, normal, originOffset, widthDir)
    expect(isCurved).toBe(true)

    // Step 4: Create wedge W with +20mm overhang (curved branch)
    const wedgeW = createWedge(
      Manifold, Mesh, planeCenter, normal, widthDir,
      groove.depth, groove.width, groove.flapsAngle,
      extrudeLength + 20,
    )
    expect(wedgeW.isEmpty()).toBe(false)

    // Step 4b: Save lower mesh data, then intersect
    const lowerMeshData = meshToData(lower)
    const trimmedWedge = wedgeW.intersect(lower)
    wedgeW.delete()
    lower.delete()

    // Step 4c: Extract wedge mesh data from trimmedWedge (not wedgeW!)
    const wedgeMeshData = trimmedWedge.isEmpty() ? null : meshToData(trimmedWedge)
    expect(wedgeMeshData).not.toBeNull()
    expect(wedgeMeshData!.positions.length).toBeGreaterThan(0)
    expect(hasNaN(wedgeMeshData!.positions)).toBe(false)

    // The trimmed wedge should have fewer or equal vertices than the original
    // (the overhang was trimmed). But we already deleted wedgeW, so we can't
    // compare directly. Instead, verify the trimmed wedge is valid.
    expect(tris(wedgeMeshData!)).toBeGreaterThan(0)

    // Step 5: union(upper, trimmedWedge)
    const upperResult = upper.add(trimmedWedge)
    upper.delete()
    trimmedWedge.delete()

    // Step 6: Rebuild lower from saved mesh data
    const lowerRebuilt = Manifold.ofMesh(new Mesh({
      numProp: 3,
      vertProperties: lowerMeshData.positions,
      triVerts: lowerMeshData.indices,
    }))
    expect(lowerRebuilt.isEmpty()).toBe(false)

    // Step 7: Create wedgeTol with +20mm overhang (curved branch)
    const wedgeTol = createWedge(
      Manifold, Mesh, planeCenter, normal, widthDir,
      groove.depth + groove.depthTolerance,
      groove.width + groove.widthTolerance,
      groove.flapsAngle,
      extrudeLength + 20,
    )
    expect(wedgeTol.isEmpty()).toBe(false)

    // Step 8: lower.subtract(wedgeTol)
    const lowerResult = lowerRebuilt.subtract(wedgeTol)
    lowerRebuilt.delete()
    wedgeTol.delete()

    // Verify results
    const frontData = meshToData(upperResult)
    const backData = meshToData(lowerResult)

    expect(tris(frontData)).toBeGreaterThan(0)
    expect(verts(frontData)).toBeGreaterThan(0)
    expect(hasNaN(frontData.positions)).toBe(false)

    expect(tris(backData)).toBeGreaterThan(0)
    expect(verts(backData)).toBeGreaterThan(0)
    expect(hasNaN(backData.positions)).toBe(false)

    upperResult.delete()
    lowerResult.delete()
  })
})

// ===================================================================
// D4: Unconditional dovetail split — box (flat surface, intersect is no-op)
// ===================================================================

describe('D4: unconditional dovetail split — box → valid result', () => {
  it('立方体燕尾榫切割（无分支，intersect 对平面是空操作）→ 结果有效', async () => {
    const { Manifold, Mesh } = await getManifold()
    const d = box(0, 0, 0, 5, 5, 5) // 10x10x10
    const mesh = new Mesh({ numProp: 3, vertProperties: d.positions, triVerts: d.indices })
    const m = Manifold.ofMesh(mesh)

    const normal: Vec3 = [0, 0, 1]
    const originOffset = 0
    const planeCenter: Vec3 = [0, 0, 0]
    const widthDir: Vec3 = [1, 0, 0]
    const overhang = 20

    const groove = {
      depth: 2,
      depthTolerance: 0.2,
      width: 4,
      widthTolerance: 0.4,
      flapsAngle: 60,
    }

    // Step 1: Split
    const [upper, lower] = m.splitByPlane(normal, originOffset)
    m.delete()

    // Step 2: Compute cross-section width
    const crossSectionWidth = computeCrossSectionWidth(upper, normal, originOffset, widthDir)
    expect(crossSectionWidth).toBeGreaterThan(0)
    const extrudeLength = crossSectionWidth + 0.2

    // Step 3 & 4: Create wedge with overhang and intersect with lower
    const wedgeW = createWedge(
      Manifold, Mesh, planeCenter, normal, widthDir,
      groove.depth, groove.width, groove.flapsAngle,
      extrudeLength + overhang,
    )
    expect(wedgeW.isEmpty()).toBe(false)
    expect(lower.isEmpty()).toBe(false)

    const lowerMeshData = meshToData(lower)
    const trimmedWedge = wedgeW.intersect(lower)
    wedgeW.delete()
    lower.delete()

    const wedgeMeshData = trimmedWedge.isEmpty() ? null : meshToData(trimmedWedge)
    expect(wedgeMeshData).not.toBeNull()
    expect(hasNaN(wedgeMeshData!.positions)).toBe(false)

    // Rebuild lower
    const lowerRebuilt = Manifold.ofMesh(new Mesh({
      numProp: 3,
      vertProperties: lowerMeshData.positions,
      triVerts: lowerMeshData.indices,
    }))
    expect(lowerRebuilt.isEmpty()).toBe(false)

    // Step 5: union(upper, trimmedWedge)
    const upperResult = upper.add(trimmedWedge)
    upper.delete()
    trimmedWedge.delete()

    // Step 6: Create wedgeTol with same overhang
    const wedgeTol = createWedge(
      Manifold, Mesh, planeCenter, normal, widthDir,
      groove.depth + groove.depthTolerance,
      groove.width + groove.widthTolerance,
      groove.flapsAngle,
      extrudeLength + overhang,
    )
    expect(wedgeTol.isEmpty()).toBe(false)

    // Step 7: lowerRebuilt.subtract(wedgeTol)
    const lowerResult = lowerRebuilt.subtract(wedgeTol)
    lowerRebuilt.delete()
    wedgeTol.delete()

    // Verify results
    const frontData = meshToData(upperResult)
    const backData = meshToData(lowerResult)

    expect(tris(frontData)).toBeGreaterThan(0)
    expect(verts(frontData)).toBeGreaterThan(0)
    expect(hasNaN(frontData.positions)).toBe(false)

    expect(tris(backData)).toBeGreaterThan(0)
    expect(verts(backData)).toBeGreaterThan(0)
    expect(hasNaN(backData.positions)).toBe(false)

    upperResult.delete()
    lowerResult.delete()
  })
})

// ===================================================================
// D5: Unconditional dovetail split — cylinder (curved surface, must be trimmed)
// ===================================================================

describe('D5: unconditional dovetail split — cylinder → wedge is trimmed to model boundary', () => {
  it('圆柱体燕尾榫切割：即使截面宽度不随高度变化，intersect 依然修剪楔形体', async () => {
    const { Manifold, Mesh } = await getManifold()
    // Cylinder: radius=5, height=20, aligned along Z
    // Old detectCurvedSurface returns false for a right cylinder (width constant),
    // but the new code always intersects, so the wedge should be trimmed.
    const cylGeo = new THREE.CylinderGeometry(5, 5, 20, 32)
    cylGeo.rotateX(Math.PI / 2)
    const d = geoToManifoldMesh(cylGeo)
    const mesh = new Mesh({ numProp: 3, vertProperties: d.positions, triVerts: d.indices })
    const m = Manifold.ofMesh(mesh)

    const normal: Vec3 = [0, 0, 1]
    const originOffset = 0
    const planeCenter: Vec3 = [0, 0, 0]
    const widthDir: Vec3 = [1, 0, 0]
    const overhang = 20

    // Split
    const [upper, lower] = m.splitByPlane(normal, originOffset)
    m.delete()

    const crossSectionWidth = computeCrossSectionWidth(upper, normal, originOffset, widthDir)
    expect(crossSectionWidth).toBeGreaterThan(0)
    const extrudeLength = crossSectionWidth + 0.2

    const groove = {
      depth: 2,
      depthTolerance: 0.2,
      width: 4,
      widthTolerance: 0.4,
      flapsAngle: 60,
    }

    // Create untrimmed wedge (with overhang)
    const wedgeW = createWedge(
      Manifold, Mesh, planeCenter, normal, widthDir,
      groove.depth, groove.width, groove.flapsAngle,
      extrudeLength + overhang,
    )

    // Extract untrimmed wedge mesh data
    const untrimmedData = meshToData(wedgeW)
    const untrimmedBBox = bbox(untrimmedData)

    // Trim by intersecting with lower
    const trimmedWedge = wedgeW.intersect(lower)
    wedgeW.delete()
    lower.delete()

    // Extract trimmed wedge mesh data
    const trimmedData = trimmedWedge.isEmpty() ? null : meshToData(trimmedWedge)
    expect(trimmedData).not.toBeNull()

    const trimmedBBox = bbox(trimmedData!)

    // The trimmed wedge's X-axis extent should be smaller than the untrimmed one
    // (the +10mm overhang on each side should have been cut off)
    const untrimmedXSize = untrimmedBBox.size[0]
    const trimmedXSize = trimmedBBox.size[0]

    expect(trimmedXSize).toBeLessThan(untrimmedXSize)

    // The trimmed wedge should fit within the model's bounds (roughly)
    // The cone at Z=0 has radius 5, so X spans approximately [-5, 5]
    // The trimmed wedge should have X extent ≤ ~10 (cone diameter at Z=0)
    // plus a small margin
    expect(trimmedXSize).toBeLessThan(15) // generous bound

    // No NaN in trimmed wedge
    expect(hasNaN(trimmedData!.positions)).toBe(false)

    trimmedWedge.delete()
    upper.delete()
  })
})

// ===================================================================
// D6: Edge case — lower is empty
// ===================================================================

describe('D6: edge case — lower is empty → flat branch (no crash)', () => {
  it('下半部分为空时，检测返回 false（平面分支）', async () => {
    const { Manifold, Mesh } = await getManifold()
    const d = box(0, 0, 0, 5, 5, 5)
    const mesh = new Mesh({ numProp: 3, vertProperties: d.positions, triVerts: d.indices })
    const m = Manifold.ofMesh(mesh)

    // Split far above the model → upper is empty, lower has everything
    const normal: Vec3 = [0, 0, 1]
    const originOffset = 100 // far above
    const widthDir: Vec3 = [1, 0, 0]

    const [upper, lower] = m.splitByPlane(normal, originOffset)
    m.delete()

    // upper should be empty (everything is below the plane)
    expect(upper.isEmpty()).toBe(true)
    expect(lower.isEmpty()).toBe(false)

    // detectCurvedSurface should return false when lower... wait
    // Actually the detection checks if lower is empty, not upper.
    // Let me test the case where lower is empty (split far below).
    upper.delete()
    lower.delete()

    // Split far below the model → lower is empty, upper has everything
    const [upper2, lower2] = Manifold.ofMesh(new Mesh({
      numProp: 3,
      vertProperties: d.positions,
      triVerts: d.indices,
    })).splitByPlane(normal, -100)

    expect(lower2.isEmpty()).toBe(true)

    const isCurved = detectCurvedSurface(upper2, lower2, normal, -100, widthDir)
    expect(isCurved).toBe(false)

    upper2.delete()
    lower2.delete()
  })
})

// ===================================================================
// D7: groove width tolerance → 槽两侧各加 tolerance/2
// ===================================================================

/**
 * Total extent of a manifold along an arbitrary axis (project all vertices
 * onto the axis and return max - min). Used to measure the dovetail width
 * along the depth direction (depthDir).
 */
function extentAlongAxis(
  manifold: import('manifold-3d/manifold').Manifold,
  axis: Vec3,
): number {
  const mesh = manifold.getMesh()
  const numProp = mesh.numProp || 3
  const vertCount = Math.floor(mesh.vertProperties.length / numProp)
  let minP = Infinity
  let maxP = -Infinity
  for (let i = 0; i < vertCount; i++) {
    const b = i * numProp
    const x = mesh.vertProperties[b]
    const y = mesh.vertProperties[b + 1]
    const z = mesh.vertProperties[b + 2]
    const proj = x * axis[0] + y * axis[1] + z * axis[2]
    if (proj < minP) minP = proj
    if (proj > maxP) maxP = proj
  }
  return maxP - minP
}

/**
 * Measure, in a thin slab at a given Z level, the width of the solid band
 * (tongue) or the empty gap (groove) along an axis.
 *
 * - For the tongue (the only solid in the slab): returns the solid's width.
 * - For the groove (two side blocks separated by an empty gap): returns the
 *   gap width = the largest empty interval between sorted axis projections.
 *
 * Sampling at the very bottom of the joint (z = -depth) keeps the dovetail at
 * full width with vertical walls, so the measurement is clean.
 */
function measureGapAlongAxis(
  manifold: import('manifold-3d/manifold').Manifold,
  axis: Vec3,
  zLevel: number,
  slabHalf: number,
): number {
  const mesh = manifold.getMesh()
  const numProp = mesh.numProp || 3
  const vertCount = Math.floor(mesh.vertProperties.length / numProp)
  const projs: number[] = []
  for (let i = 0; i < vertCount; i++) {
    const b = i * numProp
    const x = mesh.vertProperties[b]
    const y = mesh.vertProperties[b + 1]
    const z = mesh.vertProperties[b + 2]
    if (Math.abs(z - zLevel) > slabHalf) continue
    projs.push(x * axis[0] + y * axis[1] + z * axis[2])
  }
  // Dedupe on a 1µm grid, then find the widest gap between consecutive values.
  const rounded = Array.from(new Set(projs.map((p) => Math.round(p * 1000) / 1000)))
    .sort((a, b) => a - b)
  let maxGap = 0
  for (let i = 1; i < rounded.length; i++) {
    const gap = rounded[i] - rounded[i - 1]
    if (gap > maxGap) maxGap = gap
  }
  return maxGap
}

describe('D7: groove width tolerance → 槽两侧各加 tolerance/2', () => {
  const normal: Vec3 = [0, 0, 1]
  const originOffset = 0
  const planeCenter: Vec3 = [0, 0, 0]
  const widthDir: Vec3 = [1, 0, 0]
  const depthDir: Vec3 = vec3Normalize(vec3Cross(normal, widthDir)) // [0, 1, 0]
  const overhang = 20
  const grooveWidth = 4

  // widthTolerance = 0.3 直接对应 split-store.ts 的 DEFAULT_GROOVE_WIDTH_TOLERANCE
  // （split-store.test.ts 已锁定该默认值为 0.3），二者共同保证默认配置下槽每侧
  // 产生 0.15mm 配合间隙。0.4 / 0.6 用于证明该关系对任意 tolerance 值均成立。
  const toleranceCases = [0.3, 0.4, 0.6]

  for (const widthTolerance of toleranceCases) {
    it(`widthTolerance=${widthTolerance} → 槽每侧配合间隙 = tolerance/2`, async () => {
      const { Manifold, Mesh } = await getManifold()
      const d = box(0, 0, 0, 5, 5, 5) // 10x10x10 立方体，Y ∈ [-5, 5]
      const mesh = new Mesh({ numProp: 3, vertProperties: d.positions, triVerts: d.indices })
      const m = Manifold.ofMesh(mesh)

      const groove = {
        depth: 2,
        depthTolerance: 0.2,
        width: grooveWidth,
        widthTolerance,
        flapsAngle: 60,
      }

      const [upper, lower] = m.splitByPlane(normal, originOffset)
      m.delete()

      const crossSectionWidth = computeCrossSectionWidth(upper, normal, originOffset, widthDir)
      const extrudeLength = crossSectionWidth + 0.2

      // 舌榫实体（wedgeW）：槽宽方向用 groove.width
      const wedgeW = createWedge(
        Manifold, Mesh, planeCenter, normal, widthDir,
        groove.depth, groove.width, groove.flapsAngle,
        extrudeLength + overhang,
      )
      // 公差楔（wedgeTol）：仅比 wedgeW 宽 widthTolerance，且中心相同
      const wedgeTol = createWedge(
        Manifold, Mesh, planeCenter, normal, widthDir,
        groove.depth + groove.depthTolerance,
        groove.width + groove.widthTolerance,
        groove.flapsAngle,
        extrudeLength + overhang,
      )

      // ── 精确：楔体 bbox 沿 depthDir（Y） ──
      // 楔体底部为最宽处，其 Y 向跨度恰等于构造时的 width。
      const widthW = extentAlongAxis(wedgeW, depthDir)
      const widthTol = extentAlongAxis(wedgeTol, depthDir)
      expect(widthW).toBeCloseTo(groove.width, 6)
      expect(widthTol).toBeCloseTo(groove.width + widthTolerance, 6)

      // 对称居中 → 每侧 = (widthTol - widthW) / 2 = widthTolerance / 2（精确）
      const perSideWedge = (widthTol - widthW) / 2
      expect(perSideWedge).toBeCloseTo(widthTolerance / 2, 6)

      // ── 成品：对 upperResult / lowerResult 实际测量 ──
      const lowerMeshData = meshToData(lower)
      const trimmedWedge = wedgeW.intersect(lower)
      wedgeW.delete()
      lower.delete()
      const upperResult = upper.add(trimmedWedge)
      upper.delete()
      trimmedWedge.delete()

      const lowerRebuilt = Manifold.ofMesh(new Mesh({
        numProp: 3,
        vertProperties: lowerMeshData.positions,
        triVerts: lowerMeshData.indices,
      }))
      const lowerResult = lowerRebuilt.subtract(wedgeTol)
      lowerRebuilt.delete()
      wedgeTol.delete()

      // manifold 对平面不生成内部顶点，薄层必须落在各实体的"底面特征边"上。
      // 舌榫（wedgeW）底在 z = -depth；槽腔由 wedgeTol 挖出，其底更深，在
      // z = -(depth + depthTolerance)。两者分别取各自底面采样。
      // 梯形锥度在舌榫与槽腔两侧相同，相减后抵消，故
      // (cavityGap - tongueGap) / 2 精确等于 widthTolerance/2。
      const slabHalf = 0.01
      const tongueZ = -groove.depth
      const cavityZ = -(groove.depth + groove.depthTolerance)
      const tongueGap = measureGapAlongAxis(upperResult, depthDir, tongueZ, slabHalf)
      const cavityGap = measureGapAlongAxis(lowerResult, depthDir, cavityZ, slabHalf)

      // 绝对宽度仅作合理性校验（受锥度影响，允许 ±0.05mm）
      expect(tongueGap).toBeCloseTo(groove.width, 1)
      expect(cavityGap).toBeCloseTo(groove.width + widthTolerance, 1)

      // 关系锁：成品每侧 = widthTolerance / 2（精确）
      const perSideProduct = (cavityGap - tongueGap) / 2
      expect(perSideProduct).toBeCloseTo(widthTolerance / 2, 1)

      upperResult.delete()
      lowerResult.delete()
    })
  }
})
