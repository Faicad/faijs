/**
 * PMI 裸世界坐标的变换补偿 —— 读时施加累积变换，数据零改动。
 *
 * 解决的问题：`PmiNote.anchor` / `PmiThreadHole.axis` 不在 `TopoRef` 体系里
 * （mesh 链没有拓扑身份，也必须能定位孔口），所以 `translate` / `rotate_euler` /
 * `scale` 之后它们仍是旧坐标，标注会留在原位。`TopoRef` 不受影响——它的
 * `origin` 是语句级因果坐标，`resolveViaLineage` 自己会走到新位置。
 *
 * 修法：变换类 op 在 `dpmRemap` 里登记仿射矩阵（`api/transform.ts`），聚合时沿
 * 父语句链乘上去（`api/pmi/registry.ts#walkStmt` + `api/pmi/affine.ts`）。
 *
 * 关键：**坐标补偿必须与真实几何变换逐位一致**。因此每个用例都拿"标注坐标"和
 * "变换后 shape 的网格包围盒中心"对账——如果补偿矩阵的转序/符号与内核不同，
 * 这两者必然对不上。
 *
 * 运行：npx vitest run test/api/pmi/pmi-transform.test.ts
 */

// ─── OCCT stdout 噪声过滤 ───
const occtOrigLog = console.log
console.log = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  const isOcctNoise =
    msg.includes('Statistics on Transfer') ||
    msg.includes('Transfer Mode =') ||
    msg.includes('Transferring Shape') ||
    msg.includes('WorkSession') ||
    /^\*{4,}/.test(msg) ||
    msg.startsWith(' Step File Name')
  if (isOcctNoise || msg.trim() === '') return
  occtOrigLog(...args)
}

import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../../src/cad-runtime/runtime'
import { initOcctWasm } from '../../../src/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../../../src/brep/engine/adapters/occt'
import { createApiNamespaceWithEditorOps } from '../../support/editor-ops'
import { hostPorts } from '../../support/host-env'
import type { PmiItem, PmiNote, PmiThreadHole } from '../../../src/api/pmi/types'
import type { Shape } from '../../../src/mesh/types'
import {
  mirrorAffine,
  composeAffine,
  affineApplyPoint,
  affineApplyDirection,
  remapPmiItem,
  PMI_AFFINE_IDENTITY,
} from '../../../src/api/pmi/affine'

beforeAll(async () => {
  await initOcctWasm()
  await registerOcctBrepEngine()
}, 120000)

function exec(code: string): Promise<ExecutionResult> {
  return new CadRuntime(hostPorts('node'), 'brep', { cad: createApiNamespaceWithEditorOps() }).execute(code)
}

/** 从执行结果的 PMI 行里取某个零件的标注。 */
function pmiOfPart(r: ExecutionResult, part: string): readonly PmiItem[] {
  return r.pmi?.find((e) => e.part === part)?.items ?? []
}

function noteAnchor(items: readonly PmiItem[]): readonly number[] | undefined {
  const note = items.find((i): i is PmiNote => i.kind === 'note')
  return note?.anchor
}

function holeAxis(items: readonly PmiItem[]): PmiThreadHole['axis'] | undefined {
  return items.find((i): i is PmiThreadHole => i.kind === 'threadHole')?.axis
}

/** 网格顶点的包围盒中心（对账用：与真实几何直接比对，不经过任何 PMI 代码）。 */
function bboxCenter(shape: Shape): number[] {
  const p = shape.positions
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i + 2 < p.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      lo[k] = Math.min(lo[k], p[i + k])
      hi[k] = Math.max(hi[k], p[i + k])
    }
  }
  return [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2)
}

/** 数值比较到 3 位（mm 级，足够判定矩阵对不对）；`+0` 归一并避免 `-0 !== 0` 的假失败。 */
function expectVec(actual: readonly number[] | undefined, expected: readonly number[]): void {
  expect(actual).toBeDefined()
  const norm = (v: number): number => Math.round(v * 1000) / 1000 + 0
  expect((actual as readonly number[]).map(norm)).toEqual(expected.map(norm))
}

/** 在零件包围盒中心打一条带世界锚点的注释（裸坐标，唯一会被变换影响的字段）。 */
const NOTE_AT_CENTER = `part0.addNote({ text: '基准孔', anchor: [20, 20, 10] })`

