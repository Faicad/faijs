/**
 * BREP-TS compatibility surface (P21).
 *
 * Projects the vendored BREP TS tree onto four stable groups so library authors
 * can write `import { box, fuse, Sketcher, ok } from this module` and call it
 * upstream-style:
 *
 *   ① op        — solid primitives + boolean / evolution operations
 *   ② topology  — sub-shape queries + measurements (plus the Bounds3D type)
 *   ③ sketching — stateful Sketcher / FaceSketcher DSL + drawing factories
 *   ④ combinators / types — result, vector, plane, errors, constants, types
 *
 * Every symbol is a projection (re-export or a thin dual-form wrapper) from the
 * ported tree: no reimplementation. The `.js` specifiers are the repo
 * convention (TypeScript maps `.js` → `.ts`).
 *
 * Semantic wraps (P23: both live in `api/internal/compat-projection.ts` so the
 * generated face and this hand-curated face share one mechanism):
 * - single-kernel assert: every modeling op asserts a bound BREP kernel first
 *   (see `assertKernelBound`); `getBackends()` may throw before configuration,
 *   so it is guarded and falls back to the occt-kernel binding flag.
 * - dual argument forms: object form normalizes to positional form via the
 *   shared `resolveArgs` discriminant; object keys outside the declared
 *   parameter table throw the shared `E_ARGS_FORM` token.
 * - `box` is the hand-written dual-form sample: positional
 *   `box(width, depth, height)` and `box({ size })` / `box({ width, depth,
 *   height })` both forward to the vendored primitive in its native dimension
 *   order (width = X, depth = Y, height = Z — confirm against
 *   `primitiveFns#box`), so every accepted form yields identical geometry.
 */

import { assertKernelBound, projectBrepOp } from '../internal/compat-projection'
import { isObjectForm } from '../internal/dual-form-args'

import type { ValidSolid } from '../../vendored/brepjs/core/shapeTypes.js'

/** Signature of a compat op projection (inputs normalized before the call). */
type CompatOp = (...args: unknown[]) => unknown

/**
 * Dual-form op wrapper (A-class): asserts the kernel, normalizes object form to
 * positional form via `resolveArgs`, then delegates to the vendored
 * implementation.
 *
 * P23: delegates to the shared {@link projectBrepOp} so the hand-curated face
 * and the generated face share one projection mechanism (§4.3.2).
 */
function wrapDual<R>(
  name: string,
  params: string[],
  impl: (...args: unknown[]) => R
): CompatOp {
  return projectBrepOp(name, params, 'A', impl as (...args: never[]) => unknown)
}

/**
 * Guard-only wrapper: forwards the arguments unchanged after the kernel assert.
 * Used for positional-first ops (booleans, evolutions) whose first argument is
 * a shape, so the object-form discriminant never applies. The exact function
 * type `F` (including its parameter and Result types) is preserved.
 */
function wrapGuarded<F>(name: string, impl: F): F {
  const fn: (...args: unknown[]) => unknown = (...args: unknown[]) => {
    assertKernelBound(name)
    return (impl as (...args: unknown[]) => unknown)(...args)
  }
  return fn as unknown as F
}

// ─────────────────────────────────────────────────────────────────────────────
// ① primitives + booleans + evolutions
// ─────────────────────────────────────────────────────────────────────────────

import {
  box as primitiveBox,
  sphere as primitiveSphere,
  cylinder as primitiveCylinder,
  cone as primitiveCone,
  torus as primitiveTorus,
  ellipsoid as primitiveEllipsoid,
} from '../../vendored/brepjs/topology/primitiveFns.js'

/**
 * Create a solid box.
 *
 * Positional form `box(width, depth, height)` uses the vendor's native
 * dimension order — X = width, Y = depth,
 * Z = height (the vendored `primitiveFns#box` dimension order; width/height are
 * NOT swapped). See the overload below for the object form.
 *
 * @param width - side length along X.
 * @param depth - side length along Y.
 * @param height - side length along Z.
 * @returns a new valid solid box.
 */
export function box(width: number, depth: number, height: number): ValidSolid
/**
 * Create a solid box from an object form.
 *
 * Accepts `box({ size })` where `size` is a number (cube) or a
 * `[width, depth, height]` triple, or `box({ width, depth, height })`. Every
 * accepted form forwards to `primitiveBox(width, depth, height)`, so equal
 * dimension values always produce identical geometry.
 *
 * @param options - the dimension set: `size` (a cube edge or a triple) or
 * `width`/`depth`/`height` sides.
 * @returns a new valid solid box.
 * @throws An `Error` whose message contains the shared `E_ARGS_FORM` token when
 * no form matches (e.g. `box('x')`, `box()`, or unknown object keys).
 */
export function box(options: BoxDimensions): ValidSolid
export function box(...args: unknown[]): ValidSolid {
  assertKernelBound('box')
  if (isObjectForm(args)) {
    const obj = args[0] as Record<string, unknown>
    const keys = Object.keys(obj)
    const unknownKeys = keys.filter((k) => !['size', 'width', 'depth', 'height'].includes(k))
    if (unknownKeys.length > 0) throw boxArgError(args)
    const size = obj.size
    if (size !== undefined) {
      if (typeof size === 'number') return primitiveBox(size, size, size)
      if (Array.isArray(size) && size.length === 3) {
        const [w, d, h] = size as [number, number, number]
        return primitiveBox(w, d, h)
      }
      throw boxArgError(args)
    }
    const width = obj.width
    const depth = obj.depth
    const height = obj.height
    if (typeof width === 'number' && typeof depth === 'number' && typeof height === 'number') {
      return primitiveBox(width, depth, height)
    }
    throw boxArgError(args)
  }
  if (args.length === 3 && args.every((a) => typeof a === 'number')) {
    const [w, d, h] = args as [number, number, number]
    return primitiveBox(w, d, h)
  }
  throw boxArgError(args)
}

