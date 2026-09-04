/**
 * Public API — short-named wrappers over the sheet-metal `*Fns` modules.
 *
 * These are the canonical entry points for the domain: they delegate to the
 * underlying functional implementations without re-deriving any geometry, and
 * preserve the `Result<T>` / warning-channel contract end to end. The fluent
 * `sheetMetal()` facade in `./facade.js` is built on top of these.
 */

import { ok, err, validationError, type Result, type Solid } from '@faicad/faijs/compat';
import {
  authorPart as authorPartFn,
  type AuthorSpec,
  type FlangeSpec,
} from './authorFns.js';
import { unfold as unfoldFn } from './unfoldFns.js';
import { unfoldForeignSolid as unfoldForeignSolidFn } from './foreignUnfoldFns.js';
import { fold as foldFn } from './foldFns.js';
import {
  miterCut as miterCutFn,
  autoMiterCorner as autoMiterCornerFn,
  type MiterPlane,
} from './miterFns.js';
import {
  addBendRelief as addBendReliefFn,
  autoBendReliefs as autoBendReliefsFn,
  cornerRelief as cornerReliefFn,
} from './reliefFns.js';
import {
  addCutout as addCutoutFn,
  addHole as addHoleFn,
  addSlot as addSlotFn,
  addPolygonCutout as addPolygonCutoutFn,
} from './cutoutFns.js';
import {
  addTab as addTabFn,
  tabAndSlot as tabAndSlotFn,
  type SlotPlacement,
} from './tabFns.js';
import { louver as louverFn, emboss as embossFn } from './formFns.js';
import { authorContourFlange as authorContourFlangeFn } from './contourFlangeFns.js';
import { authorLoftedFlange as authorLoftedFlangeFn } from './loftedFlangeFns.js';
import { hem as hemFn } from './hemFns.js';
import { jog as jogFn } from './jogFns.js';
import { flatPatternToDXF as flatPatternToDXFFn, type DxfOptions } from './dxfFns.js';
import {
  nest as nestFn,
  nestToDXF as nestToDXFFn,
  type NestOptions,
  type NestResult,
} from './nestFns.js';
import {
  buildReport as buildReportFn,
  reportFromUnfold as reportFromUnfoldFn,
  reportToJSON as reportToJSONFn,
} from './reportFns.js';
import { validatePart as validatePartFn } from './validateFns.js';
import { bendAllowance as bendAllowanceFn, developedLength as developedLengthFn } from './allowanceFns.js';
import {
  registerBendTable as registerBendTableFn,
  getBendTable as getBendTableFn,
  resolveBendAllowance as resolveBendAllowanceFn,
  type BendTable,
} from './bendTableFns.js';
import type {
  SheetMetalPart,
  FlatPattern,
  FlatInput,
  BendReport,
  BendRule,
  ReliefSpec,
  CutoutSpec,
  TabSpec,
  ContourFlangeSpec,
  LoftedFlangeSpec,
  HemSpec,
  JogSpec,
  UnfoldResult,
  SheetMetalWarning,
} from './types.js';

/**
 * Author a straight-bend part: a base flat plus folded-up flanges.
 * @param spec - the part definition: base flat, material thickness, and the flange list to fold up.
 * @returns a `Result<SheetMetalPart>` carrying the authored part, or the first error encountered.
 */
export function author(spec: AuthorSpec): Result<SheetMetalPart> {
  return authorPartFn(spec);
}

/**
 * Extract the lone 3D solid of an authored part as its own `Result` terminal.
 *
 * `author`/`fold`/`hem` return the data model `SheetMetalPart`; its `.solid`
 * field is the authored BREP solid. `.fai.js` statements cannot read nested
 * member expressions (`p1.solid`), so this explicit terminal is the sanctioned
 * way to pull the geometry out of a part.
 * @param part - the sheet-metal part carrying the authored solid.
 * @returns `Ok` with the part's surface, or `Err` (`NO_SOLID`) when the part
 * has no authored solid yet (e.g. it was only built by `flatPattern`).
 */
export function solidOf(part: SheetMetalPart): Result<Solid> {
  return part.solid ? ok(part.solid) : err(validationError('NO_SOLID', 'part has no authored solid'));
}

