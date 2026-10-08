/**
 * @vitest-environment node
 *
 * occt **原生** `gp_GTrsf` 路径污染**已缓存三角化**的缺陷刻画（2026-10-07）。
 *
 * ── 缺陷是什么 ──
 *
 * `kernel.generalTransform`（L1 名）→ occt 原生 `generalTransform` → `gp_GTrsf`。
 * 一条 `gp_Trsf` 装不下的矩阵，OCCT 不能只把变换乘进形状的 `TopLoc_Location`，
 * 必须**重建形状**（改几何、造新面、把旧三角化搬过去）。重建这一步会给形状多留一份
 * 定位信息，于是那份**已缓存**的三角化被读回时定位被计入两次：
 *
 *   - 顶盖的 z 偏移**不记在几何里**，而是一条 `TopLoc_Location`（`tz = 挤出高度`，
 *     `toBREP` 的 `Locations` 段可见，原始棱柱恰好 1 条）；
 *   - 精确几何**全程正确**（曲面确实被变换过去了）；错的只有缓存网格 → 顶盖飘到 2h。
 *
 * 前置条件只有一个：**输入形状已带缓存三角化**。而 faijs 里这是常态——
 * `src/brep/brep-ops.ts#solidToShape` 对每个 BREP op 结果都调 `kernel.meshShape`，
 * 所以 `cad.extrude` 的产物天然带缓存。
 *
 * ── 本文件为什么必须存在（不许删）──
 *
 * 这些断言曾经是三个跑完即删的临时探针，导致每次被问到就得重写一遍、且结论在仓库里
 * 无凭据。现在它们是**可重复跑、可独立验证**的测试：每条"当前错误值"旁边都并排放着
 * 应有正确值（走 L1 面 = 已修好的那条路），两者一起才说明问题在哪一层。
 *
 * ── 本文件是**金丝雀**：occt-wasm 修好这个缺陷时它会红 ──
 *
 * 标了 `← 当前错误值` 的断言失败，正是"该重新评估 occt 适配层那个 `copy` 绕过
 * 是否还需要"的信号，不是回归。届时：
 *   1. 把那些断言翻转为应有的正确值（每个错误值旁边都写了该翻成多少）；
 *   2. 删掉 `src/occt-kernel/occt-primitives.ts#generalTransform` 里的 `copy` 绕过；
 *   3. 本文件的标题与说明同步改写。
 *
 * ── 边界（对外表述必须守住）──
 *
 * 已确认：缺陷在「occt 原生 GTrsf 路径 × 已三角化输入」这个组合上；brepkit 无此问题
 * （它的 `generalTransform` 是 `cloneAndTransform`，先克隆再仿射，不存在"搬旧缓存 +
 * 留位置"这个配对）；`transform` / `located` 路径无此问题。
 * **未**下钻 wasm/C++，未区分责任落在三角化搬迁还是 `BRepTransform` 自身。
 *
 * 语料与量尺在 `test/support/affine-fixtures.ts`（与
 * `test/brep/applymatrix-similarity-routing.test.ts` 共用同一份实现）。
 *
 * 运行：npx vitest run packages/core/test/brep/occt-gtrsf-tessellation-gotcha.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepEngine } from '../../src/brep/engine/registry'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import {
  IDENTITY,
  ROT_Z60_TRUNCATED,
  ROT_Z60_TZ2,
  exactZRange,
  extrudedPrism,
  extrudedPrismWithHole,
  locationEntryCount,
  meshZRange,
  triangulatedZRange,
  zHistogram,
  type MeasureFace,
} from '../support/affine-fixtures'

/** occt 原生面：量尺 + 这个缺陷要用到的方言方法（`copy` 而非 L1 的 `copyShape`）。 */
interface NativeOcctFace extends MeasureFace {
  generalTransform(shape: unknown, matrix: number[]): unknown
  copy(shape: unknown): unknown
  hasTriangulation(shape: unknown): boolean
  toBREP(shape: unknown): string
}

let k: BrepEngineApi
let native: NativeOcctFace

beforeAll(async () => {
  await registerOcctBrepEngine()
  const brep = await getBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepEngineId: 'occt' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
  k = getBrepApi()
  // 原生面 = 未经 L1 适配的对象字面量。句柄在两层之间是同一个数字 id
  // （`asHandle`/`asShape` 都是零开销 cast），故可直接拿 L1 造的句柄喂它。
  native = (await initOcctWasm()) as unknown as NativeOcctFace
}, 120_000)

