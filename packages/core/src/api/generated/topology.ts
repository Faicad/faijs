/**
 * generated/topology.ts — 生成文件，勿手改。
 * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 生成（E5/P14 分片）。
 * topology 模块：21 个投影符号；另有 281 个 skip 登记。
 */
import { defineOp } from '../../define-op'
import { brepOf } from '../../shape'
import { getBrepApi } from '../../brep/handle-bridge'
import type { BrepHandle } from '../../brep/engine/types'
import type { Shape } from '../../mesh/types'
import { torusBrep as __own_torusBrep } from '../brep-mirror/primitiveFns'
import { fuseBrep as __own_fuseBrep } from '../brep-mirror/booleanFns'
import { ellipsoidBrep as __own_ellipsoidBrep } from '../brep-mirror/primitiveFns'
import { rotateBrep as __own_rotateBrep } from '../brep-mirror/topologyFns'
import { mirrorBrep as __own_mirrorBrep } from '../brep-mirror/topologyFns'
import { cloneBrep as __own_cloneBrep } from '../brep-mirror/topologyFns'
import { applyMatrixBrep as __own_applyMatrixBrep } from '../brep-mirror/topologyFns'
import { locateBrep as __own_locateBrep } from '../brep-mirror/topologyFns'
import { sectionBrep as __own_sectionBrep } from '../brep-mirror/booleanFns'
import { splitBrep as __own_splitBrep } from '../brep-mirror/booleanFns'
import { shellBrep as __own_shellBrep } from '../brep-mirror/topologyFns'
import { offsetBrep as __own_offsetBrep } from '../brep-mirror/topologyFns'
import { healBrep as __own_healBrep } from '../brep-mirror/healingFns'
import { simplifyBrep as __own_simplifyBrep } from '../brep-mirror/healingFns'
import { autoHealBrep as __own_autoHealBrep } from '../brep-mirror/healingFns'
import { fixShapeBrep as __own_fixShapeBrep } from '../brep-mirror/healingFns'
import { healSolidBrep as __own_healSolidBrep } from '../brep-mirror/healingFns'
import { fixSelfIntersectionBrep as __own_fixSelfIntersectionBrep } from '../brep-mirror/healingFns'

/**
 * torus — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * (majorRadius: number, minorRadius: number, options?: TorusOptions)
 * 桥接：defineOp({ brep: __own_torusBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const torus = defineOp({
  brep: __own_torusBrep,
  name: 'torus', naming: {"kind":"unmodeled","reason":"construct vocabulary pending Phase 3"}, capabilities: ["dispose","makeTorus"],
})

/**
 * fuse — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * (a: Shape3D, b: Shape3D, options?: BooleanOptions) -> Result<Shape3D>
 * 桥接：defineOp({ brep: __own_fuseBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const fuse = defineOp({
  brep: __own_fuseBrep,
  name: 'fuse', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"],
})

/**
 * getBounds — 查询（core selfhost，生成文件，勿手改；来源 api/surface/arg-spec.ts）。
 * (shape: Shape) -> BrepBoundingBox（core selfhost）
 * 桥接：getBrepApi().* 直连 occt 引擎（§5.5 第 2 条）——无 vendored 借入/调用。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns { xmin: number; ymin: number; zmin: number; xmax: number; ymax: number; zmax: number } — 纯数据结果（非 Shape）。
 */
export function getBounds(shape: Shape): { xmin: number; ymin: number; zmin: number; xmax: number; ymax: number; zmax: number } {
  const h0 = brepOf(shape as Shape) as BrepHandle
  return getBrepApi().getBoundingBox(h0)
}

