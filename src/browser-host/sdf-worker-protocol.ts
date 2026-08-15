/**
 * sdf-worker 消息协议 — sdf-worker.ts（Worker 侧）与 worker-sdf-backend.ts（主线程侧）共享。
 */

import type { MeshData } from '../cad-runtime/ports'

export interface SdfWorkerInitRequest {
  id: number
  kind: 'init'
  /** manifold.wasm 地址（undefined 时 worker 用默认定位） */
  wasmUrl?: string
}

export interface SdfWorkerRunRequest {
  id: number
  kind: 'runSdf'
  code: string
  params: Record<string, number>
  bounds: [number, number, number, number, number, number]
  edgeLength: number
  level?: number
  tolerance?: number
}

export type SdfWorkerRequest = SdfWorkerInitRequest | SdfWorkerRunRequest

export type SdfWorkerResponse =
  | { id: number; kind: 'init'; ok: true }
  | { id: number; kind: 'runSdf'; ok: true; result: MeshData }
  | { id: number; kind: SdfWorkerRequest['kind']; ok: false; error: string }
