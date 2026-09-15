/**
 * testing/reference-options.ts — `fixtures/reference/manifest.json` 的 `(class, args)`
 * 映射到 TS 侧建模调用的**唯一真源**（方案 §4.1 / §5.4 红线）。
 *
 * 放在 `src/testing/` 而非库源码里：它只服务参考数据比对，库运行时不依赖
 * （`tsconfig.build.json` 排除本目录）。
 *
 * ⚠️ cq_gears 移植的教训（2026-09-12）：**禁止在测试里就地另写一份映射**。
 * 曾因测试漏抽 `bore_d` 导致「拿无轴孔比有轴孔」的 2% 假偏差。因此这里：
 *   - `args` 的键做**白名单校验**，出现未知键直接抛错（manifest 加参数不会被静默丢弃）；
 *   - 参数名与上游 Python 逐字一致（snake_case），不做 camelCase 转换。
 */

import type { EndFinish, ThreadResult, Hand } from '../thread'
import { buildThread, isoThread, acmeThread, metricTrapezoidalThread, plasticBottleThread } from '../thread'
import type { NutResult } from '../nut'
import {
  bradTeeNut,
  domedCapNut,
  heatSetNut,
  hexNut,
  hexNutWithFlange,
  squareNut,
  unchamferedHexagonNut,
} from '../nut'
import type { WasherResult } from '../washer'
import { chamferedWasher, cheeseHeadWasher, plainWasher } from '../washer'
import type { ScrewResult } from '../screw'
import { buildScrew, SCREW_CLASSES } from '../screw'
import type { BearingResult } from '../bearing'
import { buildBearing, BEARING_CLASSES } from '../bearing'

/** manifest 中一条用例的形状（gen-reference.py 的 `build_case` 产出）。 */
export interface ManifestCase {
  id: string
  class: string
  args: Record<string, unknown>
  volume: number
  /** 三角化体积（独立于 GProps）——上游 Thread 的 GProps 体积不可靠，以本项为基准。 */
  volume_mesh?: number
  bbox: number[]
  shapeType?: string
  step: string
  expect_volume?: number
  expect_diff?: number
  parts?: Array<{
    name: string
    volume: number
    bbox: number[]
    bbox_min?: number[]
    bbox_max?: number[]
    center: number[]
  }>
}

/** 参考 manifest 的顶层结构（`fixtures/reference/manifest.json`）。 */
export interface Manifest {
  generator: string
  set: string
  environment: Record<string, string | null>
  cases: ManifestCase[]
}

/** 螺母类 args 白名单（`Nut.__init__` 签名，fastener.py:520）。 */
const NUT_ARGS: readonly string[] = ['size', 'fastener_type', 'hand', 'simple']
/** 垫圈类 args 白名单（`Washer.__init__` 签名，fastener.py:2235）。 */
const WASHER_ARGS: readonly string[] = ['size', 'fastener_type']
/** 螺钉类 args 白名单（`Screw.__init__` 签名，fastener.py:176）。 */
const SCREW_ARGS: readonly string[] = ['size', 'length', 'fastener_type', 'hand', 'simple']

