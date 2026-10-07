/**
 * Self-hosted compat-op implementations — shape healing family
 * (core-decouple Phase 3, §5.4).
 *
 * @platform occt
 *
 * Brep-shaped implementations for `heal`, `healSolid`, `fixShape`, `autoHeal`,
 * `fixSelfIntersection`, `simplify`. Semantics mirror brepjs
 * `topology/healingFns.ts` / `topology/shapeFns.ts` (error codes preserved),
 * with the brepjs object model (castResultShape / cache invalidation) dropped:
 * occt-wasm handles only. Platform-native methods (`healFace`, `healWire`,
 * `simplify`, `fixSelfIntersection`) go through `getOcctKernel()` (D3).
 */

import type { BrepHandle } from '../../brep/engine/types'
import { getBrepApi } from '../../brep/handle-bridge'
import { getOcctKernel } from '../../occt-kernel/occtKernel'
import { ok, err, type Result } from '../../result/result'
import { kernelError, validationError } from '../../result/errors'
import type { FormClass } from '../internal/dual-form-args'
import { resolveArgs } from '../internal/dual-form-args'
import { brepHandleOf } from './brepHelpers'

const HEAL_PARAMS = { name: 'heal', params: ['shape'], formClass: 'A' as FormClass }
const HEAL_SOLID_PARAMS = { name: 'healSolid', params: ['solid'], formClass: 'A' as FormClass }
const FIX_SHAPE_PARAMS = { name: 'fixShape', params: ['shape'], formClass: 'A' as FormClass }
const AUTO_HEAL_PARAMS = { name: 'autoHeal', params: ['shape', 'options'], formClass: 'A' as FormClass }
const FIX_SELF_INTERSECTION_PARAMS = {
  name: 'fixSelfIntersection',
  params: ['shape'],
  formClass: 'A' as FormClass,
}
const SIMPLIFY_PARAMS = { name: 'simplify', params: ['shape'], formClass: 'A' as FormClass }

// ---------------------------------------------------------------------------
// heal (type-dispatching)
// ---------------------------------------------------------------------------

/** Heal a solid (`ShapeFix_Solid`); error codes match brepjs `healSolid`.
 *
 * @param args - Resolved arguments (solid shape).
 * @returns The healed solid as a `BrepHandle`.
 */
export function healSolidBrep(...args: unknown[]): Result<BrepHandle> {
  const [solid] = resolveArgs(args, HEAL_SOLID_PARAMS)
  const kernel = getBrepApi()
  const h = brepHandleOf(solid)
  if (!kernel.isSolid(h)) return err(validationError('NOT_A_SOLID', 'Input shape is not a solid'))
  const alreadyValid = kernel.isValid(h)
  try {
    const result = kernel.healSolid(h)
    if (result == null || result === h) {
      if (alreadyValid) return ok(h)
      return err(kernelError('HEAL_NO_EFFECT', 'Solid healing had no effect — shape is still invalid'))
    }
    if (!kernel.isSolid(result)) return err(kernelError('HEAL_RESULT_NOT_SOLID', 'Healed result is not a solid'))
    if (!kernel.isValid(result)) {
      return err(kernelError('HEAL_SOLID_INCOMPLETE', 'Healed result is still invalid after ShapeFix_Solid'))
    }
    return ok(result)
  } catch (e) {
    return err(kernelError('HEAL_SOLID_FAILED', 'Solid healing failed', e))
  }
}

/** Heal a face (`ShapeFix_Face`, occt platform method). */
function healFaceBrep(handle: BrepHandle): Result<BrepHandle> {
  try {
    const result = getOcctKernel().healFace(handle as never, 1e-6)
    if (getOcctKernel().getShapeType(result as never) !== 'face') {
      return err(kernelError('HEAL_RESULT_NOT_FACE', 'Healed result is not a face'))
    }
    return ok(result as never as BrepHandle)
  } catch (e) {
    return err(kernelError('HEAL_FACE_FAILED', 'Face healing failed', e))
  }
}

/** Heal a wire (`ShapeFix_Wire`, occt platform method). */
function healWireBrep(handle: BrepHandle): Result<BrepHandle> {
  try {
    const result = getOcctKernel().healWire(handle as never, 1e-6)
    if (getOcctKernel().getShapeType(result as never) !== 'wire') {
      return err(kernelError('HEAL_RESULT_NOT_WIRE', 'Healed result is not a wire'))
    }
    return ok(result as never as BrepHandle)
  } catch (e) {
    return err(kernelError('HEAL_WIRE_FAILED', 'Wire healing failed', e))
  }
}

