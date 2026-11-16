/**
 * @vitest-environment node
 *
 * 带孔截面（空心管）沿脊柱扫掠的长期验收 + 事实钉桩（P0，2026-11-16）
 *
 * 背景（源码事实，2026-11-16 读）：
 * - kernel `pipe(face)` 原生吃带孔 face，不丢内腔（probe-case8-pipe-gap.ts P2 实测 9613.27）；
 * - kernel `sweepPipeShell(face)` 拒绝 face（"bad shape type of section"），只吃 wire；
 * - `sweepAdvanced` 经 `toProfileWireView` 把 face 降级为**外环 wire** ⇒ 带孔截面丢内腔。
 *
 * 本文件钉住两值：
 * - 当前错误值：sweepRaw(带孔face, 脊柱) 只扫出外环实心棒；
 * - 期望正确值：一次调用产出净体积 = (外环面积 − 内环面积) × 脊柱长度的空心管。
 *
 * Run: npx vitest run test/api/sweep-hollow-pipe.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import type { Shape } from '../../src/mesh/types'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'
import { sweep } from '../../src/api/sweep'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function useOcct(): Promise<void> {
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
}

function exec(mode: ExecutionMode, code: string): Promise<ExecutionResult> {
  return new CadRuntime(ports(), mode, { cad: createApiNamespaceWithEditorOps() }).execute(code)
}

async function shapeOf(mode: ExecutionMode, code: string, part: string): Promise<Shape> {
  const result = await exec(mode, code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const s = result.outputs.get(asPartName(part))
  if (!s) throw new Error(`no output for ${part}`)
  return s as Shape
}

function volumeOf(s: Shape): number {
  return getBrepApi().getVolume(brepOf(s) as never)
}

/** 实心圆面 sketch 脚本（cad.sketch 的 circle shape）。 */
const discFace = (r: number, tag: string): string =>
  `cad.sketch({ plane: 'XY', shapes: [{ kind: 'circle', r: ${r}, cx: 0, cy: 0, tag: '${tag}' }], constraints: [] })`

/** 带孔圆面 sketch 脚本（外圆 + mode:'s' 内圆）。 */
const annulusFace = (rOut: number, rIn: number, tag: string): string =>
  `cad.sketch({ plane: 'XY', shapes: [` +
  `{ kind: 'circle', r: ${rOut}, cx: 0, cy: 0, tag: '${tag}o' },` +
  `{ kind: 'circle', r: ${rIn}, cx: 0, cy: 0, tag: '${tag}i', mode: 's' }], constraints: [] })`

