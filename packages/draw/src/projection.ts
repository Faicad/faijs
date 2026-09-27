/**
 * projection — 3D outline → 2D `Blueprint` (C4).
 *
 * `drawProjection` / `drawFaceOutline` project 3D wires (closed outlines on a
 * plane) onto the plane's 2D frame and rebuild them as plotted `Blueprint`s, so
 * an existing 3D contour can be re-skied as a sketch and placed/extruded again.
 * This is a purity-preserving, kernel-free inverse of core's
 * `liftPointToPlane` on the same plane frame. Imports core `geometry2d` only.
 *
 * @module
 */

import {
  Blueprint,
  BlueprintSketcher,
  type Point2,
} from '@faicad/faijs/geometry2d'
import { namedPlane, type Plane, type Vec3 } from '@faicad/faijs/geometry2d/bridge/plane'

/** A projection target: a plane frame or the name of a named plane. */
export type PlaneOrName = Plane | string

/**
 * Project a 3D point into a plane's frame coordinates.
 * @param plane - the target plane frame.
 * @param p - the 3D point to project.
 * @returns the in-plane 2D coordinates `(x, y)`.
 */
export function projectPointToPlane(plane: Plane, p: Vec3): Point2 {
  const dx = p.x - plane.origin.x
  const dy = p.y - plane.origin.y
  const dz = p.z - plane.origin.z
  const x = dx * plane.xDir.x + dy * plane.xDir.y + dz * plane.xDir.z
  const y = dx * plane.yDir.x + dy * plane.yDir.y + dz * plane.yDir.z
  return [x, y]
}

/**
 * Project an ordered 3D wire onto a plane frame.
 * @param plane - the target plane frame.
 * @param wire - the ordered 3D points of the wire.
 * @returns the projected 2D points in the same order.
 */
export function projectWire(plane: Plane, wire: readonly Vec3[]): Point2[] {
  return wire.map((p) => projectPointToPlane(plane, p))
}

/**
 * Resolve a plane target to a frame.
 * @param planeOrName - a plane frame or a named-plane string.
 * @returns the resolved plane frame.
 */
function resolve(planeOrName: PlaneOrName): Plane {
  return typeof planeOrName === 'string' ? namedPlane(planeOrName) : planeOrName
}

/**
 * Plot a projected wire as a closed contour on the pen.
 * @param pen - the session pen to draw into.
 * @param pts - the ordered projected 2D points.
 * @param close - whether to force-close the contour (default true).
 */
function plotWire(pen: BlueprintSketcher, pts: Point2[], close: boolean): void {
  if (pts.length === 0) return
  pen.movePointerTo(pts[0]!)
  for (let i = 1; i < pts.length; i++) {
    pen.lineTo(pts[i]!)
  }
  if (close) pen.close()
}

/**
 * Project a single closed 3D outline (a face wire) into a `Blueprint`.
 * @param planeOrName - the target plane (frame or named-plane string).
 * @param wire - the closed 3D outline to project.
 * @returns a closed 2D `Blueprint` of the projected outline.
 */
export function drawFaceOutline(planeOrName: PlaneOrName, wire: readonly Vec3[]): Blueprint {
  const p = resolve(planeOrName)
  const pts = projectWire(p, wire)
  const pen = new BlueprintSketcher()
  plotWire(pen, pts, true)
  return new Blueprint(pen.close())
}

/**
 * Project an ordered set of 3D wires (islands / holes) onto a `Blueprint`.
 * Each wire is plotted as a closed contour in the given order.
 * @param plane - the plane (frame or name) onto which to project.
 * @param wires - the ordered closed 3D wires to project.
 * @returns a `Blueprint` of the projected contours.
 */
export function drawProjection(plane: PlaneOrName, wires: readonly (readonly Vec3[])[]): Blueprint {
  const p = resolve(plane)
  const pen = new BlueprintSketcher()
  for (const wire of wires) {
    plotWire(pen, projectWire(p, wire), true)
  }
  return new Blueprint(pen.close())
}