import { describe, it, expect } from 'vitest'
import { resolveArgs, resolveArgsWithInfo, isObjectForm, type ArgSpec } from './dual-form-args'
import { getRuntimeState } from '../../runtime-state'

describe('dual-form-args', () => {
  describe('isObjectForm', () => {
    it('returns true for plain object', () => {
      expect(isObjectForm([{ size: 10 }])).toBe(true)
    })

    it('returns false for Shape (registered in runtime state)', () => {
      const shape = { mesh: {}, kind: 'solid' as const, hasBrep: true }
      getRuntimeState().created.add(shape)
      try {
        expect(isObjectForm([shape])).toBe(false)
      } finally {
        getRuntimeState().created.delete(shape)
      }
    })

    it('returns false for array', () => {
      expect(isObjectForm([[1, 2, 3]])).toBe(false)
    })

    it('returns false for number', () => {
      expect(isObjectForm([42])).toBe(false)
    })

    it('returns false for string', () => {
      expect(isObjectForm(['hello'])).toBe(false)
    })

    it('returns false for null', () => {
      expect(isObjectForm([null])).toBe(false)
    })

    it('returns false for empty args', () => {
      expect(isObjectForm([])).toBe(false)
    })

    it('returns false for class instance', () => {
      class Vec3 {
        constructor(public x: number, public y: number, public z: number) {}
      }
      expect(isObjectForm([new Vec3(1, 2, 3)])).toBe(false)
    })

    it('returns false for handle-like object', () => {
      const handle = { wrapped: { id: 1, type: 'solid' } }
      expect(isObjectForm([handle])).toBe(false)
    })
  })

  describe('resolveArgs', () => {
    const specA: ArgSpec = {
      name: 'box',
      params: ['width', 'depth', 'height'],
      formClass: 'A',
    }

    const specB1: ArgSpec = {
      name: 'thread',
      params: ['radius', 'pitch', 'height'],
      formClass: 'B1',
    }

    const specNoParams: ArgSpec = {
      name: 'torus',
      formClass: 'A',
    }

    const specB2: ArgSpec = {
      name: 'thread_euler',
      params: ['radius', 'pitch', 'height'],
      formClass: 'B2',
    }

    it('A class: positional form passes through', () => {
      const result = resolveArgs([10, 20, 30], specA)
      expect(result).toEqual([10, 20, 30])
    })

    it('A class: object form normalizes to positional', () => {
      const result = resolveArgs([{ width: 10, depth: 20, height: 30 }], specA)
      expect(result).toEqual([10, 20, 30])
    })

    it('A class: object form with missing keys fills undefined', () => {
      const result = resolveArgs([{ width: 10 }], specA)
      expect(result).toEqual([10, undefined, undefined])
    })

    it('A class: object form with extra keys throws E_ARGS_FORM', () => {
      expect(() => resolveArgs([{ width: 10, unknown: 1 }], specA)).toThrow('E_ARGS_FORM')
    })

    it('B1 class: positional form passes through', () => {
      const result = resolveArgs([5, 1, 20], specB1)
      expect(result).toEqual([5, 1, 20])
    })

    it('B1 class: object form normalizes to positional', () => {
      const result = resolveArgs([{ radius: 5, pitch: 1 }], specB1)
      expect(result).toEqual([5, 1, undefined])
    })

    it('B2 class: always passes through (fixed form)', () => {
      const result = resolveArgs([{ radius: 5 }], specB2)
      expect(result).toEqual([{ radius: 5 }])
    })

    it('B2 class: positional passes through', () => {
      const result = resolveArgs([5, 1, 20], specB2)
      expect(result).toEqual([5, 1, 20])
    })

    it('no params: positional passes through', () => {
      const result = resolveArgs([10, 20, 30], specNoParams)
      expect(result).toEqual([10, 20, 30])
    })

    it('no params: object form throws E_ARGS_FORM', () => {
      expect(() => resolveArgs([{ size: 10 }], specNoParams)).toThrow('E_ARGS_FORM')
    })

    it('Shape input passes through', () => {
      const shape = { mesh: {}, kind: 'solid' as const, hasBrep: true }
      getRuntimeState().created.add(shape)
      try {
        const result = resolveArgs([shape, 10], specA)
        expect(result).toEqual([shape, 10])
      } finally {
        getRuntimeState().created.delete(shape)
      }
    })

    it('Array input passes through', () => {
      const result = resolveArgs([[1, 2, 3]], specA)
      expect(result).toEqual([[1, 2, 3]])
    })

    it('Number input passes through', () => {
      const result = resolveArgs([42], specA)
      expect(result).toEqual([42])
    })
  })

  describe('resolveArgsWithInfo', () => {
    const specA: ArgSpec = {
      name: 'box',
      params: ['width', 'depth', 'height'],
      formClass: 'A',
    }

    it('positional form returns isObjectForm=false', () => {
      const result = resolveArgsWithInfo([10, 20, 30], specA)
      expect(result).toEqual({ args: [10, 20, 30], isObjectForm: false })
    })

    it('object form returns isObjectForm=true', () => {
      const result = resolveArgsWithInfo([{ width: 10, depth: 20, height: 30 }], specA)
      expect(result).toEqual({ args: [10, 20, 30], isObjectForm: true })
    })

    it('empty object normalizes correctly', () => {
      const result = resolveArgsWithInfo([{}], specA)
      expect(result).toEqual({ args: [undefined, undefined, undefined], isObjectForm: true })
    })

    it('object with partial keys', () => {
      const result = resolveArgsWithInfo([{ width: 10, height: 30 }], specA)
      expect(result).toEqual({ args: [10, undefined, 30], isObjectForm: true })
    })
  })

  describe('edge cases', () => {
    it('undefined args', () => {
      const spec: ArgSpec = { name: 'test', params: ['a'], formClass: 'A' }
      expect(() => resolveArgs(undefined as unknown as unknown[], spec)).toThrow()
    })

    it('null first arg', () => {
      expect(isObjectForm([null])).toBe(false)
    })

    it('object prototype pollution attempt — non-Object.prototype prototype rejected', () => {
      const obj = Object.create({ polluted: true })
      obj.safe = 1
      const spec: ArgSpec = { name: 'test', params: ['safe'], formClass: 'A' }
      // Object.create({ polluted: true }) → prototype is { polluted: true }, not Object.prototype
      // so isObjectForm returns false, and resolveArgs passes through as positional form
      expect(isObjectForm([obj])).toBe(false)
      expect(resolveArgs([obj], spec)).toEqual([obj])
    })

    it('plain object with extra keys throws E_ARGS_FORM', () => {
      const spec: ArgSpec = { name: 'test', params: ['safe'], formClass: 'A' }
      expect(() => resolveArgs([{ safe: 1, evil: 2 }], spec)).toThrow('E_ARGS_FORM')
    })
  })
})
