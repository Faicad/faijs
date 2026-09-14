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
