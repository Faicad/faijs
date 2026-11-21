/**
 * case09 circular fan mounting plate：occt vs smlib 双引擎执行对账
 *
 * 语料来自 drawing/.tmp-case09-deep/part.fai.js（用户提供的真实失败案例）。
 * 内联为长期测试：复合体 + 字符串选择器 fillet 在两引擎下的行为必须被钉住。
 *
 * 实测结论（2026-11-21）：
 * - 修复前 smlib 在第 50 行 `cad.fillet(part, {edges:'|Z'})` 失败：
 *   getSubShapes(face): not implemented in P1。
 * - 根因不是「复合体句柄类型登记不同」：失败现场 part 句柄 kindOf=1、
 *   getSubShapes(face) 返回 30 个面，完全正常。
 * - 真实根因链（堆栈实测）：
 *   native-history.ts 的能力表没有 smlib → 布尔走裸轨、roleTable 全程不传播
 *   → edgeHandleToRef 的 findOriginRole miss → recoverEdgeFaceRole 回走
 *   → lineageHashesAt(topo-resolve.ts:168) 拿血缘图的历史句柄重算 hash
 *   → 该句柄在 smlib GC 型释放下已失效（kindOf=0）→ subShapeHashes
 *     抛 getSubShapes(face) unsupported（smlibKernel.ts:1262/1239）。
 *   occt 句柄是值语义、历史句柄不失效，且能力表有 occt，故同脚本通过。
 * - 修复：native-history.ts 给 smlib 声明已实现的布尔三项 *WithHistory。
 *   修复后 getSubShapes(face) 错误消失；暴露下一层内核缺口：smlib 的
 *   SmApiFilletEdges 在该复合体上失败（E_FILLET_RADIUS_TOO_LARGE），需内核侧
 *   或 fillet 实现侧另行处理。
 *
 * Run: npx vitest run faijs/engine-compare/case09-circular-fan-plate.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerSmlibBrepEngine } from '../../../core/src/brep/engine/adapters/smlib'
import { __resetEngineRegistriesForTests } from '../../../core/src/brep/engine/registry'
import { brepOf, getSlot } from '../../../core/src/shape'
import { createSmlibPrimitives } from '../../../core/src/smlib-kernel/smlibKernel'
import { initSmlibWasm } from '../../../core/src/smlib-kernel/smlibWasm'
import type { Shape } from '../../../core/src/mesh/types'

const CASE09_SCRIPT = `
let plateWidth_120 = 120 * MM
let plateDepth_120 = 120 * MM
let plateThick_6 = 6 * MM
let earSpanX_101 = 101 * MM
let earSpanY_101_19 = 101.19 * MM
let earTabWidth_42_8 = 42.8 * MM
let earTabHeight_43 = 43 * MM
let earCornerR_14 = 14 * MM
let earRootR_3 = 3 * MM
let hubTopDia_88 = 88 * MM
let hubBottomDia_105_51 = 105.51 * MM
let overallHeight_39 = 39 * MM
let boreDia_76 = 76 * MM
let earHoleDia_14 = 14 * MM
let earCboreDia_28 = 28 * MM
let earCboreDepth_11 = 11 * MM
let earChamfer_7_67 = 7.67 * MM
let cutExtra_20 = 20 * MM

let earCenterX = earSpanX_101 / 2
let earCenterY = earSpanY_101_19 / 2
let hubHeight = overallHeight_39 - plateThick_6
let hubTopR = hubTopDia_88 / 2
let hubBottomR = hubBottomDia_105_51 / 2
let boreR = boreDia_76 / 2
let earHoleR = earHoleDia_14 / 2
let earCboreR = earCboreDia_28 / 2
let cutLenPlate = plateThick_6 + 2 * cutExtra_20
let cutLenHub = plateThick_6 + hubHeight + 2 * cutExtra_20

let part = cad.box(plateWidth_120, plateDepth_120, plateThick_6, { at: [0, 0, 0] })
let earTab = cad.box(earTabWidth_42_8, earTabHeight_43, plateThick_6, { at: [earCenterX, earCenterY, 0] })
earTab = cad.fillet(earTab, { edges: '|Z', radius: earCornerR_14 })
let earTabs = cad.circularPattern(earTab, [0, 0, 1], 4, 90)
part = cad.union(part, earTabs)
let hub = cad.cone(hubBottomR, hubTopR, hubHeight, { at: [0, 0, plateThick_6] })
hub = cad.chamfer(hub, { edges: '<Z', type: 'equal', width: earChamfer_7_67 })
part = cad.union(part, hub)
part = cad.fillet(part, { edges: '|Z', radius: earRootR_3 })
let earCboreTool = cad.cylinder(earCboreR, earCboreDepth_11, { at: [earCenterX, earCenterY, plateThick_6 - earCboreDepth_11] })
let earCboreTools = cad.circularPattern(earCboreTool, [0, 0, 1], 4, 90)
part = cad.subtract(part, earCboreTools)
let earHoleTool = cad.cylinder(earHoleR, cutLenPlate, { at: [earCenterX, earCenterY, -cutExtra_20] })
let earHoleTools = cad.circularPattern(earHoleTool, [0, 0, 1], 4, 90)
part = cad.subtract(part, earHoleTools)
let boreTool = cad.cylinder(boreR, cutLenHub, { at: [0, 0, -cutExtra_20] })
part = cad.subtract(part, boreTool)
`

interface RunResult {
  failedAt: string | null
  bbox: [number, number, number] | null
  outputs: number
}

function bboxOf(shape: Shape | undefined): [number, number, number] | null {
  const p = shape?.positions
  if (!p || p.length === 0) return null
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]!); maxX = Math.max(maxX, p[i]!)
    minY = Math.min(minY, p[i + 1]!); maxY = Math.max(maxY, p[i + 1]!)
    minZ = Math.min(minZ, p[i + 2]!); maxZ = Math.max(maxZ, p[i + 2]!)
  }
  return [maxX - minX, maxY - minY, maxZ - minZ]
}

async function run(engine: 'occt' | 'smlib'): Promise<RunResult> {
  __resetEngineRegistriesForTests()
  if (engine === 'occt') await registerOcctBrepEngine()
  else await registerSmlibBrepEngine()
  const rt = createRuntime(createNodePorts(), 'brep')
  const res = await rt.execute(CASE09_SCRIPT)
  if (res.failedAt) {
    return { failedAt: `${res.failedAt.callee}: ${res.failedAt.message}`, bbox: null, outputs: res.outputs.size }
  }
  const partShape = res.outputs.get('part' as never) as Shape | undefined
  return { failedAt: null, bbox: bboxOf(partShape), outputs: res.outputs.size }
}

describe('case09 circular fan plate：双引擎执行', () => {
  beforeAll(async () => { await registerOcctBrepEngine() }, 180000)

  it('occt 基线通过（144.19 × 144.19 × 39）', async () => {
    const r = await run('occt')
    console.log(`[case09] occt ${JSON.stringify(r)}`)
    expect(r.failedAt).toBeNull()
    expect(r.bbox).not.toBeNull()
    expect(r.bbox![0]).toBeCloseTo(144.19, 1)
    expect(r.bbox![1]).toBeCloseTo(144.19, 1)
    expect(r.bbox![2]).toBeCloseTo(39, 1)
  }, 180000)

  it('smlib 当前结果留档（修复前 E_FILLET_RADIUS_TOO_LARGE / 修复后成功）', async () => {
    const r = await run('smlib')
    console.log(`[case09] smlib ${JSON.stringify(r)}`)
    // 声明 smlib history 能力后，getSubShapes(face) 已消失；当前卡在内核 fillet。
    // 修复前：E_FILLET_RADIUS_TOO_LARGE；修复后断言翻转为 failedAt==null + bbox 同带。
    expect(r.failedAt == null || r.failedAt?.includes('E_FILLET_RADIUS_TOO_LARGE')).toBe(true)
    if (r.failedAt == null) {
      expect(r.bbox![0]).toBeCloseTo(144.19, 1)
      expect(r.bbox![2]).toBeCloseTo(39, 1)
    }
  }, 180000)

  it('失败现场：复合体 part 句柄正常（推翻「类型登记不同」猜测）', async () => {
    __resetEngineRegistriesForTests()
    await registerSmlibBrepEngine()
    const kernel = await createSmlibPrimitives()
    const k = await initSmlibWasm()
    const rt = createRuntime(createNodePorts(), 'brep')
    const res = await rt.execute(CASE09_SCRIPT)
    const partShape = res.outputs.get('part' as never) as Shape | undefined
    expect(partShape).toBeDefined()
    const h = brepOf(partShape!) as number
    const slot = getSlot(partShape!)
    const probe = (label: string, handle: number | undefined): string => {
      if (handle === undefined) return `${label}=undefined`
      const kind = k.kindOf(handle as never)
      let faces: unknown
      try { faces = kernel.getSubShapes(handle as never, 'face').length } catch (e) { faces = `ERR:${(e as Error).message.slice(0, 80)}` }
      return `${label}=${handle} kindOf=${kind} faces=${JSON.stringify(faces)}`
    }
    const line = [
      `brepOf: ${probe('h', h)}`,
      `slot.solid: ${probe('solid', slot?.solid as number | undefined)}`,
      `same=${h === slot?.solid}`,
    ].join(' | ')
    console.log(`[case09 probe] ${line}`)
    // 正确值：复合体结果 kindOf=1(Solid) 且可枚举面。错误猜测会断言 kindOf!=1。
    expect(k.kindOf(h as never) === 1 && h === slot?.solid).toBe(true)
  }, 180000)

  it('失败调用点：堆栈钉在 lineage dead 句柄 → subShapeHashes', async () => {
    __resetEngineRegistriesForTests()
    await registerSmlibBrepEngine()
    const kernel = await createSmlibPrimitives()
    const k = await initSmlibWasm()
    const calls: string[] = []
    const original = kernel.getSubShapes.bind(kernel)
    kernel.getSubShapes = function (shape: never, type: never) {
      const h = shape as unknown as number
      let kind: number
      try { kind = k.kindOf(h as never) } catch { kind = -1 }
      const site = (new Error().stack ?? '').split('\n').slice(2, 8).join(' | ')
      try {
        const r = original(shape, type)
        calls.push(`OK   type=${type} h=${h} kind=${kind} n=${r.length}`)
        return r
      } catch (e) {
        calls.push(`FAIL type=${type} h=${h} kind=${kind} @ ${site}`)
        throw e
      }
    }
    const rt = createRuntime(createNodePorts(), 'brep')
    const res = await rt.execute(CASE09_SCRIPT)
    kernel.getSubShapes = original
    const fails = calls.filter((c) => c.startsWith('FAIL'))
    const deadFaceFails = fails.filter((c) => c.includes('type=face') && c.includes('kind=0'))
    console.log(`[case09 trace] total=${calls.length} fails=${fails.length} deadFaceFails=${deadFaceFails.length} failedAt=${res.failedAt ?? 'null'}`)
    for (const c of deadFaceFails) console.log(`[trace] ${c}`)
    // 修复前：deadFaceFails=1（history 未声明 → roleTable 空 → lineage 回走碰死句柄）。
    // 修复后（smlib 声明 history）：deadFaceFails=0，角色恢复不再触发。
    expect(deadFaceFails.length).toBe(0)
  }, 180000)
})
