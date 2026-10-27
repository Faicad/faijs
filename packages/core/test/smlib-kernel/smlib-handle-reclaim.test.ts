/**
 * smlib-kernel/smlib-handle-reclaim — 重复 execute 不再线性泄漏 wasm 堆。
 *
 * 背景（2026-10-27）：smlib 适配器 `release` 是 no-op（faijs 文档 §388），导致每个
 * op 创建的 SmBrep 只增不减（实测 ~50KB/op，makeBox×2599 撑爆 128MB 初始堆）。
 * 治理（方案 E）：① 新增受控真释放 `disposeHandle`，runtime 在「覆盖旧值 / 缓存
 * 失效 / dispose / 链释放」时调用；② 新增轮末清扫 `releaseAllExcept(keep)`，runtime
 * 在每轮执行（execute/append/update）结果收集完成后调用，keep = solidCache 全部
 * 句柄 + 网格实体句柄，登记表里其余 op 内中间体统一释放。各 op 的 `release`
 * 保持引用语义不变。
 *
 * 判据：同一脚本重复 execute，wasm 堆**逐轮增量收敛**（不随次数线性增长）。
 *
 * Run: npx vitest run test/smlib-kernel/smlib-handle-reclaim.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerSmlibBrepEngine } from '../../src/brep/engine/adapters/smlib'
import { initSmlibWasm, type SmlibKernel } from '../../src/smlib-kernel/smlibWasm'
import { createEditorRuntime } from '../support/editor-ops'

const SCRIPT = `const b = cad.box(10, 10, 10)
const s = cad.sphere({ radius: 5 * MM, segments: 48 })
const u = cad.union(b, s)
const c = cad.cylinder(3, 12)
const w = cad.subtract(u, c)
w.keep()
`

function createNodePorts(): HostPorts {
  return { events: { emit: () => undefined } }
}

describe('smlib 句柄回收：重复 execute 不线性增长', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('30 轮同脚本执行后 wasm 堆增长有界（轮末清扫生效，不随轮次线性增长）', async () => {
    await registerSmlibBrepEngine()
    const k: SmlibKernel = await initSmlibWasm()
    const mb = (): number => k.memory.buffer.byteLength

    const runtime = createEditorRuntime(createNodePorts(), 'brep')
    const warm = await runtime.execute(SCRIPT)
    expect(warm.failedAt).toBeUndefined()

    // wasm 线性内存只增不减（memory.grow 不可缩），byteLength 是单调高水位线——
    // 不能用「30 轮后仍 < 初始堆」判据。判据改为**逐轮增量收敛**：轮末清扫
    // releaseAllExcept 生效后，后段每轮新增应趋近于 0（malloc 复用已释放块），
    // 而不是修复前那样每轮 ≈24MB 线性上涨（30 轮 ≈698MB，见 2026-10-27 方案 §2）。
    const base = mb()
    const perRound: number[] = []
    for (let i = 0; i < 30; i++) {
      const before = mb()
      const r = await runtime.execute(SCRIPT)
      expect(r.failedAt).toBeUndefined()
      perRound.push(mb() - before)
    }
    const last5 = perRound.slice(-5)
    const maxLast5 = Math.max(...last5)
    expect(
      maxLast5,
      `最后 5 轮单轮增量 ${maxLast5} B 应 < 4MB（修复前每轮 ≈24MB 线性增长）`,
    ).toBeLessThan(4 * 1024 * 1024)
    const total = mb() - base
    expect(total, `30 轮总增量 ${total} B 应 < 16MB（修复前 ≈698MB）`).toBeLessThan(16 * 1024 * 1024)
  }, 300_000)
})