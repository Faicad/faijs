import { describe, it, expect } from 'vitest'
import { resolveArgs, resolveArgsWithInfo, isObjectForm, positionalToObject, type ArgSpec, type SlotMap } from './dual-form-args'
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
      params: ['options'],
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

    it('B1 class: brepjs options 对象即唯一对象形态，两个形态都原样透传（§4.2「无需判别」）', () => {
      // B1（P23 语义修正）：B1 的 brepjs 位置形态首参本身就是配置对象（如
      // thread(options: ThreadOptions)），对象形态与它在首参上撞型、判别式失效，
      // 因此 B1 一律原样返回——否则任何 options 键都会被误判成 params 外未知键
      // 而抛 E_ARGS_FORM（thread 的 params 表是 ['options']）。
      const obj = { radius: 5, pitch: 1, height: 20 }
      expect(resolveArgs([obj], specB1)).toEqual([obj])
      expect(resolveArgs([5, 1, 20], specB1)).toEqual([5, 1, 20])
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

  describe('positionalToObject（D11 反方向：faijs 特有 dual op 位置→对象）', () => {
    const boxForm: SlotMap = { keys: ['width', 'depth', 'height'] }
    const cylinderForm: SlotMap = { keys: ['radius', 'height'] }
    const translateForm: SlotMap = { keys: ['offset'], vec3Keys: ['offset'], shapeArity: 1 }

    it('三个标量装箱为独立键（box(10,20,30) → {width,depth,height}）', () => {
      expect(positionalToObject([10, 20, 30], boxForm, 'box')).toEqual([
        { width: 10, depth: 20, height: 30 },
      ])
    })

    it('单个标量只填 width 键（box(20) → {width:20}，缺 depth/height 由 impl 断言报错）', () => {
      expect(positionalToObject([20], boxForm, 'box')).toEqual([{ width: 20 }])
    })

    it('部分标量装箱（box(10, 20) → {width:10, depth:20}）', () => {
      expect(positionalToObject([10, 20], boxForm, 'box')).toEqual([{ width: 10, depth: 20 }])
    })

    it('已是对象形态 → 原样返回（box({width:20}) 不动）', () => {
      const args = [{ width: 20 }]
      expect(positionalToObject(args, boxForm, 'box')).toBe(args)
    })

    it('两个标量槽（cylinder(5,40) → {radius:5,height:40}）', () => {
      expect(positionalToObject([5, 40], cylinderForm, 'cylinder')).toEqual([
        { radius: 5, height: 40 },
      ])
    })

    it('前置 Shape 形参透传（translate(shape,1,0,0) → [shape,{offset:[1,0,0]}]）', () => {
      const shape = { marker: 'shape' }
      const out = positionalToObject([shape, 1, 0, 0], translateForm, 'translate')
      expect(out[0]).toBe(shape)
      expect(out[1]).toEqual({ offset: [1, 0, 0] })
    })

    it('translate(shape,{offset}) 对象形态原样返回', () => {
      const shape = { marker: 'shape' }
      const args = [shape, { offset: [1, 0, 0] }]
      expect(positionalToObject(args, translateForm, 'translate')).toBe(args)
    })

    it('位置参数个数超出槽位 → E_ARGS_FORM', () => {
      expect(() => positionalToObject([1, 2, 3, 4], boxForm, 'box')).toThrow('E_ARGS_FORM')
    })

    it('实参不足（box()）→ 原样返回，交由 op 自身断言报错', () => {
      expect(positionalToObject([], boxForm, 'box')).toEqual([])
    })

    // ── §6.2：尾参 options 合并（brepjs 形态 + options 尾参） ──

    it('三个位置槽装箱后尾参 options 合并（box(10,20,30,{centered:true})）', () => {
      expect(positionalToObject([10, 20, 30, { centered: true }], boxForm, 'box')).toEqual([
        { width: 10, depth: 20, height: 30, centered: true },
      ])
    })

    it('单标量 + options（box(20,{centered:true}) → {width:20,centered:true}）', () => {
      expect(positionalToObject([20, { centered: true }], boxForm, 'box')).toEqual([
        { width: 20, centered: true },
      ])
    })

    it('位置槽 + options（cylinder(5,40,{centered:true}）', () => {
      expect(positionalToObject([5, 40, { centered: true }], cylinderForm, 'cylinder')).toEqual([
        { radius: 5, height: 40, centered: true },
      ])
    })

    it('单槽 + options（sphere(5,{at:[0,0,10],segments:32})）', () => {
      const sphereForm: SlotMap = { keys: ['radius'] }
      expect(positionalToObject([5, { at: [0, 0, 10], segments: 32 }], sphereForm, 'sphere')).toEqual([
        { radius: 5, at: [0, 0, 10], segments: 32 },
      ])
    })

    it('尾部 options 键与位置槽键冲突 → E_ARGS_FORM', () => {
      expect(() => positionalToObject([5, 40, { height: 40 }], cylinderForm, 'cylinder')).toThrow(
        'E_ARGS_FORM',
      )
    })

    it('尾部多余实参不是 plain object → 维持 E_ARGS_FORM', () => {
      expect(() => positionalToObject([1, 2, 3, 4], boxForm, 'box')).toThrow('E_ARGS_FORM')
    })
  })
})
