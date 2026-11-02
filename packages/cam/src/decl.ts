/**
 * CAM declaration types and normalizers. Declarations are the
 * sceneScript-facing contract consumed by `collect.ts` during worker
 * execution; normalizers apply defaults and reject unknown option keys.
 */
/** CamWorkBounds — CAM toolpath type (BREP.io port). */
export type CamWorkBounds = {
  x: [number, number]
  y: [number, number]
  z: [number, number]
}

/** CamMachineDecl — CAM toolpath type (BREP.io port). */
export type CamMachineDecl = {
  name: string
  workBounds: CamWorkBounds
  maxSpindleRPM: number
  safeParkZ: number
  controller?: 'grbl' | 'linuxcnc' | 'fanuc'
  units?: 'mm'
  defaultRapidRate?: number
  tokenSpacer?: boolean
  stripComments?: boolean
  header?: string
  footer?: string
}

/** CamStockDecl — CAM toolpath type (BREP.io port). */
export type CamStockDecl = {
  type: 'box' | 'cylinder' | 'custom'
  size?: [number, number, number]
  radius?: number
  height?: number
  center?: [number, number, number]
  target?: string
}

/** CamToolDecl — CAM toolpath type (BREP.io port). */
export type CamToolDecl = {
  type: 'flat' | 'ball'
  diameter: number
  cuttingLength?: number
}

/** CamFaceRef — CAM toolpath type (BREP.io port). */
export type CamFaceRef =
  | number
  | number[]
  | 'all'
  | { part?: string; faceIndex?: number | number[]; name?: string }[]

/** CamOperationDecl — CAM toolpath type (BREP.io port). */
export type CamOperationDecl = {
  name: string
  kind: 'roughing' | 'surfacing'
  target: string
  tool: CamToolDecl
  enabled?: boolean
  // roughing
  stepDown?: number
  extraDepth?: number
  // surfacing
  faces?: CamFaceRef
  // shared
  stepover?: number
  stockAllowance?: number
  linkClearance?: number
  pathTolerance?: number
  sampleSpacing?: number
  minSampleSpacing?: number
  flatnessCosLimit?: number
  rasterDirection?: 'X' | 'Y' | 'Both'
  safeHeight?: number
  feedRate?: number
  plungeRate?: number
  spindleRPM?: number
}

/** assertKnownKeys — CAM toolpath helper (BREP.io port).
 *
 *
 * @param opts - the opts value.
 * @param allowed - the allowed value.
 * @param fnName - the fnName value.
 * @returns void - computed result.
 */
export function assertKnownKeys(
  opts: Record<string, any>,
  allowed: ReadonlySet<string>,
  fnName: string,
): void {
  for (const key of Object.keys(opts || {})) {
    if (allowed.has(key)) continue
    throw new Error(`[cam] ${fnName}: unknown option '${key}' (allowed: ${[...allowed].join(', ')})`)
  }
}

function finiteNumber(value: any, fallback: number) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function clampCoordPair(value: any, fallback: [number, number]): [number, number] {
  const raw = Array.isArray(value) ? value : fallback
  const a = finiteNumber(raw[0], fallback[0])
  const b = finiteNumber(raw[1], fallback[1])
  return [Math.min(a, b), Math.max(a, b)]
}

/** CAM_MACHINE_DECL_KEYS — CAM toolpath constant (BREP.io port). */
export const CAM_MACHINE_DECL_KEYS: ReadonlySet<string> = new Set([
  'name', 'workBounds', 'maxSpindleRPM', 'safeParkZ', 'controller', 'units',
  'defaultRapidRate', 'tokenSpacer', 'stripComments', 'header', 'footer',
])

/** normalizeCamMachineDecl — CAM toolpath helper (BREP.io port).
 *
 *
 * @param raw - the raw value.
 * @returns CamMachineDecl - computed result.
 */
export function normalizeCamMachineDecl(raw: any): CamMachineDecl {
  const source = (raw && typeof raw === 'object') ? raw : {}
  const workBoundsRaw = source.workBounds || {}
  const fallback: CamWorkBounds = { x: [-100, 100], y: [-100, 100], z: [0, 200] }
  const decl: CamMachineDecl = {
    name: String(source.name || 'Generic 3 Axis Mill').trim() || 'Generic 3 Axis Mill',
    workBounds: {
      x: clampCoordPair(workBoundsRaw.x, fallback.x),
      y: clampCoordPair(workBoundsRaw.y, fallback.y),
      z: clampCoordPair(workBoundsRaw.z, fallback.z),
    },
    maxSpindleRPM: Math.max(0, finiteNumber(source.maxSpindleRPM, 24000)),
    safeParkZ: Math.max(0, finiteNumber(source.safeParkZ, 15)),
  }
  if (source.controller !== undefined) decl.controller = String(source.controller).toLowerCase() as CamMachineDecl['controller']
  if (source.units !== undefined) decl.units = 'mm'
  if (source.defaultRapidRate !== undefined) decl.defaultRapidRate = Math.max(0, finiteNumber(source.defaultRapidRate, 2500))
  if (source.tokenSpacer !== undefined) decl.tokenSpacer = source.tokenSpacer !== false
  if (source.stripComments !== undefined) decl.stripComments = source.stripComments === true
  if (source.header !== undefined) decl.header = String(source.header || '')
  if (source.footer !== undefined) decl.footer = String(source.footer || '')
  return decl
}

/** CAM_STOCK_DECL_KEYS — CAM toolpath constant (BREP.io port). */
export const CAM_STOCK_DECL_KEYS: ReadonlySet<string> = new Set([
  'type', 'size', 'radius', 'height', 'center', 'target',
])

