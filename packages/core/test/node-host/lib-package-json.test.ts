/**
 * @vitest-environment node
 *
 * lib-package-json.test.ts — 库 `package.json` 的读盘通道（内核取用面收敛 2026-10-14）
 *
 * 钉住一个**曾经静默失效**的缺陷：定位 `package.json` 时写
 * `createRequire().resolve(`${pkg}/package.json`)`，Node 的 `exports` 门禁对没在
 * `exports` 里列出 `./package.json` 的包恒抛 `ERR_PACKAGE_PATH_NOT_EXPORTED` —— 而本仓
 * **全部库都没列**。异常被吞成 `undefined`，于是 `faijs.autoLift` 与 `faijs.lib`
 * 一条都读不到：库的两级引擎声明与提升开关全部静默失效。
 *
 * 两值并钉（当前值 / 应有正确值）：
 *   · 错误值（修复前的实现）：`readLibPackageJson('@faicad/faijs-gears')` → `undefined`；
 *   · 正确值（现在）：返回盘上那份 `package.json`，`faijs.lib.platform = ['occt']`。
 * 缺陷根因（那条必抛的 resolve）作为复现证据留在第一个用例里。
 *
 * Run: npx vitest run test/node-host/lib-package-json.test.ts
 */

import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readLibPackageJson, resolveLibPackageJsonPath } from '../../src/node-host/lib-package-json'

/** 本文件只消费 `package.json` 的两段；其余字段不读。 */
interface LibPj {
  faijs?: { autoLift?: boolean; lib?: unknown }
  peerDependencies?: Record<string, string>
}

describe('resolveLibPackageJsonPath — 不走 exports 门禁', () => {
  it('定位得到盘上的 package.json（修复前这条路恒 undefined）', () => {
    // 缺陷根因的复现证据：exports 门禁让这条 resolve 必抛，本仓库都没导出 ./package.json。
    // 实测文案：`Package subpath './package.json' is not defined by "exports" in <pkg>/package.json`。
    const req = createRequire(import.meta.url)
    expect(() => req.resolve('@faicad/faijs-gears/package.json')).toThrow(/not defined by "exports"/)

    const p = resolveLibPackageJsonPath('@faicad/faijs-gears')
    expect(p).toBeDefined()
    // 走的是 `require.resolve.paths()` 的基准目录，npm workspace 下第一个命中是**提升后的
    // 那份** `node_modules/@faicad/faijs-gears`（它是指向 `packages/faijs-gears` 的软链），
    // 不是源码目录本身。两条路同名同内容，故此处只钉「落在该包的 package.json」——钉具体
    // 是源码目录会假失败，钉成 `node_modules` 又会在非 workspace 消费方下反过来假失败。
    expect(p!.replaceAll('\\', '/')).toMatch(/(?:^|\/)(?:packages|node_modules)\/@?faicad\/faijs-gears\/package\.json$/)
    expect(p!.endsWith('package.json')).toBe(true)
  })

  it('未知包 → undefined（不抛错：装配期按「未声明」处理）', () => {
    expect(resolveLibPackageJsonPath('@faicad/no-such-package-xyz')).toBeUndefined()
    expect(readLibPackageJson('@faicad/no-such-package-xyz')).toBeUndefined()
  })
})

describe('readLibPackageJson — 三个库的声明读出来就是盘上那份', () => {
  it('gears：库级 occt + 提升开关打开 + occt-wasm peer', () => {
    const pj = readLibPackageJson<LibPj>('@faicad/faijs-gears')!
    expect(pj.faijs?.autoLift).toBe(true)
    expect(pj.faijs?.lib).toEqual({ role: 'library', conformsTo: 'cadquery', platform: ['occt'] })
    expect(pj.peerDependencies?.['occt-wasm']).toBeDefined()
  })

  it('fasteners：库级中立 + 有 occt-wasm peer（反向不成立的活反例）', () => {
    const pj = readLibPackageJson<LibPj>('@faicad/faijs-fasteners')!
    expect(pj.faijs?.autoLift).toBe(true)
    expect(pj.faijs?.lib).toEqual({ role: 'library', conformsTo: 'faijs', platform: [] })
    expect(pj.peerDependencies?.['occt-wasm']).toBeDefined()
  })

  it('sheetmetal：库级中立 + 无 occt-wasm peer（中立库不需要它）', () => {
    const pj = readLibPackageJson<LibPj>('@faicad/sheetmetal')!
    expect(pj.faijs?.autoLift).toBe(true)
    expect(pj.faijs?.lib).toEqual({ role: 'library', conformsTo: 'faijs', platform: [] })
    expect(pj.peerDependencies?.['occt-wasm']).toBeUndefined()
  })
})
