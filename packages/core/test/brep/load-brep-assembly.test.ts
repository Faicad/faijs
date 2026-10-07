/**
 * brep/load-brep-assembly.test.ts — P0：STEP 多零件装配导入契约。
 *
 * 方案 2026-10-06-step-3mf-multipart-import-plan.md §5.3 / §11 T0：
 * - T0 探针：`importAssemblyFromStep`（initOcctWasm 原生面）产出的 ShapeHandle
 *   与注入 `BrepEngineApi`（createOcctPrimitives 包装同一全局单例内核）互通——
 *   原生句柄可被 BrepEngineApi.meshShape / release 消费；
 * - 多零件 STEP：`loadBrepAssembly` 返回全部零件（DFS 声明序）+ 装配层级；
 * - 单零件 STEP：退回单零件路径（1 part，行为与现状一致）。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { __resetEngineRegistriesForTests, getBrepEngine } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import {
  importAssemblyFromStep, collectLeafParts, releaseAssemblyTree,
  type ShapeHandle,
} from '../../src/occt-kernel/occtKernel'
import { loadBrepAssembly } from '../../src/brep/brep-ops'

/** Node Buffer → 正确切片的 ArrayBuffer（小文件 <8KB 时 .buffer 含整池偏移）。 */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

const twoPartStep = toArrayBuffer(
  readFileSync(new URL('../../../fixtures/data/step-metadata/cq-assembly-two-parts.step', import.meta.url)),
)
const singleStep = toArrayBuffer(
  readFileSync(new URL('../../../fixtures/data/box_boss.step', import.meta.url)),
)

let kernel: BrepEngineApi

beforeEach(() => {
  __resetEngineRegistriesForTests()
})

describe('T0 探针：XCAF 原生句柄与注入 BrepEngineApi 互通', () => {
  it('importAssemblyFromStep 的 leaf shapeHandle 可被 BrepEngineApi.meshShape/release 消费', async () => {
    await registerOcctBrepEngine()
    const engine = await getBrepEngine()
    kernel = engine.primitives as BrepEngineApi

    // 原生面（initOcctWasm 单例）解析 XCAF 装配树
    const nodes = await importAssemblyFromStep(twoPartStep)
    const leaves = collectLeafParts(nodes)
    expect(leaves.length).toBeGreaterThanOrEqual(2)

    // 注入面（BrepEngineApi）消费原生句柄：三角化 + 释放均不抛错
    for (const leaf of leaves) {
      expect(leaf.shapeHandle, 'leaf 必须持有 shapeHandle').not.toBeNull()
      // ShapeHandle 与 BrepHandle 同构（number & brand），跨适配器边界按惯例双转
      const handle = leaf.shapeHandle as unknown as Parameters<BrepEngineApi['meshShape']>[0]
      const mesh = kernel.meshShape(handle, {
        linearDeflection: 0.1,
        angularDeflection: (2 * Math.PI) / 64,
      })
      expect(mesh.positions.length).toBeGreaterThan(0)
      kernel.release(handle)
    }
    // 树的其余句柄释放（装配节点 shapeHandle 为 null，本调用应为 no-op 保险）
    releaseAssemblyTree(kernel as never, nodes.filter((n) => n.isAssembly))
  })
})

describe('loadBrepAssembly — 多零件 STEP（P0 §5.3）', () => {
  beforeEach(async () => {
    await registerOcctBrepEngine()
    const engine = await getBrepEngine()
    kernel = engine.primitives as BrepEngineApi
  })

  it('cq-assembly-two-parts.step → 2 个零件 + 装配树非空（DFS 序）', async () => {
    const { parts, assembly, multiSolidCount } = await loadBrepAssembly(kernel, twoPartStep)
    expect(parts).toHaveLength(2)
    expect(multiSolidCount).toBe(2)
    // 每个 part：几何 + solid 句柄 + 名字 + 颜色
    for (const p of parts) {
      expect(p.shape.positions.length).toBeGreaterThan(0)
      expect(p.shape.indices.length).toBeGreaterThan(0)
      expect(p.name.length).toBeGreaterThan(0)
    }
    // 装配层级：根（装配或合成节点）携带子节点
    expect(assembly).toBeDefined()
    expect(assembly!.name.length).toBeGreaterThan(0)
    const partIndices: number[] = []
    const walk = (n: NonNullable<typeof assembly>) => {
      if (n.partIndex !== undefined) partIndices.push(n.partIndex)
      for (const c of n.children ?? []) walk(c)
    }
    walk(assembly!)
    expect(partIndices).toEqual([0, 1])
    // index 与 parts 一一对应
    expect(parts.map((p) => p.index)).toEqual([0, 1])
  })

  it('test-model.step（6 products 多根）→ 全部零件', async () => {
    const buf = toArrayBuffer(
      readFileSync(new URL('../../../fixtures/data/test-model.step', import.meta.url)),
    )
    const { parts, assembly } = await loadBrepAssembly(kernel, buf)
    expect(parts.length).toBe(2)
    expect(assembly).toBeDefined()
  })

  it('box_boss.step（单零件）→ 1 个零件，无装配层级', async () => {
    const { parts, assembly, multiSolidCount } = await loadBrepAssembly(kernel, singleStep)
    expect(parts).toHaveLength(1)
    expect(multiSolidCount).toBeUndefined()
    expect(assembly).toBeUndefined()
    expect(parts[0].index).toBe(0)
  })
})
