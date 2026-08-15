/**
 * sdf-worker — SDF 计算 Worker 入口
 *
 * 主线程的 WorkerSdfBackend 把 SDF 求值任务经 postMessage 发到这里执行，
 * 避免 levelSet 计算阻塞 UI 线程。
 *
 * 计算逻辑与 InlineSdfBackend 共用 sdf-core 的 runSdfInline。
 *
 * 首次使用前必须先收到 init 消息（携带 wasm 地址），之后才处理计算任务。
 */

import { setManifoldWasmUrl, getManifoldModule } from '../mesh/manifold-loader'
import { runSdfInline } from '../sdf/sdf-core'
import type {
  SdfWorkerRequest,
  SdfWorkerResponse,
} from './sdf-worker-protocol'

// tsconfig 用 DOM lib（无 WebWorker lib），这里显式声明 worker 侧的最小 API。
const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent) => void) | null
  postMessage(message: unknown): void
}

async function handleRequest(req: SdfWorkerRequest): Promise<SdfWorkerResponse> {
  switch (req.kind) {
    case 'init':
      if (req.wasmUrl) setManifoldWasmUrl(req.wasmUrl)
      return { id: req.id, kind: 'init', ok: true }

    case 'runSdf': {
      const { Manifold } = await getManifoldModule()
      const result = await runSdfInline(
        Manifold,
        req.code,
        req.params,
        req.bounds,
        req.edgeLength,
        req.level ?? 0,
        req.tolerance ?? -1,
      )
      return { id: req.id, kind: 'runSdf', ok: true, result }
    }
  }
}

ctx.onmessage = (ev: MessageEvent) => {
  const req = ev.data as SdfWorkerRequest
  handleRequest(req).then(
    (res) => ctx.postMessage(res),
    (err: unknown) => {
      ctx.postMessage({
        id: req.id,
        kind: req.kind,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    },
  )
}
