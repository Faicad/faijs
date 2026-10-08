/**
 * export-model.test.ts — unit-aware export invariants (unit-system §10.6).
 *
 * Invariant under test (§10.3): the declared unit in the written file equals
 * the unit exportModel was asked for, and the coordinate scale equals
 * base / unitScale(unit). readDeclaredUnit is the round-trip checker.
 */
import { describe, expect, it } from 'vitest'
import { exportModelSync, readDeclaredUnit, UNIT_NAME_TO_3MF, type ExportEntry } from '../../../src/brep/export/export-model'
import { UNIT_SCALE } from '../../../src/units'
import { detectStepUnit, importFile } from '../../../src/mesh/io'
import { readZipEntries } from '../../../src/io/zip'
import { isMeshShape, type Shape } from '../../../src/mesh/types'
import type { CompoundShape } from '../../../src/shape'
import { exportTreeOf } from '../../../src/api/internal/export-members'
import { exportStl } from '../../../src/api/export-stl'
import { export3mf } from '../../../src/api/export-3mf'
import { configureHost } from '../../support/host-env'

/** Two-triangle quad spanning [0, size] on X/Y (z=0), base-unit coordinates. */
function quadEntry(size: number, name?: string, color?: readonly [number, number, number]): ExportEntry {
  return {
    mesh: {
      positions: new Float32Array([
        0, 0, 0, size, 0, 0, size, size, 0,
        0, 0, 0, size, size, 0, 0, size, 0,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    },
    ...(name ? { name } : {}),
    ...(color ? { color } : {}),
  }
}

/** Max coordinate of the interleaved positions in a binary STL buffer. */
function stlMaxCoord(buf: ArrayBufferLike): number {
  const dv = new DataView(buf)
  const triCount = dv.getUint32(80, true)
  let max = 0
  for (let t = 0; t < triCount; t++) {
    const base = 84 + t * 50
    for (let v = 0; v < 3; v++) {
      for (let c = 0; c < 3; c++) {
        const val = Math.abs(dv.getFloat32(base + 12 + v * 12 + c * 4, true))
        if (val > max) max = val
      }
    }
  }
  return max
}

/** Min z-coordinate across all triangles in a binary STL buffer (detects z-shift from baking). */
function stlMinZ(buf: ArrayBufferLike): number {
  const dv = new DataView(buf)
  const triCount = dv.getUint32(80, true)
  let min = Infinity
  for (let t = 0; t < triCount; t++) {
    const base = 84 + t * 50
    for (let v = 0; v < 3; v++) {
      const z = dv.getFloat32(base + 12 + v * 12 + 8, true)
      if (z < min) min = z
    }
  }
  return min
}

describe('exportModel — STL (no declared unit)', () => {
  it('scales coordinates to the target unit (10mm → 0.3937 in)', () => {
    const buf = exportModelSync([quadEntry(10)], 'stl', { unit: 'inch' })
    expect(stlMaxCoord(buf)).toBeCloseTo(10 / UNIT_SCALE.inch, 4)
  })

  it('mm export keeps base coordinates byte-identical in scale', () => {
    const buf = exportModelSync([quadEntry(10)], 'stl', { unit: 'mm' })
    expect(stlMaxCoord(buf)).toBeCloseTo(10, 5)
  })

  it('readDeclaredUnit returns null (format cannot declare)', () => {
    const buf = exportModelSync([quadEntry(10)], 'stl')
    expect(readDeclaredUnit(buf, 'stl')).toBeNull()
  })

  it('装配展平烘焙：children 三角形总数 = 各叶之和，非单位 transform 成员顶点位移（§4.3 L1-5）', () => {
    // 父 object 带两个叶；第二个叶相对父平移 x+100（matrix 平移末列 token 3 = 100）。
    const root: ExportEntry = {
      name: 'asm',
      children: [
        quadEntry(10, 'a'),
        { ...quadEntry(10, 'b'), transform: { matrix: [1, 0, 0, 100, 0, 1, 0, 0, 0, 0, 1, 0] } },
      ],
    }
    const buf = exportModelSync([root], 'stl') as ArrayBuffer
    const dv = new DataView(buf)
    const triCount = dv.getUint32(80, true)
    expect(triCount).toBe(4) // 2 个 quad × 2 三角形
    // child a：x ∈ [0,10]，z = 0；child b：x ∈ [100,110]，z = 0。烘焙后最大坐标 = 110。
    expect(stlMaxCoord(buf)).toBeCloseTo(110, 5)
    // 存在顶点落在 x≈100..110，证明 child b 的 transform 已被烘焙（非简单拼接）。
    expect(stlMinZ(buf)).toBeCloseTo(0, 5)
  })
})

describe('UNIT_NAME_TO_3MF', () => {
  it('has no yard entry (3MF enum lacks it → forced pair-fallback to mm)', () => {
    expect(UNIT_NAME_TO_3MF.yard).toBeUndefined()
    expect(UNIT_NAME_TO_3MF.mm).toBe('millimeter')
    expect(UNIT_NAME_TO_3MF.inch).toBe('inch')
  })
})

describe('exportModel — 3MF basematerials (P3, v2 §8 3MF row, Core spec)', () => {
  it('writes basematerials inside <resources> and references pid/pindex from the object', () => {
    const buf = exportModelSync([quadEntry(10, 'red-part', [1, 0, 0])], '3mf', { unit: 'mm' })
    const model = readZipEntries(new Uint8Array(buf)).get('3D/3dmodel.model')
    expect(model).toBeDefined()
    const xml = new TextDecoder().decode(model)
    // Core 规范：basematerials 声明在 <resources>，object 用 pid/pindex 引用。
    // （此前内联在 <object> 内的写法 parseThreemf 不识别 → 导入→导出→导入丢色。）
    expect(xml).toMatch(/<resources><basematerials id="1"><base name="red-part" displaycolor="#ff0000"\/><\/basematerials><object id="1" type="model" name="red-part" pid="1" pindex="0"><mesh>/)
    expect(xml).not.toMatch(/<object[^>]*><basematerials/)
  })

  it('omits basematerials and pid/pindex when the entry has no color', () => {
    const buf = exportModelSync([quadEntry(10)], '3mf', { unit: 'mm' })
    const model = readZipEntries(new Uint8Array(buf)).get('3D/3dmodel.model')
    expect(model).toBeDefined()
    const xml = new TextDecoder().decode(model)
    expect(xml).not.toContain('basematerials')
    expect(xml).toMatch(/<object id="1" type="model" name="part1"><mesh>/)
  })

  it('materialGroups → 独立 basematerials（id 与对象错开）+ 三角形 pid 引用（P4）', () => {
    const entry: ExportEntry = {
      ...quadEntry(10, 'two-tone'),
      materialGroups: [
        { start: 0, count: 1, appearance: { color: [1, 0, 0] } },
        { start: 1, count: 1, appearance: { color: [0, 0, 1] } },
      ],
    }
    const buf = exportModelSync([entry], '3mf', { unit: 'mm' })
    const xml = new TextDecoder().decode(readZipEntries(new Uint8Array(buf)).get('3D/3dmodel.model')!)
    // 两个 basematerials 资源（id=2,3，从 entries.length+1 起，与对象 id=1 错开）。
    expect(xml).toMatch(/<basematerials id="2"><base name="two-tone_g1" displaycolor="#ff0000"\/><\/basematerials>/)
    expect(xml).toMatch(/<basematerials id="3"><base name="two-tone_g2" displaycolor="#0000ff"\/><\/basematerials>/)
    // 三角形按区间引用：tri0 → pid 2，tri1 → pid 3；对象本身无对象级 pid（未分组三角形无材质）。
    expect(xml).toMatch(/<triangle v1="0" v2="1" v3="2" pid="2" p1="0" p2="0" p3="0"\/>/)
    expect(xml).toMatch(/<triangle v1="3" v2="4" v3="5" pid="3" p1="0" p2="0" p3="0"\/>/)
    expect(xml).toMatch(/<object id="1" type="model" name="two-tone"><mesh>/)
  })

  it('materialGroups 无 color 的组跳过（3MF 只支持 displaycolor）', () => {
    const entry: ExportEntry = {
      ...quadEntry(10, 'metal-only'),
      materialGroups: [{ start: 0, count: 2, appearance: { metalness: 0.9 } }],
    }
    const buf = exportModelSync([entry], '3mf', { unit: 'mm' })
    const xml = new TextDecoder().decode(readZipEntries(new Uint8Array(buf)).get('3D/3dmodel.model')!)
    expect(xml).not.toContain('basematerials')
    expect(xml).not.toMatch(/pid="/)
  })

  it('对象级 color 与 materialGroups 并存：对象 pid + 分组三角形 pid 各自生效', () => {
    const entry: ExportEntry = {
      ...quadEntry(10, 'mixed', [0, 1, 0]),
      materialGroups: [{ start: 0, count: 1, appearance: { color: [1, 0, 0] } }],
    }
    const buf = exportModelSync([entry], '3mf', { unit: 'mm' })
    const xml = new TextDecoder().decode(readZipEntries(new Uint8Array(buf)).get('3D/3dmodel.model')!)
    expect(xml).toMatch(/<basematerials id="1"><base name="mixed" displaycolor="#00ff00"\/><\/basematerials>/)
    expect(xml).toMatch(/<basematerials id="2"><base name="mixed_g1" displaycolor="#ff0000"\/><\/basematerials>/)
    expect(xml).toMatch(/<object id="1" type="model" name="mixed" pid="1" pindex="0"><mesh>/)
    expect(xml).toMatch(/<triangle v1="0" v2="1" v3="2" pid="2" p1="0" p2="0" p3="0"\/>/)
    expect(xml).toMatch(/<triangle v1="3" v2="4" v3="5"\/>/)
  })

  it('往返：materialGroups → 3MF → 读回（导入→导出→导入颜色不丢，P4）', async () => {
    const entry: ExportEntry = {
      ...quadEntry(10, 'two-tone'),
      materialGroups: [
        { start: 0, count: 1, appearance: { color: [1, 0, 0] } },
        { start: 1, count: 1, appearance: { color: [0, 0, 1] } },
      ],
    }
    const buf = exportModelSync([entry], '3mf', { unit: 'mm' })
    const res = await importFile(buf, '3mf')
    const s = res.shape
    expect(s.materialGroups).toEqual([
      { start: 0, count: 1, appearance: { color: [1, 0, 0] } },
      { start: 1, count: 1, appearance: { color: [0, 0, 1] } },
    ])
    // 未分组三角形（对象无 pid）不误归到第一个材质色。
    expect(s.appearance).toBeUndefined()
  })

  it('往返：单色对象仍走 baseColor（对象级 pid + 三角形无 pid，P3 兼容）', async () => {
    const buf = exportModelSync([quadEntry(10, 'red-part', [1, 0, 0])], '3mf', { unit: 'mm' })
    const res = await importFile(buf, '3mf')
    const s = res.shape
    expect(s.appearance).toEqual({ color: [1, 0, 0] })
    expect(s.materialGroups).toBeUndefined()
  })
})

describe('detectStepUnit — fixture-backed parsing', () => {
  it('parses SI_UNIT(.MILLI.,.METRE.) as mm', () => {
    const step = `DATA;
#35=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
ENDSEC;`
    expect(detectStepUnit(step)).toBe('mm')
  })

  it('parses CONVERSION_BASED_UNIT METRE as m', () => {
    const step = `DATA;
#65=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.0),#66);
#66=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.));
#67=(CONVERSION_BASED_UNIT('METRE',#65)LENGTH_UNIT()NAMED_UNIT(#68));
ENDSEC;`
    expect(detectStepUnit(step)).toBe('m')
  })

  it('parses CONVERSION_BASED_UNIT INCH as inch', () => {
    const step = `DATA;
#67=(CONVERSION_BASED_UNIT('INCH',#65)LENGTH_UNIT()NAMED_UNIT(#68));
ENDSEC;`
    expect(detectStepUnit(step)).toBe('inch')
  })

  it('returns null when no length-unit declaration exists', () => {
    expect(detectStepUnit('DATA;\n#1=POINT(0,0,0);\nENDSEC;')).toBeNull()
  })

  it('ignores HEADER section position — entity found past 8 lines', () => {
    const lines = ['ISO-10303-21;', 'HEADER;', 'ENDSEC;', 'DATA;']
    for (let i = 0; i < 30; i++) lines.push('#' + (i + 1) + '=DUMMY();')
    lines.push('#99=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));', 'ENDSEC;')
    expect(detectStepUnit(lines.join('\n'))).toBe('mm')
  })
})

describe('3MF 导出元数据（设计文档 2026-10-05-meta §6.1 3MF 行）', () => {
  it('零件 meta → <object partnumber> + <metadatagroup>', async () => {
    const buf = exportModelSync(
      [
        {
          ...quadEntry(10, 'GearHousing'),
          meta: {
            name: 'GearHousing',
            partNumber: 'GB-001',
            description: 'input housing',
            metadata: { 'fa:source': 'designed' },
          },
        },
      ],
      '3mf',
    )
    const xml = new TextDecoder().decode(readZipEntries(new Uint8Array(buf)).get('3D/3dmodel.model')!)
    expect(xml).toContain('partnumber="GB-001"')
    expect(xml).toContain('<metadata name="faijs:description">input housing</metadata>')
    // 带前缀键（fa:source）原样写出；不带前缀的补 faijs: 前缀。
    expect(xml).toContain('<metadata name="fa:source">designed</metadata>')
    // 导出→导入往返：meta 完全还原。
    const imported = await importFile(buf, '3mf')
    expect(imported.shape.meta).toEqual({
      name: 'GearHousing',
      partNumber: 'GB-001',
      description: 'input housing',
      metadata: { 'fa:source': 'designed' },
    })
  })

  it('fileMeta → <model> 级 well-known <metadata> + vendor 键', () => {
    const buf = exportModelSync([quadEntry(10)], '3mf', {
      fileMeta: { title: 'Gearbox v1', designer: 'Faicad', metadata: { 'vendor:project': 'P-42' } },
    })
    const xml = new TextDecoder().decode(readZipEntries(new Uint8Array(buf)).get('3D/3dmodel.model')!)
    expect(xml).toContain('<metadata name="Title">Gearbox v1</metadata>')
    expect(xml).toContain('<metadata name="Designer">Faicad</metadata>')
    expect(xml).toContain('<metadata name="vendor:project">P-42</metadata>')
    // faijs 命名空间前缀已声明（自定义 vendor 名默认带前缀，此处 vendor:project 自带）。
    expect(xml).toMatch(/xmlns:faijs="http:\/\/schemas\.faicad\.dev\/3mf\/2026\/10"/)
  })
})

/**
 * Shape.transform — 装配节点位姿字段（方案 2026-10-08 §2.1 / §5 第 3 步）。
 *
 * 第 3 步落地的是**字段本身**：纯数据、可序列化。写出器消费分两步——第 4 步（3MF
 * `<components>` 的 `<component transform>`）与第 5 步（STL 顶点烘焙 / 导入归一）——
 * 均已落地。本块断言 3MF 把 transform 写进 `<item transform>`、STL 把 transform 烘焙
 * 进顶点（坐标按矩阵平移），与无 transform 版本产生差异。
 */
describe('Shape.transform — 节点位姿字段（§2.1 / §5 第 3 步）', () => {
  /** 基准单位单三角形（最大坐标 10，z=0 平面）。 */
  function triShape(): Shape {
    return {
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
      indices: new Uint32Array([0, 1, 2]),
    }
  }

  /** 三种取值形态齐给（形态与 §2.1 的类型逐字一致）。 */
  const TRANSFORM: NonNullable<Shape['transform']> = {
    translate: [1, 2, 3],
    rotate: { angle: 90, axis: [0, 0, 1] },
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 5],
  }

  it('纯数据可序列化：JSON 往返与 structuredClone 都保真（字段内无方法）', () => {
    const shape: Shape = { ...triShape(), transform: TRANSFORM }
    expect(JSON.parse(JSON.stringify(shape)).transform).toEqual(TRANSFORM)
    expect(structuredClone(shape).transform).toEqual(TRANSFORM)
    // 纯数据 = 可 JSON 编码：字段内不含函数（对比 Shape 实例上挂的方法不序列化）。
    expect(JSON.stringify(shape.transform)).not.toContain('function')
  })

  it('被写出器消费（步骤 4 / 5 已落地）：3mf 写 <item transform>，stl 把 transform 烘焙进顶点', () => {
    configureHost('node')
    const plain = triShape()
    const posed: Shape = { ...triShape(), transform: TRANSFORM }
    // STL 在步骤 5 之后消费 transform：matrix 平移末列 = 5（base 单位 mm）→ 顶点 z 整体 +5，
    // 字节不再等于无 transform 版本，最小 z 由 0 变为 5。
    // GOTCHA: 不能用 `.buffer` 做 toEqual——Vitest 对 ArrayBuffer 的相等判定走结构比较
    //（无可枚举自身属性 → 同长度即相等），而 diff 打印器按字节展示，会制造
    // 「字节明明不同却被判相等」的假象。必须比较 Uint8Array 视图（按元素逐字节比较）。
    expect(exportStl(posed)).not.toEqual(exportStl(plain))
    expect(stlMinZ((exportStl(posed) as Uint8Array).buffer)).toBeCloseTo(5, 5)
    expect(stlMinZ((exportStl(plain) as Uint8Array).buffer)).toBeCloseTo(0, 5)
    // 3MF：transform 不再被忽略，而是写进 build <item transform>（单件也走 item 级变换）。
    const plainXml = new TextDecoder().decode(readZipEntries(new Uint8Array(export3mf(plain))).get('3D/3dmodel.model')!)
    const posedXml = new TextDecoder().decode(readZipEntries(new Uint8Array(export3mf(posed))).get('3D/3dmodel.model')!)
    expect(plainXml).not.toMatch(/<item[^>]*transform=/)
    // TRANSFORM.matrix 为 12 元组 → 直接写出（行主序，平移在末列）。
    expect(posedXml).toMatch(/<item objectid="1" transform="1 0 0 0 0 1 0 0 0 0 1 5"\/>/)
  })

  it('不改链路判定：isMeshShape 仍为 true（鸭子判定不看新字段）', () => {
    expect(isMeshShape(triShape())).toBe(true)
    expect(isMeshShape({ ...triShape(), transform: TRANSFORM })).toBe(true)
  })
})

describe('exportModel — 3MF 装配层级（方案步骤 4 / P2）', () => {
  function decode3mf(buf: ArrayBuffer): string {
    return new TextDecoder().decode(readZipEntries(new Uint8Array(buf)).get('3D/3dmodel.model')!)
  }

  it('compound → 父 object 的 <components> 引用各叶 object，<build> 指向父', () => {
    const root: ExportEntry = {
      name: 'asm',
      children: [quadEntry(10, 'a', [1, 0, 0]), quadEntry(20, 'b', [0, 0, 1])],
    }
    const xml = decode3mf(exportModelSync([root], '3mf') as ArrayBuffer)
    // 父 object id=1，两个叶 object id=2、3（DFS 先父后子）。
    expect(xml).toMatch(
      /<object id="1" type="model" name="asm"><components><component objectid="2"\/><component objectid="3"\/><\/components><\/object>/,
    )
    expect(xml).toMatch(/<object id="2" type="model" name="a"/)
    expect(xml).toMatch(/<object id="3" type="model" name="b"/)
    expect(xml).toMatch(/<build><item objectid="1"\/><\/build>/)
  })

  it('叶 transform → <component transform> 12 元组（行主序，平移在末列）', () => {
    const root: ExportEntry = {
      name: 'asm',
      children: [{ ...quadEntry(10, 'a'), transform: { translate: [5, 0, 0] } }],
    }
    const xml = decode3mf(exportModelSync([root], '3mf') as ArrayBuffer)
    expect(xml).toMatch(/<component objectid="2" transform="1 0 0 5 0 1 0 0 0 0 1 0"\/>/)
  })

  it('嵌套两级装配递归（父→中→叶，component 顺序 child-first）', () => {
    const root: ExportEntry = {
      name: 'asm',
      children: [{ name: 'mid', children: [quadEntry(10, 'leaf', [0, 1, 0])] }],
    }
    const xml = decode3mf(exportModelSync([root], '3mf') as ArrayBuffer)
    // 叶最末 id=3；mid(id=2) 含 leaf(id=3) 的 component；asm(id=1) 含 mid(id=2) 的 component。
    expect(xml).toMatch(/<object id="3" type="model" name="leaf"/)
    expect(xml).toMatch(/<object id="2"[^>]*><components><component objectid="3"\/><\/components>/)
    expect(xml).toMatch(/<object id="1"[^>]*><components><component objectid="2"\/><\/components>/)
  })

  it('空装配容器：仅含空 children 的根被导出为无 mesh 的容器 object（不抛、ZIP 合法）', () => {
    const root: ExportEntry = { name: 'asm', children: [] }
    const buf = exportModelSync([root], '3mf') as ArrayBuffer
    const xml = decode3mf(buf)
    expect(xml).toMatch(/<object id="1" type="model" name="asm"><\/object>/)
  })
})

describe('3MF 装配往返（方案 D1 / 第 5 步导入归一）', () => {
  const quad = () => ({
    positions: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 0, 0, 10, 10, 0, 0, 10, 0]),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
  })
  const T_B = { matrix: [1, 0, 0, 5, 0, 1, 0, 0, 0, 0, 1, 0] } as const

  /** 解 3MF ZIP，取出根 model XML 文本（中间校验写出器的字节格式用）。 */
  const decode3mf = (buf: ArrayBuffer): string =>
    new TextDecoder().decode(readZipEntries(new Uint8Array(buf)).get('3D/3dmodel.model')!)

  it('Entry 装配导出 → 导入还原：结构 / 名称 / 颜色 / 叶 transform 逐一相等', async () => {
    const entries: ExportEntry[] = [
      {
        name: 'asm',
        children: [
          { name: 'A', color: [1, 0, 0], mesh: quad() },
          { name: 'B', color: [0, 0, 1], transform: { matrix: [...T_B.matrix] }, mesh: quad() },
        ],
      },
    ]
    const buf = exportModelSync(entries, '3mf') as ArrayBuffer

    // 中间校验：写出器确实写出 <components> + <component transform>（行主序，平移末列）。
    const xml = decode3mf(buf)
    expect(xml).toMatch(
      /<components><component objectid="\d+"\/><component objectid="\d+" transform="1 0 0 5 0 1 0 0 0 0 1 0"\/><\/components>/,
    )

    // 导入归一：还原 CompoundShape 层级，叶节点写回相对父 transform。
    const imported = await importFile(buf, '3mf')
    expect(imported.assembly).toBeDefined()
    const root = imported.assembly as CompoundShape
    expect(root.kind).toBe('compound')
    expect(root.children).toHaveLength(2)
    const [a, b] = root.children as [Shape, Shape]
    expect(a.meta?.name).toBe('A')
    expect(a.appearance?.color).toEqual([1, 0, 0])
    expect(b.meta?.name).toBe('B')
    expect(b.appearance?.color).toEqual([0, 0, 1])
    expect(b.transform).toEqual({ matrix: [...T_B.matrix] })
  })

  it('Shape → exportTreeOf → 导出 → 导入：叶 transform 在 Shape 路径上往返一致', async () => {
    configureHost('node')
    const child: Shape = {
      ...quad(),
      meta: { name: 'X' },
      transform: { matrix: [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 7] },
    }
    const asm: CompoundShape = { kind: 'compound', children: [child] }
    // 走公共 export3mf（薄壳：exportTreeOf → entryOfNode 把 Shape.mesh 提出来 →
    // exportModelSync），而非直接把 ExportMemberNode 喂给 exportModelSync（member 节点
    // 带 .shape 而非 .mesh，写出器会静默跳过 → 无几何）。
    const buf = export3mf(asm) as unknown as ArrayBuffer
    const imported = await importFile(buf, '3mf')
    const root = imported.assembly as CompoundShape
    expect(root.kind).toBe('compound')
    expect(root.children).toHaveLength(1)
    expect((root.children[0] as Shape).transform).toEqual({
      matrix: [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 7],
    })
  })
})
