/**
 * csg-worker 消息协议 — csg-worker.ts（Worker 侧）与 worker-csg-backend.ts（主线程侧）共享。
 *
 * 请求经 postMessage 结构化克隆传输；MeshData 的 Float32Array/Uint32Array 原样保持。
 * 每条请求带递增 id，响应以同一 id 关联（init 用 id 0）。
 */

import type { MeshData, PlaneParams, SplitResult } from '../cad-runtime/ports'

export interface CsgWorkerInitRequest {
  id: number
  kind: 'init'
  /** manifold.wasm 地址（undefined 时 worker 用默认定位） */
  wasmUrl?: string
}

export interface CsgWorkerBooleanRequest {
  id: number
  kind: 'boolean'
  op: 'union' | 'subtract' | 'intersect'
  meshes: MeshData[]
}

export interface CsgWorkerSplitPlaneRequest {
  id: number
  kind: 'splitPlane'
  mesh: MeshData
  plane: PlaneParams
}

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

export type CsgWorkerRequest =
  | CsgWorkerInitRequest
  | CsgWorkerBooleanRequest
  | CsgWorkerSplitPlaneRequest
  | CsgWorkerSplitDovetailRequest
  | CsgWorkerSplitDowelRequest
  | CsgWorkerSplitTenonRequest

export type CsgWorkerResponse =
  | { id: number; kind: 'init'; ok: true }
  | { id: number; kind: 'boolean'; ok: true; result: MeshData }
  | { id: number; kind: 'splitPlane'; ok: true; result: { front: MeshData; back: MeshData } }
  | { id: number; kind: 'splitDovetail' | 'splitDowel' | 'splitStraightTenon'; ok: true; result: SplitResult }
  | { id: number; kind: CsgWorkerRequest['kind']; ok: false; error: string }
