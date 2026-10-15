/**
 * planetary-static — 行星齿轮组静态装配的约束求解验证（pose 层，无内核）
 *
 * 回答问题：行星齿轮组（太阳轮 + 内齿圈 + n 个均布行星轮）的**静态装配**，
 * faijs 的 `cad.assembly` 约束词汇 + 求解器支持吗？
 *
 * 结论（本文件钉住）：
 * - **支持**。零件均以自身原点建模（轮心在局部原点、轴 +Z，与 animation 三节
 *   脚本形态一致），安装位姿全部由约束解算：
 *   - 太阳轮 `fixed` 锚定（装配基准）；
 *   - 内齿圈 `concentric`（axis-axis，edge.axis 快照，无需内核）同轴 +
 *     `coincident`（point-point）定心 + `fixedRotation` 定姿；
 *   - 行星轮 `coincident`（轮心 ↔ 太阳轮本地系轨道点 [orbitR·cosθ, orbitR·sinθ, 0]）
 *     定均布位置 + `fixedRotation` 定姿。
 *   global solver 收敛，位姿等于解析值（LM 实际精度见下）。
 * - GOTCHA：`fixedRotation`/`fixedPoint`/`fixedAxis` 只有 global solver 支持，
 *   chain（缺省 solver）明确抛错（`lower.ts`：only supported by the 'global' solver）。
 * - GOTCHA：`distance`（axis-axis）只定**径向距离**，不定**均布角**——圆周均布
 *   必须用点重合表达（见 distance 用例）。
 * - 已修复缺陷（金丝雀）：`distance`（axis-axis）的 value 单位语义曾错误——
 *   `point_on_line` 的 val≠0 分支漏缩放（残差除 scale 而目标值不除），实际满足
 *   dist = scale·√val 而非 val（point-point 分支与 chain solver 均按 mm）。
 *   金丝雀用例两值并钉（错误值 scale·√val ≈ 54.77 + 正确值 val = 30），断言
 *   已翻转为正确值；「残差与目标值同尺度（t.val·inv）²」的不变量落在
 *   termResidual 源码注释。
 * - GOTCHA：`distance`（axis-axis）在**起点同轴**时因数值雅可比拐点完全推不动
 *   （点落在线上 → 数值导数为 0），LM 直接终止并报 converged=true、残差非零——
 *   「converged」不等于「约束已满足」，消费方必须查 residuals。
 * - 能力边界：齿的啮合相位（面内转角，如 gears `planetaryGearset` 的 τ/2）
 *   约束词汇表达不了（`angle` 是轴间方向角，不是面内转角）——相位属运动侧
 *   （animation 的 `anim.joint.phase`），不属静态装配位置。
 *
 * 求解语义（与 solve.test.ts 同）：transform = 成员**局部系的世界位姿**
 * （P8 方案 A：绝对位姿 = initial ∘ delta；faijs Shape 不携带 placement，
 * 本地系 == 建模系）。零件建模在原点 → transform.translation = 轮心世界坐标。
 * global 对恒等位姿的自由成员**仍输出** transform（chain 会跳过，solve.ts
 * 的 isIdentityPose 只在 chain 路径）——消费方不能假设「无 transform = 没动」。
 *
 * LM 实际精度：point 类残差按 scale（marker 包围盒对角长，本例 60–85）归一，
 * LM_TOL_OBJ=1e-12 的绝对早停 → 实测位置误差 ≤2e-5 mm（相对 ~1e-7）。
 * 本文件位姿断言容差取 1e-4（对 CAD 动画仍严于 0.1 µm；求解器自身
 * RESIDUAL_WARN 阈值为 1e-6·scale ≈ 6e-5，即官方容忍度内）。
 *
 * 参数取 animation demo planetary_gear 同款（module=2 / 18-12-42 / 3 行星轮）：
 *   r0 = module·teeth/2 → sun 18、planet 12 → orbitR = 30；θ_i = i·120°。
 */

import { describe, it, expect } from 'vitest'
import { solveAssembly } from '../../../src/api/assembly/solve'
import { asPartName } from '../../../src/identity'
import type { AssemblyConstraint, AssemblyVec3 } from '../../../src/api/assembly/types'
import type { AssemblyTransform } from '../../../src/runtime-state'
import type { Shape } from '../../../src/mesh/types'

