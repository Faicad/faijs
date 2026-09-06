# 2026-08-16 faijs 示例代码契约审计与修复方案

> 范围：`test/faijs/**/*.faijs` 全部示例文件与 `docs/syntax-design.md` / `docs/api-contract.md` 契约的符合性审计。
> 结论：**多数示例违反契约，但全部能通过测试**。根因是 parser 宽容解析 + 测试只验证"能跑通"不验证"符合契约"。
> 方向：修复方向由 `docs/plans/2026-08-16-faijs-evolution-roadmap.md`（对标 FeatureScript 的演进路线图）§4 裁决——**L2/L4 为方向性强制**（终点语义的预演），非可选收紧；D 类处理按路线图修正（见 §2 D 类）。

---

## 1. 问题总览

审计 31 个 `.faijs` 文件，按严重度分类：

| 类别 | 数量 | 问题 | 是否报错 |
|------|------|------|----------|
| A. split 返回值写法错误 | 1 文件 | 单变量赋值替代多输出解构，back 半边静默丢失 | ❌ 不报错 |
| B. 参数顺序颠倒 | 12 文件 / 20 处 | `cad.op({ args }, input)` 写成 args 在前 | ❌ 不报错 |
| C. 创建类 op 携带 input | 2 文件 | `cad.text` 契约上无 inputs，却传入载体 | ❌ 不报错 |
| D. 旧格式残留 | 1 文件 | `export default` + `return { shape, name }` 旧写法 | ❌ 不报错 |
| E. 命名语义混乱（建议级） | 1 文件 | `part2_v1` 等 id 违反"版本链"直觉（语法允许） | 非语法问题 |

---

## 2. 逐文件问题清单

### A 类：split 返回值写法错误（本次审计的起点）

**`test/faijs/features/split.faijs`（全文 2 行）**

```js
const part0_v0 = cad.box({ size: 30 })
const part0_v1 = cad.split(part0_v0)   // ← 错误
```

- **契约冲突**：`syntax-design.md` §2.3 形态清单与 §9.1 均规定 split 必须使用**多输出解构**：
  ```
  const { front: <id>, back: <id> } = [await] cad.split(<inputVar>, { … })
  ```
  §3 映射表也明确 split 语句 `id = front 变量名`、`outputs = [front, back]` 两个输出 id。
- **语义后果（比语法冲突更严重）**：`src/ops/split.ts` L209-224 中，若 `stmt.outputs` 缺失（<2 个），执行端走 `else` 分支：
  ```ts
  kernel.release(secondarySolid)   // back 半边被直接释放
  ```
  即 `split.faijs` 实际只产出 front 半边，**back 半边在几何层面静默丢失**，模型不完整。
- **正确写法**（与 `multi-mesh/split-dag.faijs` L2 同构）：
  ```js
  const part0_v0 = cad.box({ size: 30 })
  const { front: part1_v0, back: part2_v0 } = await cad.split(part0_v0)
  ```

### B 类：参数顺序颠倒（input 应在 args 对象之前）

契约：`syntax-design.md` §2.3 `cad.<op>(<inputVar>?, { <key>:<val>, … })`；`codegen.ts` `statementToLine` L375 序列化输出同为 `cad.op(inputVars, { args })`。**契约与 codegen 一致：input 在前、args 在后**。以下 12 个文件共 20 处写成 `cad.op({ args }, input)`：

