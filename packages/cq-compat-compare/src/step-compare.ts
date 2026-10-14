/**
 * STEP file equivalence comparison using BREP geometry.
 *
 * Compares two STEP files across five dimensions:
 * 1. Bounding box
 * 2. Volume
 * 3. Center of mass
 * 4. Topology statistics (face/edge/vertex/solid counts)
 * 5. Boolean difference (A-B and B-A volumes)
 *
 * Usage:
 *   const result = await compareStepFiles('a.step', 'b.step')
 *   console.log(result.equivalent)
 */

import { readFileSync } from 'node:fs'
import { initOcctWasm } from '@faicad/faijs'
import type { OcctKernel, ShapeHandle, BrepBoundingBox, BrepVec3 } from '@faicad/faijs'

/** Tolerance options for comparison. */
export interface CompareOptions {
  /** Absolute tolerance for bbox / center-of-mass coordinates (mm). Default 1e-4. */
  linearTolerance?: number
  /** Relative tolerance for volume comparison (0.001 = 0.1%). Default 1e-4. */
  volumeRelativeTolerance?: number
  /** Absolute tolerance for boolean difference volume (mm³). Default 1e-3. */
  booleanVolumeTolerance?: number
  /** Whether to require topology counts to match exactly. Default true. */
  strictTopology?: boolean
  /**
   * P7/D3: pose comparison mode. Default 'bitwise' (exact placement match).
   * 'canonical-pose' = the two files are two LEGAL solutions of an
   * underdetermined constraint set (solver DOF diagnostic said dof > 0): the
   * placement difference along the free twist is not a defect. B is pre-aligned
   * to A by scanning the twist about `canonicalFreeAxis` (through B's COM) to
   * the minimal-difference angle before the rotation-sensitive metrics (bbox,
   * boolean diff); invariants (topology / volume / COM) stay bitwise — they are
   * unchanged by that rotation anyway.
   */
  poseMode?: 'bitwise' | 'canonical-pose'
  /**
   * Free twist axis (world direction, any nonzero length — normalized
   * internally). Required when poseMode is 'canonical-pose'; ignored otherwise.
   * Feed the solver's underdetermined free direction here.
   */
  canonicalFreeAxis?: BrepVec3
  /**
   * P7/D4: a point ON the free twist axis (world coords). The canonical scan
   * rotates B about the axis through this point. Default: B's center of mass.
   * For assemblies the free twist acts per-member around its own constraint
   * anchor — a compound-COM pivot moves the members when it is not on the
   * twist axis and the scan cannot converge (residual = the twist offset left
   * behind). Pass the anchor point of the constrained member here.
   */
  canonicalPivot?: BrepVec3
  /**
   * P8: underdetermined free TRANSLATION direction (unit-ish; normalized
   * internally). When set the canonical channel scans a TRANSLATION along
   * this axis instead of a twist — used when the solver's freeDirs indicate a
   * sliding DOF (nested_assy: unconstrained y translation of the sub-assembly).
   */
  canonicalFreeTranslation?: BrepVec3
  /**
   * P7/D4: rigid groups over the split solids (indices into the compounds'
   * solid lists, both sides share the layout). Solids in one group are a
   * single assembly member (e.g. a multi-solid compound member) and MUST be
   * rotated together about one pivot — scanning them independently breaks the
   * member's internal rigid relations. Default: every solid is its own group.
   */
  canonicalRigidGroups?: number[][]
  /**
   * P7/D5: per-member pivots indexed BY SOLID INDEX (same layout as
   * canonicalRigidGroups covers): memberPivots[i] is the twist-axis point for
   * the solid at index i (or null to fall back to that solid's COM). Overrides
   * canonicalPivot. Needed when one export mixes members with different
   * anchors (root compound exporting b1+b2+b3: b2 pivots at its loc origin,
   * b3 at its own) — a single canonicalPivot can only align one member.
   */
  canonicalMemberPivots?: Array<BrepVec3 | null>
}

/** Per-metric comparison result. */
export interface MetricResult<T> {
  a: T
  b: T
  match: boolean
}

/** Topology statistics for a shape. */
export interface TopologyStats {
  faces: number
  edges: number
  vertices: number
  solids: number
}

