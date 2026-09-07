/**
 * codegen roundtrip — 装配约束的 parse → codegen → 再 parse 一致性（P2-f2）
 *
 * 不改 codegen 实现（对象字面量参数通用发射已覆盖新约束类型），只加测试锁死 roundtrip：
 * `.fai.js` 文本 → parse → codegen → 再 parse，两次 parse 产出的 `constraints` 参数
 * **结构深度相等**（toEqual）。覆盖：9 种新类型 + `face_mate` 遗留形态 + `EntityRef`
 * 四形态（face 快照 / face{topoRef} / edge{axis} / point / faceIndex）+ TopoRef 字面量
 * + 裸变量 members；`asmN.solve()` 与 `asmN.do_assemble()` 两种末行各一个样本。
 */

import { describe, it, expect } from 'vitest'
import { parseScript } from './parser'
import { scriptIRToCode } from './codegen'

/** 样本装配脚本（主样本照抄 09-07 方案 §2.2；末行 asm1.solve()）。 */
const MAIN_SAMPLE = `let part0 = cad.box(60, 40, 10, { centered: true })
let part1 = cad.box(30, 30, 20, { centered: true })
let part2 = cad.cylinder(6, 60, { centered: true })
let part3 = cad.cylinder(15, 10, { centered: true })

let asm1 = cad.assembly({
name: '主轴组件',
members: [part0, part1, part2, part3],
constraints: [
{ type: 'fixed', part: 'part0' },
{ type: 'mate',
a: { part: 'part0', face: { surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] } },
b: { part: 'part1', face: { surfaceType: 'plane', center: [0, 0, -10], normal: [0, 0, -1] } } },
{ type: 'align',
a: { part: 'part0', face: { center: [0, 0, 5], normal: [0, 0, 1] } },
b: { part: 'part1', face: { center: [0, 0, -10], normal: [0, 0, 1] } } },
{ type: 'coincident',
a: { part: 'part0', face: { center: [0, 0, 5], normal: [0, 0, 1] } },
b: { part: 'part1', face: { center: [0, 0, -10], normal: [0, 0, -1] } } },
{ type: 'concentric',
a: { part: 'part1', edge: { axis: { origin: [0, 0, 10], direction: [0, 0, 1] } } },
b: { part: 'part2', edge: { axis: { origin: [0, 0, 0], direction: [0, 0, 1] } } } },
{ type: 'distance', value: 12,
a: { part: 'part1', face: { center: [15, 0, 10], normal: [1, 0, 0] } },
b: { part: 'part3', face: { center: [0, 0, -5], normal: [0, 0, -1] } } },
{ type: 'angle', value: 30,
a: { part: 'part0', face: { center: [0, 0, 5], normal: [0, 0, 1] } },
b: { part: 'part1', face: { center: [0, 0, -10], normal: [0, 0, -1] } } },
{ type: 'parallel',
a: { part: 'part0', face: { center: [0, 0, 5], normal: [0, 0, 1] } },
b: { part: 'part1', face: { center: [0, 0, -10], normal: [0, 0, -1] } } },
{ type: 'perpendicular',
a: { part: 'part0', face: { center: [0, 0, 5], normal: [0, 0, 1] } },
b: { part: 'part1', face: { center: [0, 0, -10], normal: [0, 0, -1] } } },
{ type: 'mate',
a: { part: 'part0', face: { topoRef: { kind: 'face', origin: 'part0', role: 'box:top',
hint: { kind: 'face', surfaceType: 'plane' } } } },
b: { part: 'part2', face: { topoRef: { kind: 'face', origin: 'part2', role: 'cylinder:bottom',
hint: { kind: 'face' } } } } },
{ type: 'face_mate',
fixedPartName: 'part0', movingPartName: 'part3',
fixedFace: { surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] },
movingFace: { surfaceType: 'plane', center: [0, 0, -5], normal: [0, 0, -1] } },
],
})
asm1.solve()
`

/** 从 parse 结果里取第一条 `cad.assembly` 语句的 constraints（嵌套在 args 里）。 */
function assemblyConstraintsOf(code: string): unknown {
  const { script } = parseScript(code)
  const stmt = script.statements.find((s) => s.callee === 'assembly')
  if (!stmt) throw new Error('no assembly statement found')
  return (stmt.args as { constraints?: unknown }).constraints
}

/** 全样本 roundtrip：parse → codegen → 再 parse，constraints 结构深度相等。 */
function expectConstraintsRoundtrip(code: string, expectedCount: number): void {
  const first = assemblyConstraintsOf(code)
  expect(Array.isArray(first)).toBe(true)
  expect((first as unknown[]).length).toBe(expectedCount)

  const regenerated = scriptIRToCode(parseScript(code).script)
  // codegen 产物包含装配链式调用语法，末行形态保留
  expect(regenerated).toContain('cad.assembly(')
  const second = assemblyConstraintsOf(regenerated)
  expect(second).toEqual(first)
}

