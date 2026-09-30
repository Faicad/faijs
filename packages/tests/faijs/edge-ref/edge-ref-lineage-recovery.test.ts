/**
 * edgeRef 血缘回走恢复（吃 #2 `no role lineage`）—— 机制验证 + 回归守卫
 *
 * 背景：`edgeRef(of, N)` 在邻面存在但「其 hash 在 part 的 roleTable 中查不到
 * (origin, role)」时抛 `no role lineage`。面路径（`resolveFaceGeometry`）在
 * `roleTable.get(origin).get(role)` miss 时走 `recomputeViaLineage` 沿血缘回走重算
 * hash 集并回填；边路径此前缺失同构机制（仅正查 `findOriginRole`，失败即抛）。
 *
 * 本测试验证 1.10 前置③ 推广到边路径后的效果：当**目标 part** 的 roleTable 缓存
 * 残缺（丢了某面的条目，但**根节点**——名字诞生处——的表完整、血缘可回走），
 * `edgeRef` 能遍历候选 `(origin, role)` 沿 DAG 重算 hash 集、找回该面身份并继续解析，
 * 而不是抛错。
 *
 * 复现方式（faithful 合成）：`cad.box` → `cad.place` 链 populate 血缘（box 根节点
 * roleTable 完整、place 带 identityEvolution）。手动删去 `placed` 在血缘图里的某面
 * role 条目（等价于「中间 op 把旧 hash 表原样带走、目标缓存残缺」的 drift 场景），
 * 断言 `cad.edgeRef(placed, E)`（E 邻接被删面）仍能解析 —— 即恢复命中。
 *
 * 未命中时 `edgeRef` 仍抛原 `no role lineage`（零回归），由既有 edge-ref.test.ts 的
 * 既有断言与下方 control 段保证。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { asPartName, type PartName, type StmtId } from '@faicad/faijs/identity'
import { runtimeLineage } from '@faicad/faijs/topology/naming/lineage'
import { findOriginRole } from '@faicad/faijs/topology/naming'
import type { RoleTable } from '@faicad/faijs/topology/naming/types'
import { buildEdgeResolutionContext, recoverEdgeFaceRole } from '@faicad/faijs/api/topo-resolve'
import { edgeRef } from '@faicad/faijs/api/edge-ref'
import type { CadRuntime, ExecutionResult } from '@faicad/faijs/cad-runtime/runtime'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
import type { BrepHandle } from '@faicad/faijs/brep/engine/types'
import type { Shape } from '@faicad/faijs/mesh/types'
import { createEditorRuntime } from '../_support/editor-runtime'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

describe('edgeRef recovers an unnamed adjacent face via lineage walk', () => {
  let runtime: CadRuntime

  beforeEach(() => {
    runtime = createEditorRuntime(createNodePorts(), 'brep')
  })

  afterEach(() => {
    runtime.dispose()
  })

  it('edgeRef resolves an edge whose adjacent face lost its role entry (drift), via lineage recovery', async () => {
    const result = await runtime.execute(
      `
      const base = cad.box(20, 20, 20, { centered: true })
      const placed = cad.place(base, { position: [0, 0, 5] })
    `,
      { topology: 'auto' },
    )
    expect(result.failedAt).toBeUndefined()

    const kernel = result.brepChain.kernel as BrepEngineApi
    const placedShape = result.outputs.get(asPartName('placed')) as Shape | undefined
    const solid = result.brepChain.solidCache.get(asPartName('placed')) as BrepHandle | undefined
    expect(placedShape).toBeDefined()
    expect(solid).toBeDefined()

    // 构建边解析上下文，拿到当前面 hash 序列表与邻接
    const ctx = buildEdgeResolutionContext(kernel, placedShape as object)
    expect(ctx).toBeDefined()
    const ordinalToHash = (ctx!.faces).map((f) => f.hash ?? 0)

    const placedPart = asPartName('placed')
    const intactTable = runtimeLineage.tableOfPart(placedPart) as RoleTable | undefined
    expect(intactTable).toBeDefined()

    // 选一个在完整表里能查到身份的面 ordinal
    let targetFace = -1
    let truth: ReturnType<typeof findOriginRole>
    for (let fo = 1; fo <= ordinalToHash.length; fo++) {
      const found = findOriginRole(intactTable!, ordinalToHash, fo)
      if (found) {
        targetFace = fo
        truth = found
        break
      }
    }
    expect(targetFace).toBeGreaterThan(0)
    expect(truth).toBeDefined()

    // 控制：删去该面在血缘图里的 role 条目，模拟「目标 part 缓存残缺（drift）」
    const placeStmt = runtimeLineage.stmtOf(placedPart)
    expect(placeStmt).toBeDefined()
    const corrupted = new Map<StmtId, ReadonlyMap<string, readonly number[]>>(intactTable!)
    const roleMap = new Map(corrupted.get(truth!.origin))
    roleMap.delete(truth!.role)
    corrupted.set(truth!.origin, roleMap)
    runtimeLineage.recordOutput(placeStmt!, corrupted, solid, placedPart)

    // 删条目后正查应失败（复现 #2）
    expect(findOriginRole(corrupted, ordinalToHash, targetFace)).toBeUndefined()

    // 单元级：recoverEdgeFaceRole 沿血缘找回正确身份
    const recovered = recoverEdgeFaceRole(kernel, placedPart, targetFace, ordinalToHash)
    expect(recovered).toEqual({ origin: truth!.origin, role: truth!.role })

    // 端到端：选一条邻接被删面的边，cad.edgeRef 应经恢复解析而非抛错
    const adjacency = ctx!.edgeFaceAdjacency ?? []
    let edgeOrdinal = -1
    for (let i = 0; i < adjacency.length; i++) {
      if ((adjacency[i] ?? []).includes(targetFace)) {
        edgeOrdinal = i + 1
        break
      }
    }
    expect(edgeOrdinal).toBeGreaterThan(0)

    // 直接调真实 edgeRef（带恢复逻辑）—— 不抛错即恢复命中
    let ref: ReturnType<typeof edgeRef> | undefined
    let threw = ''
    try {
      ref = edgeRef(placedShape as Shape, edgeOrdinal)
    } catch (e) {
      threw = (e as Error).message
    }
    expect(threw, `edgeRef should recover via lineage, but threw: ${threw}`).toBe('')
    expect(ref).toBeDefined()
    expect(ref!.kind).toBe('edge')
    expect(ref!.faces).toHaveLength(2)
    // 恢复的邻面身份应等于真相
    const recoveredFace = ref!.faces.find((q) => q.origin === truth!.origin && q.role === truth!.role)
    expect(recoveredFace).toBeDefined()
  })

  it('control: recovery returns undefined (and edgeRef still throws) when the lineage root itself never named the face', async () => {
    // 构造一个「根节点也残缺」的场景：box 完整表删掉某面后仍保留根节点记录，
    // 但 lineage 根表同样删掉该面 —— 此时血缘回走找不到任何候选，必须保持原报错。
    const result = await runtime.execute(
      `
      const base = cad.box(20, 20, 20, { centered: true })
    `,
      { topology: 'auto' },
    )
    expect(result.failedAt).toBeUndefined()
    const kernel = result.brepChain.kernel as BrepEngineApi
    const baseShape = result.outputs.get(asPartName('base')) as Shape | undefined
    const solid = result.brepChain.solidCache.get(asPartName('base')) as BrepHandle | undefined
    const ctx = buildEdgeResolutionContext(kernel, baseShape as object)
    const ordinalToHash = (ctx!.faces).map((f) => f.hash ?? 0)
    const basePart = asPartName('base')
    const intactTable = runtimeLineage.tableOfPart(basePart) as RoleTable
    // base 的根节点就是 box 本身；删掉 box 根表里某面的条目，使根表也残缺
    let targetFace = -1
    let truth: ReturnType<typeof findOriginRole>
    for (let fo = 1; fo <= ordinalToHash.length; fo++) {
      const found = findOriginRole(intactTable, ordinalToHash, fo)
      if (found) {
        targetFace = fo
        truth = found
        break
      }
    }
    const boxStmt = runtimeLineage.stmtOf(basePart)!
    const corrupted = new Map<StmtId, ReadonlyMap<string, readonly number[]>>(intactTable)
    const roleMap = new Map(corrupted.get(truth!.origin))
    roleMap.delete(truth!.role)
    corrupted.set(truth!.origin, roleMap)
    // 同时覆盖根节点记录（outputTableOf 读的是按 stmt 的表）
    runtimeLineage.recordOutput(boxStmt, corrupted, solid, basePart)

    // 根表也残缺 → 回走无任何候选 → undefined
    const recovered = recoverEdgeFaceRole(kernel, basePart, targetFace, ordinalToHash)
    expect(recovered).toBeUndefined()

    // 端到端：edgeRef 仍抛原 no role lineage（零回归）
    const adjacency = ctx!.edgeFaceAdjacency ?? []
    let edgeOrdinal = -1
    for (let i = 0; i < adjacency.length; i++) {
      if ((adjacency[i] ?? []).includes(targetFace)) {
        edgeOrdinal = i + 1
        break
      }
    }
    expect(edgeOrdinal).toBeGreaterThan(0)
    expect(() => edgeRef(baseShape as Shape, edgeOrdinal)).toThrow(/no role lineage/)
  })
})
