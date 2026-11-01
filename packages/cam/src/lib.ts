/**
 * `@faicad/cam` fai-script declaration library (design doc §5).
 *
 * Script usage:
 *
 *   import { cam } from '@faicad/cam'
 *   cam.machine({ name: 'My Mill', workBounds: {...}, maxSpindleRPM: 24000, safeParkZ: 15 })
 *   cam.stock({ type: 'box', size: [60*MM, 40*MM, 20*MM], center: [0, 0, 10*MM] })
 *   cam.op.roughing({ name: 'Rough', target: 'part1',
 *     tool: { type: 'flat', diameter: 3.175, cuttingLength: 25 },
 *     stepDown: 1, stepover: 0.8, stockAllowance: 0, feedRate: 800, plungeRate: 200, spindleRPM: 12000 })
 *   cam.op.surfacing({ name: 'Finish', target: 'part1', faces: 'all',
 *     tool: { type: 'ball', diameter: 3.175, cuttingLength: 25 },
 *     stepover: 0.8, rasterDirection: 'Both', safeHeight: 5, ... })
 *
 * Like fai-animation, this namespace is **not** a geometry-op library: the
 * worker registers it with `autoLift: false`, so every function here is a
 * plain synchronous function that returns a declaration object (never an
 * OCCT-handle-bearing Shape). Unknown option keys throw immediately.
 */
import type { Shape } from '@faicad/faijs/browser'
import {
  assertKnownKeys,
  CAM_MACHINE_DECL_KEYS,
  CAM_OPERATION_DECL_KEYS,
  CAM_STOCK_DECL_KEYS,
  normalizeCamMachineDecl,
  normalizeCamOperationDecl,
  normalizeCamStockDecl,
} from './decl.js'
import type { CamFaceRef, CamMachineDecl, CamOperationDecl, CamStockDecl } from './decl.js'
import { declareMachine, declareOperation, declareStock } from './collect.js'

// Host-side lifecycle (reset/take) intentionally stays out of this namespace —
// it is imported by the worker's instruction core, not injected into scripts.

/** machine — CAM toolpath helper (BREP.io port).
 *
 *
 * @param opts - the opts value.
 * @returns CamMachineDecl - computed result.
 */
export function machine(opts: Record<string, any>): CamMachineDecl {
  assertKnownKeys(opts || {}, CAM_MACHINE_DECL_KEYS, 'machine')
  const decl = normalizeCamMachineDecl(opts)
  declareMachine(decl)
  return decl
}

/** stock — CAM toolpath helper (BREP.io port).
 *
 *
 * @param opts - the opts value.
 * @returns CamStockDecl - computed result.
 */
export function stock(opts: Record<string, any>): CamStockDecl {
  assertKnownKeys(opts || {}, CAM_STOCK_DECL_KEYS, 'stock')
  const decl = normalizeCamStockDecl(opts)
  declareStock(decl)
  return decl
}

/** roughing — CAM toolpath helper (BREP.io port).
 *
 *
 * @param opts - the opts value.
 * @returns CamOperationDecl - computed result.
 */
export function roughing(
  opts: Record<string, any> & { target: string | Shape },
): CamOperationDecl {
  assertKnownKeys(opts || {}, CAM_OPERATION_DECL_KEYS, 'op.roughing')
  const decl = normalizeCamOperationDecl(resolveTarget(opts), 'roughing', 'op.roughing')
  declareOperation(decl)
  return decl
}

/** surfacing — CAM toolpath helper (BREP.io port).
 *
 *
 * @param opts - the opts value.
 * @returns CamOperationDecl - computed result.
 */
export function surfacing(
  opts: Record<string, any> & { target: string | Shape },
): CamOperationDecl {
  assertKnownKeys(opts || {}, CAM_OPERATION_DECL_KEYS, 'op.surfacing')
  const decl = normalizeCamOperationDecl(resolveTarget(opts), 'surfacing', 'op.surfacing')
  declareOperation(decl)
  return decl
}

function resolveTarget(opts: Record<string, any>): Record<string, any> {
  if (opts.target && typeof opts.target === 'object' && typeof opts.target !== 'string') {
    return { ...opts, target: partNameOf(opts.target) }
  }
  return opts
}

/** Extract a part name from a Shape reference; throws when the Shape is not a
 * top-level named variable (mirrors fai-animation's hard-error policy). */
function partNameOf(shape: Shape): string {
  const name = (shape as any)?.name
  if (typeof name === 'string' && name.trim()) return name.trim()
  const hint = (shape as any)?.userData?.name
  if (typeof hint === 'string' && hint.trim()) return hint.trim()
  throw new Error('[cam] op: target Shape has no resolvable part name; pass a part name string or a named top-level variable.')
}

export type { CamFaceRef, CamMachineDecl, CamOperationDecl, CamStockDecl }

/** op — CAM toolpath constant (BREP.io port). */
export const op = { roughing, surfacing }

/** cam — CAM toolpath constant (BREP.io port). */
export const cam = { machine, stock, op }