/**
 * Dispatch healing by shape type (solid/face/wire); other types pass through
 * unchanged (brepjs `heal`).
 *
 * @param args - Resolved arguments (shape).
 * @returns The healed shape as a `BrepHandle`.
 */
export function healBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape] = resolveArgs(args, HEAL_PARAMS)
  const h = brepHandleOf(shape)
  const type = getOcctKernel().getShapeType(h as never)
  if (type === 'solid') return healSolidBrep(shape)
  if (type === 'face') return healFaceBrep(h)
  if (type === 'wire') return healWireBrep(h)
  return ok(h)
}

// ---------------------------------------------------------------------------
// fixShape / fixSelfIntersection / simplify
// ---------------------------------------------------------------------------

/** General-purpose repair (`ShapeFix_Shape`).
 *
 * @param args - Resolved arguments (shape).
 * @returns The repaired shape as a `BrepHandle`.
 */
export function fixShapeBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape] = resolveArgs(args, FIX_SHAPE_PARAMS)
  const kernel = getBrepApi()
  try {
    return ok(kernel.fixShape(brepHandleOf(shape)))
  } catch (e) {
    return err(kernelError('FIX_SHAPE_FAILED', 'ShapeFix_Shape failed', e))
  }
}

/** Fix wire self-intersection (occt platform method).
 *
 * @param args - Resolved arguments (wire shape).
 * @returns The fixed wire as a `BrepHandle`.
 */
export function fixSelfIntersectionBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape] = resolveArgs(args, FIX_SELF_INTERSECTION_PARAMS)
  try {
    const result = getOcctKernel().healWire(brepHandleOf(shape) as never, 1e-6)
    if (getOcctKernel().getShapeType(result as never) !== 'wire') {
      return err(kernelError('FIX_SELF_INTERSECTION_FAILED', 'Result is not a wire'))
    }
    return ok(result as never as BrepHandle)
  } catch (e) {
    return err(kernelError('FIX_SELF_INTERSECTION_FAILED', 'Failed to fix wire self-intersection', e))
  }
}

/** Simplify a shape (occt platform method).
 *
 * @param args - Resolved arguments (shape).
 * @returns The simplified shape as a `BrepHandle`.
 */
export function simplifyBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape] = resolveArgs(args, SIMPLIFY_PARAMS)
  try {
    return ok(getOcctKernel().simplify(brepHandleOf(shape) as never) as never as BrepHandle)
  } catch (e) {
    return err(kernelError('SIMPLIFY_FAILED', 'Kernel simplify failed', e))
  }
}

// ---------------------------------------------------------------------------
// autoHeal pipeline
// ---------------------------------------------------------------------------

interface HealingStepDiagnostic {
  readonly name: string
  readonly attempted: boolean
  readonly succeeded: boolean
  readonly detail?: string
}

interface AutoHealOptions {
  fixWires?: boolean
  fixFaces?: boolean
  fixSolids?: boolean
  sewTolerance?: number
  fixSelfIntersection?: boolean
}

interface HealingReport {
  readonly isValid: boolean
  readonly alreadyValid: boolean
  readonly wiresHealed: number
  readonly facesHealed: number
  readonly solidHealed: boolean
  readonly steps: ReadonlyArray<string>
  readonly diagnostics: ReadonlyArray<HealingStepDiagnostic>
}

/** Shape-kind check on a raw handle (occt `shapeType`). */
function kindOf(h: BrepHandle): string {
  return getOcctKernel().getShapeType(h as never)
}

/**
 * Auto-heal pipeline (brepjs `autoHeal`): short-circuit on valid, optional
 * sew / wire self-intersection pass, shape-level heal, sub-shape delta report.
 *
 * The returned record carries the healed shape as a raw BREP handle; the
 * projection wraps it via `fromHandle` so callers receive a faijs Shape.
 *
 * @param args - Resolved arguments (shape, auto-heal options).
 * @returns The healed shape with a diagnostic healing report.
 */
