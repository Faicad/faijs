/**
 * @vitest-environment node
 *
 * exportStepFromSolids — 多实体 STEP 导出（零 fuse）单元测试。
 *
 * 验证：
 * - 多实体各自成为 STEP 中独立实体（MANIFOLD_SOLID_BREP ≥ 2），互不 fuse
 * - 导出 → importAssemblyFromStep 回读：part 数与名称一一对应（身份闭环）
 * - Compound 展平命名（`name [n]`）与导入侧拆分一致
 * - mesh 零件经 reconstructSolidFromMesh 重建后导出（ADVANCED_FACE）
 * - 颜色保留、空 entries 抛错、导出后原 solid 句柄仍有效
 *
 * Run: npx vitest run src/brep/export/step-export.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initOcctWasm, getKernel, disposeOcctWasm } from '../../../src/occt-kernel/occtKernel'
import { importAssemblyFromStep, releaseAssemblyTree } from '../../../src/occt-kernel/occtKernel'
import type { AssemblyPartNode } from '../../../src/occt-kernel/occtKernel'
import type { OcctKernel } from 'occt-wasm'
import type { BrepHandle } from '../../../src/brep/engine/types'
import type { BrepEngineApi } from '../../../src/brep/engine/primitives'
import { exportStepFromSolids } from '../../../src/brep/export/step'
import { rewriteFileMetaHeader } from '../../../src/brep/export/export-model'
import { parseStepHeaderMeta } from '../../../src/step/stepMetaParser'

let kernel: BrepEngineApi

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel() as unknown as BrepEngineApi
}, 120000)

afterAll(() => {
  disposeOcctWasm()
})

// ─── helpers ───

function makeBox(x: number, y: number, z: number, w = 10, h = 10, d = 10): BrepHandle {
  return kernel.makeBoxFromCorners(
    { x, y, z },
    { x: x + w, y: y + h, z: z + d },
  )
}

/** 收集装配树所有叶节点的 (name, color)。 */
function collectLeaves(nodes: AssemblyPartNode[]): { name: string; color: [number, number, number] | null }[] {
  const out: { name: string; color: [number, number, number] | null }[] = []
  for (const node of nodes) {
    if (node.isAssembly) {
      out.push(...collectLeaves(node.children))
    } else {
      out.push({ name: node.name, color: node.color })
    }
  }
  return out
}

/** 简易立方体三角网格（8 顶点 12 三角形，闭合流形）。 */
function unitCubeMesh(): { positions: Float32Array; indices: Uint32Array } {
  const v = [
    -5, -5, -5,   5, -5, -5,   5, 5, -5,  -5, 5, -5,
    -5, -5,  5,   5, -5,  5,   5, 5,  5,  -5, 5,  5,
  ]
  const f = [
    0, 2, 1,  0, 3, 2,
    4, 5, 6,  4, 6, 7,
    0, 1, 5,  0, 5, 4,
    2, 3, 7,  2, 7, 6,
    1, 2, 6,  1, 6, 5,
    3, 0, 4,  3, 4, 7,
  ]
  return {
    positions: new Float32Array(v),
    indices: new Uint32Array(f),
  }
}

function decodeStep(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(new Uint8Array(buffer))
}

// ─── tests ───

