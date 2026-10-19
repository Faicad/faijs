/**
 * 多实体 STEP compound 上 chamfer/fillet —— **brepkit 内核**验收（小程序端）。
 *
 * 背景：weapp 端只装 brepkit（occt-wasm 在构建里 alias 成空 stub）。occt 侧的 P5
 * 复现测试（load-step-parametric-edit.test.ts）证明了「多实体 load → compound 上
 * chamfer(partIndex) 不再 E_CHAMFER_NO_BREP」，但那跑在 occt 上。本文件把同一场景
 * 钉在 brepkit 上——这才是小程序端用户真正会跑到的内核。
 *
 * brepkit importStep 多实体同样返回 compound（brepkitKernel.ts:1757），chamfer/fillet
 * 经 0.35.1 的 resolveCompoundMember 解包成员，两内核几何路径同形。
 *
 * ⚠️ 装配纪律（同 selectors-brepkit.test.ts）：本文件只装配 brepkit，beforeEach 里
 * disposeBrepkit + resetBrepkitWasm，绝不在同一进程混用 occt 句柄。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { createEditorRuntime } from '../support/editor-ops'
import { asPartName } from '../../src/identity'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../../src/brepkit-kernel/brepkitKernel'
import { resetBrepkitWasm } from '../../src/brepkit-kernel/brepkitWasm'
import type { PartNaming } from '../../src/topology/naming'

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

function stepPorts(file: 'test-model.step'): HostPorts {
  const bytes = toArrayBuffer(readFileSync(new URL(`../../../fixtures/data/${file}`, import.meta.url)))
  return {
    events: { emit: () => undefined },
    assets: {
      resolveByKey: async () => ({ bytes }),
      resolveFile: async () => bytes,
      resolveUrl: async () => bytes,
    },
  } as unknown as HostPorts
}

function assertUsableEdgeNaming(r: { failedAt?: unknown; naming?: Map<ReturnType<typeof asPartName>, PartNaming> }, partName: string): PartNaming {
  expect(r.failedAt).toBeUndefined()
  const naming = r.naming?.get(asPartName(partName))
  expect(naming).toBeDefined()
  expect(naming!.source).toBe('brep')
  const edges = naming!.edgeNaming
  expect(edges.length).toBeGreaterThan(0)
  const usable = edges.findIndex((e) => e.faces !== null)
  expect(usable).toBeGreaterThanOrEqual(0)
  return naming!
}

describe('brepkit: 多实体 STEP compound 成员上 chamfer（小程序端内核验收）', () => {
  // 内核只装一次：beforeEach dispose 会让模块级 loadCache 里上一次 load 的句柄变成
  // 悬空（新 wasm 句柄空间从 0 重开），下一条 cad.load 命中缓存即报 "invalid solid handle"。
  // 两测试共用同一内核实例，loadCache 句柄全程有效。
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    disposeBrepkit()
    resetBrepkitWasm()
    await registerBrepkitBrepEngine()
  })
  afterAll(() => {
    disposeBrepkit()
  })

  it('brepkit: load(test-model.step) compound → chamfer(part0,{partIndex:0}) 成功', async () => {
    const runtime = createEditorRuntime(stepPorts('test-model.step'), 'brep')
    // 先 load：从合并命名里找一条两邻面都属 member0 的边行。
    const base = await runtime.execute(`let part0 = cad.load({ file: 'test-model.step' })`)
    expect(base.failedAt).toBeUndefined()
    const naming = assertUsableEdgeNaming(base, 'part0')
    const row = naming.edgeNaming.find(
      (e) =>
        e.faces &&
        e.faces[0].role.startsWith('imported:0:') &&
        e.faces[1].role.startsWith('imported:0:'),
    )
    expect(row).toBeDefined()
    expect(row!.faces).not.toBeNull()
    const edgeRef = { kind: 'edge', faces: row!.faces, hint: row!.hint }

    // 复现用户脚本：多零件 load 产物是 compound，按 partIndex 选 member0 倒角。
    const c1 = await runtime.execute(
      `let part0 = cad.load({ file: 'test-model.step' })\n` +
        `let part1 = cad.chamfer(part0, { edges: [${JSON.stringify(edgeRef)}], partIndex: 0, type: 'equal', width: 1 })\n`,
    )
    expect(c1.failedAt).toBeUndefined()
    expect(c1.outputs.get(asPartName('part1'))).toBeDefined()
    // 产物仍是 compound（其余成员原样保留）。
    const out = c1.outputs.get(asPartName('part1')) as { kind?: string; children?: unknown[] }
    expect(out.kind).toBe('compound')
    expect(out.children?.length).toBeGreaterThanOrEqual(2)
  })

  it('brepkit: 多实体 compound 成员上 fillet 同样按 partIndex 解包成功', async () => {
    const runtime = createEditorRuntime(stepPorts('test-model.step'), 'brep')
    const base = await runtime.execute(`let part0 = cad.load({ file: 'test-model.step' })`)
    expect(base.failedAt).toBeUndefined()
    const naming = assertUsableEdgeNaming(base, 'part0')
    const row = naming.edgeNaming.find(
      (e) =>
        e.faces &&
        e.faces[0].role.startsWith('imported:0:') &&
        e.faces[1].role.startsWith('imported:0:'),
    )
    expect(row).toBeDefined()
    const edgeRef = { kind: 'edge', faces: row!.faces, hint: row!.hint }

    const c1 = await runtime.execute(
      `let part0 = cad.load({ file: 'test-model.step' })\n` +
        `let part1 = cad.fillet(part0, { edges: [${JSON.stringify(edgeRef)}], partIndex: 0, radius: 1 })\n`,
    )
    expect(c1.failedAt).toBeUndefined()
    expect(c1.outputs.get(asPartName('part1'))).toBeDefined()
  })
})