/** normalizeCamStockDecl — CAM toolpath helper (BREP.io port).
 *
 *
 * @param raw - the raw value.
 * @returns CamStockDecl - computed result.
 */
export function normalizeCamStockDecl(raw: any): CamStockDecl {
  const source = (raw && typeof raw === 'object') ? raw : {}
  const type = String(source.type || 'box').toLowerCase()
  if (type !== 'box' && type !== 'cylinder' && type !== 'custom') {
    throw new Error(`[cam] stock: unsupported type '${source.type}' (allowed: box, cylinder, custom)`)
  }
  const decl: CamStockDecl = { type }
  if (source.size !== undefined) {
    const size = Array.isArray(source.size) ? source.size.map((v: any) => finiteNumber(v, 0)) : []
    if (size.length >= 3) decl.size = [size[0], size[1], size[2]]
  }
  if (source.radius !== undefined) decl.radius = Math.max(0, finiteNumber(source.radius, 0))
  if (source.height !== undefined) decl.height = Math.max(0, finiteNumber(source.height, 0))
  if (source.center !== undefined && Array.isArray(source.center)) {
    const center = source.center.map((v: any) => finiteNumber(v, 0))
    if (center.length >= 3) decl.center = [center[0], center[1], center[2]]
  }
  if (source.target !== undefined) decl.target = String(source.target || '')
  return decl
}

/** CAM_TOOL_DECL_KEYS — CAM toolpath constant (BREP.io port). */
export const CAM_TOOL_DECL_KEYS: ReadonlySet<string> = new Set(['type', 'diameter', 'cuttingLength'])

/** normalizeCamToolDecl — CAM toolpath helper (BREP.io port).
 *
 *
 * @param raw - the raw value.
 * @param fnName - the fnName value.
 * @returns CamToolDecl - computed result.
 */
export function normalizeCamToolDecl(raw: any, fnName = 'op'): CamToolDecl {
  const source = (raw && typeof raw === 'object') ? raw : {}
  const type = String(source.type || 'flat').toLowerCase()
  if (type !== 'flat' && type !== 'ball') {
    throw new Error(`[cam] ${fnName}: unsupported tool type '${source.type}' (allowed: flat, ball)`)
  }
  const decl: CamToolDecl = {
    type,
    diameter: Math.max(1e-7, Math.abs(finiteNumber(source.diameter, 3.175))),
  }
  if (source.cuttingLength !== undefined) decl.cuttingLength = Math.max(0, finiteNumber(source.cuttingLength, 0))
  return decl
}

/** CAM_OPERATION_DECL_KEYS — CAM toolpath constant (BREP.io port). */
export const CAM_OPERATION_DECL_KEYS: ReadonlySet<string> = new Set([
  'name', 'target', 'tool', 'enabled',
  'stepDown', 'extraDepth',
  'faces', 'stepover', 'stockAllowance', 'linkClearance', 'pathTolerance',
  'sampleSpacing', 'minSampleSpacing', 'flatnessCosLimit', 'rasterDirection',
  'safeHeight', 'feedRate', 'plungeRate', 'spindleRPM',
])

/** normalizeCamOperationDecl — CAM toolpath helper (BREP.io port).
 *
 *
 * @param raw - the raw value.
 * @param kind - the kind value.
 * @param fnName - the fnName value.
 * @returns CamOperationDecl - computed result.
 */
export function normalizeCamOperationDecl(raw: any, kind: 'roughing' | 'surfacing', fnName: string): CamOperationDecl {
  const source = (raw && typeof raw === 'object') ? raw : {}
  const name = String(source.name || (kind === 'roughing' ? 'Roughing' : 'Surfacing')).trim()
  const target = String(source.target || '').trim()
  if (!target) throw new Error(`[cam] ${fnName}: 'target' (part name) is required`)
  const tool = normalizeCamToolDecl(source.tool, fnName)
  if (kind === 'surfacing' && tool.type !== 'ball') {
    throw new Error(`[cam] ${fnName}: surfacing supports ball-nose tools only in this phase (got '${tool.type}')`)
  }
  const decl: CamOperationDecl = {
    name,
    kind,
    target,
    tool,
  }
  if (source.enabled !== undefined) decl.enabled = source.enabled === true
  const numericKeys: Array<[keyof CamOperationDecl, number]> = [
    ['stepDown', 1],
    ['extraDepth', 0],
    ['stepover', 0.8],
    ['stockAllowance', 0],
    ['linkClearance', 0.5],
    ['pathTolerance', 0.01],
    ['sampleSpacing', 0],
    ['minSampleSpacing', 0.05],
    ['flatnessCosLimit', 0.999],
    ['safeHeight', 5],
    ['feedRate', 800],
    ['plungeRate', 200],
    ['spindleRPM', 12000],
  ]
  for (const [key, fallback] of numericKeys) {
    if (source[key] !== undefined) (decl as unknown as Record<string, number>)[key] = finiteNumber(source[key] as number, fallback)
  }
  if (kind === 'roughing' && decl.flatnessCosLimit !== undefined) delete decl.flatnessCosLimit
  if (kind === 'surfacing' && source.faces !== undefined) decl.faces = source.faces
  if (source.rasterDirection !== undefined) {
    const dir = String(source.rasterDirection).trim().toUpperCase()
    if (dir === 'Y') decl.rasterDirection = 'Y'
    else if (dir === 'BOTH' || dir === 'X+Y' || dir === 'Y+X') decl.rasterDirection = 'Both'
    else decl.rasterDirection = 'X'
  }
  return decl
}
