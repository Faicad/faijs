/**
 * fixtures — 读取 Python 侧生成的参考数据（`fixtures/reference/manifest.json`）
 *
 * 参考数据由 `scripts/gen-reference.py` 用 CadQuery + cq_gears 生成，入库随版本走。
 * 路径用 `import.meta.url` 解析，**与 cwd 无关**。
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** `fixtures/reference` 目录绝对路径。 */
export const REFERENCE_DIR = resolve(HERE, '..', 'fixtures', 'reference')

/** 本地生成物目录（`out/`，git 忽略）。 */
export const OUT_DIR = resolve(HERE, '..', 'out')

/** 单个齿面段的参考数据（Python `Face.makeSplineApprox` 的输入与输出）。 */
export interface ReferenceGrid {
  name: 'lflank' | 'tip' | 'rflank' | 'root'
  rows: number
  cols: number
  /** 行主序展开的 `[x,y,z]` */
  points: number[][]
  /** cq 侧该面的 `Area()` */
  area: number
  /** 在该面 (u,v) 网格上采样的 3D 点 */
  sample_points: number[][]
}

/** 单个参考用例（manifest.json 的 `cases[]` 元素）。 */
export interface ReferenceCase {
  id: string
  class: string
  args: Record<string, unknown>
  volume?: number
  bbox?: number[]
  constants?: Record<string, number>
  derived?: Record<string, number>
  profile?: {
    t_lflank_pts: number[][]
    t_tip_pts: number[][]
    t_rflank_pts: number[][]
    t_root_pts: number[][]
  }
  tooth_face_grids?: ReferenceGrid[]
  tooth_face_grids_error?: string
  expected?: { volume: number; bbox: number[] }
  error?: string
}

/** 参考数据清单（`fixtures/reference/manifest.json` 的整体结构）。 */
export interface ReferenceManifest {
  generator: string
  set: string
  environment: Record<string, string>
  sample_grid: { nu: number; nv: number }
  cases: ReferenceCase[]
}

/**
 * 读取并解析参考清单；文件缺失或 JSON 损坏时直接抛。
 *
 * @returns 解析后的参考清单
 */
export function loadManifest(): ReferenceManifest {
  return JSON.parse(readFileSync(resolve(REFERENCE_DIR, 'manifest.json'), 'utf-8')) as ReferenceManifest
}

/**
 * 按 id 取用例；不存在直接抛（测试里的拼写错误不该被静默吞掉）。
 *
 * @param id 参考用例 id（如 `spur-basic`）
 * @returns 对应的参考用例
 */
export function caseById(id: string): ReferenceCase {
  const m = loadManifest()
  const c = m.cases.find((x) => x.id === id)
  if (!c) throw new Error(`reference case not found: ${id} (have: ${m.cases.map((x) => x.id).join(', ')})`)
  if (c.error) throw new Error(`reference case ${id} failed at generation time: ${c.error}`)
  return c
}

/**
 * 参考 STEP 文件路径。
 *
 * @param id 参考用例 id
 * @returns 该用例参考 STEP 文件的绝对路径
 */
export function stepPath(id: string): string {
  return resolve(REFERENCE_DIR, `${id}.step`)
}
