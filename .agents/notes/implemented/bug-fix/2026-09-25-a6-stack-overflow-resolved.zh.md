# Agent Note（中文）：A6 arduinounomissblack 爆栈已由拓扑血统重构消除

Status: implemented

## 问题

计划 §A6（`docs/plans/2026-09-25-fcstd-full-conversion-plan.md`）追踪 `Electronics Parts/Boards/Arduino/Arduino UNO/arduinounomissblack.FCStd`（共 3 个样本）上的 `Maximum call stack size exceeded`。该崩溃发生在 `cliRun`（brep 模式）内的 BREP 拓扑构建阶段，最初假设是拓扑/选择器构建里的无界递归（"疑似血统回走或布尔嵌套"）。

## 决策

A6 不需要改动 faijs core 代码。当前 `main` 源码已不再复现该崩溃。根因已被此前的拓扑血统重构消除——尤其是 `066b225`（roleTable 降为缓存 + 血统回走引擎）与 `cdabba0`（接通 §1.4/1.5 血统登记），以及周边的 Phase 2.x 拓扑工作。

在消费侧脚手架（fcstd-port）新增了回归护栏 `test/FreeCAD/a6-stack-overflow-regression.test.ts`：它解包产品容器并通过 `cliRun` 执行（与 `tools/run-sweep-worker.ts` 同路径），随后断言运行**没有**抛出 `Maximum call stack size exceeded` 且能跑到完成。

## 备选方案

- **在 `collectDirectResult` 加重入护栏**（`topologyCollecting` 标志，跳过嵌套拓扑构建）。否决。插桩证明 `buildBrepTopology` 与 `buildSelectorRuntimeData` 各自进入次数 ≤4 / ≤15——它们**不是**递归点。该护栏也无行为效果：完整回退后 10/10 次运行依旧干净通过。对不再存在的问题加护栏属于无意义防御代码。
- **当作非确定性处理并加循环护栏**。否决。真正的无限递归约 100% 必然崩溃；带护栏与不带护栏 13/13 次干净运行证明递归路径已消失，而非被掩盖。

## 后果

- A6 关闭；不需要任何 faijs-core 代码 diff。
- `fcstd-port/test/FreeCAD/a6-stack-overflow-regression.test.ts` 锁定该样本，未来若拓扑/选择器构建重新引入无界递归将被捕获。

## GOTCHA（调用栈截断）

排查 `Maximum call stack size exceeded` 时，默认的 `Error.stackTraceLimit`（=10）会把栈截断到最外层 10 帧，把一个本身非递归的线性帧（`buildSelectorRuntimeData`）掩盖在递归辅助函数之上。捕获栈之前务必调高 `Error.stackTraceLimit`（如 2000），并对疑似函数插桩计数入口，以区分"单次调用内递归"与"重入调用"。否则被截断的栈会误导根因定位。
