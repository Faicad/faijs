# Agent Note: ModuleRegistry 落地——无 IR direct 通道的多文件项目 import（P5）

Status: implemented

[English](2026-09-06-module-registry-multifile-p5.md) | 中文

## Problem

guarded 无 IR 执行通道（P1–P4）只执行单个 `.fai.js` 场景；顶层 `import` 行被跳过，
相对模块 import（`import { bp } from './x.fai.js'`）没有物化。P5 的多文件引擎面
（§4.5、A-8/A-9/A-10）需要：依赖各自独立 ctx 执行、导出面（values/fns/liveShapes）、
对产出模块存活 shape 的绑定校验、循环检测，以及 D6（跨文件引用不得取消被引用 shape
的显示资格）。

## Decision

P5 引擎侧多文件已落地，runtime 缺省仍为 `'module'`（guarded）：

1. **`HostPorts.projectLoader?: ProjectLoader`**（`listModules` / `readSource` /
   `fingerprint?`）——缺省不提供时多文件通道关闭，单文件行为不变。
2. **`cad-runtime/module-registry.ts`**：`ModuleRegistry` 对模块的相对 import 做 DFS
   装载（每个依赖由注入的 `ModuleRunner` 用独立 ctx + runtime 已注册命名空间执行），
   循环 → `MODULE_CYCLE`（消息带路径）；每个模块产出 `FaiModuleExports`：
   `values`（非函数 ctx 键）+ `fns`（ctx 函数）+ `liveShapes`（对该模块自身
   lines/keep 跑 computeLiveShapes——模块内消费会把 shape 从 B 的可见面隐藏，A-9）。
   named 绑定必须 ∈ `liveShapes ∪ fns`，否则 `BINDING_NOT_EXPORTED`（模块缺失 →
   `MODULE_NOT_FOUND`；依赖执行失败 → `MODULE_EXEC_FAILED`）；全部归并为带 import
   行号的 `ExecutionResult.failedAt`。
3. **`DirectExecutor` 模块作用域解析**：源码先整体按 ESM module 解析（顶层 import
   合法并被跳过）；扁平旧文本（顶层 return/await）回退原封装解析。import 绑定经新
   `DirectExecOpts.imports` 预置进共享 ctx；成员调用发射在对象名是 ctx 键时优先
   `__ctx`（import 的 shape receiver / 模块命名空间），否则回退 `__ns`（注册库）。
   实参文本提升也改写 ctx 键，`cfg.OUTX`（模块命名空间成员）可解析。
4. **MetadataExtractor**：表达式遍历在命名空间绑定根处停止（`cfg.OUTX` 的 `cfg`
   不进 refs），贴合方案 HostArg 引用模型。
5. **CadRuntime direct 路径**：`execute`/`append` 经每轮新建的 `ModuleRegistry` 解析
   相对 import（装载错误短路为 failedAt），seed 传入 `DirectExecutor`。

## Verification

`packages/tests/faijs/no-ir/multifile/multifile.test.ts`（8 例，mesh，内存
ProjectLoader）：named import + union 几何；缺失导出/缺失模块/循环 → 带 import 行的
failedAt；命名空间 import（cfg.OUTX）；import 函数调用；A-9（模块内被消费 shape 不可
import、存活 shape 可）；A-10（被引用 shape 在 B 中仍是直接终端）。core
`module-registry.test.ts`（10 例）覆盖纯注册表面（绑定 gate、命名空间 seed、单轮缓存、
循环/错误、路径归一）。A-5（参数引用经 update 保真）在 runtime 面对拍套件覆盖。core
85 文件 / 1240、tests 74 文件 / ~1535、no-ir 205、typecheck/lint/export-jsdoc 全绿。

## Alternatives considered

- **模块与主文件共享同一 ctx**：拒绝——独立 ctx 才有干净的导出与 D6 语义；只把绑定名
  种进 importer 镜像 ES module 的 import 绑定语义。
- **绑定只在运行时用到时才校验**：拒绝——gate 必须在装载期静态判定，缺失导出在任何
  场景执行前就以 import 行号失败。
- **引擎内做 host key 解析**：拒绝——引擎只归一相对 specifier（按基准模块 key 消解
  `./..` 段）并精确匹配 `listModules()`；moduleKey 字符串由 host 定义。

## Consequences

- 多文件无 IR 场景（mesh）在 guarded direct 模式端到端可用：依赖独立执行、导出按
  存活 shape gate、循环与缺失模块走常规 failedAt 通道。
- 剩余 P5/P6 缺口：跨 execute/append 的 fingerprint 模块缓存（v1 每轮重装依赖）、
  `// @export` 收窄、3d_editor 侧 projectLoader 宿主接线、参数编辑 UI 面、完整 P4
  缺省翻转（BREP/topology/naming/changed/activeValues 收敛）。缺省保持 `'module'`；
  module 路径消费方零改动。
