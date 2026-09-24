/**
 * mesh index — editor extension mesh aggregate.
 *
 * Core's `@faicad/faijs/mesh` `cad` object carries the platform mesh
 * implementations. This module re-exposes it with the editor-owned keys put
 * back, so the moved op definitions (`ops/*`) can call `cad.fai_drill(...)`,
 * `cad.text(...)` and friends exactly the way they did inside core.
 *
 * Consumers that only need one implementation should import the specific module
 * (`@faicad/faijs/mesh/query`, `./fai_split`, ...) instead of this aggregate.
 */
import { cad as coreCad } from '@faicad/faijs/mesh'
import * as primitives from './primitives'
import * as splitOps from './fai_split'
import * as drillOps from './fai_drill'
import * as extrudeOps from './fai_extrude'

/** Core platform mesh aggregate plus the editor-owned mesh implementations. */
export const editorCad = {
  ...coreCad,

  // 创建（B 组：svg / 文字）
  text: primitives.text,
  svgExtrude: primitives.svgExtrude,

  // 分割（A 组：fai_split 家族）
  fai_split: splitOps.split,
  fai_splitWithParams: splitOps.splitWithParams,
  dovetailSplit: splitOps.dovetailSplit,
  dowelSplit: splitOps.dowelSplit,
  tenonSplit: splitOps.tenonSplit,

  // 钻孔（A 组）
  fai_drill: drillOps.drill,

  // 拉伸（A 组）
  fai_extrude: extrudeOps.extrude,
}

export type { Shape, Vec3, BoundingBox, FaceDescriptor } from '@faicad/faijs/mesh/types'
export type {
  TextParams, SvgExtrudeParams,
  DrillParams, ExtrudeParams,
  SplitPlane, SplitResult, DovetailSplitParams, DowelSplitParams, TenonSplitParams,
} from '@faicad/faijs/mesh/types'
