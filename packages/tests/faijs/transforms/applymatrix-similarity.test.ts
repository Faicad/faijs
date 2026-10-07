/**
 * applyMatrix / scale3d 的变换路径分派 —— 运行时（BREP 链）回归测试。
 *
 * 钉住 openscad example023 parity 失败的根因与修复（2026-10-07）：
 * `cad.applyMatrix` 收到一个 **7 位小数打印**的刚体旋转（`0.8660254`）时，
 * 旧的绝对容差（1e-9）把它误判为"非相似"矩阵，于是走 `gp_GTrsf`
 * （`generalTransform`）而不是 `gp_Trsf`（`transform`）。GTrsf 路径在**已三角化**
 * 的实体上会重复计入被平移面（顶盖）的 TopLoc：精确几何仍正确，但导出的网格顶盖
 * 落在 z = 2h，于是 STL 对比的 bbox/IoU 崩掉。修复见 `src/brep/brep-ops.ts` 的
 * `isSimilarityAffine` / `applyAffineBrep`。
 *
 * 用例代码内联而非放 `.fai.js` 文件：`transforms/` 目录被 `transforms.test.ts`
 * 以 **mesh 模式**全量遍历，而这里的用例依赖 brep-only 的 `profile`/`extrude`，
 * 放成 fixture 会让那个遍历报 `E_MESH_UNSUPPORTED`。
 *
 * 运行：npx vitest run faijs/transforms/applymatrix-similarity.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createEditorRuntime } from '../_support/editor-runtime'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { asPartName } from '@faicad/faijs/identity'
import type { Shape } from '@faicad/faijs/mesh/types'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120_000)

/** 带孔方块的轮廓：外环 5×5、孔 2×2（孔提供被平移的顶盖，bug 的载体）。 */
const PROFILE = `cad.profile({ contours: [
  { segments: [
    { kind: 'line', x1: 1 * MM, y1: 1 * MM, x2: 1 * MM, y2: 6 * MM },
    { kind: 'line', x1: 1 * MM, y1: 6 * MM, x2: 6 * MM, y2: 6 * MM },
    { kind: 'line', x1: 6 * MM, y1: 6 * MM, x2: 6 * MM, y2: 1 * MM },
    { kind: 'line', x1: 6 * MM, y1: 1 * MM, x2: 1 * MM, y2: 1 * MM }
  ] },
  { segments: [
    { kind: 'line', x1: 3 * MM, y1: 3 * MM, x2: 3 * MM, y2: 5 * MM },
    { kind: 'line', x1: 3 * MM, y1: 5 * MM, x2: 5 * MM, y2: 5 * MM },
    { kind: 'line', x1: 5 * MM, y1: 5 * MM, x2: 5 * MM, y2: 3 * MM },
    { kind: 'line', x1: 5 * MM, y1: 3 * MM, x2: 3 * MM, y2: 3 * MM }
  ] }
] })`

/**
 * 执行一段 .fai.js 并返回最后一个产物的网格 Z 范围。
 * @param tail - 接在 `profile` + `extrude` 之后的语句序列。
 * @param outName - 要取回的产物变量名。
 * @returns 网格顶点（按索引实际引用）的 Z 范围。
 */
async function zRangeOf(tail: string, outName: string): Promise<[number, number]> {
  const code = `
let part0 = await ${PROFILE}
let part1 = await cad.extrude(part0, { length: 5 * MM })
${tail}
`
  const rt = createEditorRuntime(createNodePorts(), 'brep')
  const result = await rt.execute(code, { topology: 'auto' })
  expect(result.failedAt, JSON.stringify(result.failedAt)).toBeUndefined()
  const shape = result.outputs.get(asPartName(outName)) as Shape | undefined
  expect(shape).toBeDefined()
  let min = Infinity
  let max = -Infinity
  for (const v of Array.from(shape!.indices)) {
    const z = shape!.positions[v * 3 + 2]!
    if (z < min) min = z
    if (z > max) max = z
  }
  return [min, max]
}

describe('applyMatrix 路径分派（example023 回归）', () => {
  it('基线：只挤出，Z 范围 [0, 5]', async () => {
    const [min, max] = await zRangeOf('let part2 = part1', 'part2')
    expect(min).toBeCloseTo(0, 4)
    expect(max).toBeCloseTo(5, 4)
  })

  it('7 位小数打印的 60° Z 旋转：Z 范围仍为 [0, 5]（不得翻倍成 10）', async () => {
    const [min, max] = await zRangeOf(
      `let part2 = await cad.applyMatrix(part1, [
  [0.5, -0.8660254, 0, 0],
  [0.8660254, 0.5, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1]
])`,
      'part2',
    )
    expect(min).toBeCloseTo(0, 4)
    expect(max).toBeCloseTo(5, 4)
  })

  it('非相似矩阵（Z×2.5）：走 GTrsf 路径，Z 范围 [0, 12.5]', async () => {
    const [min, max] = await zRangeOf(
      `let part2 = await cad.applyMatrix(part1, [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 2.5, 0],
  [0, 0, 0, 1]
])`,
      'part2',
    )
    expect(min).toBeCloseTo(0, 4)
    expect(max).toBeCloseTo(12.5, 4)
  })

  it('平移矩阵：Z 范围随平移整体移动', async () => {
    const [min, max] = await zRangeOf(
      `let part2 = await cad.applyMatrix(part1, [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 3],
  [0, 0, 0, 1]
])`,
      'part2',
    )
    expect(min).toBeCloseTo(3, 4)
    expect(max).toBeCloseTo(8, 4)
  })
})

describe('scale3d 路径分派（同一缺陷的第二处入口）', () => {
  it('非等比缩放 Z×2.5：Z 范围 [0, 12.5]（不得变成 17.5）', async () => {
    const [min, max] = await zRangeOf('let part2 = await cad.scale3d(part1, [1, 1, 2.5])', 'part2')
    expect(min).toBeCloseTo(0, 4)
    expect(max).toBeCloseTo(12.5, 4)
  })

  it('等比缩放 ×2：Z 范围 [0, 10]', async () => {
    const [min, max] = await zRangeOf('let part2 = await cad.scale3d(part1, [2, 2, 2])', 'part2')
    expect(min).toBeCloseTo(0, 4)
    expect(max).toBeCloseTo(10, 4)
  })
})
