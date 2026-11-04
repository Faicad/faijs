/**
 * `align` 逐轴锚点（A7）回归：`at` 与 `align` 正交、`centered` 降级为语法糖。
 *
 * 三件事必须同时钉住，缺一个就可能在别的路径上悄悄错位：
 * 1. **向后兼容**：`box(w,d,h)` / `{at}` / `{centered:true}` / `{at,centered:true}` 的
 *    包围盒与改造前逐点相同（历史语义与实测表在 drawing 仓
 *    `docs/2026-11-03-faijs-pitfalls.md §6.4`）。
 * 2. **新能力**：`align:'min'` 角点落在 at、`['center','center','max']` 顶面落在 at、
 *    `align:'none'` ≡ 该图元的原生锚点（box 角点 / cylinder 底面轴心 / sphere 球心）。
 * 3. **两条路径同结果**：brep（OCCT，原生角点/底面在原点）与 mesh（three，几何中心在原点）
 *    的 nativeMin 不同，代入同一条 `anchorShift` 公式后包围盒必须逐点一致。
 *
 * 公式来源：`packages/core/src/anchor.ts`。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getActiveBrepEngine, __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { box, cylinder, sphere } from '../../src/api/primitives'
import { assertBoxParams, assertCylinderParams, assertSphereParams } from '../../src/api/primitives'
import type { BoxParams, CylinderParams, Shape, SphereParams } from '../../src/mesh/types'

beforeAll(async () => {
  await initOcctWasm()
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

/**
 * op 返回值是 awaitable 句柄，测试里统一折成 Shape 再量包围盒。
 * op 的脚本面入参是 `Record<string, unknown>`（双形态归一后的 baggage），这里用
 * 字面量展开拿到隐式索引签名，保留上面 `BoxParams` 等强类型对用例本身的检查。
 */
async function mkBox(params: BoxParams): Promise<Shape> {
  const p: Record<string, unknown> = { ...params }
  return (await box(p)) as Shape
}
async function mkCylinder(params: CylinderParams): Promise<Shape> {
  const p: Record<string, unknown> = { ...params }
  return (await cylinder(p)) as Shape
}
async function mkSphere(params: SphereParams): Promise<Shape> {
  const p: Record<string, unknown> = { ...params }
  return (await sphere(p)) as Shape
}

/** 载荷三角化的三轴 bbox（`[minX,minY,minZ,maxX,maxY,maxZ]`）。 */
function bbox6(s: Shape): [number, number, number, number, number, number] {
  const p = s.positions
  const out: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k]!
      if (v < out[k]!) out[k] = v
      if (v > out[k + 3]!) out[k + 3] = v
    }
  }
  return out
}

/** 期望 bbox 用「每轴 [min,max]」表达，读起来跟断言一致。 */
type Span = [number, number]
interface Case {
  name: string
  make: () => Promise<Shape>
  /** [x, y, z] 三个跨度 */
  span: [Span, Span, Span]
  /** 曲面（圆柱/球）三角化内接带来的偏差；box 用 1e-6。 */
  tol?: number
}

const CASES: Case[] = [
  // ── 向后兼容：改造前语义逐点不变 ──
  {
    name: 'box 裸调用：角点在原点',
    make: () => mkBox({ width: 10, depth: 10, height: 10 }),
    span: [[0, 10], [0, 10], [0, 10]],
  },
  {
    name: 'box {at}：底面中心落在 at',
    make: () => mkBox({ width: 10, depth: 10, height: 10, at: [50, 0, 20] }),
    span: [[45, 55], [-5, 5], [20, 30]],
  },
  {
    name: 'box {centered:true}：原点居中',
    make: () => mkBox({ width: 10, depth: 10, height: 10, centered: true }),
    span: [[-5, 5], [-5, 5], [-5, 5]],
  },
  {
    name: 'box {at,centered:true}：at 成为几何中心（糖）',
    make: () => mkBox({ width: 10, depth: 10, height: 10, at: [50, 0, 20], centered: true }),
    span: [[45, 55], [-5, 5], [15, 25]],
  },
  {
    name: 'cylinder {at}：底面轴心落在 at',
    make: () => mkCylinder({ radius: 5, height: 10, at: [0, 0, 20] }),
    span: [[-5, 5], [-5, 5], [20, 30]],
    tol: 0.05,
  },
  {
    name: 'cylinder {at,centered:true}：at 成为中心',
    make: () => mkCylinder({ radius: 5, height: 10, at: [0, 0, 20], centered: true }),
    span: [[-5, 5], [-5, 5], [15, 25]],
    tol: 0.05,
  },
  {
    name: 'sphere {center}：球心落在 center',
    make: () => mkSphere({ radius: 5, center: [0, 0, 10] }),
    span: [[-5, 5], [-5, 5], [5, 15]],
    tol: 0.05,
  },
  {
    name: 'sphere 裸调用：球心在原点',
    make: () => mkSphere({ radius: 5 }),
    span: [[-5, 5], [-5, 5], [-5, 5]],
    tol: 0.05,
  },

  // ── 新能力：align 决定"哪一侧贴到 at" ──
  {
    name: "box {at, align:'min'}：角点落在 at",
    make: () => mkBox({ width: 10, depth: 10, height: 10, at: [50, 0, 20], align: 'min' }),
    span: [[50, 60], [0, 10], [20, 30]],
  },
  {
    name: "box {at, align:['center','center','max']}：顶面落在 at",
    make: () => mkBox({ width: 10, depth: 10, height: 10, at: [50, 0, 20], align: ['center', 'center', 'max'] }),
    span: [[45, 55], [-5, 5], [10, 20]],
  },
  {
    name: "box {at, align:'none'}：原生锚点（角点）移到 at",
    make: () => mkBox({ width: 10, depth: 10, height: 10, at: [50, 0, 20], align: 'none' }),
    span: [[50, 60], [0, 10], [20, 30]],
  },
  {
    name: "cylinder {at, align:'min'}：bbox 最小角落在 at",
    make: () => mkCylinder({ radius: 5, height: 10, at: [0, 0, 20], align: 'min' }),
    span: [[0, 10], [0, 10], [20, 30]],
    tol: 0.05,
  },
  {
    name: "sphere {center, align:'min'}：bbox 最小角落在 center",
    make: () => mkSphere({ radius: 5, center: [0, 0, 10], align: 'min' }),
    span: [[0, 10], [0, 10], [10, 20]],
    tol: 0.05,
  },
]