export function autoHealBrep(...args: unknown[]): Result<{ shape: BrepHandle; report: HealingReport }> {
  const [shape, options] = resolveArgs(args, AUTO_HEAL_PARAMS)
  const opts = (options ?? {}) as AutoHealOptions
  const fixWires = opts.fixWires !== false
  const fixFaces = opts.fixFaces !== false
  const fixSolids = opts.fixSolids !== false
  const fixSelfIntersectionOpt = opts.fixSelfIntersection === true
  const sewTolerance = opts.sewTolerance

  const steps: string[] = []
  const diagnostics: HealingStepDiagnostic[] = []
  const kernel = getBrepApi()
  const input = brepHandleOf(shape)

  const valid = kernel.isValid(input)
  if (valid) {
    return ok({
      shape: input,
      report: {
        isValid: true,
        alreadyValid: true,
        wiresHealed: 0,
        facesHealed: 0,
        solidHealed: false,
        steps: ['Shape already valid'],
        diagnostics: [{ name: 'validation', attempted: true, succeeded: true }],
      },
    })
  }

  steps.push('Shape invalid — applying shape-level healing')

  const wiresBefore = kernel.getSubShapes(input, 'wire').length
  const facesBefore = kernel.getSubShapes(input, 'face').length

  let current = input
  let solidHealed = false
  const setCurrent = (next: BrepHandle): void => {
    const prev = current
    current = next
    if (prev !== input && prev !== next) kernel.release(prev)
  }

  if (sewTolerance !== undefined) {
    try {
      setCurrent(kernel.sew([current], sewTolerance))
      steps.push(`Applied sewing with tolerance ${sewTolerance}`)
      diagnostics.push({ name: 'sew', attempted: true, succeeded: true, detail: `tolerance=${sewTolerance}` })
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      steps.push(`Sewing failed: ${detail}`)
      diagnostics.push({ name: 'sew', attempted: true, succeeded: false, detail })
    }
  }

  if (fixSelfIntersectionOpt && fixWires) {
    const wires = kernel.getSubShapes(current, 'wire')
    let fixCount = 0
    for (const wire of wires) {
      try {
        getOcctKernel().healWire(wire as never, 1e-6)
        fixCount++
      } catch {
        // Ignore individual wire failures
      }
    }
    steps.push(`Self-intersection fix: ${fixCount}/${wires.length} wires`)
    diagnostics.push({
      name: 'fixSelfIntersection',
      attempted: true,
      succeeded: fixCount > 0,
      detail: `${fixCount}/${wires.length} wires fixed`,
    })
  }

  const kind = kindOf(current)
  const shouldHealShape =
    (kind === 'solid' && fixSolids) || (kind === 'face' && fixFaces) || (kind === 'wire' && fixWires)

  if (shouldHealShape) {
    const healResult = kind === 'solid' ? healSolidBrep(current) : kind === 'face' ? healFaceBrep(current) : healWireBrep(current)
    if (healResult.ok) {
      setCurrent(healResult.value)
      if (kind === 'solid') {
        solidHealed = true
        steps.push('Applied ShapeFix_Solid')
        diagnostics.push({ name: 'healSolid', attempted: true, succeeded: true })
      } else if (kind === 'face') {
        steps.push('Applied ShapeFix_Face')
        diagnostics.push({ name: 'healFace', attempted: true, succeeded: true })
      } else {
        steps.push('Applied ShapeFix_Wire')
        diagnostics.push({ name: 'healWire', attempted: true, succeeded: true })
      }
    } else {
      steps.push('Shape-level healing failed')
      diagnostics.push({ name: 'healShape', attempted: true, succeeded: false })
    }
  } else {
    diagnostics.push({ name: 'healShape', attempted: false, succeeded: false, detail: 'skipped by options' })
  }

  const wiresAfter = kernel.getSubShapes(current, 'wire').length
  const facesAfter = kernel.getSubShapes(current, 'face').length
  const wiresHealed = Math.abs(wiresAfter - wiresBefore)
  const facesHealed = Math.abs(facesAfter - facesBefore)

  if (wiresHealed > 0) steps.push(`Wire count changed by ${wiresHealed}`)
  if (facesHealed > 0) steps.push(`Face count changed by ${facesHealed}`)

  const finalValid = kernel.isValid(current)
  steps.push(finalValid ? 'Final validation: valid' : 'Final validation: still invalid')
  diagnostics.push({ name: 'finalValidation', attempted: true, succeeded: finalValid })

  return ok({
    shape: current,
    report: {
      isValid: finalValid,
      alreadyValid: false,
      wiresHealed,
      facesHealed,
      solidHealed,
      steps,
      diagnostics,
    },
  })
}
