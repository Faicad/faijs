/**
 * 装配约束求解器测试 — E15.1
 */
import { describe, it, expect } from 'vitest'
import { solveFaceMate, applyTransform, previewAssembly } from './assemble'
import type { Shape } from '../ops/types'
import type { FaceMateConstraint } from './assemble'

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

    it('法线同向的两个平面面 → 旋转 180°（需要翻转贴合）', () => {
      const result = solveFaceMate(
        [0, 0, 5], [0, 0, 1],   // fixed: 顶面朝上
        [0, 0, 3], [0, 0, 1],   // moving: 顶面朝上（需要翻转）
      )
      // 平移应该使中心重合
      expect(result.translation[0]).toBeCloseTo(0, 5)
      expect(result.translation[1]).toBeCloseTo(0, 5)
      expect(result.translation[2]).toBeCloseTo(2, 5) // 5 - 3 = 2
    })

    it('法线垂直的两个平面面', () => {
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
        fixedPartName: 'part0_v0',
        movingPartName: 'part1_v0',
        fixedFace: { faceId: 'f0', surfaceType: 'plane', center: [0, 0, 5], normal: [0, 0, 1] },
        movingFace: { faceId: 'f1', surfaceType: 'plane', center: [0, 0, 3], normal: [0, 0, 1] },
      }]
      const result = previewAssembly(constraints)
      expect(result.size).toBe(1)
      expect(result.has('part1_v0')).toBe(true)
      const transform = result.get('part1_v0')!
      expect(transform.translation[2]).toBeCloseTo(2, 5)
    })
  })
})
