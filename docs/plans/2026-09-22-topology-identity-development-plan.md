# 拓扑身份机制：开发计划

> 本计划取代 `docs/analysis/2026-09-22-topology-naming-mechanism-redesign.md` 的 §6「落地」一节。
> 分析与设计论证仍以该文档为准（其 §1–§5 的有效部分），本计划只定**做法、顺序、验收、同步面**。
>
> 读者假设：已读过上述分析文档。本计划不重复其论证，只在其上做**选择**并给出可执行步骤。

---

## 0. 用户原始需求与本轮澄清

### 0.1 本轮的澄清（原话）

> 请帮我做选择，选择最合理的路线，未来漏洞最少的路线。唯一需要考虑兼容性的部分，是 `fai_` 和 `group` 等 deprecated 标记的 api。它们不是真的 deprecated，它们是 3d_editor 需要的 op，不是给 faijs 自身用的。要保证这些 op 如果变更 api，需要同步更新 `../3d_editor` 项目。现在。请根据这份分析文档、以及我的澄清。先一份完整的、无歧义的开发计划。

### 0.2 由此产生的三条硬约束

| # | 约束 | 对本计划的影响 |
|---|---|---|
| **H1** | 兼容性**只**为 3d_editor 的消费面而存在 | faijs 自身的历史包袱不构成约束。凡"为了不破坏 faijs 自身旧行为"的妥协，一律否决 |
| **H2** | `@deprecated` 标记是**误标** | 这些 op 的定位要从「将来迁出并删除」改写为「3d_editor 消费面，变更需同步 `../3d_editor`」。**不是**删除项，**不是**逃生舱 |
| **H3** | 变更这些 op 的 API ⇒ 必须同步 `../3d_editor` | 计划里每一项触碰它们的改动，都要带一条对应的 3d_editor 动作，否则该 Phase 不算完成 |

### 0.3 我实测出的、比 H3 更宽的一条（必须提前说清）

`H2/H3` 按「op 清单」划边界。实测发现真实边界**比这个清单更宽一层**：

拓扑引用的**数据形态**（而非 op 名字）会经由一条链传到 3d_editor，而这条链的**下游消费者远不止 deprecated op**：

```
faijs  FaceNaming { origin, role, hint }
        naming/types.ts:180
   ↓  captureTopoRef(row)
faijs  FaceTopoRef { kind:'face', origin, role, hint }
        naming/capture-topo-ref.ts:39
   ↓  faceTopoRefFromRow(scopedId, rowIndex)
3d_editor  @faicad/faijs/browser 导入
        packages/app/src/engine/topology/capture-topo-ref.ts:60
   ↓  存进装配约束
3d_editor  { topoRef, surfaceType, faceRowIndex }
        packages/app/src/stores/tools/assemble-store.ts:693
   ↓  映射为 faijs 执行参数
3d_editor  face: { topoRef }   ← 写进 `.fai.js`
        packages/app/src/stores/core/model-store.ts:1799-1803
```

这条链的终端是 `fillet` / `cut` / `drill` / `assembly` 的**参数**——**这些 op 不全是 deprecated**。

**所以：改 `FaceNaming.origin` / `role` 的形态，影响面 = 3d_editor 的全部面/边引用，不只是 deprecated op。**

这不改变 H1（faijs 自身仍无需兼容），但把 H3 的"同步清单"从「op 名字」扩展为「op 名字 + 拓扑引用数据形态」。**§2 给出精确清单。**

---

## 1. 路线决策（本计划替你做的 11 项选择）

每条给出：**选了什么 / 否决了什么 / 为什么**。这是"最合理、未来漏洞最少"的具体内容。

### D1｜修机制，不是补声明

- **选**：先把身份机制建起来（身份 = `(StmtId, RoleName)`），声明层后置。
- **否决**：给现有 21 处 `fromBrep` 逐个补 roleTable。
- **理由**：42 条生成投影走 `compatOp`，而 `CompatSpec`（`api/internal/compat-op.ts:56-59`）与 `BrepResult`（`define-op.ts:72-75`）**没有命名字段**、文件标「生成文件，勿手改」。补声明这条路在结构上就是不通的——不是工作量大，是**无处可写**。

### D2｜身份坐标用 `(StmtId, RoleName)`，不用 `(PartName, string)`

- **选**：`origin: StmtId`。
- **否决**：保留 `origin: PartName`。
- **理由**：现状 origin 有两种选法（`primitives` 用语句 LHS、`import-brep.ts:77` 用资产名），后者使**同一资产导入两次共用 origin**，两个不同实体的第 k 个面算出完全相同的 ref。StmtId 天然唯一，且与变量重命名解耦。
- **代价**：`.fai.js` 里的 `{origin:'part0'}` 字面量形态变化 → 见 §2.3 迁移器。

### D3｜血缘图用「登记式」，不用「回算式」

- **选**：在执行期由 op 包装器**登记**一条边（stmt → inputs/outputs + kind），查询时沿已登记的 DAG 回走。
- **否决**：靠"重放语句重新推导血缘"。
- **理由**：登记式零重算成本、显式、可审计；回算式需要重跑几何或重新推断参数绑定。
- **修正分析文档**：文档 §5.2 只说了 `defineOp` 包装器一个登记口——**不够**。42 条投影走 `compatOp`（`api/internal/compat-op.ts`），**不经过 `wrapBrepOne`**。必须**一个登记函数 + 两个调用点**（§4.3）。

### D4｜声明模型用「封闭 kind 集合」，不用「每 op 自定义映射函数」

- **选**：六个封闭 kind（`kernel` / `identity` / `replicate(k)` / `construct` / `subdivide` / `unmodeled`）。
- **否决**：让每个 op 提供一个 `(face, index, opArgs, inputRoles) => RoleName` 自定义函数。
- **理由**：封闭集合才能在**生成期/编译期**校验完整性（G4 的前提）。开放函数无法机器判断"你漏了哪一类"。且 `identity`/`subdivide`/`replicate` 三类在封闭模型下是**零 op 代码**，开放模型下反而要每个 op 都写函数。

### D5｜不改 IR，血缘图纯执行期

- **选**：`.fai.js` 语法零改动；血缘图只存在于执行期。
- **否决**：往 `ExecutionAnchor` 加 `inputs`、或把血缘写进 IR。
- **理由**：`wrapBrepOne` 处已同时持有 `args` / `inputs` / `stmt` / 返回值（`define-op.ts:274-281`），执行期足够。改 IR 会波及 parser、codegen、UI 代码生成、`.fai.js` 兼容——收益为零。

### D6｜mesh 完全不参与，且删除现有伪拓扑

- **选**：拓扑身份是 BREP 专有能力。mesh 路径下 `edgeRef`/`faceRef` **显式抛 `E_TOPO_MESH_UNSUPPORTED`**。
- **否决**：保留 `assignPrimitiveFaceRoles`（`build-naming.ts:90-106`）作为 mesh 近似。
- **理由**（用户裁决）：mesh 表示不了拓扑，现有代码只是"尝试近似，实际没法用"。且它与 `roles.ts:68` 的 `ROLE_ASSIGNERS` 是**同一份词汇表的第二次手抄**——保留它就是保留一个必然与主链漂移的副本。

### D7｜`RoleName` 现在就上结构化联合

- **选**：`role: string` → 结构化 `RoleName` 联合，序列化为规范串（可逆解析）。
- **否决**：先保留 `string` 只加词表校验，之后再结构化。
- **理由**：`replica[k]/…` 与 `splinter(…)#j` 若先用扁平串，之后改结构化就是**第二次 breaking**。且 `.fai.js` 里 role 的**序列化形态**在两种方案下几乎相同（都是串），所以现在上结构化的额外成本接近零。