/**
 * Flatten an authored part into a developed flat pattern + bend report + warnings.
 * @param part - the authored sheet-metal part to flatten.
 * @returns a `Result<UnfoldResult>` with the flat pattern, bend report, and any warnings.
 */
export function unfold(part: SheetMetalPart): Result<UnfoldResult> {
  return unfoldFn(part);
}

/**
 * Unfold an imported sheet-metal solid that has no feature tree, by detecting its
 * geometry (planar panels + cylindrical bends) numerically. `kFactor` defaults to
 * the mid-surface neutral axis (0.5); supply a known material's K-factor to match
 * its development.
 * @param solid - the imported solid (B-rep) to unfold.
 * @param opts - optional overrides; `opts.kFactor` sets the K-factor used for the bend allowance.
 * @returns a `Result<UnfoldResult>` with the detected flat pattern, report, and any warnings.
 */
export function unfoldSolid(solid: Solid, opts?: { kFactor?: number }): Result<UnfoldResult> {
  return unfoldForeignSolidFn(solid, opts);
}

/**
 * Fold a flat pattern (region-tree) up into a 3D part — the inverse of {@link unfold}.
 * @param input - the flat pattern (region tree) to fold up.
 * @returns a `Result<SheetMetalPart>` carrying the folded 3D part, or the first error.
 */
export function fold(input: FlatInput): Result<SheetMetalPart> {
  return foldFn(input);
}

/**
 * Cut a part by an oriented plane, removing material on the `+normal` side.
 * @param part - the sheet-metal part to cut.
 * @param plane - the oriented cutting plane; material on the plane's `+normal` side is removed.
 * @returns a `Result<SheetMetalPart>` carrying the mitered part, or the first error.
 */
export function miter(part: SheetMetalPart, plane: MiterPlane): Result<SheetMetalPart> {
  return miterCutFn(part, plane);
}

/**
 * Auto-miter the shared corner of two flanges with an optional gap.
 * @param part - the sheet-metal part whose corner is to be mitered.
 * @param flangeIdA - id of the first flange meeting at the corner.
 * @param flangeIdB - id of the second flange meeting at the corner.
 * @param gap - optional gap (in millimetres) left between the two mitered edges; defaults to 0.
 * @returns a `Result<SheetMetalPart>` carrying the mitered part, or the first error.
 */
export function miterCorner(
  part: SheetMetalPart,
  flangeIdA: string,
  flangeIdB: string,
  gap = 0
): Result<SheetMetalPart> {
  return autoMiterCornerFn(part, flangeIdA, flangeIdB, gap);
}

/**
 * Add a bend relief slot at each mid-edge end of a partial flange's bend line.
 * @param part - the sheet-metal part to modify.
 * @param flangeId - id of the partial flange whose bend-line ends get the relief.
 * @param spec - optional relief specification overriding the defaults.
 * @returns a `Result<SheetMetalPart>` carrying the part with the relief added, or the first error.
 */
export function bendRelief(
  part: SheetMetalPart,
  flangeId: string,
  spec?: ReliefSpec
): Result<SheetMetalPart> {
  return addBendReliefFn(part, flangeId, spec);
}

/**
 * Add a bend relief to every partial-span bend in the part.
 * @param part - the sheet-metal part to modify.
 * @param spec - optional relief specification applied to every partial bend.
 * @returns a `Result<SheetMetalPart>` carrying the part with all reliefs added, or the first error.
 */
export function autoReliefs(part: SheetMetalPart, spec?: ReliefSpec): Result<SheetMetalPart> {
  return autoBendReliefsFn(part, spec);
}

/**
 * Cut a corner relief notch at the shared corner of two adjacent flanges.
 * @param part - the sheet-metal part to modify.
 * @param flangeIdA - id of the first flange forming the corner.
 * @param flangeIdB - id of the second flange forming the corner.
 * @param spec - optional relief specification overriding the defaults.
 * @returns a `Result<SheetMetalPart>` carrying the part with the corner relief added, or the first error.
 */
export function relieveCorner(
  part: SheetMetalPart,
  flangeIdA: string,
  flangeIdB: string,
  spec?: ReliefSpec
): Result<SheetMetalPart> {
  return cornerReliefFn(part, flangeIdA, flangeIdB, spec);
}