/**
 * ellipsoid — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * ellipsoid(rx: number, ry: number, rz: number, options?: EllipsoidOptions): Shape
 * 桥接：defineOp({ brep: __own_ellipsoidBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const ellipsoid = defineOp({
  brep: __own_ellipsoidBrep,
  name: 'ellipsoid', naming: {"kind":"unmodeled","reason":"construct vocabulary pending Phase 3"}, engines: ["occt"],
})

/**
 * rotate — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * rotate(shape: Shape, angle: number, options?: { at?, axis? }): Shape
 * 桥接：defineOp({ brep: __own_rotateBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const rotate = defineOp({
  brep: __own_rotateBrep,
  name: 'rotate', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"],
})

/**
 * mirror — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * mirror(shape: Shape, options?: MirrorOptions): Shape
 * 桥接：defineOp({ brep: __own_mirrorBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const mirror = defineOp({
  brep: __own_mirrorBrep,
  name: 'mirror', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"],
})

/**
 * clone — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * clone(shape: Shape): Shape
 * 桥接：defineOp({ brep: __own_cloneBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const clone = defineOp({
  brep: __own_cloneBrep,
  name: 'clone', naming: {"kind":"identity"}, engines: ["occt"],
})

/**
 * applyMatrix — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * applyMatrix(shape: Shape, matrix: unknown): Shape
 * 桥接：defineOp({ brep: __own_applyMatrixBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const applyMatrix = defineOp({
  brep: __own_applyMatrixBrep,
  name: 'applyMatrix', naming: {"kind":"identity"}, engines: ["occt"],
})

/**
 * locate — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * locate(shape: Shape, placement: unknown): Shape
 * 桥接：defineOp({ brep: __own_locateBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const locate = defineOp({
  brep: __own_locateBrep,
  name: 'locate', naming: {"kind":"identity"}, capabilities: ["composeTransform","dispose","hashCode","locate"],
})

/**
 * section — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * section(shape: Shape, plane: PlaneInput): Shape
 * 桥接：defineOp({ brep: __own_sectionBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const section = defineOp({
  brep: __own_sectionBrep,
  name: 'section', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"],
})

/**
 * split — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * split(shape: Shape, tools: Shape[]): Shape
 * 桥接：defineOp({ brep: __own_splitBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const split = defineOp({
  brep: __own_splitBrep,
  name: 'split', naming: {"kind":"subdivide"}, engines: ["occt"],
})

/**
 * shell — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * shell(shape: Shape, faces?: Shape[], thickness: number): Shape
 * 桥接：defineOp({ brep: __own_shellBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const shell = defineOp({
  brep: __own_shellBrep,
  name: 'shell', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"],
})

/**
 * offset — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * offset(shape: Shape, distance: number): Shape
 * 桥接：defineOp({ brep: __own_offsetBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const offset = defineOp({
  brep: __own_offsetBrep,
  name: 'offset', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"],
})

/**
 * heal — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * heal(shape: Shape): Shape
 * 桥接：defineOp({ brep: __own_healBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const heal = defineOp({
  brep: __own_healBrep,
  name: 'heal', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"],
})

/**
 * simplify — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * simplify(shape: Shape): Shape
 * 桥接：defineOp({ brep: __own_simplifyBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const simplify = defineOp({
  brep: __own_simplifyBrep,
  name: 'simplify', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"],
})

/**
 * isValid — 查询（core selfhost，生成文件，勿手改；来源 api/surface/arg-spec.ts）。
 * isValid(shape: Shape): boolean（core selfhost）
 * 桥接：getBrepApi().* 直连 occt 引擎（§5.5 第 2 条）——无 vendored 借入/调用。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns boolean — 纯数据结果（非 Shape）。
 */
export function isValid(shape: Shape): boolean {
  const h0 = brepOf(shape as Shape) as BrepHandle
  return getBrepApi().isValid(h0)
}

/**
 * isSameShape — 查询（core selfhost，生成文件，勿手改；来源 api/surface/arg-spec.ts）。
 * isSameShape(a: Shape, b: Shape): boolean（core selfhost）
 * 桥接：getBrepApi().* 直连 occt 引擎（§5.5 第 2 条）——无 vendored 借入/调用。
 *
 * @param a - 可形状参数（第一个被比较形状）
 * @param b - 可形状参数（第二个被比较形状）
 * @returns boolean — 纯数据结果（非 Shape）。
 */
export function isSameShape(a: Shape, b: Shape): boolean {
  const h0 = brepOf(a as Shape) as BrepHandle
  const h1 = brepOf(b as Shape) as BrepHandle
  return getBrepApi().isSame(h0, h1)
}

/**
 * autoHeal — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * autoHeal(shape: Shape, options?: AutoHealOptions): { shape: Shape, report }
 * 桥接：defineOp({ brep: __own_autoHealBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const autoHeal = defineOp({
  brep: __own_autoHealBrep,
  name: 'autoHeal', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"], outputs: ["shape"],
})

/**
 * fixShape — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * fixShape(shape: Shape): Shape
 * 桥接：defineOp({ brep: __own_fixShapeBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const fixShape = defineOp({
  brep: __own_fixShapeBrep,
  name: 'fixShape', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, capabilities: ["fixShape"],
})

/**
 * healSolid — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * healSolid(solid: Shape): Shape
 * 桥接：defineOp({ brep: __own_healSolidBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const healSolid = defineOp({
  brep: __own_healSolidBrep,
  name: 'healSolid', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"],
})

/**
 * fixSelfIntersection — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * fixSelfIntersection(shape: Shape): Shape
 * 桥接：defineOp({ brep: __own_fixSelfIntersectionBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const fixSelfIntersection = defineOp({
  brep: __own_fixSelfIntersectionBrep,
  name: 'fixSelfIntersection', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"],
})