/** 每个类的合法 args 键（上游 signature 的并集；含只影响参数、不影响几何的项）。 */
const ALLOWED_ARGS: Readonly<Record<string, readonly string[]>> = {
  Thread: [
    'apex_radius', 'apex_width', 'root_radius', 'root_width', 'pitch', 'length',
    'apex_offset', 'hand', 'end_finishes', 'simple',
  ],
  IsoThread: ['major_diameter', 'pitch', 'length', 'external', 'hand', 'end_finishes', 'simple'],
  AcmeThread: ['size', 'length', 'external', 'hand', 'end_finishes'],
  MetricTrapezoidalThread: ['size', 'length', 'external', 'hand', 'end_finishes'],
  PlasticBottleThread: ['size', 'external', 'hand', 'manufacturingCompensation'],
  // ── W4：螺母 7 类（`Nut.__init__` 签名：size / fastener_type / hand / simple）──
  HexNut: NUT_ARGS,
  HexNutWithFlange: NUT_ARGS,
  DomedCapNut: NUT_ARGS,
  UnchamferedHexagonNut: NUT_ARGS,
  SquareNut: NUT_ARGS,
  BradTeeNut: NUT_ARGS,
  HeatSetNut: NUT_ARGS,
  // ── W4：垫圈 3 类（`Washer.__init__` 签名：size / fastener_type）──
  PlainWasher: WASHER_ARGS,
  ChamferedWasher: WASHER_ARGS,
  CheeseHeadWasher: WASHER_ARGS,
  // ── W5：螺钉 12 类（`Screw.__init__` 签名：size / length / fastener_type /
  //         hand / simple；`socket_clearance` 上游默认 6mm，manifest 未传）──
  ButtonHeadScrew: SCREW_ARGS,
  ButtonHeadWithCollarScrew: SCREW_ARGS,
  CheeseHeadScrew: SCREW_ARGS,
  CounterSunkScrew: SCREW_ARGS,
  HexHeadScrew: SCREW_ARGS,
  HexHeadWithFlangeScrew: SCREW_ARGS,
  PanHeadScrew: SCREW_ARGS,
  PanHeadWithCollarScrew: SCREW_ARGS,
  RaisedCheeseHeadScrew: SCREW_ARGS,
  RaisedCounterSunkOvalHeadScrew: SCREW_ARGS,
  SetScrew: SCREW_ARGS,
  SocketHeadCapScrew: SCREW_ARGS,
  // ── W6：轴承 5 类（`Bearing.__init__` 签名：size / bearing_type）──
  SingleRowDeepGrooveBallBearing: ['size', 'bearing_type'],
  SingleRowCappedDeepGrooveBallBearing: ['size', 'bearing_type'],
  SingleRowAngularContactBallBearing: ['size', 'bearing_type'],
  SingleRowCylindricalRollerBearing: ['size', 'bearing_type'],
  SingleRowTaperedRollerBearing: ['size', 'bearing_type'],
}

/** 白名单覆盖的全部螺纹类名（= `ALLOWED_ARGS` 的键，按声明序）。 */
export const THREAD_CLASSES = [
  'Thread',
  'IsoThread',
  'AcmeThread',
  'MetricTrapezoidalThread',
  'PlasticBottleThread',
]

/** 白名单覆盖的全部螺母类名（W4）。 */
export const NUT_CLASSES = [
  'HexNut',
  'HexNutWithFlange',
  'DomedCapNut',
  'UnchamferedHexagonNut',
  'SquareNut',
  'BradTeeNut',
  'HeatSetNut',
]

/**
 * 白名单覆盖的全部垫圈类名（W4）。
 */
export const WASHER_CLASSES = ['PlainWasher', 'ChamferedWasher', 'CheeseHeadWasher']

/** 白名单覆盖的全部螺钉类名（W5）；由 `src/screw.ts` 的 `SCREW_TABLES` 派生，避免两处清单漂移。 */
export { SCREW_CLASSES }

/** 白名单覆盖的全部轴承类名（W6）；由 `src/bearing.ts` 的 `BEARING_CLASSES` 派生。 */
export { BEARING_CLASSES }

function pick<T>(args: Record<string, unknown>, key: string, fallback: T): T {
  return (args[key] as T | undefined) ?? fallback
}

function num(args: Record<string, unknown>, key: string): number {
  const v = args[key]
  if (typeof v !== 'number')
    throw new Error(`reference-options: arg ${key} must be a number, got ${JSON.stringify(v)}`)
  return v
}

function finishes(args: Record<string, unknown>): [EndFinish, EndFinish] | undefined {
  const v = args['end_finishes']
  if (v === undefined) return undefined
  if (!Array.isArray(v) || v.length !== 2)
    throw new Error(`reference-options: end_finishes must be a 2-tuple, got ${JSON.stringify(v)}`)
  return [v[0] as EndFinish, v[1] as EndFinish]
}

