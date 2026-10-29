/**
 * 隔离探针：预热 pikachu 一轮（含轮末清扫）后，内核单例是否已被损坏？
 * 运行：$env:REPRO_PROBE='1'; npx vitest run test/smlib-kernel/smlib-leak-isolation.repro.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerSmlibBrepEngine } from '../../src/brep/engine/adapters/smlib'
import { initSmlibWasm } from '../../src/smlib-kernel/smlibWasm'
import { createSmlibPrimitives } from '../../src/smlib-kernel/smlibKernel'
import { createEditorRuntime } from '../support/editor-ops'

const PIKACHU_PATH = 'C:\\my\\Faicad\\3d_editor\\docs\\examples\\pikachu-1.fai.js'
const run = process.env.REPRO_PROBE === '1'

function ports(): HostPorts {
  return { events: { emit: () => undefined } }
}

describe('smlib 轮末清扫后内核损坏隔离探针', () => {
  beforeEach(() => __resetEngineRegistriesForTests())

  it('预热一轮 pikachu 后，裸 makeBox 是否还正常', { timeout: 300_000 }, async () => {
    if (!run) return
    await registerSmlibBrepEngine()
    await initSmlibWasm()
    const prim = await createSmlibPrimitives()

    // 基线：清扫前先裸建一个 box
    const box0 = prim.makeBox(10, 10, 10)
    // eslint-disable-next-line no-console
    console.log('[probe] baseline makeBox handle =', box0)

    const runtime = createEditorRuntime(ports(), 'brep')
    const warm = await runtime.execute(readFileSync(PIKACHU_PATH, 'utf8'))
    expect(warm.failedAt).toBeUndefined()
    // execute 返回后 runtime 已自动 sweepGcLessTransients

    // 探针 1：清扫后立刻裸建 box
    try {
      const box1 = prim.makeBox(10, 10, 10)
      // eslint-disable-next-line no-console
      console.log('[probe] after warmup+sweep, makeBox handle =', box1, 'OK')
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('[probe] after warmup+sweep, makeBox THREW:', (e as Error).message)
      throw e
    }

    // 探针 2：在全新 runtime（同一 wasm 单例）上再跑一次 pikachu
    const runtime2 = createEditorRuntime(ports(), 'brep')
    const second = await runtime2.execute(readFileSync(PIKACHU_PATH, 'utf8'))
    // eslint-disable-next-line no-console
    console.log('[probe] second fresh runtime execute failedAt =', JSON.stringify(second.failedAt))
    expect(second.failedAt).toBeUndefined()
  })
})
