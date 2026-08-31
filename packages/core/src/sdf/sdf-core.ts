/**
 * sdf-core — SDF 纯计算函数（从 sdf-worker.ts 提取）
 *
 *
 * 这些函数不依赖 Worker 环境（无 self.onmessage / postMessage），
 * 可被 WorkerSdfBackend（经 sdf-worker.ts）和 InlineSdfBackend（主线程直跑）共用。
 *
 * 依赖：manifold-3d 核心模块（Manifold.levelSet）
 */

import type { Manifold as ManifoldInstance } from 'manifold-3d/manifold'
import { manifoldToMeshData } from '../boolean/csg-core'

/** A compiled signed distance field function evaluating at a 3D point. */
export type SdfFn = (x: number, y: number, z: number) => number

/**
 * Compile user-supplied code by injecting params as function arguments and
 * returning the `sdf` function it defines.
 *
 * @param code - the user code containing the `sdf` function.
 * @param params - parameter name → value map injected as function arguments.
 * @returns the compiled sdf function.
 */
export function compileSdf(code: string, params: Record<string, number>): SdfFn {
  const paramNames = Object.keys(params)
  const paramValues = Object.values(params)
  const fn = new Function(
    ...paramNames,
    `${code}
     if (typeof sdf !== 'function') throw new Error('未找到 sdf 函数，请定义 function sdf(x, y, z) { ... }');
     return sdf;`,
  )
  return fn(...paramValues) as SdfFn
}

/**
 * Try to compile and invoke the user-defined `bounds()` function; returns null
 * if no bounds function is present or it cannot be evaluated.
 *
 * @param code - the user code containing the optional `bounds` function.
 * @param params - parameter name → value map injected as function arguments.
 * @returns the resolved bounds box, or null if unavailable.
 */
export function tryCompileBounds(
  code: string,
  params: Record<string, number>,
): { min: [number, number, number]; max: [number, number, number] } | null {
  try {
    const paramNames = Object.keys(params)
    const paramValues = Object.values(params)
    const fn = new Function(
      ...paramNames,
      `${code}
       return (typeof bounds === 'function') ? bounds : null;`,
    )
    const boundsFn = fn(...paramValues)
    if (!boundsFn) return null
    const b = boundsFn()
    if (!b || !Array.isArray(b.min) || !Array.isArray(b.max)) return null
    return {
      min: [Number(b.min[0]), Number(b.min[1]), Number(b.min[2])],
      max: [Number(b.max[0]), Number(b.max[1]), Number(b.max[2])],
    }
  } catch {
    return null
  }
}

/**
 * Race a promise against a timeout, rejecting if the timeout elapses first.
 *
 * @param promise - the promise to guard.
 * @param ms - the timeout in milliseconds.
 * @returns the result of the guarded promise.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('SDF 执行超时（超过 ' + ms / 1000 + ' 秒）')), ms),
    ),
  ])
}

/**
 * Wrap an sdf function with a per-execution call count limit.
 *
 * @param fn - the sdf function to guard.
 * @param maxCalls - the maximum number of allowed invocations.
 * @returns a guarded sdf function that throws once the limit is exceeded.
 */
export function createGuardedSdf(fn: SdfFn, maxCalls: number): (p: [number, number, number]) => number {
  let calls = 0
  return (p: [number, number, number]) => {
    if (++calls > maxCalls) throw new Error('SDF 调用次数超限（' + maxCalls + ' 次）')
    return fn(p[0], p[1], p[2])
  }
}

// Re-export manifoldToMeshData for sdf consumers
export { manifoldToMeshData }

/**
 * 执行 SDF 等值面提取（纯计算，不依赖 Worker）。
 *
 * @param Manifold - the manifold-3d Manifold class, used for levelSet extraction.
 * @param code - the user code containing the `sdf` (and optional `bounds`) function.
 * @param params - parameter name → value map injected as function arguments.
 * @param bounds - fallback bounding box as [xmin, ymin, zmin, xmax, ymax, zmax].
 * @param edgeLength - octree cell edge length; smaller yields finer detail.
 * @param level - the isosurface value (default 0).
 * @param tolerance - meshing tolerance (< 0 uses the manifold default).
 * @returns {positions, indices} mesh 数据
 */
export async function runSdfInline(
  Manifold: typeof import('manifold-3d/manifold').Manifold,
  code: string,
  params: Record<string, number>,
  bounds: [number, number, number, number, number, number],
  edgeLength: number,
  level: number = 0,
  tolerance: number = -1,
): Promise<{ positions: Float32Array; indices: Uint32Array }> {
  // ① 编译 sdf 函数
  const sdfFn = compileSdf(code, params)

  // ② 确定包围盒：优先用户 bounds()，否则用传入
  let box = tryCompileBounds(code, params)
  if (!box) {
    box = {
      min: [bounds[0], bounds[1], bounds[2]],
      max: [bounds[3], bounds[4], bounds[5]],
    }
  }

  // ③ 桥接：sdf(x,y,z) → (p: Vec3) => number，加调用次数限制
  const guardedSdf = createGuardedSdf(sdfFn, 10_000_000)

  // ④ 等值面提取（超时保护）
  const manifold: ManifoldInstance = await withTimeout(
    Promise.resolve(
      Manifold.levelSet(
        guardedSdf,
        box,
        edgeLength,
        level,
        tolerance < 0 ? undefined : tolerance,
      ),
    ),
    60_000,
  )

  // ⑤ 提取 mesh 数据后立即释放 WASM 内存
  const mesh = manifoldToMeshData(manifold)
  manifold.delete()

  return mesh
}