/** Full comparison result. */
export interface StepCompareResult {
  fileA: string
  fileB: string
  equivalent: boolean
  bbox: MetricResult<BrepBoundingBox> & { maxDiff: number }
  volume: MetricResult<number> & { diff: number; diffPct: number }
  centerOfMass: MetricResult<BrepVec3> & { maxDiff: number }
  topology: MetricResult<TopologyStats>
  booleanDiff: {
    aMinusB: { volume: number; nonEmpty: boolean }
    bMinusA: { volume: number; nonEmpty: boolean }
    match: boolean
  }
  details: string[]
  /**
   * P7/D3 audit fields (present only when poseMode is 'canonical-pose'):
   * the aligned twist angle (deg) applied to B and the resulting minimal
   * bbox diff. Makes every canonical-channel relaxation visible in reports —
   * no silent loosening.
   */
  canonicalPose?: { twistAngleDeg: number; alignedBboxDiff: number }
}

const DEFAULT_OPTIONS: Required<Pick<CompareOptions, 'linearTolerance' | 'volumeRelativeTolerance' | 'booleanVolumeTolerance' | 'strictTopology'>> = {
  linearTolerance: 1e-4,
  volumeRelativeTolerance: 1e-4,
  booleanVolumeTolerance: 1e-3,
  strictTopology: true,
}

function bboxMaxDiff(a: BrepBoundingBox, b: BrepBoundingBox): number {
  return Math.max(
    Math.abs(a.xmin - b.xmin), Math.abs(a.xmax - b.xmax),
    Math.abs(a.ymin - b.ymin), Math.abs(a.ymax - b.ymax),
    Math.abs(a.zmin - b.zmin), Math.abs(a.zmax - b.zmax),
  )
}

function comMaxDiff(a: BrepVec3, b: BrepVec3): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z))
}

function getTopologyStats(kernel: OcctKernel, shape: ShapeHandle): TopologyStats {
  return {
    faces: kernel.getSubShapes(shape, 'face').length,
    edges: kernel.getSubShapes(shape, 'edge').length,
    vertices: kernel.getSubShapes(shape, 'vertex').length,
    solids: kernel.getSubShapes(shape, 'solid').length,
  }
}

function topologyMatch(a: TopologyStats, b: TopologyStats, strict: boolean): boolean {
  if (strict) {
    return a.faces === b.faces && a.edges === b.edges && a.vertices === b.vertices && a.solids === b.solids
  }
  return a.solids === b.solids
}

/**
 * Compare two STEP files for geometric equivalence.
 *
 * @param fileA - Path to the first STEP file.
 * @param fileB - Path to the second STEP file.
 * @param options - Comparison tolerances.
 * @returns Detailed comparison result with per-metric match status.
 */