/**
 * Punch a cutout (hole / slot / polygon) through a named flat region's thickness.
 * @param part - the sheet-metal part to modify.
 * @param spec - the cutout definition (kind, geometry, and target region).
 * @returns a `Result<SheetMetalPart>` carrying the part with the cutout punched, or the first error.
 */
export function addCutout(part: SheetMetalPart, spec: CutoutSpec): Result<SheetMetalPart> {
  return addCutoutFn(part, spec);
}

/**
 * Punch a circular hole of `diameter` centred at region-local `(x, y)`.
 * @param part - the sheet-metal part to modify.
 * @param region - name of the flat region the hole is punched through.
 * @param x - region-local X of the hole centre.
 * @param y - region-local Y of the hole centre.
 * @param diameter - hole diameter.
 * @returns a `Result<SheetMetalPart>` carrying the part with the hole punched, or the first error.
 */
export function addHole(
  part: SheetMetalPart,
  region: string,
  x: number,
  y: number,
  diameter: number
): Result<SheetMetalPart> {
  return addHoleFn(part, region, x, y, diameter);
}

/**
 * Punch a slot (rectangular or obround) centred at region-local `(x, y)`.
 * @param part - the sheet-metal part to modify.
 * @param region - name of the flat region the slot is punched through.
 * @param opts - slot geometry: centre `(x, y)`, `length`, `width`, optional `angleDeg` rotation, and `round` ends flag.
 * @returns a `Result<SheetMetalPart>` carrying the part with the slot punched, or the first error.
 */
export function addSlot(
  part: SheetMetalPart,
  region: string,
  opts: { x: number; y: number; length: number; width: number; angleDeg?: number; round?: boolean }
): Result<SheetMetalPart> {
  return addSlotFn(part, region, opts);
}

/**
 * Punch an arbitrary polygon cutout from its region-local `points`.
 * @param part - the sheet-metal part to modify.
 * @param region - name of the flat region the polygon is punched through.
 * @param points - region-local polygon vertices as `[x, y]` pairs.
 * @returns a `Result<SheetMetalPart>` carrying the part with the polygon cutout, or the first error.
 */
export function addPolygonCutout(
  part: SheetMetalPart,
  region: string,
  points: [number, number][]
): Result<SheetMetalPart> {
  return addPolygonCutoutFn(part, region, points);
}

/**
 * Fuse a rectangular tab (additive protrusion) onto a region's edge.
 * @param part - the sheet-metal part to modify.
 * @param spec - tab definition: edge, width, and length.
 * @returns a `Result<SheetMetalPart>` carrying the part with the tab added, or the first error.
 */
export function addTab(part: SheetMetalPart, spec: TabSpec): Result<SheetMetalPart> {
  return addTabFn(part, spec);
}

/**
 * Self-fixturing tab-and-slot joint: a tab on one region + a matching slot on another.
 * @param part - the sheet-metal part to modify.
 * @param tab - the tab to add to the first region.
 * @param slot - placement of the matching slot on the second region.
 * @returns a `Result<SheetMetalPart>` carrying the part with the joint added, or the first error.
 */
export function tabAndSlot(
  part: SheetMetalPart,
  tab: TabSpec,
  slot: SlotPlacement
): Result<SheetMetalPart> {
  return tabAndSlotFn(part, tab, slot);
}

/**
 * Form a louver (vent flap cut on 3 sides, formed up along the hinge) on a region.
 * @param part - the sheet-metal part to modify.
 * @param opts - louver geometry: target `region`, centre `(x, y)`, `length`, `width`, `height`, and optional `direction`.
 * @returns a `Result<SheetMetalPart>` carrying the part with the louver formed, or the first error.
 */
export function louver(
  part: SheetMetalPart,
  opts: {
    region: string;
    x: number;
    y: number;
    length: number;
    width: number;
    height: number;
    direction?: 'up' | 'down';
  }
): Result<SheetMetalPart> {
  return louverFn(part, opts);
}

/**
 * Form a round emboss (raised) or dimple (recessed) on a region.
 * @param part - the sheet-metal part to modify.
 * @param opts - emboss geometry: target `region`, centre `(x, y)`, `diameter`, `height`, and `kind` (`dimple` or `emboss`).
 * @returns a `Result<SheetMetalPart>` carrying the part with the form added, or the first error.
 */