| 文件 | 行 | 现状（错误） | 正确写法 |
|------|----|--------------|----------|
| features/drill-test.faijs | 4 | `cad.translate({ offset: [10, 0, 0] }, part0_v2)` | `cad.translate(part0_v2, { offset: [10, 0, 0] })` |
| features/engrave-svg.faijs | 4 | `cad.engrave({ text: 'TEST', depth: 2, textSize: 8 }, part0_v0)` | `cad.engrave(part0_v0, { text: 'TEST', depth: 2, textSize: 8 })` |
| features/extrude.faijs | 2 | `cad.extrude({ length: 5 }, part0_v0)` | `cad.extrude(part0_v0, { length: 5 })` |
| features/text-engrave.faijs | 2 | `cad.translate({ offset: [0, 0, 14] }, part0_v0)` | `cad.translate(part0_v0, { offset: [0, 0, 14] })` |
| features/text-engrave.faijs | 3 | `cad.text({ text: 'HELLO', size: 8, depth: 2 }, part0_v1)` | 见 C 类（text 不应带 input） |
| parity/parity-drill.faijs | 4 | `cad.translate({ offset: [10, 0, 0] }, part0_v2)` | `cad.translate(part0_v2, { offset: [10, 0, 0] })` |
| parity/parity-text.faijs | 2 | `cad.translate({ offset: [0, 0, 24] }, part0_v0)` | `cad.translate(part0_v0, { offset: [0, 0, 24] })` |
| parity/parity-text.faijs | 3 | `cad.text({ text: 'TEST', size: 10, depth: 3 }, part0_v1)` | 见 C 类 |
| parity/parity-transforms.faijs | 2 | `cad.translate({ offset: [5, 0, 0] }, part0_v0)` | `cad.translate(part0_v0, { offset: [5, 0, 0] })` |
| parity/parity-transforms.faijs | 3 | `cad.rotate({ anglesDeg: [0, 0, 45] }, part0_v1)` | `cad.rotate(part0_v1, { anglesDeg: [0, 0, 45] })` |
| parity/parity-transforms.faijs | 4 | `cad.scale({ factor: 1.5 }, part0_v2)` | `cad.scale(part0_v2, { factor: 1.5 })` |
| syntax/geom-ref.faijs | 4 | `cad.translate({ offset: [10, 0, 0] }, part0_v0)` | `cad.translate(part0_v0, { offset: [10, 0, 0] })` |
| transforms/rotate.faijs | 2 | `cad.rotate({ anglesDeg: [45, 0, 0] }, part0_v0)` | `cad.rotate(part0_v0, { anglesDeg: [45, 0, 0] })` |
| transforms/rotate.faijs | 3 | `cad.rotate({ anglesDeg: [0, 90, 0], pivot: [0, 0, 10] }, part0_v0)` | `cad.rotate(part0_v0, { anglesDeg: [0, 90, 0], pivot: [0, 0, 10] })` |
| transforms/scale.faijs | 2 | `cad.scale({ factor: 2 }, part0_v0)` | `cad.scale(part0_v0, { factor: 2 })` |
| transforms/scale.faijs | 3 | `cad.scale({ factor: [1, 2, 3] }, part0_v0)` | `cad.scale(part0_v0, { factor: [1, 2, 3] })` |
| transforms/transform-chain.faijs | 2-4 | translate/rotate/scale 三处全倒 | 同上模式逐行调换 |
| transforms/translate.faijs | 2 | `cad.translate({ offset: [10, 5, 0] }, part0_v0)` | `cad.translate(part0_v0, { offset: [10, 5, 0] })` |

> 说明：B 类在**执行层不产生错误**——parser 按参数**类型**（Identifier→input、ObjectExpression→args）归类，`{ args }` 在前也能正确还原 inputs/args 结构，几何结果正确。但它违反序列化契约：`scriptToCode` 会把这类文本归一化成 input-first，导致**文本不可作为 UI 层 codegen 输出的规范形态**，且与文档、codegen 三方不一致。

### C 类：创建类 op 携带 input

`api-contract.md` §5.1 明确 `text` 为**创建类（无 inputs）** op（args 契约：`text`、`size`、`depth`、`font?`）。以下两处传入 `part0_v1` 作为输入：

- `features/text-engrave.faijs` L3：`cad.text({ text: 'HELLO', size: 8, depth: 2 }, part0_v1)`
- `parity/parity-text.faijs` L3：`cad.text({ text: 'TEST', size: 10, depth: 3 }, part0_v1)`

- **契约冲突**：创建类 op 不接受 input，`cad.text` 的合法调用应为 `cad.text({ text, size, depth })`（无第二参数）。
- **执行后果**：执行层 `executeText` 不消费 `inputs[0]`，多传参数被静默忽略，几何结果"碰巧正确"，掩盖了契约违背。
- **决策点**（二选一，见 §5）：
  1. 示例意图是"独立文字模型" → 删掉输入参数，改为 `cad.text({ ... })`；
  2. 示例意图是"在已有模型上刻字"（载体语义）→ 这是新需求，需把 `text` 重新定义为特征类（接受 inputs[0]）并同步更新 `api-contract.md` §5.1 与 args-schema，**不可仅在示例里这么写**。

### D 类：旧格式残留（export default + return）

**`test/faijs/parity/parity-screw.faijs`（全文为旧格式）**

