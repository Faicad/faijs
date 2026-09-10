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

/**
 * Project the vendored `sphere(radius, options?)` verbatim (P25: the raw
 * morph form is what portable libraries call — upstream brepjs signatures,
 * no op projection).
 */
export { primitiveSphere as sphere }
/** Project the vendored `cylinder(radius, height, options?)` verbatim. */
export { primitiveCylinder as cylinder }
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

import {
  fuse as vendoredFuse,
  cut as vendoredCut,
  intersect as vendoredIntersect,
  fillet as vendoredFillet,
  chamfer as vendoredChamfer,
  simplify as vendoredSimplify,
} from '../../vendored/brepjs/topology/api.js'
import {
  makeCompound as vendoredMakeCompound,
  makeVertex as vendoredMakeVertex,
} from '../../vendored/brepjs/topology/solidBuilders.js'
import { applyMatrix as vendoredApplyMatrix } from '../../vendored/brepjs/topology/transformFns.js'
import {
  makeCircle as vendoredMakeCircle,
  makeEllipse as vendoredMakeEllipse,
  makeLine as vendoredMakeLine,
  makeThreePointArc as vendoredMakeThreePointArc,
  makeTangentArc as vendoredMakeTangentArc,
  makeBSplineInterpolation as vendoredMakeBSplineInterpolation,
  assembleWire as vendoredAssembleWire,
} from '../../vendored/brepjs/topology/curveBuilders.js'
import {
  curveTangentAt as vendoredCurveTangentAt,
  curvePointAt as vendoredCurvePointAt,
} from '../../vendored/brepjs/topology/curveFns.js'
import {
  makeFace as vendoredMakeFace,
  addHolesInFace as vendoredAddHolesInFace,
} from '../../vendored/brepjs/topology/surfaceBuilders.js'
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

/** Intersect two shapeables (common 3D volume). */
export const intersect = wrapGuarded('intersect', vendoredIntersect)

/**
 * Fillet all edges (2-arg form) or selected edges (3-arg form: edge array /
 * finder) of a valid solid. Selection form:
 * `fillet(shape, edgeHandles, radius)`.
 */
export const fillet = wrapGuarded('fillet', vendoredFillet)

/**
 * Chamfer all edges (2-arg form) or selected edges (3-arg form) of a valid
 * solid. Selection form: `chamfer(shape, edgeHandles, distance)` where
 * distance is a symmetric length or an asymmetric `[d1, d2]` pair.
 */
export const chamfer = wrapGuarded('chamfer', vendoredChamfer)

/**
 * Group shapes into a single Compound: `makeCompound(shapeArray)` (the
 * analogue of CadQuery's multi-solid compounds).
 */
export const makeCompound = wrapGuarded('makeCompound', vendoredMakeCompound)
/** Single vertex at a point: `makeVertex([x, y, z])` (upstream `vertex(x, y, z)`). */
export const makeVertex = wrapGuarded('makeVertex', vendoredMakeVertex)

/**
 * Apply a rigid affine transform to ANY shape — including compounds, which the
 * faijs `cad.translate` / `cad.rotate_euler` ops reject ("input is not BREP",
 * they require a solid). Needed by CadQuery's `Shape.moved(*locs)`, which can
 * move a multi-solid compound as a whole.
 *
 * Accepts the `{ linear, translation }` form of `MatrixInput`: `linear` is the
 * row-major 3x3 rotation, `translation` is applied after it (p -> R·p + t).
 */
export const applyMatrix = wrapGuarded('applyMatrix', vendoredApplyMatrix)

/**
 * Merge same-domain faces/edges (unifySameDomain) — the analogue of
 * CadQuery's `clean=True` boolean post-processing.
 */
export const simplify = wrapGuarded('simplify', vendoredSimplify)

// ── 2D profile construction (CadQuery pending-wire parity) ────────────────
// Circles/lines → edges → wires → (holed) faces. These are the building blocks
// CadQuery uses for its `pendingWires` stack: an outer wire plus zero or more
// inner wires becomes ONE face with holes, which is then extruded. Without
// `makeFace(wire, holes)` a nested `circle(4).circle(2)` would have to be
// approximated by a boolean difference and would not match upstream topology.