describe('translate — 裸坐标跟着走', () => {
  it('note.anchor 平移，且与原点的标注互不影响（数据未被改写）', async () => {
    const r = await exec(`
let part0 = cad.box(40, 40, 20)
${NOTE_AT_CENTER}
let part1 = cad.translate(part0, { offset: [100, 0, 0] })
`)
    expect(r.failedAt).toBeUndefined()
    // 原零件：标注留在原位（数据一个字节都没动）
    expectVec(noteAnchor(pmiOfPart(r, 'part0')), [20, 20, 10])
    // 产物：标注跟着走到新位置
    expectVec(noteAnchor(pmiOfPart(r, 'part1')), [120, 20, 10])
    // 对账：真实几何的包围盒中心确实是 +100
    expectVec(bboxCenter(r.outputs.get('part1' as never) as unknown as Shape), [120, 20, 10])
  })

  it('螺纹孔的 axis.origin 一起走（drill → translate 的老缺口）', async () => {
    const r = await exec(`
let part0 = cad.box(60, 40, 10)
part0 = cad.fai_drill(part0, { position: [30, 20, 10], direction: 'z', holeType: 'tapped', screwSpecIdx: 5, depth: 16, threadDepth: 14 })
let part1 = cad.translate(part0, { offset: [0, 0, 50] })
`)
    expect(r.failedAt).toBeUndefined()
    expectVec(holeAxis(pmiOfPart(r, 'part0'))?.origin, [30, 20, 10])
    expectVec(holeAxis(pmiOfPart(r, 'part1'))?.origin, [30, 20, 60])
  })

  it('连续平移按链累积（T3 ∘ T2 ∘ T1）', async () => {
    const r = await exec(`
let part0 = cad.box(40, 40, 20)
${NOTE_AT_CENTER}
let part1 = cad.translate(part0, { offset: [100, 0, 0] })
let part2 = cad.translate(part1, { offset: [0, 60, 0] })
let part3 = cad.translate(part2, { offset: [0, 0, 5] })
`)
    expect(r.failedAt).toBeUndefined()
    expectVec(noteAnchor(pmiOfPart(r, 'part3')), [120, 80, 15])
    expectVec(bboxCenter(r.outputs.get('part3' as never) as unknown as Shape), [120, 80, 15])
  })

  it('平移之后新写的标注不被再次变换', async () => {
    const r = await exec(`
let part0 = cad.box(40, 40, 20)
${NOTE_AT_CENTER}
let part1 = cad.translate(part0, { offset: [100, 0, 0] })
part1.addNote({ text: '已平移', anchor: [140, 20, 10] })
`)
    expect(r.failedAt).toBeUndefined()
    const items = pmiOfPart(r, 'part1')
    const anchors = items.filter((i): i is PmiNote => i.kind === 'note').map((n) => n.anchor)
    // 祖先那条被平移（[20,20,10] → [120,20,10]），本层那条原样保留 —— 顺序按时间
    expectVec(anchors[0], [120, 20, 10])
    expectVec(anchors[1], [140, 20, 10])
  })
})

describe('rotate_euler — 与内核同一套 Euler 约定', () => {
  it('绕 Z 转 90°，标注落在旋转后的几何中心', async () => {
    const r = await exec(`
let part0 = cad.box(40, 40, 20)
${NOTE_AT_CENTER}
let part1 = cad.rotate_euler(part0, { angles: [0, 0, 90 * DEGREE] })
`)
    expect(r.failedAt).toBeUndefined()
    const rotated = bboxCenter(r.outputs.get('part1' as never) as unknown as Shape)
    // 几何对账：box 中心 [20,20,10] 绕 Z 转 90° → [-20,20,10]
    expectVec(rotated, [-20, 20, 10])
    // 标注与几何必须落在同一点（矩阵与内核转序不一致时这里会崩）
    expectVec(noteAnchor(pmiOfPart(r, 'part1')), rotated)
  })

  it('绕 X 转 90°，孔轴方向跟着转（方向按线性部分变换并归一化）', async () => {
    const r = await exec(`
let part0 = cad.box(60, 40, 20)
part0 = cad.fai_drill(part0, { position: [30, 20, 20], direction: 'z', holeType: 'tapped', screwSpecIdx: 5, depth: 16, threadDepth: 14 })
let part1 = cad.rotate_euler(part0, { angles: [90 * DEGREE, 0, 0] })
`)
    expect(r.failedAt).toBeUndefined()
    const axis = holeAxis(pmiOfPart(r, 'part1'))
    expectVec(axis?.origin, [30, -20, 20])
    // 孔轴 (0,0,-1) 绕 X 转 90° → (0,1,0)
    expectVec(axis?.direction, [0, 1, 0])
  })

  it('带 pivot 的旋转绕不动点，且与几何一致', async () => {
    const r = await exec(`
let part0 = cad.box(40, 40, 20)
${NOTE_AT_CENTER}
let part1 = cad.rotate_euler(part0, { angles: [0, 0, 90 * DEGREE], pivot: [20, 20, 10] })
`)
    expect(r.failedAt).toBeUndefined()
    const rotated = bboxCenter(r.outputs.get('part1' as never) as unknown as Shape)
    // 不动点就是 box 中心 → 几何中心不动
    expectVec(rotated, [20, 20, 10])
    expectVec(noteAnchor(pmiOfPart(r, 'part1')), rotated)
  })
})