```js
// apiVersion: 1
// Tests BREP/mesh parity for screw (excluding thread details)
export default async (cad) => {
  const part0_v0 = cad.screw({ system: 'metric', specIdx: 5, thread: 'coarse', length: 30, head: 'hex' })
  return { shape: part0_v0, name: 'parity-screw' }
}
```

- **契约冲突**（`syntax-design.md` §2.1 / §9.1 / api-contract.md §9.1）：
  - **`meta`（name/color）进文本**是真正的违规——由宿主管理，`.faijs` 文本中不存在 `return { shape, name, color }`；
  - `export default` 包裹 + 函数定义出现在**代码文本**里：v1 平铺格式是规范（容器是 parser 自动包裹的隐藏形态）；
  - `return { shape }`（仅终端、无 meta）本身**不是**要废除的东西——路线图 §3.3 判定其为终点强制的"显式终端"（parser 已支持且优先于自动推导），与函数返回值语义同构。
- **正确写法**（平铺，终端自动推导，meta 交给宿主）：
  ```js
  const part0_v0 = cad.screw({ system: 'metric', specIdx: 5, thread: 'coarse', length: 30, head: 'hex' })
  ```
- **为何不报错**：`parseScript` 对含 `export default` 的文本**直接按旧格式解析**（不自动包裹），且 `parseReturnStatement`/`parseReturnObject` 完整支持 `return { shape, name }` 旧语法（向后兼容，无废弃窗口声明——见路线图 §3.4）。注意 `src/cad-runtime/check.test.ts` 的多个测试用例本身仍在用旧格式写断言，与示例文件相互强化了旧格式的"合法感"。

### E 类：命名语义混乱（建议级，非语法错误）

**`test/faijs/multi-mesh/split-dag.faijs`**

```js
const part0_v0 = cad.box({ size: [50, 50, 20] })
const { front, back } = cad.split(part0_v0)
const part1_v1 = cad.box({ size: 20 })            // part1_v1 是新图元，却带 v1（暗示 part1_v0 存在）
const part0_v2 = cad.union(front, part1_v1)
const part2_v1 = cad.cylinder({ radius: 10, height: 20 })
const part2_v2 = cad.union(back, part2_v1)
```

- id 是**不透明 key**（§3 身份契约），`part2_v1` 作为新 cylinder 合法，执行无误。
- 但命名违背 `partN_vM` 的"版本链"直觉：`part2_v1` 暗示是 `part2_v0` 的下一版本，实际却是全新图元；`part2_v2` 是 `back` 链的产物却与 `back`（未命名 part2_v0）断裂。建议改为与 split 输出衔接的自洽命名，如：
  ```js
  const part0_v0 = cad.box({ size: [50, 50, 20] })
  const { front: part1_v0, back: part2_v0 } = cad.split(part0_v0)
  const part1_v1 = cad.box({ size: 20 })
  const part1_v2 = cad.union(part1_v0, part1_v1)
  const part2_v1 = cad.cylinder({ radius: 10, height: 20 })
  const part2_v2 = cad.union(part2_v0, part2_v1)
  ```
  （`multi-mesh/multi-return.faijs`、`boolean/boolean-ops.faijs` 等把多个独立图元全命名为 `part0_vN` 同理——UI 层自动生成的代码不会这样取名，但手写代码语法上允许，仅作建议。）

---

## 3. 根因分析：为什么全部不报错

### 3.1 parser 按类型不按位置/数量分类参数

`src/lang/parser.ts` `parseCadStatement` L266-289：

```ts
for (const argNode of init.arguments) {
  if (argNode.type === 'Identifier')      { inputs.push(...) }   // 任意数量、任意位置
  else if (argNode.type === 'ObjectExpression') { args = ... }   // 任意数量、任意位置
  else throw ...
}
```

- **不校验顺序**：args 在前、input 在后也被接受（B 类）。
- **不校验数量**：创建类 op 传 input（C 类）、特征类 op 传多个 input 均不报错。
- **不校验语句形态**：`cad.split(...)` 的单变量赋值走普通分支，完全不经过 `parseSplitDestructuring`（A 类）。`parseScript` L643 只在 `decl.id.type === 'ObjectPattern'` 时才进 split 解构分支——单变量 split 无任何 op 级形态检查。

### 3.2 args-schema 只校验参数键/类型，不校验语句形态

`validateStatementArgs` / `runtime.check()` ② 只针对 `stmt.args` 的字段名与类型做校验，**不涉及**：inputs 数量、参数顺序、split 是否解构、创建类是否带 input。§9.3 的"加载入口做 validateScriptArgs"承诺的是 args 校验，不是语句形态校验。