/** Circular edge: `makeCircle(radius, center?, normal?)` — closed, planar. */
export const makeCircle = wrapGuarded('makeCircle', vendoredMakeCircle)
/** Elliptical edge: `makeEllipseEdge(majorRadius, minorRadius, center?, normal?, xDir?)`. Returns a `Result`. */
export const makeEllipseEdge = wrapGuarded('makeEllipseEdge', vendoredMakeEllipse)
/** Straight edge from `v1` to `v2`. */
export const makeLine = wrapGuarded('makeLine', vendoredMakeLine)
/** Assemble edges/wires into a single connected wire. Returns a `Result`. */
export const assembleWire = wrapGuarded('assembleWire', vendoredAssembleWire)
/** Planar face from a closed wire, optionally with hole wires. Returns a `Result`. */
export const makeFace = wrapGuarded('makeFace', vendoredMakeFace)
/** Punch hole wires into an existing face. */
export const addHolesInFace = wrapGuarded('addHolesInFace', vendoredAddHolesInFace)
/** Circular arc edge through three points (start, mid, end). */
export const makeThreePointArc = wrapGuarded('makeThreePointArc', vendoredMakeThreePointArc)
/** Circular arc edge from a start point + start tangent to an end point. */
export const makeTangentArc = wrapGuarded('makeTangentArc', vendoredMakeTangentArc)
/** Interpolated cubic B-spline edge through every input point. Returns a `Result`. */
export const makeBSplineInterpolation = wrapGuarded('makeBSplineInterpolation', vendoredMakeBSplineInterpolation)
/** Tangent vector of an edge/wire curve at a normalized position (1 = end). */
export const curveTangentAt = wrapGuarded('curveTangentAt', vendoredCurveTangentAt)
/** Point on an edge/wire curve at a normalized position. */
export const curvePointAt = wrapGuarded('curvePointAt', vendoredCurvePointAt)

// ─────────────────────────────────────────────────────────────────────────────
// ①b library-building factories (P24, §8.1): spur gears, planetary trains, threads.
// Both morphs of these factories are brep-only builders gated by the single-kernel
// assert (wrapGuarded); the kernel is bound at the host boundary (D10).
// ─────────────────────────────────────────────────────────────────────────────

import {
  makeExternalGear as vendoredMakeExternalGear,
  makeInternalGear as vendoredMakeInternalGear,
  makePlanetaryGear as vendoredMakePlanetaryGear,
} from '../../vendored/brepjs/gear/gearFns.js'
import { thread as vendoredThread } from '../../vendored/brepjs/operations/threadFns.js'

/**
 * Build an external spur gear.
 * @param params - the external-gear parameters (`teeth`, `moduleSize`, `thickness`, …).
 * @returns `Ok` with the gear solid + geometry, or `Err` for invalid parameters.
 */
export const makeExternalGear = wrapGuarded('makeExternalGear', vendoredMakeExternalGear)
/**
 * Build an internal (ring) spur gear.
 * @param params - the internal-gear parameters, including the optional ring wall thickness.
 * @returns `Ok` with the gear solid + geometry, or `Err` for invalid parameters.
 */
export const makeInternalGear = wrapGuarded('makeInternalGear', vendoredMakeInternalGear)
/**
 * Build a planetary gear train (sun + planets + ring).
 * @param params - the planetary-gear parameters.
 * @returns `Ok` with the sun/planet/ring solids and mesh diagnostics, or `Err`.
 */
export const makePlanetaryGear = wrapGuarded('makePlanetaryGear', vendoredMakePlanetaryGear)
/**
 * Build a helical screw-thread ridge.
 * @param options - the thread profile (`radius`, `pitch`, `height`, …).
 * @returns `Ok` with the thread-ridge solid, or `Err` for invalid parameters.
 */
export const thread = wrapGuarded('thread', vendoredThread)

