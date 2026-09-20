# Agent Note: `brepjs-compat` 子路径的本地解析与 D8 Result 桥接

Status: implemented

[English](2026-09-20-faijs-subpath-local-resolution-and-d8-result-bridge.md) | 中文

## Problem

`pwsh scripts/publish-all.ps1 -Tag next -DryRun` 在 `scripts/ci.ps1` 处中止，两处失败互不相干，
且都不在发布脚本本身：

```
Test Files  5 failed | 78 passed (83)
Error: Cannot find module '@faicad/faijs/brepjs-compat'
  imported from 'packages/sheetmetal/src/allowanceFns.ts'
```

```
FAIL  faijs/p7-dual-chain/p7-dual-chain.test.ts > 全部 `vendored/brepjs` import 都位于 api/
AssertionError: expected [ …(10) ] to deeply equal []
```

1. 本地消费方一律用**前缀替换**把 `@faicad/faijs` 指向 `packages/core/src`（8 个
   `vitest.config.ts` alias、8 个 `tsconfig.json` `paths`、`packages/demo/vite.config.ts`）。
   对外子路径 `./brepjs-compat` 映射到 `dist/api/brepjs-compat/index.js`，于是前缀改写得到
   `core/src/brepjs-compat` —— 源码里不存在该目录。类型检查仍是绿的：TypeScript 在 `paths`
   落空后会回退到 workspace 符号链接，命中 `dist/api/brepjs-compat/index.d.ts`；vitest 的
   alias 一旦命中**不回退**，同一份代码就报 `Cannot find module`。
   `packages/sheetmetal/src/` 下 40 个文件都用这个子路径。
2. FCStd 端口从 `packages/core/src/fcstd/` 的 10 个文件里直接 import vendored 实现
   （`../vendored/brepjs/core/result.js`），违反 D8：`vendored/brepjs` 只允许从 `src/api/` 触及。
   该规则有两处守卫（`scripts/check-layer-boundaries.mjs` R5，exit 1；以及
   `p7-dual-chain.test.ts` 的边界断言），而 `ok`/`err`/`isOk`/`isErr` 在平台侧当时没有任何定义。

## Decision

1. `packages/core/src/brepjs-compat.ts` re-export `./api/brepjs-compat/index.js`，让 `src/`
   布局与 `package.json` exports 键同名。全仓前缀 alias 因此直接命中，17 处配置一处未改；
   发布面不变（`exports` 仍指 `dist/api/brepjs-compat/`）。
2. `packages/core/src/api/result.ts` re-export vendored 的 Result 面，`fcstd` 的 10 处 import
   改指 `../api/result.js` —— `src/api/` 是通往 vendored 树的唯一合法桥接点，因此没有任何守卫被放宽。

## Alternatives considered

- **在 17 处配置里各加一条精确 alias 并置于前缀 alias 之前**（8 vitest + 8 tsconfig + demo vite）。
  否决：17 处编辑且必须保证顺序，下一次出现「`src/` 布局与 exports 键不同名」的子路径会重演
  同一种「typecheck 绿、测试红」的割裂。
- **让 `fcstd` 直接 import `../api/brepjs-compat/index.js`**（而非只含 Result 的模块）。
  否决：求解/文档层会为四个符号拖入整个 compat 门面及其依赖链。
- **在 D8 守卫里给 `fcstd` 开白名单**（并放宽 `p7-dual-chain` 断言）。
  否决：这是靠弱化「vendored 树只经 `src/api/`」这条规则来把门禁刷绿。
- **只按单次运行逐个修 5 个失败套件，不处理结构性成因**。
  否决：根因是 alias 与 `paths` 的语义差异，不是逐文件问题。

## Consequences

逐步实测，每条命令单独串行运行：

| 检查 | 修复前 | 修复后 |
| --- | --- | --- |
| `packages/sheetmetal/src/reference.test.ts` | `Cannot find module` | 6/6 通过 |
| sheetmetal 全包（`vitest run`） | 全部套件加载失败 | **22 文件 / 233 用例通过** |
| `packages/core` fcstd（`vitest run src/fcstd`） | 7 个文件 `Failed to load url` | **15 文件 / 121 用例通过** |
| `faijs/p7-dual-chain` | 6 条中 1 条 failed | 6/6 通过 |
| `node scripts/check-layer-boundaries.mjs` | exit 1，10 项 offender | 通过（260 个移植文件） |
| `packages/tests`（全包） | 5 个文件 failed | **85 文件 / 1609 通过 + 3 skipped，0 failed** |

两条值得留档的结论：

- 对本仓消费方而言类型检查不算证据：`tsconfig` 的 `paths` 会回退到 `node_modules`/`dist`，
  而 `vitest` 的 alias 不会。凡 `src/` 布局与 `exports` 键不同名的子路径，`src/` 下必须有同名 alias 文件。
- `dist/` 的新鲜度会掩盖源码层缺口；sheetmetal 套件才是真正暴露它的那道检查。
