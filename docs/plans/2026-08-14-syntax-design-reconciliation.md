# syntax-design.md 修订记录与未决冲突清单

> 日期：2026-08-14
> 定位：本文档记录对 `docs/syntax-design.md` 的一次大修订的依据，以及「文档 ↔ 代码」不一致且**暂无唯一权威**的未决事项。
> 关联：对照 `C:\my\Faicad\3d_editor\docs\plans\2026-08-13-single-code-truth-design.md`（v2/v3 修订）与 faijs 当前实现后修订。

---

## 1. 已确认落地、以代码为准并已同步进 syntax-design.md 的事实

| 事实 | 代码依据 | 文档处理 |
|---|---|---|
| **平铺代码格式**：`scriptToCode` 输出无 `export default` / `return` / `apiVersion` 头的纯语句序列；parser 兼容旧格式（含 `export default` 时直接解析，纯平铺时自动包裹，`return` 仍解析为终端） | `src/lang/codegen.ts:392`（scriptToCode）、`src/lang/parser.ts:565-573`（自动包裹） | syntax-design §2.1/§2.2/§2.3 示例全部改为平铺 |
| **终端自动推导**：无 `return` 时由 DAG 推导（不被任何语句引用为输入的输出即终端） | `src/lang/parser.ts:780`（computeTerminalShapes） | §2.2 说明终端推导；§3 表格更新 |
| **PartScript 为场景级单一 DAG**（无 per-part 脚本） | `src/lang/types.ts:154` | §1 图更新 |
| **序列化函数收敛**：`statementToCode` / `statementToFlatLine` / `scriptToFlatCode` / `sceneToFlatCode` / `sceneToCode` 全部删除，仅剩 `statementToLine` + `scriptToCode` | grep 全仓 0 命中 | §1 双向转换更新 |
| **BREP 静态切换基础设施**：`MESH_ONLY_OPS = {sdf, knurl}`、`isCadFormat`、`solidCache`、`breakBrepChain`、多输入 boolean 全 solid 检查、CadRuntime 默认 `mode='auto'` | `src/brep/brep-chain.ts:38/60/167`、`src/ops/boolean.ts:39-40`、`src/cad-runtime/runtime.ts:132` | §2.4 补「同步 op 无 await、异步 op 加 await」示例；红线不变 |
| **group/assembly 裸调用 marker**：`cad.group({…})` / `cad.assembly({…})` 不赋值，解析为 `isMarker: true` 语句（id `grp_N`）；args 仅限字面量/参数/GeomRef（实测 `members: [part0_v0]` 引用语句 id 报 unknown identifier） | `src/lang/parser.ts:702-744`、`codegen.ts:343-345` | §2.3/§2.4/§3 补充 marker 形态 |
| **drill 契约**：`holeType: 'simple'\|'screw'`、`direction: 'normal'\|'x'\|'y'\|'z'`（字符串枚举）、**无 `type` 键** | `src/lang/args-schema.ts:142-158`、`src/ops/drill.ts:35-47` | §2.1/§2.2 示例修正（原示例的 `type:'through'`、`direction:[0,0,1]` 均报 schema 错） |
| **knurl 契约**：参数为 `knurlTextureHeight/knurlScaleU/knurlScaleV/knurlInvertDisplacement/knurlRefineLength/knurlMappingMode/faceCenter/faceNormal`，**无 `face` 键**，同步 op（无 await） | `src/lang/args-schema.ts:222-235`、`src/mesh/api.d.ts:64` | §2.2/§4.5/§6 示例修正（原 `{ face: 'top' }` 报 unknown field） |
| **boolean 文本形态**：`cad.union(a, b)` → `op:'boolean', args:{ operation:'union' }` | `src/lang/parser.ts:252-265` | §3 映射表修正（原写 `op:'union', args:{}`） |
| **参数不折叠**：`const size = 20` + `{ size }` 解析为 ParamRef `{$param:'size'}` + `script.params` 存 ParamDef（并非折叠为字面量） | `src/lang/parser.ts:667-685`（实测确认） | §3 表格修正；删除「见 §8」（文档无 §8） |
| **GeomRef 第三参**：`cad.faceCenter(of, [anchorPoint], faceOrdinal)`；`anchor.normal` 类型存在但文本无法表达 | `src/lang/parser.ts:161-173`、`codegen.ts:82-91` | §3 表格注明 |
| **apiVersion 可选**：缺省 1，codegen 不输出 | `src/lang/parser.ts:847-849`（getApiVersion） | §2.3/§4.1 改为「可选（默认 1）」 |

---

## 2. 未决事项（文档 ↔ 代码不一致，暂无唯一权威，需要决策）

### 2.3 `chamfer` / `slot` 等示例 op 不存在

- syntax-design 原示例使用 `cad.chamfer(part0_v1, {edges, radius})`（§2.2/§4.5/§6）与 `drill→slot`（§4.5）；faijs 的 `SCHEMAS` / codegen switch / parser op 表 / ops 分派均无这两个 op。
- `chamfer` 仅在旧设计稿（2026-08-13 命名规则设计）§2 中作为「加工类 op」举例（规划）。
- 处理：syntax-design 示例改用真实 op（`extrude` / `engrave` 等）；chamfer 实现后另行补契约。

### 2.4 已知代码缺陷（文档描述的是设计意图，代码未实现；非文档修订范畴，但影响示例可运行性）

1. **`CadRuntime.check()` 引用预检不认 split 的 outputs**：`src/cad-runtime/runtime.ts` ③ 只注册 `stmt.id`，不注册 `stmt.outputs` → 文档标准形态 `const { front: part1_v0, back: part2_v0 } = cad.split(...)` 后引用 `part2_v0`，`check()` 误报 `references undefined input "part2_v0"`（实测确认，唯一报错）。执行路径（replay）不受影响。建议修复：预检时把 `stmt.outputs` 一并注册，并补 `check.test.ts` 用例。
2. **`gen-api-dts` 生成的 AI 素材不全**：`src/mesh/api.d.ts` 的 `faceCenter/faceNormal` 缺 `faceOrdinal` 第三参签名；缺 `bboxMin` / `bboxMax` helper（parser / codegen 均已支持，仅生成素材缺失）。

---

## 3. 3d_editor 侧进行中的计划（仅记录，不影响 .faijs 语法契约）

- `3d_editor/docs/plans/2026-08-14-marker-statement-redesign.md`：UI 路径 split 从「2 条执行语句 + 1 条 marker」收敛为「1 条语句 + outputs」——faijs 语言层已是此形态，3d_editor 侧 recordSplit 待改；syntax-design 的 split 契约不变。