describe('scale / scale3d — 不动点与方向归一化', () => {
  it('等比缩放：标注按 factor 拉开', async () => {
    const r = await exec(`
let part0 = cad.box(40, 40, 20)
${NOTE_AT_CENTER}
let part1 = cad.scale(part0, { factor: 2 })
`)
    expect(r.failedAt).toBeUndefined()
    expectVec(noteAnchor(pmiOfPart(r, 'part1')), [40, 40, 20])
    expectVec(bboxCenter(r.outputs.get('part1' as never) as unknown as Shape), [40, 40, 20])
  })

  it('指定不动点：点围绕 center 缩放', async () => {
    const r = await exec(`
let part0 = cad.box(40, 40, 20)
${NOTE_AT_CENTER}
let part1 = cad.scale(part0, { factor: 2, center: [20, 20, 10] })
`)
    expect(r.failedAt).toBeUndefined()
    // 不动点恰好是标注位置 → 标注不动
    expectVec(noteAnchor(pmiOfPart(r, 'part1')), [20, 20, 10])
  })

  it('非等比缩放后孔轴仍是单位向量', async () => {
    const r = await exec(`
let part0 = cad.box(60, 40, 20)
part0 = cad.fai_drill(part0, { position: [30, 20, 20], direction: 'z', holeType: 'tapped', screwSpecIdx: 5, depth: 16, threadDepth: 14 })
let part1 = cad.scale3d(part0, { factor: [2, 1, 3] })
`)
    expect(r.failedAt).toBeUndefined()
    const axis = holeAxis(pmiOfPart(r, 'part1'))
    expectVec(axis?.origin, [60, 20, 60])
    expectVec(axis?.direction, [0, 0, -1])
  })
})

describe('坐标系没变的 op 不做补偿', () => {
  it('union 之后标注坐标原样（布尔不改坐标系）', async () => {
    const r = await exec(`
let a = cad.box(40, 40, 20)
a.addNote({ text: '主体', anchor: [20, 20, 10] })
let b = cad.translate(cad.box(20, 20, 10), { offset: [100, 0, 0] })
let c = cad.union(a, b)
`)
    expect(r.failedAt).toBeUndefined()
    expectVec(noteAnchor(pmiOfPart(r, 'c')), [20, 20, 10])
  })
})

describe('渲染与数据一致', () => {
  it('平移后 projectView 的 viewBox 跟着标注走（标注在图内，不飞出去）', async () => {
    const r = await exec(`
let part0 = cad.box(40, 40, 20)
${NOTE_AT_CENTER}
let part1 = cad.translate(part0, { offset: [100, 0, 0] })
`)
    expect(r.failedAt).toBeUndefined()
    const shape = r.outputs.get('part1' as never) as unknown as Shape
    // 直接调渲染（不经过脚本：projectView 是只读查询）
    const { projectViewSvg } = await import('../../../src/api/view/view-projection')
    const out = projectViewSvg(shape, 'front')
    const vb = out.viewBox.split(/\s+/).map(Number)
    // 零件 x∈[100,140]，viewBox 必须落在这附近（若标注留在 x=20，minX 会被拉到个位数）
    expect(vb[0]).toBeGreaterThan(90)
  })
})

// ── #15 mirror（det=−1）——探针先行（实施首步先写 affine 探针测试，见 plan §4-5）──

