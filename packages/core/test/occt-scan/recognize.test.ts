/**
 * 回归测试：occt-scan/recognize.ts 的识别层（方案 §7.2 缺陷 1 + §7.5 陷阱 1）。
 *
 * 覆盖四类形态（旧正则两头都错，见方案）：
 *   1. `<k>.method(...)` 普通直调
 *   2. `const x = <k>.<m>.bind(k)` / `(<cast>).<m>.call(k,...)` 绑定/调用点
 *   3. `const { m } = <k>` / `{ m: mm }` 解构别名
 *   4. 陷阱 1：`const kernel = getBrepApi()`（L1 契约句柄）的调用不得误判为 occt 直调。
 */

import { describe, expect, it } from 'vitest'
import { kernelIdentifiers, methodAliases, kernelCallsIn } from '../../src/occt-scan/recognize'

const OCC = new Set(['linearPattern', 'makeVertex', 'loft', 'thicken', 'offset'])

describe('recognize.kernelIdentifiers', () => {
  it('识别 getOcctKernel() 直接获取的句柄', () => {
    const ids = kernelIdentifiers('const k = getOcctKernel()\nconst kernel = getOcctKernel()')
    expect(ids).toEqual(new Set(['k', 'kernel']))
  })
  it('识别 getBrepApi() 的两个 handle 混排时不误收 brep 句柄（陷阱 1）', () => {
    const ids = kernelIdentifiers('const k = getOcctKernel()\nconst kernel = getBrepApi()')
    expect(ids.has('k')).toBe(true)
    expect(ids.has('kernel')).toBe(false)
  })
  it('穿透层层 cast 的别名（`as` / 非空断言）', () => {
    const ids = kernelIdentifiers('const raw = getOcctKernel()\nconst k2 = raw as unknown as Foo\nconst k3 = k2!')
    expect(ids.has('raw')).toBe(true)
    expect(ids.has('k2')).toBe(true)
    expect(ids.has('k3')).toBe(true)
  })
})

describe('recognize.methodAliases', () => {
  it('解析放样解构 `const { m: mm } = k` 的别名', () => {
    const ids = kernelIdentifiers('const k = getOcctKernel()\nconst { loft: lo, makeVertex: mv } = k')
    const alias = methodAliases('const k = getOcctKernel()\nconst { loft: lo, makeVertex: mv } = k', ids)
    expect(alias.get('lo')).toBe('loft')
    expect(alias.get('mv')).toBe('makeVertex')
  })
})

describe('recognize.kernelCallsIn', () => {
  it('普通直调 `<k>.method(...)`', () => {
    const src = 'const k = getOcctKernel()\nk.makeVertex(0, 0, 0)'
    expect(kernelCallsIn(src, OCC)).toEqual(new Set(['makeVertex']))
  })
  it('链式 `getOcctKernel().loft(...)`', () => {
    const src = 'getOcctKernel().loft(wires, true, true)'
    expect(kernelCallsIn(src, OCC)).toEqual(new Set(['loft']))
  })
  it('bound 别名调用：`const x = k.linearPattern.bind(k); x(...)` 还原成 linearPattern', () => {
    const src = 'const k = getOcctKernel()\nconst lp = k.linearPattern.bind(k)\nlp(shape, true, 4, 4)'
    expect(kernelCallsIn(src, OCC)).toEqual(new Set(['linearPattern']))
  })
  it('`<cast>).m.call(k, ...)` 调用点计入 m', () => {
    const src = 'const k = getOcctKernel()\n;(k as any).thicken.call(k, s, 2)'
    expect(kernelCallsIn(src, OCC)).toEqual(new Set(['thicken']))
  })
  it('解构别名调用：`const { m } = k; m(...)`', () => {
    const src = 'const k = getOcctKernel()\nconst { makeVertex } = k\nmakeVertex(1, 2, 3)'
    expect(kernelCallsIn(src, OCC)).toEqual(new Set(['makeVertex']))
  })
  it('陷阱 1：getBrepApi() 句柄的方法调用不被计为 occt 直调', () => {
    const src = 'const kernel = getBrepApi()\nkernel.someContractCall()\nkernel.offset()'
    expect(kernelCallsIn(src, OCC)).toEqual(new Set())
  })
  it('陷阱 1：getBrepApi 与 getOcctKernel 混排时只认后者', () => {
    const src = 'const k = getOcctKernel()\nconst kernel = getBrepApi()\nk.offset(a, 1)\nkernel.offset(b, 2)'
    expect(kernelCallsIn(src, OCC)).toEqual(new Set(['offset']))
  })
})