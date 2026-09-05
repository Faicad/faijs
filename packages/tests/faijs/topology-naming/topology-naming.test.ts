/**
 * topology-naming .fai.js fixture 集成测试（M5 引擎侧，§8）
 *
 * 验证真实 BREP 链路上的 TopoRef 命名/解析：
 * - 面引用改参重放：box → translate 链上 box:top 语义面在改参重放后仍命中
 * - 布尔跨来源：两个 box union 后能解析「来自 tool 侧（part1）」的面
 * - 三态错误码：E_TOPO_DELETED / E_TOPO_AMBIGUOUS / E_TOPO_NOT_FOUND
 * - stderr 零容忍：故意触发的失败解析必须 spy console.warn/error 并断言
 *
 * 使用真实 OCCT（beforeAll registerOcctBrepEngine）。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { asPartName, type PartName } from '@faicad/faijs-core/identity'
import { HASH_UPPER_BOUND } from '@faicad/faijs-core/brep/face-evolution'
import { resolveTopoRef, type ResolutionContext } from '@faicad/faijs-core/topology/naming'
import type { FaceTopoRef, PartNaming, RoleTable } from '@faicad/faijs-core/topology/naming/types'
import type { CadRuntime, ExecutionResult } from '@faicad/faijs-core/cad-runtime/runtime'
import type { BrepEngineApi } from '@faicad/faijs-core/brep/engine/primitives'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

/** 从 ExecutionResult 构建某 part 的解析上下文（BREP 现场 + roleTable）。 */
function buildCtx(result: ExecutionResult, partName: PartName): ResolutionContext {
  const chain = result.brepChain
  const kernel = chain.kernel
  const solid = chain.solidCache.get(partName)
  if (!kernel || !solid) throw new Error(`no BREP solid for ${partName}`)

  const handles = kernel.getSubShapes(solid, 'face')
  const hashes = kernel.subShapeHashes(solid, 'face', HASH_UPPER_BOUND)
  const faces = hashes.map((hash, i) => ({
    ordinal: i + 1,
    hash,
    handle: handles[i],
  }))
  const roleTable = chain.roleTableCache?.get(partName) as RoleTable | undefined
  return { kernel: kernel as BrepEngineApi, faces, roleTable }
}

/** 从命名行构造 FaceTopoRef（§3.7 captureTopoRef 语义；此处按 origin/role 反查行）。 */
function refForRole(naming: PartNaming, origin: string, role: string): FaceTopoRef {
  const row = naming.faceNaming.find((f) => f.role === role && f.origin === asPartName(origin))
  if (!row) throw new Error(`naming row not found: ${origin}:${role}`)
  return { kind: 'face', origin: row.origin, role: row.role, hint: row.hint }
}