describe('sweepAlong · 一次调用出多段（空心）管', () => {
  const R = 36.35
  /** case8 的 U 形中心线：长腿 90 + 底部 180° 弯 R36.35 + 短腿 51.35。 */
  const U_SPINE =
    `let e1 = cad.edge([${-R},0,90],[${-R},0,0])\n` +
    `let e2 = cad.circleArc([0,0,0],[0,-1,0],${R},-90*DEGREE,90*DEGREE)\n` +
    `let e3 = cad.edge([${R},0,0],[${R},0,51.35])\n` +
    `let spine = cad.wireFromEdges([e1,e2,e3])\n`
  const U_LEN = 90 + Math.PI * R + 51.35

  it('G0. 逐段隔离：每段单独 sweepAlong 的体积必须精确（= 面积 × 段长）', async () => {
    await useOcct()
    const r = 6
    const area = Math.PI * r * r
    const segs: [string, number][] = [
      ['e1', 90],
      ['e2', Math.PI * R],
      ['e3', 51.35],
    ]
    for (const [name, len] of segs) {
      const s = await shapeOf(
        'brep',
        `let sec = ${discFace(r, 'sec')}\n` + U_SPINE + `let part2 = cad.sweep(sec, cad.wireFromEdges([${name}]))\n`,
        'part2',
      )
      const v = volumeOf(s)
      expect(v).toBeCloseTo(area * len, -1)
    }
  })

  it('G0b. 三段 sweepAlong 后 union → 体积等于三段之和（相邻段共面接缝不丢料）', async () => {
    await useOcct()
    const r = 6
    const area = Math.PI * r * r
    const s = await shapeOf(
      'brep',
      `let sec = ${discFace(r, 'sec')}\n` + U_SPINE +
        `let s1 = cad.sweep(sec, cad.wireFromEdges([e1]))\n` +
        `let s2 = cad.sweep(sec, cad.wireFromEdges([e2]))\n` +
        `let s3 = cad.sweep(sec, cad.wireFromEdges([e3]))\n` +
        `let part2 = cad.union(s1, s2, s3)\n`,
      'part2',
    )
    const expected = area * U_LEN
    const v = volumeOf(s)
    // GOTCHA：曾因 circleArc 的 0° 指向 -Z（不是 +X）把弧摆错 90°，弧与直腿在 x=R 处
    // 相交，union 吃掉重叠、体积少 7.25%（26806 vs 28901）。弧位置正确后精确相等。
    expect(Math.abs(v - expected)).toBeLessThan(expected * 0.002)
  })

  it('G0c. 成对 union（相邻 / 不相交）体积均等于两段之和', async () => {
    await useOcct()
    const r = 6
    const area = Math.PI * r * r
    const cases: [string, string, number][] = [
      ['e1e2', 'cad.union(s1, s2)', area * (90 + Math.PI * R)],
      ['e2e3', 'cad.union(s2, s3)', area * (Math.PI * R + 51.35)],
      ['e1e3', 'cad.union(s1, s3)', area * (90 + 51.35)],
    ]
    for (const [_caseName, expr, expected] of cases) {
      const s = await shapeOf(
        'brep',
        `let sec = ${discFace(r, 'sec')}\n` + U_SPINE +
          `let s1 = cad.sweep(sec, cad.wireFromEdges([e1]))\n` +
          `let s2 = cad.sweep(sec, cad.wireFromEdges([e2]))\n` +
          `let s3 = cad.sweep(sec, cad.wireFromEdges([e3]))\n` +
          `let part2 = ${expr}\n`,
        'part2',
      )
      const v = volumeOf(s)
      expect(Math.abs(v - expected)).toBeLessThan(expected * 0.002)
    }
  })

  // GOTCHA：`cad.circleArc(center, axis, r, a0, a1)` 的角度基准不是「+X 起、逆时针」。
  // axis=(0,-1,0) 时实测 0° 指向 -Z、90° 指向 +X（u=-Z, v=+X）。写 U 形底弯若按
  // 「0°→180°」会把弧摆成 (0,0,-R)→(0,0,+R) 向 +X 鼓，与直腿在 x=R 处相交 —— 正是
  // case8 最初少 7.25% 体积的原因。这里钉住真实约定，防止后人重踩。
  it('G0e. circleArc 角度基准（GOTCHA）：axis -Y 时 -90°→90° 才是 (-R,0,0)→(R,0,0)', async () => {
    await useOcct()
    const result = await exec(
      'brep',
      `let part2 = cad.circleArc([0,0,0],[0,-1,0],${R},-90*DEGREE,90*DEGREE)\n`,
    )
    expect(result.failedAt).toBeFalsy()
    const api = getBrepApi() as unknown as {
      curveParameters: (e: unknown) => { first: number; last: number }
      curvePointAtParam: (e: unknown, p: number) => { x: number; y: number; z: number }
      curveTangent: (e: unknown, p: number) => { x: number; y: number; z: number }
    }
    const h = brepOf(result.outputs.get(asPartName('part2')) as Shape) as never
    const pr = api.curveParameters(h)
    const p0 = api.curvePointAtParam(h, pr.first)
    const p1 = api.curvePointAtParam(h, pr.last)
    const t0 = api.curveTangent(h, pr.first)
    const t1 = api.curveTangent(h, pr.last)
    // 起点 (-R,0,0)、终点 (R,0,0)，两端切向竖直（∓Z）
    expect(p0.x).toBeCloseTo(-R, 2)
    expect(p0.z).toBeCloseTo(0, 2)
    expect(p1.x).toBeCloseTo(R, 2)
    expect(p1.z).toBeCloseTo(0, 2)
    expect(Math.abs(t0.z)).toBeCloseTo(1, 2)
    expect(Math.abs(t1.z)).toBeCloseTo(1, 2)
  }, 60000)

  it('G1. 实心圆截面沿 U 形三段中心线 → 一次调用，体积 = 面积 × 总长', async () => {
    await useOcct()
    const r = 6
    const s = await shapeOf(
      'brep',
      `let sec = ${discFace(r, 'sec')}\n` + U_SPINE + `let part2 = cad.sweep(sec, spine)\n`,
      'part2',
    )
    const expected = Math.PI * r * r * U_LEN
    const v = volumeOf(s)
    expect(Math.abs(v - expected)).toBeLessThan(expected * 0.02)
  })

  it('G2. 带孔截面（Ø17.3/Ø13.3）沿 U 形 → 一次调用出空心管', async () => {
    await useOcct()
    const rOut = 8.65
    const rIn = 6.65
    const s = await shapeOf(
      'brep',
      `let sec = ${annulusFace(rOut, rIn, 'sec')}\n` + U_SPINE + `let part2 = cad.sweep(sec, spine)\n`,
      'part2',
    )
    const expected = Math.PI * (rOut * rOut - rIn * rIn) * U_LEN
    const v = volumeOf(s)
    expect(Math.abs(v - expected)).toBeLessThan(expected * 0.02)
    // 必须是空心：明显小于同外径实心棒
    expect(v).toBeLessThan(Math.PI * rOut * rOut * U_LEN * 0.8)
  })

  it('G4. case8 三维路径（U 弯 + 长腿顶端转出平面 + 横管）带孔截面 → 一次调用，bbox 90×95×180', async () => {
    await useOcct()
    const rOut = 8.65
    const rIn = 6.65
    // 与 case8/run/part-along.fai.js 同一中心线：短腿 → 180° 弯 → 长腿 → 转出弧 → 横管
    const spine3d =
      `let c1 = cad.edge([${R},0,51.35],[${R},0,0])\n` +
      `let c2 = cad.tangentArc([${R},0,0],[0,0,-1],[${-R},0,0])\n` +
      `let c3 = cad.edge([${-R},0,0],[${-R},0,90])\n` +
      `let c4 = cad.tangentArc([${-R},0,90],[0,0,1],[${-R},${R},${90 + R}])\n` +
      `let c5 = cad.edge([${-R},${R},${90 + R}],[${-R},${R + 50},${90 + R}])\n` +
      `let spine = cad.wireFromEdges([c1,c2,c3,c4,c5])\n`
    const s = await shapeOf(
      'brep',
      `let sec = ${annulusFace(rOut, rIn, 'sec')}\n` + spine3d + `let part2 = cad.sweep(sec, spine)\n`,
      'part2',
    )
    const h = brepOf(s) as never
    const api = getBrepApi()
    const box = api.getBoundingBox(h)
    const size = [box.xmax - box.xmin, box.ymax - box.ymin, box.zmax - box.zmin]
    // 与五段 union 版（case8/run/part.stl）逐项一致：90 × 95 × 180、体积 34841.61
    expect(size[0]).toBeCloseTo(90, 1)
    expect(size[1]).toBeCloseTo(95, 1)
    expect(size[2]).toBeCloseTo(180, 1)
    // 解析值 = 净面积 × 总长（51.35 + πR + 90 + πR/2 + 50 = 362.644，净面积 96.1327）
    // = 34863.9；实测 34862.09（差 0.005%，来自 union 接缝）。
    // stlview 报的 34841.61 是三角网格近似，不作 BREP 判据。
    const netArea = Math.PI * (rOut * rOut - rIn * rIn)
    const totalLen = 51.35 + Math.PI * R + 90 + (Math.PI / 2) * R + 50
    expect(api.getVolume(h)).toBeCloseTo(netArea * totalLen, -1)
  })

  it('G3. 闭合中心线（真圆 R10 + r6 圆截面）→ 自动识别 closed，一次扫出环面', async () => {
    await useOcct()
    // 闭合是**脊柱事实**，不需要也不接受开关：整圆 = 首尾重合。
    // 环面解析：体积 = πr² × 2πR = 7106.19，bbox 32×32×12（外径 16、管半径 6）。
    const s = await shapeOf(
      'brep',
      `let sec = ${discFace(6, 'sec')}\n` +
        `let spine = cad.wireFromEdges([cad.circleArc([0,0,0],[0,0,1],10,0*DEGREE,360*DEGREE)])\n` +
        `let part2 = cad.sweep(sec, spine)\n`,
      'part2',
    )
    expect(volumeOf(s)).toBeCloseTo(Math.PI * 36 * 2 * Math.PI * 10, -1)
    const b = getBrepApi().getBoundingBox(brepOf(s) as never)
    expect(b.xmax - b.xmin).toBeCloseTo(32, 0)
    expect(b.ymax - b.ymin).toBeCloseTo(32, 0)
    expect(b.zmax - b.zmin).toBeCloseTo(12, 0)
  })
})

