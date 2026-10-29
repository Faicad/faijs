/**
 * smlib-128mb-cap.repro — 真机 128MB wasm 堆预算模拟（非 CI 用例）。
 *
 * 背景（2026-10-29）：模拟器 14 轮 + node 5 轮复现均绿，但真机 wasm 预算 ~128MB；
 * vendored wasm 声明 memory min=2048 页（128MB，初始化即全额提交）、max=65536 页
 * （4GB）——桌面端超预算 growth 静默成功，掩盖真机必失败的路径。
 *
 * 机制：内存中二进制补丁（不重编译 usd-brep）：memory 段（id=5）max 65536 → 2048 页，
 * 经 setSmlibWasmInitFn 注入封顶装载器 → 128MB 硬顶。超顶 growth 恒失败 →
 * emscripten malloc 返回 0 → smlib 走 SM 错误路径（真机 SM 1007 同机制）/未检查处
 * trap——真机的预算外失败在 node 变得可观测。
 *
 * byteLength 看不到的量：wasm 堆初始化即 128MB、皮卡丘负载下不触发 growth，
 * `buffer.byteLength` 恒平——**检不出 128MB 内部的累积/碎片**。本探针用 malloc
 * 金丝雀（64MB → 128KB 对半递减，取最大可分配块）给出「预算内剩余自由堆」曲线，
 * 这才是真机死亡点的预测量。
 *
 * 口径注意：runtime.execute 缺省 eager 三角化（真机 weapp defer + 仅终端物化），
 * 本探针对瞬态三角化峰值**更苛刻**；此处绿 ⇏ 真机绿，此处红 ⇒ 真机必红（机制复现）。
 * 进程级预算（v8 heap + 微信运行时开销）不在本探针模拟范围。
 *
 * 运行（手动）：
 *   cd C:\my\Faicad\faijs
 *   $env:REPRO_CAP='1'; npx vitest run test/smlib-kernel/smlib-128mb-cap.repro.test.ts
 *   轮数：$env:REPRO_CAP_ROUNDS='6'（pikachu-1）、$env:REPRO_CAP_ROUNDS2='3'（pikachu-2）
 * 不带 REPRO_CAP 时重循环整体 skip（封顶内核冒烟始终跑，验证补丁器与探针，~5s）。
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { HostPorts } from '../../src/cad-runtime/ports'
import type { TessellationDensity } from '../../src/runtime-state'
import type { ExecutionResult, RetessellatePartResult } from '../../src/cad-runtime/runtime'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerSmlibBrepEngine } from '../../src/brep/engine/adapters/smlib'
import {
  initSmlibWasm,
  resetSmlibWasm,
  setSmlibWasmInitFn,
  createSmlibImportsByName,
  buildSmlibKernel,
  type SmlibKernel,
} from '../../src/smlib-kernel/smlibWasm'
import { createEditorRuntime } from '../support/editor-ops'

const PIKACHU1_PATH = 'C:\\my\\Faicad\\3d_editor\\docs\\examples\\pikachu-1.fai.js'
const PIKACHU2_PATH = 'C:\\my\\Faicad\\3d_editor\\docs\\examples\\pikachu-2.fai.js'

/** REPRO_CAP=1 才跑重循环；否则 skip。封顶内核冒烟始终跑。 */
const RUN_BIG = process.env.REPRO_CAP === '1'
const ROUNDS = Math.max(1, Number(process.env.REPRO_CAP_ROUNDS ?? 6))
const ROUNDS2 = Math.max(1, Number(process.env.REPRO_CAP_ROUNDS2 ?? 3))

/** 真机预算档：128MB（2048 页 × 64KB）。初始即顶格（vendored min=2048），growth 恒失败。 */
const CAP_PAGES = 2048

/** L1 精化目标（= weapp 现状档）：2π/32 + 0.1mm。 */
const L1: TessellationDensity = { angularDeflection: (2 * Math.PI) / 32, linearDeflection: 0.1 }

/* eslint-disable no-console */
const log = (msg: string): void => {
  console.log(msg)
}
/* eslint-enable no-console */

