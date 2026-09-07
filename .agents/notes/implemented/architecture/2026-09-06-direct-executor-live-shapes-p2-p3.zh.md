# Agent Note: DirectExecutor 与 computeLiveShapes 落地（无 IR 双通道运行时的 P2–P3）

Status: implemented

[English](2026-09-06-direct-executor-live-shapes-p2-p3.md) | 中文

## Problem

P1（MetadataExtractor，A-16 对拍全绿）之后，执行链仍走 parseScript → compileToModule → ModuleExecutor（IR 中间层）。按无 IR 双通道方案（R11 红线），删除 IR 之前必须先存在 无 IR 执行器（DirectExecutor）与无 IR 存活判定（computeLiveShapes），并用 A-17 / A-14 对拍锁定它们与现状路径（executeIR / computeLeafTerminals）逐条一致。

## 决策

P2–P3 落地内容（未删除任何 IR 代码；执行链与 collectResult 仍走现状路径，双路径共存）：

1. **P2 DirectExecutor**（`cad-runtime/direct-executor.ts`）：
   - 把 `.fai.js` 源码切成顶层语句执行单元（行号即单元边界），对每个单元做机械文本 变换（ctx 提升 + 插入 await + 剥离 keep 键 + 顶层函数提升 + 解构写回）， 嵌入 async 包装后直接交给 JS VM 执行；
   - 共享 `ctx` 跨 execute/append/update 存活；append 只执行新行号；update = 清空 ctx 全量重跑（R3）；
   - 失败单元记录 `failedAt`（index/callee/message + lineNo）；
   - 不 import parser.ts / compile.ts / types.ts 的 IR。
2. **A-17 对拍**（`packages/core/src/cad-runtime/direct-executor.test.ts`，48 例）：
   - execute 的几何 outputs 与 CadRuntime.executeIR 在 mesh 模式逐条相等（扁平行式 fixture 全集，内容 key 比对）；
   - append / update / 顶层函数 / 解构 / 参数注入 / failedAt 行号覆盖。
   - 需要字体/资产/注册库的 fixture（text/engrave/load/第三方库）在裸环境下新旧两条 路径都失败，故不在 mesh 语料内（宿主注入 ports 后由集成测试覆盖）。
3. **P3 computeLiveShapes**（`cad-runtime/live-shapes.ts`）：
   - 输入 = metadata.lines/blocks/keep 表 + ctx shape 变量名 + 函数体 keep 登记 （KeepView：行内条目 + 函数体登记，取代 ModuleExecutor.internalKeep）；
   - 算法与 computeLeafTerminals 逐行对应：hidden 预计算（最后一次保留声明胜出）→ lastProducer（单次正向遍历 + Map 覆盖写）→ 逐候选名查消费（keep 驱动 consumes， C0/C3/C5 短路；输入换成 StatementSummary 的 HostArg 形态）；
   - 自由 JS 块 = 词法级引用扫描（扁平行式代码不触发）。
4. **A-14 双路径对拍**（`packages/tests/faijs/no-ir/parity/a14-live-shapes.test.ts`， 40 例）：同一 runtime 执行后，computeLiveShapes 与 computeLeafTerminals 的产出 （id 集 + hidden）逐条相等（fixture 全集，mesh 模式）。

## Alternatives considered

- **先切 runtime 到 DirectExecutor（P4）再验证**：否决——R11 要求先对拍后切换/删除； 先让 P2/P3 独立交付、门禁全绿，P4 再推进。
- **computeLiveShapes 保留 IR 形态的 statement 模型 consumes**：否决——方案要求存活 判定输入侧也换成 StatementSummary（无 IR），否则 P6 无法删除 terminal-dag。
- **DirectExecutor 保留 deps/表达式折叠/outputs 投影**：否决——那仍是 IR 执行中介的 变体；本实现只做文本级机械变换。

## 后果

- 三条删除门禁（A-16/A-17/A-14）在 CI 语料上全绿，R11 前置条件已满足； parser/compile/module-executor/terminal-dag 仍在使用中，因此尚不允许任何删除 PR。
- UI 通道、执行通道、终端判定三面都有了无 IR 形态；P4（runtime 切换）可增量推进， P6（删除 IR）有对拍兜底。
- DirectExecutor v1 支持扁平行式 + 顶层函数 + 容器体（忽略顶层 return）； 循环/条件等自由 JS 块执行留待 P5（只读的 A-6 块节点已由 MetadataExtractor 覆盖）。