### D8｜`@deprecated` 标记改为「3d_editor 消费面」

- **选**：把这些 op 的 JSDoc 从「不属于 faijs 平台面，将来会迁往该项目并从 faijs 删除」改为「**`../3d_editor` 消费面**；变更其 API 必须同步更新 3d_editor」。
- **否决**：保持原措辞（会误导后续开发把它们当删除候选，进而把 3d_editor 打断）。
- **理由**：H2。原措辞里的「将来删除」是错误定位，**留着它就是留一个未来必定踩的坑**。
- **影响文件**：§2.2 列出 13 处 JSDoc。

### D9｜G3 的抗重放链必须**包含**这些 op

- **选**：G3 的链集合**必须**含 3d_editor 真实使用的 op。
- **否决**：分析文档 §4 G3 写的「不得使用任何 `@deprecated` op」。
- **理由**：那句话基于"H2 之前的误判"（以为它们要删）。按 H2，它们恰恰是**真实负载**——抗重放机制的唯一意义就是支撑真实负载。**排除它们 = 在一个没人用的子集上证明"机制可用"，等于没证明。**
- **具体**：§3 G3 的 5 条链里，第 5 条直接选 `fai_drill`（3d_editor 38 个文件在用）。

### D10｜8 条「声明了但没接线」的 `brep-op` — **已决：推迟，本计划不做**

> **裁决（用户 2026-09-22）**：D10 **推迟**。本计划不执行任何处置（不加 `naming`、不改 `kind`、不接线），
> 这 8 条保持 `kind: 'brep-op'` 原样 ⇒ 本计划内**零改动、零 diff**。

**推迟为什么安全（判据已隔离）**：D11 的强制判据是 **`kind === 'brep-op' && scriptFace === true`**。
这 8 条的 `scriptFace` 不是 `true`（在 `script-face-manifest.ts` 与 `api-namespace.ts` 里各出现 0 次）
⇒ **生成器不会要求它们声明 `naming`**，§6 的「34 条 100% 有声明」统计也不含它们。
⇒ **D10 与命名重构主线正交**，这是"可安全推迟"的根据，不是回避。

**重评时机**：当决定「这 8 条要不要实现」时（它们是独立的功能开发项）。届时二选一 ——
`kind` 改 `skip` + `reason`（承认未实现、可 grep），或真接线（补 mesh 面与参数形态）。
**已被排除的选项**：保持 `brep-op` 且加 `naming: unmodeled('未接线')` —— 给死代码加声明会**掩盖"没接线"**。

#### 事实留档（盘点结果，非本计划待办）

`arg-spec.ts` 是**手写的投影声明表**（`ARG_SPEC`）。每条声明「把 vendored brepjs 的哪个函数投影成 cad op」。
`kind` 的语义由生成器定义（`gen-l3-surface.ts:13-16`）：

- `brep-op` → 生成 `defineOp({brep: …})` 代码（`renderBrepOp`，`gen-l3-surface.ts:253`）
- `skip` → **仅登记，不生成**（`gen-l3-surface.ts:202` `continue`、`:245` 过滤掉）
- `skip` 有 `reason` 字段（`ArgSpecEntry.reason`，注释写 "must be non-empty"），**全仓已有 395 条在用**，每条都写了理由

这 8 条在 `arg-spec.ts` 里标着 `kind: 'brep-op'`：

| op | arg-spec 行号 | 在 `script-face-manifest.ts` | 在 `api-namespace.ts` |
|---|---|---|---|
| `sweep` | 1546 | **0 次** | **0 次** |
| `complexExtrude` | 1552 | 0 | 0 |
| `twistExtrude` | 1558 | 0 | 0 |
| `roof` | 1585 | 0 | 0 |
| `thread` | 1626 | 0 | 0 |
| `section` | 2808 | 0 | 0 |
| `shell` | 2843 | 0 | 0 |
| `fixSelfIntersection` | 3198 | 0 | 0 |

⇒ **它们被声明为「要投影的产形 op」，代码也生成了（`generated/*.ts` 里有 `export const sweep = compatOp(…)`），但没有任何地方把它挂进 `cad` 命名空间。**
结果是 `cad.sweep` 不存在，而 `arg-spec` 却声称它有。**这是一个「能力虚报」**——
「42 条 brep-op」这个数字把 8 条死代码算进去了，真正生效的只有 34 条。

#### 预案对照（将来重评时选用，非本计划规程）

| 选项 | 做法 | 收益 | 代价 |
|---|---|---|---|
| **A** | `kind` 改 `skip`，`reason: '未接线：generated 版无引用；能力缺失，待实现后恢复'` | 声明表**不再虚报**；"这 8 个没实现"变成可 grep 的显式事实 | `generated/*.ts` 重新生成后**少 8 个函数**（真 diff）；projected 计数 42→34 |
| **C** | 保持 `brep-op`，**真接线**（挂进 `api-namespace.ts`） | 这才叫「补能力」 | 独立功能开发项（mesh 面、参数形态、语义需先定义），远大于命名重构；它们当初没接线很可能就是"接不上" |
| ~~B~~ | 保持 `brep-op`，加 `naming: unmodeled('未接线')` | 零 diff | **已排除**：给死代码加声明 = 掩盖"没接线"，后人看 `arg-spec` 会以为它们是活的 |

#### 两点澄清

1. **D10 独立于 D11，不是它的推论。** D11 的强制判据是 `kind === 'brep-op' && scriptFace === true`。
   这 8 条的 `scriptFace` 不是 `true` ⇒ **D11 不会要求它们声明 `naming`**。
2. **推迟 ≠ 无后果，也 ≠ 假装它不存在。** 唯一后果是：`arg-spec` 把 8 条死代码算进「42 条 `brep-op`」，
   这个**虚报继续留着**。它是本计划**显式接受的已知状态**（事实登记处 = 本节，其他地方只引状态），
   并在 Phase 2 回填声明时**自然产出「34 条生效」的计数**（27+1 投影 + 6 手写覆盖，见 §6），不靠人工记忆。

### D11｜`naming` 必填无默认值，第三方库走显式 `unmodeled`

- **选**：`defineOp` 的 `naming` 必填（缺 → TS 编译错误）；`ArgSpecEntry` 的 `naming` 对 **`kind === 'brep-op' && scriptFace === true`** 必填（缺 → 生成器 `throw`）——这个复合判据同时是 D10 可安全推迟的根据（那 8 条 `scriptFace !== true`，不被要求）。第三方库用显式的 `naming: unmodeled('reason')`，**不给默认值**。
- **否决**：给第三方库默认 `opaque` 以避免 breaking。
- **理由**：项目红线「能力缺口的正解是补能力或报错，不是加旁路开关」。默认值就是旁路开关。
- **代价（明确接受）**：这是对 `fai_cq_gears` / `fai_cq_warehouse` / `sheetmetal` 的 **breaking change**——每处 `defineOp` 都要加一行声明。Phase 2 含同步步骤。

---

## 2. 兼容契约：唯一需要保持的边界

### 2.1 3d_editor 的实际消费面（实测）

| 消费对象 | 位置 | 用途 |
|---|---|---|
| `SelectorRuntime` | 3d_editor `useTopologyPicking.ts:4`（`@faicad/faijs/browser`） | 拾取 → `faceReferenceByRowIndex` / `edgeReferenceByRowIndex` / `referenceMap` |
| `FaceNaming` / `EdgeNaming` / `PartNaming` | `capture-topo-ref.ts:21` | 命名行 → TopoRef |
| `captureTopoRef` | `capture-topo-ref.ts:20` | 构造函数 |
| `FaceTopoRef` / `EdgeTopoRef` | 同上 | 装配约束 / op 参数 |
| `FaceRef` | `model-store.ts:12` | 装配约束参数形态（`{ topoRef }` / 几何快照） |
| `SelectionMode` / `SelectorRuntimeData` 等 | 219 处 `@faicad/faijs/browser` | 广面 |