/** 白名单校验：manifest 里出现的每个键都必须被本文件消费（反之亦然）。 */
function assertArgsKnown(
  c: ManifestCase,
  family: 'thread' | 'nut' | 'washer' | 'screw' | 'bearing',
): void {
  const allowed = ALLOWED_ARGS[c.class]
  if (!allowed)
    throw new Error(
      `reference-options: class ${c.class} is not a ${family} class ` +
        `(known: ${[
          ...THREAD_CLASSES,
          ...NUT_CLASSES,
          ...WASHER_CLASSES,
          ...SCREW_CLASSES,
          ...BEARING_CLASSES,
        ].join(', ')})`,
    )
  for (const key of Object.keys(c.args))
    if (!allowed.includes(key))
      throw new Error(
        `reference-options: unknown arg "${key}" for ${c.class} — update the mapping ` +
          `instead of dropping the parameter (cq_gears lesson, 2026-09-12)`,
      )
}

/**
 * 把一条 manifest 用例构造成 TS 侧几何（线程类）。
 * @param c - manifest 用例（`class` 决定分派，`args` 逐字取自参考数据）。
 * @returns 该用例的螺纹构造结果。
 */
export function buildThreadReference(c: ManifestCase): ThreadResult {
  assertArgsKnown(c, 'thread')
  const hand = pick<Hand>(c.args, 'hand', 'right')
  const ef = finishes(c.args)
  switch (c.class) {
    case 'Thread':
      return buildThread({
        apex_radius: num(c.args, 'apex_radius'),
        apex_width: num(c.args, 'apex_width'),
        root_radius: num(c.args, 'root_radius'),
        root_width: num(c.args, 'root_width'),
        pitch: num(c.args, 'pitch'),
        length: num(c.args, 'length'),
        apex_offset: pick(c.args, 'apex_offset', 0),
        hand,
        end_finishes: ef,
        simple: pick(c.args, 'simple', false),
      })
    case 'IsoThread':
      return isoThread({
        major_diameter: num(c.args, 'major_diameter'),
        pitch: num(c.args, 'pitch'),
        length: num(c.args, 'length'),
        external: pick(c.args, 'external', true),
        hand,
        end_finishes: ef,
        simple: pick(c.args, 'simple', false),
      })
    case 'AcmeThread':
      return acmeThread({
        size: String(c.args['size']), length: num(c.args, 'length'),
        external: pick(c.args, 'external', true), hand, end_finishes: ef,
      })
    case 'MetricTrapezoidalThread':
      return metricTrapezoidalThread({
        size: String(c.args['size']), length: num(c.args, 'length'),
        external: pick(c.args, 'external', true), hand, end_finishes: ef,
      })
    case 'PlasticBottleThread':
      return plasticBottleThread({
        size: String(c.args['size']),
        external: pick(c.args, 'external', true),
        hand,
        manufacturingCompensation: pick(c.args, 'manufacturingCompensation', 0),
      })
    default:
      throw new Error(`reference-options: unhandled class ${c.class}`)
  }
}

/**
 * 相对差（A 侧为基准）；A 侧非正时返回绝对差以避免除零。
 * @param a - 基准值（A 侧）。
 * @param b - 比较值（B 侧）。
 * @returns `|a−b|/a`，或 a ≤ 0 时的 `|a−b|`。
 */
export function relativeDiff(a: number, b: number): number {
  return a > 0 ? Math.abs(a - b) / a : Math.abs(a - b)
}

// ── W4：Nut / Washer 的 (class, args) → TS 建模调用 ─────────────────────────

/** `Nut.__init__` / `Washer.__init__` 的公共入参形状（args 逐字取自 manifest）。 */
function nutParamsOf(c: ManifestCase): { size: string; fastener_type: string; hand: Hand; simple: boolean } {
  return {
    size: String(c.args['size']),
    fastener_type: String(c.args['fastener_type']),
    hand: pick<Hand>(c.args, 'hand', 'right'),
    simple: pick(c.args, 'simple', true),
  }
}

