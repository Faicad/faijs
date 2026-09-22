/**
 * @faicad/cq-compat-assembly/save — Assembly.save() STEP 导出（Node 侧）。
 *
 * 独立模块：imports `node:fs`，因此只出现在包根入口（"."），不进入
 * "./browser" 入口（浏览器打包 node:fs 会失败）。浏览器消费方用
 * solve()/toCompound()；save() 仅在 Node（CLI / 测试）使用。
 */

import { writeFileSync } from 'node:fs'
import { getBackends } from '@faicad/faijs/runtime-state'
import { brepOf } from '@faicad/faijs/shape'
import type { BrepHandle } from '@faicad/faijs/brep/engine/types'
import { exportStepFromSolids } from '@faicad/faijs/brep/export/step'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
import type { CqAssembly } from './assembly'

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
