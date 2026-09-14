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
}

/** 白名单覆盖的全部螺纹类名（= `ALLOWED_ARGS` 的键，按声明序）。 */
export const THREAD_CLASSES = Object.keys(ALLOWED_ARGS)

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
function assertArgsKnown(c: ManifestCase): void {
  const allowed = ALLOWED_ARGS[c.class]
  if (!allowed)
    throw new Error(
      `reference-options: class ${c.class} is not a thread class ` +
        `(known: ${THREAD_CLASSES.join(', ')})`,
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
  assertArgsKnown(c)
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