### 3.3 测试只验证"能跑通"，不验证"符合契约"

- `features/transforms/boolean/primitives/parity` 各目录测试统一模式：`parseScript` → `runtime.replay` → 断言**非空 mesh + bbox 有效**（如 features.test.ts L60-84）。B/C/D 类全部不影响这两个断言。
- **测试从未调用 `runtime.check()` / `validateScriptArgs`**，schema 层面的问题也查不到。
- **round-trip 测试掩盖顺序问题**（test/faijs/syntax.test.ts）：断言 `parse → scriptToCode → parse` 结构一致。codegen 永远输出规范顺序（input-first），parser 把 args-first 归一化后结构一致 → 测试通过。该测试验证的是"parser 与 codegen 自洽"，而非"示例符合文档契约"。
- `syntax/geom-ref.faijs` 注释自述 "For testing, we just verify the syntax is accepted"——fixture 内容与测试意图（测 GeomRef）不符，属于无效 fixture。

### 3.4 旧格式向后兼容

`parseScript` L570-573 对不含 `export default` 的文本自动包裹为旧格式容器；对含 `export default` 的文本直接解析（D 类）。`ReturnStatement` 分支完整保留（L695-700）。旧格式成为"影子语法"，与 §9.1 的禁止条款并存。

### 3.5 执行层对契约外状态静默降级

`src/ops/split.ts` L221-224：`outputs` 缺失时 `kernel.release(secondarySolid)` 静默释放 back，返回 front——**不抛错、不警告**（A 类的语义丢失由此产生）。类似地 `executeText` 不消费多余的 `inputs[0]`（C 类静默忽略）。

---

## 4. 修复方案（分三层）

### L1：修正全部示例文件（立即、零风险）

按 §2 逐文件替换为正确写法：A 类改解构、B 类调换参数顺序、C 类删除 text 的 input（若采用"独立文字模型"语义）、D 类改平铺格式、E 类（可选）按建议自洽命名。**L1 修复后现有测试应全部保持通过**（结构解析结果不变或更正后仍合法；round-trip 因 codegen 输出规范顺序而稳定）。

### L2：收紧 parser 语句形态校验（代码层，**方向性强制**，需实现阶段执行）

> **定位升级**：按 `2026-08-16-faijs-evolution-roadmap.md` §3.2/§3.3，参数顺序、input 数量、split 解构形态是终点（编译执行语言）的**强制绑定语义**——编译器就是签名校验器。现在强制 = 终点预演；晚强制 = 破坏性迁移（所有旧文本双写兼容或跑迁移工具）。

在 `parseCadStatement`（及 `parseScript` 的 split 分支）增加按 op 类别的形态校验：

| 规则 | 校验内容 | 违反时报错示例 |
|------|----------|----------------|
| 参数顺序 | Identifier（input）必须出现在 ObjectExpression（args）**之前**，且 args 对象至多 1 个、必须是最后一个参数 | `cad.translate({...}, part0_v0)` → ParseError |
| 创建类（box/sphere/cylinder/cone/wedge/text/screw/svgExtrude/load） | 不接受任何 input | `cad.text({...}, part0_v1)` → ParseError |
| 特征/变换类（drill/extrude/engrave/translate/rotate/scale/knurl/…） | 恰好 1 个 input | 0 个或 2 个 → ParseError |
| boolean（union/subtract/intersect） | ≥2 个 input，且全部为 Identifier | 现有逻辑已覆盖部分 |
| split | **必须**使用解构（Identifier 左值 + `cad.split` → 提示改用 `const { front, back } = ...`） | `const part0_v1 = cad.split(...)` → ParseError 提示 |
| 顶层控制流 | 顶层只允许 const 语句 / marker / return / 注释；if/for/while 直接写在顶层 → ParseError（路线图 §0 不变量：**顶层永远顺序执行**，控制流只在函数内；parser 现状已拒绝，补入契约） | 顶层 `if (x) {}` → ParseError |
| 参数数量上限 | 非 boolean op 至多 2 个参数（1 input + 1 args） | 3 个参数 → ParseError |

> 注意：收紧前需全量核对 `src/**` 内真实调用方与 `codegen.ts` 输出（codegen 已是规范顺序，天然兼容）。`check.test.ts` 中旧格式用例若被 L2 波及，仅提示改用平铺格式，不建议直接拒绝旧格式（向后兼容是显式决策，见 L3）。