describe('exportStepFromSolids', () => {
  it('multi-solid export: independent entities, no fuse', async () => {
    const boxA = makeBox(0, 0, 0)
    const boxB = makeBox(20, 0, 0)
    try {
      const buffer = exportStepFromSolids(kernel, [
        { solid: boxA, name: 'part-a' },
        { solid: boxB, name: 'part-b' },
      ])
      const text = decodeStep(buffer)

      // 独立实体：≥2 个 MANIFOLD_SOLID_BREP（若 fuse 只会剩 1 个）
      const solidCount = (text.match(/MANIFOLD_SOLID_BREP/g) ?? []).length
      expect(solidCount).toBeGreaterThanOrEqual(2)

      // 精确几何（ADVANCED_FACE），非三角化（POLYGONAL_FACE）
      expect(text).toContain('ADVANCED_FACE')
      expect(text).not.toContain('POLYGONAL_FACE')

      // 回读：两个 part，名称保留（身份闭环）
      const nodes = await importAssemblyFromStep(buffer)
      try {
        const leaves = collectLeaves(nodes)
        const names = leaves.map(l => l.name).sort()
        expect(names).toEqual(['part-a', 'part-b'])
      } finally {
        releaseAssemblyTree(kernel as unknown as OcctKernel, nodes)
      }
    } finally {
      kernel.release(boxA)
      kernel.release(boxB)
    }
  })

  it('single solid: one entity, round-trips to one part', async () => {
    const box = makeBox(0, 0, 0)
    try {
      const buffer = exportStepFromSolids(kernel, [{ solid: box, name: 'solo' }])
      const text = decodeStep(buffer)
      expect(text).toContain('ADVANCED_FACE')
      expect(text).not.toContain('POLYGONAL_FACE')

      const nodes = await importAssemblyFromStep(buffer)
      try {
        const leaves = collectLeaves(nodes)
        expect(leaves).toHaveLength(1)
        expect(leaves[0].name).toBe('solo')
      } finally {
        releaseAssemblyTree(kernel as unknown as OcctKernel, nodes)
      }
    } finally {
      kernel.release(box)
    }
  })

  it('compound entry: flattened into separate parts named `name [n]`', async () => {
    const boxA = makeBox(0, 0, 0)
    const boxB = makeBox(20, 0, 0)
    const compound = kernel.makeCompound([boxA, boxB])
    try {
      const buffer = exportStepFromSolids(kernel, [{ solid: compound, name: 'assy' }])
      const text = decodeStep(buffer)
      const solidCount = (text.match(/MANIFOLD_SOLID_BREP/g) ?? []).length
      expect(solidCount).toBe(2)

      const nodes = await importAssemblyFromStep(buffer)
      try {
        const leaves = collectLeaves(nodes)
        const names = leaves.map(l => l.name).sort()
        // 与导入侧 walkLabel 拆分命名一致：`name [1]` / `name [2]`
        expect(names).toEqual(['assy [1]', 'assy [2]'])
      } finally {
        releaseAssemblyTree(kernel as unknown as OcctKernel, nodes)
      }
    } finally {
      kernel.release(compound)
      kernel.release(boxA)
      kernel.release(boxB)
    }
  })

  it('mesh entry: reconstructed solid exported as ADVANCED_FACE', async () => {
    const buffer = exportStepFromSolids(kernel, [
      { mesh: unitCubeMesh(), name: 'faceted-part' },
    ])
    const text = decodeStep(buffer)
    expect(text).toContain('ADVANCED_FACE')

    const nodes = await importAssemblyFromStep(buffer)
    try {
      const leaves = collectLeaves(nodes)
      expect(leaves).toHaveLength(1)
      expect(leaves[0].name).toBe('faceted-part')
    } finally {
      releaseAssemblyTree(kernel as unknown as OcctKernel, nodes)
    }
  })

  it('mixed solid + mesh entries: two independent entities, no string splicing', async () => {
    const box = makeBox(0, 0, 0)
    try {
      const buffer = exportStepFromSolids(kernel, [
        { solid: box, name: 'brep-part' },
        { mesh: unitCubeMesh(), name: 'mesh-part' },
      ])
      const text = decodeStep(buffer)

      const solidCount = (text.match(/MANIFOLD_SOLID_BREP/g) ?? []).length
      expect(solidCount).toBeGreaterThanOrEqual(2)
      // 单一合法 STEP 文件：仅一个 HEADER 段
      expect((text.match(/HEADER/g) ?? []).length).toBe(1)
      expect(text).not.toContain('POLYGONAL_FACE')

      const nodes = await importAssemblyFromStep(buffer)
      try {
        const names = collectLeaves(nodes).map(l => l.name).sort()
        expect(names).toEqual(['brep-part', 'mesh-part'])
      } finally {
        releaseAssemblyTree(kernel as unknown as OcctKernel, nodes)
      }
    } finally {
      kernel.release(box)
    }
  })

  it('color is preserved on the exported label', async () => {
    const box = makeBox(0, 0, 0)
    try {
      const buffer = exportStepFromSolids(kernel, [
        { solid: box, name: 'colored', color: [0.8, 0.2, 0.1] },
      ])
      const nodes = await importAssemblyFromStep(buffer)
      try {
        const leaves = collectLeaves(nodes)
        expect(leaves).toHaveLength(1)
        const c = leaves[0].color
        expect(c).not.toBeNull()
        expect(c![0]).toBeCloseTo(0.8, 5)
        expect(c![1]).toBeCloseTo(0.2, 5)
        expect(c![2]).toBeCloseTo(0.1, 5)
      } finally {
        releaseAssemblyTree(kernel as unknown as OcctKernel, nodes)
      }
    } finally {
      kernel.release(box)
    }
  })

  it('empty entries throws', () => {
    expect(() => exportStepFromSolids(kernel, [])).toThrow('No exportable geometry')
  })

  it('entry without solid or mesh throws', () => {
    const box = makeBox(0, 0, 0)
    try {
      expect(() => exportStepFromSolids(kernel, [{}])).toThrow(
        'StepExportEntry must provide either solid or mesh',
      )
    } finally {
      kernel.release(box)
    }
  })

  it('original solid handles remain usable after export (no premature release)', () => {
    const boxA = makeBox(0, 0, 0)
    const boxB = makeBox(20, 0, 0)
    try {
      exportStepFromSolids(kernel, [
        { solid: boxA, name: 'a' },
        { solid: boxB, name: 'b' },
      ])
      // 导出后原 solid 仍可继续使用（exportStep / 再导出都不抛错）
      const stepAgain = kernel.exportStep(boxA)
      expect(stepAgain).toContain('MANIFOLD_SOLID_BREP')
      exportStepFromSolids(kernel, [{ solid: boxB, name: 'b-again' }])
    } finally {
      kernel.release(boxA)
      kernel.release(boxB)
    }
  })
})

