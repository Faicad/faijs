/**
 * sdf-worker 消息协议 — sdf-worker.ts（Worker 侧）与 worker-sdf-backend.ts（主线程侧）共享。
 */

import type { MeshData } from '../cad-runtime/ports'

/** Worker init handshake request; carries the manifold.wasm URL. */
export interface SdfWorkerInitRequest {
  id: number
  kind: 'init'
  /** manifold.wasm URL (undefined lets the worker use default resolution). */
  wasmUrl?: string
}

/** SDF evaluation request executed on the worker. */
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

/** Discriminated union of every request the SDF worker can receive. */
export type SdfWorkerRequest = SdfWorkerInitRequest | SdfWorkerRunRequest

/** Discriminated union of every response the SDF worker can emit. */
export type SdfWorkerResponse =
  | { id: number; kind: 'init'; ok: true }
  | { id: number; kind: 'runSdf'; ok: true; result: MeshData }
  | { id: number; kind: SdfWorkerRequest['kind']; ok: false; error: string }
