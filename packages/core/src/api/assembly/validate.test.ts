/**
 * api/assembly/validate — 约束参数运行期校验测试（P2-f1，方案 §2.1 VT1–VT4）
 *
 * - VT1：未知 type / 缺 a / 缺 b / value 缺失或 NaN / faceIndex=0 → 各自抛错且文案含字段路径
 * - VT2：全部 10 种类型各 1 条合法样例通过（含 distance/angle 的 value、fixed 的 part、
 *   face_mate 的 fixedPartName/movingPartName 形态）
 * - VT3：part 不在 members → 抛错且文案列出 members
 * - VT4：存量 face_mate 脚本形态经 `cad.assembly()` 接入点继续工作（回归绿，
 *   与 assembly-replay.test.ts 的端到端回归互补）
 */

import { describe, it, expect } from 'vitest'
import { validateConstraints } from './validate'
import { assembly } from '../compound'
import type { AssemblyConstraint, EntityRef } from './types'
import type { Shape } from '../../mesh/types'
import { asPartName } from '../../identity'

const MEMBERS = ['p0', 'p1']

/** 合法平面快照 EntityRef。 */
const faceRef = (part: string, z: number): EntityRef => ({
  part: asPartName(part),
  face: { center: [0, 0, z] as [number, number, number], normal: [0, 0, 1] as [number, number, number] },
})

/** 合法的 mate 样板（其它类型在它之上改 type/加字段）。 */
function mate(): AssemblyConstraint {
  return { type: 'mate', a: faceRef('p0', 0), b: faceRef('p1', 5) }
}

function expectPath(err: unknown, substr: string): void {
  expect((err as Error).message).toContain(substr)
}

describe('VT1: 违规输入 → 抛错且文案含字段路径', () => {
  it('未知 type → 含字段路径 + 合法类型全集', () => {
    try {
      validateConstraints([{ type: 'bogus' }], MEMBERS)
      expect.unreachable('should have thrown')
    } catch (e) {
      expectPath(e, 'constraints[0].type')
      expectPath(e, 'unknown constraint type "bogus"')
      expectPath(e, 'mate | align | coincident | concentric | distance | angle | parallel | perpendicular | fixed | face_mate')
    }
  })

  it('mate 缺 a → constraints[0].a', () => {
    const c = mate() as { a?: unknown }
    delete c.a
    try {
      validateConstraints([c], MEMBERS)
      expect.unreachable('should have thrown')
    } catch (e) {
      expectPath(e, 'constraints[0].a')
    }
  })

  it('mate 缺 b → constraints[0].b', () => {
    const c = mate() as { b?: unknown }
    delete c.b
    try {
      validateConstraints([c], MEMBERS)
      expect.unreachable('should have thrown')
    } catch (e) {
      expectPath(e, 'constraints[0].b')
    }
  })

  it('distance 缺 value → constraints[0].value', () => {
    const c = { type: 'distance', a: faceRef('p0', 0), b: faceRef('p1', 5) } as unknown
    try {
      validateConstraints([c], MEMBERS)
      expect.unreachable('should have thrown')
    } catch (e) {
      expectPath(e, 'constraints[0].value')
    }
  })

  it('angle value=NaN → constraints[0].value（有限数校验）', () => {
    const c = { type: 'angle', value: Number.NaN, a: faceRef('p0', 0), b: faceRef('p1', 5) } as unknown
    try {
      validateConstraints([c], MEMBERS)
      expect.unreachable('should have thrown')
    } catch (e) {
      expectPath(e, 'constraints[0].value')
    }
  })

  it('angle value=Infinity → 抛错（有限数）', () => {
    const c = { type: 'angle', value: Infinity, a: faceRef('p0', 0), b: faceRef('p1', 5) } as unknown
    expect(() => validateConstraints([c], MEMBERS)).toThrow(/constraints\[0\]\.value/)
  })

  it('faceIndex=0 → constraints[0].a.faceIndex（正整数，1 起）', () => {
    const c = {
      type: 'coincident',
      a: { part: 'p0', faceIndex: 0 },
      b: faceRef('p1', 5),
    } as unknown
    try {
      validateConstraints([c], MEMBERS)
      expect.unreachable('should have thrown')
    } catch (e) {
      expectPath(e, 'constraints[0].a.faceIndex')
    }
  })

  it('EntityRef 四形态互斥：face + point 同时给 → 抛错', () => {
    const c = {
      type: 'mate',
      a: {
        part: 'p0',
        face: { center: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] },
        point: [0, 0, 0],
      },
      b: faceRef('p1', 5),
    } as unknown
    try {
      validateConstraints([c], MEMBERS)
      expect.unreachable('should have thrown')
    } catch (e) {
      expectPath(e, 'constraints[0].a')
      expectPath(e, 'exactly one of face/edge/point/faceIndex')
    }
  })
})

