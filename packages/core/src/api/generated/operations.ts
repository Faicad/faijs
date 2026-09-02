/**
 * generated/operations.ts — 生成文件，勿手改。
 * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 生成（E5/P14 分片）。
 * operations 模块：77 个投影符号；另有 45 个 skip 登记。
 */
import { defineOp } from '../../sdk'
import { borrowBrepjsShape, adoptBrepjsProduct, callBrepjs } from '../internal/l3-bridge'
import type { Shape } from '../../mesh/types'
import { extrude as __vendored_extrude } from '../../vendored/brepjs/operations/api.js'
import { revolve as __vendored_revolve } from '../../vendored/brepjs/operations/api.js'
import { sweep as __vendored_sweep } from '../../vendored/brepjs/operations/extrudeFns.js'
import { complexExtrude as __vendored_complexExtrude } from '../../vendored/brepjs/operations/extrudeFns.js'
import { twistExtrude as __vendored_twistExtrude } from '../../vendored/brepjs/operations/extrudeFns.js'
import { linearPattern as __vendored_linearPattern } from '../../vendored/brepjs/operations/patternFns.js'
import { circularPattern as __vendored_circularPattern } from '../../vendored/brepjs/operations/patternFns.js'
import { gridPattern as __vendored_gridPattern } from '../../vendored/brepjs/operations/patternFns.js'
import { roof as __vendored_roof } from '../../vendored/brepjs/operations/roofFns.js'
import { drill as __vendored_drill } from '../../vendored/brepjs/operations/compoundOpsFns.js'
import { pocket as __vendored_pocket } from '../../vendored/brepjs/operations/compoundOpsFns.js'
import { boss as __vendored_boss } from '../../vendored/brepjs/operations/compoundOpsFns.js'
import { mirrorJoin as __vendored_mirrorJoin } from '../../vendored/brepjs/operations/compoundOpsFns.js'
import { rectangularPattern as __vendored_rectangularPattern } from '../../vendored/brepjs/operations/compoundOpsFns.js'
import { thread as __vendored_thread } from '../../vendored/brepjs/operations/threadFns.js'
import { convexHull as __vendored_convexHull } from '../../vendored/brepjs/operations/convexHullFns.js'

export type { AssemblyExporter } from '../../vendored/brepjs/operations/exporters.js'

export type { AssemblyNode } from '../../vendored/brepjs/operations/assemblyFns.js'

export type { AssemblyNodeOptions } from '../../vendored/brepjs/operations/assemblyFns.js'

export type { AssemblySolveResult } from '../../vendored/brepjs/operations/mateFns.js'

export type { CleanLoftOptions } from '../../vendored/brepjs/index.js'

export type { CleanSweepOptions } from '../../vendored/brepjs/index.js'

export type { CylindricalOptions } from '../../vendored/brepjs/operations/jointFns.js'

export type { DHOptions } from '../../vendored/brepjs/operations/dhFns.js'

export type { DHRow } from '../../vendored/brepjs/operations/dhFns.js'

export type { ExtrudeAllEntry } from '../../vendored/brepjs/operations/extrudeFns.js'

export type { ExtrusionProfile } from '../../vendored/brepjs/operations/extrudeFns.js'

export type { GuidedSweepOptions } from '../../vendored/brepjs/operations/guidedSweepFns.js'

export type { HistoryOperationRegistry } from '../../vendored/brepjs/index.js'

export type { IKOptions } from '../../vendored/brepjs/operations/ikFns.js'

export type { IKResult } from '../../vendored/brepjs/operations/ikFns.js'

export type { IKTarget } from '../../vendored/brepjs/operations/ikFns.js'

export type { InstancedMesh } from '../../vendored/brepjs/operations/instanceFns.js'

export type { InstancedShape } from '../../vendored/brepjs/operations/instanceFns.js'

export type { InstanceGridOptions } from '../../vendored/brepjs/operations/instanceFns.js'

export type { Joint } from '../../vendored/brepjs/operations/jointFns.js'

export type { JointAxis } from '../../vendored/brepjs/operations/jointFns.js'

export type { JointDOF } from '../../vendored/brepjs/operations/jointFns.js'

export type { JointOptions } from '../../vendored/brepjs/operations/jointFns.js'

export type { JointPose } from '../../vendored/brepjs/operations/jointFns.js'

export type { JointType } from '../../vendored/brepjs/operations/jointFns.js'

export type { LoftAllEntry } from '../../vendored/brepjs/operations/loftFns.js'

export type { MateConstraint } from '../../vendored/brepjs/operations/mateFns.js'

export type { MateEntity } from '../../vendored/brepjs/operations/mateFns.js'

export type { MaterializeOptions } from '../../vendored/brepjs/operations/instanceFns.js'

export type { ModelHistory } from '../../vendored/brepjs/operations/historyFns.js'

export type { MultiSweepOptions } from '../../vendored/brepjs/operations/multiSweepFns.js'

export type { OperationFn } from '../../vendored/brepjs/operations/historyFns.js'

export type { OperationStep } from '../../vendored/brepjs/operations/historyFns.js'

export type { PlanarOptions } from '../../vendored/brepjs/operations/jointFns.js'

export type { RevolveOptions } from '../../vendored/brepjs/operations/api.js'

export type { RoofOptions } from '../../vendored/brepjs/operations/roofFns.js'

export type { SerializedHistory } from '../../vendored/brepjs/operations/historyFns.js'

export type { ShapeOptions } from '../../vendored/brepjs/operations/exporterFns.js'

