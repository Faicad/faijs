/**
 * @vitest-environment node
 *
 * multi-version-smoke — 同进程切换三个 brepkit-wasm 版本的装载/注册/基础几何冒烟
 *
 * 钉死的事实：每个版本（2.129.15 MIT/Apache、3.4.18 当前依赖、4.0.32 latest）都能
 *   1. 被装载（setBrepkitWasmInitFn 注入的 customFn new 出 BrepKernel 实例）；
 *   2. 注册为 id='brepkit' 的 BREP 引擎；
 *   3. 用该引擎 makeBox(20,10,5) 且 getVolume ≈ 1000（1% 容差）。
 *
 * 任何版本装载失败 / BrepKernel API 不兼容（方法缺失、构造签名变化等）→ 对应 it
 * 如实失败并把原始错误上抛，不 try-catch 掩盖——跨版本兼容性差异正是本次要记录的事实。
 *
 * Run: npx vitest run src/brepkit-kernel/multi-version-smoke.test.ts
 */

import { describe, it, expect, afterAll } from 'vitest'
import { getBrepEngine, __resetEngineRegistriesForTests } from '../brep/engine/registry'
import {
  loadBrepkitVersion,
  resetToDefaultBrepkit,
  type BrepkitTestVersion,
} from './multi-version-test'

const BOX_DX = 20
const BOX_DY = 10
const BOX_DZ = 5
const EXPECTED_VOLUME = BOX_DX * BOX_DY * BOX_DZ // 1000

/** 逐个版本跑同一条冒烟链路；错误原样上抛，由 vitest 记为该 it 失败。 */
async function smokeOneVersion(version: BrepkitTestVersion): Promise<void> {
  await loadBrepkitVersion(version)

  const engine = await getBrepEngine()
  expect(engine.id, `engine id for brepkit@${version}`).toBe('brepkit')

  const box = engine.primitives.makeBox(BOX_DX, BOX_DY, BOX_DZ)
  const volume = engine.primitives.getVolume(box)
  // stdout 记录实测体积（stderr 零容忍；失败错误自然上抛）。
  console.log(`[multi-version] brepkit@${version}: box volume = ${volume} mm^3 (expected ~${EXPECTED_VOLUME})`)
  expect(volume, `box volume for brepkit@${version}`).toBeGreaterThan(EXPECTED_VOLUME * 0.99)
  expect(volume, `box volume for brepkit@${version}`).toBeLessThan(EXPECTED_VOLUME * 1.01)

  engine.primitives.release(box)
}

describe('brepkit-wasm 多版本同进程装载冒烟', () => {
  // wasm 装载/编译每版本数秒，给足超时（不依赖全局 testTimeout）。
  it('2.129.15 (MIT OR Apache-2.0) 装载+注册+makeBox 体积正确', async () => {
    await smokeOneVersion('2.129.15')
  }, 120000)

  it('3.4.18 (当前依赖 / node_modules) 装载+注册+makeBox 体积正确', async () => {
    await smokeOneVersion('3.4.18')
  }, 120000)

  it('4.0.32 (npm latest) 装载+注册+makeBox 体积正确', async () => {
    await smokeOneVersion('4.0.32')
  }, 120000)

  afterAll(async () => {
    await resetToDefaultBrepkit()
    __resetEngineRegistriesForTests()
  })
})