/** Object-form input accepted by {@link box}. */
export interface BoxDimensions {
  /** All three sides as one number (cube) or a `[width, depth, height]` triple. */
  size?: number | [number, number, number]
  /** Side length along X. */
  width?: number
  /** Side length along Y. */
  depth?: number
  /** Side length along Z. */
  height?: number
}

/** Shared E_ARGS_FORM error for {@link box} argument mismatches. */
function boxArgError(args: unknown[]): Error {
  return new Error(
    '[compat:box] E_ARGS_FORM: expected box(width, depth, height), ' +
      "box({ size: number | [w, d, h] }) or box({ width, depth, height }); got " +
      args.map((a) => safeJson(a)).join(', ')
  )
}

/** JSON stringification that never throws on cyclic or exotic values. */
function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return '[unserializable]'
  }
}

/** Project the vendored `sphere(radius, options?)` with dual-form input. */
export const sphere = wrapDual('sphere', ['radius'], primitiveSphere as CompatOp)
/** Project the vendored `cylinder(radius, height, options?)` with dual-form input. */
export const cylinder = wrapDual('cylinder', ['radius', 'height'], primitiveCylinder as CompatOp)
/** Project the vendored `cone(bottomRadius, topRadius, height, options?)`. */
export const cone = wrapDual(
  'cone',
  ['bottomRadius', 'topRadius', 'height'],
  primitiveCone as CompatOp
)
/** Project the vendored `torus(majorRadius, minorRadius, options?)`. */
export const torus = wrapDual('torus', ['majorRadius', 'minorRadius'], primitiveTorus as CompatOp)
/** Project the vendored `ellipsoid(rx, ry, rz, options?)`. */
export const ellipsoid = wrapDual('ellipsoid', ['rx', 'ry', 'rz'], primitiveEllipsoid as CompatOp)

import { fuse as vendoredFuse, cut as vendoredCut } from '../../vendored/brepjs/topology/api.js'
import {
  extrude as vendoredExtrude,
  revolve as vendoredRevolve,
  loft as vendoredLoft,
} from '../../vendored/brepjs/operations/api.js'

/** Fuse two shapeables into one 3D result. */
export const fuse = wrapGuarded('fuse', vendoredFuse)
/** Cut the second shapeable out of the first. */
export const cut = wrapGuarded('cut', vendoredCut)
/** Extrude a planar profile along a height or direction vector. */
export const extrude = wrapGuarded('extrude', vendoredExtrude)
/** Revolve a planar profile around an axis with optional angle. */
export const revolve = wrapGuarded('revolve', vendoredRevolve)
/** Loft through a set of wire profiles. */
export const loft = wrapGuarded('loft', vendoredLoft)

// ─────────────────────────────────────────────────────────────────────────────
// ② sub-shape queries + measurements
// ─────────────────────────────────────────────────────────────────────────────

export {
  getEdges,
  getFaces,
  getWires,
  getVertices,
  getShells,
  getSolids,
  getCompSolids,
  getBounds,
  vertexPosition,
} from '../../vendored/brepjs/topology/topologyQueryFns.js'

export type { Bounds3D } from '../../vendored/brepjs/topology/topologyQueryFns.js'

export {
  measureVolume,
  measureArea,
  measureLength,
} from '../../vendored/brepjs/measurement/measureFns.js'

// ─────────────────────────────────────────────────────────────────────────────
// ③ sketching DSL + drawing factories
// ─────────────────────────────────────────────────────────────────────────────

export { default as Sketcher } from '../../vendored/brepjs/sketching/sketcher.js'
export { default as FaceSketcher } from '../../vendored/brepjs/sketching/faceSketcher.js'

export {
  drawCircle,
  drawEllipse,
  drawRoundedRectangle,
  drawRectangle,
  drawSingleCircle,
  drawSingleEllipse,
  drawPolysides,
  drawText,
} from '../../vendored/brepjs/sketching/drawingFactories.js'

export { draw } from '../../vendored/brepjs/sketching/drawingPen.js'
export { makeBaseBox } from '../../vendored/brepjs/sketching/shortcuts.js'

// ─────────────────────────────────────────────────────────────────────────────
// ④ combinators / pure helpers / types
// ─────────────────────────────────────────────────────────────────────────────

export {
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
} from '../../vendored/brepjs/core/result.js'
export type { Result, Ok, Err } from '../../vendored/brepjs/core/result.js'

export {
  vecAdd,
  vecSub,
  vecScale,
  vecDot,
  vecCross,
  vecLength,
  vecNormalize,
} from '../../vendored/brepjs/core/vecOps.js'

export {
  createPlane,
  createNamedPlane,
  resolvePlane,
} from '../../vendored/brepjs/core/planeOps.js'

export { kernelError, validationError } from '../../vendored/brepjs/core/errors.js'

export { DEG2RAD, RAD2DEG } from '../../vendored/brepjs/core/constants.js'

export type {
  Vertex,
  Edge,
  Wire,
  Face,
  Shell,
  Solid,
  CompSolid,
  Shape3D,
} from '../../vendored/brepjs/core/shapeTypes.js'

export type { Plane, PlaneName, PlaneInput } from '../../vendored/brepjs/core/planeTypes.js'

export type { Vec3, PointInput } from '../../vendored/brepjs/core/types.js'