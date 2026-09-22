# Agent Note: vitest 3.x 的 birpc 硬性 60s worker RPC 超时导致 "onTaskUpdate" 误报失败

Status: implemented

English | [中文](2026-09-20-vitest-birpc-60s-timeout-on-task-update.md)

## 问题

`pwsh scripts/publish-all.ps1 -Tag next -DryRun` 在 `scripts/ci.ps1` 内部中止：`faijs-tests`
包**全部测试通过（1609 passed + 3 skipped，0 failed）**，却因一条未处理错误以 exit 1 退出：

```
[vitest-worker]: Timeout calling "onTaskUpdate"
```

## 根因

vitest 3.x 在 birpc 内部硬编码 `const DEFAULT_TIMEOUT = 6e4`（60s）
（`node_modules/vitest/dist/chunks/index.B521nVV-.js:3`）。`createForksRpcOptions` 与
`createThreadsRpcOptions`（`utils.CAioKnHs.js`）**不传** `timeout`，因此所有 worker RPC
都回落到 60s 上限。`createBirpc` 在 `index.B521nVV-.js:21` 仅当 `options.timeout === undefined`
时才用 `DEFAULT_TIMEOUT`；第 56 行在 `timeout >= 0` 时挂定时器。

这个 60s 上限衡量的是 worker **累计未返回事件循环的同步忙碌时长**，不是单条用例墙钟。
用纯同步阻塞探针（无 faijs 代码）证实：一段 70s 连续同步块 → 报错；一个 worker 内三段各
30s 同步块 → 同样报错（无单段 > 60s）。

本仓库触发该问题的套件：
- `faijs/compat-e2e/gear-lib-demo-flow.test.ts`（P26 §8.4）：每次 `runtime.execute(SCRIPT)`
  约 7–10s（一次冷构建 + 经 compat 桥接的 4 段下游语句）；整个 §8.4 场景在一个 worker 内累积
  > 60s。
- `faijs/parity/parity.test.ts` 的 "parity-screw"：单次 brep `execute` 高达 34.5s（mesh 仅
  0.3s）；CPU 争用下曾达 66.9s。

faijs 的 `execute` 是同步的原生几何计算，无法让出事件循环，因此插入 `await` 让出并不能缩小
那次原子 34.5s 的 brep 块。

## Decision

两部分都已实施：

1. **拆分重型套件**，使单个 worker 文件自身不越过阈值：§8.4 场景拆为
   `gear-lib-demo-flow` / `gear-lib-demo-recompute` / `gear-lib-demo-recompute-lib-change`
   （共享 `gear-flow-fixture.ts`）；`parity-screw` 通过 `packages/tests/package.json` 的两段式
   `test` 脚本作为独立串行 pass 运行。

2. **把 worker RPC 超时从 60s 提到 5 分钟**：补丁式修改 vitest 的 dist，在
   `node_modules/vitest/dist/chunks/utils.CAioKnHs.js` 的 `createThreadsRpcOptions` 与
   `createForksRpcOptions` 返回对象中加入 `timeout: 300000`，从而在 `index.B521nVV-.js:21`
   处覆盖 `DEFAULT_TIMEOUT`。

## 注意事项（重要）

- 该 `timeout: 300000` 补丁**只存在于 `node_modules`**——不进 git，任何重新解析 vitest 的
  `npm install` / `npm ci` 都会清除它。在升级 vitest 之前，重装后必须重新应用。
- **推荐的长久修复**：升级 vitest 到 4.x，其向 `createBirpc` 传入 `timeout: -1`
  （#vitest-dev/vitest#8297）。升级后应移除该 node_modules 补丁。
- 300s 与 `scripts/ci.ps1` 中的 per-package CI 看门狗（`FAIJS_TEST_BUDGET_MS`，默认 300000ms）
  对齐；看门狗仍是真正的死锁兜底。

## 验证

- 修复前：`tests` 包全绿，但 `Errors 1 error` → exit 1 → `publish-all.ps1` 中止。
- 修复后（拆分 + 补丁）：`npm run test -w @faicad/faijs-tests`（两段式）→ exit 0，无未处理错误。

## 参考

- vitest-dev/vitest#8164（报告），#8297（v4 修复）。

## Alternatives considered

- **现在就升级 vitest 到 4.x**：本次未采用。v4 的修复（向 `createBirpc` 传 `timeout: -1`，#8297）当时尚不可用；它仍是推荐的长期修复，升级后必须移除 node_modules 补丁。
- **只拆分重型套件、保留 60s 上限**：否决。原子化的 34.5s brep `execute` 块无法再拆，CPU 争用下单套件曾达 66.9s——上限本身必须提高。
- **node_modules 补丁提高 worker RPC 超时 + 拆分重型套件**（采纳）：`createThreadsRpcOptions`/`createForksRpcOptions` 中的 `timeout: 300000` 覆盖 `DEFAULT_TIMEOUT`，拆分让单个 worker 不越过阈值。

## Consequences

- `publish-all.ps1` 不再中止：`faijs-tests` 包全绿且 exit 0，无未处理的 `onTaskUpdate` 超时。
- `timeout: 300000` 补丁只存在于 `node_modules`——不进 git，任何 `npm install`/`npm ci` 都会清除；升级 vitest 前重装后必须重新应用。
- 300s 与 `scripts/ci.ps1` 的 per-package CI 看门狗（`FAIJS_TEST_BUDGET_MS`，默认 300000ms）对齐；看门狗仍是真正的死锁兜底。