**3d_editor 对 `origin`/`role` 的生产代码使用 = 纯透传。** 全仓只有 **2 处测试**对它们做断言：

- `packages/app/src/engine/topology/capture-topo-ref.test.ts:69-70` — `ref.origin === 'part0'`、`ref.role === 'box:top'`
- `packages/app/src/stores/tools/assemble-store.test.ts:481` — `constraint.fixedFace.topoRef.origin === 'part0'`

这对我们**有利**：生产代码不做语义判断 ⇒ 改形态不需要改 3d_editor 的逻辑，只需要改断言 + 迁移存量数据。

### 2.2 同步清单（改 X ⇒ 必改 Y）

> 规则：**每一项必须在同一 PR 周期内完成 3d_editor 侧动作，否则该 Phase 不算完成。**

| # | faijs 侧改动 | 3d_editor 侧动作 | 触发 Phase |
|---|---|---|---|
| **S1** | `FaiNaming.origin` 语义 `PartName` → `StmtId` | 更新 `capture-topo-ref.test.ts:69`、`assemble-store.test.ts:481` 的断言 | Phase 1 |
| **S2** | `role` 形态 `'box:top'` → `'top'`（去 op 前缀） | 同上（`:70`） | Phase 1 |
| **S3** | `TopoRef` 的 `.fai.js` 序列化形态变化 | **迁移器**：`migrateTopoRefV1ToV2`（§2.3），3d_editor 载入旧场景时调用 | Phase 1 |
| **S4** | mesh part 的 `naming` 从 `{role:''}` 变为 **不产出**（D6） | 确认 `capture-topo-ref.ts:62-63` 的 `!row → null` 分支覆盖；加一条 3d_editor 侧测试 | Phase 1 |
| **S5** | `fai_drill` / `fai_split` / `fai_extrude` / `copy` / `place` / `transform` 家族 / `group` / `assembly` / `load` 的 **naming 声明**（不改参数形态） | **无需改动**（纯内部） | Phase 2 |
| **S6** | 若 Phase 3 发现某个 deprecated op 的**参数形态**必须变 | 按 H3 同步 `../3d_editor` 调用点（届时在 Phase 3 单独列出精确清单） | Phase 3 |
| **S7** | `@deprecated` JSDoc 措辞改写（D8） | 无需改动 | Phase 0 |
| **S8** | `edgeRef` / `faceRef` 入参形态（本计划**不改**） | 无需改动 | — |

**S6 是本计划唯一可能的"未知同步面"**，必须在 Phase 3 结束时给出"有 0 处"或"有 N 处，清单如下"的明确结论。不写"可能"。

### 2.3 存量 `.fai.js` 的迁移（S3）

`TopoRef` 字面量进 `.fai.js`（经 `model-store.ts:1799-1803`）。形态变化 ⇒ 需要迁移器。

**新旧形态可机器区分**（这是迁移可行的前提）：

| 字段 | 旧 | 新 | 区分依据 |
|---|---|---|---|
| `origin` | `'part0'` / 资产名 | `'s7'`（StmtId） | 旧值匹配 `^part\d+$` 或资产名；新值匹配 `^s\d+$` |
| `role` | `'box:top'`（带 op 前缀） | `'top'` | 旧值含 `:` 前缀且前缀是 op 名；`wall:3` **也是**含冒号的合法新形态——需按前缀判定 |
| `origin`（资产名） | `'MyAsset.step'` | StmtId | 资产名不匹配 `^s\d+$` |

**做法**：

1. faijs 提供 `migrateTopoRef(input: unknown): TopoRef`（纯函数，`packages/core/src/topology/naming/migrate.ts`），**幂等**。
2. 3d_editor 在载入场景代码时对 `topoRef` 参数跑一次迁移，然后按新形态写回。
3. faijs 侧加迁移器单测：覆盖 `part0` / 资产名 / `box:top` / `wall:3`（不得误伤）/ 已是新形态（幂等）。

> ⚠️ 迁移器只处理**数据**，不处理**行为**。若某个场景依赖旧的 `face_N` 位置名（现状 `roles.ts:105` 的兜底），迁移后该引用会**解析失败**——这是**正确行为**（那些名字本就违反 R3，抗重放能力为零）。迁移器应当**报告**这类 ref 而不是伪造映射。3d_editor 侧据此提示用户重新拾取。

### 2.4 措辞校正清单（S7 / D8）

`@deprecated` → 「`../3d_editor` 消费面」，共 13 处：

```
packages/core/src/api/compound.ts:154        (group)
packages/core/src/api/compound.ts:188        (assembly)
packages/core/src/api/copy.ts:66             (copy)
packages/core/src/api/fai_drill.ts:226       (fai_drill)
packages/core/src/api/fai_extrude.ts:54      (fai_extrude)
packages/core/src/api/fai_split.ts:238       (fai_split)
packages/core/src/api/load.ts:43             (load)
packages/core/src/api/transform.ts:116       (translate)
packages/core/src/api/transform.ts:147       (rotate_euler)
packages/core/src/api/transform.ts:180       (scale)
packages/core/src/api/transform.ts:216       (scale3d)
packages/core/src/api/api-namespace.ts:17,19 (块注释)
packages/core/src/api/index.ts:16,20         (块注释)
```

> ⚠️ 注意：`scale` 同时在**两个清单**里——它既是 3d_editor 消费面（本条），又是表 B1 里 6 条「手写覆盖」之一（`transform.ts:189`）。
> 两条约束叠加 ⇒ **改 `scale` 的 role 词汇要同时走「相位 2 声明」+「3d_editor 同步」。** 核实每个名字属于哪些清单，是 Phase 0 的一项具体工作。

> 措辞模板：**「`../3d_editor` 消费面：该 op 为编辑器应用提供，不属于 faijs 平台面，但**不是**废弃项。**变更其 API 形态必须同步更新 `../3d_editor`**（见 `docs/plans/2026-09-22-topology-identity-development-plan.md` §2）。新平台代码请用 `<平台对应 op>`。」**

---

## 3. 目标与验收判据

沿用分析文档 §4 的 G1–G6，**G3 口径按 D9 修正**。

| # | 目标 | 验收判据（可复跑、可失败） |
|---|---|---|
| **G1 完备** | BREP 链上任何产物的每个面都有身份；无身份的面必须有可枚举、可归因的原因 | 覆盖率测试：跑 N 条真实链，输出每条产物的「未命名面数」。目标 **0**；非 0 必须指向具体语句 + op |
| **G2 可归因** | 任何引用失败，报错指向「哪条语句的哪个 op、声明了什么、为什么没有」 | `no role table (nameless shape)` 这类**不指向任何东西**的报错全仓归零；新增绊线测试钉住 |
| **G3 抗重放** | 改参数重跑，引用解析到"同一个"面 | ≥6 条链（§3.1），**必须含 3d_editor 真实负载**；判据不是"解析成功"，是"解析到的面与首次捕获语义等价" |
| **G4 声明成本** | 新增 op 让产物有身份，动作 = 写一个类别标签；忘了写在**编译期/生成期**失败 | 刻意新增一个漏声明的 op → 生成/编译必须失败（防回归测试） |
| **G5 一致** | compat 面与 cad 面同名 op 身份能力一致 | 审计测试枚举两个命名空间，逐 name 比对声明存在性 |
| **G6 无静默降级** | 删掉一切"解析不了就猜" | ① `roleOfOrdinal` 按 hash 反查，碰撞 → 报错；② `build-naming` 的 `role:''` 兜底删除；③ 几何 hint 兜底保留但**必须唯一胜出**，否则报错（`resolve-face.ts` 的 `AMBIGUITY_THRESHOLD` 逻辑覆盖到全部路径） |

