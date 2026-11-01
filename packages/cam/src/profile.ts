

/** CamControllerFlavor — CAM toolpath type (BREP.io port). */
export type CamControllerFlavor = 'grbl' | 'linuxcnc' | 'fanuc'

/** CamMachineProfile — CAM toolpath type (BREP.io port). */
export type CamMachineProfile = {
  name: string
  controller: CamControllerFlavor
  units: 'mm'
  maxSpindleRPM: number
  defaultRapidRate: number
  safeParkZ: number
  tokenSpacer: boolean
  stripComments: boolean
  header: string
  footer: string
}

/** DEFAULT_CAM_MACHINE_PROFILE — CAM toolpath constant (BREP.io port). */
export const DEFAULT_CAM_MACHINE_PROFILE: CamMachineProfile = {
  name: 'Generic 3 Axis Mill',
  controller: 'grbl',
  units: 'mm',
  maxSpindleRPM: 24000,
  defaultRapidRate: 2500,
  safeParkZ: 15,
  tokenSpacer: true,
  stripComments: false,
  header: '',
  footer: '',
}

function finiteNumber(value: any, fallback: number) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function positiveNumber(value: any, fallback: number, min = 0) {
  return Math.max(min, finiteNumber(value, fallback))
}

/** normalizeCamControllerFlavor — CAM toolpath helper (BREP.io port).
 *
 *
 * @param value - the value value.
 * @returns CamControllerFlavor - computed result.
 */
export function normalizeCamControllerFlavor(value: any): CamControllerFlavor {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'linuxcnc') return 'linuxcnc'
  if (raw === 'fanuc') return 'fanuc'
  return 'grbl'
}

/** normalizeCamMachineProfile — CAM toolpath helper (BREP.io port).
 *
 *
 * @param raw - the raw value.
 * @returns CamMachineProfile - computed result.
 */
export function normalizeCamMachineProfile(raw: any = null): CamMachineProfile {
  const source = (raw && typeof raw === 'object') ? raw : {}
  const fallback = DEFAULT_CAM_MACHINE_PROFILE
  return {
    name: String(source.name || fallback.name).trim() || fallback.name,
    controller: normalizeCamControllerFlavor(source.controller),
    units: 'mm',
    maxSpindleRPM: positiveNumber(source.maxSpindleRPM, fallback.maxSpindleRPM, 0),
    defaultRapidRate: positiveNumber(source.defaultRapidRate, fallback.defaultRapidRate, 1),
    safeParkZ: positiveNumber(source.safeParkZ, fallback.safeParkZ, 0),
    tokenSpacer: source.tokenSpacer !== false,
    stripComments: source.stripComments === true,
    header: String(source.header || ''),
    footer: String(source.footer || ''),
  }
}

/** mergeCamMachineProfile — CAM toolpath helper (BREP.io port).
 *
 *
 * @param profile - the profile value.
 * @param patch - the patch value.
 * @returns CamMachineProfile - computed result.
 */
export function mergeCamMachineProfile(profile: any, patch: any = {}): CamMachineProfile {
  const current = normalizeCamMachineProfile(profile)
  const source = (patch && typeof patch === 'object') ? patch : {}
  return normalizeCamMachineProfile({
    ...current,
    ...source,
  })
}

/** splitMachineMacroLines — CAM toolpath helper (BREP.io port).
 *
 *
 * @param value - the value value.
 * @returns string[] - computed result.
 */
export function splitMachineMacroLines(value: any): string[] {
  return String(value || '')
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
}

// ---- stock ----

/** CamStockMode — CAM toolpath type (BREP.io port). */
export type CamStockMode = 'auto' | 'fixed'

/** CamStockProfile — CAM toolpath type (BREP.io port). */
export type CamStockProfile = {
  mode: CamStockMode
  margin: number
  sizeX: number | null
  sizeY: number | null
  sizeZ: number | null
  offsetX: number
  offsetY: number
  offsetZ: number
}

/** DEFAULT_CAM_STOCK_PROFILE — CAM toolpath constant (BREP.io port). */
export const DEFAULT_CAM_STOCK_PROFILE: CamStockProfile = {
  mode: 'auto',
  margin: 6.35,
  sizeX: null,
  sizeY: null,
  sizeZ: null,
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
}

function nonNegativeNumber(value: any, fallback: number) {
  return Math.max(0, finiteNumber(value, fallback))
}

function nullablePositiveNumber(value: any) {
  if (value == null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : null
}

/** normalizeCamStockMode — CAM toolpath helper (BREP.io port).
 *
 *
 * @param value - the value value.
 * @returns CamStockMode - computed result.
 */
export function normalizeCamStockMode(value: any): CamStockMode {
  return String(value || '').trim().toLowerCase() === 'fixed' ? 'fixed' : 'auto'
}

/** normalizeCamStockProfile — CAM toolpath helper (BREP.io port).
 *
 *
 * @param raw - the raw value.
 * @returns CamStockProfile - computed result.
 */
export function normalizeCamStockProfile(raw: any = null): CamStockProfile {
  const source = (raw && typeof raw === 'object') ? raw : {}
  const fallback = DEFAULT_CAM_STOCK_PROFILE
  const hasFixedSize = source.sizeX != null || source.sizeY != null || source.sizeZ != null
  return {
    mode: hasFixedSize && source.mode == null ? 'fixed' : normalizeCamStockMode(source.mode),
    margin: nonNegativeNumber(source.margin ?? source.stockMargin, fallback.margin),
    sizeX: nullablePositiveNumber(source.sizeX),
    sizeY: nullablePositiveNumber(source.sizeY),
    sizeZ: nullablePositiveNumber(source.sizeZ),
    offsetX: finiteNumber(source.offsetX, fallback.offsetX),
    offsetY: finiteNumber(source.offsetY, fallback.offsetY),
    offsetZ: finiteNumber(source.offsetZ, fallback.offsetZ),
  }
}

/** mergeCamStockProfile — CAM toolpath helper (BREP.io port).
 *
 *
 * @param profile - the profile value.
 * @param patch - the patch value.
 * @returns CamStockProfile - computed result.
 */
export function mergeCamStockProfile(profile: any, patch: any = {}): CamStockProfile {
  const current = normalizeCamStockProfile(profile)
  const source = (patch && typeof patch === 'object') ? patch : {}
  return normalizeCamStockProfile({
    ...current,
    ...source,
  })
}