describe('① 三角化是缓存在形状上的', () => {
  it('刚挤出的形状没有三角化，量过一次就被写回', () => {
    const p = extrudedPrism(k, 5)
    expect(native.hasTriangulation(p)).toBe(false)
    meshZRange(native, p) // 量一次 = meshShape，会把三角化写回形状
    expect(native.hasTriangulation(p)).toBe(true)
  })

  it('生产路径必中：BREP op 结果的显示网格由 solidToShape 预先三角化', () => {
    // 不调 solidToShape（它在 brep-ops 内部），直接验证「挤出 → 量一次 → 已有缓存」
    // 这条链；`src/brep/brep-ops.ts#solidToShape` 里就是 kernel.meshShape。
    const p = extrudedPrismWithHole(k)
    meshZRange(native, p)
    expect(native.hasTriangulation(p)).toBe(true)
  })
})

describe('② 前置条件：输入未预 mesh 时不触发', () => {
  it('同一矩阵、同一路径，只要输入没有缓存三角化就完全干净', () => {
    const p = extrudedPrism(k, 5)
    expect(native.hasTriangulation(p)).toBe(false)

    const out = native.generalTransform(p, ROT_Z60_TRUNCATED)
    // 应有正确值：精确 5、网格 5（两条读数一致）
    expect(exactZRange(native, out)[1]).toBeCloseTo(5, 4)
    expect(meshZRange(native, out)[1]).toBeCloseTo(5, 4)
  })
})

describe('③ 现状：输入已预 mesh → 网格顶盖翻倍', () => {
  it('精确顶盖 5、网格顶盖 10（挤出高度 5 被多计一次）', () => {
    const p = extrudedPrism(k, 5)
    meshZRange(native, p) // 预 mesh —— 生产里的常态
    const out = native.generalTransform(p, ROT_Z60_TRUNCATED)

    const [exactMin, exactMax] = exactZRange(native, out)
    const [meshMin, meshMax] = meshZRange(native, out)
    expect(exactMin).toBeCloseTo(0, 4)
    expect(exactMax).toBeCloseTo(5, 4) // 应有正确值
    expect(meshMin).toBeCloseTo(0, 4) // 底面（无 TopLoc）不受影响
    expect(meshMax).toBeCloseTo(10, 4) // ← 当前错误值，修好后应为 5
  })
})

describe('④ 与矩阵数值无关：恒等矩阵同样污染', () => {
  it('矩阵是恒等的也照样坏 ⇒ 缺陷在"重建形状"这一步，不在变换数学', () => {
    const p = extrudedPrism(k, 5)
    meshZRange(native, p)
    const out = native.generalTransform(p, IDENTITY)

    expect(exactZRange(native, out)[1]).toBeCloseTo(5, 4) // 应有正确值
    expect(meshZRange(native, out)[1]).toBeCloseTo(10, 4) // ← 当前错误值，修好后应为 5
  })
})

describe('⑤ 污染量 = 顶盖自身的 z 偏移', () => {
  it('挤出高度 3 / 5 / 10 → 网格顶盖 6 / 10 / 20（恒为 2h）', () => {
    for (const h of [3, 5, 10]) {
      const p = extrudedPrism(k, h)
      meshZRange(native, p)
      const out = native.generalTransform(p, ROT_Z60_TRUNCATED)

      expect(exactZRange(native, out)[1]).toBeCloseTo(h, 4) // 应有正确值
      expect(meshZRange(native, out)[1]).toBeCloseTo(2 * h, 4) // ← 当前错误值，修好后应为 h
    }
  })
})

describe('⑥ 平移与旋转叠加：多计的是"顶盖原本的位置"', () => {
  it('旋转 + tz2 → 精确 7、网格 12（= 7 + 顶盖原本的 5，而不是 7 + 7）', () => {
    const p = extrudedPrism(k, 5)
    meshZRange(native, p)
    const out = native.generalTransform(p, ROT_Z60_TZ2)

    expect(exactZRange(native, out)[1]).toBeCloseTo(7, 4) // 应有正确值
    expect(meshZRange(native, out)[1]).toBeCloseTo(12, 4) // ← 当前错误值，修好后应为 7
  })
})