> **G3 是核心。** 若 G1/G2/G4/G5/G6 全绿而 G3 只有一条 `box→translate`，本计划等于没做——因为它没证明机制能干它唯一该干的事。

### 3.1 G3 的链集合（D9 修正后）

**6 条**，按"必须覆盖的类别 × 真实负载"选：

| # | 链 | 覆盖 | 依据 |
|---|---|---|---|
| **L1** | `sketch → extrude → fillet` | `construct`（新造面词汇）+ `kernel`+`byAdjacency`（过渡面） | 最难的两类叠在一起。**原文写的是 `box → extrude → fillet`，实测跑不通**（`cad.extrude` 是 brepjs 投影、入参必须 face/wire，传 solid 直接 `EXTRUDE_FAILED`）⇒ 改用与 FCStd `Pad→Fillet` 同形的等价链，覆盖面不变（见 §7.1「0.5 的落地结果」） |
| **L2** | `sketch → extrude → cut` | `construct` 的**递归词汇**（profile 本身是构造产物）+ `kernel`（布尔） | `wall:<i>` 稳定性 ⇔ profile 边序稳定性 |
| **L3** | `box → linearPattern(3)` | `replicate(k)` | 复合身份 `replica[k]/…` |
| **L4** | `box → split` | `subdivide` | 复合身份 `splinter(…)#j` |
| **L5** | `box → fai_drill` | `kernel`（组合布尔）+ **3d_editor 真实负载** | 38 个 3d_editor 文件在用 |
| **L6** | `box → faceRef(…, 'top') → fillet` | 端到端身份化引用（role 字面量进脚本） | 验证 R2（role 可写进 `.fai.js`） |

**已删除**：分析文档原 G3 里那条 `box → translate`。它覆盖 `identity`（最难的一类里最简单的），且 `translate` 属 3d_editor 消费面（`transform.ts:116`）。**`identity` 类由 L3/L6 间接覆盖**。

另：`translate` / `rotate` / `mirror` / `scale` 在 Phase 0.3 后一律走 `kernel`（真 `WithHistory`），**不再依赖"面序不变"这个假设**。§7 第 6 项测的是该假设当年是否成立，结论只决定"要不要补一条 `box → place → box:top 解析` 链"（`place` 仍属 `identity`）——**两个分支的处置已在 §7 预置，不构成待定项**。

### 3.2 禁止事项（写进 CI 守卫）

1. **禁止**：任何"未声明就默认成某个 kind"的代码路径。
2. **禁止**：`catch` 住拓扑解析错误后返回 `null` / 序号兜底 / 几何近似。
3. **禁止**：新增 `role: ''` 或等价的空 role 兜底。
4. **禁止**：在 mesh 路径上构造任何拓扑身份。
5. **禁止**：`fromBrep` / `compatOp` 之外新增产形入口而不经登记函数（§4.3）——由 G1 的覆盖率测试钉住。
6. **禁止**：用加锁 / 排队 / 重试来"容忍"并发执行多个 runtime（C1，§4.7.1）——必须**抛错暴露**。

---

## 4. 设计定稿

### 4.1 身份

```ts
// packages/core/src/topology/naming/types.ts（原地扩展，不新建目录）
interface FaceIdentity {
  readonly origin: StmtId      // 权威：产生这个面的那条语句（全局唯一）
  readonly role: RoleName      // 那条语句把它当作什么（§4.2）
}
```

- `origin` 一律 `StmtId`。**链根也用它自己那条语句**（不再有"资产名"这种 origin）。
- 显示名 `display?: PartName` 仅用于 UI，**不参与身份判定、不参与解析**。
- **不新建 `topology/identity/` 目录**：现有 `topology/naming/types.ts` 已是身份类型的家，新建第二个家会立刻产生"同一个类型两处定义"。新文件一律放 `topology/naming/` 下（`role-name.ts` / `lineage.ts` / `migrate.ts`）。

### 4.2 `RoleName` 契约与序列化

**定义**：一条语句对自己产出的每个面起的**局部名**。作用域 = 那条语句；全局唯一性由 `(origin, role)` 提供。

```ts
type RoleName =
  | { kind: 'semantic'; name: string }                    // 'top' 'bottom' 'lateral'（op 词汇表封闭）
  | { kind: 'wall'; index: number }                       // profile 第 i 条边扫出/旋出的面
  | { kind: 'hole'; index: number; inner: RoleName }      // 内环下的子结构
  | { kind: 'replica'; k: number; inner: RoleName }       // pattern 第 k 份
  | { kind: 'splinter'; inner: RoleName; index: number }  // split 第 j 片
  | { kind: 'generated'; op: string; index: number }      // fillet/chamfer 过渡面
  | { kind: 'imported'; index: number }                   // import_brep 的原始面序
```

**序列化（进 `.fai.js`）**：`top` / `wall:3` / `hole:1/wall:2` / `replica[2]/wall:3` / `splinter(top)#1` / `gen:fillet:0` / `imported:5`

**四条约束**（分析文档 §5.1.1 R1–R4）：局部唯一 / 封闭可枚举 / 抗参数变化 / 结构化可分解。

**两个必做**：

1. `parseRoleName(s): RoleName | null` 与 `formatRoleName(r): string` **互为逆**，有 round-trip 测试（覆盖全部 7 个 kind + 嵌套 `replica[k]/hole[j]/wall[i]`）。
2. **词汇表随 op 声明进生成产物**：`gen-api-dts.ts` + `gen-ops-api-inventory.ts` 要把每个 op 的 `RoleName` 词汇表产出到 `.d.ts` / API 手册。改词汇 = breaking，需版本化。

### 4.3 血缘图：**一个登记函数 + 两个调用点**

```
                      ┌───────────────────────────────────┐
   手写 op  ──────────▶│  wrapBrepOne(r, anchor)           │
   define-op.ts:274-281│   · inputs = callArgs.filter(...) │
                       │   · outputs = [nameOf(r.solid)]   │
   ────────────────────┤   · anchor = getCurrentStmt()     │──▶  registerStep(node)
                       └───────────────────────────────────┘         │
                                                                     ▼
   生成投影 ──────────▶┌───────────────────────────────────┐   lineage: Map<StmtId, LineageNode>
   compat-op.ts 边界  │  同一次登记（args 已可得）        │   partToStmt: Map<PartName, StmtId>
                       └───────────────────────────────────┘
```

```ts
// packages/core/src/topology/naming/lineage.ts（新建，在 naming/ 下）
interface LineageNode {
  readonly stmt: StmtId
  readonly op: string
  readonly inputs: readonly PartName[]        // inputs.map(nameOf)
  readonly outputs: readonly PartName[]
  readonly kind: ProvenanceKind               // op 声明的类别（§4.4）
  readonly newFaceVocab?: readonly RoleName[] // kind='construct'|'kernel' 时
  readonly evolution?: HashEvolution          // kind='kernel' 时执行期记录
}
```

**登记函数的三条硬规则**（这是"未来漏洞最少"的核心）：

| # | 规则 | 违反时 |
|---|---|---|
| **N1** | `inputs.map(nameOf)` 中任一项为 `undefined` → **报错** | `E_TOPO_UNTRACKED_INPUT`（**不许默认成链根**——那会静默产生错误身份，是最难查的一类 bug） |
| **N2** | `getCurrentStmt()` 未设置，或 `anchor.id !== node.stmt` → **报错** | `E_TOPO_NO_ANCHOR` |
| **N3** | 同一 `StmtId` 重复登记且内容不同 → **报错** | `E_TOPO_DUPLICATE_STMT` |

