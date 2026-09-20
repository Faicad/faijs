# weapp 独立宿主入口设计（@faicad/faijs-core/weapp）

## 用户原话（逐字）

> 分析为何报错：19:14:44 [vite] Internal server error: Failed to resolve import "brepkit-wasm" from "../../node_modules/@faicad/faijs-core/dist/brepkit-kernel/brepkitWasm.js?v=e9b4489e". Does the file exist?
> （……vite:import-analysis 完整堆栈……）
> 。 这个brepkit只是给小程序用的。不应该影响npm run dev

> 是否应该给小程序一个独立的host，区分于node与browser？

> 好的

## 背景与根因

- `faijs-core` 的 browser umbrella（`src/browser.ts`）re-export 了 brepkit 符号：
  - `setBrepkitWasmInitFn / initBrepkitWasm / isBrepkitInitialized`（brepkit-kernel/brepkitWasm）
  - `registerBrepkitBrepEngine / BREPKIT_BREP_ENGINE_ID / ensureBrepkitDefaultEngine`（brep/engine/adapters/brepkit）
- web dev 的模块图因此包含 `brepkitWasm.js`，其 node 分支的 `await import('brepkit-wasm')` 被 vite 静态解析；`brepkit-wasm` 是 weapp 专用依赖，3d_editor 未安装 → dev server 500。
- 根因：宿主边界靠"谁 re-export 了谁"隐式维持，无静态契约。

## 设计原则

- **独立的是入口（export map + umbrella），不是代码**。不新增平行实现；weapp umbrella 与 node/browser 同为 core 之上的门面聚合，共享 `cad-runtime`、`brep/*`、interpreter 等环境无关子路径。
- weapp 专属的只有：brepkit kernel 装载（`brepkit-kernel/*`）+ brepkit BREP 引擎适配（`brep/engine/adapters/brepkit`）。
- 报错好于掩盖：不引入任何运行时回退；边界由静态入口保证。

## API 定义

### 新增入口 `@faicad/faijs-core/weapp`（及 `@faicad/faijs/weapp`）

文件：`packages/core/src/weapp.ts`，package.json exports 增加：

```json
"./weapp": { "types": "./dist/weapp.d.ts", "default": "./dist/weapp.js" }
```

导出面（weapp worker 宿主需要的最小集合，全部为 re-export，零新实现）：

```ts
// brepkit wasm 装载（weapp 专属注入点）
export { setBrepkitWasmInitFn, initBrepkitWasm, isBrepkitInitialized } from './brepkit-kernel/brepkitWasm'
// brepkit BREP 引擎注册
export { registerBrepkitBrepEngine, BREPKIT_BREP_ENGINE_ID, ensureBrepkitDefaultEngine } from './brep/engine/adapters/brepkit'
// BREP 引擎注册表（weapp 只注册 brepkit，不注册 occt）
export { registerBrepEngine, hasBrepEngine, getActiveBrepEngineId, freezeEngineRegistries } from './brep/engine/registry'
export type { BrepEngine, BrepEngineProvider, BrepEngineApi } from './brep/engine/registry'
// cad-runtime（环境无关执行栈，与 weapp worker 现用子路径一致）
export { createRuntime } from './cad-runtime/runtime'
export type { CadRuntime } from './cad-runtime/runtime'
export { createApiNamespace } from './api/api-namespace'
```

（最终导出清单以 weapp worker 实际 import 的符号为准，实现时核对补齐，不预留"以后可能用"的导出。）

### browser umbrella 摘除 brepkit

`src/browser.ts` 删除两行 brepkit re-export（第 107、137 行附近）。web 端如需判断引擎，用 `hasBrepEngine / getActiveBrepEngineId`（occt 语义），永远见不到 brepkit 符号。

### node umbrella 不动

`src/node.ts` 未导出 brepkit（已核实），node 单测继续走子路径 `@faicad/faijs-core/brepkit-kernel/brepkitWasm`。

### 调用方迁移

- `packages/platform/src/weapp/faijs.worker.ts`：`setBrepkitWasmInitFn` 改从 `@faicad/faijs/weapp`（或 faijs-core/weapp）导入；`ensureBrepkitDefaultEngine` 等 brepkit 符号同样改从 weapp 入口导入。
- `packages/weapp/scripts/build.mjs`：esbuild stub 清单核对——weapp bundle 从 weapp 入口打包后，原先"替换 browser umbrella 为 thin stub"的 hack 可评估删除（本次只做核对，不做超出范围的清理）。

## 守卫测试（防回归）

新增 `packages/core/src/entry-boundary.test.ts`：

1. **browser 入口无 brepkit**：静态断言 `dist/browser.js`（或构建产物）不包含 `brepkit-kernel` / `adapters/brepkit` import 语句；源码级断言 `src/browser.ts` 不含 `brepkit` 字样的 re-export。
2. **weapp 入口导出面**：断言 `weapp.ts` re-export 的符号集合与白名单完全一致（多导出即失败，防止再次渗漏）。
3. **weapp worker 宿主约束**（3d_editor 侧 `contract-entry.test.ts` 同款思路）：weapp worker 源码禁止 import `@faicad/faijs/browser`；browser 侧源码禁止 import `brepkit-kernel/*`。

## 实施顺序

1. 本文档定稿 → 用户确认
2. 写守卫测试（红）
3. 实现 `weapp.ts` + exports + 摘除 browser re-export（绿）
4. faijs 全量相关单测 + CI → push
5. 重打 tgz，更新 3d_editor `package.json` hash 并安装
6. 3d_editor `npm run dev` 验证报错消失
