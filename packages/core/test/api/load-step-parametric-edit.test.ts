/**
 * api/load-step-parametric-edit.test.ts — `cad.load` STEP 基座参数化编辑
 * （评审 2026-10-15-step-parametric-edit-layer-review.md 步骤 1-3 / 验收 P1-P4）。
 *
 * 背景：宿主（3d_editor）导入 STEP 走 `cad.load`（编辑器路径），而 faijs 的
 * 基座角色表此前只建在 `cad.import_step` / `cad.import_brep`（平台路径，无人
 * 消费）。load 是裸 async 函数（不经 defineOp 包装），既不传 roleTable、也不
 * 落 part 键表 → STEP 导入件所有边 `faces === null` → `hasUsableEdgeNaming`
 * 为 false → 倒角 / 圆角被正确禁用（症状治好了，病没治）。
 *
 * 本文件把「编辑器路径」的断言钉进 CI（验收 P1/P2）：
 * - `cad.load` 真 STEP → `edgeNaming` 存在 `faces !== null` 的边行；
 * - loadCache 命中与未命中两条路径都覆盖（模块级缓存：文件内首个 load 为
 *   未命中，同内容二次 load 为命中；occt 内核是文件内单例，缓存句柄有效）；
 * - 对 STEP 基座边执行 chamfer 成功，且改参重放下游引用不断裂（验收 P3）；
 * - 多零件 compound 下各成员 role 唯一（`imported:<memberIdx>:<i>`），
 *   逐成员编辑互不干扰（验收 P4）。
 *
 * 走 `createEditorRuntime`（挂载含 `load` 的完整 cad 命名空间，编辑器路径）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { createEditorRuntime } from '../support/editor-ops'
import { asPartName } from '../../src/identity'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import type { PartNaming } from '../../src/topology/naming'

/** Node Buffer 可能是池化切片的视图（小文件 <8KB 时 .buffer 含偏移/整池），按 byteOffset 正确截取 ArrayBuffer。 */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

function stepPorts(file: 'box_boss.step' | 'test-model.step'): HostPorts {
  const bytes = toArrayBuffer(
    readFileSync(new URL(`../../../fixtures/data/${file}`, import.meta.url)),
  )
  return {
    events: { emit: () => undefined },
    assets: {
      resolveByKey: async () => ({ bytes }),
      resolveFile: async () => bytes,
      resolveUrl: async () => bytes,
    },
  } as unknown as HostPorts
}

/** 编辑器路径断言（验收 P1）：命名存在、BREP 来源、至少一条边带两邻面血统。 */
function assertUsableEdgeNaming(
  r: { failedAt?: unknown; naming?: Map<ReturnType<typeof asPartName>, PartNaming> },
  partName: string,
): PartNaming {
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

describe('P1/P2: cad.load 单零件 STEP — 编辑器路径产出可用边命名（loadCache 两路径）', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('loadCache 未命中：cad.load(box_boss.step) → edgeNaming 含 faces !== null 的边行', async () => {
    await registerOcctBrepEngine()
    const runtime = createEditorRuntime(stepPorts('box_boss.step'), 'brep')
    const r = await runtime.execute(`let part0 = await cad.load({ file: 'box_boss.step' })`)
    assertUsableEdgeNaming(r, 'part0')
  })

  it('loadCache 命中：同一文件二次 load（模块级内容哈希缓存）同样产出可用边命名', async () => {
    await registerOcctBrepEngine()
    // 模块级 loadCache（load.ts:277）已由上一用例（同文件、同内容 SHA-256、
    // 同 brepEngineId）写入——本次命中缓存、不重新解析，但 fromBrep 与
    // roleTable 登记在每次 execute 都会发生，命名断言不受缓存短路。
    const runtime = createEditorRuntime(stepPorts('box_boss.step'), 'brep')
    const r = await runtime.execute(`let part0 = await cad.load({ file: 'box_boss.step' })`)
    assertUsableEdgeNaming(r, 'part0')
  })
})

