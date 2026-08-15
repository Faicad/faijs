/**
 * WorkerSdfBackend — 经 Web Worker 跑 SDF 后端（sdf-worker）
 *
 * 与 InlineSdfBackend 的行为一致（共用 sdf-core 的 runSdfInline），
 * 区别是 levelSet 计算在独立 Worker 线程执行，不阻塞 UI。
 */

import type { SdfBackend, MeshData } from '../cad-runtime/ports'
import type {
  SdfWorkerRequest,
  SdfWorkerResponse,
} from './sdf-worker-protocol'
import { getManifoldWasmUrl } from '../mesh/manifold-loader'

interface Pending {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
}

export class WorkerSdfBackend implements SdfBackend {
  private worker: Worker
  private nextId = 1
  private pending = new Map<number, Pending>()
  private initPromise: Promise<void>

  constructor() {
    this.worker = new Worker(new URL('./sdf-worker.js', import.meta.url), { type: 'module' })
    this.worker.onmessage = (ev: MessageEvent<SdfWorkerResponse>) => {
      const res = ev.data
      const pending = this.pending.get(res.id)
      if (!pending) return
      this.pending.delete(res.id)
      if (res.ok) {
        pending.resolve(res)
      } else {
        pending.reject(new Error(res.error))
      }
    }
    this.worker.onerror = (ev) => {
      const err = new Error(`SDF worker 错误：${ev.message || '未知错误'}`)
      for (const [, pending] of this.pending) pending.reject(err)
      this.pending.clear()
    }
    this.initPromise = this.post({ id: 0, kind: 'init', wasmUrl: getManifoldWasmUrl() })
      .then(() => undefined)
  }

  private post(req: SdfWorkerRequest): Promise<SdfWorkerResponse> {
    return new Promise<SdfWorkerResponse>((resolve, reject) => {
      this.pending.set(req.id, { resolve: resolve as Pending['resolve'], reject })
      this.worker.postMessage(req)
    })
  }

  async runSdf(
    code: string,
    params: Record<string, number>,
    bounds: [number, number, number, number, number, number],
    edgeLength: number,
    level: number = 0,
    tolerance: number = -1,
  ): Promise<MeshData> {
    await this.initPromise
    const res = await this.post({ id: this.nextId++, kind: 'runSdf', code, params, bounds, edgeLength, level, tolerance })
    if (!res.ok) throw new Error(res.error)
    return (res as Extract<SdfWorkerResponse, { kind: 'runSdf'; ok: true }>).result
  }

  /** 终止 worker（宿主生命周期管理用；terminate 后本实例不可再用） */
  terminate(): void {
    const err = new Error('SDF worker 已终止')
    for (const [, pending] of this.pending) pending.reject(err)
    this.pending.clear()
    this.worker.terminate()
  }
}