/** PartName 品牌类型便捷转换（测试内统一用 P(...)，与 solve.test.ts 一致）。 */
const P = asPartName

/** 伪成员（快照引用不读几何，只需占位对象）。 */
const dummy = () => ({}) as Shape

const MEMBERS = ['sun', 'ring', 'planet_0', 'planet_1', 'planet_2']

/** 行星轮系几何量（module=2 / sun 18 / planet 12 / ring 42 / 3 行星轮）。 */
const MODULE = 2
const SUN_TEETH = 18
const PLANET_TEETH = 12
const RING_TEETH = SUN_TEETH + PLANET_TEETH * 2 // 42
const ORBIT_R = (MODULE * (SUN_TEETH + PLANET_TEETH)) / 2 // 30（= sun.r0 + planet.r0）
const N_PLANETS = 3

/** LM 实际精度内的位姿容差（见文件头：实测位置误差 ≤2e-5）。 */
const POSE_EPS = 1e-4

/**
 * distance 用例的 scale（marker 点包围盒对角长，= computeScale 的输入）：
 * 两条约束的 marker 点为 { [0,0,0], [10,0,0] }（轴-轴取 origin），对角长 10。
 * 用于表达 axis-axis distance 的当前错误值 scale·√val（见该用例两值并钉）。
 */
const SCALE = 10

/** 第 i 个行星轮的轨道角（度）：0 / 120 / 240。 */
function orbitAngleDeg(i: number): number {
  return (360 * i) / N_PLANETS
}

/** 太阳轮本地系里的轨道点（行星轮轮心安装位；建模基准，不是脚本手写安装位置）。 */
function orbitPointOnSun(i: number): AssemblyVec3 {
  const a = (orbitAngleDeg(i) * Math.PI) / 180
  return [ORBIT_R * Math.cos(a), ORBIT_R * Math.sin(a), 0]
}

/** 轴快照引用（edge.axis 形态：本地系轴上一点 + 单位方向；无需内核）。 */
function axisRef(part: string, origin: AssemblyVec3, direction: AssemblyVec3) {
  return { part: P(part), edge: { axis: { origin, direction } } }
}

/** 点快照引用（本地系坐标）。 */
function pointRef(part: string, p: AssemblyVec3) {
  return { part: P(part), point: p }
}

/** 恒等四元数（faijs xyzw）。 */
const IDENTITY_QUAT = [0, 0, 0, 1]

/** faijs 四元数 [x,y,z,w] 旋转向量（测试内小助手，避免为断言引入内核依赖）。 */
function rotateByQuat(q: ArrayLike<number>, v: AssemblyVec3): AssemblyVec3 {
  const [x, y, z, w] = [q[0], q[1], q[2], q[3]]
  const [vx, vy, vz] = v
  const ix = w * vx + y * vz - z * vy
  const iy = w * vy + z * vx - x * vz
  const iz = w * vz + x * vy - y * vx
  const iw = -x * vx - y * vy - z * vz
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ]
}

/** 成员本地点 p 经 transform 变换后的世界坐标（p' = R·p + T）。 */
function toWorld(t: AssemblyTransform, p: AssemblyVec3): AssemblyVec3 {
  const r = rotateByQuat(t.quaternion, p)
  return [r[0] + t.translation[0], r[1] + t.translation[1], r[2] + t.translation[2]]
}

/** 按成员表找 transform；锁定成员（fixed/自动锚定）不输出 → undefined。 */
function findMember(transforms: AssemblyTransform[], members: string[], name: string): AssemblyTransform | undefined {
  const index = members.indexOf(name)
  return transforms.find((tr) => tr.index === index)
}

function expectVecClose(a: ArrayLike<number>, b: ArrayLike<number>, eps = POSE_EPS): void {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < a.length; i++) {
    expect(Math.abs(a[i] - b[i]), `component ${i}: ${a[i]} vs ${b[i]}`).toBeLessThan(eps)
  }
}

