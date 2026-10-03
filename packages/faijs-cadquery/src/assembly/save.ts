/**
 * @faicad/cq-compat-assembly/save — Assembly.save()/importStep()/load()（Node 侧）。
 *
 * 独立模块：imports `node:fs`，因此只出现在包根入口（"."），不进入
 * "./browser" 入口（浏览器打包 node:fs 会失败）。浏览器消费方用
 * solve()/toCompound()；save()/importStep()/load() 仅在 Node（CLI / 测试）使用。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { getBackends } from '@faicad/faijs/runtime-state'
import { readFileArrayBuffer } from '@faicad/faijs/io/bytes'
import { brepOf, fromBrep } from '@faicad/faijs/shape'
import type { BrepHandle } from '@faicad/faijs/brep/engine/types'
import { exportStepFromSolids } from '@faicad/faijs/brep/export/step'
import { loadBrep } from '@faicad/faijs/brep/brep-ops'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
import type { CqAssembly } from './assembly'
import { buildAssembly } from './assembly'

/**
 * save — CQ Assembly.save() 等价（STEP 导出）。
 * @param asm - 已 buildAssembly 的装配对象（建议先 solve() 再导出，得到求解位姿）。
 * @param path - 输出文件路径（.step）。
 * @param opts - optional: { exportType?: 'STEP' }（当前仅支持 STEP）。
 */
export async function save(
  asm: CqAssembly,
  path: string,
  opts?: { exportType?: 'STEP' },
): Promise<void> {
  if (opts?.exportType && opts.exportType !== 'STEP') {
    throw new Error(`[cq-compat-assembly] save(): unsupported exportType "${opts.exportType}" (only STEP)`)
  }
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[cq-compat-assembly] save(): BREP kernel unavailable')
  const entries = asm.members.map((m) => ({
    solid: brepOf(m.shape) as BrepHandle | undefined,
    name: m.name,
    color: m.color,
  }))
  const buf = exportStepFromSolids(kernel, entries)
  writeFileSync(path, Buffer.from(buf))
}
/**
 * importStep — CQ Assembly.importStep() 等价（STEP 文件导入为装配）。
 *
 * 读 STEP 文件 → OCCT 解析 → 单成员装配（`part_1`）。多 solid STEP 当前作为
 * 单 compound 成员（后续可拆多 solid 为多成员，需 kernel.getSubShapes 拆解）。
 *
 * @param path - STEP 文件本地路径。
 * @param unit - 单位（当前忽略，faijs 统一 mm；对齐 CQ 签名保留）。
 * @returns Promise<CqAssembly> 含导入几何的装配对象。
 */
export async function importStep(
  path: string,
  unit?: 'MM' | 'CM' | 'M' | 'IN',
): Promise<CqAssembly> {
  void unit
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[cq-compat-assembly] importStep(): BREP kernel unavailable')
  const buffer = readFileArrayBuffer(path)
  const { solid: solidHandle, shape } = loadBrep(
    kernel, buffer, undefined, undefined, { allowNonSolid: true },
  )
  const memberShape = fromBrep(shape, { solid: solidHandle })
  return buildAssembly('imported', [{ name: 'part_1', shape: memberShape }], [])
}

/**
 * load — CQ Assembly.load() 等价。当前仅支持 STEP（别名 importStep）。
 *
 * @param path - 文件本地路径。
 * @param importType - 导入类型（当前仅 'STEP'，默认自动推断扩展名）。
 * @param unit - 单位。
 * @returns Promise<CqAssembly>
 */
export async function load(
  path: string,
  importType?: 'STEP' | 'STL' | 'BREP',
  unit?: 'MM' | 'CM' | 'M' | 'IN',
): Promise<CqAssembly> {
  void importType
  return importStep(path, unit)
}
