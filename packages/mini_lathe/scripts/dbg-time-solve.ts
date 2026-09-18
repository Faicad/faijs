/**
 * dbg-time-solve — 性能探针：计时 global 求解器（保留脚本，勿删）。
 *
 * 用途：mini_lathe 装配（6 成员 / 8 约束）behavior.solveDetailed() 计时。
 * 结论（2026-09-18，Node 22.22.2-3 / Windows）：mean ≈ 5.2ms/次，已写入
 * scripts/assembly-baseline.json 的 global_solver_performance 段。
 *
 * 运行：node_modules/.bin/tsx packages/mini_lathe/scripts/dbg-time-solve.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRuntime } from '../../core/src/index'
import { createFsProjectLoader } from '../../core/src/node-host/fs-project-loader'
import type { HostPorts } from '../../core/src/cad-runtime/ports'

const ROOT = import.meta.dirname

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
if (res.failedAt) throw new Error(`exec failed: ${res.failedAt.message}`)

const { getSlot } = await import('../../core/src/shape')
const compound = res.outputs.get('asm')
if (!compound) throw new Error('asm not found')
const behavior = getSlot(compound)?.behavior as { solveDetailed?: () => unknown } | undefined
if (!behavior?.solveDetailed) throw new Error('no solveDetailed')

// warmup
for (let i = 0; i < 5; i++) behavior.solveDetailed()
const N = 50
const t0 = performance.now()
for (let i = 0; i < N; i++) behavior.solveDetailed()
const t1 = performance.now()
console.log(`solveDetailed x${N}: total=${(t1 - t0).toFixed(1)}ms mean=${((t1 - t0) / N).toFixed(3)}ms`)
