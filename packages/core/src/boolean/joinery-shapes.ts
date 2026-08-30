/**
 * Joinery shape construction — pure geometry functions shared by:
 * - Main thread (split preview): builds THREE.BufferGeometry from {positions, indices}
 * - Worker (csg-worker.ts): wraps with Manifold.ofMesh for CSG operations
 *
 * Extracted from csg-worker.ts createWedge / createDowel / createStraightTenon.
 * The construction logic is identical — only the Manifold.ofMesh wrapper is removed.
 *
 * These functions do NOT depend on THREE.js, Manifold, or `self`.
 * They return plain { positions: Float32Array, indices: Uint32Array }.
 */
import {
  vec3Cross, vec3Normalize, vec3Scale, vec3Add, vec3Sub,
  type Vec3,
} from './dovetail-math'

/** Interchange joinery mesh representation: interleaved positions with triangle indices. */
export interface JoineryMeshData {
  positions: Float32Array
  indices: Uint32Array
}

// ── Wedge (trapezoidal prism) ──

/**
 * Build wedge (trapezoidal prism) vertex/index data.
 *
 * The wedge cross-section is a trapezoid in the normal-depthDir plane:
 *
 * ```
 *          ↑ cutting plane (top edge, narrower)
 *     ┌──────┐
 *    /        \       ↑
 *   / θ      θ \      │ depth
 *  └────────────┘     │
 *   ←── width ──→    (bottom edge, wider, at -depth from cutting plane)
 * ```
 *
 * Extrusion is along widthDir, centered at planeCenter.
 *
 * @param planeCenter   Center of the cutting plane
 * @param normal        Cutting plane normal (unit vector, points "up")
 * @param widthDir      Extrusion direction (unit vector)
 * @param depth         Trapezoid height (mm), bottom edge is this far below the cutting plane
 * @param width         Bottom edge length (mm)
 * @param angleDeg      Angle between bottom edge and slanted side (degrees)
 * @param extrudeLength Total extrusion length along widthDir (mm)
 * @returns the wedge mesh data (positions and triangle indices).
 */
export function buildWedgeGeometry(
  planeCenter: Vec3,
  normal: Vec3,
  widthDir: Vec3,
  depth: number,
  width: number,
  angleDeg: number,
  extrudeLength: number,
): JoineryMeshData {
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

  // Front face (X = -halfExtrude along widthDir)
  setVert(0, vec3Add(vec3Sub(bottomCenter, vec3Scale(widthDir, halfExtrude)), vec3Scale(depthDir, -halfWidth)))  // bottomLeft
  setVert(1, vec3Add(vec3Sub(bottomCenter, vec3Scale(widthDir, halfExtrude)), vec3Scale(depthDir,  halfWidth)))  // bottomRight
  setVert(2, vec3Add(vec3Sub(planeCenter,   vec3Scale(widthDir, halfExtrude)), vec3Scale(depthDir,  halfTopWidth))) // topRight
  setVert(3, vec3Add(vec3Sub(planeCenter,   vec3Scale(widthDir, halfExtrude)), vec3Scale(depthDir, -halfTopWidth))) // topLeft

  // Back face (X = +halfExtrude along widthDir)
  setVert(4, vec3Add(vec3Add(bottomCenter, vec3Scale(widthDir, halfExtrude)), vec3Scale(depthDir, -halfWidth)))  // bottomLeft
  setVert(5, vec3Add(vec3Add(bottomCenter, vec3Scale(widthDir, halfExtrude)), vec3Scale(depthDir,  halfWidth)))  // bottomRight
  setVert(6, vec3Add(vec3Add(planeCenter,   vec3Scale(widthDir, halfExtrude)), vec3Scale(depthDir,  halfTopWidth))) // topRight
  setVert(7, vec3Add(vec3Add(planeCenter,   vec3Scale(widthDir, halfExtrude)), vec3Scale(depthDir, -halfTopWidth))) // topLeft

  // 12 triangles (36 indices), all counterclockwise when viewed from outside
  const indices = new Uint32Array([
    // Front face (outward = -widthDir)
    0, 2, 1,  0, 3, 2,
    // Back face (outward = +widthDir)
    4, 5, 6,  4, 6, 7,
    // Bottom face (outward = -normal)
    0, 5, 4,  0, 1, 5,
    // Top face (outward = +normal)
    3, 6, 2,  3, 7, 6,
    // Left face (outward = -depthDir)
    0, 7, 3,  0, 4, 7,
    // Right face (outward = +depthDir)
    1, 6, 5,  1, 2, 6,
  ])

  return { positions, indices }
}

// ── Dowel (cylinder) ──

/**
 * Build cylindrical vertex/index data for the dowel tenon.
 *
 * The circle is in the widthDir-depthDir plane, centered at `centroid`.
 * The cylinder extends from the cutting plane downward by `height` along `-normal`.
 *
 * @param centroid   Center of the cylinder
 * @param normal     Cutting plane normal (unit vector, points "up")
 * @param widthDir   Width direction in the cutting plane (unit vector)
 * @param depthDir   Depth direction in the cutting plane (unit vector)
 * @param diameter   Cylinder diameter (mm)
 * @param height     Cylinder height (mm), extends along -normal
 * @param segments   Number of circular segments (default 32)
 * @returns the cylindrical mesh data (positions and triangle indices).
 */
