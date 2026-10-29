/**
 * smlib-memory-leak.repro — 「考古 + 复现」探针（非 CI 用例）。
 *
 * 目的：在 node 端装载与 weapp 同一份 smlib_standalone.wasm，执行真实的
 * `3d_editor/docs/examples/pikachu-1.fai.js`，量化回答：
 *   1. 单轮 execute 是否在执行期间就让 wasm 堆单调上涨（单轮加载 OOM 的嫌疑）？
 *   2. 重复 execute（模拟 worker 常驻、AI 迭代 / 重放）后，堆是否跨轮不归零？
 *   3. 进程堆（V8 heapUsed）是否随轮次单调增长（TS 侧对象泄漏）？
 *
 * 注意：`solidHandles` 是 smlibKernel.ts 模块级私有 Set，未导出、也未挂 globalThis，
 * 外部无法直接读取 size。本探针以 **wasm 堆 byteLength（单调高水位，OOM 的直接驱动）**
 * 与 **process.memoryUsage().heapUsed** 作为判决量——这与 2026-10-27 方案 §2 的实测口径
 * 一致（当时就是靠 memory.buffer.byteLength 坐实 GB 级泄漏）。
 *
 * 运行（手动）：
 *   cd C:\my\Faicad\faijs
 *   $env:REPRO_LEAK='1'; npx vitest run test/smlib-kernel/smlib-memory-leak.repro.test.ts
 * 不带 REPRO_LEAK 时整体 skip，不进 CI。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerSmlibBrepEngine } from '../../src/brep/engine/adapters/smlib'
import { initSmlibWasm, type SmlibKernel } from '../../src/smlib-kernel/smlibWasm'
import { createEditorRuntime } from '../support/editor-ops'

const PIKACHU_PATH = 'C:\\my\\Faicad\\3d_editor\\docs\\examples\\pikachu-1.fai.js'

/** REPRO_LEAK=1 才跑重循环；否则 skip。单轮冒烟始终跑（验证脚本能执行）。 */
const RUN_BIG = process.env.REPRO_LEAK === '1'
const ROUNDS = Number(process.env.REPRO_ROUNDS ?? 50)

function readPikachu(): string {
  return readFileSync(PIKACHU_PATH, 'utf8')
}

function createNodePorts(): HostPorts {
  return { events: { emit: () => undefined } }
}

function mb(n: number): string {
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

describe('smlib 内存泄漏考古复现（repro）', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('冒烟：pikachu 脚本单轮可执行', async () => {
    await registerSmlibBrepEngine()
    await initSmlibWasm()
    const runtime = createEditorRuntime(createNodePorts(), 'brep')
    const r = await runtime.execute(readPikachu())
    expect(r.failedAt).toBeUndefined()
  })

  it('重循环：N 轮 pikachu execute 的堆增长曲线', { timeout: 600_000 }, async () => {
    if (!RUN_BIG) {
      // eslint-disable-next-line no-console
      console.log('[repro] REPRO_LEAK!=1，跳过重循环。设置 REPRO_LEAK=1 跑数。')
      return
    }
    await registerSmlibBrepEngine()
    const k: SmlibKernel = await initSmlibWasm()
    const runtime = createEditorRuntime(createNodePorts(), 'brep')

    const wasmMb = (): number => k.memory.buffer.byteLength
    const v8Heap = (): number => process.memoryUsage().heapUsed

    // 预热一轮，抹平 wasm 装载 / JIT 第一次执行的冷启动开销。
    const warm = await runtime.execute(readPikachu())
    expect(warm.failedAt).toBeUndefined()

    const wasmBase = wasmMb()
    const v8Base = v8Heap()
    // eslint-disable-next-line no-console
    console.log(`\n[repro] 预热完成。wasmBase=${mb(wasmBase)}  v8HeapBase=${mb(v8Base)}  rounds=${ROUNDS}`)
    // eslint-disable-next-line no-console
    console.log('[repro] round | wasmHeap(after) | wasmΔ/round | v8Heap(after) | v8Δ/round')

    let prevWasm = wasmBase
    let prevV8 = v8Base
    const deltas: number[] = []
    for (let i = 1; i <= ROUNDS; i++) {
      const beforeWasm = wasmMb()
      let r
      try {
        r = await runtime.execute(readPikachu())
      } catch (e) {
        // eslint-disable-next-line no-console
        console.log(`[repro] round ${i} execute THREW (wasm heap now=${mb(beforeWasm)}): ${(e as Error).message}`)
        throw e
      }
      if (r.failedAt) {
        // eslint-disable-next-line no-console
        console.log(`[repro] round ${i} FAILED at statement (wasm heap before=${mb(beforeWasm)} now=${mb(wasmMb())}): ${JSON.stringify(r.failedAt)}`)
        // 不抛：继续看后续轮次堆趋势
        break
      }
      const w = wasmMb()
      const v = v8Heap()
      const dw = w - prevWasm
      const dv = v - prevV8
      deltas.push(dw)
      if (i <= 10 || i % 10 === 0 || i === ROUNDS) {
        // eslint-disable-next-line no-console
        console.log(`[repro] ${String(i).padStart(5)} | ${mb(w).padStart(11)} | ${mb(dw).padStart(11)} | ${mb(v).padStart(11)} | ${mb(dv).padStart(11)}`)
      }
      prevWasm = w
      prevV8 = v
    }

    const wasmTotal = wasmMb() - wasmBase
    const v8Total = v8Heap() - v8Base
    const last = deltas.slice(-10)
    const avgLast = last.reduce((a, b) => a + b, 0) / last.length
    // eslint-disable-next-line no-console
    console.log(`\n[repro] === 汇总 ===`)
    // eslint-disable-next-line no-console
    console.log(`[repro] wasm 堆总增长 (${ROUNDS} 轮): ${mb(wasmTotal)}   [base ${mb(wasmBase)} → ${mb(wasmMb())}]`)
    // eslint-disable-next-line no-console
    console.log(`[repro] v8 heapUsed 总增长      : ${mb(v8Total)}   [base ${mb(v8Base)} → ${mb(v8Heap())}]`)
    // eslint-disable-next-line no-console
    console.log(`[repro] 末 10 轮单轮 wasm 增量均值: ${mb(avgLast)}  (若不趋近 0 ⇒ 跨轮泄漏未根治)`)

    // 判决：末段单轮增量应收敛到接近 0（malloc 复用已清扫块）。
    // 修复前基线（2026-10-27）：每轮 ≈24MB 线性、30 轮 ≈698MB。
    expect(avgLast, `末 10 轮单轮 wasm 增量均值 ${mb(avgLast)} 应 < 8MB`).toBeLessThan(8 * 1024 * 1024)
  })
})

// 保留 import join 以防 lint 报未用（路径拼接预留）
void join