describe('sweepAdvanced 带孔截面 · 事实钉桩', () => {
  it('F1. sweepRaw(带孔face, 单段直脊柱) 保留内腔，体积 = 净面积 × 长度', async () => {
    await useOcct()
    const rOut = 8
    const rIn = 4
    const len = 50
    const s = await shapeOf(
      'brep',
      `let part0 = ${annulusFace(rOut, rIn, 'sec')}\n` +
        `let part1 = cad.wire([[0,0,0],[0,0,${len}]])\n` +
        `let part2 = cad.sweepRaw(part0, part1, { withContact: true })\n`,
      'part2',
    )
    const expectedHollow = Math.PI * (rOut * rOut - rIn * rIn) * len
    const expectedSolid = Math.PI * rOut * rOut * len
    const v = volumeOf(s)
    // 修复前错误值：只等于外环实心棒（丢内腔，体积 = expectedSolid）。
    // 修复后正确值：净空心体积（外环 − 内环）× 长度。
    expect(Math.abs(v - expectedHollow)).toBeLessThan(expectedHollow * 0.01)
    expect(Math.abs(v - expectedSolid)).toBeGreaterThan(expectedSolid * 0.2)
  })

  it('F2. sweepAdvanced 沿两段 90° 折线：自动斜接 = 精确；显式 transformed = 解析值的 1/2', async () => {
    await useOcct()
    const r = 6
    const expected = Math.PI * r * r * 50
    const code = (opts: string): string =>
      `let part0 = ${discFace(r, 'sec')}\n` +
      `let part1 = cad.wire([[0,0,0],[0,0,25],[0,25,25]])\n` +
      `let part2 = cad.sweepRaw(part0, part1, ${opts})\n`

    // 新真值：脊柱有 G0 折角 ⇒ 自动过渡用 rightCorner（斜接），体积精确。
    const auto = await shapeOf('brep', code('{ withContact: true }'), 'part2')
    expect(volumeOf(auto) / expected).toBeCloseTo(1, 3)

    // 旧真值（钉住不回归）：显式 transformed = 截面只平移不旋转 ⇒ 平移到折角处塌成一块板，
    // 体积恰为解析值的 1/2，且默认 5% 守卫必须拦下它。
    const flat = await exec('brep', code("{ withContact: true, transitionMode: 'transformed' }"))
    expect(flat.failedAt).toBeTruthy()
    expect(String(flat.failedAt?.message ?? '')).toMatch(/swept volume does not match/i)
    expect(String(flat.failedAt?.message ?? '')).toMatch(/50\.0% off/)
  })

  it('F2b. 相切拼接的多段脊柱（真弧+直腿，G1 相连）→ sweepAdvanced 体积精确 1.0000', async () => {
    await useOcct()
    const r = 6
    // 弧 R10 从 (0,0,0) 起、切向 +Z，到 (0,-10,10)、切向 -Y；直腿从该点沿 -Y 相切延续。
    // 角度口径（实测）：axis +X 时 0° 落在 +Z、90° 落在 -Y，所以起点在 +Y 要用 -90°。
    // 这一条曾经写错（0°~90°），造出的是「弧尾 (0,-20,0) 与直腿首 (0,-10,10) 相距 14.14」
    // 的**断裂** wire，于是 sweepFull 直接失败；错的是脊柱不是内核。
    const code =
      `let part0 = ${discFace(r, 'sec')}\n` +
      `let arc = cad.circleArc([0,-10,0],[1,0,0],10,-90*DEGREE,0*DEGREE)\n` +
      `let line = cad.edge([0,-10,10],[0,-20,10])\n` +
      `let part1 = cad.wireFromEdges([arc, line])\n` +
      `let part2 = cad.sweepRaw(part0, part1, { withContact: true })\n`
    const expected = Math.PI * r * r * ((Math.PI / 2) * 10 + 10) // 2907.50
    const s = await shapeOf('brep', code, 'part2')
    // 事实：G1 相连的混合边类型脊柱，单次扫掠**不丢体积**（实测 1.0000000000000002）。
    expect(volumeOf(s) / expected).toBeCloseTo(1, 3)
  })

  it('F2c. 单段真弧脊柱 + withContact/withCorrection → 截面能否自动定位（决定封装实现）', async () => {
    await useOcct()
    const r = 6
    const expected = Math.PI * r * r * ((Math.PI / 2) * 10)
    // 弧 R10 从 (0,0,0) 起，截面仍在原点（未手工 translate）
    const attempt = async (opts: string): Promise<number | null> => {
      const result = await exec(
        'brep',
        `let part0 = ${discFace(r, 'sec')}\n` +
          `let part1 = cad.wireFromEdges([cad.circleArc([0,-10,0],[1,0,0],10,0*DEGREE,90*DEGREE)])\n` +
          `let part2 = cad.sweepRaw(part0, part1, ${opts})\n`,
      )
      if (result.failedAt) {
        return null
      }
      const v = volumeOf(result.outputs.get(asPartName('part2')) as Shape)
      return v
    }
    const withBoth = await attempt('{ withContact: true, withCorrection: true }')
    if (withBoth !== null) {
      expect(Math.abs(withBoth - expected)).toBeLessThan(expected * 0.02)
      return
    }
    // 若两种自动定位都不可用 ⇒ 封装必须自己算变换矩阵搬截面（sweepAlong 就是这么做的）。
    const contactOnly = await attempt('{ withContact: true }')
    expect(contactOnly).toBeNull()
  })

  it('F3. 布尔减方案：外环扫 − 内环扫 = 净空心体积（P0 可行路径）', async () => {
    await useOcct()
    const rOut = 8
    const rIn = 4
    const len = 50
    const s = await shapeOf(
      'brep',
      `let outer = ${discFace(rOut, 'a')}\n` +
        `let inner = ${discFace(rIn, 'b')}\n` +
        `let spine = cad.wire([[0,0,0],[0,0,${len}]])\n` +
        `let so = cad.sweepRaw(outer, spine, { withContact: true })\n` +
        `let si = cad.sweepRaw(inner, spine, { withContact: true })\n` +
        `let part2 = cad.subtract(so, si)\n`,
      'part2',
    )
    const expected = Math.PI * (rOut * rOut - rIn * rIn) * len
    const v = volumeOf(s)
    expect(Math.abs(v - expected)).toBeLessThan(expected * 0.02)
  })
})

