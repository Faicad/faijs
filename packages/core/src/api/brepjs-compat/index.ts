/**
 * BREP-TS compatibility surface (P21) — 2026-09-25 core-decouple rewrite.
 *
 * The vendored BREP TS tree (packages/brepjs) is deleted (裁决 9). Every
 * op projection (primitives / booleans / evolutions / topology queries /
 * sketching DSL / raw 2D-morph ports) is gone with it — those symbols have no
 * receiver (裁决 1). What remains in this module is the ④ group only: the pure
 * combinators / types inlined into core (§5.2) — Result, vectors, planes,
 * errors, constants — which stay flat-exported from the core facade for
 * library authors (import { ok, vecAdd } from '@faicad/faijs').
 */

// ─────────────────────────────────────────────────────────────────────────────
// ④ combinators / pure helpers / types（2026-09-25 core-decouple：op 投影面
// ① ② ③ ⑤ 已随 vendored 树删除；④ 全部为 core 内联实现，保留为本文件的
// 唯一内容。vendored 句柄类型（Vertex/Edge/…/Shape3D/ValidSolid）随裁决 9 删除）
// ─────────────────────────────────────────────────────────────────────────────

export {
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  andThen,
} from '../../result/result'
export type { Result, Ok, Err } from '../../result/result'

export {
  vecAdd,
  vecSub,
  vecScale,
  vecDot,
  vecCross,
  vecLength,
  vecNormalize,
} from './vecOps'

export {
  createPlane,
  createNamedPlane,
  resolvePlane,
} from './planeOps'

export { kernelError, validationError } from '../../result/errors'
export type { BrepError } from '../../result/errors'

export { DEG2RAD, RAD2DEG } from './constants'

export type { Plane, PlaneName, PlaneInput } from './planeTypes'

export type { Vec3, PointInput } from './types'