**为什么 N1 必须是错误而不是默认值**：若 inputs 里有一个 Shape 查不到名字（op 内部临时造的），"默认成链根"会产出一个**看起来对但语义错**的身份——引用能解析成功，但解析到错的面。这类错误不会在测试里暴露，只会在用户改参数时暴露。**宁可在执行期就炸。**

### 4.4 六个 provenance kind（封闭）

| kind | 语义 | op 需写的 | 覆盖 |
|---|---|---|---|
| `kernel` | 内核给历史 | `byAdjacency` 或 `explicit(词表)` | boolean / fillet / chamfer / shell / offset / 刚体变换（绑定补齐后） |
| `identity` | 1:1，第 i 面 → 第 i 面 | **零** | copy / place / clone / locate / applyMatrix |
| `replicate(k)` | 第 k 份第 i 面 ← 第 i 面 | 份数 k | linearPattern / circularPattern / gridPattern / rectangularPattern / mirrorJoin |
| `construct` | 输出面 ↔ 输入的构造规则 | 枚举器（= 构造定义） | extrude / revolve / sweep / loft / primitives / sketch / import_brep |
| `subdivide` | 每输入面 → 若干片 | **零** | split / section |
| `unmodeled(reason)` | 显式记账：算不出来 | 理由字符串 | 应趋近于 0；**审计测试必须列出全部并给出理由** |

> 本表是**类别归属**，不是接线状态（例：`sweep` 属于 `construct` 类，但未接线，见 §1 D10）。

**载荷**（分析文档 §5.3.1）：继承面的处置**完全由 kind 决定**，op 不写；只有 `construct` 和 `kernel` 会造新面，才有词汇这一项。⇒ `identity` / `subdivide` / `replicate(k)` **零声明**。

**`kernel` 类不能依赖内核的 `generated`**：实测恒空（`face-evolution.ts:140`）。所以 `byAdjacency` / `explicit` 是**必填**。

统一的新造面词汇口径（封闭）：

```
cap:<name>      端面/盖面      cap:top  cap:bottom  cap:start  cap:end
wall:<i>        由第 i 条边扫出/旋出的侧面（i = 输入 profile 边序）
hole:<j>[/…]    第 j 个内环下的同名子结构
```

### 4.5 查询与缓存

```
resolve(identity, atPart):
  1. identity.origin(StmtId) → partToStmt 反查 → 从该步沿 lineage DAG 走到 atPart 的语句
  2. 每一步按该步的 kind 推进 RoleName（hash 只是中间表示，不是身份）
  3. 任一步推进不了 → 精确报错（§4.6）
```

**缓存**：`Map<StmtId, RoleTable>`，挂在 `CadRuntime` 实例上，**执行开始时清空**（一次执行内 StmtId 稳定）。产物上的 `roleTable` **降级为同一条路径的缓存**——miss 就按 DAG 重算，**不再是错误来源**。

这一条直接消灭"忘了建表 = 静默无名"：缓存 miss 可恢复，真正的错误只剩"链上某步声明了 `unmodeled`"，而那是有名有姓的。

**中间产物存活**：`brepChainState.solidCache`（`brep/brep-chain.ts:76`）按 PartName 缓存句柄 ⇒ **沿链回走不重跑几何**。

### 4.6 失败语义

| 情形 | 行为 |
|---|---|
| 链上某步 `unmodeled` | 抛 `E_TOPO_OPAQUE`，带「`s7` 的 `cad.engrave` 声明 unmodeled（原因：…）」 |
| 面在途中被删除 | 抛 `E_TOPO_DELETED`（已有） |
| mesh 路径下引用拓扑 | 抛 `E_TOPO_MESH_UNSUPPORTED`（新增） |
| 几何 hint 兜底不唯一 | 抛 `E_TOPO_AMBIGUOUS`（已有一条路径，需覆盖全部） |
| 输入 Shape 查不到 PartName | 抛 `E_TOPO_UNTRACKED_INPUT`（新，N1） |
| 无当前语句锚点 / 锚点不符 | 抛 `E_TOPO_NO_ANCHOR`（新，N2） |
| 未声明类别 | **编译期 / 生成期失败**，不是运行期 |

### 4.7 约束与已知限制（如实登记，不掩盖）

| # | 条目 | 影响 | 处置 |
|---|---|---|---|
| **C1** | **不允许并发执行多个 runtime**（用户 2026-09-22 裁决） | 无（这是**约束**，不是缺陷） | 写成显式守卫：`CadRuntime` 加进程级执行锁，第二个 runtime 进入执行态时 **`throw E_RUNTIME_CONCURRENT`**。**禁止**用"加锁等待"或"排队"来容忍——那是加旁路。见下方 §4.7.1 |
| **K2** | `nameOf` 是 `WeakMap`，Shape 未注册则 miss | N1 报错 | 见 §4.3 N1 |
| **K3** | 顶点身份未纳入本计划 | `VertexTopoRef` 仍按现状 | 显式排除；若后续需要，另立计划 |

> 上一版把「并发」列为待查项 K1。**用户已裁决：不允许并发**——故它从"已知限制"升级为**显式约束 C1**，
> 并且 Phase 1 不必再考虑"显式传 anchor"这条退路：`getCurrentStmt()` 在"单 runtime 串行"这个被强制保证的前提下是可依赖的。

### 4.7.1 C1 为什么必须是「禁止」而不是「加锁兼容」

| 方案 | 判定 |
|---|---|
| 加锁 / 排队让并发"能用" | ✗ **旁路开关**。它让"本该失败的情况通过"，正是项目红线要怀疑的东西 |
| 显式传 anchor（每个 op 自带 stmtId） | ✓ 可行，但**在没有并发需求时是为不存在的问题付成本**（改所有 op 签名 + 调用点） |
| **禁止并发 + 显式抛错**（选此） | ✓ 符合「静态规则、禁运行时回退」与「能力缺口要暴露」 |

**副作用（正面）**：C1 让 `getCurrentStmt()` 成为一个**合法的**依赖——不是"全局态凑合能用"，
而是"在 C1 保证的串行前提下，全局态就是当前语句的权威读法"。这消除了 §4.3 N2 校验里
「锚点可能串到别的 runtime」这个不确定分支。

**C1 的落地位置**：`cad-runtime/runtime.ts:451` 现在只是注释里承认互踩。改为真守卫。

---

## 5. 阶段计划

原则：**先把问题变可见，再改行为**；每阶段独立可验，且都能说清"G3 又绿了几条"。

### Phase 0｜定基线（不改身份行为）

| 步骤 | 内容 | 落点 |
|---|---|---|
| 0.1 | 补齐 **7 个已存在的** `*WithHistory` 绑定：`translate` `rotate` `mirror` `scale` `shell` `offset` `thicken` | `brep/engine/primitives.ts:167-185`（`BrepEngineApi` 加声明）、`brep/engine/adapters/occt.ts:29-34`（能力槽） |
| 0.2 | 把 `capabilities.evolution` 从**引擎级布尔**改为**per-op 声明** | `brep/engine/adapters/occt.ts:34` |
| 0.3 | **删除 `identityHashEvolution`**（`face-evolution.ts:209-222`），改用 0.1 的真 `WithHistory`；若因故保留，必须补一条「OCCT 变换保持面序」的测试 | 同上 |
| 0.4 | **§7 的测定项**（7 项中第 3 项因 D10 已作废 ⇒ 实做 6 项）测出并回填（处置分支已在 §7 预置，回填只选分支、不开新问题） | 探针脚本 → **落成 `.test.ts`**（AGENTS.md 铁律） |
| 0.5 | 写 **G3 的 6 条链测试**（§3.1），**让它们现在红着** | `packages/tests/faijs/topology-naming/` |
| 0.6 | **C1 守卫落地**：`CadRuntime` 加执行态锁，第二个 runtime 在执行态时 `throw E_RUNTIME_CONCURRENT`（替换 `runtime.ts:451` 那条"承认互踩"的注释）；补一条测试（两 runtime 交错 → 第二个抛错） | `cad-runtime/runtime.ts:451` |
| 0.7 | `@deprecated` 措辞校正（S7，§2.4） | 13 处 JSDoc |
| 0.8 | 覆盖率探针：跑 N 条真实链，输出「未命名面数」基线 | 落成 `.test.ts` |

