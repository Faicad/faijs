/**
 * camBuild collector — the faijs-side pendant of `animBuild`
 * (fai-animation/context.ts). During script execution `lib.ts` pushes
 * `cam.machine` / `cam.stock` / `cam.op.*` declarations into module state;
 * the worker's instruction core calls `resetCamBuild()` before executing and
 * `takeCamBuild()` after, returning the raw declaration list to the host
 * inside `ScriptExecutionResult.camBuild`.
 *
 * The collector only collects; it does not resolve `target` part names or
 * faces — those resolve inside the worker against faijs solids (see
 * `generate.ts`).
 */
import type { CamMachineDecl, CamOperationDecl, CamStockDecl } from './decl.js'

/** PendingCamBuild — CAM toolpath type (BREP.io port). */
export type PendingCamBuild = {
  machine: CamMachineDecl | null
  stock: CamStockDecl | null
  operations: CamOperationDecl[]
}

let _current: PendingCamBuild | null = null

/** resetCamBuild — CAM toolpath helper (BREP.io port).
 *
 *
 * @returns void - computed result.
 */
export function resetCamBuild(): void {
  _current = {
    machine: null,
    stock: null,
    operations: [],
  }
}

function ensure(): PendingCamBuild {
  if (!_current) resetCamBuild()
  return _current!
}

/** declareMachine — CAM toolpath helper (BREP.io port).
 *
 *
 * @param decl - the decl value.
 * @returns void - computed result.
 */
export function declareMachine(decl: CamMachineDecl): void {
  ensure().machine = decl
}

/** declareStock — CAM toolpath helper (BREP.io port).
 *
 *
 * @param decl - the decl value.
 * @returns void - computed result.
 */
export function declareStock(decl: CamStockDecl): void {
  ensure().stock = decl
}

/** declareOperation — CAM toolpath helper (BREP.io port).
 *
 *
 * @param decl - the decl value.
 * @returns void - computed result.
 */
export function declareOperation(decl: CamOperationDecl): void {
  ensure().operations.push(decl)
}

/** takeCamBuild — CAM toolpath helper (BREP.io port).
 *
 *
 * @returns PendingCamBuild - computed result.
 */
export function takeCamBuild(): PendingCamBuild {
  const current = ensure()
  _current = null
  return current
}