function expectSpan(shape: Shape, span: [Span, Span, Span], tol: number): void {
  const b = bbox6(shape)
  for (let axis = 0; axis < 3; axis++) {
    expect(b[axis]!).toBeGreaterThanOrEqual(span[axis]![0] - tol)
    expect(b[axis]!).toBeLessThanOrEqual(span[axis]![0] + tol)
    expect(b[axis + 3]!).toBeGreaterThanOrEqual(span[axis]![1] - tol)
    expect(b[axis + 3]!).toBeLessThanOrEqual(span[axis]![1] + tol)
  }
}

describe.each(['brep', 'mesh'] as const)('align 语义（%s 路径）', (mode) => {
  for (const c of CASES) {
    it(c.name, async () => {
      await setBackend(mode)
      const shape = await c.make()
      expectSpan(shape, c.span, c.tol ?? 1e-6)
    })
  }
})

/**
 * 字面量调用点：L2 参数覆盖扫描（`scripts/check-api-test-coverage.ts`）只认
 * `sphere({...})` 这种直呼形态，走 `mkSphere(params)` 的变量传参会把 `align`
 * 误判成"未覆盖"。这条既锁语义、也让扫描看得见。
 */
describe('字面量调用点：sphere 的 align 真被带到 op 入参', () => {
  it('sphere({ radius, center, align:"min" }) → 最小角落在 center', async () => {
    await setBackend('brep')
    const shape = (await sphere({ radius: 5, center: [0, 0, 10], align: 'min' })) as Shape
    expectSpan(shape, [[0, 10], [0, 10], [10, 20]], 0.05)
  })
})

describe('align 与 centered 的冲突/值域（api 层第一道防线）', () => {
  it('centered + align 同给 → E_ANCHOR_CONFLICT（并印出等价写法）', () => {
    const bad = () => assertBoxParams({
      width: 1, depth: 1, height: 1, at: [0, 0, 0], centered: true, align: 'center',
    })
    expect(bad).toThrow(/E_ANCHOR_CONFLICT/)
    expect(bad).toThrow(/align:\['center','center','center'\]/)
  })

  it('非法 align 单值 / 非法三元组 → E_INVALID_ALIGN', () => {
    expect(() => assertCylinderParams({ radius: 1, height: 1, align: 'centre' })).toThrow(/E_INVALID_ALIGN/)
    expect(() => assertCylinderParams({ radius: 1, height: 1, align: ['min', 'center'] })).toThrow(/E_INVALID_ALIGN/)
    expect(() => assertCylinderParams({ radius: 1, height: 1, align: ['min', 'none', 'max'] })).toThrow(/E_INVALID_ALIGN/)
  })

  it('centered:false 与省略等价（不改变默认锚点）', () => {
    expect(() => assertBoxParams({ width: 1, depth: 1, height: 1, centered: false })).not.toThrow()
    expect(() => assertBoxParams({ width: 1, depth: 1, height: 1, centered: false, at: [1, 2, 3] })).not.toThrow()
  })

  it('sphere 把 center 当锚点校验冲突', () => {
    expect(() => assertSphereParams({ radius: 1, center: [0, 0, 1], centered: true, align: 'center' }))
      .toThrow(/E_ANCHOR_CONFLICT/)
  })
})
