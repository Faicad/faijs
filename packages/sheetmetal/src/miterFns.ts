import { getBounds } from './geometryOps.js';
import type { Solid } from './types.js';
import { translate } from './geometryOps.js';
import {type Result, type Vec3, ok, err, kernelError, validationError, box, cut, rotate, vecSub, vecAdd, vecScale, vecCross, vecDot, vecNormalize} from '@faicad/faijs/api';
import type { SheetMetalPart } from './types.js';
import { normalizeSolid } from './internal.js';

/** An oriented cutting plane: material on the `+normal` side is removed. */
export interface MiterPlane {
  origin: Vec3;
  normal: Vec3;
}

/**
 * General miter primitive: cut a sheet-metal part by a plane, removing the
 * material on the `+normal` side. The tool is a half-space block sized to the
 * part's bounding box, so the cut is exact regardless of part extent.
 *
 * @param part - the sheet metal part to cut.
 * @param plane - the miter plane definition.
 * @returns the updated part with the miter cut applied, or an error.
 */
export async function miterCut(part: SheetMetalPart, plane: MiterPlane): Promise<Result<SheetMetalPart>> {
  const solid = part.solid;
  if (solid === undefined) {
    return err(validationError('NO_SOLID', 'miterCut: part has no folded solid to cut'));
  }
  let solidOut: Solid;
  try {
    const tool = await halfSpaceTool(solid, plane);
    if (!tool.ok) return tool;
    solidOut = normalizeSolid((await cut(solid, tool.value)) as Solid);
  } catch (e) {
    return err(kernelError('CUT_FAILED', `miter cut: ${e instanceof Error ? e.message : String(e)}`));
  }

  return ok({ ...part, solid: solidOut });
}

/**
 * Auto corner-miter between two adjacent flanges. The miter plane bisects the two
 * flanges' fold-up directions at their shared corner and is offset by half the gap,
 * so the cut falls on the flat/flange regions and never crosses a bend patch. The
 * single bisector cut trims both flanges to a clean mitered corner.
 *
 * @param part - the sheet metal part to miter.
 * @param flangeIdA - the first flange ID.
 * @param flangeIdB - the second flange ID.
 * @param gap - the gap between flanges (default 0).
 * @returns the updated part with the miter corner applied, or an error.
 */
export async function autoMiterCorner(
  part: SheetMetalPart,
  flangeIdA: string,
  flangeIdB: string,
  gap = 0
): Promise<Result<SheetMetalPart>> {
  if (part.solid === undefined) {
    return err(validationError('NO_SOLID', 'autoMiterCorner: part has no folded solid'));
  }
  if (!Number.isFinite(gap) || gap < 0) {
    return err(validationError('INVALID_GAP', `miter gap must be a finite, non-negative number, got ${gap}`));
  }
  const bendA = part.bends.find((b) => b.id === flangeIdA);
  const bendB = part.bends.find((b) => b.id === flangeIdB);
  if (bendA === undefined || bendB === undefined) {
    return err(
      validationError('UNKNOWN_FLANGE', `autoMiterCorner: flange '${flangeIdA}' or '${flangeIdB}' not found`)
    );
  }

  const axisA = vecNormalize(bendA.axisDir);
  const axisB = vecNormalize(bendB.axisDir);
  const corner = cornerPoint(bendA.axisOrigin, axisA, bendB.axisOrigin, axisB);

  // Each flange runs perpendicular to its own bend axis. The miter plane contains
  // the corner and is spanned by the two bend axes; its normal is their bisector in
  // the run plane, which is exactly the bisector of the two flange run directions.
  const planeNormal = miterNormal(axisA, axisB);
  if (planeNormal === undefined) {
    return err(
      validationError('PARALLEL_FLANGES', 'autoMiterCorner: flange bend axes are parallel; no corner to miter')
    );
  }
  const origin = vecAdd(corner, vecScale(planeNormal, gap * 0.5));

  const cutResult = await miterCut(part, { origin, normal: planeNormal });
  if (!cutResult.ok) return cutResult;

  return ok({
    ...cutResult.value,
    miters: [...(part.miters ?? []), { flangeA: flangeIdA, flangeB: flangeIdB, gap }],
  });
}

/** Point on the line of bend A closest to the line of bend B (their shared corner). */
function cornerPoint(originA: Vec3, dirA: Vec3, originB: Vec3, dirB: Vec3): Vec3 {
  const w0 = vecSub(originA, originB);
  const a = vecDot(dirA, dirA);
  const b = vecDot(dirA, dirB);
  const c = vecDot(dirB, dirB);
  const d = vecDot(dirA, w0);
  const e = vecDot(dirB, w0);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-9) return originA;
  const sc = (b * e - c * d) / denom;
  return vecAdd(originA, vecScale(dirA, sc));
}

/**
 * Normal of the miter plane between two flanges whose bend axes are `dirA`/`dirB`.
 * The plane is spanned by the two axes (it contains the corner edge of each
 * flange); its normal is `dirA × dirB` rotated to bisect — equivalently the
 * normalized sum of the two run directions, which both lie perpendicular to the
 * respective axis in the part's run plane.
 */
function miterNormal(dirA: Vec3, dirB: Vec3): Vec3 | undefined {
  const cross = vecCross(dirA, dirB);
  if (Math.hypot(cross[0], cross[1], cross[2]) < 1e-9) return undefined;
  const sum = vecAdd(dirA, dirB);
  if (Math.hypot(sum[0], sum[1], sum[2]) < 1e-9) return vecNormalize(cross);
  return vecNormalize(sum);
}

const Z_AXIS: Vec3 = [0, 0, 1];

async function halfSpaceTool(solid: Solid, plane: MiterPlane): Promise<Result<Solid>> {
  const normal = vecNormalize(plane.normal);
  if (Math.hypot(normal[0], normal[1], normal[2]) < 1e-9) {
    return err(validationError('INVALID_PLANE', 'miter plane normal must be non-zero'));
  }

  const b = getBounds(solid);
  const diag = Math.hypot(b.xMax - b.xMin, b.yMax - b.yMin, b.zMax - b.zMin);
  const size = diag * 2 + 2;

  // A cube whose bottom (−Z) face lies on the XY plane through the origin, extending
  // up in +Z, then rotated so +Z maps onto the plane normal and translated onto the
  // plane origin. After alignment its open boundary is the miter plane and its body
  // fills the +normal half-space.
  try {
    let tool: Solid = (await box({ width: size, depth: size, height: size })) as Solid;
    tool = (await translate(tool, [-size / 2, -size / 2, 0])) as Solid;

    const aligned = await alignZTo(tool, normal);
    return ok((await translate(aligned, plane.origin)) as Solid);
  } catch (e) {
    return err(kernelError('MITER_TOOL_FAILED', `half-space tool: ${e instanceof Error ? e.message : String(e)}`));
  }
}

/** Rotate a shape so its local +Z axis points along `target` (about the origin). */
async function alignZTo(shape: Solid, target: Vec3): Promise<Solid> {
  const dot = vecDot(Z_AXIS, target);
  if (dot > 1 - 1e-9) return shape;
  if (dot < -1 + 1e-9) {
    return (await rotate(shape, 180, { at: [0, 0, 0], axis: [1, 0, 0] })) as Solid;
  }
  const axis = vecNormalize(vecCross(Z_AXIS, target));
  const angleDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
  return (await rotate(shape, angleDeg, { at: [0, 0, 0], axis })) as Solid;
}
