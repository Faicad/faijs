/**
 * dbg-probe-export — 诊断探针：装配 CLI 导出位姿排查（保留脚本，勿删）。
 *
 * 用途：复现 mini_lathe 装配执行 → 检查 compound children 的 solid/mesh 位姿、
 * behavior.solveDetailed() 输出、pending transforms 是否被消费。
 *
 * 背景（2026-09-18）：e2e 求解位姿全对但 CLI STEP 导出停在恒等位姿，本探针
 * 定位出两个根因：
 *   1. 模块执行路径（CLI brep）无人消费 pending transforms（只有 direct-executor
 *      有 applyPendingAssemblyTransforms）→ buildAssembly 需库侧直接烘焙；
 *   2. global 求解器给无约束自由成员（slide_top）漂移解，CQ 语义中无约束成员
 *      固定在初始位姿 → 烘焙前按「是否被约束引用」过滤。
 *
 * 运行：node_modules/.bin/tsx packages/mini_lathe/scripts/dbg-probe-export.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRuntime } from '../../core/src/index'
import { createFsProjectLoader } from '../../core/src/node-host/fs-project-loader'
import type { HostPorts } from '../../core/src/cad-runtime/ports'

const ROOT = import.meta.dirname

// CLI 同款白名单装载（cli.ts 的 cliPortsLibLoader 未导出，此处等价复刻）
const ports = {
  events: { emit: () => {} },
  libLoader: {
    loadLib: async (name: string) => {
      if (name !== '@faicad/cq-compat' && name !== 'cq-compat') throw new Error(`not whitelisted: ${name}`)
      return await import('@faicad/cq-compat')
    },
    listLibs: () => ['@faicad/cq-compat', 'cq-compat'],
    options: { autoLift: false },
  },
  projectLoader: createFsProjectLoader(join(ROOT, '..', 'src')),
} as unknown as HostPorts

const rt = createRuntime(ports, 'brep', {})
const src = readFileSync(join(ROOT, '..', 'src', 'assembly.fai.js'), 'utf8')
const res = await rt.execute(src, { mode: 'brep' })
console.log('failedAt:', res.failedAt ? `${res.failedAt.callee}: ${res.failedAt.message}` : 'none')
// 决定性检查：模块路径执行完后 pending transforms 是否残留（残留=未消费）
const { takePendingAssemblyTransforms } = await import('../../core/src/runtime-state')
console.log('pending-left-after-execute:', JSON.stringify(takePendingAssemblyTransforms()).slice(0, 400))
const keys = [...res.outputs.keys()]
console.log('outputs:', keys)
for (const k of keys) {
  const v = res.outputs.get(k)
  const anyV = v as { children?: unknown[] } | undefined
  if (anyV && Array.isArray(anyV.children)) {
    console.log(`compound ${k}: children=${anyV.children.length}`)
    const brepSolids = res.brepSolids
    console.log('brepSolids keys:', brepSolids ? [...brepSolids.keys()] : 'none')
    const { brepOf, getSlot } = await import('../../core/src/shape')
    const { nameOf } = await import('../../core/src/runtime-state')
    const kernel = (await import('../../core/src/runtime-state')).getBackends().kernel.brep
    const anyChildren = anyV.children as object[]
    anyChildren.forEach((ch, i) => {
      const solid = brepOf(ch as never)
      const bb = solid ? kernel.getBoundingBox(solid as never) : null
      // mesh 顶点 z 范围（库侧烘焙会 Object.assign 原地变换 mesh）
      const pos = (ch as { positions?: number[] }).positions
      let mzmin = NaN
      if (pos && pos.length >= 3) {
        mzmin = Infinity
        for (let j = 2; j < pos.length; j += 3) if (pos[j] < mzmin) mzmin = pos[j]
      }
      console.log(
        `  child[${i}] name=${nameOf(ch)} brepOf=${solid ? 'yes' : 'no'} solidZ=[${bb ? bb.zmin.toFixed(3) : '?'},${bb ? bb.zmax.toFixed(3) : '?'}] meshZmin=${Number.isFinite(mzmin) ? mzmin.toFixed(3) : '?'}`,
      )
    })
    const slot = getSlot(anyV)
    const behavior = slot?.behavior as { memberNames?: string[]; solve?: () => unknown } | undefined
    console.log('behavior keys:', behavior ? Object.keys(behavior) : 'none')
    if (typeof behavior?.solve === 'function') {
      const out = behavior.solve() as { transforms?: unknown[]; converged?: boolean } | undefined
      console.log('manual solve():', JSON.stringify(out)?.slice(0, 300))
      const pending2 = takePendingAssemblyTransforms()
      console.log('pending-after-manual-solve:', pending2.length, JSON.stringify(pending2).slice(0, 300))
    }
  }
}
console.log('kinematics:', res.kinematics ? Object.keys(res.kinematics) : 'none')
