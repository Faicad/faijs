/**
 * stl-loader — minimal STL parser (binary + ASCII), zero addons.
 *
 * Why hand-written: three's `STLLoader` lives in `three/examples/jsm/`, which is
 * outside three's version-compatibility promise and would pull a second,
 * unpinnable module into every faijs consumer — including the weapp worker,
 * whose bundle must stay free of the addons. Precedent: `mesh/creased-normals.ts`
 * ports three's `toCreasedNormals` for exactly this reason.
 *
 * Output matches `STLLoader.parse()`: a non-indexed `BufferGeometry` carrying
 * `position` (one vertex triple per triangle, duplicates preserved) and `normal`
 * attributes, so callers can keep using `geoToManifoldMesh` for welding.
 */
import * as THREE from 'three'

/** Binary STL layout: 80-byte header + uint32 count + 50 bytes per triangle. */
const BINARY_HEADER_BYTES = 80
const BINARY_TRIANGLE_BYTES = 50

/**
 * Decide whether `buffer` is a binary STL by checking the declared triangle
 * count against the file size (the same test `STLLoader` uses).
 *
 * @param buffer - the raw file bytes.
 * @returns true when the buffer is binary STL.
 */
function isBinaryStl(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < BINARY_HEADER_BYTES + 4) return false
  const view = new DataView(buffer)
  const triangles = view.getUint32(BINARY_HEADER_BYTES, true)
  if (triangles === 0) return false
  return BINARY_HEADER_BYTES + 4 + triangles * BINARY_TRIANGLE_BYTES === buffer.byteLength
}

/** Normalize a triangle normal, falling back to the geometric one. */
function normalOf(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): [number, number, number] {
  const ux = bx - ax, uy = by - ay, uz = bz - az
  const vx = cx - ax, vy = cy - ay, vz = cz - az
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const len = Math.hypot(nx, ny, nz)
  if (len < 1e-20) return [0, 0, 0]
  return [nx / len, ny / len, nz / len]
}

function parseBinary(buffer: ArrayBuffer): THREE.BufferGeometry {
  const view = new DataView(buffer)
  const triangles = view.getUint32(BINARY_HEADER_BYTES, true)
  const positions = new Float32Array(triangles * 9)
  const normals = new Float32Array(triangles * 9)
  let offset = BINARY_HEADER_BYTES + 4
  for (let t = 0; t < triangles; t++) {
    // Stored facet normal — used when it is a usable unit vector.
    let nx = view.getFloat32(offset, true)
    let ny = view.getFloat32(offset + 4, true)
    let nz = view.getFloat32(offset + 8, true)
    const stored = Math.hypot(nx, ny, nz)
    offset += 12
    const base = t * 9
    for (let v = 0; v < 3; v++) {
      positions[base + v * 3] = view.getFloat32(offset, true)
      positions[base + v * 3 + 1] = view.getFloat32(offset + 4, true)
      positions[base + v * 3 + 2] = view.getFloat32(offset + 8, true)
      offset += 12
    }
    if (stored < 1e-20) {
      ;[nx, ny, nz] = normalOf(
        positions[base], positions[base + 1], positions[base + 2],
        positions[base + 3], positions[base + 4], positions[base + 5],
        positions[base + 6], positions[base + 7], positions[base + 8],
      )
    } else {
      nx /= stored; ny /= stored; nz /= stored
    }
    for (let v = 0; v < 3; v++) {
      normals[base + v * 3] = nx
      normals[base + v * 3 + 1] = ny
      normals[base + v * 3 + 2] = nz
    }
    offset += 2 // attribute byte count
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  return geo
}

function parseAscii(buffer: ArrayBuffer): THREE.BufferGeometry {
  const text = new TextDecoder().decode(new Uint8Array(buffer))
  const vertices: number[] = []
  const normals: number[] = []
  let facetNormal: [number, number, number] | null = null
  const pending: number[] = []

  const flush = (): void => {
    if (pending.length !== 9) return
    vertices.push(...pending)
    const n = facetNormal ?? normalOf(
      pending[0], pending[1], pending[2],
      pending[3], pending[4], pending[5],
      pending[6], pending[7], pending[8],
    )
    for (let v = 0; v < 3; v++) normals.push(n[0], n[1], n[2])
    pending.length = 0
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line.startsWith('facet normal')) {
      flush()
      const parts = line.split(/\s+/)
      facetNormal = [Number(parts[2]), Number(parts[3]), Number(parts[4])]
      continue
    }
    if (line.startsWith('vertex')) {
      const parts = line.split(/\s+/)
      pending.push(Number(parts[1]), Number(parts[2]), Number(parts[3]))
      continue
    }
    if (line.startsWith('endfacet')) {
      flush()
      facetNormal = null
    }
  }
  flush()

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3))
  return geo
}

/**
 * Parse STL bytes into a non-indexed BufferGeometry.
 *
 * @param buffer - the raw STL file bytes (binary or ASCII).
 * @returns the parsed geometry (empty when the file holds no triangle).
 * @throws when the buffer is neither a well-formed binary nor ASCII STL.
 */
export function parseStl(buffer: ArrayBuffer): THREE.BufferGeometry {
  if (buffer.byteLength === 0) {
    throw new Error('[mesh/stl-loader] empty STL buffer')
  }
  return isBinaryStl(buffer) ? parseBinary(buffer) : parseAscii(buffer)
}