export function emboss(
  part: SheetMetalPart,
  opts: { region: string; x: number; y: number; diameter: number; height: number; kind: 'dimple' | 'emboss' }
): Result<SheetMetalPart> {
  return embossFn(part, opts);
}

/**
 * Author a contour flange: an open line/arc profile swept along a base edge into a
 * multi-bend cross-section. The development is exact (Σ segment developed lengths).
 * @param part - the sheet-metal part the flange is added to.
 * @param spec - contour flange definition: profile, base edge, and bend parameters.
 * @returns a `Result<SheetMetalPart>` carrying the part with the contour flange added, or the first error.
 */
export function contourFlange(part: SheetMetalPart, spec: ContourFlangeSpec): Result<SheetMetalPart> {
  return authorContourFlangeFn(part, spec);
}

/**
 * Author a lofted / ruled transition flange between two parallel open profiles. The
 * development is by triangulation — exact for a developable transition, an
 * approximation (with a `DEVELOPMENT_APPROXIMATE` unfold warning) otherwise.
 * @param part - the sheet-metal part the flange is added to.
 * @param spec - lofted flange definition: the two open profiles and their alignment.
 * @returns a `Result<SheetMetalPart>` carrying the part with the lofted flange added, or the first error.
 */
export function loftedFlange(part: SheetMetalPart, spec: LoftedFlangeSpec): Result<SheetMetalPart> {
  return authorLoftedFlangeFn(part, spec);
}

/**
 * Author a hem: fold a region edge back ~180°+ onto its parent and run a short
 * return leg. The development is exact (Σ curl bend allowances + return length).
 * @param part - the sheet-metal part the hem is added to.
 * @param spec - hem definition: edge, curl radius, and return leg length.
 * @returns a `Result<SheetMetalPart>` carrying the part with the hem added, or the first error.
 */
export function hem(part: SheetMetalPart, spec: HemSpec): Result<SheetMetalPart> {
  return hemFn(part, spec);
}

/**
 * Author a jog (joggle): two opposite bends stepping the flat by `offsetHeight`
 * perpendicular to its plane, then continuing parallel. Development is exact.
 * @param part - the sheet-metal part the jog is added to.
 * @param spec - jog definition: bend line, offset height, and radii.
 * @returns a `Result<SheetMetalPart>` carrying the part with the jog added, or the first error.
 */
export function jog(part: SheetMetalPart, spec: JogSpec): Result<SheetMetalPart> {
  return jogFn(part, spec);
}

/**
 * Emit an annotated multi-layer DXF string for a flat pattern.
 * @param pattern - the flat pattern to serialize.
 * @param options - optional DXF output options (layers, precision, units).
 * @returns a `Result<string>` carrying the DXF text, or the first error.
 */
export function toDXF(pattern: FlatPattern, options?: DxfOptions): Result<string> {
  return flatPatternToDXFFn(pattern, options);
}

/**
 * Nest developed flat patterns onto stock sheets to reduce waste. The default
 * `strategy: "bbox"` packs each part as its outline bounding box (fast, no
 * interlocking). `strategy: "nfp"` is true-shape / no-fit-polygon nesting: the actual
 * outline polygons are packed so concave (L-shaped) parts interlock for higher
 * utilization. The NFP packer is a HEURISTIC (bottom-left-fill) — not provably
 * optimal — but never overlaps parts and never drops a part silently.
 * @param patterns - the flat patterns to place onto stock sheets.
 * @param options - nesting configuration: stock sheet size, strategy, and spacing.
 * @returns a `Result<NestResult>` carrying the placed sheets and part transforms, or the first error.
 */
export function nest(patterns: FlatPattern[], options: NestOptions): Result<NestResult> {
  return nestFn(patterns, options);
}

/**
 * Emit one fabrication-ready DXF for a single nested sheet (all parts placed).
 * @param result - the nesting result containing the sheet to render.
 * @param patterns - the original flat patterns referenced by `result`.
 * @param sheetIndex - index of the nested sheet to emit.
 * @param options - optional DXF output options (layers, precision, units).
 * @returns a `Result<string>` carrying the DXF text, or the first error.
 */
export function nestToDXF(
  result: NestResult,
  patterns: FlatPattern[],
  sheetIndex: number,
  options?: DxfOptions
): Result<string> {
  return nestToDXFFn(result, patterns, sheetIndex, options);
}

