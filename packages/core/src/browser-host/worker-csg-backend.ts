/**
 * WorkerCsgBackend — 经 Web Worker 跑 CSG 后端（csg-worker）
 *
 * 与 InlineCsgBackend 的行为一致（共用 csg-core 同一套纯函数），
 * 区别是 manifold WASM 计算在独立 Worker 线程执行，不阻塞 UI。
 *
 * 构造时即向 worker 发送 init 握手（携带 wasm 地址，取自 manifold-loader 的
 * setManifoldWasmUrl 配置），后续每个 op 自动等待握手完成。
 */

import type { CsgBackend, MeshData, PlaneParams, SplitResult } from '../cad-runtime/ports'
import type {
  CsgWorkerRequest,
  CsgWorkerResponse,
} from './csg-worker-protocol'
import { getManifoldWasmUrl } from '../mesh/manifold-loader'

interface Pending {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
}

/**
 * WorkerCsgBackend is a CSG backend that runs manifold-3d in a Web Worker.
 *
 * It behaves identically to the InlineCsgBackend (both share the same pure
 * functions from csg-core), except that the manifold WASM computation happens
 * on a dedicated worker thread so the UI is not blocked. The constructor sends
 * the init handshake carrying the worker's wasm URL immediately (read from the
 * manifold-loader configuration); every subsequent operation awaits that
 * handshake.
 */
export class WorkerCsgBackend implements CsgBackend {
  private worker: Worker
  private nextId = 1
  private pending = new Map<number, Pending>()
  private initPromise: Promise<void>

  constructor() {
    this.worker = new Worker(new URL('./csg-worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (ev: MessageEvent<CsgWorkerResponse>) => {
      this.handleMessage(ev.data)
    }
    this.worker.onerror = (ev) => {
      const err = new Error(`CSG worker 错误：${ev.message || '未知错误'}`)
      this.rejectAll(err)
    }
    this.initPromise = this.post({ id: 0, kind: 'init', wasmUrl: getManifoldWasmUrl() })
      .then(() => undefined)
  }

  private handleMessage(res: CsgWorkerResponse): void {
    const pending = this.pending.get(res.id)
    if (!pending) return
    this.pending.delete(res.id)
    if (res.ok) {
      pending.resolve(res)
    } else {
      pending.reject(new Error(res.error))
    }
  }

  private rejectAll(err: Error): void {
    for (const [, pending] of this.pending) pending.reject(err)
    this.pending.clear()
  }

  private post(req: CsgWorkerRequest): Promise<CsgWorkerResponse> {
    return new Promise<CsgWorkerResponse>((resolve, reject) => {
      this.pending.set(req.id, { resolve: resolve as Pending['resolve'], reject })
      this.worker.postMessage(req)
    })
  }

  private async call<T extends CsgWorkerResponse>(
    makeReq: (id: number) => CsgWorkerRequest,
  ): Promise<T> {
    await this.initPromise
    const res = (await this.post(makeReq(this.nextId++))) as T
    return res
  }

  async boolean(op: 'union' | 'subtract' | 'intersect', meshes: MeshData[]): Promise<MeshData> {
    const res = await this.call<Extract<CsgWorkerResponse, { kind: 'boolean'; ok: true }>>(
      (id) => ({ id, kind: 'boolean', op, meshes }),
    )
    return res.result
  }

  async splitPlane(
    mesh: MeshData,
    plane: PlaneParams,
  ): Promise<{ front: MeshData; back: MeshData }> {
    const res = await this.call<Extract<CsgWorkerResponse, { kind: 'splitPlane'; ok: true }>>(
      (id) => ({ id, kind: 'splitPlane', mesh, plane }),
    )
    return res.result
  }

  async splitDovetail(
    mesh: MeshData,
    params: {
      planeNormal: [number, number, number]
      planeOriginOffset: number
      planeCenter: [number, number, number]
      widthDir: [number, number, number]
      bboxWidthOnWidthDir: number
      groove: import('../cad-runtime/ports').DovetailGrooveParams
    },
  ): Promise<SplitResult> {
    const res = await this.call<
      Extract<CsgWorkerResponse, { kind: 'splitDovetail' | 'splitDowel' | 'splitStraightTenon'; ok: true }>
    >(
      (id) => ({ id, kind: 'splitDovetail', mesh, params }),
    )
    return res.result
  }

  async splitDowel(
    mesh: MeshData,
    params: {
      planeNormal: [number, number, number]
      planeOriginOffset: number
      planeCenter: [number, number, number]
      widthDir: [number, number, number]
      dowel: import('../cad-runtime/ports').DowelSplitParams
      selectedSections?: number[] | null
    },
  ): Promise<SplitResult> {
    const res = await this.call<
      Extract<CsgWorkerResponse, { kind: 'splitDovetail' | 'splitDowel' | 'splitStraightTenon'; ok: true }>
    >(
      (id) => ({ id, kind: 'splitDowel', mesh, params }),
    )
    return res.result
  }

  async splitStraightTenon(
    mesh: MeshData,
    params: {
      planeNormal: [number, number, number]
      planeOriginOffset: number
      planeCenter: [number, number, number]
      widthDir: [number, number, number]
      tenon: import('../cad-runtime/ports').StraightTenonSplitParams
      selectedSections?: number[] | null
    },
  ): Promise<SplitResult> {
    const res = await this.call<
      Extract<CsgWorkerResponse, { kind: 'splitDovetail' | 'splitDowel' | 'splitStraightTenon'; ok: true }>
    >(
      (id) => ({ id, kind: 'splitStraightTenon', mesh, params }),
    )
    return res.result
  }

  /** 终止 worker（宿主生命周期管理用；terminate 后本实例不可再用） */
  terminate(): void {
    this.rejectAll(new Error('CSG worker 已终止'))
    this.worker.terminate()
  }
}