export async function compareStepFiles(
  fileA: string,
  fileB: string,
  options: CompareOptions = {},
): Promise<StepCompareResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const details: string[] = []

  const kernel = await initOcctWasm()

  const bufA = readFileSync(fileA)
  const bufB = readFileSync(fileB)
  // readFileSync returns pooled Buffers for small files: buf.buffer is the
  // whole 8KB pool (with garbage beyond byteLength), which makes importStep
  // fail on every STEP < ~4KB (e.g. single-sphere files). Pass an exact copy.
  const exact = (buf: Buffer): ArrayBuffer =>
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const shapeA = kernel.importStep(exact(bufA))
  let shapeB = kernel.importStep(exact(bufB))

  // P7/D3: canonical-pose pre-alignment. Two legal solutions of an
  // underdetermined constraint set differ only by the twist about the free
  // axis; scan that twist to the minimal-difference angle before the
  // rotation-sensitive metrics. Invariants (topology/volume/COM) are unchanged
  // by a rotation about the axis through B's COM, so computing them before or
  // after this alignment is equivalent — do it before, once.
  let canonicalTwistAngle: number | undefined
  // Pairing map from the canonical scan (B-side solid index → A-side index):
  // the final boolean diff uses PER-MEMBER paired cuts — the occt-wasm kernel's
  // compound-vs-compound cut returns IMPOSSIBLE volumes under 0.33.6 (> the
  // shape's own volume, probe-verified) while solid-vs-solid cuts are exact.
  let pairing: number[] | null = null
  if (opts.poseMode === 'canonical-pose') {
    if (!opts.canonicalFreeAxis && !opts.canonicalFreeTranslation) {
      throw new Error("poseMode 'canonical-pose' requires canonicalFreeAxis (or canonicalFreeTranslation for a sliding DOF)")
    }
  }
  // P8 translation mode (sliding DOF): scan offsets along the free axis
  // instead of twists. PER-MEMBER-GROUP like the twist scan — the fixed root
  // members must NOT ride (nested_assy: sliding everything moved the anchored
  // b1 too and only half the bbox matched). Split into solids, pair by COM,
  // slide each group independently to the minimal member-bbox diff.
  if (opts.poseMode === 'canonical-pose' && opts.canonicalFreeTranslation) {
    const fx = opts.canonicalFreeTranslation.x
    const fy = opts.canonicalFreeTranslation.y
    const fz = opts.canonicalFreeTranslation.z
    const flen = Math.hypot(fx, fy, fz)
    if (!(flen > 0)) throw new Error('canonicalFreeTranslation must be a nonzero direction')
    const dir: BrepVec3 = { x: fx / flen, y: fy / flen, z: fz / flen }
    const slideBy = (shape: ShapeHandle, t: number): ShapeHandle =>
      kernel.transform(shape, [1, 0, 0, dir.x * t, 0, 1, 0, dir.y * t, 0, 0, 1, dir.z * t])

    const solidsA = kernel.getSubShapes(shapeA, 'solid')
    const solidsB = kernel.getSubShapes(shapeB, 'solid')
    if (solidsA.length !== solidsB.length || solidsA.length === 0) {
      throw new Error(`canonical-pose: solid count mismatch (A=${solidsA.length}, B=${solidsB.length}) — per-group alignment needs 1:1 solids`)
    }
    const groups = opts.canonicalRigidGroups ?? solidsB.map((_, i) => [i])
    const aligned: ShapeHandle[] = new Array(solidsB.length)
    const usedA = new Set<number>()
    const bboxWhole = kernel.getBoundingBox(shapeA)
    const span = Math.max(
      bboxWhole.xmax - bboxWhole.xmin, bboxWhole.ymax - bboxWhole.ymin, bboxWhole.zmax - bboxWhole.zmin,
    ) * 2
    for (const group of groups) {
      // Translation-mode pairing CANNOT use nearest-COM: a sliding DOF moves
      // members farther than their mutual spacing (nested_assy: cand b2 sits
      // 2.3 from ref b1 but 4 from its true partner ref b2) — pair by BEST
      // SLIDE instead: for each unused A candidate, scan the slide and keep
      // the (candidate, offset) with the minimal member-bbox diff.
      const aCompound0 = group.length === 1 ? null : kernel.makeCompound(group.map((gi) => solidsB[gi]!))
      const bboxB0 = kernel.getBoundingBox(aCompound0 ?? solidsB[group[0]!]!)
      if (aCompound0) kernel.release(aCompound0)
      let ai = -1
      let bestT = 0
      let bestDiff = Infinity
      for (let cand0 = 0; cand0 < solidsA.length; cand0++) {
        if (usedA.has(cand0)) continue
        const aIdxs = group.map((gi) => cand0 + gi - group[0]!)
        if (aIdxs[aIdxs.length - 1]! >= solidsA.length) continue
        const aC = aIdxs.length === 1 ? null : kernel.makeCompound(aIdxs.map((i) => solidsA[i]!))
        const bboxA = kernel.getBoundingBox(aC ?? solidsA[aIdxs[0]!]!)
        if (aC) kernel.release(aC)
        const diffTo = (t: number): number => Math.max(
          Math.abs(bboxA.xmin - (bboxB0.xmin + dir.x * t)), Math.abs(bboxA.xmax - (bboxB0.xmax + dir.x * t)),
          Math.abs(bboxA.ymin - (bboxB0.ymin + dir.y * t)), Math.abs(bboxA.ymax - (bboxB0.ymax + dir.y * t)),
          Math.abs(bboxA.zmin - (bboxB0.zmin + dir.z * t)), Math.abs(bboxA.zmax - (bboxB0.zmax + dir.z * t)),
        )
        let localT = 0
        let localD = diffTo(0)
        for (let t = -span; t <= span; t += 0.05) {
          const d = diffTo(t)
          if (d < localD - 1e-12) { localD = d; localT = t }
        }
        if (localD < bestDiff - 1e-12) { bestDiff = localD; bestT = localT; ai = cand0 }
      }
      for (let gi = 0; gi < group.length; gi++) {
        usedA.add(ai! + gi)
        if (!pairing) pairing = new Array(solidsB.length)
        pairing[group[gi]!] = ai! + gi
      }
      const aIdxs = group.map((gi) => ai! + gi - group[0]!)
      const aCompound = aIdxs.length === 1 ? null : kernel.makeCompound(aIdxs.map((i) => solidsA[i]!))
      const bboxMemberA = kernel.getBoundingBox(aCompound ?? solidsA[aIdxs[0]!]!)
      if (aCompound) kernel.release(aCompound)
      const diffAt = (t: number): number => {
        const handles = group.map((gi) => slideBy(solidsB[gi]!, t))
        const moved = handles.length === 1 ? null : kernel.makeCompound(handles)
        const b = kernel.getBoundingBox(moved ?? handles[0]!)
        if (moved) kernel.release(moved)
        for (const h of handles) kernel.release(h)
        return Math.max(
          Math.abs(bboxMemberA.xmin - b.xmin), Math.abs(bboxMemberA.xmax - b.xmax),
          Math.abs(bboxMemberA.ymin - b.ymin), Math.abs(bboxMemberA.ymax - b.ymax),
          Math.abs(bboxMemberA.zmin - b.zmin), Math.abs(bboxMemberA.zmax - b.zmax),
        )
      }
      // Refine the paired (candidate, offset) with the kernel-measured diff,
      // then skip the slide entirely if it doesn't beat the un-moved pose
      // (avoid chasing noise on already-aligned members).
      let lo = bestT - 0.1
      let hi = bestT + 0.1
      for (let i = 0; i < 40; i++) {
        const m1 = lo + (hi - lo) * 0.382
        const m2 = lo + (hi - lo) * 0.618
        if (diffAt(m1) < diffAt(m2)) hi = m2
        else lo = m1
      }
      bestT = (lo + hi) / 2
      const d0 = diffAt(0)
      if (d0 <= diffAt(bestT) + 1e-12) bestT = 0 // already aligned: no slide (avoid chasing noise)
      details.push(`canonical-pose: translation B${JSON.stringify(group)} -> A offset ${ai}, slide ${bestT.toFixed(4)} along (${dir.x.toFixed(3)},${dir.y.toFixed(3)},${dir.z.toFixed(3)})`)
      for (const gi of group) {
        aligned[gi] = slideBy(solidsB[gi]!, bestT)
        kernel.release(solidsB[gi]!)
      }
    }
    for (const s of solidsA) kernel.release(s)
    kernel.release(shapeB)
    shapeB = solidsB.length === 1 ? aligned[0]! : kernel.makeCompound(aligned)
    canonicalTwistAngle = 0
  }

  if (opts.poseMode === 'canonical-pose' && opts.canonicalFreeAxis) {
    const ux = opts.canonicalFreeAxis.x
    const uy = opts.canonicalFreeAxis.y
    const uz = opts.canonicalFreeAxis.z
    const len = Math.hypot(ux, uy, uz)
    if (!(len > 0)) throw new Error('canonicalFreeAxis must be a nonzero direction')
    const axis: BrepVec3 = { x: ux / len, y: uy / len, z: uz / len }
    const bboxA0 = kernel.getBoundingBox(shapeA)

    // The free twist acts PER-MEMBER around the member's own constraint anchor
    // — a single rigid twist of the whole compound cannot absorb it (a compound
    // COM or anchor pivot that is off a member's twist axis translates that
    // member while rotating). So split both compounds into solids and align
    // each B solid independently: rotate it about its own COM (twist axis
    // through a member's FixedPoint anchor passes through the member's COM for
    // unary constraints) to the minimal-bbox-diff angle vs the whole A.
    const solidsA = kernel.getSubShapes(shapeA, 'solid')
    const solidsB = kernel.getSubShapes(shapeB, 'solid')
    if (solidsA.length !== solidsB.length || solidsA.length === 0) {
      throw new Error(`canonical-pose: solid count mismatch (A=${solidsA.length}, B=${solidsB.length}) — per-member alignment needs 1:1 solids`)
    }

    const rotAbout = (shape: ShapeHandle, deg: number, pivot: BrepVec3): ShapeHandle => {
      const a = (deg * Math.PI) / 180
      const c = Math.cos(a)
      const s = Math.sin(a)
      const t = 1 - c
      const r00 = c + axis.x * axis.x * t
      const r01 = axis.x * axis.y * t - axis.z * s
      const r02 = axis.x * axis.z * t + axis.y * s
      const r10 = axis.y * axis.x * t + axis.z * s
      const r11 = c + axis.y * axis.y * t
      const r12 = axis.y * axis.z * t - axis.x * s
      const r20 = axis.z * axis.x * t - axis.y * s
      const r21 = axis.z * axis.y * t + axis.x * s
      const r22 = c + axis.z * axis.z * t
      const tx = pivot.x - (r00 * pivot.x + r01 * pivot.y + r02 * pivot.z)
      const ty = pivot.y - (r10 * pivot.x + r11 * pivot.y + r12 * pivot.z)
      const tz = pivot.z - (r20 * pivot.x + r21 * pivot.y + r22 * pivot.z)
      return kernel.transform(shape, [r00, r01, r02, tx, r10, r11, r12, ty, r20, r21, r22, tz])
    }

    // Pair each B solid with its nearest A solid (COM distance) — ordering in
    // a STEP compound is not guaranteed to match the solver's member order.
    // Rigid groups (canonicalRigidGroups, default singleton per solid) are
    // paired and rotated AS A UNIT: one angle about one pivot for all group
    // members, preserving each member's internal rigid relations.
    const groups = opts.canonicalRigidGroups ?? solidsB.map((_, i) => [i])
    const comA = solidsA.map((s) => kernel.getCenterOfMass(s))
    const aligned: ShapeHandle[] = new Array(solidsB.length)
    const usedA = new Set<number>()
    let maxAbsTwist = 0
    for (const group of groups) {
      const sbFirst = solidsB[group[0]]
      const com = kernel.getCenterOfMass(sbFirst)
      let ai = -1
      let best = Infinity
      for (let i = 0; i < comA.length; i++) {
        if (usedA.has(i)) continue
        const d = Math.hypot(comA[i].x - com.x, comA[i].y - com.y, comA[i].z - com.z)
        if (d < best) { best = d; ai = i }
      }
      // Mark the A-side solids this group consumes (ai + the group's relative
      // offsets). GOTCHA (0.33.6 regression): marking the B-side indices (gi)
      // corrupted the pairing — usedA was checked against A-side indices but
      // filled with B-side ones, so later groups matched already-consumed A
      // members (simple_assy: b1's group paired to b3b's A solid and got
      // twisted to chase its bbox → boolean diff = whole-member volume).
      for (let gi = 0; gi < group.length; gi++) {
        usedA.add(ai + gi)
        if (!pairing) pairing = new Array(solidsB.length)
        pairing[group[gi]] = ai + gi
      }
      // Scan the twist about the member's own COM (pivot override applies when
      // the anchor is off-COM); MEMBER-vs-MEMBER bbox — aligning one member
      // against the whole-assembly bbox would chase the wrong optimum. For
      // multi-solid groups the member's bbox spans all its solids.
      // 2° grid + golden-section refine.
      // Pivot resolution (P7/D5): per-solid annotation (canonicalMemberPivots
      // at the group's first solid index) overrides the single canonicalPivot,
      // which overrides the group's first-solid COM. Mixed-member exports
      // (root compound with b1+b2+b3) need per-member anchors — one pivot
      // cannot align members anchored at different points.
      const mp = opts.canonicalMemberPivots?.[group[0]]
      const pv = mp ?? opts.canonicalPivot ?? com
      // For grouped members pair by group: build the A-side bbox from the
      // corresponding group of A solids (same relative layout).
      const aIdxs = group.map((gi) => ai + gi - group[0])
      const aCompound = aIdxs.length === 1 ? null : kernel.makeCompound(aIdxs.map((i) => solidsA[i]))
      const bboxMemberA = kernel.getBoundingBox(aCompound ?? solidsA[aIdxs[0]])
      const comMemberA = kernel.getCenterOfMass(aCompound ?? solidsA[aIdxs[0]])
      if (aCompound) kernel.release(aCompound)
      const diffAtDeg = (deg: number): number => {
        // Rotate the WHOLE group as one rigid unit and measure its combined bbox.
        // PLUS the group-COM distance: bbox diff is EVEN in the twist angle
        // (±θ give identical bboxes) and the ascending grid scan picks the
        // wrong sign on ties (observed: subassy2 boolean diff 0.21 after a
        // "perfect" bbox 1e-7 alignment — geometry twisted the wrong way).
        // The member COM orbits the axis for off-axis members, so |ΔCOM| has a
        // unique minimum at the true angle (odd component breaks the tie);
        // on-axis members (COM on the twist axis) give ΔCOM ≈ 0 for both signs
        // and are unaffected.
        const rotHandles = group.map((gi) => rotAbout(solidsB[gi], deg, pv))
        const rotCompound = rotHandles.length === 1 ? null : kernel.makeCompound(rotHandles)
        const b = kernel.getBoundingBox(rotCompound ?? rotHandles[0])
        const c = kernel.getCenterOfMass(rotCompound ?? rotHandles[0])
        // Boolean cut is the DECISIVE objective: the bbox objective is
        // degenerate for prismatic members (a 1x1x2 box's bbox is nearly
        // invariant under ~90° twist about its long axis — the sharp true
        // minimum at 9.31° loses to the flat degenerate basin at 80.7° on a
        // 2° grid), while cut volume is ~0 only where the geometry ACTUALLY
        // coincides. MUST run before the releases below (cutting released
        // handles raises INVALID_SHAPE_ID).
        const aC = aIdxs.length === 1 ? solidsA[aIdxs[0]] : kernel.makeCompound(aIdxs.map((i) => solidsA[i]))
        const bC = rotCompound ?? rotHandles[0]
        const cutAB = kernel.cut(aC as never, bC as never)
        const cutBA = kernel.cut(bC as never, aC as never)
        const cutVol = kernel.getVolume(cutAB) + kernel.getVolume(cutBA)
        // Release the cut results — the scan evaluates ~1800 cuts per case;
        // leaking them floods the handle table (occt-wasm may recycle IDs,
        // silently corrupting later cuts).
        kernel.release(cutAB)
        kernel.release(cutBA)
        if (aIdxs.length > 1) kernel.release(aC)
        if (rotCompound) kernel.release(rotCompound)
        for (const h of rotHandles) kernel.release(h)
        const bboxDiffLocal = Math.max(
          Math.abs(bboxMemberA.xmin - b.xmin), Math.abs(bboxMemberA.xmax - b.xmax),
          Math.abs(bboxMemberA.ymin - b.ymin), Math.abs(bboxMemberA.ymax - b.ymax),
          Math.abs(bboxMemberA.zmin - b.zmin), Math.abs(bboxMemberA.zmax - b.zmax),
        )
        const comDist = Math.hypot(comMemberA.x - c.x, comMemberA.y - c.y, comMemberA.z - c.z)
        return Math.max(bboxDiffLocal, comDist, cutVol)
      }
      let bestDeg = 0
      let bestDiff = diffAtDeg(0)
      for (let deg = 2; deg < 360; deg += 2) {
        const d = diffAtDeg(deg)
        if (d < bestDiff - 1e-12) { bestDiff = d; bestDeg = deg }
        // Tie-break (0.33.6 regression): the bbox objective is degenerate for
        // prismatic members — a 1x1x2 box at ±small twist and at ~90° give
        // EQUAL minima (COM tie-break is void when the COM sits ON the pivot).
        // Among equal-minimum candidates prefer the SMALLEST |angle|: the free
        // twist is by definition a small pose correction, while the ~90°
        // twin is a bbox-simplicity illusion that misaligns the actual
        // geometry (boolean diff 5 mm³ despite a "perfect" 8.6e-8 bbox).
        else if (Math.abs(d - bestDiff) <= 1e-12 && Math.min(Math.abs(deg), Math.abs(deg - 360)) < Math.min(Math.abs(bestDeg), Math.abs(bestDeg - 360))) {
          bestDiff = Math.min(bestDiff, d)
          bestDeg = deg
        }
      }
      let lo = bestDeg - 2
      let hi = bestDeg + 2
      for (let i = 0; i < 40; i++) {
        const m1 = lo + (hi - lo) * 0.382
        const m2 = lo + (hi - lo) * 0.618
        if (diffAtDeg(m1) < diffAtDeg(m2)) hi = m2
        else lo = m1
      }
      let angle = (lo + hi) / 2
      // P7/D4 refine ①: if the refined optimum still misses the tolerance,
      // the coarse 2° grid may have bracketed the wrong cell (bbox diff is
      // not unimodal in the twist angle). Re-scan ±1° around the current
      // best at 0.02° steps to catch a sharper minimum nearby.
      let fine = diffAtDeg(angle)
      if (fine > 1e-3) {
        const base = angle
        for (let d = -1; d <= 1; d += 0.02) {
          const cand = base + d
          const dd = diffAtDeg(cand)
          if (dd < fine) { fine = dd; angle = cand }
        }
      }
      if (Math.abs(angle) > Math.abs(maxAbsTwist)) maxAbsTwist = angle
      details.push(
        `canonical-pose: group B${JSON.stringify(group)} -> A offset ${ai}, twist ${angle.toFixed(3)}° about pivot (${pv.x.toFixed(3)},${pv.y.toFixed(3)},${pv.z.toFixed(3)}), scan min diff ${fine.toExponential(3)}`,
      )
      // One angle about one pivot for the WHOLE group (rigid unit).
      for (const gi of group) {
        aligned[gi] = rotAbout(solidsB[gi], angle, pv)
        kernel.release(solidsB[gi])
      }
    }
    for (const s of solidsA) kernel.release(s)
    kernel.release(shapeB)
    shapeB = solidsB.length === 1 ? aligned[0] : kernel.makeCompound(aligned)
    canonicalTwistAngle = maxAbsTwist
    details.push(`canonical-pose: per-member twist about (${axis.x.toFixed(4)},${axis.y.toFixed(4)},${axis.z.toFixed(4)}), max |twist| ${maxAbsTwist.toFixed(3)}°`)
  }

  // 1. Bounding box
  const bboxA = kernel.getBoundingBox(shapeA)
  const bboxB = kernel.getBoundingBox(shapeB)
  const bboxDiff = bboxMaxDiff(bboxA, bboxB)
  const bboxMatch = bboxDiff <= opts.linearTolerance
  details.push(`bbox diff: ${bboxDiff.toExponential(3)} mm (tol ${opts.linearTolerance})`)

  // 2. Topology (needed to decide whether volume/COM/boolean are meaningful)
  const topoA = getTopologyStats(kernel, shapeA)
  const topoB = getTopologyStats(kernel, shapeB)
  const topoMatch = topologyMatch(topoA, topoB, opts.strictTopology)
  details.push(`topology: A(f=${topoA.faces},e=${topoA.edges},v=${topoA.vertices},s=${topoA.solids}) B(f=${topoB.faces},e=${topoB.edges},v=${topoB.vertices},s=${topoB.solids})`)

  // 3. Volume / COM / boolean difference: only meaningful when BOTH shapes
  // contain solids or faces (e.g. `siblings(..., "Vertex", ...)` yields a
  // pure edges compound; BRepGProp volume / BRepAlgoAPI_Cut throw on those).
  const hasMass =
    (topoA.solids > 0 || topoA.faces > 0) && (topoB.solids > 0 || topoB.faces > 0)
  let volA = 0
  let volB = 0
  let volDiff = 0
  let volPct = 0
  let volMatch = true
  let comA: BrepVec3 = { x: 0, y: 0, z: 0 }
  let comB: BrepVec3 = { x: 0, y: 0, z: 0 }
  let comDiff = 0
  let comMatch = true
  let volAB = 0
  let volBA = 0
  let boolMatch = true
  if (hasMass) {
    volA = kernel.getVolume(shapeA)
    volB = kernel.getVolume(shapeB)
    volDiff = Math.abs(volA - volB)
    volPct = volA > 0 ? (volDiff / volA) * 100 : 0
    volMatch = volPct <= opts.volumeRelativeTolerance * 100
    details.push(`volume diff: ${volDiff.toExponential(3)} mm³ (${volPct.toFixed(4)}%, tol ${opts.volumeRelativeTolerance * 100}%)`)

    comA = kernel.getCenterOfMass(shapeA)
    comB = kernel.getCenterOfMass(shapeB)
    comDiff = comMaxDiff(comA, comB)
    comMatch = comDiff <= opts.linearTolerance
    details.push(`center-of-mass diff: ${comDiff.toExponential(3)} mm (tol ${opts.linearTolerance})`)

    // canonical-pose pairing is only meaningful for SOLID compounds — a wire/
    // edge compound (2D parametric curves) has no solids; cutting those
    // HANGS the kernel (testParametricCurve__res_closed probe). hasMass
    // already admits face-only shapes, so require pairing AND solids on both
    // sides before the per-member path.
    const solidCountA = pairing ? kernel.getSubShapes(shapeA, 'solid').length : 0
    if (pairing && solidCountA === pairing.length && solidCountA > 0) {
      // canonical-pose path: PER-MEMBER paired cuts. The kernel's
      // compound-vs-compound cut returns impossible volumes under 0.33.6
      // (probe: cut > the shape's own volume) while solid-vs-solid cuts are
      // exact — sum the paired residuals instead of cutting whole compounds.
      const solidsA = kernel.getSubShapes(shapeA, 'solid')
      const solidsB = kernel.getSubShapes(shapeB, 'solid')
      for (let bi = 0; bi < pairing.length; bi++) {
        const ai = pairing[bi]
        if (ai === undefined) continue
        const cAB = kernel.cut(solidsA[ai] as never, solidsB[bi] as never)
        const cBA = kernel.cut(solidsB[bi] as never, solidsA[ai] as never)
        volAB += kernel.getVolume(cAB)
        volBA += kernel.getVolume(cBA)
        kernel.release(cAB)
        kernel.release(cBA)
      }
      for (const s of solidsA) kernel.release(s)
      for (const s of solidsB) kernel.release(s)
      details.push(`boolean diff (per-member paired): A-B=${volAB.toExponential(3)} mm³, B-A=${volBA.toExponential(3)} mm³ (tol ${opts.booleanVolumeTolerance})`)
    } else {
      const aMinusB = kernel.cut(shapeA, shapeB)
      const bMinusA = kernel.cut(shapeB, shapeA)
      volAB = kernel.getVolume(aMinusB)
      volBA = kernel.getVolume(bMinusA)
      kernel.release(aMinusB)
      kernel.release(bMinusA)
    }
  } else {
    details.push('volume/COM/boolean: skipped (no solid or face topology in either shape)')
  }

  // Cleanup
  kernel.release(shapeA)
  kernel.release(shapeB)

  const equivalent = bboxMatch && volMatch && comMatch && topoMatch && boolMatch

  return {
    fileA,
    fileB,
    equivalent,
    bbox: { a: bboxA, b: bboxB, match: bboxMatch, maxDiff: bboxDiff },
    volume: { a: volA, b: volB, match: volMatch, diff: volDiff, diffPct: volPct },
    centerOfMass: { a: comA, b: comB, match: comMatch, maxDiff: comDiff },
    topology: { a: topoA, b: topoB, match: topoMatch },
    booleanDiff: {
      aMinusB: { volume: volAB, nonEmpty: volAB > opts.booleanVolumeTolerance },
      bMinusA: { volume: volBA, nonEmpty: volBA > opts.booleanVolumeTolerance },
      match: boolMatch,
    },
    details,
    ...(canonicalTwistAngle !== undefined
      ? { canonicalPose: { twistAngleDeg: canonicalTwistAngle, alignedBboxDiff: bboxDiff } }
      : {}),
  }
}

/**
 * Print a human-readable comparison report to stdout.
 * @param result - The comparison result from compareStepFiles.
 */
export function printCompareReport(result: StepCompareResult): void {
  console.log(`\n=== STEP Comparison: ${result.fileA} vs ${result.fileB} ===`)
  console.log(`Overall: ${result.equivalent ? '✓ EQUIVALENT' : '✗ DIFFERENT'}\n`)
  for (const d of result.details) {
    console.log(`  ${d}`)
  }
  console.log('')
  if (!result.equivalent) {
    if (!result.bbox.match) console.log('  ✗ Bounding box mismatch')
    if (!result.volume.match) console.log('  ✗ Volume mismatch')
    if (!result.centerOfMass.match) console.log('  ✗ Center of mass mismatch')
    if (!result.topology.match) console.log('  ✗ Topology mismatch')
    if (!result.booleanDiff.match) console.log('  ✗ Boolean difference non-empty')
  }
}
