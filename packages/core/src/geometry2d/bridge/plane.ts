/**
 * Plane frame helpers for 2D→3D placement (pure TS, no kernel, no `api/` import).
 *
 * A {@link Plane} carries an origin plus a right-handed, orthonormal frame
 * `xDir / yDir / zDir` where `zDir` is the plane normal — the same semantic as
 * the kernel `gp_Ax3` frame and the `createPlane` helper in `api/geom-types`.
 * The bridge may **not** import `api/` (plan rule against a cycle), so this
 * module re-derives the framing math self-containedly. Points use the
 * `{ x, y, z }` shape compatible with the BREP engine's neutral `BrepVec3`.
 * @module
 */

/** A 3D point / vector (neutral {x,y,z} shape, kernel-compatible). */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/** User-facing 3D input: `{x,y,z}` object or `[x,y,z]` array (the script form). */
export type Vec3Input = Vec3 | readonly [number, number, number]

/**
 * Normalize a raw script- or API-facing 3D input to the canonical `{x,y,z}`.
 * Accepts both the array form (`[1,0,0]`, as produced by `.fai.js` literals)
 * and the object form (`{x,y,z}`, used by the bridge internals).
 * @param v - the input 3D value.
 * @returns the canonical vector.
 */
export function toVec3(v: Vec3Input): Vec3 {
  if (Array.isArray(v)) return { x: v[0]!, y: v[1]!, z: v[2]! }
  const o = v as Vec3
  return { x: o.x, y: o.y, z: o.z }
}

/**
 * A right-handed, orthonormal plane frame: an origin plus `xDir`/`yDir` (in-plane
 * axes) and `zDir` (the normal). 2D `(x, y)` maps to `origin + x*xDir + y*yDir`.
 */
export interface Plane {
  /** The plane's anchor point (the 2D origin maps here). */
  readonly origin: Vec3
  /** The in-plane X axis (maps the 2D +X). */
  readonly xDir: Vec3
  /** The in-plane Y axis (maps the 2D +Y). */
  readonly yDir: Vec3
  /** The plane normal (2D +Z after placement). */
  readonly zDir: Vec3
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function norm(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
}

function normalize(v: Vec3): Vec3 {
  const len = norm(v)
  return len > 1e-14 ? { x: v.x / len, y: v.y / len, z: v.z / len } : { x: 1, y: 0, z: 0 }
}

/**
 * Build a right-handed plane frame from an origin, a normal, and an optional
 * in-plane X direction. The X direction is auto-derived (least-aligned-axis
 * cross product) when omitted, mirroring the kernel `gp_Ax3` convention.
 * @param origin - the plane origin (2D origin maps here).
 * @param normal - the plane normal (becomes the zDir); must be non-zero.
 * @param xDir - optional explicit in-plane X; auto-derived when omitted.
 * @returns the orthonormal plane frame.
 */
export function makePlane(origin: Vec3Input, normal: Vec3Input, xDir?: Vec3Input): Plane {
  const o = toVec3(origin)
  const z = normalize(toVec3(normal))
  let x: Vec3
  if (xDir) {
    x = normalize(toVec3(xDir))
  } else {
    const ax = Math.abs(z.x), ay = Math.abs(z.y), az = Math.abs(z.z)
    const cand: Vec3 =
      ax <= ay && ax <= az ? { x: 1, y: 0, z: 0 } : ay <= az ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 }
    x = normalize(cross(cand, z))
  }
  const y = normalize(cross(z, x))
  return { origin: o, xDir: x, yDir: y, zDir: z }
}

/** Named CAD planes with their canonical frames (origin defaults to [0,0,0]). */
const NAMED_PLANES: Record<string, { xDir: Vec3; zDir: Vec3 }> = {
  XY: { xDir: { x: 1, y: 0, z: 0 }, zDir: { x: 0, y: 0, z: 1 } },
  XZ: { xDir: { x: 1, y: 0, z: 0 }, zDir: { x: 0, y: -1, z: 0 } },
  YZ: { xDir: { x: 0, y: 1, z: 0 }, zDir: { x: 1, y: 0, z: 0 } },
  front: { xDir: { x: 1, y: 0, z: 0 }, zDir: { x: 0, y: 0, z: 1 } },
  back: { xDir: { x: -1, y: 0, z: 0 }, zDir: { x: 0, y: 0, z: -1 } },
  left: { xDir: { x: 0, y: 0, z: 1 }, zDir: { x: -1, y: 0, z: 0 } },
  right: { xDir: { x: 0, y: 0, z: -1 }, zDir: { x: 1, y: 0, z: 0 } },
  top: { xDir: { x: 1, y: 0, z: 0 }, zDir: { x: 0, y: 1, z: 0 } },
  bottom: { xDir: { x: 1, y: 0, z: 0 }, zDir: { x: 0, y: -1, z: 0 } },
}

/**
 * Resolve a named plane (e.g. `'XY'` / `'XZ'` / `'top'`) to a frame at a given
 * origin. Unknown names throw.
 * @param name - the canonical plane name.
 * @param origin - the plane origin (default [0,0,0]).
 * @returns the plane frame.
 */
export function namedPlane(name: string, origin: Vec3Input = { x: 0, y: 0, z: 0 }): Plane {
  const cfg = NAMED_PLANES[name]
  if (!cfg) throw new Error(`unknown plane '${name}' (expected XY | XZ | YZ | front/back/left/right/top/bottom)`)
  return makePlane(toVec3(origin), cfg.zDir, cfg.xDir)
}

/**
 * Map a 2D point `(x, y)` into 3D on a plane frame:
 * `origin + x*xDir + y*yDir`. This is the per-point lift used by curve lifting.
 * @param plane - the target plane.
 * @param x - the 2D `x` coordinate.
 * @param y - the 2D `y` coordinate.
 * @returns the 3D point on the plane.
 */
export function liftPointToPlane(plane: Plane, x: number, y: number): Vec3 {
  const { origin: o, xDir: u, yDir: v } = plane
  return { x: o.x + x * u.x + y * v.x, y: o.y + x * u.y + y * v.y, z: o.z + x * u.z + y * v.z }
}
/**
 * Project a 3D point onto a plane's 2D coordinates — the inverse of
 * {@link liftPointToPlane}. Computes `d = p − origin` and returns
 * `(u, v) = (d·xDir, d·yDir)`. Because `xDir`/`yDir` are orthonormal this is the
 * orthogonal projection: the component of `d` along `zDir` (the plane normal) is
 * dropped. A point already on the plane round-trips losslessly
 * (`worldToPlane(plane, liftPointToPlane(plane, u, v)) === {u, v}`); a point off
 * the plane projects to the foot of the perpendicular — the same behaviour as
 * dropping a sketch point onto its supporting face.
 * @param plane - the supporting plane frame.
 * @param p - the 3D point to project.
 * @returns the 2D `{ u, v }` coordinates on the plane.
 */
export function worldToPlane(plane: Plane, p: Vec3Input): { u: number; v: number } {
  const { origin: o, xDir: u, yDir: v } = plane
  const q = toVec3(p)
  const d: Vec3 = { x: q.x - o.x, y: q.y - o.y, z: q.z - o.z }
  return { u: dot(d, u), v: dot(d, v) }
}