/** 断言求解健康：收敛、无 unsupported、无欠定、残差可忽略（按 scale 归一后）。 */
function expectHealthy(r: ReturnType<typeof solveAssembly>, constraintCount: number): void {
  expect(r.converged).toBe(true)
  expect(r.unsupported).toEqual([])
  expect(r.underdetermined, `underdetermined: ${JSON.stringify(r.underdetermined)}`).toBeUndefined()
  expect(r.residuals).toHaveLength(constraintCount)
  for (const [i, res] of r.residuals!.entries()) {
    expect(res, `constraint #${i} residual=${res}`).toBeLessThan(1e-9)
  }
  expect(r.warnings).toBeUndefined()
}

/** 行星轮系静态装配的规范约束集（belt 模式推广：点重合定位 + fixedRotation 定姿）。 */
function planetaryConstraints(opts: { ringConcentric?: boolean } = {}): AssemblyConstraint[] {
  const cs: AssemblyConstraint[] = [{ type: 'fixed', part: P('sun') }]
  if (opts.ringConcentric) {
    // 同轴（轴-轴，快照）：物理语义最全的形式（搭配下面的定心 + 定姿）
    cs.push({
      type: 'concentric',
      a: axisRef('sun', [0, 0, 0], [0, 0, 1]),
      b: axisRef('ring', [0, 0, 0], [0, 0, 1]),
    })
  }
  cs.push({
    type: 'coincident',
    a: pointRef('ring', [0, 0, 0]),
    b: pointRef('sun', [0, 0, 0]),
  })
  cs.push({ type: 'fixedRotation', part: P('ring') })
  for (let i = 0; i < N_PLANETS; i++) {
    cs.push({
      type: 'coincident',
      a: pointRef(`planet_${i}`, [0, 0, 0]),
      b: pointRef('sun', orbitPointOnSun(i)),
    })
    cs.push({ type: 'fixedRotation', part: P(`planet_${i}`) })
  }
  return cs
}

/** n 个行星轮（无齿圈）的约束集：验证约束形态与行星轮数无关。 */
function planetsOnlyConstraints(n: number): { members: string[]; constraints: AssemblyConstraint[] } {
  const members = ['sun', ...Array.from({ length: n }, (_, i) => `planet_${i}`)]
  const constraints: AssemblyConstraint[] = [{ type: 'fixed', part: P('sun') }]
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n
    constraints.push({
      type: 'coincident',
      a: pointRef(`planet_${i}`, [0, 0, 0]),
      b: pointRef('sun', [ORBIT_R * Math.cos(a), ORBIT_R * Math.sin(a), 0]),
    })
    constraints.push({ type: 'fixedRotation', part: P(`planet_${i}`) })
  }
  return { members, constraints }
}

