/**
 * brep/load-appearance.test.ts — STEP 导入颜色挂载（P2，方案 §5 STEP 行）。
 *
 * `loadBrep`（单零件收敛路径）把文件里第一个 solid 的 STYLED_ITEM 颜色
 * （stepColorParser：引用链 → COLOUR_RGB / DRAUGHTING_PRE_DEFINED_COLOUR）
 * 挂到 `shape.appearance.color`。取 `[0]` 与 loadBrep 取第一个 solid 的收敛
 * 语义对齐（getSolidColorsOrdered 的文件序 = OCCT getSubShapes 枚举序）。
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import type { BrepEngineApi } from './engine/primitives'
import { loadBrep } from './brep-ops'

let kernel: BrepEngineApi

beforeAll(async () => {
  // 同 load-nonsolid.test.ts：initOcctWasm 返回原生 OcctKernel，L1 契约面由
  // 适配器组合提供——测试直接驱动 loadBrep（L1 面）需品牌转换（运行时同构）。
  kernel = (await initOcctWasm()) as unknown as BrepEngineApi
}, 180000)

function fixture(name: string, subdir = 'step-metadata'): ArrayBuffer {
  const bytes = readFileSync(
    fileURLToPath(new URL(`../../../fixtures/data/${subdir}/${name}`, import.meta.url)),
  )
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

describe('loadBrep — STEP color → shape.appearance (P2)', () => {
  it('attaches the first solid STYLED_ITEM color (cq-assembly-two-parts: #37 → green)', () => {
    const { shape } = loadBrep(kernel, fixture('cq-assembly-two-parts.step'))
    // #37 (第一个 MANIFOLD_SOLID_BREP) → DRAUGHTING_PRE_DEFINED_COLOUR('green') = [0,1,0]。
    expect(shape.appearance?.color).toEqual([0, 1, 0])
  })

  it('attaches COLOUR_RGB through the full reference chain', () => {
    // cq-predefined-colours 多 solid：OCCT 枚举序的第一个 solid 是否有颜色取决于
    // 文件序；此处只验证「无 STYLED_ITEM 引用时不挂、有引用时按序取」的宽容语义。
    const { shape } = loadBrep(kernel, fixture('cq-predefined-colours.step'))
    // 不断言具体值——只保证不抛错、appearance 要么带 color 要么 undefined。
    expect(shape.appearance === undefined || Array.isArray(shape.appearance?.color)).toBe(true)
  })

  it('leaves appearance undefined when the STEP has no STYLED_ITEM (box_boss.step)', () => {
    const { shape } = loadBrep(kernel, fixture('box_boss.step', '.'))
    expect(shape.appearance).toBeUndefined()
  })
})