export function buildDowelGeometry(
  centroid: Vec3,
  normal: Vec3,
  widthDir: Vec3,
  depthDir: Vec3,
  diameter: number,
  height: number,
  segments: number = 32,
): JoineryMeshData {
  const radius = diameter / 2
  const vertCount = segments * 2 + 2
  const positions = new Float32Array(vertCount * 3)

  function setVert(i: number, pos: Vec3) {
    positions[i * 3] = pos[0]
    positions[i * 3 + 1] = pos[1]
    positions[i * 3 + 2] = pos[2]
  }

  const bottomCenter: Vec3 = vec3Sub(centroid, vec3Scale(normal, height))

  // Top circle (0..segments-1): at cutting plane
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments
    const lx = radius * Math.cos(angle)
    const ly = radius * Math.sin(angle)
    setVert(i, vec3Add(centroid,
      vec3Add(vec3Scale(widthDir, lx), vec3Scale(depthDir, ly))))
  }

  // Bottom circle (segments..2*segments-1): height below cutting plane
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments
    const lx = radius * Math.cos(angle)
    const ly = radius * Math.sin(angle)
    setVert(segments + i, vec3Add(bottomCenter,
      vec3Add(vec3Scale(widthDir, lx), vec3Scale(depthDir, ly))))
  }

  // Center vertices for caps
  setVert(2 * segments, centroid)        // top center
  setVert(2 * segments + 1, bottomCenter) // bottom center

  // Build triangle indices
  const triCount = segments * 4
  const indices = new Uint32Array(triCount * 3)

  let idx = 0
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments
    // Side face
    indices[idx++] = i
    indices[idx++] = segments + next
    indices[idx++] = next

    indices[idx++] = i
    indices[idx++] = segments + i
    indices[idx++] = segments + next

    // Top cap
    indices[idx++] = 2 * segments
    indices[idx++] = i
    indices[idx++] = next

    // Bottom cap
    indices[idx++] = 2 * segments + 1
    indices[idx++] = segments + next
    indices[idx++] = segments + i
  }

  return { positions, indices }
}

// ── Straight tenon (box) ──

/**
 * Build box-shaped vertex/index data for the straight tenon.
 *
 * The square cross-section is in the widthDir-depthDir plane,
 * centered at `centroid`. The box extends from the cutting plane
 * downward by `height` along `-normal`.
 *
 * @param centroid    Center of the box
 * @param normal      Cutting plane normal (unit vector, points "up")
 * @param widthDir    Width direction in the cutting plane (unit vector)
 * @param depthDir    Depth direction in the cutting plane (unit vector)
 * @param sideLength  Square side length (mm)
 * @param height      Box height (mm), extends along -normal
 * @returns the box mesh data (positions and triangle indices).
 */
export function buildStraightTenonGeometry(
  centroid: Vec3,
  normal: Vec3,
  widthDir: Vec3,
  depthDir: Vec3,
  sideLength: number,
  height: number,
): JoineryMeshData {
  const half = sideLength / 2
  const positions = new Float32Array(8 * 3)

  function setVert(i: number, pos: Vec3) {
    positions[i * 3] = pos[0]
    positions[i * 3 + 1] = pos[1]
    positions[i * 3 + 2] = pos[2]
  }

  const hw = vec3Scale(widthDir, half)
  const hd = vec3Scale(depthDir, half)
  const hn = vec3Scale(normal, height)

  // Top face (at cutting plane): centroid ± hw ± hd
  const t0: Vec3 = vec3Sub(vec3Sub(centroid, hw), hd)  // front-left
  const t1: Vec3 = vec3Add(vec3Sub(centroid, hw), hd)  // front-right
  const t2: Vec3 = vec3Add(vec3Add(centroid, hw), hd)  // back-right
  const t3: Vec3 = vec3Sub(vec3Add(centroid, hw), hd)  // back-left

  setVert(0, t0)
  setVert(1, t1)
  setVert(2, t2)
  setVert(3, t3)

  // Bottom face (height below): top - hn
  setVert(4, vec3Sub(t0, hn))
  setVert(5, vec3Sub(t1, hn))
  setVert(6, vec3Sub(t2, hn))
  setVert(7, vec3Sub(t3, hn))

  // 12 triangles (36 indices)
  const indices = new Uint32Array([
    // Top face (outward = +normal)
    0, 2, 1,  0, 3, 2,
    // Bottom face (outward = -normal)
    4, 5, 6,  4, 6, 7,
    // Side faces
    // Front (outward = -widthDir)
    0, 1, 5,  0, 5, 4,
    // Right (outward = +depthDir)
    1, 2, 6,  1, 6, 5,
    // Back (outward = +widthDir)
    2, 3, 7,  2, 7, 6,
    // Left (outward = -depthDir)
    3, 0, 4,  3, 4, 7,
  ])

  return { positions, indices }
}