describe('体积守卫容差可注入（P2）', () => {
  const R = 6
  /** 两段 90° 折线：内核静默只给解析体积的 1/2。 */
  const L_SHAPE = 'cad.wire([[0,0,0],[0,0,25],[0,25,25]])'

  it('P2g1. 默认 5% 拦下塌陷体；只放宽体积不够（C2 仍拒），strict:false 才知情放行且体积仍是 50%', async () => {
    await useOcct()
    const expected = Math.PI * R * R * 50
    const code = (opts: string): string =>
      `let part0 = ${discFace(R, 'sec')}\n` +
      `let part1 = ${L_SHAPE}\n` +
      `let part2 = cad.sweepRaw(part0, part1, ${opts})\n`

    // 默认（无 opts.volumeTolerance）：拦。用显式 transformed 造出确定性的塌陷几何，
    // 而不是靠「自动过渡不管折角」——后者已修好，不再丢体积。
    const strict = await exec('brep', code("{ withContact: true, transitionMode: 'transformed' }"))
    expect(strict.failedAt).toBeTruthy()
    expect(String(strict.failedAt?.message ?? '')).toMatch(/50\.0% off, tolerance 5%/)

    // 只放宽体积容差**不够**：塌陷体的端面法向偏离切向 90°，C2 照样拒。
    const tolOnly = await exec(
      'brep',
      code("{ withContact: true, transitionMode: 'transformed', volumeTolerance: 0.6 }"),
    )
    expect(tolOnly.failedAt?.code).toBe('E_SWEEP_CAP_NORMAL')

    // 要「知情放行」必须同时把 C2 降为通知（strict:false）；此时体积仍只有解析值的一半。
    const relaxed = await exec(
      'brep',
      code("{ withContact: true, transitionMode: 'transformed', volumeTolerance: 0.6, strict: false }"),
    )
    expect(relaxed.failedAt).toBeFalsy()
    const v = volumeOf(relaxed.outputs.get(asPartName('part2')) as Shape)
    expect(Math.abs(v - expected * 0.5)).toBeLessThan(expected * 0.05)
  })

  // P2g2（2026-11-16 删除）：原用例钉的是「cad.pipe 对多边/折角脊柱在扫掠前拒绝」。
  // `cad.pipe` 已删除，其定义域（单边 / 同类型 G1）现在就是 `cad.sweep` 的 `single`
  // 策略；多边/折角脊柱由 `sweep` 的策略层正常接管（miter / segments），不再是一条
  // 独立的「MakePipe 做不到」拒绝路径。对应的策略矩阵在 `sweep-along.test.ts`。

  it('P2g3. 非法容差（(0,1) 之外）→ E_SWEEP_TOL_INVALID，不静默夹取', async () => {
    await useOcct()
    for (const bad of ['1.5', '0', '-0.2']) {
      const result = await exec(
        'brep',
        `let part0 = ${discFace(R, 'sec')}\n` +
          `let part1 = ${L_SHAPE}\n` +
          `let part2 = cad.sweepRaw(part0, part1, { withContact: true, volumeTolerance: ${bad} })\n`,
      )
      expect(result.failedAt).toBeTruthy()
      expect(String(result.failedAt?.message ?? '')).toMatch(/E_SWEEP_TOL_INVALID/)
    }
  })

  it('P2g4. sweepAlong 接受 volumeTolerance：正确几何不受影响，体积仍为净面积 × 段长', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `let sec = ${annulusFace(8, 4, 's')}\n` +
        `let sp = cad.wire([[0,0,0],[0,0,30]])\n` +
        `let part2 = cad.sweep(sec, sp, { volumeTolerance: 0.02 })\n`,
      'part2',
    )
    expect(volumeOf(s)).toBeCloseTo(Math.PI * (64 - 16) * 30, -1)
  })
})