**验收**：0.1 绑定单测全绿；0.6 的并发守卫测试绿（两 runtime 交错 → 第二个抛 `E_RUNTIME_CONCURRENT`）；6 条链的**当前失败率有实测值**（这就是后续每阶段的进度尺）；**§7 的 6 项实做测定项全部回填为具体分支**——每项分支已预置，回填不产生新的待定项。

**同步 3d_editor**：无（0.6 的守卫若 3d_editor 真在并发，会在其 CI 暴露——这正是守卫的作用）。

> ⚠️ **0.6 有一条前置检查**：落地前先 grep 3d_editor 是否已在并发跑多 runtime。
> 用户已裁决**不允许并发**，故处置**已定**：若 3d_editor 在并发，就**改它为串行**（不是"推迟 C1"）。
> 这个检查只影响**执行顺序**（先改 3d_editor、再上守卫），**不是决策问题**。

---

### Phase 1｜身份与血缘

| 步骤 | 内容 | 落点 |
|---|---|---|
| 1.1 | 新建 `RoleName` + `parseRoleName`/`formatRoleName` + round-trip 测试 | `topology/naming/role-name.ts`（新） |
| 1.2 | 扩展 `FaceIdentity` / `TopoRefV2` 类型（原地，不新建目录） | `topology/naming/types.ts` |
| 1.3 | 新建登记函数 `registerStep` + 两张表（`lineage: Map<StmtId, LineageNode>`、`partToStmt: Map<PartName, StmtId>`）+ N1/N2/N3 校验 | `topology/naming/lineage.ts`（新） |
| 1.4 | **调用点 A**：`wrapBrepOne` 登记 | `define-op.ts:274-281` |
| 1.5 | **调用点 B**：`compatOp` 边界登记 | `api/internal/compat-op.ts` |
| 1.6 | `FaceNaming.origin: PartName` → `StmtId`（S1） | `topology/naming/types.ts:180` |
| 1.7 | `role: string` → `RoleName`，删 `box:`/`extrude:` 前缀 | 同上 + `roles.ts:102-105` |
| 1.8 | 删 mesh 伪拓扑：`assignPrimitiveFaceRoles` + `role:''` 两处兜底（D6/S4） | `build-naming.ts:90-106`、`:127`、`:134` |
| 1.9 | mesh 路径引用抛 `E_TOPO_MESH_UNSUPPORTED` | `api/edge-ref.ts`、`api/face-ref.ts` |
| 1.10 | `roleTable` 降级为缓存（删 `shape.ts:68` 的条件写入、`shape.ts:79` 的 `roleTable?: unknown`） | `shape.ts:68/79` |
| 1.11 | 迁移器 `migrateTopoRef` + 单测（§2.3） | `topology/naming/migrate.ts`（新） |
| 1.12 | `topology/naming/roles.ts` 的 `ROLE_ASSIGNERS` 改为**输出 `RoleName`** | `roles.ts:68` |

**验收**：G2 达成（`nameless shape` 类报错归零）；G3 的 6 条链**不回退**（不要求变绿）；1.1 的 round-trip 测试全绿；1.11 的迁移器幂等性测试全绿。

**同步 3d_editor（S1/S2/S3/S4）**：
- 改 `capture-topo-ref.test.ts:69-70`、`assemble-store.test.ts:481` 的断言；
- 接上 `migrateTopoRef`（载入场景时）；
- 加一条"mesh part 无 naming 行 → `faceTopoRefFromRow` 返回 `null`"的测试；
- 迁移器对旧 `face_N` 位置名 ref **报告而非伪造**。

---

### Phase 2｜声明强制

| 步骤 | 内容 | 落点 |
|---|---|---|
| 2.1 | `ArgSpecEntry` 增 `naming` 字段（含 `kind` + 词汇表） | `api/surface/arg-spec.ts:70` |
| 2.2 | `gen-l3-surface.ts` 遇 `kind==='brep-op' && scriptFace===true` 而缺 `naming` → **`throw`** | `packages/core/scripts/gen-l3-surface.ts` |
| 2.3 | `DualOpOptions` 增**必填** `naming` | `define-op.ts:84` |
| 2.4 | 27+1 条投影逐条回填 `naming` | `arg-spec.ts` |
| 2.5 | 6 条手写覆盖声明在 `defineOp` | `primitives.ts` / `extrude.ts` / `transform.ts` / `fillet.ts` |
| 2.6 | ~~8 条未接线改标 `skip`~~ — **不做**（D10 已决推迟，§1 D10） | — |
| 2.7 | 6 条「手写覆盖」的生成版标 `skip` + `reason: overridden by handwritten <file>` | `arg-spec.ts` |
| 2.8 | **防回归测试**：刻意漏声明 → 生成器必须抛；刻意漏 `defineOp.naming` → `tsc --noEmit` 必须失败 | `packages/core/scripts/*.test.ts` + `packages/tests/` |
| 2.9 | G5 审计测试：compat 面 vs cad 面逐 name 比对 | `packages/tests/faijs/topology-naming/` |
| 2.10 | 词汇表进生成产物（`.d.ts` + API 手册） | `core/scripts/gen-api-dts.ts`、`scripts/gen-ops-api-inventory.ts` |
| 2.11 | **第三方库同步**：`fai_cq_gears` / `fai_cq_warehouse` / `sheetmetal` 每处 `defineOp` 加 `naming`（真实类别或 `unmodeled('reason')`） | 三个库仓库 |

**验收**：G4 达成（漏声明 → 生成期/编译期失败，两条防回归测试在仓库）；G5 达成；2.11 三库测试全绿（**这是 breaking，必须同步做完**）。

**同步 3d_editor（S5）**：无需改动（纯内部声明）。

> **2.6 不做**（D10 已决推迟，见 §1 D10）。它与 Phase 2 的其余步骤**完全无交集**：
> 那 8 条 `scriptFace !== true`，不在 D11 判据内，也不在 2.4 的 27+1 条投影里
> ⇒ 本阶段验收（G4 / G5）不受影响。

---

### Phase 3｜`construct` 与 `kernel` 补齐

| 步骤 | 内容 | 落点 |
|---|---|---|
| 3.1 | `construct` 枚举器：`extrude`（`cap:bottom`/`cap:top`/`wall:<i>`/`hole:<j>/…`） | `api/extrude.ts` |
| 3.2 | 删 `registerExtrudeRoles`（被 3.1 吸收） | `api/extrude.ts:43-70` |
| 3.3 | `construct`：`revolve`（已接线的 1 条投影，见分析文档 §5.3 生效层表）。**`sweep` / `roof` 不在本阶段**——它们属 D10 的 8 条未接线，接线是实现前提（§1 D10） | `api/` |
| 3.4 | `kernel` 的 `byAdjacency`：`fillet` / `chamfer` 过渡面（现状已在用 `DerivedFaceTopoRef.between`，收拢进机制） | `api/fillet.ts`、`api/chamfer.ts` |
| 3.5 | 删 `assignGeneratedPositionalRoles`（空 hash 死代码） | `roles.ts:261-265` |
| 3.6 | 删 `void outPart` | `brep/face-evolution.ts:298` |
| 3.7 | `sketch` 的边序 = profile 边序（**新造面词汇的根**） | `api/sketch.ts:193` |
| 3.8 | `import_brep` 的 `imported:<i>` | `api/import-brep.ts` |