/**
 * 把一条 manifest 用例构造成 TS 侧螺母几何（W4）。
 *
 * ⚠️ `BradTeeNut` / `HeatSetNut` 是 **W4 内的已知缺口**，本函数会**如实抛出**
 * 各自缺失依赖的错（见 `src/nut.ts` 的 JSDoc 与分析文档），不做静默降级。
 * 测试侧对这两类只断言「抛错且信息含缺口说明」，不比对几何。
 * @param c - manifest 用例（`class` 决定分派）。
 * @returns 螺母实体与上游派生量。
 */
export function buildNutReference(c: ManifestCase): NutResult {
  assertArgsKnown(c, 'nut')
  const p = nutParamsOf(c)
  switch (c.class) {
    case 'HexNut':
      return hexNut(p)
    case 'HexNutWithFlange':
      return hexNutWithFlange(p)
    case 'DomedCapNut':
      return domedCapNut(p)
    case 'UnchamferedHexagonNut':
      return unchamferedHexagonNut(p)
    case 'SquareNut':
      return squareNut(p)
    case 'BradTeeNut':
      return bradTeeNut(p)
    case 'HeatSetNut':
      return heatSetNut(p)
    default:
      throw new Error(`reference-options: unhandled nut class ${c.class}`)
  }
}

/**
 * 把一条 manifest 用例构造成 TS 侧垫圈几何（W4）。
 *
 * ⚠️ 垫圈的 A 侧 `volume` 字段是解析值的 **2×**（OCP BRepGProp 对 revolve 原生
 * 内孔管的病理），读真值必须用 `volume_mesh`——见 `src/washer.ts` 文件头。
 * @param c - manifest 用例（`class` 决定分派）。
 * @returns 垫圈实体与上游派生量。
 */
export function buildWasherReference(c: ManifestCase): WasherResult {
  assertArgsKnown(c, 'washer')
  const p = { size: String(c.args['size']), fastener_type: String(c.args['fastener_type']) }
  switch (c.class) {
    case 'PlainWasher':
      return plainWasher(p)
    case 'ChamferedWasher':
      return chamferedWasher(p)
    case 'CheeseHeadWasher':
      return cheeseHeadWasher(p)
    default:
      throw new Error(`reference-options: unhandled washer class ${c.class}`)
  }
}

/**
 * 把一条 manifest 用例构造成 TS 侧螺钉几何（W5）。
 *
 * ⚠️ `PanHeadWithCollarScrew`（din967）与 `RaisedCheeseHeadScrew`（iso7045）各自的
 * **唯一** `fastener_type` 是 PH（cross）沉孔，本内核 `draftPrism` 在 30° 锥度下
 * 截面自交即抛错（`E_RECESS_TAPER_UNSUPPORTED`，见 `src/recess.ts` 文件头）——
 * 这是 **W5 内的已知缺口**，本函数**如实抛出**，测试侧只断言「抛错且信息含缺口说明」。
 * @param c - manifest 用例（`class` 决定分派，`args` 逐字取自参考数据）。
 * @returns 螺钉实体与上游派生量。
 */
export function buildScrewReference(c: ManifestCase): ScrewResult {
  assertArgsKnown(c, 'screw')
  return buildScrew(c.class as (typeof SCREW_CLASSES)[number], {
    size: String(c.args['size']),
    length: num(c.args, 'length'),
    fastener_type: String(c.args['fastener_type']),
    hand: pick<Hand>(c.args, 'hand', 'right'),
    simple: pick(c.args, 'simple', true),
  })
}

/**
 * 把一条 manifest 用例构造成 TS 侧轴承几何（W6）。
 *
 * 轴承 5 类均为 B 侧完整复刻（无已知内核缺口），逐例比对体积/bbox/质心。
 * @param c - manifest 用例（`class` 决定分派，`args` 逐字取自参考数据）。
 * @returns 轴承实体与上游派生量。
 */
export function buildBearingReference(c: ManifestCase): BearingResult {
  assertArgsKnown(c, 'bearing')
  return buildBearing(c.class as (typeof BEARING_CLASSES)[number], {
    size: String(c.args['size']),
    bearingType: String(c.args['bearing_type']),
  })
}
