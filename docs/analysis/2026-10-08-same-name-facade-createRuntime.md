# 同名门面 `createRuntimeWithCad` 及同类 API 设计错误梳理

> 日期：2026-10-08
> 状态：分析文档（未实施）
> 起因：tessellation 实现过程中踩坑（docs/plans/2026-10-07-faijs-tessellation-density-proposal.md §7）

## 0. 用户原话

> 门面 createRuntime(ports, mode, options) 的 options 是第 3 参（纯引擎版第 3 参是 libs）? 什么意思？
>
> 根本不应该有两个。很明显 packages\core\src\cad-runtime\createRuntimeWithCad.ts 这个是错误的呀。以这个为案例，梳理这类的错误设计。

用户判定：`createRuntimeWithCad.ts` 的存在本身是错误的，"根本不应该有两个"——并以它为案例，要求梳理这一**类**错误设计。

## 1. 案例还原：一个名字，两个签名

仓库内有两个同名导出 `createRuntime`：

| 位置 | 签名（第 3 参起） | 注册 cad | 导出面 |
|---|---|---|---|
| `cad-runtime/createRuntimeWithCad.ts` | `(ports, mode?, options?)` | 自动注册（default） | `src/index.ts`（公开入口） |
| `cad-runtime/runtime.ts:1859` | `(ports, mode?, libs?, options?)` | 不注册 | 深路径 import（cli.ts 等内部用） |

两函数名相同、前两参完全一致、可选项位置不同。TS 对"可选参数位置传 `undefined`"不报错，于是门面版按 4 参调用时**第 4 参被静默丢弃**——tessellation 配置无声失效，测试诡异地失败，直到把 options 移到第 3 参才全绿。没有任何编译期或运行期信号指出参数放错了位置。

## 2. 为什么 `createRuntimeWithCad.ts` 是错误设计

1. **同名异签名**。两个 `createRuntime` 是"靠 import 路径区分语义"的 API。路径是文档知识不是类型知识——调用方记错路径或签名时，编译器帮不了他，只会静默丢配置。这与本仓已内化的教训一致：B3 事故（把内核聚合门面当公开 API import）同样是"路径错了但没有信号"。
2. **D1 决策的副产品，而非决策本身**。D1（2026-09-19）的决策是"createRuntime 自带 cad、引擎即标准库"。让"纯引擎入口"继续存在并**共享同一个名字**，不是 D1 的要求——是删旧门面时的顺手保留。决策文字（"宿主拿到 createRuntime 即带 cad"）实际上已宣判纯引擎版没有独立名字的正当性。
3. **薄包装门面没有独立演化权**。`createRuntimeWithCad` 只有 7 行有效代码，但它的签名一旦定下，就与核心 `createRuntime` 形成隐式耦合：核心每加一个参数（本次的 `tessellation`），门面的参数位序就多一层错位风险。两个签名 forever 漂移，靠人肉同步。
4. **命名暴露了设计犹豫**。文件名 `createRuntimeWithCad` 本身就在说"还有一个不带 Cad 的 createRuntime"——一个 API 需要用文件名的一部分去和另一个同名 API 划界，就是分叉的自供状。

## 3. 同类错误设计清单（以本案例为判据外推）

判据：**同名/近名 + 语义靠路径或文件名区分 + 类型系统不拦截误用**。

1. **同名门面/内核对**（本案）：`createRuntimeWithCad.createRuntime` vs `runtime.createRuntime`。同类结构在 `occt-primitives.ts`（`hullFromPoints as hullFromPointsCore`）也出现——同文件内 core 别名再转发，是较轻的变体，但同样的"转发层无独立语义却占一个签名位"。
2. **布尔路径双入口**：`api/boolean.ts`（dual-op 面，注册进 cad 命名空间）与 `api/boolean-op/index.ts`（另一条 boolean 实现，同样是 defineOp 面）。两个模块都叫"boolean"且都有 `union/subtract/intersect` 形状的产物，调用方无法从名字判断该 import 哪个；`api-namespace.ts:87` 只装配了前者，后者由谁消费并不自明。这是"两套实现、一套命名"的分叉。
3. **`api/*/index.ts` 目录门面**：13 个 `api/<x>/index.ts`，其中一些（如 boolean-op）并未进入 cad 命名空间，仅作深路径 re-export。目录 index 与命名空间装配点（api-namespace.ts）职责重叠——"op 的权威清单"因此有两个入口，与 `symbol-table.generated.ts` 作为权威清单的约定打架。
4. **参数错位型签名演化**（本案的直接伤害形态）：可选参数从尾部插入时，所有同名转发链上的每个签名都要人工对齐；无 lint 规则守护"同名导出的参数序一致性"。

## 4. 修复方向（方案级，未实施）

用户判定方向："根本不应该有两个"。据此：

- **方案 A（贴合用户判定，推荐）**：删除 `createRuntimeWithCad.ts`，`src/index.ts` 直接 re-export `runtime.createRuntime`；"自带 cad"通过**把 `createApiNamespace()` 的装配下沉到 `runtime.createRuntime` 内部**实现（cad 装配进 core runtime 本就是 D1 决策）。确实需要"无 cad 纯引擎"的宿主（node-host/cli.ts 等）改用 `createRuntime(ports, mode, {}, options)` 传空 libs，或提供一个**不同名**的 `createBareRuntime`（明确命名，不复用 createRuntime）。
- **方案 B（保守）**：保留两个入口但改签名对齐（门面版也收 `libs` 第 3 参）并加 lint/类型守卫禁止同名导出签名分叉。不消除两个入口，只消除错位风险——不满足用户"不应该有两个"的判定，仅作对比项。

方案 A 的连带清理：api/boolean 与 api/boolean-op 的命名分叉、api/*/index.ts 与 api-namespace.ts 的双清单问题，应各自单独立项核实消费方后处理，不与本案捆绑。

## 5. 教训沉淀

1. 一个公开名只能有一个实现体；"注册了 cad 的 runtime"不是一个需要第二个函数名的变体，它是 D1 之后 `createRuntime` 的唯一语义。
2. 可选参数错位是静默故障，任何"同名转发"都必须视为错位温床。
3. 文件名里带 "With/Without/Bare" 修饰词的模块，是 API 面分叉的强信号，评审时应触发"为什么不合并"的追问。
