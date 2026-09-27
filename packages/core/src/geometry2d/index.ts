/**
 * geometry2d — faijs pure-2D analytic curve geometry base (L1).
 *
 * Ported from brepjs (Apache-2.0), discriminant renamed `__bk2d` → `kind2d`.
 * Zero-dependency pure TS used by `cad.profile`, the draw/sketch packages, the
 * 2D→3D bridge, and SVG-oriented processing.
 *
 * @module
 */
export * from './curve2d'
export * from './bbox2d'
export * from './blueprint'
export * from './compound-blueprint'
export * from './blueprints'
export * from './organise'