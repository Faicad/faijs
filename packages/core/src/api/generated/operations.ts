/**
 * generated/operations.ts — 生成文件，勿手改。
 * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 生成（E5/P14 分片）。
 * operations 模块：16 个投影符号；另有 106 个 skip 登记。
 */
import { defineOp } from '../../define-op'
import { extrudeBrep as __own_extrudeBrep } from '../brep-mirror/sweepFns'
import { revolveBrep as __own_revolveBrep } from '../brep-mirror/sweepFns'
import { sweepBrep as __own_sweepBrep } from '../brep-mirror/sweepFns'
import { complexExtrudeBrep as __own_complexExtrudeBrep } from '../brep-mirror/sweepFns'
import { twistExtrudeBrep as __own_twistExtrudeBrep } from '../brep-mirror/sweepFns'
import { linearPatternBrep as __own_linearPatternBrep } from '../brep-mirror/patternFns'
import { circularPatternBrep as __own_circularPatternBrep } from '../brep-mirror/patternFns'
import { gridPatternBrep as __own_gridPatternBrep } from '../brep-mirror/patternFns'
import { roofBrep as __own_roofBrep } from '../brep-mirror/roofFns'
import { drillBrep as __own_drillBrep } from '../brep-mirror/compoundFns'
import { pocketBrep as __own_pocketBrep } from '../brep-mirror/compoundFns'
import { bossBrep as __own_bossBrep } from '../brep-mirror/compoundFns'
import { mirrorJoinBrep as __own_mirrorJoinBrep } from '../brep-mirror/compoundFns'
import { rectangularPatternBrep as __own_rectangularPatternBrep } from '../brep-mirror/patternFns'
import { threadBrepOp as __own_threadBrepOp } from '../brep-mirror/threadFns'
import { convexHullBrep as __own_convexHullBrep } from '../brep-mirror/hullFns'

/**
 * extrude — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * extrude(face: Shape, height: number|Vec3) → Shape｜extrude(face: Shape, params: { length? | upTo, normal?, mode?, baseFeature?, offset? }) → Shape
 * 桥接：defineOp({ brep: __own_extrudeBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const extrude = defineOp({
  brep: __own_extrudeBrep,
  name: 'extrude', naming: {"kind":"construct","newFaces":{"via":"explicit","vocab":[{"kind":"semantic","name":"top"},{"kind":"semantic","name":"bottom"}]}}, engines: ["occt"],
})

/**
 * revolve — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * revolve(face: Shape, options?: RevolveOptions): Shape
 * 桥接：defineOp({ brep: __own_revolveBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const revolve = defineOp({
  brep: __own_revolveBrep,
  name: 'revolve', naming: {"kind":"construct","newFaces":{"via":"explicit","vocab":[{"kind":"semantic","name":"top"},{"kind":"semantic","name":"bottom"},{"kind":"wall","index":0}]}}, engines: ["occt"],
})

/**
 * sweep — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * sweep(wire: Shape, spine: Shape, config?: SweepOptions, shellMode?: boolean): Shape
 * 桥接：defineOp({ brep: __own_sweepBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const sweep = defineOp({
  brep: __own_sweepBrep,
  name: 'sweep', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"],
})

/**
 * complexExtrude — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * complexExtrude(wire: Shape, center: Vec3, normal: Vec3, profile?: ExtrusionProfile): Shape
 * 桥接：defineOp({ brep: __own_complexExtrudeBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const complexExtrude = defineOp({
  brep: __own_complexExtrudeBrep,
  name: 'complexExtrude', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"],
})

/**
 * twistExtrude — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * twistExtrude(wire: Shape, angleDegrees: number, center: Vec3, normal: Vec3): Shape
 * 桥接：defineOp({ brep: __own_twistExtrudeBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const twistExtrude = defineOp({
  brep: __own_twistExtrudeBrep,
  name: 'twistExtrude', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"],
})

/**
 * linearPattern — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * linearPattern(shape: Shape, direction: Vec3, count: number, spacing: number): Shape
 * 桥接：defineOp({ brep: __own_linearPatternBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const linearPattern = defineOp({
  brep: __own_linearPatternBrep,
  name: 'linearPattern', naming: {"kind":"replicate","k":0}, engines: ["occt"],
})

/**
 * circularPattern — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * circularPattern(shape: Shape, axis: Vec3, count: number, fullAngle?: number, center?: Vec3): Shape
 * 桥接：defineOp({ brep: __own_circularPatternBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const circularPattern = defineOp({
  brep: __own_circularPatternBrep,
  name: 'circularPattern', naming: {"kind":"replicate","k":0}, engines: ["occt"],
})

/**
 * gridPattern — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * gridPattern(shape: Shape, directionX: Vec3, directionY: Vec3, countX: number, countY: number, spacingX: number, spacingY: number): Shape
 * 桥接：defineOp({ brep: __own_gridPatternBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const gridPattern = defineOp({
  brep: __own_gridPatternBrep,
  name: 'gridPattern', naming: {"kind":"replicate","k":0}, engines: ["occt"],
})

/**
 * roof — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * roof(wire: Shape, options?: RoofOptions): Shape
 * 桥接：defineOp({ brep: __own_roofBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const roof = defineOp({
  brep: __own_roofBrep,
  name: 'roof', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, capabilities: ["buildTriFace","dispose","fixShape","isValid","sew","sewAndSolidify"],
})

/**
 * drill — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * drill(shape: Shape, options: DrillOptions): Shape
 * 桥接：defineOp({ brep: __own_drillBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const drill = defineOp({
  brep: __own_drillBrep,
  name: 'drill', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"],
})

/**
 * pocket — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * pocket(shape: Shape, options: PocketOptions): Shape
 * 桥接：defineOp({ brep: __own_pocketBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const pocket = defineOp({
  brep: __own_pocketBrep,
  name: 'pocket', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"],
})

/**
 * boss — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * boss(shape: Shape, options: BossOptions): Shape
 * 桥接：defineOp({ brep: __own_bossBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const boss = defineOp({
  brep: __own_bossBrep,
  name: 'boss', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"],
})

/**
 * mirrorJoin — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * mirrorJoin(shape: Shape, options?: MirrorJoinOptions): Shape
 * 桥接：defineOp({ brep: __own_mirrorJoinBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const mirrorJoin = defineOp({
  brep: __own_mirrorJoinBrep,
  name: 'mirrorJoin', naming: {"kind":"replicate","k":2}, engines: ["occt"],
})

/**
 * rectangularPattern — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * rectangularPattern(shape: Shape, options: RectangularPatternOptions): Shape
 * 桥接：defineOp({ brep: __own_rectangularPatternBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const rectangularPattern = defineOp({
  brep: __own_rectangularPatternBrep,
  name: 'rectangularPattern', naming: {"kind":"replicate","k":0}, engines: ["occt"],
})

/**
 * thread — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * thread(options: ThreadOptions): Shape
 * 桥接：defineOp({ brep: __own_threadBrepOp })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const thread = defineOp({
  brep: __own_threadBrepOp,
  name: 'thread', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"],
})

/**
 * convexHull — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * convexHull(points: Vec3[]): Shape
 * 桥接：defineOp({ brep: __own_convexHullBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const convexHull = defineOp({
  brep: __own_convexHullBrep,
  name: 'convexHull', naming: {"kind":"unmodeled","reason":"construct vocabulary pending Phase 3"}, engines: ["occt"],
})