export type { SkeletonFace } from '../../vendored/brepjs/operations/straightSkeleton.js'

export type { SkeletonNode } from '../../vendored/brepjs/operations/straightSkeleton.js'

export type { SkPoint2D } from '../../vendored/brepjs/operations/straightSkeleton.js'

export type { SphericalOptions } from '../../vendored/brepjs/operations/jointFns.js'

export type { StraightSkeleton } from '../../vendored/brepjs/operations/straightSkeleton.js'

export type { SupportedUnit } from '../../vendored/brepjs/operations/exporterFns.js'

export type { SweepOptions } from '../../vendored/brepjs/operations/extrudeFns.js'

export type { SweepSectionConfig } from '../../vendored/brepjs/operations/multiSweepFns.js'

export type { ThreadOptions } from '../../vendored/brepjs/operations/threadFns.js'

export type { TrajectorySample } from '../../vendored/brepjs/operations/ikFns.js'

export type { UrdfDocument } from '../../vendored/brepjs/operations/urdfFns.js'

export type { UrdfExportOptions } from '../../vendored/brepjs/operations/urdfFns.js'

export { revoluteJoint } from '../../vendored/brepjs/operations/jointFns.js'

export { prismaticJoint } from '../../vendored/brepjs/operations/jointFns.js'

export { cylindricalJoint } from '../../vendored/brepjs/operations/jointFns.js'

export { planarJoint } from '../../vendored/brepjs/operations/jointFns.js'

export { sphericalJoint } from '../../vendored/brepjs/operations/jointFns.js'

export { setJointValue } from '../../vendored/brepjs/operations/jointFns.js'

export { setJointValues } from '../../vendored/brepjs/operations/jointFns.js'

export { jointTransform } from '../../vendored/brepjs/operations/jointFns.js'

export { jointsFromDH } from '../../vendored/brepjs/operations/dhFns.js'

export { computeStraightSkeleton } from '../../vendored/brepjs/operations/straightSkeleton.js'

export { isInstanced } from '../../vendored/brepjs/operations/instanceFns.js'

/**
 * extrude — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * extrude(face: Shape, height?: number|Vec3) → Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const extrude = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_extrude, __args)
    if (!__r.ok) throw new Error('[faijs/generated] extrude: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * revolve — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * revolve(face: Shape, options?: RevolveOptions): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const revolve = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_revolve, __args)
    if (!__r.ok) throw new Error('[faijs/generated] revolve: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * sweep — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * sweep(wire: Shape, spine: Shape, config?: SweepOptions, shellMode?: boolean): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const sweep = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0,1].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_sweep, __args)
    if (!__r.ok) throw new Error('[faijs/generated] sweep: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * complexExtrude — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * complexExtrude(wire: Shape, center: Vec3, normal: Vec3, profile?: ExtrusionProfile): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const complexExtrude = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_complexExtrude, __args)
    if (!__r.ok) throw new Error('[faijs/generated] complexExtrude: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * twistExtrude — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * twistExtrude(wire: Shape, angleDegrees: number, center: Vec3, normal: Vec3): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const twistExtrude = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_twistExtrude, __args)
    if (!__r.ok) throw new Error('[faijs/generated] twistExtrude: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * linearPattern — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * linearPattern(shape: Shape, direction: Vec3, count: number, spacing: number): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const linearPattern = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_linearPattern, __args)
    if (!__r.ok) throw new Error('[faijs/generated] linearPattern: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * circularPattern — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * circularPattern(shape: Shape, axis: Vec3, count: number, fullAngle?: number, center?: Vec3): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const circularPattern = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_circularPattern, __args)
    if (!__r.ok) throw new Error('[faijs/generated] circularPattern: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * gridPattern — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * gridPattern(shape: Shape, directionX: Vec3, directionY: Vec3, countX: number, countY: number, spacingX: number, spacingY: number): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const gridPattern = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_gridPattern, __args)
    if (!__r.ok) throw new Error('[faijs/generated] gridPattern: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * roof — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * roof(wire: Shape, options?: RoofOptions): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const roof = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_roof, __args)
    if (!__r.ok) throw new Error('[faijs/generated] roof: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * drill — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * drill(shape: Shape, options: DrillOptions): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const drill = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_drill, __args)
    if (!__r.ok) throw new Error('[faijs/generated] drill: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * pocket — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * pocket(shape: Shape, options: PocketOptions): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const pocket = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_pocket, __args)
    if (!__r.ok) throw new Error('[faijs/generated] pocket: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * boss — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * boss(shape: Shape, options: BossOptions): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const boss = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_boss, __args)
    if (!__r.ok) throw new Error('[faijs/generated] boss: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * mirrorJoin — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * mirrorJoin(shape: Shape, options?: MirrorJoinOptions): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const mirrorJoin = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_mirrorJoin, __args)
    if (!__r.ok) throw new Error('[faijs/generated] mirrorJoin: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * rectangularPattern — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * rectangularPattern(shape: Shape, options: RectangularPatternOptions): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const rectangularPattern = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_rectangularPattern, __args)
    if (!__r.ok) throw new Error('[faijs/generated] rectangularPattern: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * thread — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * thread(options: ThreadOptions): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const thread = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args
    const __r = callBrepjs(__vendored_thread, __args)
    if (!__r.ok) throw new Error('[faijs/generated] thread: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * convexHull — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * convexHull(points: Vec3[]): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const convexHull = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args
    const __r = callBrepjs(__vendored_convexHull, __args)
    if (!__r.ok) throw new Error('[faijs/generated] convexHull: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})
