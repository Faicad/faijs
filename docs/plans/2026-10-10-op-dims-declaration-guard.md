# 方案：op 量纲声明防遗漏机制

## 1. 用户原话

> 有没有什么方案，可以在以后新增op的时候，保证不会遗漏这个量纲的申明。而且保证量纲的申明只需要在一个地方处理，不需要重复申明

## 2. 问题定位

前期查证结论（2026-10-10 会话）：

- 单位字面量生成链路：op 在 `defineOp` 里声明 `paramDims`/`spec` → `CadRuntime.buildOpDims()` 汇总（cad-runtime/runtime.ts）→ 宿主经 `getOpDims()` 取表 → `formatCodeLine(opts)` 把数字序列化成 `n * MM`。
- **声明在架构上已经只有一处**（defineOp 元数据，运行时自动汇总），不存在今天的重复声明问题。
- 真正的问题是**可选性**：`paramDims` 是 defineOp 的可选字段，没有任何机制阻止新 op 漏写。实测 152 个 op 中仅 22 个有声明，`cad.extrude(sk, { length: 20 })`（裸数字、量纲参数）既不报 `E_DIM_BARE_NUMBER` 也不生成 `20 * MM`。
- 因此方案的目标是：**把"声明与否"从人的自觉变成机器强制**，同时不引入第二张表。

## 3. 方案设计

### 3.1 声明模型：逐参数穷举，`'plain'` 是合法取值（用户裁定）

**用户裁定（2026-10-10）**：否决 op 级 `dimless: true` 豁免（op 级开关会让未来新增的参数自动跟着被豁免，正是漏洞）；同时否决 branded 类型方案（TS 类型跨 JS VM 边界被擦除，脚本侧 `20 * MM` 就是裸 number，运行时无法承载 brand；且 `segments: 64` 这类合法纯数字最终仍需一个"无量纲 brand"，等于换名不换实）。

采用**逐参数穷举声明**：`paramDims` 必须覆盖 op 的**每一个数字参数**（含对象形态嵌套 key，经 `spec`），取值 ∈ `DimName | 'plain'`：

```ts
export const extrude = defineOp({
  name: 'extrude',
  paramDims: { length: 'length', offset: 'length' },   // 量纲参数
  ...
})

export const box = defineOp({
  name: 'box',
  paramDims: { width: 'length', depth: 'length', height: 'length', segments: 'plain' },  // 纯数字也是显式声明
  ...
})
```

- `'plain'` 与 `'length'` 同一张表、同一种写法，是"这个数字就是无量纲"的显式签名——**不存在第二种豁免通道**。
- 新增参数而忘写声明 → 层二守卫核对实现签名/JSDoc 参数清单时变红。
- 声明仍然只有一处：这不是第二张表，是同一条声明语句的唯一取值枚举。

类型无法校验的是**穷举完整性**（声明是否覆盖了实现里所有数字参数），这交给层二。

### 3.2 层二：AST 守卫脚本（CI 门禁）

新增 `scripts/check-op-dims.mjs`（与 `check-ghost-deps.mjs` / `check-api-test-coverage.ts` 同类，进 ci.ps1/ci.sh 守卫段），基于源码 AST 检查每个 `defineOp`/`compatOp` 调用点：

1. **穷举性**：`paramDims`/`spec` 必须存在，且其 key 集合与 op 实现签名（mesh/brep 函数形参 + 对象形态 params 的 JSDoc `@param params.*` 清单）中的全部数字参数一致——多声明、少声明、拼错 key 都红。量纲取值 ∈ `DimName`，纯数字参数取值必须是 `'plain'`（纯数字不声明 = 违规，与其他漏声明同罪）。
2. **完整性启发式**：交叉核对 op 的 JSDoc——`@param params.length - 总拉伸量（mm，>0）` 这类带 `（mm）/（degree）/（rad）/（kg）` 标注的参数，必须出现在 `paramDims`/`spec` 里；反之 `paramDims` 里声明的 key 必须在 JSDoc 中有对应 `@param`。JSDoc 的单位标注是文档惯例已存在的事实，用它当"应当声明"的信号，成本为零、无需新增注解语法。
3. **双实现一致性**：`mesh`/`brep` 双实现 op 只在 defineOp 声明一次，脚本断言同一 op 不存在分散的第二份声明（防止有人图省事在实现文件里再抄一份）。

