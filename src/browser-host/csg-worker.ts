/**
 * csg-worker — CSG 计算 Worker 入口
 *
 * 主线程的 WorkerCsgBackend 把布尔/分割任务经 postMessage 发到这里执行，
 * 避免 manifold WASM 计算阻塞 UI 线程。
 *
 * 计算逻辑与 InlineCsgBackend 共用 csg-core 的同一套纯函数（构造器注入），
 * 双后端一致性由设计保证。
 *
 * 首次使用前必须先收到 init 消息（携带 wasm 地址），之后才处理计算任务。
 */

import { setManifoldWasmUrl, getManifoldModule } from '../mesh/manifold-loader'
import {
  manifoldToMeshData,
  meshToManifold,
  chainBoolean,
  dovetailBooleanSplit,
  dowelOrTenonBooleanSplit,
} from '../boolean/csg-core'
import type {
  CsgWorkerRequest,
  CsgWorkerResponse,
} from './csg-worker-protocol'
import type { MeshData } from '../cad-runtime/ports'

// tsconfig 用 DOM lib（无 WebWorker lib），这里显式声明 worker 侧的最小 API。
const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent) => void) | null
  postMessage(message: unknown): void
}

async function handleRequest(req: CsgWorkerRequest): Promise<CsgWorkerResponse> {
  switch (req.kind) {
    case 'init':
      if (req.wasmUrl) setManifoldWasmUrl(req.wasmUrl)
      return { id: req.id, kind: 'init', ok: true }

    case 'boolean': {
      const { Manifold, Mesh } = await getManifoldModule()
      const manifolds = req.meshes.map((m) => meshToManifold(Manifold, Mesh, m))
      const result = chainBoolean(req.op, manifolds)
      for (let i = 1; i < manifolds.length; i++) manifolds[i].delete()
      const resultData = manifoldToMeshData(result)
      result.delete()
      return { id: req.id, kind: 'boolean', ok: true, result: resultData }
    }

    case 'splitPlane': {
      const { Manifold, Mesh } = await getManifoldModule()
      const manifold = meshToManifold(Manifold, Mesh, req.mesh)
      const [frontM, backM] = manifold.splitByPlane(req.plane.normal, req.plane.offset)
      manifold.delete()
      const front = manifoldToMeshData(frontM)
      const back = manifoldToMeshData(backM)
      frontM.delete()
      backM.delete()
      return { id: req.id, kind: 'splitPlane', ok: true, result: { front, back } }
    }

    case 'splitDovetail': {
      const { Manifold, Mesh } = await getManifoldModule()
      const original = meshToManifold(Manifold, Mesh, req.mesh)
      const [upper, lower, wedgeData] = dovetailBooleanSplit(
        Manifold, Mesh,
        original,
        req.params.planeNormal,
        req.params.planeOriginOffset,
        req.params.planeCenter,
        req.params.widthDir,
        req.params.bboxWidthOnWidthDir,
        req.params.groove,
      )
      const result = toSplitResult(upper, lower, wedgeData)
      return { id: req.id, kind: 'splitDovetail', ok: true, result }
    }

    case 'splitDowel': {
      const { Manifold, Mesh } = await getManifoldModule()
      const original = meshToManifold(Manifold, Mesh, req.mesh)
      const [upper, lower, shapeData] = dowelOrTenonBooleanSplit(
        Manifold, Mesh,
        original,
        req.params.planeNormal,
        req.params.planeOriginOffset,
        req.params.planeCenter,
        req.params.widthDir,
        'dowel',
        {
          size: req.params.dowel.diameter,
          sizeTolerance: req.params.dowel.diameterTolerance,
          height: req.params.dowel.height,
          heightTolerance: req.params.dowel.heightTolerance,
        },
        false,
        req.params.selectedSections,
      )
      const result = toSplitResult(upper, lower, shapeData)
      return { id: req.id, kind: 'splitDowel', ok: true, result }
    }

    case 'splitStraightTenon': {
      const { Manifold, Mesh } = await getManifoldModule()
      const original = meshToManifold(Manifold, Mesh, req.mesh)
      const [upper, lower, shapeData] = dowelOrTenonBooleanSplit(
        Manifold, Mesh,
        original,
        req.params.planeNormal,
        req.params.planeOriginOffset,
        req.params.planeCenter,
        req.params.widthDir,
        'tenon',
        {
          size: req.params.tenon.sideLength,
          sizeTolerance: req.params.tenon.sideLengthTolerance,
          height: req.params.tenon.height,
          heightTolerance: req.params.tenon.heightTolerance,
        },
        false,
        req.params.selectedSections,
      )
      const result = toSplitResult(upper, lower, shapeData)
      return { id: req.id, kind: 'splitStraightTenon', ok: true, result }
    }
  }
}

function toSplitResult(
  upper: import('manifold-3d/manifold').Manifold,
  lower: import('manifold-3d/manifold').Manifold,
  shapeData: MeshData | null,
): { front: MeshData; back: MeshData; wedge: MeshData | null } {
  const front = manifoldToMeshData(upper)
  const back = manifoldToMeshData(lower)
  upper.delete()
  lower.delete()
  return {
    front,
    back,
    wedge: shapeData ? { positions: shapeData.positions, indices: shapeData.indices } : null,
  }
}

ctx.onmessage = (ev: MessageEvent) => {
  const req = ev.data as CsgWorkerRequest
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