### L3：补"契约符合性"测试闸门（推荐，防回潮）

1. **新增 `test/faijs/contract.test.ts`**：遍历 `test/faijs/**/*.faijs`，对每个文件断言契约形态——split 语句 `outputs.length === 2` 且 id 为解构左值；特征/变换类 `inputs.length === 1`；创建类 `inputs.length === 0`；每个非 boolean 语句的 args 对象位于 input 之后（文本层可用 AST 断言）。**先写契约测试、再跑 L1 修复**，让测试从"红"变"绿"，证明测试有效。
2. **各目录测试补调 `runtime.check()`**：在现有 `it` 内先断言 `check(code).ok === true`，使 schema 校验进入测试路径。
3. **示例文件引入"规范形态"自检**：将 `scriptToCode(parseScript(code))` 与原文比较（对规范书写的文件应逐字节一致），从 round-trip"自洽"升级为"符合 codegen 规范形态"。
4. （可选）`runtime.check()` 的 warnings 通道对旧格式文本输出"已废弃，请迁移平铺格式"警告，逐步淘汰 §3.4 影子语法。

### L4：执行层显式化（防静默丢失，**方向性强制**）

> **定位升级**：按路线图 §3.3，静默降级（split 丢 back / text 忽略多余 input）在终点编译语言中**不存在**——编译期静态拒绝。现在执行期显式报错 = 编译期拒绝的预演，与"禁止运行时回退"红线同构。

`src/ops/split.ts`：`outputs` 缺失时**抛错**而非 `kernel.release` 静默降级（`const part0_v1 = cad.split(...)` 必须在执行期失败），与"BREP 路径执行异常直接报错，不回退"的静态红线一致。同理 `executeText` 对多余 inputs 报错。此改动与 L2 双保险：文本层拒绝 + 执行层拒绝。

---

## 5. 待决策项

| # | 决策 | 选项 | 影响 |
|---|------|------|------|
| D1 | `cad.text` 是否应支持载体输入 | ① 保持创建类（示例删 input） ② 改为特征类（更新契约 + args-schema + 执行层） | 决定 C 类修复方向与 `api-contract.md` §5.1 变更范围 |
| D2 | 旧格式（export default）是否保留 | ① 永久兼容 ② 加警告逐步废弃 ③ 直接拒绝 | 决定 `parseScript` 是否保留自动包裹逻辑 |
| D3 | L2/L4 是否本轮实施 | ① 只修示例（L1） ② 示例 + 校验闸门（L1+L3） ③ 全量（L1+L2+L3+L4） | 决定本次改动范围。**路线图 §4 已裁决：L1 + L2 + L4 现在做（方向性强制），L3 测试闸门一并上**（守住强制不回潮） |

---

## 6. 验证方式

- L1 修复后：`npx vitest run test/faijs`（示例测试 + round-trip 全绿）；`npx tsx scripts/faijs-cli.ts check` 对每个修复后文件应 OK。
- L3 新增契约测试后：故意回退一个 B 类错误，契约测试必须变红（证明闸门有效）。
- L2/L4 实施后：`npm run typecheck` + `npm test`（含 `src/lang/parser.test.ts`、`src/cad-runtime/check.test.ts` 新增/更新用例）。

---

## 附录：受影响文件清单

| 文件 | 类别 |
|------|------|
| test/faijs/features/split.faijs | A |
| test/faijs/features/drill-test.faijs | B |
| test/faijs/features/engrave-svg.faijs | B |
| test/faijs/features/extrude.faijs | B |
| test/faijs/features/text-engrave.faijs | B + C |
| test/faijs/parity/parity-drill.faijs | B |
| test/faijs/parity/parity-text.faijs | B + C |
| test/faijs/parity/parity-transforms.faijs | B |
| test/faijs/parity/parity-screw.faijs | D |
| test/faijs/syntax/geom-ref.faijs | B（+ fixture 无效） |
| test/faijs/transforms/rotate.faijs | B |
| test/faijs/transforms/scale.faijs | B |
| test/faijs/transforms/transform-chain.faijs | B |
| test/faijs/transforms/translate.faijs | B |
| test/faijs/multi-mesh/split-dag.faijs | E（建议） |
| src/lang/parser.ts | L2 修改点 |
| src/ops/split.ts、src/ops/text.ts | L4 修改点 |
| test/faijs/*/*.test.ts、test/faijs/syntax.test.ts | L3 修改点 |