describe('⑦ 只有顶盖顶点被位移：网格在顶缘被撕开', () => {
  /**
   * 若缺陷是"整体多变换一次"，所有顶点都会位移；实测只有顶盖自己的顶点位移，
   * 侧面与底面纹丝不动 —— 实体网格在顶缘裂开，顶盖悬在半空。
   *
   * 顶点数是几何事实：方框带方孔的顶盖 = 4 外角 + 4 内角 = 8；无孔方形顶盖 = 4。
   * 侧面 4 面各 2 个顶点在顶缘、2 个在底缘。
   */
  const CASES = [
    { label: '带孔', make: () => extrudedPrismWithHole(k), capVerts: 8, sidesTop: 16, z0: 24 },
    { label: '无孔', make: () => extrudedPrism(k, 5), capVerts: 4, sidesTop: 8, z0: 12 },
  ]

  for (const c of CASES) {
    it(`${c.label}：z=0 的 ${c.z0} 个不动、侧面的 ${c.sidesTop} 个不动、顶盖的 ${c.capVerts} 个飘到 2h`, () => {
      const p = c.make()
      const before = zHistogram(native, p)
      expect(before.get(0)).toBe(c.z0)
      expect(before.get(5)).toBe(c.sidesTop + c.capVerts) // 顶盖与侧面顶缘同处 z=5

      const out = native.generalTransform(p, ROT_Z60_TRUNCATED)
      const after = zHistogram(native, out)
      expect(after.get(0)).toBe(c.z0) // 底面 + 侧面底缘：不动
      expect(after.get(5)).toBe(c.sidesTop) // 侧面顶缘：不动
      expect(after.get(10)).toBe(c.capVerts) // ← 当前错误值：只有顶盖顶点，修好后应为 0
    })
  }
})

describe('⑧ 精确 bbox 与缓存三角化无关', () => {
  it('同一形状两种量法给出两个答案 ⇒ 错的是存下来的那份三角化', () => {
    const p = extrudedPrism(k, 5)
    meshZRange(native, p)
    const out = native.generalTransform(p, ROT_Z60_TRUNCATED)

    expect(exactZRange(native, out)[1]).toBeCloseTo(5, 4) // 精确（BRepBndLib::AddOptimal）
    expect(triangulatedZRange(native, out)[1]).toBeCloseTo(10, 4) // ← 当前错误值，修好后应为 5
  })
})

describe('⑨ L1 面同一调用是干净的（适配层 copy 绕过生效）', () => {
  it('结果不带缓存三角化，网格与精确都是 5', () => {
    const p = extrudedPrismWithHole(k)
    meshZRange(native, p)

    const l1Out = k.generalTransform(p, ROT_Z60_TRUNCATED)
    // 绕过 = 先 BRepBuilderAPI_Copy（copyMesh=false 会丢缓存）再变换
    expect(native.hasTriangulation(l1Out)).toBe(false)
    expect(exactZRange(k, l1Out)[1]).toBeCloseTo(5, 4) // 应有正确值
    expect(meshZRange(k, l1Out)[1]).toBeCloseTo(5, 4) // 应有正确值
  })
})

describe('⑩ 污染只活在缓存里：再 copy 一次即复原', () => {
  it('对已污染的句柄 copy → 网格回到 5（几何从未坏过）', () => {
    const p = extrudedPrismWithHole(k)
    meshZRange(native, p)
    const bad = native.generalTransform(p, ROT_Z60_TRUNCATED)
    expect(meshZRange(native, bad)[1]).toBeCloseTo(10, 4) // ← 当前错误值，修好后应为 5

    // 不断言 `hasTriangulation(revived)`：copy 是否保留三角化随 fixture 而异，
    // 但无论保留与否，网格都回到正确值（保留时是按正确几何重算的）。
    const revived = native.copy(bad)
    expect(exactZRange(native, revived)[1]).toBeCloseTo(5, 4)
    expect(meshZRange(native, revived)[1]).toBeCloseTo(5, 4)
  })
})

describe('⑪ 结构证据：重建形状会多出一条 TopLoc', () => {
  it('原始棱柱的 Locations 恰好一条（顶盖的 z 偏移），重建后变多', () => {
    // 顶盖的 z 偏移不记在几何里，而是一条 TopLoc（BREP 原文 `Locations 1` + tz=h）。
    const plain = extrudedPrism(k, 5)
    const withHole = extrudedPrismWithHole(k)
    expect(locationEntryCount(native, plain)).toBe(1)
    expect(locationEntryCount(native, withHole)).toBe(1)

    // 重建后定位条目变多 ⇒ 顶盖的定位信息在结果里出现两份，读回三角化时叠加两次。
    // 断言用「变多」而非钉死具体条数：要的是这个不变量，不是某个 fixture 的基线数字。
    const out = native.generalTransform(plain, ROT_Z60_TRUNCATED)
    expect(locationEntryCount(native, out)).toBeGreaterThan(locationEntryCount(native, plain))
  })
})