// ─── FileMeta → STEP P21 header（FILE_NAME / FILE_DESCRIPTION）往返（设计文档 §6.2 P3） ───

/** 带完整 P21 header 的最小 STEP 文本（FILE_NAME / FILE_DESCRIPTION 形态与内核输出一致）。 */
const STEP_HEADER = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Open CASCADE Model'),'2;1');
FILE_NAME('Open CASCADE Shape Model','2026-09-08T11:24:32',('Author'),(''),'','','');
FILE_SCHEMA(('AP214'));
ENDSEC;
DATA;
#1=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
ENDSEC;
END-ISO-10303-21;
`

describe('rewriteFileMetaHeader (STEP P21 FILE_NAME/FILE_DESCRIPTION)', () => {
  it('maps title/designer/organization/application/description to the spec header slots', () => {
    const out = rewriteFileMetaHeader(STEP_HEADER, {
      title: 'Gearbox v1',
      designer: 'Faicad',
      organization: 'Engineering',
      application: 'faijs',
      description: 'Reduction gear assembly',
    })
    const read = parseStepHeaderMeta(out)
    expect(read.title).toBe('Gearbox v1')
    expect(read.description).toBe('Reduction gear assembly')
    expect(read.organization).toBe('Engineering')
    expect(read.application).toBe('faijs')
    expect(read.designer).toBe('Faicad')
    // 只改 header 声明行，DATA 段几何实体不动（红线）。
    expect(out).toContain("SI_UNIT(.MILLI.,.METRE.)")
  })

  it('leaves the header byte-for-byte unchanged when fileMeta are present', () => {
    expect(rewriteFileMetaHeader(STEP_HEADER, {})).toBe(STEP_HEADER)
  })

  it('escapes embedded single quotes per ISO10303-21 (doubling)', () => {
    const out = rewriteFileMetaHeader(STEP_HEADER, {
      title: "It's a box",
      description: "don't look",
    })
    expect(out).toContain("FILE_NAME('It''s a box',")
    expect(out).toContain("FILE_DESCRIPTION(('don''t look'),")
  })
})

// ─── exportStepFromSolids(kernel, entries, fileMeta) 集成：FileMeta → P21 header ───

describe('exportStepFromSolids with fileMeta header write (P3)', () => {
  it('writes title/description/designer/organization/application into the exported STEP header', () => {
    const box = makeBox(0, 0, 0)
    try {
      const buffer = exportStepFromSolids(kernel, [{ solid: box, name: 'part' }], {
        title: 'Gearbox v2',
        designer: 'Faicad',
        organization: 'Engineering',
        application: 'faijs',
        description: 'Round trip header via exportStepFromSolids',
      })
      const read = parseStepHeaderMeta(new TextDecoder().decode(buffer))
      expect(read.title).toBe('Gearbox v2')
      expect(read.description).toBe('Round trip header via exportStepFromSolids')
      expect(read.organization).toBe('Engineering')
      expect(read.application).toBe('faijs')
      expect(read.designer).toBe('Faicad')
    } finally {
      kernel.release(box)
    }
  })

  it('leaves the header intact when fileMeta has no header-mappable fields', () => {
    const box = makeBox(0, 0, 0)
    try {
      const buffer = exportStepFromSolids(kernel, [{ solid: box, name: 'part' }], { metadata: { x: '1' } })
      expect(new TextDecoder().decode(buffer)).toContain("FILE_NAME('Open CASCADE")
    } finally {
      kernel.release(box)
    }
  })
})
// ─── 装配层级（方案 2026-10-08 步骤 7 / P3）───
//
// P3 验收：带 children 的条目写**真装配树**（NEXT_ASSEMBLY_USAGE_OCCURRENCE +
// component location），不再是平级 PRODUCT。
//
// ⚠️ 两个 occt-wasm 当前限制（双值钉住，wasm 修复后翻转断言）：
// 1. **location 旋转分量不生效**：`addChild({location:{rx,ry,rz}})` 写出→回读
//    location 恒为单位旋转（平移正常）。当前实现把旋转烘进原型几何、平移留在
//    location（世界几何保真）。应有值：location 携带完整位姿、几何不烘焙。
// 2. **组件 label 的 setName 不过 STEP**：容器有名时，首叶（几何升起为容器
//    初始 part）自己的名字让位给容器名。应有值：首组件名 = 首叶名。

/** 十进制近似断言：逐元素比较 12 元组（wasm 文本层有精度损失，1e-4 足够）。 */
function expectMatrix12Close(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(12)
  for (let i = 0; i < 12; i++) expect(actual[i]!).toBeCloseTo(expected[i]!, 4)
}

/** 收集装配树所有叶节点的 shapeHandle（DFS 序，调用方不拥有、随树释放）。 */
function collectLeafHandles(nodes: AssemblyPartNode[]): unknown[] {
  const out: unknown[] = []
  for (const node of nodes) {
    if (node.isAssembly) out.push(...collectLeafHandles(node.children))
    else if (node.shapeHandle) out.push(node.shapeHandle)
  }
  return out
}

describe('exportStepFromSolids — 装配层级（步骤 7 / P3）', () => {
  it('单层装配：NAUO 数 == 叶数，容器与组件名落位，平移位姿经 location 往返', () => {
    const a = makeBox(0, 0, 0)
    const b = makeBox(0, 0, 0)
    try {
      const text = new TextDecoder().decode(new Uint8Array(exportStepFromSolids(kernel, [
        {
          name: 'asm-root',
          children: [
            { solid: a, name: 'leg-left' },
            { solid: b, name: 'leg-right', transform: { translate: [20, 0, 5] } },
          ],
        },
      ])))
      // 真装配结构：每个组件一条装配引用（P3 当前缺陷是 0 条）。
      const nauo = text.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g)?.length ?? 0
      expect(nauo).toBe(2)

      // 往返：XCAF 回读，根 label 是装配、含两个组件；组件位姿 == 写入 transform。
      const doc2 = (getKernel() as OcctKernel).importXCAFFromSTEP(text)
      try {
        const roots = doc2.getRoots()
        expect(roots).toHaveLength(1)
        const comps = doc2.getChildren(roots[0]!)
        expect(comps).toHaveLength(2)
        // 首组件 identity（几何升起 + 位姿烘进几何），次组件携带平移 (20, 0, 5)。
        expectMatrix12Close(doc2.getLocation(comps[0]!), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0])
        expectMatrix12Close(doc2.getLocation(comps[1]!), [1, 0, 0, 20, 0, 1, 0, 0, 0, 0, 1, 5])
        // 组件名：容器名优先升起为首组件名（限制 2——首叶名 'leg-left' 让位）；
        // 次组件名 = 叶名。
        expect(doc2.getLabelInfo(comps[0]!).name).toBe('asm-root')
        expect(doc2.getLabelInfo(comps[1]!).name).toBe('leg-right')
      } finally {
        doc2.close()
      }
    } finally {
      kernel.release(a)
      kernel.release(b)
    }
  })

  it('旋转位姿：世界几何保真（旋转烘进几何）；location 旋转当前不生效（P7 双值钉住）', async () => {
    const a = makeBox(0, 0, 0)
    const b = makeBox(0, 0, 0)
    try {
      const buffer = exportStepFromSolids(kernel, [
        {
          children: [
            { solid: a },
            // 绕 X 转 90°（度）再平移 (10, 0, 0)：(y,z)→(-z,y) → y∈[-10,0]。
            // 期望世界包围盒 x∈[10,20], y∈[-10,0], z∈[0,10]——纯平移（y∈[0,10]）
            // 与无旋转（同纯平移）落不出这个足迹，判别力唯一。
            { solid: b, transform: { translate: [10, 0, 0], rotate: { angle: 90, axis: [1, 0, 0] } } },
          ],
        },
      ])
      // 当前值（旋转烘进几何）：世界包围盒正确。
      const nodes = await importAssemblyFromStep(buffer)
      try {
        const leaves = collectLeaves(nodes)
        expect(leaves).toHaveLength(2)
        const rotated = collectLeafHandles(nodes)[1]!
        const bb = kernel.getBoundingBox(rotated as unknown as BrepHandle)
        expect(bb.xmin).toBeCloseTo(10, 3)
        expect(bb.xmax).toBeCloseTo(20, 3)
        expect(bb.ymin).toBeCloseTo(-10, 3)
        expect(bb.ymax).toBeCloseTo(0, 3)
        expect(bb.zmin).toBeCloseTo(0, 3)
        expect(bb.zmax).toBeCloseTo(10, 3)
      } finally {
        releaseAssemblyTree(kernel as unknown as OcctKernel, nodes)
      }
      // P7 当前限制钉住：location 的旋转分量回读为单位旋转。应有值 =
      // [1,0,0,10, 0,0,-1,0, 0,1,0,0]（Rx(90°)+平移，行主序 3×4）——
      // occt-wasm 修复 location 旋转后，把本断言翻转为该期望矩阵，并去掉
      // 实现里的旋转烘焙（splitTransform）。
      const doc2 = (getKernel() as OcctKernel).importXCAFFromSTEP(new TextDecoder().decode(new Uint8Array(buffer)))
      try {
        const comps = doc2.getChildren(doc2.getRoots()[0]!)
        const loc = doc2.getLocation(comps[1]!)
        expectMatrix12Close(loc, [1, 0, 0, 10, 0, 1, 0, 0, 0, 0, 1, 0]) // 当前：单位旋转
        // expectMatrix12Close(loc, [1, 0, 0, 10, 0, 0, -1, 0, 0, 1, 0, 0]) // 应有值（翻转用）
      } finally {
        doc2.close()
      }
    } finally {
      kernel.release(a)
      kernel.release(b)
    }
  })

  it('组件颜色经 sRGB→linear 写入并往返保真', async () => {
    const a = makeBox(0, 0, 0)
    const b = makeBox(0, 0, 0)
    try {
      const buffer = exportStepFromSolids(kernel, [
        {
          children: [
            { solid: a, color: [1, 0, 0] },
            { solid: b, color: [0, 0.5, 1], transform: { translate: [10, 0, 0] } },
          ],
        },
      ])
      const nodes = await importAssemblyFromStep(buffer)
      try {
        const leaves = collectLeaves(nodes)
        expect(leaves).toHaveLength(2)
        const c0 = leaves[0]!.color
        expect(c0).not.toBeNull()
        expect(c0![0]).toBeCloseTo(1, 5)
        expect(c0![1]).toBeCloseTo(0, 5)
        expect(c0![2]).toBeCloseTo(0, 5)
        const c1 = leaves[1]!.color
        expect(c1).not.toBeNull()
        expect(c1![1]).toBeCloseTo(0.5, 5)
        expect(c1![2]).toBeCloseTo(1, 5)
      } finally {
        releaseAssemblyTree(kernel as unknown as OcctKernel, nodes)
      }
    } finally {
      kernel.release(a)
      kernel.release(b)
    }
  })

  it('嵌套容器：叶几何与名色保真，位姿复合烘进几何（子装配分组待 wasm 原语）', async () => {
    const a = makeBox(0, 0, 0)
    const b = makeBox(0, 0, 0)
    const c = makeBox(0, 0, 0)
    try {
      const buffer = exportStepFromSolids(kernel, [
        {
          name: 'root',
          children: [
            { solid: a, name: 'base' },
            {
              name: 'sub',
              transform: { translate: [100, 0, 0] },
              children: [
                { solid: b, name: 'pin1' },
                { solid: c, name: 'pin2', transform: { translate: [0, 0, 7] } },
              ],
            },
          ],
        },
      ])
      const nodes = await importAssemblyFromStep(buffer)
      try {
        // 结构：root 装配 + 3 个组件（sub 的叶子升起，sub 分组不落树）。
        const leaves = collectLeaves(nodes)
        expect(leaves).toHaveLength(3)
        // 当前值（限制 2）：首叶 'base' 的名字被容器名 'root' 顶掉；
        // 应有值 = ['base', 'pin1', 'pin2']——wasm 组件 setName 过 STEP 后翻转。
        const names = leaves.map((l) => l.name)
        expect(names).toEqual(['root', 'pin1', 'pin2'])
      } finally {
        releaseAssemblyTree(kernel as unknown as OcctKernel, nodes)
      }
    } finally {
      kernel.release(a)
      kernel.release(b)
      kernel.release(c)
    }
  })
})