/**
 * Build a bend report by walking the part's feature tree.
 * @param part - the sheet-metal part to report on.
 * @returns a `Result<BendReport>` carrying the computed bend report, or the first error.
 */
export function report(part: SheetMetalPart): Result<BendReport> {
  return buildReportFn(part);
}

/**
 * Project the report already computed by {@link unfold} without re-walking the tree.
 * @param result - the unfold result whose bend report is to be projected.
 * @returns a `Result<BendReport>` carrying the projected bend report, or the first error.
 */
export function reportFrom(result: UnfoldResult): Result<BendReport> {
  return reportFromUnfoldFn(result);
}

/**
 * Serialize a bend report to stable pretty-printed JSON.
 * @param report - the bend report to serialize.
 * @returns the stable pretty-printed JSON string.
 */
export function reportJSON(report: BendReport): string {
  return reportToJSONFn(report);
}

/**
 * Manufacturability checks — advisory warnings, never errors.
 * @param part - the sheet-metal part to check.
 * @returns the list of manufacturability warnings (empty when the part is clean).
 */
export function validate(part: SheetMetalPart): SheetMetalWarning[] {
  return validatePartFn(part);
}

/**
 * Bend allowance `BA = (π/180)·|angle|·(R + K·T)` for a single bend.
 * @param angleDeg - the bend angle in degrees.
 * @param thickness - the material thickness, in the same units as the rule radii.
 * @param rule - the bend rule (K-factor, inner radius, or a bend-table reference) to apply.
 * @param onWarning - optional callback invoked for non-fatal warnings during the computation.
 * @returns a `Result<number>` carrying the bend allowance, or the first error.
 */
export function allowance(
  angleDeg: number,
  thickness: number,
  rule: BendRule,
  onWarning?: (warning: SheetMetalWarning) => void
): Result<number> {
  return bendAllowanceFn(angleDeg, thickness, rule, onWarning);
}

/**
 * Neutral-axis developed length of a bend region (numerically equal to the allowance).
 * @param angleDeg - the bend angle in degrees.
 * @param thickness - the material thickness, in the same units as the rule radii.
 * @param rule - the bend rule (K-factor, inner radius, or a bend-table reference) to apply.
 * @param onWarning - optional callback invoked for non-fatal warnings during the computation.
 * @returns a `Result<number>` carrying the developed length, or the first error.
 */
export function developed(
  angleDeg: number,
  thickness: number,
  rule: BendRule,
  onWarning?: (warning: SheetMetalWarning) => void
): Result<number> {
  return developedLengthFn(angleDeg, thickness, rule, onWarning);
}

/**
 * Register (or replace) a shop bend table so rules can reference it by id.
 * @param table - the bend table to register.
 * @returns a `Result<BendTable>` carrying the registered table, or the first error.
 */
export function addBendTable(table: BendTable): Result<BendTable> {
  return registerBendTableFn(table);
}

/**
 * Look up a registered bend table by id (starter tables included).
 * @param id - the bend table id to look up.
 * @returns the matching `BendTable`, or `undefined` when no such table is registered.
 */
export function bendTable(id: string): BendTable | undefined {
  return getBendTableFn(id);
}

/**
 * Resolve a bend's developed allowance through the single resolution point:
 * a referenced bend table, then an explicit `rule.allowance`, then the K-factor
 * formula. This is what {@link developed} delegates to.
 * @param rule - the bend rule (bend-table reference, explicit allowance, or K-factor) to resolve.
 * @param angleDeg - the bend angle in degrees.
 * @param thickness - the material thickness, in the same units as the rule radii.
 * @param onWarning - optional callback invoked for non-fatal warnings during the computation.
 * @returns a `Result<number>` carrying the resolved allowance, or the first error.
 */
export function resolveAllowance(
  rule: BendRule,
  angleDeg: number,
  thickness: number,
  onWarning?: (warning: SheetMetalWarning) => void
): Result<number> {
  return resolveBendAllowanceFn(rule, angleDeg, thickness, onWarning);
}

export type { AuthorSpec, FlangeSpec, MiterPlane, DxfOptions, SlotPlacement, NestOptions, NestResult };

/** The live bend-table registry (shared resource, §7.3). */
export { bendTables } from './bendTableFns.js';