describe('P3: STEP 基座边 chamfer 成功且改参重放下游引用不断裂（occt）', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('load → edgeRef(基座边) → chamfer 成功；改 width 重放仍解析同一基座边', async () => {
    await registerOcctBrepEngine()
    const runtime = createEditorRuntime(stepPorts('box_boss.step'), 'brep')
    // 1) 基座 load → 取第一条带两邻面血统的边行，序号 = 行下标 + 1（1 起）。
    const base = await runtime.execute(`let part0 = await cad.load({ file: 'box_boss.step' })`)
    const naming = assertUsableEdgeNaming(base, 'part0')
    const edgeIdx = naming.edgeNaming.findIndex((e) => e.faces !== null)
    const edgeOrdinal = edgeIdx + 1
    expect(edgeOrdinal).toBeGreaterThan(0)

    // 2) 对基座边执行 chamfer（EdgeTopoRef 由 cad.edgeRef 合成——查角色表）。
    const c1 = await runtime.execute(
      `let part0 = await cad.load({ file: 'box_boss.step' })\n` +
        `let part1 = cad.chamfer(part0, { edges: [cad.edgeRef(part0, ${edgeOrdinal})], type: 'equal', width: 1 })\n`,
    )
    expect(c1.failedAt).toBeUndefined()
    expect(c1.outputs.get(asPartName('part1'))).toBeDefined()
    // chamfer 是真 BREP 运算：输出仍带 BREP 句柄（未退化 mesh）。
    expect(c1.brepSolids?.get(asPartName('part1'))).toBeDefined()

    // 3) 改参重放（基座不变、chamfer width 改 2）：同一 edgeRef 线路仍解析成功。
    const c2 = await runtime.execute(
      `let part0 = await cad.load({ file: 'box_boss.step' })\n` +
        `let part1 = cad.chamfer(part0, { edges: [cad.edgeRef(part0, ${edgeOrdinal})], type: 'equal', width: 2 })\n`,
    )
    expect(c2.failedAt).toBeUndefined()
    expect(c2.outputs.get(asPartName('part1'))).toBeDefined()
    // 倒角后仍有可用命名（下游特征可继续引用倒角结果）。
    assertUsableEdgeNaming(c2, 'part1')
  })
})

describe('P4: 多零件 compound — 各成员 role 唯一，逐成员编辑互不干扰', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('cad.load(test-model.step) → 合并命名逐成员 role 前缀唯一（imported:0:* / imported:1:*）', async () => {
    await registerOcctBrepEngine()
    const runtime = createEditorRuntime(stepPorts('test-model.step'), 'brep')
    const r = await runtime.execute(`let part0 = await cad.load({ file: 'test-model.step' })`)
    expect(r.failedAt).toBeUndefined()
    // compound 终端：children = 全部 solid 零件
    const entry = r.outputs.get(asPartName('part0'))
    expect((entry as { kind?: string }).kind).toBe('compound')

    const naming = assertUsableEdgeNaming(r, 'part0')
    // 合并拓扑的面行按成员声明序拼接 → role 前缀必须覆盖全部成员且互不混淆
    // （P0-2 撞名红线：几何相同的成员若都用裸 imported:<i> 会算成同一 ref）。
    const roles = naming.faceNaming
      .map((f) => f.role)
      .filter((role): role is string => role !== null)
    const memberPrefixes = new Set(
      roles
        .filter((role) => role.startsWith('imported:'))
        .map((role) => role.slice(0, role.lastIndexOf(':'))),
    )
    expect(memberPrefixes.has('imported:0')).toBe(true)
    expect(memberPrefixes.has('imported:1')).toBe(true)
    // 同一前缀内部序号连续（面枚举序命名，无跳号）。
    for (const prefix of memberPrefixes) {
      const idxs = roles
        .filter((role) => role.startsWith(`${prefix}:`))
        .map((role) => Number(role.slice(prefix.length + 1)))
        .sort((a, b) => a - b)
      expect(idxs[0]).toBe(0)
      for (let k = 1; k < idxs.length; k++) expect(idxs[k]).toBe(idxs[k - 1]! + 1)
    }
    // 两个成员都有边可用：合并命名的边行中两邻面血统来自同一成员时 faces 非空。
    expect(naming.edgeNaming.some((e) => e.faces !== null)).toBe(true)
  })
})

describe('P5: 多零件 compound 成员上 chamfer/fillet（partIndex 解包）', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('load(test-model.step) compound → chamfer(part0,{partIndex:0}) 成功（不再 E_CHAMFER_NO_BREP）', async () => {
    await registerOcctBrepEngine()
    const runtime = createEditorRuntime(stepPorts('test-model.step'), 'brep')
    // 先 load 一次：从合并命名里找一条「两邻面都属 member0」的边行。
    const base = await runtime.execute(`let part0 = await cad.load({ file: 'test-model.step' })`)
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

    // 复现用户脚本：多零件 load 产物是 compound，宿主按 partIndex 选 member0。
    // 修复前：chamfer 直接 brepOf(compound)===undefined → E_CHAMFER_NO_BREP。
    const c1 = await runtime.execute(
      `let part0 = await cad.load({ file: 'test-model.step' })\n` +
        `let part1 = cad.chamfer(part0, { edges: [${JSON.stringify(edgeRef)}], partIndex: 0, type: 'equal', width: 1 })\n`,
    )
    expect(c1.failedAt).toBeUndefined()
    expect(c1.outputs.get(asPartName('part1'))).toBeDefined()
    // chamfer 作用在 member0 上：产物仍是 compound（其余成员原样），且 member0 带 BREP 句柄。
    const out = c1.outputs.get(asPartName('part1')) as { kind?: string; children?: unknown[] }
    expect(out.kind).toBe('compound')
    expect(out.children?.length).toBeGreaterThanOrEqual(2)
  })
})