describe('行星齿轮组静态装配：规范约束集（fixed + coincident + fixedRotation）', () => {
  it('global 精确求解：太阳轮锚定，齿圈恒等，行星轮落到均布轨道点', () => {
    const cs = planetaryConstraints()
    const r = solveAssembly(MEMBERS.map(dummy), MEMBERS, cs, { solver: 'global' })
    expectHealthy(r, cs.length)

    // 太阳轮被 fixed 锁定 → 不输出 transform
    expect(findMember(r.transforms, MEMBERS, 'sun')).toBeUndefined()

    // 齿圈：建模即在原点同轴 → 恒等位姿（global 对恒等自由成员仍输出 transform）
    const tRing = findMember(r.transforms, MEMBERS, 'ring')!
    expect(tRing).toBeDefined()
    expectVecClose(tRing.translation, [0, 0, 0])
    expectVecClose(tRing.quaternion, IDENTITY_QUAT)

    // 行星轮：轮心 = 轨道点，姿态恒等（齿相位归运动侧 anim.joint.phase）
    for (let i = 0; i < N_PLANETS; i++) {
      const t = findMember(r.transforms, MEMBERS, `planet_${i}`)!
      expect(t, `planet_${i} transform`).toBeDefined()
      expectVecClose(t.translation, orbitPointOnSun(i))
      expectVecClose(t.quaternion, IDENTITY_QUAT)
      // pivot 恒 [0,0,0]（global 裁定 5）→ translation 即轮心世界坐标
      expectVecClose(t.pivot, [0, 0, 0])
    }
  })

  it('齿圈同轴用 concentric（axis-axis 快照）：多成员行星上下文同样成立', () => {
    const cs = planetaryConstraints({ ringConcentric: true })
    const r = solveAssembly(MEMBERS.map(dummy), MEMBERS, cs, { solver: 'global' })
    expectHealthy(r, cs.length)

    // concentric + coincident(定心) + fixedRotation 对恒等建模的齿圈是
    // 「冗余但一致」的组合：LM 照常收敛到恒等，残差可忽略。
    const tRing = findMember(r.transforms, MEMBERS, 'ring')!
    expectVecClose(tRing.translation, [0, 0, 0])
    expectVecClose(tRing.quaternion, IDENTITY_QUAT)
    for (let i = 0; i < N_PLANETS; i++) {
      expectVecClose(findMember(r.transforms, MEMBERS, `planet_${i}`)!.translation, orbitPointOnSun(i))
    }
  })

  it('行星轮数 ≠ 3（5 均布）同样支持：约束形态与行星轮数无关，θ_i = i·72°', () => {
    const n = 5
    const { members, constraints } = planetsOnlyConstraints(n)
    const r = solveAssembly(members.map(dummy), members, constraints, { solver: 'global' })
    expectHealthy(r, constraints.length)
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n
      const t = findMember(r.transforms, members, `planet_${i}`)!
      expectVecClose(t.translation, [ORBIT_R * Math.cos(a), ORBIT_R * Math.sin(a), 0])
    }
  })
})