describe('PmiAffine det=−1 探针（mirrorAffine 的矩阵性质）', () => {
  it('x=0 平面反射：det=−1，点按平面反射，方向反射后仍归一化', () => {
    const m = mirrorAffine([1, 0, 0])
    // det(R)：镜像翻转手性
    const det = m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!)
      - m[1]! * (m[4]! * m[10]! - m[6]! * m[8]!)
      + m[2]! * (m[4]! * m[9]! - m[5]! * m[8]!)
    expect(det).toBeCloseTo(-1, 9)
    expect(affineApplyPoint(m, [5, 1, 2])).toEqual([-5, 1, 2])
    // GOTCHA: 方向断言必须走 expectVec（归一化 `+0`）——反射矩阵的零元素是
    // −0（−2·n_i·n_j 的乘积），vitest 的 toEqual 按 Object.is 区分 ±0，
    // 直接 toEqual 会因 `[-1, -0, -0] !== [-1, 0, 0]` 假失败。
    expectVec(affineApplyDirection(m, [1, 0, 0]), [-1, 0, 0])
    expectVec(affineApplyDirection(m, [0, 1, 0]), [0, 1, 0])
  })

  it('带 at 的平面（x=3）：p=5 → 1（at − R·at 折进平移）', () => {
    const m = mirrorAffine([1, 0, 0], [3, 0, 0])
    expect(affineApplyPoint(m, [5, 0, 0])).toEqual([1, 0, 0])
    // 平面上的点不动
    expect(affineApplyPoint(m, [3, 7, -2])).toEqual([3, 7, -2])
  })

  it('反射是就对合：composeAffine(m, m) === I（det=−1 的合成不炸）', () => {
    const m = mirrorAffine([2, 0, 0], [1, 1, 1]) // 非单位法向（内部归一化）
    const twice = composeAffine(m, m)
    for (let i = 0; i < 12; i += 1) {
      expect(twice[i]).toBeCloseTo(PMI_AFFINE_IDENTITY[i], 9)
    }
  })

  it('remapPmiItem 在 det=−1 下搬 threadHole 轴（origin 反射、方向反射）', () => {
    const m = mirrorAffine([1, 0, 0])
    const item: PmiItem = {
      kind: 'threadHole',
      thread: {
        standard: 'metric', nominalDiameter: 6, pitch: 1, depth: 10, specLabel: 'M6',
      },
      pilot: { diameter: 5, depth: 10 },
      axis: { origin: [30, 20, 10], direction: [0, 0, -1] },
      process: 'tapped',
    }
    const remapped = remapPmiItem(item, m) as PmiThreadHole
    expect(remapped.axis.origin).toEqual([-30, 20, 10])
    expect(remapped.axis.direction).toEqual([0, 0, -1])
  })

  it('零法向 → 抛错（finalizePmi 捕获后不登记，不中断建模）', () => {
    expect(() => mirrorAffine([0, 0, 0])).toThrow(/non-zero/)
  })
})

describe('mirror — det=−1 镜像补偿（#15）', () => {
  it('note.anchor 随镜像平面反射，与真实几何对账', async () => {
    const r = await exec(`
let part0 = cad.box(40, 40, 20)
${NOTE_AT_CENTER}
let part1 = cad.mirror(part0, { normal: [1, 0, 0], at: [10, 0, 0] })
`)
    expect(r.failedAt).toBeUndefined()
    // box 中心 [20,20,10] 跨 x=10 镜像 → [0,20,10]
    expectVec(bboxCenter(r.outputs.get('part1' as never) as unknown as Shape), [0, 20, 10])
    expectVec(noteAnchor(pmiOfPart(r, 'part1')), [0, 20, 10])
    // 数据零改动：原零件标注留在原位
    expectVec(noteAnchor(pmiOfPart(r, 'part0')), [20, 20, 10])
  })

  it('缺省镜像面（x=0，无 options 对象）：补偿也要登记（lastParamsOf ?? {} 回退）', async () => {
    const r = await exec(`
let part0 = cad.box(40, 40, 20)
${NOTE_AT_CENTER}
let part1 = cad.mirror(part0)
`)
    expect(r.failedAt).toBeUndefined()
    expectVec(bboxCenter(r.outputs.get('part1' as never) as unknown as Shape), [-20, 20, 10])
    expectVec(noteAnchor(pmiOfPart(r, 'part1')), [-20, 20, 10])
  })

  it('螺纹孔 axis（origin + direction）随镜像反射', async () => {
    const r = await exec(`
let part0 = cad.box(60, 40, 10)
part0 = cad.fai_drill(part0, { position: [30, 20, 10], direction: 'z', holeType: 'tapped', screwSpecIdx: 5, depth: 16, threadDepth: 14 })
let part1 = cad.mirror(part0, { normal: [1, 0, 0] })
`)
    expect(r.failedAt).toBeUndefined()
    const axis = holeAxis(pmiOfPart(r, 'part1'))
    expectVec(axis?.origin, [-30, 20, 10])
    // 孔轴 (0,0,-1) 跨 x=0 镜像：z 分量不受影响
    expectVec(axis?.direction, [0, 0, -1])
  })

  it('镜像 ∘ 平移链式累积（composeAffine 跨 det=±1）', async () => {
    const r = await exec(`
let part0 = cad.box(40, 40, 20)
${NOTE_AT_CENTER}
let part1 = cad.translate(part0, { offset: [10, 0, 0] })
let part2 = cad.mirror(part1, { normal: [1, 0, 0] })
`)
    expect(r.failedAt).toBeUndefined()
    // [20,20,10] --+10--> [30,20,10] --镜像 x=0--> [-30,20,10]
    expectVec(noteAnchor(pmiOfPart(r, 'part2')), [-30, 20, 10])
    expectVec(bboxCenter(r.outputs.get('part2' as never) as unknown as Shape), [-30, 20, 10])
  })
})
