/**
 * @vitest-environment node
 *
 * 单参数 L2 覆盖补账（`scripts/check-api-test-coverage.ts` 报告的历史缺口）：
 * - `extrude.backwardLength`（双向拉伸，brep-only）
 * - `dimension.nominal` / `dimension.label`（PMI 构造器直呼）
 * - `gdt.label` / `gdt.toleranceZone`
 * - `note.leaderDirection`
 * - `surfaceFinish.method` / `surfaceFinish.textureDirection`
 * - `text.faceCenter` / `text.faceNormal`、`svgExtrude.faceCenter` / `svgExtrude.faceNormal`（贴面，brep-only）
 *
 * L2 扫描只认 `op({...})` 直呼形态的对象字面量参数（见 anchor-align.test.ts 文件头
 * 说明），所以每个参数都必须出现在 TS 直呼调用点，脚本字符串里的用法不算数。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getActiveBrepEngine, __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import type { Shape, Vec3 } from '../../src/mesh/types'
import { dimension, gdt, note, surfaceFinish } from '../../src/api/pmi/types'
import { extrude } from '../../src/api/extrude'
import { text } from '../../src/extra/ops/text'
import { svgExtrude } from '../../src/extra/ops/svg-extrude'
import { sketch } from '../../src/sketch/op'
import { dxfExtrude } from '../../src/extra/ops/dxf-extrude'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import { configureTessellationTiming, getTessellationTiming } from '../../src/runtime-state'
import { createRuntime } from '../../src/cad-runtime/runtime'
import { ensureTestFontLoader } from '@faicad/faijs/brep/text/fontTestHelper'
import type { FaceTopoRef } from '../../src/topology/naming/types'

beforeAll(async () => {
  await initOcctWasm()
  await ensureTestFontLoader()
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
}, 120000)

async function setBackend(mode: 'mesh' | 'brep'): Promise<void> {
  const kernel = (await getActiveBrepEngine()).primitives
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode },
    kernel: { brep: kernel, csg: undefined, sdf: undefined },
    fonts: undefined, texture: undefined, assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
}

/** 载荷三角化的 z 跨度 [minZ, maxZ]（双向拉伸断言用）。 */
function zSpan(s: Shape): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 2; i < s.positions.length; i += 3) {
    const v = s.positions[i]!
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return [lo, hi]
}

const faceRef: FaceTopoRef = {
  kind: 'face',
  origin: 's1' as never,
  role: 'top',
  hint: { kind: 'face', surfaceType: 'plane', normal: [0, 0, 1] },
}

// ── PMI 标注构造器（纯数据，无需几何环境）─────────────────────────────

describe('PMI 构造器直呼：历史未覆盖参数', () => {
  it('dimension({ dimType, targets, nominal, label })：名义值与标签原样携带', () => {
    const d = dimension({
      dimType: 'linear',
      targets: [faceRef],
      nominal: 42.5,
      label: '42.5 ±0.1',
    })
    expect(d.kind).toBe('dimension')
    expect(d.nominal).toBe(42.5)
    expect(d.label).toBe('42.5 ±0.1')
  })

  it('gdt({ gdtType, target, tolerance, label, toleranceZone })', () => {
    const g = gdt({
      gdtType: 'flatness',
      target: faceRef,
      tolerance: 0.02,
      label: '平面度 0.02',
      toleranceZone: 'width',
    })
    expect(g.kind).toBe('gdt')
    expect(g.label).toBe('平面度 0.02')
    expect(g.toleranceZone).toBe('width')
  })

  it('note({ text, anchor, leaderDirection })', () => {
    const n = note({
      text: '锐边倒钝',
      anchor: [1, 2, 3],
      leaderDirection: [0, 0, 1],
    })
    expect(n.kind).toBe('note')
    expect(n.anchor).toEqual([1, 2, 3])
    expect(n.leaderDirection).toEqual([0, 0, 1])
  })

  it('surfaceFinish({ target, parameter, value, method, textureDirection })', () => {
    const sf = surfaceFinish({
      target: faceRef,
      parameter: 'Ra',
      value: 1.6,
      method: 'milling',
      textureDirection: 'parallel',
    })
    expect(sf.kind).toBe('surfaceFinish')
    expect(sf.method).toBe('milling')
    expect(sf.textureDirection).toBe('parallel')
  })
})

// ── 几何 op（brep 路径）───────────────────────────────────────────────

describe('extrude backwardLength（双向拉伸，brep 路径）', () => {
  it('XY 矩形 sketch 双向拉伸：z 跨度 [-backwardLength, +length]', async () => {
    await setBackend('brep')
    const runtime = createRuntime({ events: { emit: () => undefined } } as never, 'auto')
    const res = await runtime.execute(
      "let sk0 = cad.sketch({ plane: 'XY', shapes: [{ kind: 'rect', w: 20, d: 10, tag: 'g0' }], constraints: [] })",
    )
    expect(res.failedAt).toBeUndefined()
    const sk0 = res.outputs.get('sk0' as never) as Shape
    // L2 直呼调用点：backwardLength 必须出现在对象字面量里
    const solid = (await extrude(sk0, { length: 5, backwardLength: 15, normal: [0, 0, 1] })) as Shape
    const [lo, hi] = zSpan(solid)
    expect(lo).toBeCloseTo(-15, 3)
    expect(hi).toBeCloseTo(5, 3)
  })
})

