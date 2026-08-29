export interface ScrewParams {
  system: 'metric' | 'imperial'
  specIdx: number           // 规格 index，默认 4 → M5
  thread: 'coarse' | 'fine' | 'custom' | 'none'
  pitchCustom: number       // thread='custom' 时的螺距 mm
  length: number            // 螺杆长度 mm
  head: 'hex' | 'chc' | 'none'
  nRad: number              // 径向分辨率 32 | 48 | 64 | 96
}

export interface ScrewSpec {
  /** 公称直径 mm（metric 与 imperial 均已换算为 mm） */
  dia: number
  /** metric: 粗牙螺距 mm ｜ imperial: 粗牙 TPI（每英寸牙数） */
  coarse: number
  /** metric: 细牙螺距 mm ｜ imperial: 细牙 TPI */
  fine: number
  /** 显示标签，如 "M6"、'1/4"'、'#4' */
  label: string
}

export type ScrewSystem = 'metric' | 'imperial'

/**
 * 螺钉头部尺寸共享常量 — BREP 和 Mesh 路径的唯一真源。
 *
 * 因子均相对于公称直径 dia。
 * 统一到标准螺丝规格（与 BREP 现有实现一致）。
 */
export const SCREW_HEAD_DIMS = {
  hex: {
    radiusFactor: 0.9,     // hex 头半径 = 0.9 × dia
    heightFactor: 0.6,     // hex 头高 = 0.6 × dia
  },
  chc: {
    radiusFactor: 1.0,     // chc 圆锥底半径 = 1.0 × dia
    heightFactor: 0.5,     // chc 头高 = 0.5 × dia
  },
} as const

/** Metric screw specifications (M2–M24) */
const METRIC_SPECS: ScrewSpec[] = [
  { dia: 2.0,   coarse: 0.40, fine: 0.25, label: 'M2' },
  { dia: 2.5,   coarse: 0.45, fine: 0.35, label: 'M2.5' },
  { dia: 3.0,   coarse: 0.50, fine: 0.35, label: 'M3' },
  { dia: 4.0,   coarse: 0.70, fine: 0.50, label: 'M4' },
  { dia: 5.0,   coarse: 0.80, fine: 0.50, label: 'M5' },
  { dia: 6.0,   coarse: 1.00, fine: 0.75, label: 'M6' },
  { dia: 8.0,   coarse: 1.25, fine: 1.00, label: 'M8' },
  { dia: 10.0,  coarse: 1.50, fine: 1.25, label: 'M10' },
  { dia: 12.0,  coarse: 1.75, fine: 1.25, label: 'M12' },
  { dia: 14.0,  coarse: 2.00, fine: 1.50, label: 'M14' },
  { dia: 16.0,  coarse: 2.00, fine: 1.50, label: 'M16' },
  { dia: 20.0,  coarse: 2.50, fine: 2.00, label: 'M20' },
  { dia: 24.0,  coarse: 3.00, fine: 2.00, label: 'M24' },
]

/** Imperial screw specifications (#4–1") */
const IMPERIAL_SPECS: ScrewSpec[] = [
  { dia: 2.844,  coarse: 40, fine: 48, label: '#4' },
  { dia: 3.454,  coarse: 32, fine: 40, label: '#6' },
  { dia: 4.166,  coarse: 32, fine: 36, label: '#8' },
  { dia: 4.826,  coarse: 24, fine: 32, label: '#10' },
  { dia: 6.350,  coarse: 20, fine: 28, label: '1/4"' },
  { dia: 7.938,  coarse: 18, fine: 24, label: '5/16"' },
  { dia: 9.525,  coarse: 16, fine: 24, label: '3/8"' },
  { dia: 11.113, coarse: 14, fine: 20, label: '7/16"' },
  { dia: 12.700, coarse: 13, fine: 20, label: '1/2"' },
  { dia: 15.875, coarse: 11, fine: 18, label: '5/8"' },
  { dia: 19.050, coarse: 10, fine: 16, label: '3/4"' },
  { dia: 22.225, coarse: 9,  fine: 14, label: '7/8"' },
  { dia: 25.400, coarse: 8,  fine: 12, label: '1"' },
]

/** Get all specs for a given system */
export function getScrewSpecs(system: ScrewSystem): ScrewSpec[] {
  return system === 'metric' ? METRIC_SPECS : IMPERIAL_SPECS
}

/** Get a specific spec by system and index */
export function getScrewSpec(system: ScrewSystem, specIdx: number): ScrewSpec {
  const specs = getScrewSpecs(system)
  const idx = Math.max(0, Math.min(specIdx, specs.length - 1))
  return specs[idx]
}

/**
 * Convert thread type to actual pitch in mm.
 * For imperial, TPI → mm via 25.4 / tpi.
 */
export function threadToPitchMm(
  system: ScrewSystem,
  spec: ScrewSpec,
  thread: 'coarse' | 'fine' | 'custom' | 'none',
  pitchCustom?: number,
): number {
  if (thread === 'none') return 0
  if (thread === 'custom') return pitchCustom ?? spec.coarse
  const val = thread === 'fine' ? spec.fine : spec.coarse
  return system === 'metric' ? val : 25.4 / val
}