describe('VT2: 10 种类型各 1 条合法样例通过', () => {
  it('mate/align/coincident/concentric/parallel/perpendicular（face 快照）', () => {
    for (const type of ['mate', 'align', 'coincident', 'concentric', 'parallel', 'perpendicular'] as const) {
      const c = { type, a: faceRef('p0', 0), b: faceRef('p1', 5) } as unknown
      expect(() => validateConstraints([c], MEMBERS), `type ${type}`).not.toThrow()
    }
  })

  it('distance/angle 带有限 value', () => {
    expect(() =>
      validateConstraints([{ type: 'distance', value: -3.5, a: faceRef('p0', 0), b: faceRef('p1', 5) }], MEMBERS),
    ).not.toThrow()
    // 不设区间：±360 以外合法（与 brepjs solveAngle 对齐）
    expect(() =>
      validateConstraints([{ type: 'angle', value: 720, a: faceRef('p0', 0), b: faceRef('p1', 5) }], MEMBERS),
    ).not.toThrow()
  })

  it('edge/point/faceIndex 三种实体形态合法', () => {
    expect(() =>
      validateConstraints([{
        type: 'concentric',
        a: { part: 'p0', edge: { axis: { origin: [0, 0, 0], direction: [0, 0, 1] } } },
        b: { part: 'p1', edge: { axis: { origin: [5, 0, 0], direction: [0, 0, 1] } } },
      }], MEMBERS),
    ).not.toThrow()
    expect(() =>
      validateConstraints([{
        type: 'coincident',
        a: { part: 'p0', point: [0, 0, 0] },
        b: { part: 'p1', point: [5, 0, 0] },
      }], MEMBERS),
    ).not.toThrow()
    expect(() =>
      validateConstraints([{
        type: 'coincident',
        a: { part: 'p0', faceIndex: 3 },
        b: faceRef('p1', 5),
      }], MEMBERS),
    ).not.toThrow()
  })

  it('fixed 只需顶层 part', () => {
    expect(() => validateConstraints([{ type: 'fixed', part: 'p0' }], MEMBERS)).not.toThrow()
  })

  it('face_mate（遗留形态）合法', () => {
    const c = {
      type: 'face_mate',
      fixedPartName: 'p0',
      movingPartName: 'p1',
      fixedFace: { surfaceType: 'plane', center: [0, 0, 0], normal: [0, 0, 1] },
      movingFace: { surfaceType: 'plane', center: [5, 0, 0], normal: [0, 0, -1] },
    } as unknown
    expect(() => validateConstraints([c], MEMBERS)).not.toThrow()
  })

  it('空 constraints 数组合法（纯 group 语义）', () => {
    expect(() => validateConstraints([], MEMBERS)).not.toThrow()
  })
})

describe('VT3: part 不在 members → 抛错且文案列出 members', () => {
  it('a.part 指向未知成员', () => {
    const c = {
      type: 'mate',
      a: faceRef('ghost', 0),
      b: faceRef('p1', 5),
    } as unknown
    try {
      validateConstraints([c], MEMBERS)
      expect.unreachable('should have thrown')
    } catch (e) {
      expectPath(e, 'constraints[0].a.part')
      expectPath(e, '"ghost" is not a member')
      expectPath(e, '[p0, p1]')
    }
  })

  it('fixed.part 指向未知成员', () => {
    try {
      validateConstraints([{ type: 'fixed', part: 'nope' }], MEMBERS)
      expect.unreachable('should have thrown')
    } catch (e) {
      expectPath(e, 'constraints[0].part')
      expectPath(e, '[p0, p1]')
    }
  })

  it('face_mate 的 fixed/moving part 也必须在 members（V6 → V5）', () => {
    const c = {
      type: 'face_mate',
      fixedPartName: 'p0',
      movingPartName: 'ghost',
      fixedFace: { surfaceType: 'plane', center: [0, 0, 0], normal: [0, 0, 1] },
      movingFace: { surfaceType: 'plane', center: [5, 0, 0], normal: [0, 0, -1] },
    } as unknown
    try {
      validateConstraints([c], MEMBERS)
      expect.unreachable('should have thrown')
    } catch (e) {
      expectPath(e, '[p0, p1]')
    }
  })
})

describe('VT4: 存量 face_mate 脚本经 assembly() 接入点继续工作', () => {
  it('assembly({ memberNames, constraints }) 显式名形态（face_mate 快照）', () => {
    // 与 assembly-replay.test.ts 的存量脚本同形态（legacy face_mate 快照面）
    expect(() =>
      assembly({
        name: 'A',
        members: [{}, {}] as unknown as Shape[],
        memberNames: ['part0', 'part1'],
        constraints: [{
          type: 'face_mate',
          fixedPartName: 'part0',
          movingPartName: 'part1',
          fixedFace: { surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] },
          movingFace: { surfaceType: 'plane', center: [40, 0, -5], normal: [0, 0, -1] },
        }] as AssemblyConstraint[],
      }),
    ).not.toThrow()
  })

  it('assembly() 非法约束在函数体开头抛错（接入点生效）', () => {
    expect(() =>
      assembly({
        name: 'A',
        members: [{}, {}] as unknown as Shape[],
        memberNames: ['part0', 'part1'],
        constraints: [{ type: 'bogus' } as unknown as AssemblyConstraint],
      }),
    ).toThrow(/constraints\[0\]\.type/)
  })
})