/**
 * mesh IO API — headless 文件加载
 *
 * 替代浏览器版的 io.ts（依赖 fileBlobStore / formatLoaders / model-store）。
 * 仅使用 THREE.js 的 loader（STLLoader / GLTFLoader）解析文件字节为 Shape。
 */

import * as THREE from 'three'
import { geoToManifoldMesh } from '../boolean/geo-convert'
import { mergeBufferGeometries } from '../primitives/mesh-primitives'
import type { Shape } from './types'

/**
 * 从文件字节加载几何（headless 版本）
 *
 * @param buffer 文件字节
 * @param format 格式标识（stl/glb/3mf 等）
 */
export async function importFile(
  buffer: ArrayBuffer,
  format?: string,
): Promise<Shape> {
  const fmt = (format ?? 'glb').toLowerCase()

  if (fmt === 'stl') {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
    const geo = new STLLoader().parse(buffer)
    return geoToManifoldMesh(geo)
  }

  if (fmt === 'glb' || fmt === 'gltf') {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const loader = new GLTFLoader()
    const gltf = await (loader as unknown as {
      parseAsync: (b: ArrayBuffer, p: string) => Promise<{ scene: THREE.Group }>
    }).parseAsync(buffer, '')
    const meshes: THREE.Mesh[] = []
    gltf.scene.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        meshes.push(child as THREE.Mesh)
      }
    })
    if (meshes.length === 0) {
      throw new Error('No meshes found in GLB file')
    }
    if (meshes.length === 1) {
      return geoToManifoldMesh(meshes[0].geometry)
    }
    const geos = meshes.map((m) => m.geometry)
    const merged = mergeBufferGeometries(geos)
    return geoToManifoldMesh(merged)
  }

  // For other formats, try STL as fallback
  try {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
    const geo = new STLLoader().parse(buffer)
    return geoToManifoldMesh(geo)
  } catch {
    throw new Error(`[mesh/io] unsupported format: ${fmt}`)
  }
}
