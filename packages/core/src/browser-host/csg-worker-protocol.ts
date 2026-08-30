/**
 * csg-worker 消息协议 — csg-worker.ts（Worker 侧）与 worker-csg-backend.ts（主线程侧）共享。
 *
 * 请求经 postMessage 结构化克隆传输；MeshData 的 Float32Array/Uint32Array 原样保持。
 * 每条请求带递增 id，响应以同一 id 关联（init 用 id 0）。
 */

import type { MeshData, PlaneParams, SplitResult } from '../cad-runtime/ports'

/** Worker init handshake request; carries the manifold.wasm URL. */
export interface CsgWorkerInitRequest {
  id: number
  kind: 'init'
  /** manifold.wasm URL (undefined lets the worker use default resolution). */
  wasmUrl?: string
}

/** CSG boolean operation request executed on the worker. */
export interface CsgWorkerBooleanRequest {
  id: number
  kind: 'boolean'
  op: 'union' | 'subtract' | 'intersect'
  meshes: MeshData[]
}

/** Plane split request executed on the worker. */
export interface CsgWorkerSplitPlaneRequest {
  id: number
  kind: 'splitPlane'
  mesh: MeshData
  plane: PlaneParams
}

/** Dovetail split request executed on the worker. */
export interface CsgWorkerSplitDovetailRequest {
  id: number
  kind: 'splitDovetail'
  mesh: MeshData
  params: {
    planeNormal: [number, number, number]
    planeOriginOffset: number
    planeCenter: [number, number, number]
    widthDir: [number, number, number]
    bboxWidthOnWidthDir: number
    groove: import('../cad-runtime/ports').DovetailGrooveParams
  }
}

/** Dowel split request executed on the worker. */
export interface CsgWorkerSplitDowelRequest {
  id: number
  kind: 'splitDowel'
  mesh: MeshData
  params: {
    planeNormal: [number, number, number]
    planeOriginOffset: number
    planeCenter: [number, number, number]
    widthDir: [number, number, number]
    dowel: import('../cad-runtime/ports').DowelSplitParams
    selectedSections?: number[] | null
  }
}

/** Straight tenon split request executed on the worker. */
export interface CsgWorkerSplitTenonRequest {
  id: number
  kind: 'splitStraightTenon'
  mesh: MeshData
  params: {
    planeNormal: [number, number, number]
    planeOriginOffset: number
    planeCenter: [number, number, number]
    widthDir: [number, number, number]
    tenon: import('../cad-runtime/ports').StraightTenonSplitParams
    selectedSections?: number[] | null
  }
}

/** Discriminated union of every request the CSG worker can receive. */
export type CsgWorkerRequest =
  | CsgWorkerInitRequest
  | CsgWorkerBooleanRequest
  | CsgWorkerSplitPlaneRequest
  | CsgWorkerSplitDovetailRequest
  | CsgWorkerSplitDowelRequest
  | CsgWorkerSplitTenonRequest

/** Discriminated union of every response the CSG worker can emit. */
export type CsgWorkerResponse =
  | { id: number; kind: 'init'; ok: true }
  | { id: number; kind: 'boolean'; ok: true; result: MeshData }
  | { id: number; kind: 'splitPlane'; ok: true; result: { front: MeshData; back: MeshData } }
  | { id: number; kind: 'splitDovetail' | 'splitDowel' | 'splitStraightTenon'; ok: true; result: SplitResult }
  | { id: number; kind: CsgWorkerRequest['kind']; ok: false; error: string }