违规 → CI 失败，与 lockstep 守卫同级硬门禁。

### 3.3 层三：运行时不变量（兜底测试）

新增一条持续不变量测试（参照 `script-globals.test.ts` 的全集驱动做法）：

- 遍历 `createApiNamespace()` 全部 op，断言每个都能从 `getOpDims()` 查到条目且条目非空（有量纲参数或含 `'plain'` 声明）。
- 对有 `paramDims` 的 op 抽样断言：裸数字调用报 `E_DIM_BARE_NUMBER`、`n * MM` 调用通过——保证声明真的接通了校验与序列化，不是写了没人读的死数据。

### 3.4 为什么不做"全自动推导"

考虑过让实现签名携带量纲信息（如品牌类型 `Dim<'length'>`）从而完全免除声明，但：

- 参数量纲是**语言/运行时契约**（脚本面 `20 * MM` 的语义），不是实现类型能表达的；推导会把契约藏进类型体操，`slotMap`、对象形态、`spec` 嵌套结构都会让推导规则失控。
- 且推导本身就是"第二处需要维护量纲知识的地方"，违背"只在一个地方处理"的要求。

故显式声明 + 双重门禁是更符合本仓"判据是脚本的出口"哲学的解。

## 4. 声明单一来源保证（用户第二个要求）

改造后的量纲知识只存在于一个位置：

```
defineOp({ paramDims: { [param]: DimName | 'plain' } | spec })   ← 唯一书写点（逐参数穷举，无豁免通道）
        ↓（运行时自动汇总，无人工参与）
   buildOpDims() / getOpDims()                   ← 唯一读取出口（宿主 + 校验器共用）
```

- 宿主序列化、D8 维度校验、AST 守卫、不变量测试全部消费同一份 `getOpDims()`，无人维护第二张表。
- 守卫脚本第 2 条的 JSDoc 交叉核对是**只读校验**，不产生需要同步维护的副本。

## 5. 实施步骤

1. `defineOp` 类型改造（sdk）：`paramDims`/`spec` 必填，值类型扩为 `DimName | 'plain'`；`compatOp` 同步。
2. 存量 op 补声明：逐 op 穷举全部数字参数（量纲参数 → `DimName`，纯数字参数 → `'plain'`）。先补已核对清单中的量纲 op（extrude/revolve/loft/sweep/shell/thicken/offset/fillet/chamfer/draft/boss/pocket/drill/engrave/pattern 系列/thread/helix/torus/ellipsoid/roof/makeBaseBox 等），再补纯拓扑/查询类（全部 `'plain'`）。分批提交，每批跑对应测试。
3. 新增 `scripts/check-op-dims.mjs` 并接入 ci.ps1/ci.sh 守卫段。
4. 新增运行时不变量测试（全集驱动 + 裸数字抽样）。
5. `docs/api-contract.md` 补一节"量纲声明纪律"；按仓库规则新增 Agent Note 记录该决策。

## 6. 风险与边界

- 补 `paramDims` 会让存量脚本里已有的裸数字调用（如测试 fixture、文档示例）开始报 `E_DIM_BARE_NUMBER`——这是**暴露既有违规**，不是新破坏；需同批修复 fixture/示例（`packages/tests/faijs/boolean/*.fai.js` 中已见 `radius:10`、`radius:8` 裸数字）。
- `packages/faijs-extra` 的编辑器 op（fai_drill/fai_extrude 等）同样适用本门禁，脚本需覆盖该包。
- `'plain'` 取值接入序列化链路时保持零行为变化：`'plain'` 参数不包单位字面量、不参与维度校验（与今天的裸输出一致），仅作为穷举声明存在。

## 7. 状态

已落地。实施完成：
1. `defineOp`/`compatOp` 类型改造：`paramDims`/`spec` 必填，值类型扩为 `DimName | 'plain'`。
2. 存量 152 个 op 全部补声明。
3. `scripts/check-op-dims.mjs` AST 守卫已创建并接入 ci.ps1/ci.sh。
4. 运行时不变量测试（`packages/core/test/lang/op-dims-invariant.test.ts`）已创建。
5. `docs/api-contract.md` §10.3 已补"量纲声明纪律"小节（双语）；Agent Note 已记录。
6. 存量 fixture/测试中的裸数字调用的修复为后续任务。
