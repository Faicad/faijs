/**
 * InlineCsgBackend — 主线程直跑 CSG 后端（manifold-3d）
 *
 * 浏览器和 Node 环境均可使用（manifold-3d 在两个环境都可用）。
 *
 * 与 browser 端 WorkerCsgBackend 的区别：
 * - 不使用 Web Worker（Node 环境没有浏览器 Worker API）
 * - 直接在主线程调用 manifold-3d 核心模块（经 manifold-loader）
 * - 性能权衡：阻塞主线程——CLI/CI 场景无 UI，可接受
 *
 * 正确性由"双后端一致性"保证：Inline 与 Worker 后端共用 csg-core 的
 * 同一套纯函数（构造器注入），两边调用路径一致。
 */

import type { CsgBackend, MeshData, PlaneParams, SplitResult } from '../cad-runtime/ports'
import {
  manifoldToMeshData,
  meshToManifold,
  chainBoolean,
  dovetailBooleanSplit,
  dowelOrTenonBooleanSplit,
} from '../boolean/csg-core'
import { getManifoldModule } from '../mesh/manifold-loader'

/**
 * Build a Manifold from raw mesh data: weld → ofMesh.
 * 与 WorkerCsgBackend 走同一实现（csg-core.meshToManifold）。
 */
async function toManifold(mesh: MeshData): Promise<import('manifold-3d/manifold').Manifold> {
  const { Manifold, Mesh } = await getManifoldModule()
  return meshToManifold(Manifold, Mesh, mesh)
}

/**
 * InlineCsgBackend is a CSG backend that runs manifold-3d on the main thread.
 *
 * It is usable in both browser and Node environments (manifold-3d works in
 * both). Unlike the WorkerCsgBackend it spawns no Web Worker and instead calls
 * the manifold-3d core directly through the manifold-loader, blocking the main
 * thread — acceptable for CLI/CI scenarios without a UI. Correctness is
 * guaranteed by sharing the same pure functions from csg-core as the worker
 * backend.
 */
export class InlineCsgBackend implements CsgBackend {
  async boolean(op: 'union' | 'subtract' | 'intersect', meshes: MeshData[]): Promise<MeshData> {
    const manifolds: import('manifold-3d/manifold').Manifold[] = []
    for (const m of meshes) {
      manifolds.push(await toManifold(m))
    }

    const result = chainBoolean(op, manifolds)

    for (let i = 1; i < manifolds.length; i++) manifolds[i].delete()

    const meshData = manifoldToMeshData(result)
    result.delete()
    return meshData
  }

  async splitPlane(mesh: MeshData, plane: PlaneParams): Promise<{ front: MeshData; back: MeshData }> {
    const manifold = await toManifold(mesh)

    const [frontM, backM] = manifold.splitByPlane(plane.normal, plane.offset)
    manifold.delete()

    const front = manifoldToMeshData(frontM)
    const back = manifoldToMeshData(backM)
    frontM.delete()
    backM.delete()

    return { front, back }
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
    const { Manifold, Mesh } = await getManifoldModule()
    const original = await toManifold(mesh)

    const [upperManifold, lowerManifold, wedgeMeshData] = dovetailBooleanSplit(
      Manifold, Mesh,
      original,
      params.planeNormal,
      params.planeOriginOffset,
      params.planeCenter,
      params.widthDir,
      params.bboxWidthOnWidthDir,
      params.groove,
    )

    const front = manifoldToMeshData(upperManifold)
    const back = manifoldToMeshData(lowerManifold)
    upperManifold.delete()
    lowerManifold.delete()

    return {
      front,
      back,
      wedge: wedgeMeshData ? { positions: wedgeMeshData.positions, indices: wedgeMeshData.indices } : null,
    }
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
    const { Manifold, Mesh } = await getManifoldModule()
    const original = await toManifold(mesh)

    const [upperManifold, lowerManifold, shapeMeshData] = dowelOrTenonBooleanSplit(
      Manifold, Mesh,
      original,
      params.planeNormal,
      params.planeOriginOffset,
      params.planeCenter,
      params.widthDir,
      'dowel',
      {
        size: params.dowel.diameter,
        sizeTolerance: params.dowel.diameterTolerance,
        height: params.dowel.height,
        heightTolerance: params.dowel.heightTolerance,
      },
      false,
      params.selectedSections,
    )

    const front = manifoldToMeshData(upperManifold)
    const back = manifoldToMeshData(lowerManifold)
    upperManifold.delete()
    lowerManifold.delete()

    return {
      front,
      back,
      wedge: shapeMeshData ? { positions: shapeMeshData.positions, indices: shapeMeshData.indices } : null,
    }
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
    const { Manifold, Mesh } = await getManifoldModule()
    const original = await toManifold(mesh)

    const [upperManifold, lowerManifold, shapeMeshData] = dowelOrTenonBooleanSplit(
      Manifold, Mesh,
      original,
      params.planeNormal,
      params.planeOriginOffset,
      params.planeCenter,
      params.widthDir,
      'tenon',
      {
        size: params.tenon.sideLength,
        sizeTolerance: params.tenon.sideLengthTolerance,
        height: params.tenon.height,
        heightTolerance: params.tenon.heightTolerance,
      },
      false,
      params.selectedSections,
    )

    const front = manifoldToMeshData(upperManifold)
    const back = manifoldToMeshData(lowerManifold)
    upperManifold.delete()
    lowerManifold.delete()

    return {
      front,
      back,
      wedge: shapeMeshData ? { positions: shapeMeshData.positions, indices: shapeMeshData.indices } : null,
    }
  }
}
