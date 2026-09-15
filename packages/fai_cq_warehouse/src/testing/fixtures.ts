/**
 * testing/fixtures — 读取 A 侧参考数据（`fixtures/reference/manifest.json`）
 * 与 B 侧产物目录（`out/`）。
 *
 * 放在 `src/testing/` 而非 `src/`：库运行时不依赖参考数据（`tsconfig.build.json`
 * 排除 `src/testing/**`）。路径用 `import.meta.url` 解析，**与 cwd 无关**。
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Manifest, ManifestCase } from './reference-options'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(HERE, '..', '..')

/** `fixtures/reference` 目录绝对路径（A 侧：manifest.json + `*.step`）。 */
export const REFERENCE_DIR = resolve(PKG_ROOT, 'fixtures', 'reference')

/** 本地生成物目录 `out/`（git 忽略；B 侧 STEP 与比对报告写这里）。 */
export const OUT_DIR = resolve(PKG_ROOT, 'out')

/** 读取并解析 A 侧 manifest。
 *
 * @returns manifest（cases 按 id 排序）
 */
export function loadManifest(): Manifest {
  return JSON.parse(
    readFileSync(resolve(REFERENCE_DIR, 'manifest.json'), 'utf-8'),
  ) as Manifest
}

/** A 侧参考 STEP 的路径。
 *
 * @param id 用例 id
 * @returns `fixtures/reference/<id>.step` 的绝对路径
 */
export function stepPath(id: string): string {
  return resolve(REFERENCE_DIR, `${id}.step`)
}

/** B 侧产出 STEP 的路径。
 *
 * @param id 用例 id
 * @returns `out/<id>.step` 的绝对路径
 */
export function ourStepPath(id: string): string {
  return resolve(OUT_DIR, `${id}.step`)
}

/**
 * 读 STEP 文件为**精确的** ArrayBuffer（供 `kernel.importStep`）。
 *
 * ⚠️ 不能直接传 `readFileSync` 的 Buffer：小文件会被 Node 放进 8KB 池，
 * `buf.buffer` 是整个池（尾部有垃圾），STEP < ~4KB 时导入必失败。
 * 同一处理见 `@faicad/cq-compat` 的 `step-compare.ts`。
 * @param path - STEP 文件绝对路径。
 * @returns 仅覆盖该文件字节的 ArrayBuffer。
 */
export function readStepArrayBuffer(path: string): ArrayBuffer {
  const buf = readFileSync(path)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

/** 过滤出线程族用例（W3）。
 *
 * @param manifest manifest
 * @returns 五个线程类的全部用例
 */
export function threadCases(manifest: Manifest): ManifestCase[] {
  return manifest.cases.filter((c) =>
    ['Thread', 'IsoThread', 'AcmeThread', 'MetricTrapezoidalThread', 'PlasticBottleThread'].includes(
      c.class,
    ),
  )
}

/** W4 的螺母 7 类（与 `reference-options.NUT_CLASSES` 同序，此处复制以避免循环依赖）。 */
const NUT_CLASS_NAMES = [
  'HexNut',
  'HexNutWithFlange',
  'DomedCapNut',
  'UnchamferedHexagonNut',
  'SquareNut',
  'BradTeeNut',
  'HeatSetNut',
]

/** W4 的垫圈 3 类。 */
const WASHER_CLASS_NAMES = ['PlainWasher', 'ChamferedWasher', 'CheeseHeadWasher']

/** 过滤出螺母族用例（W4）。
 *
 * @param manifest manifest
 * @returns 七个螺母类的全部用例
 */
export function nutCases(manifest: Manifest): ManifestCase[] {
  return manifest.cases.filter((c) => NUT_CLASS_NAMES.includes(c.class))
}

/** 过滤出垫圈族用例（W4）。
 *
 * @param manifest manifest
 * @returns 三个垫圈类的全部用例
 */
export function washerCases(manifest: Manifest): ManifestCase[] {
  return manifest.cases.filter((c) => WASHER_CLASS_NAMES.includes(c.class))
}

/** W5 的螺钉 12 类（与 `screw.ts` 的 `SCREW_TABLES` 同序，此处复制以避免循环依赖）。 */
const SCREW_CLASS_NAMES = [
  'ButtonHeadScrew',
  'ButtonHeadWithCollarScrew',
  'CheeseHeadScrew',
  'CounterSunkScrew',
  'HexHeadScrew',
  'HexHeadWithFlangeScrew',
  'PanHeadScrew',
  'PanHeadWithCollarScrew',
  'RaisedCheeseHeadScrew',
  'RaisedCounterSunkOvalHeadScrew',
  'SetScrew',
  'SocketHeadCapScrew',
]

/** W6 的轴承 5 类（与 `bearing.ts` 的 `BEARING_CLASSES` 同序，此处复制以避免循环依赖）。 */
const BEARING_CLASS_NAMES = [
  'SingleRowDeepGrooveBallBearing',
  'SingleRowCappedDeepGrooveBallBearing',
  'SingleRowAngularContactBallBearing',
  'SingleRowCylindricalRollerBearing',
  'SingleRowTaperedRollerBearing',
]

/** 过滤出螺钉族用例（W5）。
 *
 * @param manifest manifest
 * @returns 十二个螺钉类的全部用例
 */
export function screwCases(manifest: Manifest): ManifestCase[] {
  return manifest.cases.filter((c) => SCREW_CLASS_NAMES.includes(c.class))
}

/** 过滤出轴承族用例（W6）。
 *
 * @param manifest manifest
 * @returns 五个轴承类的全部用例
 */
export function bearingCases(manifest: Manifest): ManifestCase[] {
  return manifest.cases.filter((c) => BEARING_CLASS_NAMES.includes(c.class))
}

/** CLI 可选的用例集名（`scripts/export-ours.ts` 与 `compare-all.ts` 的 `--set`）。 */
export const CASE_SET_NAMES = ['thread', 'nut', 'washer', 'screw', 'bearing', 'all'] as const

/**
 * 按集合名取 manifest 用例（CLI 用；测试各自直接调对应族函数）。
 * @param set - 集合名（见 {@link CASE_SET_NAMES}）。
 * @param manifest - manifest。
 * @returns 该集合的用例；`all` 返回全部。
 * @throws 集合名未知时（不静默返回空集）。
 */
export function casesForSet(set: string, manifest: Manifest): ManifestCase[] {
  switch (set) {
    case 'thread':
      return threadCases(manifest)
    case 'nut':
      return nutCases(manifest)
    case 'washer':
      return washerCases(manifest)
    case 'screw':
      return screwCases(manifest)
    case 'bearing':
      return bearingCases(manifest)
    case 'all':
      return manifest.cases
    default:
      throw new Error(`fixtures: unknown case set ${JSON.stringify(set)} (one of ${CASE_SET_NAMES.join(', ')})`)
  }
}