describe('text / svgExtrude 贴面参数（faceCenter + faceNormal，brep 路径）', () => {
  it('text({ text, size, depth, faceCenter, faceNormal })：产物非空', async () => {
    await setBackend('brep')
    const t = (await text({ text: 'Hi', size: 10, depth: 2, faceCenter: [0, 0, 10], faceNormal: [0, 0, 1] })) as Shape
    expect(t.positions.length).toBeGreaterThan(0)
    const [lo, hi] = zSpan(t)
    // placeOnFace 沿法向把厚度推到面外：z 全部在 faceCenter.z 一侧
    expect(hi).toBeGreaterThanOrEqual(10)
  })

  it('svgExtrude({ svg, depth, faceCenter, faceNormal })：产物非空且抬离 z=0', async () => {
    await setBackend('brep')
    const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect x="2" y="2" width="16" height="16"/></svg>'
    const s = (await svgExtrude({
      svg: SVG, depth: 5, targetLongSide: 20, faceCenter: [0, 0, 10] as Vec3, faceNormal: [0, 0, 1],
    })) as Shape
    expect(s.positions.length).toBeGreaterThan(0)
    const [lo] = zSpan(s)
    // 厚度沿法向推 depth/2：底面不低于面心 z
    expect(lo).toBeGreaterThanOrEqual(10 - 1e-3)
  })
})

describe('dxfExtrude 直呼（内联 DXF 文本，brep 路径）', () => {
  it('dxfExtrude({ dxf, depth, targetLongSide })：内联 DXF 文本挤出非空实体', async () => {
    await setBackend('brep')
    const DXF = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', 'P', '90', '0',
      '10', '0', '20', '0',
      '10', '10', '20', '0',
      '10', '10', '20', '10',
      '10', '0', '20', '10',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n')
    const s = (await dxfExtrude({ dxf: DXF, depth: 5, targetLongSide: 20 })) as Shape
    expect(s.positions.length).toBeGreaterThan(0)
  })

  it('dxfExtrude({ dxf, depth, targetLongSide, faceCenter, faceNormal })：贴面放置抬离 z=0', async () => {
    await setBackend('brep')
    const DXF = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', 'P', '90', '0',
      '10', '0', '20', '0',
      '10', '10', '20', '0',
      '10', '10', '20', '10',
      '10', '0', '20', '10',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n')
    const s = (await dxfExtrude({
      dxf: DXF, depth: 5, targetLongSide: 20, faceCenter: [0, 0, 10] as Vec3, faceNormal: [0, 0, 1],
    })) as Shape
    expect(s.positions.length).toBeGreaterThan(0)
    const [lo] = zSpan(s)
    expect(lo).toBeGreaterThanOrEqual(10 - 1e-3)
  })
})

// ── sketch 直呼（geoms 形态）与 CadRuntime 时机选项 ─────────────────────

describe('sketch 直呼：geoms + constraints + as + plane（brep 路径）', () => {
  it("sketch({ geoms, constraints, as:'face', plane:'XY' })：展开几何 + 约束求解构面", async () => {
    await setBackend('brep')
    const f = (await sketch({
      geoms: [
        { tag: 'g0', kind: 'line', x1: 0, y1: 0, x2: 80, y2: 0 },
        { tag: 'g1', kind: 'line', x1: 80, y1: 0, x2: 80, y2: 50 },
        { tag: 'g2', kind: 'line', x1: 80, y1: 50, x2: 0, y2: 50 },
        { tag: 'g3', kind: 'line', x1: 0, y1: 50, x2: 0, y2: 0 },
      ],
      constraints: [{ kind: 'horizontal', of: { tag: 'g0' } }],
      as: 'face',
      plane: 'XY',
    })) as Shape
    expect(f.positions.length).toBeGreaterThan(0)
  })
})

describe('CadRuntime tessellationTiming（构造器时机选项）', () => {
  it("tessellationTiming:'defer' 生效并可读回，恢复 eager 后回到默认", async () => {
    // 调用点必须直写 `new CadRuntime(...)`：L2 扫描按调用名 CadRuntime 收集
    // options 容器参数（createRuntime 工厂的名字对不上）。
    const rt = new CadRuntime({ events: { emit: () => undefined } } as never, 'auto', {}, {
      tessellationTiming: 'defer',
    })
    expect(getTessellationTiming()).toBe('defer')
    // 直呼调用点：configureTessellationTiming + 合法值域
    configureTessellationTiming('eager')
    expect(getTessellationTiming()).toBe('eager')
    void rt
  })

  it('非法值当面抛错（宿主配置错误不静默回退）', () => {
    expect(() => configureTessellationTiming('lazy' as never)).toThrow(/tessellationTiming/)
  })
})