describe('脚本自定义函数能力（P2 澄清）', () => {
  it('P2. `function` 声明可封装重复的截面构造，check+run 均放行', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `function ring(rOut, rIn, tag) {\n` +
        `  return cad.sketch({ plane: 'XY', shapes: [\n` +
        `    { kind: 'circle', r: rOut, cx: 0, cy: 0, tag: tag },\n` +
        `    { kind: 'circle', r: rIn, cx: 0, cy: 0, tag: tag + 'b', mode: 's' }\n` +
        `  ], constraints: [] })\n` +
        `}\n` +
        `let sec = ring(8, 4, 'sec')\n` +
        `let sp = cad.wire([[0,0,0],[0,0,20]])\n` +
        `let part2 = cad.sweep(sec, sp)\n`,
      'part2',
    )
    // 净化体积 = π(64−16)×20 = 3015.93
    expect(volumeOf(s)).toBeCloseTo(Math.PI * (64 - 16) * 20, -1)
  })
})

describe('P1 · 按「空间点 + 法向」放截面（sketchOnPlane 的 PlaneSpec，零源码改动）', () => {
  /** 局部坐标下的 10×20 矩形环（面积 200），中心在局部原点。 */
  const RECT_LOOP =
    '[{ segments: [' +
    "{ kind: 'line', x1: -5, y1: -10, x2: 5, y2: -10 }," +
    "{ kind: 'line', x1: 5, y1: -10, x2: 5, y2: 10 }," +
    "{ kind: 'line', x1: 5, y1: 10, x2: -5, y2: 10 }," +
    "{ kind: 'line', x1: -5, y1: 10, x2: -5, y2: -10 }," +
    '] }]'

  it('P1a. plane:{origin,normal} 把截面直接放在脊柱起点，法向沿脊柱 → 单段 sweep 体积 = 面积 × 长', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `let part0 = cad.sketchOnPlane({ contours: ${RECT_LOOP}, plane: { origin: [0, 0, 90], normal: [0, 1, 0] } })\n` +
        `let part1 = cad.wire([[0,0,90],[0,50,90]])\n` +
        `let part2 = cad.sweep(part0, part1)\n`,
      'part2',
    )
    // 截面已在脊柱起点且法向对齐 ⇒ 不需要 translate，也不用 withContact。
    expect(volumeOf(s)).toBeCloseTo(200 * 50, -1)
    const box = getBrepApi().getBoundingBox(brepOf(s) as never)
    expect(box.ymax - box.ymin).toBeCloseTo(50, 0)
    // GOTCHA（钉住 `makePlane` 的 xAxis 自动推导）：normal=[0,1,0] 时局部 +X 落在
    // 世界 **+Z**、局部 +Y 落在世界 **+X**（cand=+X, x=cross(+X,+Y)=+Z, y=cross(+Y,+Z)=+X），
    // 所以局部 10×20 的矩形在世界里是 20(x)×10(z)。面积与体积不变，但**非对称截面的
    // 朝向会跟着转** —— 要固定朝向必须显式给 `xAxis`。
    expect(box.xmax - box.xmin).toBeCloseTo(20, 0)
    expect(box.zmax - box.zmin).toBeCloseTo(10, 0)
  })

  it('P1c. 显式给 xAxis ⇒ 非对称截面朝向被钉住（局部 10×20 在世界里仍是 10(x)×20(z)）', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `let part0 = cad.sketchOnPlane({ contours: ${RECT_LOOP}, plane: { origin: [0, 0, 90], normal: [0, 1, 0], xAxis: [1, 0, 0] } })\n` +
        `let part1 = cad.wire([[0,0,90],[0,50,90]])\n` +
        `let part2 = cad.sweep(part0, part1)\n`,
      'part2',
    )
    expect(volumeOf(s)).toBeCloseTo(200 * 50, -1)
    const box = getBrepApi().getBoundingBox(brepOf(s) as never)
    expect(box.xmax - box.xmin).toBeCloseTo(10, 0)
    expect(box.zmax - box.zmin).toBeCloseTo(20, 0)
  })

  it('P1b. 截面没放在脊柱起点 → sweep 默认落位把它搬上去（体积正确）；autoPlace:false 才复现旧错', async () => {
    await useOcct()
    // 截面留在 z=0 平面、脊柱在 z=90：`MakePipe`（旧 pipe）不做自动定位，体积对不上。
    // `cad.sweep` 的 autoPlace 默认开 → 同一段脚本现在给出正确体积；关掉落位才该失败。
    const placed = await shapeOf(
      'brep',
      `let part0 = cad.sketchOnPlane({ contours: ${RECT_LOOP}, plane: 'XY' })\n` +
        `let part1 = cad.wire([[0,0,90],[0,50,90]])\n` +
        `let part2 = cad.sweep(part0, part1)\n`,
      'part2',
    )
    expect(volumeOf(placed)).toBeCloseTo(200 * 50, -1)
    const box = getBrepApi().getBoundingBox(brepOf(placed) as never)
    // 脊柱是 (0,0,90)→(0,50,90)（沿 +Y，z 恒 90）；截面 10×20 原在 z=0，被落位搬到 z=90、
    // 法向 +Z 转成 +Y ⇒ 管沿 y 0..50、截面跨 z 80..100。z 的偏移就是「落位真的发生了」的证据。
    expect(box.ymin).toBeCloseTo(0, 1)
    expect(box.ymax).toBeCloseTo(50, 1)
    expect(box.zmin).toBeCloseTo(80, 1)
    expect(box.zmax).toBeCloseTo(100, 1)

    const raw = await exec(
      'brep',
      `let part0 = cad.sketchOnPlane({ contours: ${RECT_LOOP}, plane: 'XY' })\n` +
        `let part1 = cad.wire([[0,0,90],[0,50,90]])\n` +
        `let part2 = cad.sweep(part0, part1, { autoPlace: false })\n`,
    )
    expect(raw.failedAt).toBeTruthy()
    expect(String(raw.failedAt?.message ?? '')).toMatch(/swept volume does not match/i)
  })
})

describe('sweep — TS 级直连（L1 覆盖门禁）', () => {
  it('L1. sweep(section, spine, opts) 三个参数全覆盖：单段直脊体积 = 面积 × 长', async () => {
    await useOcct()
    const rt = new CadRuntime(ports(), 'brep', { cad: createApiNamespaceWithEditorOps() })
    const r = await rt.execute(
      `let sec = ${discFace(6, 's')}\nlet sp = cad.wire([[0,0,0],[0,0,40]])\n`,
    )
    expect(r.failedAt).toBeFalsy()
    const section = r.outputs.get(asPartName('sec')) as Shape
    const spine = r.outputs.get(asPartName('sp')) as Shape
    const s = await sweep(section, spine, { autoPlace: true })
    expect(volumeOf(s)).toBeCloseTo(Math.PI * 36 * 40, -1)
  })
})