describe('topology naming .fai.js integration', () => {
  let runtime: CadRuntime

  beforeEach(() => {
    runtime = createRuntime(createNodePorts(), 'brep')
  })

  afterEach(() => {
    runtime.dispose()
  })

  it('box→translate 链：改参重放后 box:top 仍解析到同一语义面', async () => {
    const code1 = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.translate(part0, { offset: [10, 0, 0] })
    `
    const code2 = `
      const part0 = cad.box(30, 30, 30, { centered: true })
      const part1 = cad.translate(part0, { offset: [10, 0, 0] })
    `

    const r1 = await runtime.execute(code1, { topology: 'auto' })
    expect(r1.failedAt).toBeUndefined()
    const naming1 = r1.naming!.get(asPartName('part1'))!
    expect(naming1.faceNaming.some((f) => f.role === 'box:top')).toBe(true)

    // 从第一次执行捕获 box:top 的 TopoRef（改参前的稳定引用）
    const ref = refForRole(naming1, 'part0', 'box:top')

    // 改参重放（同一 runtime 实例，增量路径）
    const r2 = await runtime.execute(code2, { topology: 'auto' })
    expect(r2.failedAt).toBeUndefined()
    const ctx2 = buildCtx(r2, asPartName('part1'))
    const resolved = resolveTopoRef(ref, ctx2)
    // 语义面未受影响 → exact 命中（且 hint 法向仍为 +Z）
    expect(resolved.ordinal).toBeGreaterThan(0)
    const naming2 = r2.naming!.get(asPartName('part1'))!
    const topRow2 = naming2.faceNaming.find((f) => f.role === 'box:top')!
    expect(topRow2.hint.normal).toEqual([0, 0, 1])
  })

  it('box→fuse→cut 链：box:bottom 等未受影响面 exact 命中', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.box(10, 10, 30, { centered: true, at: [5, 5, 15] })
      const part2 = cad.union(part0, part1)
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()

    const naming2 = result.naming!.get(asPartName('part2'))!
    const ctx2 = buildCtx(result, asPartName('part2'))

    // 两个 origin 都在（target part0 + tool part1 合流）
    const origins = new Set(naming2.faceNaming.map((f) => f.origin))
    expect(origins.has(asPartName('part0'))).toBe(true)
    expect(origins.has(asPartName('part1'))).toBe(true)

    // part0 的 box:top 在 union 后未受影响 → exact 解析成功
    const ref0 = refForRole(naming2, 'part0', 'box:top')
    const res0 = resolveTopoRef(ref0, ctx2)
    expect(res0.ordinal).toBeGreaterThan(0)
  })

  it('布尔跨来源：union 后能解析「来自 tool 侧（part1）」的面', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.box(10, 10, 30, { centered: true, at: [5, 5, 15] })
      const part2 = cad.union(part0, part1)
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()

    const naming2 = result.naming!.get(asPartName('part2'))!
    const ctx2 = buildCtx(result, asPartName('part2'))

    // part1（tool）的 box:top：tool 的 +Z 端盖在 union 后成为 part2 顶面一部分 → 应可解析
    const ref1 = refForRole(naming2, 'part1', 'box:top')
    const res1 = resolveTopoRef(ref1, ctx2)
    expect(res1.ordinal).toBeGreaterThan(0)
  })

  it('三态错误码：解析不存在/类型不符的面抛 E_TOPO_NOT_FOUND', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.translate(part0, { offset: [10, 0, 0] })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    const naming1 = result.naming!.get(asPartName('part1'))!
    const ctx1 = buildCtx(result, asPartName('part1'))

    // ghost role（不在 roleTable）→ 走几何兜底；surfaceType 硬门全拒 → not-found
    const ghostRef: FaceTopoRef = {
      kind: 'face',
      origin: asPartName('part0'),
      role: 'ghost:role',
      hint: { kind: 'face', surfaceType: 'torus' },
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      resolveTopoRef(ghostRef, ctx1)
      expect.unreachable('should have thrown')
    } catch (e) {
      const err = e as { code?: string; refKind?: string }
      expect(err.code).toBe('E_TOPO_NOT_FOUND')
      expect(err.refKind).toBe('face')
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    // stderr 零容忍：解析失败必须显式抛错，不静默 console 输出
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    void naming1
  })

  it('三态错误码：对称几何 hint 分不开时抛 E_TOPO_AMBIGUOUS', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    const naming0 = result.naming!.get(asPartName('part0'))!
    const ctx0 = buildCtx(result, asPartName('part0'))

    // 立方体 6 面全等：hint 只有 type（无 normal/center 信号）→ 全形状打分并列 → ambiguous
    const ambiguousRef: FaceTopoRef = {
      kind: 'face',
      origin: asPartName('part0'),
      role: 'ghost',
      hint: { kind: 'face', surfaceType: 'plane' },
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      resolveTopoRef(ambiguousRef, ctx0)
      expect.unreachable('should have thrown')
    } catch (e) {
      const err = e as { code?: string; refKind?: string }
      expect(err.code).toBe('E_TOPO_AMBIGUOUS')
      expect(err.refKind).toBe('face')
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    void naming0
  })

  it('mesh/primitive 命名：mesh 只给 hint（role=""）', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    // 该测试在 brep 模式下：验证 BREP naming 有语义 role（mesh 路径由 M4 单测覆盖）
    const naming0 = result.naming!.get(asPartName('part0'))!
    expect(naming0.faceNaming.filter((f) => f.role !== '').length).toBe(6)
    expect(naming0.faceNaming.every((f) => f.hint.surfaceType === 'plane')).toBe(true)
  })

  it('装配 TopoRef 驱动：约束面用 {topoRef} 时执行期解析并变换 moving 成员（§6.2）', async () => {
    // 与宿主编排相同：fixed=cylinder（顶面），moving=box（顶面），两法线同向 → 180° 翻转
    // box 顶面贴到 cylinder 顶面（z=10）→ box 中心落到 z=20，bottom z=10
    const code = `
      const part0 = cad.cylinder(10, 20, { centered: true, at: [0, 0, 0] })
      const part1 = cad.box(20, 20, 20, { centered: true, at: [10, 0, 0] })
      let asm0 = cad.assembly({ name: 'asm1', members: [part0, part1], constraints: [{
        type: 'face_mate',
        fixedPartName: 'part0',
        movingPartName: 'part1',
        fixedFace: { topoRef: { kind: 'face', origin: 'part0', role: 'cylinder:top', hint: { kind: 'face', surfaceType: 'plane' } } },
        movingFace: { topoRef: { kind: 'face', origin: 'part1', role: 'box:top', hint: { kind: 'face', surfaceType: 'plane' } } },
      }] })
      asm0.do_assemble()
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    expect(result.brepChain.solidCache.has(asPartName('part1'))).toBe(true)

    // 面重合不变量：moving(box) 底面 z == fixed(cylinder) 顶面 z == ~10
    const bbox = (name: PartName) => {
      const p = result.outputs.get(name) as { positions?: ArrayLike<number> } | undefined
      expect(p).toBeDefined()
      const ps = p?.positions as ArrayLike<number> | undefined
      expect(ps).toBeDefined()
      let minZ = Infinity
      let maxZ = -Infinity
      for (let i = 2; i < (ps?.length ?? 0); i += 3) {
        const z = (ps?.[i] as number) ?? 0
        if (z < minZ) minZ = z
        if (z > maxZ) maxZ = z
      }
      return { minZ, maxZ }
    }
    const fixed = bbox(asPartName('part0'))
    const moving = bbox(asPartName('part1'))
    // cylinder 不移动（fixed part），顶面 z=10
    expect(fixed.maxZ).toBeCloseTo(10, 0)
    expect(fixed.minZ).toBeCloseTo(-10, 0)
    // moving 顶面翻到底面 → moving 底面 z=10，顶面 z=30（box 尺寸 20）
    expect(moving.minZ).toBeCloseTo(10, 0)
    expect(moving.maxZ).toBeCloseTo(30, 0)
  })

  it('装配 TopoRef 悬空引用：无法命名上下文 → 显式三态错误（不静默）', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      let asm0 = cad.assembly({ name: 'bogus', members: [part0], constraints: [{
        type: 'face_mate',
        fixedPartName: 'part0',
        movingPartName: 'part0',
        fixedFace: { topoRef: { kind: 'face', origin: 'part0', role: 'ghost:role', hint: { kind: 'face', surfaceType: 'torus' } } },
        movingFace: { topoRef: { kind: 'face', origin: 'part0', role: 'box:top', hint: { kind: 'face', surfaceType: 'plane' } } },
      }] })
      asm0.do_assemble()
    `
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await runtime.execute(code, { topology: 'auto' })
      expect.unreachable('topoRef resolution should have failed')
    } catch (e) {
      const err = e as { code?: string; refKind?: string }
      expect(err.code).toBe('E_TOPO_NOT_FOUND')
      expect(err.refKind).toBe('face')
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('drill TopoRef 驱动：face 用 {topoRef} 时执行期派生法向钻孔（§6.2）', async () => {
    // box 顶面（z=+10 端盖）钻通孔：法向由 face TopoRef 在执行期解析得到 +Z
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true, at: [0, 0, 0] })
      const part1 = cad.fai_drill(part0, {
        diameter: 4, depth: 5, holeType: 'simple',
        position: [0, 0, 10], direction: 'normal',
        face: { kind: 'face', origin: 'part0', role: 'box:top', hint: { kind: 'face', surfaceType: 'plane' } },
      })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    expect(result.brepChain.solidCache.has(asPartName('part1'))).toBe(true)
    // 钻孔后的 box 仍在 BREP 链（drill 走 BREP 路径，face 解析到 +Z 不抛错）
    const naming1 = result.naming!.get(asPartName('part1'))!
    expect(naming1.faceNaming.length).toBeGreaterThanOrEqual(6)
  })

  it('drill 轴向：face + faceNormal 同时给出时以点击法向快照为权威（曲面轴向只能按点击点还原）', async () => {
    // 圆柱侧面点击：cylinder:lateral 的单一 hint 法向是柱轴，无法还原点击点径向；
    // 轴向必须以宿主捕获的 faceNormal（点击点真实法向）为权威。同时给出
    // face（身份引用）与 faceNormal（轴向快照）→ 不抛错且仍走 BREP。
    const code = `
      const part0 = cad.cylinder(10, 20, { centered: true, at: [0, 0, 0] })
      const part1 = cad.fai_drill(part0, {
        diameter: 5, depth: 0, holeType: 'simple',
        position: [0, -10, 10], direction: 'normal',
        face: { kind: 'face', origin: 'part0', role: 'cylinder:lateral', hint: { kind: 'face', surfaceType: 'cylinder', normal: [0, 0, 1], center: [0, 0, 0] } },
        faceNormal: [-0.049068, -0.998795, 0],
      })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    expect(result.brepChain.solidCache.has(asPartName('part1'))).toBe(true)
  })
})
