/**
 * script-globals entry 守卫（A2）。
 *
 * `@faicad/faijs/script-globals` 是编辑器/宿主查询「脚本可用内置全局」的稳定入口。
 * 它**只转发**、不复制名单——否则两份清单必然漂移。本组钉住三点：
 * ① 转发的是同一份对象（引用相等，非内容相等）；
 * ② 名单确实含「单位常量」与「JS 语言全局」两类代表；
 * ③ `isSafeGlobalIdent` 与名单同源（新增一项自动生效）。
 */

import { describe, it, expect } from 'vitest'
import * as entry from './script-globals'
import {
  S4_SAFE_GLOBALS,
  RESERVED_UNIT_NAMES,
  isSafeGlobalIdent,
} from './lang/security-scanner'
import { SCRIPT_UNIT_NAMES } from './units'

describe('script-globals entry（A2）：对外查询入口与唯一判定入口同源', () => {
  it('转发同一份名单对象（防复制/漂移）', () => {
    expect(entry.S4_SAFE_GLOBALS).toBe(S4_SAFE_GLOBALS)
    expect(entry.RESERVED_UNIT_NAMES).toBe(RESERVED_UNIT_NAMES)
    expect(entry.isSafeGlobalIdent).toBe(isSafeGlobalIdent)
  })

  it('两类语义各有代表：JS 语言全局 + 单位常量', () => {
    for (const n of ['Math', 'JSON', 'Number', 'console', 'Infinity', 'NaN', 'undefined', 'parseInt']) {
      expect(entry.S4_SAFE_GLOBALS.has(n), n).toBe(true)
    }
    for (const n of ['MM', 'INCH', 'DEGREE', 'RADIAN']) {
      expect(entry.S4_SAFE_GLOBALS.has(n), n).toBe(true)
    }
  })

  it('保留单位常量名是 S4 的子集，且与脚本单位常量表一致', () => {
    for (const n of entry.RESERVED_UNIT_NAMES) {
      expect(entry.S4_SAFE_GLOBALS.has(n), n).toBe(true)
    }
    expect([...SCRIPT_UNIT_NAMES].sort()).toEqual([...entry.RESERVED_UNIT_NAMES].sort())
  })

  it('isSafeGlobalIdent 与名单一致（新增一项自动放行）', () => {
    for (const n of entry.S4_SAFE_GLOBALS) expect(entry.isSafeGlobalIdent(n), n).toBe(true)
    expect(entry.isSafeGlobalIdent('zzz')).toBe(false)
  })
})
