/**
 * cross-kernel-portability.test — 跨内核抽壳可移植性 + 面身份（FaceTopoRef）稳定性
 *
 * 方案：faijs/docs/plans/2026-10-20-face-identity-single-source-plan.md（P4 #5/#6）
 *
 * 规则三：面跨内核/跨执行的身份只能是 `FaceTopoRef{origin, role}`（hint 仅打分兜底），
 * **数字面号不可能跨内核**。本测试把小程序端产出的、用户真机实测的那段代码**逐字**
 * 拿来，在 occt 与 brepkit 上各跑一次，断言：
 * 1) 两边都能执行（无 E_TOPO_NOT_FOUND）——身份机制本身是可移植的；
 * 2) 移除的确实是同一张几何面（+X，x=10 处只剩 184 的边界环）；
 * 3) 同一几何面在两内核上产出的 role 逐字相同（'right'）。
 *
 * ⚠️ 探针写法红线（方案 §3.5）：cross-kernel 一律用**生产装配**
 * （`registerXxxBrepEngine()` + `createRuntime`），不要额外 `configureBackends` 盖
 * `config`（`mode:'auto'` 会把 box 打回 mesh 链，shell 收到 FaceTopoRef 即 E_TOPO_NOT_FOUND）。
 */
import { describe, it, expect } from 'vitest'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerBrepkitBrepEngine, BREPKIT_BREP_ENGINE_ID } from '@faicad/faijs/brep/engine/adapters/brepkit'
import { registerOcctBrepEngine, OCCT_BREP_ENGINE_ID } from '@faicad/faijs/brep/engine/adapters/occt'
import { __resetEngineRegistriesForTests } from '@faicad/faijs/brep/engine/registry'
import { asPartName } from '@faicad/faijs/identity'
import type { Shape } from '@faicad/faijs/mesh/types'
import type { PartNaming } from '@faicad/faijs/topology/naming'

/** 用户真机在微信小程序端实测产出的抽壳代码（逐字，含 hint，无面序号）。 */
const WEAPP_SHELL_CODE = `let part0 = cad.box(10 * MM, 20 * MM, 30 * MM)
let part1 = cad.shell(part0, { openFaces:[{kind:'face', origin:'s1', role:'right', hint:{kind:'face', surfaceType:'plane', normal:[1,0,0], area:600, center:[10,10,15]}}], thickness:2 * MM })`

const BOX_ONLY_CODE = 'let part0 = cad.box(10 * MM, 20 * MM, 30 * MM)'

/** x = xTarget 平面上三角形（三顶点 x 同值）的面积和；+X 开面后 = 184（边界环）。 */
function areaAtPlaneX(shape: Shape, xTarget: number, tol = 1e-4): number {
  const { positions, indices } = shape
  let area = 0
  for (let t = 0; t < indices.length / 3; t++) {
    const i0 = indices[t * 3]!; const i1 = indices[t * 3 + 1]!; const i2 = indices[t * 3 + 2]!
    const xs = [positions[i0 * 3]!, positions[i1 * 3]!, positions[i2 * 3]!]
    if (!xs.every((x) => Math.abs(x - xTarget) < tol)) continue
    const ay = positions[i0 * 3 + 1]!; const az = positions[i0 * 3 + 2]!
    const by = positions[i1 * 3 + 1]!; const bz = positions[i1 * 3 + 2]!
    const cy = positions[i2 * 3 + 1]!; const cz = positions[i2 * 3 + 2]!
    area += Math.abs((by - ay) * (cz - az) - (bz - az) * (cy - ay)) / 2
  }
  return area
}

/** box(10,20,30) 的 +X 面在 naming 里的 role（按 hint.center.x ≈ 10 定位）。 */
function rightFaceRole(naming: PartNaming | undefined): string | null | undefined {
  const row = naming?.faceNaming.find((f) => {
    const c = f.hint?.center
    return Array.isArray(c) && Math.abs(c[0]! - 10) < 1e-3 && Math.abs(c[1]! - 10) < 1e-3 && Math.abs(c[2]! - 15) < 1e-3
  })
  return row ? row.role : undefined
}

async function kernelCase(label: string): Promise<{ cx10: number; cx0: number; role: string | null | undefined }> {
  const rt = createRuntime(createNodePorts(), 'brep', undefined, { execBackend: 'interpreter' })
  const shell = await rt.execute(WEAPP_SHELL_CODE)
  expect(shell.failedAt, `[${label}] 抽壳执行失败: ${JSON.stringify(shell.failedAt)}`).toBeUndefined()
  const shape = shell.outputs.get(asPartName('part1')) as Shape | undefined
  expect(shape, `[${label}] 应产出 part1`).toBeDefined()

  const rt2 = createRuntime(createNodePorts(), 'brep', undefined, { execBackend: 'interpreter' })
  const box = await rt2.execute(BOX_ONLY_CODE)
  expect(box.failedAt, `[${label}] box 执行失败`).toBeUndefined()

  return {
    cx10: areaAtPlaneX(shape!, 10),
    cx0: areaAtPlaneX(shape!, 0),
    role: rightFaceRole(box.naming?.get(asPartName('part0'))),
  }
}

describe('跨内核：用户实测抽壳代码 + FaceTopoRef 身份', () => {
  it(`occt（${OCCT_BREP_ENGINE_ID}）：执行通过，开 +X，role='right'`, async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const c = await kernelCase('occt')
    expect(c.cx10).toBeCloseTo(184, 0) // +X 面被移除（只剩边界环）
    expect(c.cx0).toBeCloseTo(600, 0) // −X 面完整
    expect(c.role).toBe('right')
  }, 120000)

  it(`brepkit（${BREPKIT_BREP_ENGINE_ID}）：同代码同几何面，role 逐字相同`, async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const c = await kernelCase('brepkit')
    expect(c.cx10).toBeCloseTo(184, 0)
    expect(c.cx0).toBeCloseTo(600, 0)
    expect(c.role).toBe('right')
  }, 120000)
})