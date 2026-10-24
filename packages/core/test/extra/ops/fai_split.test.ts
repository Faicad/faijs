/**
 * ops/fai_split — op 层（脚本面）分离参数测试。
 *
 * 与 `test/extra/mesh/fai_split.basis.test.ts` 的分工：basis 测内部统一入口
 * `splitWithParams`；本文件测**脚本面 op `fai_split` 本身** —— 校验 op 层接住
 * params → V 的换算，以及「两端都不传 ⇒ 不分开」这条对外契约确实成立。
 *
 * 走 mesh 分支（manifold CSG），不需要 BREP 内核。
 */
import { describe, it, expect } from 'vitest'
import { fai_split } from '../../../src/extra/ops/fai_split'
import { configureBackends, CONTRACT_VERSION } from '../../../src/runtime-state'
import { geoToManifoldMesh } from '@faicad/faijs/boolean/csg-backend'
import { boxGeometry } from '@faicad/faijs/mesh/meshdata/parametric'
import type { Shape, Vec3 } from '@faicad/faijs/mesh/types'

/**
 * op 层走 mesh 分支需要宿主装配后端（没有它 `dispatchPath` 抛
 * `backends not configured`）。这里给最小 mesh-only 配置：不带 BREP 内核，
 * 用 `mode:'mesh'` 强制走 mesh 实现。
 */
configureBackends({
  contractVersion: CONTRACT_VERSION,
  config: { mode: 'mesh' },
  kernel: { brep: undefined, csg: undefined, sdf: undefined },
  fonts: undefined,
  texture: undefined,
  assets: undefined,
  events: { emit: () => undefined },
} as unknown as Parameters<typeof configureBackends>[0])

/** 边长 2 的单位盒（z∈[-1,1]），紧凑 enough for a fast manifold split. */
function unitBox(): Shape {
  return geoToManifoldMesh(boxGeometry(2, 2, 2))
}

/** z 轴上的极值（用于判定 HALF 是否被平移）。 */
function zExtent(p: Float32Array): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (let i = 2; i < p.length; i += 3) {
    min = Math.min(min, p[i])
    max = Math.max(max, p[i])
  }
  return { min, max }
}

describe('fai_split — separation params at the script face (mesh branch)', () => {
  it('neither param given ⇒ the halves stay put (no implicit explode)', async () => {
    // 2026-10-24 起 faijs 不再替宿主决定要拉开：不传就是不动。
    // 这是本次变更的核心不变量 —— 旧行为是默认 true（bbox 对角线 2%）。
    const box = unitBox()
    // op 层（defineOp 产物）：不传分离参数 = 不动。
    const { front, back } = (await fai_split(box, {
      cutMode: 'plane',
      normal: [0, 0, 1],
      offset: 0,
    })) as unknown as Record<string, Shape>

    const f = zExtent(front.positions)
    const b = zExtent(back.positions)
    // Box z∈[-1,1]，在 z=0 切开 → front z∈[0,1]，back z∈[-1,0]，切面处紧贴。
    expect(f.min).toBeCloseTo(0, 4)
    expect(b.max).toBeCloseTo(0, 4)
  })

  it('separationRatio + separation ⇒ both halves move ±V along the normal', async () => {
    const diag = Math.sqrt(2 * 2 + 2 * 2 + 2 * 2)
    const expected = diag * 0.02 + 1

    const { front, back } = (await fai_split(unitBox(), {
      cutMode: 'plane',
      normal: [0, 0, 1],
      offset: 0,
      separationRatio: 0.02,
      separation: 1,
    })) as unknown as Record<string, Shape>

    const f = zExtent(front.positions)
    const b = zExtent(back.positions)
    expect(f.min).toBeCloseTo(expected, 4)
    expect(b.max).toBeCloseTo(-expected, 4)
  })

  it('the new params reproduce the pre-change default exactly', async () => {
    // 「效果一致」：旧默认 V = 对角线×2% + 半个榫卯深度；宿主如今显式传同样的量。
    const box = unitBox()
    const diag = Math.sqrt(2 * 2 + 2 * 2 + 2 * 2)
    const jointDepth = 4
    const oldV = diag * 0.02 + jointDepth / 2

    const { front } = (await fai_split(box, {
      cutMode: 'plane',
      normal: [0, 0, 1],
      offset: 0,
      separationRatio: 0.02,
      separation: jointDepth / 2,
    })) as unknown as Record<string, Shape>
    expect(zExtent(front.positions).min).toBeCloseTo(oldV, 4)
  })
})

