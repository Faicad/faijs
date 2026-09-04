# 技术分析：p23-cad-face 的 `cad.offset` 在 vitest 环境下挂死（环境特有）

日期：2026-09-04　　状态：**已判定 + 已按用户指示收尾（skip + 程序化兜底）** —— 本文记录全部实证、排除项与最终处置。

## 1. 问题一句话

`packages/tests/faijs/p23-cad-face/p23-cad-face.test.ts` 中，`cad.offset`（`cad.offset(p0, { distance: 1 })`）
在 **vitest 环境下执行时事件循环被同步阻塞、无限挂起**（线程池 threads / forks 双池一致，超时无法中断）。
同一条 offset 路径在 **纯 Node（无 vitest）下 56ms 正常返回、exit 0**。

## 2. 用户要求（原话）

> 「给每个测试强制的超时时间，防止死循环。」
> 「所有测试5分钟超时，否则必须杀死。怎么可能有测试要跑5分钟以上，一定出错了。」
> 「你这个STATUS-REPORT-2026-09-04.md文档位置不对，应该放在分析文件夹。给找到所有会死循环的测试做出来，标记为skip，开始写代码todo。」

## 3. 实测证据（bisect 定位）

| 探针 | 环境 | cad.op | 结果 |
|---|---|---|---|
| `cad.box`（含前置 beforeAll 预热） | vitest | box | ✓ 80ms |
| vitest | torus | ✓ 165ms |
| vitest | **offset** | ✗ **无限挂起** |
| `cad.fuse` 单独 | vitest | fuse | ✓ 154ms |
| `cad.cut` 单独 | vitest | cut | ✓ 31ms |
| `compat.fuse` 单独 | vitest | compat.fuse | ✓（结果 true） |
| `cad.torus` 控制组 | vitest | torus | ✓ 153ms |
| `probe_offset`（tsx 直跑适配器） | 纯 Node | makeBox/offset | ✓ 3ms / 56ms，exit 0 |

结论：**唯一命中挂死的是 vitest 环境下的 `cad.offset`**。fuse / cut / torus / compat /**
纯 Node 下的 offset 全部正常。因此排除：脚本逻辑错误、OCCT 内核本体、faijs 适配层、
线程池特定问题。「FinalizationRegistry 终结器重入 occt-wasm」（早前分析 `2026-09-04-disposal-reentrancy-deadlock.md`）
的假设与本次新证据矛盾 —— 该假设的修复（`kernelReentrancy.ts` 守卫 + disposal 去现场化 + adapterShims 包裹）
**未命中根因、已被回退**（见下文 §6）。

## 4. compat-e2e 全量实测（此前被禁跑，本次按指示完成判定）

对 `packages/tests/faijs/compat-e2e/` 各文件逐一在 5 分钟预算 + 看门狗下实测：

| 文件 | 结果 | 耗时 |
|---|---|---|
| aluminum-enclosure.test.ts | ✓ 通过 | 7.5s |
| lib-error.test.ts | ✓ 通过 | 8.9s |
| shape-borrow.test.ts | ✓ 通过 | 9.4s |
| sheetmetal-flow.test.ts | ✓ 通过 | 11.7s |
| mech-lib-flow.test.ts | ✓ 通过 | 55s |

**兼容 e2e 不卡死、全部通过** —— 不标记 skip。

## 5. 处置（用户指示 + 代码注释）

- 将 p23 中唯一含 `cad.offset` 的端到端用例标记 **skip**，并在代码内以
  `TODO(cad.offset-vitest-hang)` 注释引用本文档（见 `packages/tests/faijs/p23-cad-face/p23-cad-face.test.ts`）。
- **skip 不是永久豁免**：TODO 注释 + 本文档即「恢复条件」的记录；任何后续能在 vitest 下调通
  `cad.offset` 的修复完成后，应移除 skip 并复跑该用例双池验证。
- 其余用例（box/cylinder/cone/wedge/translate/scale/fuse/cut/torus/compat/跨层等价/异常码）全部保留并保持运行。
- 既有 5 分钟超时策略（`testTimeout/hookTimeout = 300000`）+ 进程级看门狗 `scripts/run-tests-with-watchdog.mjs`
  维持不变：任何测试超过 5 分钟即强杀并判失败（`exit=2`），是环境类挂死的最终兜底。

## 6. 回退记录

- `packages/core/src/vendored/brepjs/core/kernelReentrancy.ts`：**新增即被回退删除**（未入 git）。
- `packages/core/src/vendored/brepjs/core/disposal.ts`、`packages/core/src/vendored/brepjs/kernel/occtWasm/adapterShims.ts`：
  恢复为 HEAD 基线（原「终结器延迟释放」「adapter 包裹」实验改动全部撤销）。

## 7. 相关

- 看门狗实现：`scripts/run-tests-with-watchdog.mjs`（parse `--budget-ms`/`--cwd`；超时 `taskkill /T /F` + `exit=2`）。
- CI step4 已按每测试包独立 5 分钟预算 + stderr 零容忍拆分（`scripts/ci.ps1`）。