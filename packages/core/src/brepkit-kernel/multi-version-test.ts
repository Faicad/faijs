/**
 * brepkit-kernel/multi-version-test — 同进程多版本 brepkit-wasm 装载辅助（仅测试用）
 *
 * 让 faijs 测试在同一 Node 进程内切换三个 brepkit-wasm 版本：
 *   - 2.129.15（MIT OR Apache-2.0，用户目标版本线末代）
 *   - 3.4.18（仓库当前 devDependency，node_modules 默认路径）
 *   - 4.0.32（npm dist-tag latest）
 *
 * 解包产物位于 `_test-kernels/brepkit-<version>/package/`（由 `npm pack` 拉取并解包，
 * 已 gitignore，不进入 dist / 不提交）。3.4.18 直接走 node_modules。
 *
 * 切换序列（与 brep/engine/measurement-parity.test.ts 的 reset+重注册范式一致，
 * 全程只经公开导出 API 操作，不改动内核源码）：
 *   1. disposeBrepkit()                  —— 释放 liveKernel 单例
 *   2. setBrepkitWasmInitFn(customFn)    —— 重置 initPromise 并注入新版本装载函数
 *   3. __resetEngineRegistriesForTests() —— 清空引擎注册表（provider/cache/默认）
 *   4. registerBrepkitBrepEngine()       —— 用新版本重新注册（内部触发 wasm 装载）
 *
 * customFn 内从对应版本的绝对路径取 BrepKernel 类并 `new` 之——三个版本的 cjs
 * 入口（brepkit_wasm_node.cjs）在加载时同步 readFileSync 自身同目录的 wasm 并
 * 实例化，故按绝对路径 import 即天然隔离，不会与 node_modules 的包名缓存冲突。
 */

import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { setBrepkitWasmInitFn, type BrepKitKernel } from './brepkitWasm'
import { disposeBrepkit } from './brepkitKernel'
import { __resetEngineRegistriesForTests } from '../brep/engine/registry'
import { registerBrepkitBrepEngine } from '../brep/engine/adapters/brepkit'

/** 可在同进程切换的 brepkit-wasm 版本。 */
export type BrepkitTestVersion = '2.129.15' | '3.4.18' | '4.0.32'

/** 解包版本（2.x/4.x）相对本辅助文件的目录名；3.4.18 走 node_modules。 */
const UNPACKED_PKG_DIR: Exclude<BrepkitTestVersion, '3.4.18'>[] = ['2.129.15', '4.0.32'] as const

/** 本辅助文件所在目录（vite-node / 原生 ESM 在 node 环境下均暴露 file:// 源文件 URL）。 */
const hereDir = dirname(fileURLToPath(import.meta.url))

type BrepKernelCtor = new () => BrepKitKernel

/**
 * 从指定版本装载 BrepKernel 类。
 *
 * - 3.4.18：复用 node_modules 默认包路径（与 brepkitWasm.ts 生产路径一致）。
 * - 2.129.15 / 4.0.32：按绝对路径动态 import 解包后的 node cjs 入口；
 *   vite 注释标记让 vite-node 不拦截、交回原生 Node ESM 装载，
 *   cjs 入口内部用 __dirname 相对定位 wasm，因此与 cwd 无关。
 */
async function loadBrepKernelClass(version: BrepkitTestVersion): Promise<BrepKernelCtor> {
  if (version === '3.4.18') {
    // node_modules 默认路径（与 brepkitWasm.ts 生产装载同 specifier）。
    const mod = (await import(/* @vite-ignore */ 'brepkit-wasm')) as {
      BrepKernel?: BrepKernelCtor
    }
    if (!mod?.BrepKernel) {
      throw new Error(`[multi-version] 3.4.18: node_modules brepkit-wasm 未导出 BrepKernel`)
    }
    return mod.BrepKernel
  }

  const cjsPath = join(
    hereDir,
    '_test-kernels',
    `brepkit-${version}`,
    'package',
    'brepkit_wasm_node.cjs',
  )
  // 原生 Node ESM import CJS：返回 namespace，命名导出经 cjs-module-lexer 暴露。
  const mod = (await import(/* @vite-ignore */ pathToFileURL(cjsPath).href)) as {
    BrepKernel?: BrepKernelCtor
  }
  if (!mod?.BrepKernel) {
    throw new Error(`[multi-version] ${version}: ${cjsPath} 未导出 BrepKernel`)
  }
  return mod.BrepKernel
}

/**
 * 切换到指定 brepkit-wasm 版本并重新注册为 BREP 引擎。
 *
 * 抛出的错误（wasm 装载失败 / BrepKernel 缺失 / 构造抛错）一律原样上抛，
 * 不在此 try-catch 掩盖——测试需要看到真实失败原因。
 * @param version - 目标 brepkit-wasm 版本标识（BrepkitTestVersion 联合类型之一）。
 */
export async function loadBrepkitVersion(version: BrepkitTestVersion): Promise<void> {
  // 1. 释放旧 liveKernel（wasm 模块级实例仍驻留，但 JS 句柄与 liveKernel 解绑）。
  disposeBrepkit()
  // 2. 注入新版本装载函数（setBrepkitWasmInitFn 内部同时清空 initPromise）。
  setBrepkitWasmInitFn(async () => {
    const Ctor = await loadBrepKernelClass(version)
    return new Ctor()
  })
  // 3. 清空引擎注册表（provider/cache/默认 id/frozen 标志）。
  __resetEngineRegistriesForTests()
  // 4. 重新注册：内部 createBrepkitPrimitives → initBrepkitWasm → 上面注入的 customFn。
  await registerBrepkitBrepEngine()
}

/**
 * 测试收尾：dispose + 清掉自定义 initFn（恢复默认 node_modules 装载路径）+ 清注册表。
 * 不重新注册任何引擎——收尾后本进程不再假定默认 BREP 引擎。
 */
export async function resetToDefaultBrepkit(): Promise<void> {
  disposeBrepkit()
  setBrepkitWasmInitFn(null)
  __resetEngineRegistriesForTests()
}

/** 解包版本目录清单（诊断/校验用）。 */
export const UNPACKED_VERSIONS = UNPACKED_PKG_DIR