describe('GOTCHA：solver 选择、欠定诊断与 distance 语义', () => {
  it('fixedRotation 只有 global 支持：chain（缺省 solver）明确抛错，不静默降级', () => {
    const cs = planetaryConstraints()
    expect(() => solveAssembly(MEMBERS.map(dummy), MEMBERS, cs)).toThrowError(
      /only supported by the 'global' solver/,
    )
  })

  it('欠定诊断：抽掉行星轮的 fixedRotation → underdetermined.dof > 0（自转自由），位置照解', () => {
    const cs = planetaryConstraints().filter(
      (c) => !(c.type === 'fixedRotation' && c.part === P('planet_1')),
    )
    const r = solveAssembly(MEMBERS.map(dummy), MEMBERS, cs, { solver: 'global' })
    expect(r.converged).toBe(true)
    // 自转（绕自身轴）1 个自由度失去约束 → 欠定诊断必须响（animation 侧据此响亮失败）
    expect(r.underdetermined).toBeDefined()
    expect(r.underdetermined!.dof).toBeGreaterThan(0)
    expect(r.underdetermined!.freeDirs?.length).toBeGreaterThan(0)
    // 位置不受影响：轮心仍落在轨道点（LM 精度内）
    const t = findMember(r.transforms, MEMBERS, 'planet_1')!
    expectVecClose(t.translation, orbitPointOnSun(1))
  })

  it('GOTCHA：distance（axis-axis）只定径向距离、不定均布角——圆周均布必须用点重合', () => {
    // 行星轮**建模在轴外**（本地轴点/轮心 [10,0,0]，避开同轴起点的拐点，见下一用例）：
    // 平行 + 定距 = 轴平行 + 行星轮轴到太阳轮轴原点的距离 = orbitR；但「挂在圆的
    // 哪个角度」没有任何约束 → 欠定（角度 + 轴向 + 自转共 3 个自由 DOF）。
    const two = ['sun', 'planet_0']
    const cs: AssemblyConstraint[] = [
      { type: 'fixed', part: P('sun') },
      {
        type: 'parallel',
        a: axisRef('sun', [0, 0, 0], [0, 0, 1]),
        b: axisRef('planet_0', [10, 0, 0], [0, 0, 1]),
      },
      {
        type: 'distance',
        value: ORBIT_R,
        a: axisRef('sun', [0, 0, 0], [0, 0, 1]),
        b: axisRef('planet_0', [10, 0, 0], [0, 0, 1]),
      },
    ]
    const r = solveAssembly(two.map(dummy), two, cs, { solver: 'global' })
    expect(r.converged).toBe(true)
    // 角度（绕太阳轮轴）+ 轴向 + 自转自由度无约束
    expect(r.underdetermined).toBeDefined()
    expect(r.underdetermined!.dof).toBeGreaterThan(0)
    // 径向距离被满足：行星轮**轴**（本地 [10,0,0]，方向 [0,0,1]）到太阳轮轴原点
    // [0,0,0] 的世界距离。注意不能断 translation 的 XY 模长——轴向是自由
    // DOF，LM 会沿自由流漂（模长落在目标半径附近，具体值随漂移方向而变）。
    const t = findMember(r.transforms, two, 'planet_0')!
    const axisWorld = toWorld(t, [10, 0, 0])
    const dirWorld = rotateByQuat(t.quaternion, [0, 0, 1])
    const radial = Math.hypot(axisWorld[0], axisWorld[1])
    // 距离约束残差可忽略（按 scale 归一后）——约束按其**实现的**语义确实满足
    expect(r.residuals![2]!).toBeLessThan(1e-9)
    // ── 金丝雀（两值并钉）：`point_on_line` 的 val≠0 分支必须把目标值与残差
    //    同尺度缩放——perp 已除 scale（vsumsqr(perp) = (dist/scale)²），目标值
    //    须为 (t.val·inv)²，否则实际满足 dist = scale·√val 而非 val：
    //    - 历史错误值：dist = SCALE·√ORBIT_R = 10·√30 ≈ 54.77（scale=10）
    //    - 应有正确值：dist = ORBIT_R = 30（mm，与 value 语义、point-point 分支一致）
    //    chain solver 的 axis-axis distance 按 mm 垂直距离解（chain-solver.ts
    //    「offset it to perpendicular distance `extra`」）——跨求解器一致佐证。
    //    global-solver.ts 修复（`vsumsqr(perp) - (t.val * inv) ** 2`）后本断言
    //    已翻转为正确值；若再退化回 scale·√val，此用例立即红。
    expect(
      radial,
      `axis world point ${JSON.stringify(axisWorld)}, dir ${JSON.stringify(dirWorld)}; ` +
        `radial should be ORBIT_R=${ORBIT_R} (mm), got ${radial.toFixed(6)} ` +
        `(historical bug: SCALE*sqrt(ORBIT_R)=${(SCALE * Math.sqrt(ORBIT_R)).toFixed(4)})`,
    ).toBeCloseTo(ORBIT_R, 4)
  })

  it('GOTCHA：distance（axis-axis）同轴起点推不动（数值雅可比拐点）——converged ≠ 满足', () => {
    // 行星轮建模在太阳轮轴上（本地轴点 [0,0,0]）：起点处「点到线」距离为 0，
    // |·| 型距离函数在 0 点有拐点 → 数值雅可比列全零 → LM 无梯度可走，
    // 直接终止并报 converged=true，而距离残差仍是非零（约束未满足）。
    // 正确用法：用 coincident(point-point) 定位（本文件规范约束集），或让零件
    // 建模在轴外再靠 distance 精修。
    const two = ['sun', 'planet_0']
    const cs: AssemblyConstraint[] = [
      { type: 'fixed', part: P('sun') },
      {
        type: 'distance',
        value: ORBIT_R,
        a: axisRef('sun', [0, 0, 0], [0, 0, 1]),
        b: axisRef('planet_0', [0, 0, 0], [0, 0, 1]),
      },
    ]
    const r = solveAssembly(two.map(dummy), two, cs, { solver: 'global' })
    expect(r.converged).toBe(true)
    // 行星轮原地未动（对比：起点在轴外时会被推到半径 30，见上一用例）
    const t = findMember(r.transforms, two, 'planet_0')!
    expectVecClose(t.translation, [0, 0, 0], 1e-9)
    // distance 约束残差明显非零（缩放后 (0 − 30/scale)²）——「收敛」不代满足，
    // 消费方必须查 residuals（animation 宿主链路据此响亮失败）。
    expect(r.residuals![1]!).toBeGreaterThan(1e-6)
  })
})
