/**
 * assembly-export-bake — 库侧烘焙守卫测试（2026-09-18 探针结论落档）
 *
 * 背景：e2e 求解位姿全对，但 CLI STEP 导出的成员停在恒等位姿（bbox 最大偏差
 * 23.7mm）。dbg 探针（packages/mini_lathe/scripts/dbg-probe-export.ts，保留勿删）
 * 定位出两个根因，本测试防止回归：
 *
 * GOTCHA 1（模块路径 pending 无人消费）：引擎只有 direct-executor 有
 *   applyPendingAssemblyTransforms；CLI brep 模块路径不消费 pending transforms，
 *   setPendingAssemblyTransforms 登记后永远无人取走 → buildAssembly 必须在库侧
 *   直接 solveDetailed() 并把位姿烘焙进成员（mesh 顶点原地变换 + BREP slot.solid
 *   刚体变换）。另：烘焙时旧 solid 句柄不能 release——solidCache（partName 键）
 *   仍指向它，release 后拓扑构建报 INVALID_SHAPE_ID。
 * GOTCHA 2（无约束成员恒等语义）：CQ 求解器不给无约束成员漂移解（固定初始位姿）；
 *   我方 global 求解器会给自由成员（如 slide_top）漂移 transform → 烘焙前须按
 *   「是否被约束引用」过滤。
 *
 * 验证方式：直接 execute assembly.fai.js（模块路径，非 direct），断言 children
 *   的 BREP solid 包围盒与 CQ 参考位姿一致（mb/mt/tp 的 zmin = 6.1/16.1/19.2
 *   叠加各自局部 bbox），slide_top 保持恒等（zmin=0）。烘焙失败 → 全部停在局部
 *   原点（zmin=0）→ 本测试失败。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs-core/node'
import { getSlot, brepOf } from '@faicad/faijs-core/shape'
import { asPartName } from '@faicad/faijs-core/identity'
import { getBackends, nameOf } from '@faicad/faijs-core/runtime-state'
import type { CompoundShape } from '@faicad/faijs-core/shape'
import { createFsProjectLoader, projectKeyOf } from '../../core/src/node-host/fs-project-loader'
import * as cq from './index'

/** mini_lathe 根定位（与 assembly-mini-lathe-e2e.test.ts 同法）。 */
function findMiniLatteRoot(): string {
  const here = fileURLToPath(new URL('.', import.meta.url))
  const candidates = [
    resolve(process.cwd(), '../mini_lathe'),
    resolve(here, '../../mini_lathe'),
    resolve(here, '../../../mini_lathe'),
  ]
  for (const c of candidates) {
    if (existsSync(join(c, 'out/ref/mini_lathe_poses.json'))) return c
  }
  throw new Error(`mini_lathe root not found; candidates: ${candidates.join(', ')}`)
}

const ML = findMiniLatteRoot()
const ASM_FILE = join(ML, 'src/assembly.fai.js')

/** CQ 参考平移（mini_lathe_poses.json 的 translation，冻结为常量避免读文件时序耦合）。
 *  键 = behavior.memberNames 短名（bp/mb/…，与 children 同序），非 .fai.js 变量名。 */
const REF_Z = { bp: 0, mb: 6.1, mt: 16.1, tp: 19.2 } as const

interface BBox { xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number }

let bboxes: Map<string, BBox>

beforeAll(async () => {
  await registerOcctBrepEngine()
  const ports = {
    ...createNodePorts(),
    projectLoader: createFsProjectLoader(ML),
  }
  const runtime = createRuntime(ports, 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)

  const code = readFileSync(ASM_FILE, 'utf-8')
  const entryKey = projectKeyOf(ML, ASM_FILE)
  const execResult = await runtime.execute(code, { entryKey })
  if (execResult.failedAt) {
    throw new Error(`assembly.fai.js failed: ${execResult.failedAt.message}`)
  }
  const compound = (execResult.outputs.get(asPartName('result')) ??
    execResult.outputs.get(asPartName('asm'))) as CompoundShape | undefined
  expect(compound, 'compound must be produced').toBeDefined()

  const kernel = getBackends().kernel.brep
  expect(kernel, 'BREP kernel must be live').toBeDefined()
  bboxes = new Map()
  const children = ((compound as unknown as { children?: object[] }).children ?? []) as object[]
  expect(children.length, 'compound must have 6 members').toBe(6)
  // memberNames 与 children 同序（探针实证）；nameOf 在模块路径下返回空串，
  // 不能作键——GOTCHA 留档。
  const behavior = getSlot(compound!)?.behavior as { memberNames?: string[] } | undefined
  const memberNames = behavior?.memberNames ?? []
  expect(memberNames.length, 'behavior.memberNames must be present').toBe(6)
  for (let i = 0; i < children.length; i++) {
    const name = memberNames[i]
    const solid = brepOf(children[i]) as number | undefined
    expect(solid, `member ${name} must have a live BREP solid`).toBeDefined()
    bboxes.set(name, kernel!.getBoundingBox(solid))
  }
}, 240000)

describe('GOTCHA: buildAssembly 库侧烘焙（模块路径 pending 无人消费）', () => {
  it('mb/mt/tp 的 solid 世界 zmin = CQ 参考堆叠（烘焙进 slot.solid，非恒等）', () => {
    // 烘焙前的局部 zmin：mb≈0 / mt≈-5 / tp≈0（各 parts 局部几何）。
    // 若烘焙未发生，全部 zmin≈0 → 断言失败。
    expect(bboxes.get('mb')!.zmin).toBeCloseTo(REF_Z.mb, 2)
    expect(bboxes.get('mt')!.zmin).toBeCloseTo(REF_Z.mt + -5, 2) // mt 局部 zmin=-5
    expect(bboxes.get('tp')!.zmin).toBeCloseTo(REF_Z.tp, 2)
  })

  it('bp 锚定恒等：zmin=0（既是锚定成员也是无变换成员）', () => {
    expect(bboxes.get('bp')!.zmin).toBeCloseTo(REF_Z.bp, 2)
  })

  it('GOTCHA 2: 无约束成员 slide_top 保持恒等位姿（不被求解器漂移）', () => {
    const bb = bboxes.get('slide_top')!
    // slide_top 局部 zmin=0、zmax=21.7（探针实测）；漂移解会移动它
    expect(bb.zmin).toBeCloseTo(0, 2)
    expect(bb.zmax).toBeCloseTo(21.7, 2)
  })
})
