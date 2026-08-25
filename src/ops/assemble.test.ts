/**
 * 装配约束求解器测试 — E15.1
 *
 * 覆盖：
 * - solveFaceMate（面贴合求解）
 * - applyTransform（mesh 变换）
 * - previewAssembly（预览）
 * - executeDoAssemble（执行装配，含 mesh 变换 + 下游传播 + BREP 路径）
 */
import { describe, it, expect } from 'vitest'
import { solveFaceMate, applyTransform, previewAssembly, executeDoAssemble, executeAssemblyPassForStmt } from './assemble'
import type { Shape } from '../ops/types'
import type { FaceMateConstraint, AssemblyDefinition } from './assemble'
import type { PartScript, CadStatement } from '../lang/types'
import { asPartName, asStmtId, type PartName } from '../identity'

describe('E15.1: 装配约束求解器', () => {
  describe('solveFaceMate', () => {
    it('法线反向的两个平面面 → 旋转 0°（已贴合）', () => {
      const result = solveFaceMate(
        [0, 0, 5], [0, 0, 1],   // fixed: 顶面朝上
        [0, 0, 5], [0, 0, -1],  // moving: 底面朝下（已贴合）
      )
      // 旋转应该接近 identity
      expect(result.quaternion[0]).toBeCloseTo(0, 5)
      expect(result.quaternion[1]).toBeCloseTo(0, 5)
      expect(result.quaternion[2]).toBeCloseTo(0, 5)
      expect(result.quaternion[3]).toBeCloseTo(1, 5)
      // 平移应该接近 0
      expect(result.translation[0]).toBeCloseTo(0, 5)
      expect(result.translation[1]).toBeCloseTo(0, 5)
      expect(result.translation[2]).toBeCloseTo(0, 5)
    })

    it('法线同向的两个平面 → 旋转 180°（需要翻转贴合）', () => {
      const result = solveFaceMate(
        [0, 0, 5], [0, 0, 1],   // fixed: 顶面朝上
        [0, 0, 3], [0, 0, 1],   // moving: 顶面朝上（需要翻转）
      )
      // 平移应该使中心重合
      expect(result.translation[0]).toBeCloseTo(0, 5)
      expect(result.translation[1]).toBeCloseTo(0, 5)
      expect(result.translation[2]).toBeCloseTo(2, 5) // 5 - 3 = 2
    })

    it('法线垂直的两个平面', () => {
      const result = solveFaceMate(
        [0, 0, 5], [0, 0, 1],   // fixed: Z+
        [5, 0, 0], [1, 0, 0],   // moving: X+
      )
      // 旋转应该使 X+ → Z-
      // 旋转后平移使中心重合
      expect(result.translation[0]).toBeCloseTo(-5, 5)
      expect(result.translation[1]).toBeCloseTo(0, 5)
      expect(result.translation[2]).toBeCloseTo(5, 5)
    })
  })

  describe('applyTransform', () => {
    it('identity 变换不改变几何', () => {
      const shape: Shape = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      }
      const result = applyTransform(
        shape,
        [0, 0, 0, 1], // identity quaternion
        [0, 0, 0],
        [0, 0, 0],
        [1, 0, 0, 0, 1, 0, 0, 0, 1], // identity matrix
      )
      for (let i = 0; i < shape.positions.length; i++) {
        expect(result.positions[i]).toBeCloseTo(shape.positions[i], 5)
      }
    })

    it('纯平移', () => {
      const shape: Shape = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      }
      const result = applyTransform(
        shape,
        [0, 0, 0, 1],
        [0, 0, 0],
        [10, 20, 30],
        [1, 0, 0, 0, 1, 0, 0, 0, 1],
      )
      expect(result.positions[0]).toBeCloseTo(10, 5)
      expect(result.positions[1]).toBeCloseTo(20, 5)
      expect(result.positions[2]).toBeCloseTo(30, 5)
      expect(result.positions[3]).toBeCloseTo(11, 5)
    })
  })

  describe('previewAssembly', () => {
    it('返回每个 movingPartName 的变换', () => {
      const constraints: FaceMateConstraint[] = [{
        type: 'face_mate',
        fixedPartName: asPartName('part0_v0'),
        movingPartName: asPartName('part1_v0'),
        fixedFace: { surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] },
        movingFace: { surfaceType: 'plane', center: [0, 0, 3], normal: [0, 0, 1] },
      }]
      const result = previewAssembly(constraints)
      expect(result.size).toBe(1)
      expect(result.has(asPartName('part1_v0'))).toBe(true)
      const transform = result.get(asPartName('part1_v0'))!
      expect(transform.translation[2]).toBeCloseTo(2, 5)
    })
  })

  // ── executeDoAssemble 测试（含下游传播 + BREP 路径） ──

  describe('executeDoAssemble: mesh 变换', () => {
    it('对 moving part 的 outputCache 几何应用变换', () => {
      const movingShape: Shape = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      }
      const outputCache = new Map<PartName, Shape>([[asPartName('part1_v0'), movingShape]])

      const assemblyDef: AssemblyDefinition = {
        members: [asPartName('part0_v0'), asPartName('part1_v0')],
        constraints: [{
          type: 'face_mate',
          fixedPartName: asPartName('part0_v0'),
          movingPartName: asPartName('part1_v0'),
          fixedFace: { surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] },
          movingFace: { surfaceType: 'plane', center: [0, 0, 3], normal: [0, 0, 1] },
        }],
      }

      const results = executeDoAssemble(assemblyDef, outputCache)

      // 变换结果应写回 outputCache 和 results
      expect(results.has(asPartName('part1_v0'))).toBe(true)
      const transformed = outputCache.get(asPartName('part1_v0'))!
      // movingCenter=[0,0,3], movingNormal=[0,0,1], fixedCenter=[0,0,5], fixedNormal=[0,0,1]
      // solveFaceMate: 旋转180°绕Y轴 (normal [0,0,1] → [0,0,-1])，pivot=[0,0,3], translation=[0,0,2]
      // 顶点 [0,0,0]: R*(0-3)+3+2 = R*(-3)+5 → 旋转后 [0,0,3]+5 = [0,0,8]
      expect(transformed.positions[2]).toBeCloseTo(8, 5) // 第一个顶点 z: 0 → 8
    })

    it('不支持的约束类型抛错', () => {
      const outputCache = new Map<PartName, Shape>([[asPartName('part1_v0'), {
        positions: new Float32Array([0, 0, 0]),
        indices: new Uint32Array([0]),
      }]])
      const assemblyDef: AssemblyDefinition = {
        members: [asPartName('part1_v0')],
        constraints: [{
          type: 'coaxial' as 'face_mate',
          fixedPartName: asPartName('part0_v0'),
          movingPartName: asPartName('part1_v0'),
          fixedFace: { surfaceType: 'plane', center: [0, 0, 0], normal: [0, 0, 1] },
          movingFace: { surfaceType: 'plane', center: [0, 0, 0], normal: [0, 0, 1] },
        }],
      }
      expect(() => executeDoAssemble(assemblyDef, outputCache)).toThrow(/unsupported constraint type/)
    })

    it('moving part 不存在时抛错', () => {
      const outputCache = new Map<PartName, Shape>()
      const assemblyDef: AssemblyDefinition = {
        members: [asPartName('part0_v0'), asPartName('part1_v0')],
        constraints: [{
          type: 'face_mate',
          fixedPartName: asPartName('part0_v0'),
          movingPartName: asPartName('part1_v0'),
          fixedFace: { surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] },
          movingFace: { surfaceType: 'plane', center: [0, 0, 3], normal: [0, 0, 1] },
        }],
      }
      expect(() => executeDoAssemble(assemblyDef, outputCache)).toThrow(/moving part not found/)
    })
  })

  describe('executeDoAssemble: 下游 mesh 传播', () => {
    it('变换沿 inputs 链传播到下游 shape', () => {
      // 场景：part1_v0 是 moving part，part1_v1 = translate(part1_v0) 是下游
      const movingShape: Shape = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      }
      const downstreamShape: Shape = {
        positions: new Float32Array([0, 0, 10, 1, 0, 10, 0, 1, 10]),
        indices: new Uint32Array([0, 1, 2]),
      }
      const outputCache = new Map<PartName, Shape>([
        [asPartName('part1_v0'), movingShape],
        [asPartName('part1_v1'), downstreamShape],
      ])

      // 构造简单的 DAG：part1_v1 的 inputs 包含 part1_v0
      const statements: CadStatement[] = [
        { id: asStmtId('part0_v0'), op: 'box', args: {}, inputs: [] },
        { id: asStmtId('part1_v0'), op: 'box', args: {}, inputs: [] },
        { id: asStmtId('part1_v1'), op: 'translate', args: { offset: [0, 0, 10] }, inputs: [asPartName('part1_v0')] },
        { id: asStmtId('grp_1'), op: 'assembly', args: { members: ['part0_v0', 'part1_v0'] }, inputs: [] },
        { id: asStmtId('grp_2'), op: 'do_assemble', args: {}, inputs: [], assemblyTarget: asPartName('grp_1') },
      ]
      const script: PartScript = {
        statements,
        params: [],
      }

      const assemblyDef: AssemblyDefinition = {
        members: [asPartName('part0_v0'), asPartName('part1_v0')],
        constraints: [{
          type: 'face_mate',
          fixedPartName: asPartName('part0_v0'),
          movingPartName: asPartName('part1_v0'),
          fixedFace: { surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] },
          movingFace: { surfaceType: 'plane', center: [0, 0, 3], normal: [0, 0, 1] },
        }],
      }

      executeDoAssemble(assemblyDef, outputCache, { script })

      // moving part 应被变换
      // 顶点 [0,0,0] → 旋转180°绕Y轴, pivot=[0,0,3], translation=[0,0,2]
      // R*(-3)+3+2 = 3+5 = 8
      const transformedMoving = outputCache.get(asPartName('part1_v0'))!
      expect(transformedMoving.positions[2]).toBeCloseTo(8, 5)

      // 下游 part1_v1 也应被变换（同一变换）
      const transformedDownstream = outputCache.get(asPartName('part1_v1'))!
      // 原始下游 z = 10, 变换后: R*(10-3)+3+2 = R*7+5 → 旋转180°绕Y轴 [0,0,7]→[0,0,-7], -7+5 = -2
      expect(transformedDownstream.positions[2]).toBeCloseTo(-2, 5)
    })

    it('不传 script 时不传播下游', () => {
      const movingShape: Shape = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      }
      const downstreamShape: Shape = {
        positions: new Float32Array([0, 0, 10, 1, 0, 10, 0, 1, 10]),
        indices: new Uint32Array([0, 1, 2]),
      }
      const outputCache = new Map<PartName, Shape>([
        [asPartName('part1_v0'), movingShape],
        [asPartName('part1_v1'), downstreamShape],
      ])

      const assemblyDef: AssemblyDefinition = {
        members: [asPartName('part0_v0'), asPartName('part1_v0')],
        constraints: [{
          type: 'face_mate',
          fixedPartName: asPartName('part0_v0'),
          movingPartName: asPartName('part1_v0'),
          fixedFace: { surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] },
          movingFace: { surfaceType: 'plane', center: [0, 0, 3], normal: [0, 0, 1] },
        }],
      }

      // 不传 script → 不传播
      executeDoAssemble(assemblyDef, outputCache)

      // moving part 应被变换: 顶点 [0,0,0] → 8 (见上方计算)
      expect(outputCache.get(asPartName('part1_v0'))!.positions[2]).toBeCloseTo(8, 5)
      // 下游应保持不变
      expect(outputCache.get(asPartName('part1_v1'))!.positions[2]).toBeCloseTo(10, 5)
    })

    it('下游传播处理循环引用不无限递归', () => {
      // 构造一个自引用场景（不应出现在正常代码中，但函数不应卡死）
      const shape: Shape = {
        positions: new Float32Array([0, 0, 0]),
        indices: new Uint32Array([0]),
      }
      const outputCache = new Map<PartName, Shape>([
        [asPartName('part1_v0'), shape],
        [asPartName('part1_v1'), shape],
      ])

      // part1_v1 inputs 包含 part1_v0, part1_v0 inputs 包含 part1_v1（异常场景）
      const statements: CadStatement[] = [
        { id: asStmtId('part1_v0'), op: 'box', args: {}, inputs: [asPartName('part1_v1')] },
        { id: asStmtId('part1_v1'), op: 'translate', args: {}, inputs: [asPartName('part1_v0')] },
      ]
      const script: PartScript = {
        statements,
        params: [],
      }

      const assemblyDef: AssemblyDefinition = {
        members: [asPartName('part1_v0')],
        constraints: [{
          type: 'face_mate',
          fixedPartName: asPartName('part0_v0'),
          movingPartName: asPartName('part1_v0'),
          fixedFace: { surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] },
          movingFace: { surfaceType: 'plane', center: [0, 0, 3], normal: [0, 0, 1] },
        }],
      }

      // 不应抛栈溢出
      executeDoAssemble(assemblyDef, outputCache, { script })
      expect(outputCache.has(asPartName('part1_v0'))).toBe(true)
    })
  })

  describe('executeDoAssemble: 确定性', () => {
    it('同一约束执行两次结果一致', () => {
      const makeShape = (): Shape => ({
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      })

      const assemblyDef: AssemblyDefinition = {
        members: [asPartName('part0_v0'), asPartName('part1_v0')],
        constraints: [{
          type: 'face_mate',
          fixedPartName: asPartName('part0_v0'),
          movingPartName: asPartName('part1_v0'),
          fixedFace: { surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] },
          movingFace: { surfaceType: 'plane', center: [0, 0, 3], normal: [0, 0, 1] },
        }],
      }

      const cache1 = new Map<PartName, Shape>([[asPartName('part1_v0'), makeShape()]])
      const cache2 = new Map<PartName, Shape>([[asPartName('part1_v0'), makeShape()]])

      executeDoAssemble(assemblyDef, cache1)
      executeDoAssemble(assemblyDef, cache2)

      // 两次执行结果逐顶点比较
      const r1 = cache1.get(asPartName('part1_v0'))!.positions
      const r2 = cache2.get(asPartName('part1_v0'))!.positions
      for (let i = 0; i < r1.length; i++) {
        expect(r1[i]).toBeCloseTo(r2[i], 5)
      }
    })
  })

  // ── executeAssemblyPassForStmt 测试（从 do_assemble 语句执行装配 pass） ──

  describe('executeAssemblyPassForStmt', () => {
    /** 构造标准测试场景：两个 part + assembly 语句 + do_assemble 语句 */
    function makeScene() {
      const movingShape: Shape = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      }
      const fixedShape: Shape = {
        positions: new Float32Array([0, 0, 5, 1, 0, 5, 0, 1, 5]),
        indices: new Uint32Array([0, 1, 2]),
      }
      const outputCache = new Map<PartName, Shape>([
        [asPartName('part0_v0'), fixedShape],
        [asPartName('part1_v0'), movingShape],
      ])

      const constraints: FaceMateConstraint[] = [{
        type: 'face_mate',
        fixedPartName: asPartName('part0_v0'),
        movingPartName: asPartName('part1_v0'),
        fixedFace: { surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] },
        movingFace: { surfaceType: 'plane', center: [0, 0, 3], normal: [0, 0, 1] },
      }]

      const statements: CadStatement[] = [
        { id: asStmtId('part0_v0'), op: 'box', args: {}, inputs: [] },
        { id: asStmtId('part1_v0'), op: 'box', args: {}, inputs: [] },
        { id: asStmtId('grp_1'), op: 'assembly', args: { members: ['part0_v0', 'part1_v0'], constraints } as unknown as Record<string, import('../lang/types').Arg>, inputs: [] },
        { id: asStmtId('grp_2'), op: 'do_assemble', args: {}, inputs: [], assemblyTarget: asPartName('grp_1') },
      ]
      const script: PartScript = { statements, params: [] }

      return { outputCache, script, movingShape, fixedShape }
    }

    it('从 do_assemble 语句找到 assembly 语句并执行变换', () => {
      const { outputCache, script } = makeScene()
      const doAssembleStmt = script.statements.find(s => s.op === 'do_assemble')!

      const transformedIds = executeAssemblyPassForStmt(doAssembleStmt, outputCache, script)

      // moving part 应被变换（part1_v0）
      expect(transformedIds.has(asPartName('part1_v0'))).toBe(true)
      // assembly 的所有 members 都在 transformedIds 中（包括 fixed part）
      // 因为 executeAssemblyPassForStmt 收集 members + 下游传播的 parts
      expect(transformedIds.has(asPartName('part0_v0'))).toBe(true)

      // outputCache 中 moving shape 应被变换
      // 顶点 [0,0,0]: solveFaceMate(movingCenter=[0,0,3], movingNormal=[0,0,1], fixedCenter=[0,0,5], fixedNormal=[0,0,1])
      // 旋转180°绕Y轴, pivot=[0,0,3], translation=[0,0,2]
      // R*(-3)+3+2 = 3+5 = 8
      const transformed = outputCache.get(asPartName('part1_v0'))!
      expect(transformed.positions[2]).toBeCloseTo(8, 5)
    })

    it('do_assemble 没有 assemblyTarget 时返回空集合', () => {
      const { outputCache, script } = makeScene()
      const doAssembleStmt: CadStatement = {
        id: asStmtId('grp_2'),
        op: 'do_assemble',
        args: {},
        inputs: [],
        // 没有 assemblyTarget
      }

      const result = executeAssemblyPassForStmt(doAssembleStmt, outputCache, script)
      expect(result.size).toBe(0)
    })

    it('assemblyTarget 指向不存在的语句时返回空集合', () => {
      const { outputCache, script } = makeScene()
      const doAssembleStmt: CadStatement = {
        id: asStmtId('grp_2'),
        op: 'do_assemble',
        args: {},
        inputs: [],
        assemblyTarget: asPartName('nonexistent_stmt'),
      }

      const result = executeAssemblyPassForStmt(doAssembleStmt, outputCache, script)
      expect(result.size).toBe(0)
    })

    it('assemblyTarget 指向非 assembly 语句时返回空集合', () => {
      const { outputCache, script } = makeScene()
      const doAssembleStmt: CadStatement = {
        id: asStmtId('grp_2'),
        op: 'do_assemble',
        args: {},
        inputs: [],
        assemblyTarget: asPartName('part0_v0'), // part0_v0 是 box 语句，不是 assembly
      }

      const result = executeAssemblyPassForStmt(doAssembleStmt, outputCache, script)
      expect(result.size).toBe(0)
    })

    it('assembly 语句没有 constraints 时返回空集合', () => {
      const { outputCache, script } = makeScene()
      // 修改 assembly 语句，去掉 constraints
      const assemblyStmt = script.statements.find(s => s.op === 'assembly')!
      assemblyStmt.args = { members: ['part0_v0', 'part1_v0'] } // 没有 constraints

      const doAssembleStmt = script.statements.find(s => s.op === 'do_assemble')!
      const result = executeAssemblyPassForStmt(doAssembleStmt, outputCache, script)
      expect(result.size).toBe(0)
    })

    it('assembly 语句 constraints 为空数组时返回空集合', () => {
      const { outputCache, script } = makeScene()
      const assemblyStmt = script.statements.find(s => s.op === 'assembly')!
      assemblyStmt.args = { members: ['part0_v0', 'part1_v0'], constraints: [] }

      const doAssembleStmt = script.statements.find(s => s.op === 'do_assemble')!
      const result = executeAssemblyPassForStmt(doAssembleStmt, outputCache, script)
      expect(result.size).toBe(0)
    })

    it('下游 part 也包含在 transformedIds 中（沿 inputs 链传播）', () => {
      const movingShape: Shape = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      }
      const downstreamShape: Shape = {
        positions: new Float32Array([0, 0, 10, 1, 0, 10, 0, 1, 10]),
        indices: new Uint32Array([0, 1, 2]),
      }
      const outputCache = new Map<PartName, Shape>([
        [asPartName('part0_v0'), { positions: new Float32Array([0, 0, 5]), indices: new Uint32Array([0]) }],
        [asPartName('part1_v0'), movingShape],
        [asPartName('part1_v1'), downstreamShape],
      ])

      const constraints: FaceMateConstraint[] = [{
        type: 'face_mate',
        fixedPartName: asPartName('part0_v0'),
        movingPartName: asPartName('part1_v0'),
        fixedFace: { surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] },
        movingFace: { surfaceType: 'plane', center: [0, 0, 3], normal: [0, 0, 1] },
      }]

      const statements: CadStatement[] = [
        { id: asStmtId('part0_v0'), op: 'box', args: {}, inputs: [] },
        { id: asStmtId('part1_v0'), op: 'box', args: {}, inputs: [] },
        { id: asStmtId('part1_v1'), op: 'translate', args: { offset: [0, 0, 10] }, inputs: [asPartName('part1_v0')] },
        { id: asStmtId('grp_1'), op: 'assembly', args: { members: ['part0_v0', 'part1_v0'], constraints } as unknown as Record<string, import('../lang/types').Arg>, inputs: [] },
        { id: asStmtId('grp_2'), op: 'do_assemble', args: {}, inputs: [], assemblyTarget: asPartName('grp_1') },
      ]
      const script: PartScript = { statements, params: [] }

      const doAssembleStmt = statements.find(s => s.op === 'do_assemble')!
      const transformedIds = executeAssemblyPassForStmt(doAssembleStmt, outputCache, script)

      // moving part + 下游 part 都应在集合中
      expect(transformedIds.has(asPartName('part1_v0'))).toBe(true)
      expect(transformedIds.has(asPartName('part1_v1'))).toBe(true)

      // 下游 shape 也应被变换
      // 原始下游 z = 10, 变换后: R*(0,0,7)+5 → -7+5 = -2
      const transformedDownstream = outputCache.get(asPartName('part1_v1'))!
      expect(transformedDownstream.positions[2]).toBeCloseTo(-2, 5)
    })

    it('与 executeDoAssemble 结果一致（同一变换）', () => {
      const { outputCache, script, movingShape } = makeScene()

      // 直接调 executeDoAssemble
      const directCache = new Map<PartName, Shape>([
        [asPartName('part0_v0'), { positions: new Float32Array([0, 0, 5]), indices: new Uint32Array([0]) }],
        [asPartName('part1_v0'), { positions: new Float32Array([...movingShape.positions]), indices: new Uint32Array([...movingShape.indices]) }],
      ])
      const assemblyDef: AssemblyDefinition = {
        members: [asPartName('part0_v0'), asPartName('part1_v0')],
        constraints: [{
          type: 'face_mate',
          fixedPartName: asPartName('part0_v0'),
          movingPartName: asPartName('part1_v0'),
          fixedFace: { surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] },
          movingFace: { surfaceType: 'plane', center: [0, 0, 3], normal: [0, 0, 1] },
        }],
      }
      executeDoAssemble(assemblyDef, directCache, { script })

      // 调 executeAssemblyPassForStmt
      const doAssembleStmt = script.statements.find(s => s.op === 'do_assemble')!
      executeAssemblyPassForStmt(doAssembleStmt, outputCache, script)

      // 两个路径的结果应一致
      const directResult = directCache.get(asPartName('part1_v0'))!.positions
      const stmtResult = outputCache.get(asPartName('part1_v0'))!.positions
      for (let i = 0; i < directResult.length; i++) {
        expect(stmtResult[i]).toBeCloseTo(directResult[i], 5)
      }
    })
  })
})