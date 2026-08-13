# 命名语义校验（naming-validator）设计

> 定位：`.faijs` 文本 parse 时刻的「模型/版本命名语义」校验方案。
> 配套决策（2026-08-13）：**布尔运算结果跟随第一个输入（主体）模型**；**split / 无输入 op（primitive / load / sdf）算新模型**。

---

## 1. 背景与问题

按语法规范（docs/syntax-design.md §2），`partN_vM` 中 N = 模型号、M = 版本号；同一模型的不同版本构成版本链 `partN_v0 → partN_v1 → …`，不同模型拿不同模型号。

当前引擎**不校验**命名语义，下面的代码能通过 `check()` 全部三关（parse / schema / reference）并正常出几何：

```js
// apiVersion: 1
export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const part0_v1 = cad.sphere({ radius: 8, center: [5, 0, 0] })   // ← sphere 无输入，是独立模型，却占用 part0 的版本链
  const part0_v2 = cad.subtract(part0_v0, part0_v1)               // ← 主体是 part0_v0，版本 v2 递增合法；错误在上一行
  return { shape: part0_v2, name: 'box-boolean' }
}
```

`src/cad-runtime/check.test.ts:46` 甚至把这段代码标为 `'valid'`。命名语义错误会让 id 身份契约（diff 按 id 对齐）失真：独立模型冒充版本、版本号复用、跨模型归属错误，后续 AI 增量重写时无法正确判定 PARAM/STRUCT/ADD。

## 2. 决策（已拍板）

| 语句形态 | 模型语义 | 结果命名 |
|---|---|---|
| 无输入 op（box/sphere/cylinder/… / load / sdf） | **新模型** | `partN_v0`，N 必须未用过 |
| split 输出（front/back） | **两个新模型** | `partN_v0` / `partM_v0`，N、M 均未用过 |
| 布尔 op（union/subtract/intersect，多输入） | **一个新模型** | `partN_v0 |
| 加工类 op（translate/rotate/scale/drill/extrude/chamfer/engrave/knurl…，单输入） | 跟随输入模型 | `partN_v{M+1}`，N = inputs[0] 的模型号 |

> 注意：这是对 docs/syntax-design.md §2.2「布尔合并产出新 partN」的**修订**（§7 列出文档更新项）。

**判定不依赖 op 类别表**，只依赖 `inputs` 结构：`outputs` 存在（split）→ 新模型；`inputs.length === 0` → 新模型；`inputs.length ≥ 1` → 跟随 `inputs[0]` 的模型号。op 是白名单语义（布尔多输入、加工单输入），由 schema 阶段保证。

## 3. 校验规则

对每个非 marker 语句，解析 id `partN_vM`（非 `partN_vM` 格式的 id 跳过——保留给 `st_*` 等非可编辑来源）：

### R1 新模型必须 `_v0` 且模型号全新（error）

无输入 op 或 split 输出：
- 声明不是 `_v0` → 报错
- 模型号 N 已被其它语句使用 → 报错（该模型号已有自己的版本链，不得再作根）

### R2 版本号严格递增（error）

`partN_vM`（M ≥ 1）：
- `inputs.length === 0` → 报错（无输入不能是版本）
- 声明 M 必须 **>** 模型 N 已见最大版本：
  - 复用 / 递减（M ≤ 已见最大版本）→ 报错
  - 跳号允许（`part0_v0` → 声明 `part0_v2` 合法，v1 可空缺）
- inputs[0] 的模型号 ≠ N → 报错（跨模型归属：如 `part1_v1 = translate(part0_v0)`）

### R3 模型号跳空（warning）

首次出现的模型号 N > 已见最大模型号 + 1 → 警告（`part1` 未出现直接用 `part2`；编号具体值引擎不依赖，仅提示可读性）。

### R4 split 输出（error）

split 的每个输出 id 必须满足 R1（`_v0` + 模型号全新）。R2 不适用于 split 输出（它们不进入任何版本链）。

## 4. 错误消息示例

```
[parser] line 2: statement "part0_v1" has no inputs but is named as version v1; independent primitives must be named partN_v0 with a fresh model number (e.g. part1_v0)
[parser] statement "part1_v1" is a version of model part1, but its first input "part0_v0" belongs to model part0
[parser] statement "part0_v1" reuses version v1 of model part0 (already defined); versions must strictly increase
[parser] split output "front" must be a fresh model partN_v0; got "part0_v2"
```

## 5. 实现位置与接口

**新增** `src/lang/naming-validator.ts`（纯函数，零依赖，不 import 运行时）：

```ts
export interface NamingIssue {
  severity: 'error' | 'warning'
  stmtId: string
  message: string
}

