/**
 * vitest.engine-compat.config.ts — brepkit↔occt 一致性测试专用配置（方案 §6 种子）
 *
 * 为什么需要它（且是独立文件、显式 --config 使用）：
 *  - faijs 当前**没有构建 dist**，而 `@faicad/faijs` 的 package `exports` 指向 `dist/*`，
 *   直接按包名解析会失败。这里把 `@faicad/faijs` 别名到 `packages/core/src`（与
 *   根 tsconfig.json 的 `paths` 同构），让 vitest（esbuild）直接转译源码，无需先 build。
 *  - 仅 include `faijs/engine-compat/**`，不影响 `packages/tests` 默认测试套件
 *   （`vitest run` 走 package.json 的脚本配置）。
 *  - `pool: 'forks'`：occt/brepkit 是 wasm 内核，带模块级单例，fork 子进程比 thread 更安全。
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))
const coreSrc = resolve(here, '../core/src')

export default defineConfig({
  root: here,
  resolve: {
    alias: [
      // 子路径（尾斜杠）：@faicad/faijs/X → packages/core/src/X（源码，未进 dist/exports）
      { find: '@faicad/faijs/', replacement: `${coreSrc}/` },
      // 精确名：@faicad/faijs → packages/core/src/index.ts
      { find: '@faicad/faijs', replacement: resolve(coreSrc, 'index.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['faijs/engine-compat/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
})
