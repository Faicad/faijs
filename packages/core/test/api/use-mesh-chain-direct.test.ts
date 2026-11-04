/**
 * 链偏好直呼单元测试——历史 L1 缺口补账：`useMeshChain` / `setChainPreference` /
 * `getChainPreference`。
 *
 * `cad.useMeshChain` 的脚本级端到端行为在 mesh-chain-switch.test.ts（真机双引擎
 * 装配）；本文件钉住 TS 库面的旋钮语义：useMeshChain(true) → 'mesh'，
 * useMeshChain(false) → 清除偏好（null = 回到 auto 规则）。
 */
import { describe, expect, it, afterEach } from 'vitest'
import { setChainPreference, getChainPreference } from '../../src/runtime-state'
import { useMeshChain } from '../../src/api/use-mesh-chain'

afterEach(() => {
  // 不把链偏好泄漏给同进程其它测试（executeDirectText 起点也会重置，双保险）
  setChainPreference(null)
})

describe('useMeshChain / setChainPreference 直呼', () => {
  it('useMeshChain(true) → 偏好 mesh；useMeshChain(false) → 清除（null）', () => {
    useMeshChain(true)
    expect(getChainPreference()).toBe('mesh')
    useMeshChain(false)
    expect(getChainPreference()).toBeNull()
  })

  it('setChainPreference 直呼：brep / null 两态', () => {
    setChainPreference('brep')
    expect(getChainPreference()).toBe('brep')
    setChainPreference(null)
    expect(getChainPreference()).toBeNull()
  })
})
