/**
 * Build vertex adjacency tables from the selector proxy's edge geometry.
 *
 * The vertex table itself is derived by `extractVerticesFromEdges` (no
 * producer emits a dedicated vertexPositions buffer). This module walks the
 * same edge index buffer with the same tolerance and the same first-seen
 * ordering, so the vertex row numbers it derives are identical to the rows
 * built by `buildSelectorRuntimeData` — the two stay consistent by sharing
 * the extraction algorithm, not by carrying a second data source.
 *
 * An edge's polyline contributes ALL of its referenced positions (not just
 * the geometric endpoints): multi-segment edges (e.g. circles) have interior
 * polyline vertices in the vertex table, and those vertices belong to that
 * edge just as much as the endpoints do.
 *
 * Pure function: no Three.js dependency, no side effects.
 */

import type { EdgeRow, SelectorProxy, VertexAdjacency } from './types'

/**
 * Derive the position-key → vertex-row map using the exact traversal of
 * `extractVerticesFromEdges` (same tolerance, same first-seen ordering).
 *
 * @param edgePositions - vertex positions referenced by edgeIndices.
 * @param edgeIndices - index pairs defining each edge segment.
 * @param tolerance - spatial tolerance used to deduplicate by position.
 * @returns position key → vertex table row index.
 */
function buildPositionKeyToRow(
  edgePositions: Float32Array,
  edgeIndices: Uint32Array,
  tolerance: number,
): Map<string, number> {
  const keyToIndex = new Map<string, number>()
  const round = (v: number) => Math.round(v / tolerance) * tolerance

  for (let i = 0; i < edgeIndices.length; i++) {
    const vi = edgeIndices[i] * 3
    if (vi + 2 >= edgePositions.length) continue
    const key = `${round(edgePositions[vi])},${round(edgePositions[vi + 1])},${round(edgePositions[vi + 2])}`
    if (!keyToIndex.has(key)) {
      keyToIndex.set(key, keyToIndex.size)
    }
  }
  return keyToIndex
}

/**
 * Build vertex → edge / face adjacency tables.
 *
 * vertexToEdgeRows[v] lists every edge row whose polyline references vertex
 * row v. vertexToFaceRows[v] is the deduplicated union of the face rows
 * incident to those edges (via EdgeRow.faceStart/faceCount + proxy.edgeFaceRows).
 *
 * @param proxy - the selector proxy with edge geometry and edge→face relations.
 * @param edges - the edge table rows (faceStart/faceCount already sequentialized).
 * @param tolerance - spatial tolerance, must match the vertex extraction (default 1e-6).
 * @returns the adjacency tables; empty arrays when there is no edge geometry.
 */
export function buildVertexAdjacency(
  proxy: SelectorProxy,
  edges: readonly EdgeRow[],
  tolerance: number = 1e-6,
): VertexAdjacency {
  const { edgePositions, edgeIndices, edgeFaceRows } = proxy

  if (edgePositions.length === 0 || edgeIndices.length === 0) {
    return { vertexToEdgeRows: [], vertexToFaceRows: [] }
  }

  const keyToRow = buildPositionKeyToRow(edgePositions, edgeIndices, tolerance)
  const vertexCount = keyToRow.size
  if (vertexCount === 0) {
    return { vertexToEdgeRows: [], vertexToFaceRows: [] }
  }

  const round = (v: number) => Math.round(v / tolerance) * tolerance
  const rowOf = (index: number): number | undefined => {
    const vi = index * 3
    if (vi + 2 >= edgePositions.length) return undefined
    const key = `${round(edgePositions[vi])},${round(edgePositions[vi + 1])},${round(edgePositions[vi + 2])}`
    return keyToRow.get(key)
  }

  // vertex row → set of edge rows (dedup via Set, sorted at the end)
  const edgeSets: Set<number>[] = Array.from({ length: vertexCount }, () => new Set<number>())

  const segmentTotal = Math.floor(edgeIndices.length / 2)
  for (let e = 0; e < edges.length; e++) {
    const segStart = typeof edges[e].segmentStart === 'number' ? (edges[e].segmentStart as number) : 0
    const segCount = typeof edges[e].segmentCount === 'number' ? (edges[e].segmentCount as number) : 1
    const segEnd = Math.min(segStart + segCount, segmentTotal)
    for (let s = segStart; s < segEnd; s++) {
      for (let k = 0; k < 2; k++) {
        const vRow = rowOf(edgeIndices[s * 2 + k])
        if (vRow !== undefined) edgeSets[vRow].add(e)
      }
    }
  }

  const vertexToEdgeRows: number[][] = edgeSets.map((set) => [...set].sort((a, b) => a - b))

  // vertex row → deduplicated union of incident face rows
  const vertexToFaceRows: number[][] = []
  for (let v = 0; v < vertexCount; v++) {
    const faceSet = new Set<number>()
    for (const e of edgeSets[v]) {
      const faceStart = typeof edges[e].faceStart === 'number' ? (edges[e].faceStart as number) : 0
      const faceCount = typeof edges[e].faceCount === 'number' ? (edges[e].faceCount as number) : 0
      const faceEnd = Math.min(faceStart + faceCount, edgeFaceRows.length)
      for (let i = faceStart; i < faceEnd; i++) {
        faceSet.add(Number(edgeFaceRows[i]))
      }
    }
    vertexToFaceRows.push([...faceSet].sort((a, b) => a - b))
  }

  return { vertexToEdgeRows, vertexToFaceRows }
}