describe('P2-f2: 装配约束 codegen roundtrip（结构深度相等）', () => {
  it('主样本（10 种约束 + face 快照/face topoRef/edge axis 形态，末行 asm1.solve()）', () => {
    expectConstraintsRoundtrip(MAIN_SAMPLE, 11)
  })

  it('同一 constraints 结构，末行换为 asm1.do_assemble()', () => {
    const code = MAIN_SAMPLE.replace('asm1.solve()', 'asm1.do_assemble()')
    expectConstraintsRoundtrip(code, 11)
  })

  it('EntityRef 四形态全覆盖样本（含 point 与 faceIndex）', () => {
    const code = `let part0 = cad.box(20, 20, 20, { centered: true })
let part1 = cad.box(10, 10, 10, { centered: true, at: [30, 0, 0] })
let asm2 = cad.assembly({
  name: 'Forms',
  members: [part0, part1],
  constraints: [
    { type: 'fixed', part: 'part0' },
    { type: 'coincident',
      a: { part: 'part0', point: [0, 0, 0] },
      b: { part: 'part1', point: [30, 0, 0] } },
    { type: 'coincident',
      a: { part: 'part0', faceIndex: 1 },
      b: { part: 'part1', face: { center: [30, 0, 0], normal: [0, 0, 1] } } },
    { type: 'concentric',
      a: { part: 'part0', edge: { topoRef: { kind: 'edge', origin: 'part0', role: 'box:top:edge1', hint: { kind: 'edge', curveType: 'line' } } } },
      b: { part: 'part1', edge: { axis: { origin: [30, 0, 0], direction: [0, 0, 1] } } } },
  ],
})
asm2.solve()
`
    expectConstraintsRoundtrip(code, 4)
  })

  it('parse → codegen 产物可被再次 parse（两次 constraints 一致的前提下，members 也一致）', () => {
    const code = MAIN_SAMPLE
    const first = assemblyConstraintsOf(code)
    const regenerated = scriptIRToCode(parseScript(code).script)
    // 再 parse 的 members（裸变量引用 → 变量名字符串数组）也应一致
    const { script } = parseScript(regenerated)
    const stmt = script.statements.find((s) => s.callee === 'assembly')!
    // 裸变量 members 在 IR 里是 `{$ref}` 引用形态，codegen 发射裸变量、re-parse 复原（无损）
    expect((stmt.args as { members?: unknown }).members).toEqual([
      { $ref: 'part0' }, { $ref: 'part1' }, { $ref: 'part2' }, { $ref: 'part3' },
    ])
    expect(assemblyConstraintsOf(regenerated)).toEqual(first)
  })

  it('P3: joints + drive 参数 roundtrip（结构深度相等）', () => {
    const code = `let part0 = cad.box(60, 40, 10, { centered: true })
let part1 = cad.box(10, 10, 80, { centered: false })

let asm1 = cad.assembly({
  name: '摆臂',
  members: [part0, part1],
  joints: [
    { type: 'revolute', parent: 'part0', child: 'part1',
      axis: { origin: [0, 0, 10], direction: [0, 0, 1] },
      min: 0, max: 120, value: 30 },
    { type: 'prismatic', parent: 'part0', child: 'part1',
      axis: { origin: [0, 0, 10], direction: [0, 0, 1] },
      min: 0, max: 50, value: 10,
      offset: { position: [2, 0, 0], rotation: [0, 0, 0, 1] } },
  ],
  drive: { part1: [30, 10] },
})
asm1.solve()
`
    const firstParsed = parseScript(code)
    const { script } = firstParsed
    const stmt = script.statements.find((s) => s.callee === 'assembly')!
    const args = stmt.args as { joints?: unknown; drive?: unknown }
    expect(args.joints).toBeDefined()
    expect(args.drive).toEqual({ part1: [30, 10] })

    const regenerated = scriptIRToCode(script)
    expect(regenerated).toContain('cad.assembly(')
    const secondParsed = parseScript(regenerated)
    const stmt2 = secondParsed.script.statements.find((s) => s.callee === 'assembly')!
    const args2 = stmt2.args as { joints?: unknown; drive?: unknown }
    expect(args2.joints).toEqual(args.joints)
    expect(args2.drive).toEqual(args.drive)
  })

  it('P3: joints 含多 DOF 类型也可 roundtrip（构造期校验才抛错，文本层不拦）', () => {
    const code = `let part0 = cad.box(20, 20, 20, { centered: true })
let part1 = cad.box(10, 10, 10, { centered: true, at: [30, 0, 0] })
let asm2 = cad.assembly({
  name: 'Multi',
  members: [part0, part1],
  joints: [
    { type: 'spherical', parent: 'part0', child: 'part1',
      axis: { origin: [10, 0, 0], direction: [0, 0, 1] },
      min: -180, max: 180, value: 0 },
  ],
})
asm2.solve()
`
    const regenerated = scriptIRToCode(parseScript(code).script)
    const { script } = parseScript(regenerated)
    const stmt = script.statements.find((s) => s.callee === 'assembly')!
    const joints = (stmt.args as { joints?: unknown }).joints as Array<{ type: string }>
    expect(joints.length).toBe(1)
    expect(joints[0]!.type).toBe('spherical')
  })
})