**验收**：G3 至少绿 **3** 条（L1 / L2 / L6）；`registerExtrudeRoles` 与 `assignGeneratedPositionalRoles` 已删除。

**同步 3d_editor（S6）**：给出「有 0 处参数形态变更」或「有 N 处，清单如下」的**明确结论**——不允许"可能"。

---

### Phase 4｜不变式

| 步骤 | 内容 | 落点 |
|---|---|---|
| 4.1 | 覆盖率审计测试：G1 的「未命名面数 = 0」 | `packages/tests/faijs/topology-naming/` |
| 4.2 | 无陈旧 hash 断言（**注意**：hash 是内存指针哈希，碰撞时只可能**漏检**不可能误报——见分析文档 §1.2） | 同上 |
| 4.3 | `unmodeled` 全部进白名单 + 每条给理由 | 同上 |
| 4.4 | 几何 hint 兜底的 `E_TOPO_AMBIGUOUS` 覆盖到全部路径（G6） | `topology/naming/resolve-face.ts` |

**验收**：G1 达成；G3 至少绿 **5** 条。

**同步 3d_editor**：无。

---

### Phase 5｜清债 + 收口

| 步骤 | 内容 | 落点 |
|---|---|---|
| 5.1 | 执行分析文档 §7.3 删除清单的剩余项 | 见该表 |
| 5.2 | 各 op 的 `roleTable as ReadonlyMap<unknown, unknown>` 断言类型化（约 9 文件） | `api/*.ts` |
| 5.3 | 收口 C1：全仓确认无"并发容忍"路径（加锁 / 排队 / 重试） | `cad-runtime/` |
| 5.4 | 文档同步：`docs/api-contract.md`（TopoRef 形态）、`docs/ops-api-inventory.md`（词汇表）、`AGENTS.md`（若涉及分层） | `docs/` |
| 5.5 | Agent Note：记录「身份 = `(StmtId, RoleName)`」这个决策及否决项 | `.agents/notes/` |

**验收**：G6 达成；G3 **全绿（6/6）**；`unmodeled` 趋零。

**同步 3d_editor**：全部 S1–S6 已关闭；3d_editor 全量测试绿。

---

## 6. 总验收

| 判据 | 阈值 |
|---|---|
| G3 抗重放链 | **6/6 绿** |
| G1 覆盖率 | 未命名面数 = **0** |
| `unmodeled` 数量 | ≤ 白名单长度，且每条有理由 |
| `no role table` 类报错 | **0** |
| 漏声明防回归测试 | **2 条全绿**（生成期 + 编译期） |
| 3d_editor 同步 | S1–S6 **全关闭**，3d_editor 测试全绿 |
| mesh 路径 | 引用拓扑 → `E_TOPO_MESH_UNSUPPORTED` |
| **C1 并发守卫** | 两 runtime 交错 → 第二个抛 `E_RUNTIME_CONCURRENT`（测试绿） |
| 生成投影命名声明覆盖 | 27+1 投影 + 6 手写覆盖 = **34 条，100% 有声明** |
| **D10**（8 条未接线 `brep-op`） | **本计划不做**（§1 D10）：`kind` 不变、不加 `naming`；`arg-spec` 的「42 条」虚报作为**显式已知状态**保留（量化：生效 34 = 42 − 8，由 Phase 2 回填自然产出） |
| **§7 测定项** | 7 项中 6 项实做（第 3 项因 D10 作废），**全部回填为具体分支**（分支已预置）⇒ 收工时**不存在任何未决项** |

---

## 7. Phase 0 测定项：**分支已预置，回填不产生待定项**

这 7 项（**第 3 项已因 D10 作废 ⇒ 实做 6 项**）**不是"未决问题"**，而是"必须实测才能填值的事实"。**每一项的处置分支已在此预置**，
Phase 0.4 的探针只负责"选分支"，**不需要任何新的裁决**。全部探针**落成 `.test.ts` 留在仓库**（AGENTS.md 铁律）。

| # | 待测事实 | 分支 A | 分支 B |
|---|---|---|---|
| 1 | `heal` / `simplify` / `autoHeal` / `fixShape` / `healSolid` 是否真有内核历史 | 测出"有" → 走 `kernel`（补 `*WithHistory` 绑定，与 0.1 同法） | 测出"无" → `unmodeled('heal 家族：无内核历史且面无稳定构造词汇')` |
| 2 | `screw` 的面结构 | 有稳定 index 词汇 → `construct` + 词表 | `unmodeled('螺旋面无稳定 index 词汇')` |
| 3 | ~~`roof` 的平面/壁面构成~~ | — | **不测**：`roof` 属 D10 的 8 条未接线（§1 D10），接线是实现前提 |
| 4 | `convexHull` 是否有稳定词汇 | `construct` + 词表 | `unmodeled('凸包面无稳定构造词汇')` |
| 5 | `engrave` 是否等价 `cut` 组合 | `kernel`（复用 `cut` 的绑定与词汇） | `unmodeled('engrave 无内核历史且不等价 cut 组合')` |
| 6 | 刚体变换是否保持面序（= `identityHashEvolution` 当年那个假设是否成立） | ✅ **实测成立**（2026-09-22，见 §7.1 回填）⇒ 结论留档；`identity` 类仍由 L3/L6 覆盖 | —（未发生） |
| 7 | `cut` 产生的孔壁应挂哪个 `origin` | 符合已定准则 → 结论留档 | 不符 → **按实现缺陷修** |

**第 7 项不是开放题**：准则已在 §4.1 / §4.4 定稿——**面由哪个 op 的几何运算首次产生，就挂哪个 op 的 `StmtId`**。
孔壁是 `cut` 的新造面 ⇒ 挂 `cut` 的 `StmtId`，`role = hole:<j>`。探针的作用是**验证实现符合准则**，不是重新决定准则。

**第 6 项与 0.3 的关系**：`translate` / `rotate` / `mirror` / `scale` **无论本项结论如何**，Phase 0.3 后都走 `kernel` 真 `WithHistory`。本项结论只决定"要不要给 `identity` 类补一条链"。

### 7.1 Phase 0 落地记录（实测回填，2026-09-22）

**第 6 项 = 成立。** `packages/core/src/brep/face-evolution.ordering.test.ts` 用「逐面中心点」判据
（不是弱判据"面数相同"）实测三条内核路径都保持面枚举序号：

| 内核路径 | 覆盖的 op | 实测 |
|---|---|---|
| `kernel.transform(3x4 矩阵)` | `rotate_euler`、`place` | ✅ 面序保持（中心点逐位对齐 + 面积逐位相等） |
| `kernel.generalTransform` | `scale3d`（非等比） | ✅ 面序保持（中心点逐位对齐） |
| `kernel.copy` | `copy` | ✅ 面序保持（中心点 + 面积逐位相等） |

⇒ `identityHashEvolution` 的假设**不再是假设**，且分支 A 命中，**不需要**补 `box → place → box:top` 链。

**0.2 的落地结果（族级布尔 → 逐核函数名单）**：`BrepCapabilities.evolution` 由 `boolean`
改为 `readonly BrepEvolutionKind[]`（12 个 `*WithHistory` 核函数名），`BrepCapabilityName`
里的族级 `'evolution'` 已**移除**；引擎声明"提供哪几个"、op 声明"要哪一个"，两侧按名字求交
（`backend-dispatch.engineCapabilitySet` / `firstMissingCapability`）。实测发现的**真实缺陷**：