function readScript(path: string): string {
  return readFileSync(path, 'utf8')
}

function createNodePorts(): HostPorts {
  return { events: { emit: () => undefined } }
}

function mb(n: number): string {
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

/** 读 vendored wasm 为独立 Uint8Array<ArrayBuffer>（Buffer 直转是 ArrayBufferLike，过不了 BufferSource）。 */
function readWasmBytes(): Uint8Array<ArrayBuffer> {
  const wasmUrl = new URL('../../vendor/smlib-wasm/smlib_standalone.wasm', import.meta.url)
  const raw = readFileSync(fileURLToPath(wasmUrl))
  const bytes = new Uint8Array(raw.length)
  bytes.set(raw)
  return bytes
}

// ── wasm 二进制补丁：memory 段（id=5）max → capPages ─────────────────────────

/** 读 u32 LEB128，返回 [值, 字节数]。 */
function readU32Leb(bytes: Uint8Array, at: number): [number, number] {
  let value = 0
  let shift = 0
  let len = 0
  for (;;) {
    const b = bytes[at + len]
    value += (b & 0x7f) * Math.pow(2, shift)
    len++
    if ((b & 0x80) === 0) return [value, len]
    shift += 7
  }
}

/** 编码 u32 LEB128。 */
function encodeU32Leb(value: number): number[] {
  const out: number[] = []
  let v = value
  do {
    let b = v & 0x7f
    v = Math.floor(v / 128)
    if (v > 0) b |= 0x80
    out.push(b)
  } while (v > 0)
  return out
}

/**
 * 将 wasm 二进制 memory 段（id=5）所有 memtype 的 max 页数改写为 capPages
 * （内存中打补丁，不重编译）。段结构：[count:u32-leb] + count ×
 * [flags:u8][min:u32-leb][max:u32-leb (flags&1)]。
 * 全部 max 已 ≤ capPages 时原样返回同一引用（幂等）。
 */
function capWasmMemoryMax(orig: Uint8Array<ArrayBuffer>, capPages: number): Uint8Array<ArrayBuffer> {
  let o = 8 // 跳过 [magic 4][version 4]
  while (o < orig.length) {
    const id = orig[o]
    const [size, sizeLen] = readU32Leb(orig, o + 1)
    const payloadAt = o + 1 + sizeLen
    const payloadEnd = payloadAt + size
    if (id === 5) {
      const payload: number[] = []
      const [count, countLen] = readU32Leb(orig, payloadAt)
      payload.push(...encodeU32Leb(count))
      let p = payloadAt + countLen
      let needsPatch = false
      for (let i = 0; i < count; i++) {
        const flags = orig[p]
        p += 1
        if ((flags & ~0x01) !== 0) {
          throw new Error(`capWasmMemoryMax: unsupported memory flags 0x${flags.toString(16)} (memtype #${i})`)
        }
        const [minV, minLen] = readU32Leb(orig, p)
        p += minLen
        payload.push(flags, ...encodeU32Leb(minV))
        if ((flags & 0x01) !== 0) {
          const [maxV, maxLen] = readU32Leb(orig, p)
          p += maxLen
          if (maxV <= capPages) {
            // 已比目标更紧，保持原值
            payload.push(...encodeU32Leb(maxV))
          } else {
            if (minV > capPages) {
              throw new Error(`capWasmMemoryMax: cap ${capPages} pages below initial ${minV} pages (invalid module)`)
            }
            payload.push(...encodeU32Leb(capPages))
            needsPatch = true
          }
        }
      }
      if (!needsPatch) return orig
      const head = orig.subarray(0, o) // 本段之前的全部字节
      const section = [orig[o], ...encodeU32Leb(payload.length), ...payload]
      const tail = orig.subarray(payloadEnd)
      const out = new Uint8Array(head.length + section.length + tail.length)
      out.set(head, 0)
      out.set(section, head.length)
      out.set(tail, head.length + section.length)
      return out
    }
    o = payloadEnd
  }
  throw new Error('capWasmMemoryMax: no memory section (id=5) found')
}

/** 构造封顶装载器（复刻 smlibWasm.loadNodeDefault 路径，仅 wasm 字节先打补丁）。 */
function makeCappedSmlibLoader(capPages: number): () => Promise<SmlibKernel> {
  return async (): Promise<SmlibKernel> => {
    const patched = capWasmMemoryMax(readWasmBytes(), capPages)
    const module = new WebAssembly.Module(patched)
    let instanceRef: WebAssembly.Instance | null = null
    const importNames = WebAssembly.Module.imports(module).map(({ module: m, name }) => ({ module: m, name }))
    // GOTCHA（同 smlibWasm.loadNodeDefault）：Node ≥22 对已编译 Module 的 instantiate
    // 直接返回 Instance；旧行为返回 { module, instance }。两种形态都要接。
    const r = (await WebAssembly.instantiate(module, createSmlibImportsByName(importNames, () => instanceRef))) as
      | WebAssembly.Instance
      | { module: WebAssembly.Module; instance: WebAssembly.Instance }
    const instance = 'instance' in r ? r.instance : r
    instanceRef = instance
    return buildSmlibKernel(instance)
  }
}

/**
 * malloc 金丝雀：对半递减探测当前最大可分配块（64MB → 128KB）。
 * byteLength 观测看不到 128MB 内部的碎片/累积——这是「真机预算内还剩多少」的直接量。
 * 返回 0 = 连 128KB 都分配不出（预算内死亡点）。
 */
function probeLargestMalloc(k: SmlibKernel): number {
  for (let size = 64 * 1024 * 1024; size >= 128 * 1024; size = Math.floor(size / 2)) {
    const ptr = k.malloc(size)
    if (ptr !== 0) {
      k.free(ptr)
      return size
    }
  }
  return 0
}

/** 精化结果分类（判别联合三分支）。 */
function classifyRefine(refined: Record<string, RetessellatePartResult>): {
  geometry: number
  skipped: number
  notApplicable: number
  tris: number
} {
  let geometry = 0
  let skipped = 0
  let notApplicable = 0
  let tris = 0
  for (const res of Object.values(refined)) {
    if ('positions' in res) {
      geometry++
      tris += res.triangleCount
    } else if ('skipped' in res) {
      skipped++
    } else if ('notApplicable' in res) {
      notApplicable++
    }
  }
  return { geometry, skipped, notApplicable, tris }
}

/**
 * 封顶内核上的设备流轮次：execute → 全 outputs L1 精化 → 自由堆探针。
 * 真机 refine 目标是可见终端；这里取 outputs 超集（压力更苛刻）。
 * 任一轮 failedAt / 抛错 = 预算外失败证据，记录后停止并断言失败。
 */
async function runCappedRounds(label: string, path: string, rounds: number): Promise<void> {
  const k = await initSmlibWasm()
  await registerSmlibBrepEngine()
  const runtime = createEditorRuntime(createNodePorts(), 'brep')

  const startFree = probeLargestMalloc(k)
  const t0 = Date.now()
  const warm = await runtime.execute(readScript(path))
  const warmMs = Date.now() - t0
  expect(warm.failedAt).toBeUndefined()
  log(`[repro] ${label} 起始自由堆=${mb(startFree)}  预热 execute wall=${warmMs}ms  freeHeap=${mb(probeLargestMalloc(k))}`)

  log(`[repro] ${label} round |   execMs |  refineMs | freeHeap(after) | 精化结果`)
  let lastFree = 0
  let failed: string | null = null
  for (let i = 1; i <= rounds; i++) {
    let r: ExecutionResult
    const tExec = Date.now()
    try {
      r = await runtime.execute(readScript(path))
    } catch (e) {
      failed = `round ${i} execute THREW: ${(e as Error).message}`
      log(`[repro] ${failed}  freeHeap=${mb(probeLargestMalloc(k))}`)
      break
    }
    const execMs = Date.now() - tExec
    if (r.failedAt) {
      failed = `round ${i} FAILED at statement: ${JSON.stringify(r.failedAt)}`
      log(`[repro] ${failed}  freeHeap=${mb(probeLargestMalloc(k))}`)
      break
    }
    const tRef = Date.now()
    const refined = await runtime.retessellate(Array.from(r.outputs.keys(), (n) => ({ partName: n, density: L1 })))
    const refineMs = Date.now() - tRef
    const free = probeLargestMalloc(k)
    lastFree = free
    const c = classifyRefine(refined)
    log(
      `[repro] ${label} ${String(i).padStart(5)} | ${String(execMs).padStart(7)} | ${String(refineMs).padStart(8)} | ${mb(free).padStart(15)} | geo=${c.geometry} tris=${c.tris} skip=${c.skipped} na=${c.notApplicable}`,
    )
  }

  log(`[repro] === ${label} 汇总（${rounds} 轮 @128MB 硬顶）===`)
  log(`[repro] 末轮自由堆: ${mb(lastFree)}（预算内余量；逼近 0 = 真机死亡点）`)
  expect(failed, `128MB 硬顶下出现预算外执行失败：${failed ?? ''}`).toBeNull()
  expect(lastFree, `${label} 末轮自由堆 ${mb(lastFree)} 应 ≥ 4MB`).toBeGreaterThanOrEqual(4 * 1024 * 1024)
}

describe('smlib 真机 128MB 堆预算模拟（repro）', () => {
  beforeAll(async () => {
    setSmlibWasmInitFn(makeCappedSmlibLoader(CAP_PAGES))
    await initSmlibWasm()
  }, 120_000)

  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  afterAll(() => {
    // 还原默认装载路径，防止封顶内核泄漏给同进程后续消费者
    setSmlibWasmInitFn(null)
    resetSmlibWasm()
  })

  it('封顶内核：补丁器幂等/防呆 + 128MB 硬顶生效 + malloc 探针可用', { timeout: 60_000 }, async () => {
    const bytes = readWasmBytes()

    // 补丁器防呆：cap 低于 min（2048 页）必须拒绝
    expect(() => capWasmMemoryMax(bytes, 1024)).toThrow(/below initial/)

    // 幂等：二次封顶返回同一引用（max 已 ≤ cap）
    const patched = capWasmMemoryMax(bytes, CAP_PAGES)
    expect(capWasmMemoryMax(patched, CAP_PAGES)).toBe(patched)
    expect(capWasmMemoryMax(patched, 65536)).toBe(patched)

    // 行为验证：封顶内核装载成功，128MB 顶格，再 grow 必失败（= 真机预算外 growth）
    const k = await initSmlibWasm()
    expect(k.memory.buffer.byteLength).toBe(CAP_PAGES * 65536)
    expect(() => k.memory.grow(1)).toThrow()

    // malloc 金丝雀探针在新鲜堆上健康
    const probe = probeLargestMalloc(k)
    expect(probe, `新鲜堆探针 ${mb(probe)} 应 ≥ 32MB`).toBeGreaterThanOrEqual(32 * 1024 * 1024)
    log(`[repro] 封顶内核 OK：memory=${mb(k.memory.buffer.byteLength)} 硬顶不可 growth；新鲜堆探针=${mb(probe)}`)
  })

  it('pikachu-1：128MB 硬顶下的执行/精化轮次（自由堆曲线）', { timeout: 900_000 }, async () => {
    if (!RUN_BIG) {
      log('[repro] REPRO_CAP!=1，跳过重循环。设置 REPRO_CAP=1 跑数。')
      return
    }
    await runCappedRounds('pikachu-1', PIKACHU1_PATH, ROUNDS)
  })

  it('pikachu-2：128MB 硬顶下的执行/精化轮次（跨场景累积观测）', { timeout: 900_000 }, async () => {
    if (!RUN_BIG) {
      log('[repro] REPRO_CAP!=1，跳过重循环。')
      return
    }
    // 与 pikachu-1 共用同一封顶内核（worker 常驻模型）：起始自由堆即 p1 轮次后的残余
    await runCappedRounds('pikachu-2', PIKACHU2_PATH, ROUNDS2)
  })
})