export type {
  ExternalGearParams,
  InternalGearParams,
  PlanetaryGearParams,
  GearResult,
  PlanetaryGearAssembly,
} from '../../vendored/brepjs/gear/gearFns.js'
export type { ThreadOptions } from '../../vendored/brepjs/operations/threadFns.js'

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
  map,
  andThen,
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
export type { BrepError } from '../../vendored/brepjs/core/errors.js'

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
  ValidSolid,
  ClosedWire,
  AnyShape,
} from '../../vendored/brepjs/core/shapeTypes.js'

export type { GearGeometry } from '../../vendored/brepjs/gear/gearMath.js'

export type { Plane, PlaneName, PlaneInput } from '../../vendored/brepjs/core/planeTypes.js'

export type { Vec3, PointInput } from '../../vendored/brepjs/core/types.js'

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ raw 2D-morph + transform + face ports (P25: sheetmetal 单一说明符面)
//
// The sheetmetal authoring path consumes the vendored morph semantics exactly
// (handles in, handles out, `Result` only where the vendored chain returns
// one). These are projected verbatim from the ported tree — same names, same
// signatures as upstream brepjs — so portable library sources only change the
// import specifier line (§8.2).
// ─────────────────────────────────────────────────────────────────────────────

import {
  line as rawLine,
  wire as rawWire,
  wireLoop as rawWireLoop,
  face as rawFace,
  polygon as rawPolygon,
} from '../../vendored/brepjs/topology/primitiveFns.js'
import {
  outerWire as rawOuterWire,
  getSurfaceType as rawSurfaceType,
  pointOnSurface as rawPointOnSurface,
  normalAt as rawNormalAt,
  faceCenter as rawFaceCenter,
} from '../../vendored/brepjs/topology/faceFns.js'
import { sharedEdges as rawSharedEdges } from '../../vendored/brepjs/topology/adjacencyFns.js'
import {
  curveStartPoint as rawCurveStartPoint,
  curveEndPoint as rawCurveEndPoint,
} from '../../vendored/brepjs/topology/curveFns.js'
import { translate as rawTranslate } from '../../vendored/brepjs/topology/transformFns.js'
import { rotate as rawRotate } from '../../vendored/brepjs/topology/transformFns.js'
import { isSolid as rawIsSolid } from '../../vendored/brepjs/core/shapeTypes.js'
import { isPlanarWire as rawIsPlanarWire } from '../../vendored/brepjs/core/validityTypes.js'
import { isValid as rawIsValid } from '../../vendored/brepjs/topology/healingFns.js'
import type { AnyShape } from '../../vendored/brepjs/core/shapeTypes.js'
import type { Vec3 } from '../../vendored/brepjs/core/types.js'

export {
  rawLine as line,
  rawWire as wire,
  rawWireLoop as wireLoop,
  rawFace as face,
  rawPolygon as polygon,
  rawOuterWire as outerWire,
  rawSurfaceType as getSurfaceType,
  rawPointOnSurface as pointOnSurface,
  rawNormalAt as normalAt,
  rawFaceCenter as faceCenter,
  rawSharedEdges as sharedEdges,
  rawCurveStartPoint as curveStartPoint,
  rawCurveEndPoint as curveEndPoint,
  rawTranslate as translate,
  rawIsSolid as isSolid,
  rawIsPlanarWire as isPlanarWire,
  rawIsValid as isValid,
}

// Upstream brepjs 18's `rotate` takes an axis through an `{ at, axis }` options
// object; the vendored tree (P5-locked commit) is the four-argument positional
// form. Export the upstream-aligned wrap so library code written for brepjs
// rotates with `rotate(shape, angle, { at?, axis? })`.
/**
 * Rotate a shape by an angle in degrees around an axis.
 * @param shape - The shape to rotate.
 * @param angle - Rotation angle in degrees.
 * @param options - Axis and pivot (`at`) for the rotation; defaults to the Z
 * axis through the origin, matching upstream brepjs.
 * @returns A new rotated shape.
 */
export function rotate<T extends AnyShape>(
  shape: T,
  angle: number,
  options: { at?: Vec3; axis?: Vec3 } = {}
): T {
  return rawRotate(shape, angle, options.at ?? [0, 0, 0], options.axis ?? [0, 0, 1]);
}