| 引擎 | 旧声明 | 后果 | 新声明 |
|---|---|---|---|
| `occt` | `evolution: true` | 恰好成立（12 个全有），但无法表达"少了哪个" | 12 项显式名单 |
| `brepkit` | `evolution: true` | **静态放行、运行时炸**：`cad.intersect` 撞 `unsupported('intersectWithHistory')`（粗布尔虚报） | `['fuse','cut','fillet']`（= 它真实现的三个） |
| `brep-mock` | 无 | 无变化 | 无（`[]`） |

op 侧同时改为逐核函数：`union → ['fuse']`、`subtract → ['cut']`、`intersect → ['intersect']`。
另修掉一处「同一事实两个家」：`cq-compat/src/gear-test-harness.ts` 原先手抄一份能力声明
（`evolution: true` 等），现改为从注册表取回适配器自己声明的那一份。

**⚠️ 本条暴露的一个不可探测性**（已写进 `evolution-declaration.test.ts` 头注）：所有适配器的
`*WithHistory` 桩都用 `unsupported(...)` 实现，`typeof api.xWithHistory === 'function'` **恒为真**
⇒ 无法靠探测区分「真有 vs 桩」。**声明是唯一真相来源**，只能靠期望值钉住（该测试文件即此钉；
occt 的 12 项判定为「真」则由 `evolution-bindings.test.ts` 的**真调用**背书）。

**0.5 的落地结果（G3 进度尺已建立）**：载体 = `packages/tests/faijs/topology-naming/g3-replay-chains.test.ts`
（含三层判据 T1 角色词汇集跨重放不变 / T2 捕获的 ref 重放后落到同名面 / T3 面类型一致；
前置 T0 = 两次执行本身必须成功，T0 红则说明红的不是命名机制、必须先修链路）。
**实测基线：6/6 红，且全部红在 T0.5（目标词汇未落地），T0 链路 6/6 通。**

| 链 | 首次执行实测 role 集合 | 红的性质 |
|---|---|---|
| L1 | `extrude:face_0…5` + `''` | 只有**位置兜底名**（`opType:face_N`），fillet 过渡面 role 为空 |
| L2 | `['']` | 产物**完全无名** |
| L3 | `['']` | 产物**完全无名** |
| L4 | `['']` | 产物**完全无名** |
| L5 | `['']` | 产物**完全无名**（连 box 的 6 个语义 role 都丢了） |
| L6 | `box:left/front/back/right/top/bottom` + `''` | 继承面有名字，**唯一缺的**是新造面（倒角过渡面 role=`''`） |

读数：**4/6 条链今天产出的是完全无名（或仅位置名）的形状**；L6 只差"新造面词汇"一步。
⇒ 后续每阶段的进度尺 = 这张表里"完全无名"从 4 减到 0，且 L6 那一个 `''` 消失。

**0.5 顺带修正了计划原文的一处不准确**：§3.1 的 L1 原写 `box → extrude → fillet`，但
`cad.extrude` 是 brepjs 投影（`arg-spec.ts:1533`，入参 face/wire），传 solid 报 `EXTRUDE_FAILED`；
已改写为 `sketch → extrude → fillet`（与 `edge-ref/edge-ref.test.ts` 的 FCStd `Pad→Fillet` 同形），覆盖面不变。

**0.6 的落地结果（C1 守卫已落地 + 前置检查已做）**：

- 守卫：`cad-runtime/runtime-concurrent-error.ts`（`E_RUNTIME_CONCURRENT`）+ `CadRuntime.withExecutionLock`
  套在三个执行入口（`execute` / `append` / `update`）。**同步取锁**（取锁前不 await）⇒
  `rtA.execute(...)` 后紧接着 `rtB.execute(...)` 必然被拒，行为可确定。同实例重入放行
  （`update` 内部落到 `executeDirectText`，同调用栈、非并发）。`claimBackends` 里那条
  "并发交错仍会互踩"的注释改为指向守卫。
- 测试：`cad-runtime/multi-runtime.test.ts` 新增 3 条（跨实例拒绝 / 入口名与 `entry` 字段 /
  失败也释放锁）——**6/6 绿**。测试里三个 `rt2.*` 调用必须**同步**发起，
  否则第一次 `await` 会让 rt1 跑完释放锁、第二次调用合法成功（写成顺序 await 会变成时序依赖测试）。
- **前置检查（计划 §0.6 的 ⚠️）已做，结论：3d_editor 不在并发跑多 runtime，无需改动**。
  证据：`ScriptEngine.ts:74-103` —— 执行真源在 **worker**（"主线程不持有 CadRuntime"），
  且 `_executionClient` 是**每 realm 单例**（`if (!_executionClient)`），全仓 `createRuntime`
  只出现在**测试**（`faijs-test-harness.ts` / `c4-brepjs-gear.test.ts`），生产路径不调用。
  ⇒ 无并发、无需"改 3d_editor 为串行"这一步。
- 回归面：`packages/core/src/cad-runtime` 全目录绿；`packages/tests` 的 multi-mesh / mixed /
  refactor-acceptance / compat-op / p7-dual-chain / edge-ref 52 项全绿。

**0.3 的实际取舍（比计划原文更细，因为实测发现"能替换的面"比预期小）**：

| 类别 | op | 处置 | 原因 |
|---|---|---|---|
| 换权威映射 | `translate`、`scale`（均匀） | ✅ 改用 `translateWithHashEvolution` / `scaleWithHashEvolution`（新增于 `face-evolution.ts`） | 内核有 1:1 全覆盖的权威映射（`evolution-bindings.test.ts` 实测） |
| 保留 + 测试钉住 | `rotate_euler`、`scale3d`、`copy`、`place` | ✅ 仍走 `identityHashEvolution`，假设由 `face-evolution.ordering.test.ts` 钉住 | 内核**无单次调用**可表达：欧拉角+pivot 超出单轴 `rotateWithHistory`；非等比超均匀 `scaleWithHistory`；`copy`/`located` 无历史 API |

> **顺带发现的候选优化（Phase 0 刻意不做）**：`rotate_euler` 与 `place` 的旋转都是**任意旋转**，
> 而欧拉定理保证任意旋转 = 绕单轴转一个角 ⇒ 理论上可用 `rotateWithHistory` + 轴角分解替换。
> 不做的理由：轴角分解有数值边界（`angle≈0` 时轴未定义、`angle≈π` 时轴符号不定），
> 需要单独设计与测试；且 Phase 1 会把 role 传播改走 `(StmtId, role)` 因果坐标，
> 届时这两个 op 不再依赖 hash 对齐。**属独立工作项，不在 Phase 0**。

---

## 8. 本计划否决的分析文档条目

| 分析文档 | 本条 | 否决理由 |
|---|---|---|
| 分析文档 §4 G3 | 「不得使用任何 `@deprecated` op」 | 按 H2，它们是真实负载；排除它们 = 在没人用的子集上证明机制（D9） |
| 分析文档 §5.2 | 「在 `defineOp` 的包装器里登记」 | 42 条投影走 `compatOp`，不经过 `wrapBrepOne`。必须两个调用点（D3/§4.3） |
| 分析文档 §6 Phase 0 | 未含 3d_editor 兼容面 | 按 H3 补 §2.2 同步清单 + C1 并发约束项 |
| 分析文档 §6 全程 | 未含 `@deprecated` 措辞校正 | 按 H2 补 Phase 0.7（D8） |
| 分析文档 §7.1 | 「9 处有身份里 3 个是 `@deprecated`，所以平台面更少」 | 这句暗示 deprecated op 价值低。按 H2 反过来：它们是**真实负载**，是验证的重点而非可忽略项 |
