/**
 * pitfall-fixtures.ts — 「内核陷阱」测试与探针共用的几何夹具。
 *
 * 仅测试/脚本使用：tsconfig.build.json 排除 `src/testing/**`，不随包发布。
 * 这些夹具对应 `scripts/kernel-pitfalls-probe.ts` 里各段陷阱的最小复现体。
 */

import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import type { WarehouseKernel } from '../kernel'
import { polygonWire } from '../primitives'

/**
 * 三元组 → Vec3。注意本内核 Vec3 是 `{x,y,z}` 对象，**不是**元组。
 * @param x - X 坐标（mm）。
 * @param y - Y 坐标（mm）。
 * @param z - Z 坐标（mm）。
 * @returns 对应坐标的 Vec3 对象。
 */
export const V = (x: number, y: number, z: number): BrepVec3 => ({ x, y, z })

/**
 * 折线 wire，**不**做首尾重合去重 —— 用于复现「零长末边令 makeLineEdge 抛错」。
 * 生产路径请用 `primitives.polygonWire`（它经 `closeLoop` 去重）。
 * @param k - 内核句柄（WarehouseKernel）。
 * @param pts - 折线顶点列（末点可与首点重合）。
 * @returns 由相邻顶点连成的闭合 wire 句柄（末点回到首点）。
 */
export function degeneratePolygonWire(k: WarehouseKernel, pts: BrepVec3[]): BrepHandle {
  const edges: BrepHandle[] = []
  for (let i = 0; i < pts.length; i++) edges.push(k.makeLineEdge(pts[i]!, pts[(i + 1) % pts.length]!))
  return k.makeWire(edges)
}

/**
 * 立方体的 6 张平面 face（闭合壳，用于 sew / 朝向 / solidFromFaces 陷阱）。
 * @param k - 内核句柄（WarehouseKernel）。
 * @param size - 立方体边长（mm），默认 2。
 * @returns 6 张平面 face（底、顶、四个侧面）。
 */
export function boxFaces(k: WarehouseKernel, size = 2): BrepHandle[] {
  const s = size
  const quad = (a: BrepVec3, b: BrepVec3, c: BrepVec3, d: BrepVec3) =>
    k.makeFace(polygonWire([a, b, c, d]))
  return [
    quad(V(0, 0, 0), V(s, 0, 0), V(s, s, 0), V(0, s, 0)), // z=0 底
    quad(V(0, 0, s), V(s, 0, s), V(s, s, s), V(0, s, s)), // z=s 顶
    quad(V(0, 0, 0), V(s, 0, 0), V(s, 0, s), V(0, 0, s)), // y=0
    quad(V(s, 0, 0), V(s, s, 0), V(s, s, s), V(s, 0, s)), // x=s
    quad(V(s, s, 0), V(0, s, 0), V(0, s, s), V(s, s, s)), // y=s
    quad(V(0, s, 0), V(0, 0, 0), V(0, 0, s), V(0, s, s)), // x=0
  ]
}

/**
 * 单位正方形的 4 条边，按 `A→B→C→D` 首尾相接（用于 makeWire 乱序丢边陷阱）。
 * @param k - 内核句柄（WarehouseKernel）。
 * @returns 依次相接的四条边句柄 `{A,B,C,D}`。
 */
export function squareEdges(k: WarehouseKernel): {
  A: BrepHandle
  B: BrepHandle
  C: BrepHandle
  D: BrepHandle
} {
  const p00 = V(0, 0, 0)
  const p10 = V(1, 0, 0)
  const p11 = V(1, 1, 0)
  const p01 = V(0, 1, 0)
  return {
    A: k.makeLineEdge(p00, p10),
    B: k.makeLineEdge(p10, p11),
    C: k.makeLineEdge(p11, p01),
    D: k.makeLineEdge(p01, p00),
  }
}
