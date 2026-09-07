/**
 * api/assembly/joints — 运动副声明测试（P3）
 *
 * J1：buildJoint revolute/prismatic 各 1 例——dofs.length === 1、axis 透传、
 *     value clamp 到 [min,max]（工厂映射；P3 首期单 DOF 范围）。
 * J1b：cylindrical/planar/spherical 各 1 例——buildJoint 抛明确错误（不是静默
 *      降级成单 DOF）。
 * J2：offset 四元数换序往返（toBrepjsQuat(fromBrepjsQuat(q)) === q）；
 *     offset 字段用 position（不是 translation）。
 * J3：child 被两个 joint 驱动 → 抛错（绝不静默）。
 * J4：parent/child 不在 members → 抛错含成员名全集（R7 同源）。
 */

import { describe, it, expect } from 'vitest'
import { buildJoint, buildKinematicTree, type JointSpec } from './joints'
import { fromBrepjsQuat, toBrepjsQuat, type FaijsQuat } from './pose'

function revolute(
  overrides: Partial<JointSpec> = {},
): JointSpec {
  return {
    type: 'revolute',
    parent: 'base',
    child: 'arm',
    axis: { origin: [0, 0, 10], direction: [0, 0, 1] },
    min: 0,
    max: 120,
    value: 30,
    ...overrides,
  }
}

describe('J1: buildJoint — revolute/prismatic 单 DOF 映射', () => {
  it('revolute: single rotation DOF, axis passthrough, value clamped to [min,max]', () => {
    const j = buildJoint(revolute())
    expect(j.type).toBe('revolute')
    expect(j.parent).toBe('base')
    expect(j.child).toBe('arm')
    expect(j.dofs.length).toBe(1)
    expect(j.dofs[0]!.kind).toBe('rotation')
    expect(j.dofs[0]!.axis).toEqual([0, 0, 1])
    expect(j.axis.origin).toEqual([0, 0, 10])
    expect(j.axis.direction).toEqual([0, 0, 1])
    expect(j.min).toBe(0)
    expect(j.max).toBe(120)
    expect(j.value).toBe(30)
    // clamp 上界
    expect(buildJoint(revolute({ value: 200 })).value).toBe(120)
    // clamp 下界
    expect(buildJoint(revolute({ value: -5 })).value).toBe(0)
  })

  it('prismatic: single translation DOF, axis direction passthrough, value clamped', () => {
    const j = buildJoint({
      type: 'prismatic',
      parent: 'base',
      child: 'slide',
      axis: { origin: [1, 2, 3], direction: [1, 0, 0] },
      min: 10,
      max: 100,
      value: 20,
    })
    expect(j.type).toBe('prismatic')
    expect(j.dofs.length).toBe(1)
    expect(j.dofs[0]!.kind).toBe('translation')
    expect(j.dofs[0]!.axis).toEqual([1, 0, 0])
    expect(j.value).toBe(20)
    expect(buildJoint({
      type: 'prismatic',
      parent: 'base',
      child: 'slide',
      axis: { origin: [1, 2, 3], direction: [1, 0, 0] },
      min: 10,
      max: 100,
      value: 500,
    }).value).toBe(100)
  })
})

describe('J1b: 多 DOF 类型显式失败（绝不静默降级）', () => {
  it.each(['cylindrical', 'planar', 'spherical'] as const)('%s throws a clear error', (type) => {
    expect(() => buildJoint(revolute({ type }))).toThrow(/not supported yet; per-DOF ranges pending/)
  })
})

describe('J2: offset — 四元数换序往返 + position 键', () => {
  it('toBrepjsQuat(fromBrepjsQuat(q)) === q，且 offset 键是 position', () => {
    const q: FaijsQuat = [0.21, -0.13, 0.35, 0.9]
    const j = buildJoint(revolute({ offset: { position: [5, 0, 2], rotation: [...q] as FaijsQuat } }))
    expect(j.offset).toBeDefined()
    // 键名是 position（不是 translation）
    expect(Object.prototype.hasOwnProperty.call(j.offset, 'position')).toBe(true)
    expect(j.offset!.position).toEqual([5, 0, 2])
    // 换序往返
    expect(fromBrepjsQuat(j.offset!.rotation)).toEqual(q)
    expect(toBrepjsQuat(fromBrepjsQuat(toBrepjsQuat(q)))).toEqual(toBrepjsQuat(q))
  })

  it('不声明 rotation 时 offset 退化为恒等旋转', () => {
    const j = buildJoint(revolute({ offset: { position: [1, 0, 0] } }))
    expect(j.offset!.rotation).toEqual([1, 0, 0, 0])
  })
})

describe('J3: child 被两个 joint 驱动 → 抛错（绝不静默）', () => {
  it('duplicate child drive throws before solving', () => {
    expect(() =>
      buildKinematicTree(['base', 'arm'], [
        revolute({ parent: 'base', child: 'arm' }),
        revolute({ parent: 'base', child: 'arm', type: 'prismatic' }),
      ]),
    ).toThrow(/child 'arm' is driven by more than one joint/)
  })

  it('不同 child 互不干扰（合法双链）', () => {
    const root = buildKinematicTree(['base', 'arm', 'slide'], [
      revolute({ parent: 'base', child: 'arm' }),
      { ...revolute({ parent: 'base', child: 'slide' }), type: 'prismatic' } as JointSpec,
    ])
    // walkAssembly 覆盖 root + 3 成员；两个 joint 都经 addJoint 挂载（nodes 的 joints 合计 = 2）
    expect(root.name).toBe('__asm_root')
    const jointCount = collectJointCount(root)
    expect(jointCount).toBe(2)
  })
})

/** 统计树上全部 joint 数（walkAssembly 收集 node.joints）。 */
function collectJointCount(root: unknown): number {
  let count = 0
  // AssemblyNode.joints 是 readonly unknown[]；walk 每节点累计
  const walk = (node: { joints?: readonly unknown[]; children: readonly unknown[] }): void => {
    count += node.joints?.length ?? 0
    for (const child of node.children) walk(child as { joints?: readonly unknown[]; children: readonly unknown[] })
  }
  walk(root as { joints?: readonly unknown[]; children: readonly unknown[] })
  return count
}

describe('J4: parent/child 不在 members → 抛错含成员名全集', () => {
  it('unknown parent throws with full member list', () => {
    expect(() =>
      buildKinematicTree(['base', 'arm'], [revolute({ parent: 'ghost', child: 'arm' })]),
    ).toThrow(/joint parent 'ghost' is not a member — members: base, arm/)
  })

  it('unknown child throws with full member list', () => {
    expect(() =>
      buildKinematicTree(['base', 'arm'], [revolute({ parent: 'base', child: 'ghost' })]),
    ).toThrow(/joint child 'ghost' is not a member — members: base, arm/)
  })

  it('空成员名抛错（R7 同源）', () => {
    expect(() =>
      buildKinematicTree(['base', ''], [revolute({ parent: '', child: '' })]),
    ).toThrow(/member at index 1 has an empty name/)
  })
})