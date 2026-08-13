/**
 * InlineCsgBackend — 主线程直跑 CSG 后端（manifold-3d）
 *
 * 浏览器和 Node 环境均可使用（manifold-3d 在两个环境都可用）。
 *
 * 与 browser 端 WorkerCsgBackend 的区别：
 * - 不使用 Web Worker（?worker 语法在 Node 环境不可用）
 * - 直接在主线程调用 manifold-3d/manifoldCAD
 * - 性能权衡：阻塞主线程——CLI/CI 场景无 UI，可接受
 *
 * 正确性由"双后端一致性测试"保证：
 * 同一组 op 输入，Worker 后端与 Inline 后端的输出几何指纹必须一致。
 */

import type { CsgBackend, MeshData, PlaneParams, SplitResult } from '../cad-runtime/ports'
import {
  manifoldToMeshData,
  weldPositionsWorker,
  dovetailBooleanSplit,
  dowelOrTenonBooleanSplit,
} from '../boolean/csg-core'

type ManifoldMod = typeof import('manifold-3d/manifoldCAD')

let manifoldPromise: Promise<ManifoldMod> | null = null

async function getManifold(): Promise<ManifoldMod> {
  if (!manifoldPromise) {
    manifoldPromise = import('manifold-3d/manifoldCAD')
  }
  return manifoldPromise
}

/**
 * Build a Manifold from raw mesh data: weld → ofMesh.
 * Mirrors the logic in csg-worker.ts self.onmessage handler.
 */
async function meshToManifold(mesh: MeshData): Promise<import('manifold-3d/manifold').Manifold> {
  const { Manifold, Mesh } = await getManifold()
  const triCount = mesh.indices.length / 3
  const vertCount = mesh.positions.length / 3
  let positions = mesh.positions
  let indices = mesh.indices

  if (vertCount >= triCount * 3 * 0.9) {
    const welded = weldPositionsWorker(mesh.positions, mesh.indices, mesh.indices.length)
    positions = welded.positions
    indices = welded.indices
  }

  const m = new Mesh({
    numProp: 3,
    vertProperties: positions,
    triVerts: indices,
  })
  return Manifold.ofMesh(m)
}

export class InlineCsgBackend implements CsgBackend {
  async boolean(op: 'union' | 'subtract' | 'intersect', meshes: MeshData[]): Promise<MeshData> {
    const manifolds: import('manifold-3d/manifold').Manifold[] = []
    for (const m of meshes) {
      manifolds.push(await meshToManifold(m))
    }

    let result = manifolds[0]
    for (let i = 1; i < manifolds.length; i++) {
      switch (op) {
        case 'union':
          result = result.add(manifolds[i])
          break
        case 'subtract':
          result = result.subtract(manifolds[i])
          break
        case 'intersect':
          result = result.intersect(manifolds[i])
          break
      }
    }

    for (let i = 1; i < manifolds.length; i++) manifolds[i].delete()

    const meshData = manifoldToMeshData(result)
    result.delete()
    return meshData
  }

  async splitPlane(mesh: MeshData, plane: PlaneParams): Promise<{ front: MeshData; back: MeshData }> {
    const manifold = await meshToManifold(mesh)

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
    const { Manifold, Mesh } = await getManifold()
    const original = await meshToManifold(mesh)

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
    const { Manifold, Mesh } = await getManifold()
    const original = await meshToManifold(mesh)

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
    const { Manifold, Mesh } = await getManifold()
    const original = await meshToManifold(mesh)

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