/** 遍历 script.statements，按 R1–R4 校验模型/版本命名语义 */
export function validateNamingSemantics(script: PartScript): NamingIssue[]
```

**接入** `CadRuntime.check()`（src/cad-runtime/runtime.ts）：
- 在第 ③ 引用预检之后增加第 ④ 闸 `stage: 'naming'`
- severity `'error'` → 推入 `errors`（ok = false，拒绝提交）；`'warning'` → 推入 `warnings`
- 行号：CadStatement 不携带行号，错误只带 `stmtId`（与 schema 阶段行为一致，不做 parser 行号改造）

**不接入** `parseScript`：parse 保持纯结构还原，语义错误不抛 ParseError，避免 parse 与 check 职责混淆。浏览器宿主若绕过 `check()` 直接 `replay()`，可自行先调 `validateNamingSemantics`（函数导出即为此用）。

**codegen 必须同步修订**（否则引擎自己生成的文本会被自己的校验拒绝）：
- `src/lang/codegen.ts` 的 `varName` 分配（行 451-452 附近：非 `partN_vM` 格式 id 一律生成 `part0_vN`）需改为维护模型归属状态机：
  - 无输入 / split 输出 → 分配下一个未用模型号 `partN_v0`
  - 有输入 → 跟随 inputs[0] 的模型号，版本 +1
- `src/lang/codegen.ts` 的 `sceneToCode`（行 680-712 附近）同理。

## 6. 现有违规代码清单（随实现一并修正）

| 文件 | 位置 | 现状 | 修正 |
|---|---|---|---|
| src/cad-runtime/check.test.ts | :46-57 | 用户例子标为 valid | 改为期望 naming error；新增「修正后」的 valid 用例 |
| src/cad-runtime/check.test.ts | :138-141 | `part0_v1 = sphere; part0_v2 = union` | 仅 sphere → `part1_v0`（part0_v2 递增合法，保留） |
| src/lang/parser.test.ts | :135-151 | `part0_v1 = sphere; part0_v2 = union/subtract` | 仅 sphere → `part1_v0`（part0_v2 递增合法，保留） |
| src/lang/codegen.test.ts | :513-516 | `part0_v0 = load; part0_v1 = box`（box 无输入占版本号） | box → `part1_v0`，translate 跟随 box → `part1_v1` |
| src/lang/codegen.test.ts | :628 | `union(part0_v0, part0_v1)` 生成断言 | 按新归属规则改输入语句与期望 |
| demo/main.ts | :27-30 | `part0_v1 = sphere; part0_v2 = subtract` | 仅 sphere → `part1_v0`（part0_v2 递增合法，保留） |
| demo/main.ts | :34-38 | `part0_v1 = cylinder; part0_v2 = subtract; part0_v3 = translate` | 仅 cylinder → `part1_v0`（part0_v2/part0_v3 递增合法，保留） |

（demo/main.ts :42-45 text-engrave、:49-53 transform-chain 为单输入链，无违规，不动。）

## 7. docs 修订项

- **docs/syntax-design.md §2.2 模型号分配规则（行 125）**：「布尔合并产出新 partN」→「布尔合并跟随第一个输入（主体）模型的版本链」。
- **docs/syntax-design.md §2.2 示例（行 115）**：`part4_v0 = union(part1_v1, part3_v0)` → `part1_v2 = union(part1_v1, part3_v0)`，return 同步改为 `{ shape: part1_v2, … }`。
- **docs/syntax-design.md §3 映射表（行 198）**：union 行 `id: 'part4_v0', model: 'part4'` → `id: 'part1_v2', model: 'part1'`。
- **docs/syntax-design.md §4.5 场景表（行 295）**：`part4_v0=union(part1_v1,part3_v0)` → `part1_v2=union(part1_v1,part3_v0)`。
- **docs/syntax-design.md §2.4 禁止清单**：补一条——「无输入 op / split 输出不得占用已有模型号的版本链；新模型必须 `partN_v0`；版本号必须严格递增（跳号允许）」（与已有 split 禁令并列）。

## 8. 测试计划

新增 `src/lang/naming-validator.test.ts`：

- **合法**：单模型版本链（box→drill→chamfer）；多独立模型各取新号；布尔跟随第一输入（`part0_v1 = subtract(part0_v0, part1_v0)`）；跨模型布尔递增（`part0_v2 = subtract(part0_v0, part1_v0)` 跳号合法）；**版本跳号**（`part0_v0` → `part0_v2`，v1 空缺）；split 输出两个新模型后各自演化；非 `partN_vM` id（st_*）跳过
- **非法（error）**：用户原始例子（无输入 v1）；根节点非 v0；加工类跨模型（`part1_v1 = translate(part0_v0)`）；版本号复用/递减（`part0_v1` 出现两次）；split 输出非 v0；split 输出占已有模型号
- **warning**：模型号跳空（part0 → part2，part1 未出现）

`check()` 集成测试（check.test.ts）：原 :46 用例改为断言 `ok === false` 且存在 `stage: 'naming'` 错误；新增「修正后脚本 → ok」用例。

## 9. 范围外（本方案不做）

- UI 路径（`appendStatement` / SceneMutator）的 id 分配——引擎自身保证合规，不做运行时重复校验
- `replay()` 执行路径不重复校验（性能；入口统一走 check / dryRun）
- 行号定位（CadStatement 无 line 字段，schema 阶段同样无行号，保持一致）