describe('fai_split — inPlaneAngle (script key) reaches the geometry', () => {
  /**
   * 2026-10-24 修的 bug：宿主（3d_editor web）曾发射 `inPlaneAngleDeg`，而本 op
   * 读 `inPlaneAngle` —— 键名断裂使面内旋转 RZ 静默丢失（恒 0）。faijs 侧键名
   * 是唯一契约（JSDoc/paramDims/ops-dim-decl 三处钉住），本 describe 守住**另
   * 一半：脚本面这个键确实被读进去并改变了几何**。basis 的纯数学覆盖在
   * fai_split.basis.test.ts（含 rz=45/90/120），那里管不了键名接线。
   *
   * 榫卯模式才消费 basis（plane 模式的切面与面内角无关），所以用 dovetail；
   * 截面必须**非方形**（4×2），否则 rz=0 与 rz=90 的槽向不同但挖掉的料相同。
   * 参数经探针实证：三角数在两种取向下相同（20/24），只有逐字节比 positions
   * 才能区分 —— 数三角形数是抓不到这个键的。
   */
  function wideBox(): Shape {
    // x∈[-2,2], y∈[-1,1], z∈[-1,1]
    return geoToManifoldMesh(boxGeometry(4, 2, 2))
  }

  /** op 层是扁平参数（grooveDepth/…），不是内部入口的嵌套 groove 对象。 */
  const dovetailParams = {
    cutMode: 'dovetail',
    normal: [0, 0, 1] as Vec3,
    offset: 0,
    bbCenter: [0, 0, 0] as Vec3,
    bboxSize: [4, 2, 2] as Vec3,
    grooveDepth: 1,
    grooveDepthTolerance: 0.1,
    grooveWidth: 2,
    grooveWidthTolerance: 0.1,
    grooveFlapsAngle: 10,
  }

  /** 两次运行的 positions 是否逐字节相同（CSG 对同输入确定性输出）。 */
  function sameGeometry(a: Shape, b: Shape): boolean {
    if (a.positions.length !== b.positions.length) return false
    for (let i = 0; i < a.positions.length; i++) {
      if (a.positions[i] !== b.positions[i]) return false
    }
    return true
  }

  async function splitAt(angle: number | undefined): Promise<Record<string, Shape>> {
    const params: Record<string, unknown> = { ...dovetailParams }
    if (angle !== undefined) params.inPlaneAngle = angle
    return (await fai_split(wideBox(), params)) as unknown as Record<string, Shape>
  }

  it('omitting inPlaneAngle == explicit 0 (default)', async () => {
    const omitted = await splitAt(undefined)
    const zero = await splitAt(0)
    expect(sameGeometry(omitted.front, zero.front)).toBe(true)
    expect(sameGeometry(omitted.back, zero.back)).toBe(true)
  })

  it('inPlaneAngle: 90 cuts a differently-oriented groove than 0', async () => {
    // 键名一旦断裂（op 读不到这个键），两个结果会逐字节相同 —— 这条断言红。
    const at0 = await splitAt(0)
    const at90 = await splitAt(90)
    expect(sameGeometry(at0.front, at90.front)).toBe(false)
    expect(sameGeometry(at0.back, at90.back)).toBe(false)
  })
})
