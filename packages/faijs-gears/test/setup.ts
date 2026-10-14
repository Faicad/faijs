/**
 * setup.ts — vitest `setupFiles` 入口：加载任何用例前先扮宿主装配内核。
 *
 * 装配本体在 `src/test-setup.ts`（库包里唯一允许叫内核初始化函数的地方，
 * 见其头注与 `scripts/check-lib-layering.mjs` 的 `BOOTSTRAP_EXEMPT`）——
 * 这样 `scripts/*.ts` 与 `test/stability/runner-entry.ts` 子进程能共用同一份装配，
 * 不必从 `test/` 反向 import。
 */

import { initOCCT } from '../src/test-setup'

await initOCCT()
