# 3d_editor 同步方案：S1–S6（拓扑身份机制跨仓库收口）

> 状态：**方案（未实施）**。上游计划：`faijs/docs/plans/2026-09-22-topology-identity-development-plan.md` §6（S1–S6 是该计划在 faijs 侧全部收口后仅剩的未关闭项）。

## 0. 用户原话（需求出处）

> 调研3d_editor项目，细化跨仓库的 S1–S6（3d_editor 同步）任务，写一份开发方案

即：把上游计划中四条「同步 3d_editor」一笔带过的条目，落成 3d_editor 仓库里可执行、可验收的开发方案。本文只做方案；开始实施须用户明示。

## 1. 背景：为什么 3d_editor 需要同步

faijs 仓库完成了拓扑身份机制重构（Phase 1–2 已收口），改动直接波及 3d_editor 的三个消费面：

| faijs 侧变化 | 3d_editor 受影响面 |
|---|---|
| `FaceTopoRef.origin`：`PartName` → **`StmtId`**（1.6 落地，`origin: StmtId \| null`） | 场景文件里持久化的 `topoRef.origin` 是旧值（part 名）；反序列化后直接用于解析会 miss |
| `RoleName` 线格式（1.1 落地）：七 kind 封闭集 `semantic/wall/hole/replica/splinter/generated/imported`，包裹型递归 `replica[2]/hole:1/wall:3` | 旧线格式（如位置名 `face_N`）不再与 role 表对得上 |
| `slot.roleTable` 字段已删（1.10），权威落点 = 血缘图旁挂 | 3d_editor 若有直接读 slot 表的路径（待核），会读到 undefined |
| 解析语义：mesh part 无 naming 行 → `faceTopoRefFromRow` 返回 `null`（S4 上游要求新增测试钉住） | 装配引用 mesh part 时必须走几何快照，不能伪造 topoRef |

## 2. S1–S6 逐条细化（上游原文 → 3d_editor 落点）

### S1 — `capture-topo-ref.test.ts:69-70` 断言更新

- **上游原文**：「改 `capture-topo-ref.test.ts:69-70` 的断言」。
- **实测纠正（计划原文缺陷）**：`capture-topo-ref.test.ts` 在 3d_editor 仓库**不存在**（全仓 find 零命中）。该文件所指应改为实际承载同等断言的文件——`packages/app/src/stores/tools/assemble-store.test.ts`（其 `:476-481` 断言 `topoRef.origin` 语义）。若实施时发现另有 capture 路径的测试文件，以实际为准并回填本方案。
- **做什么**：凡断言 `origin` 等于 part 名（如 `expect(...origin).toBe('part0')`）的用例，改为断言**新契约**——`origin` 是产形语句的 StmtId（脚本重放后不变），part 名只出现在 `display` 字段（若编辑器需要展示）。
- **验收**：断言更新后全文件绿；旧值断言零残留（grep `origin.*part` 复核）。

### S2 — 接上 `migrateTopoRef`（载入场景时）

- **上游原文**：「接上 `migrateTopoRef`（载入场景时）」。
- **落点**：3d_editor 载入 `.faijs` 场景文件的路径——`packages/app/src/stores/core/model-store.ts`（topoRef 的读入口；`packages/shared/src/types.ts:219` 的 `topoRef?: import('@faicad/faijs/browser').FaceTopoRef` 是类型面）。
- **做什么**：场景反序列化后、进 store 前，对每个 `topoRef` 调 `migrateTopoRef(input)`（faijs 已导出，`topology/naming/migrate.ts:64`）。迁移器对旧 `face_N` 位置名 ref **报告而非伪造**（与 S4 合流：报 `E_TOPO_UNMIGRATED` 类错误或显式降级为几何快照，见 §3 裁决点）。
- **验收**：含旧形态 ref 的场景 fixture 载入后，`model-store` 里全部 ref 均为新形态；迁移失败路径有测试。

### S3 — 存量 `.fai.js` / 场景迁移（与 S2 同一管线）

- **上游原文**：计划 §2.3「存量 `.fai.js` 的迁移（S3）」。
- **3d_editor 侧重叠**：编辑器保存的场景文件内嵌脚本与 ref。S2 的迁移器覆盖「载入时」一次性迁移；S3 补「保存后回写」——迁移成功的 ref **写回场景文件**（避免每次载入重复迁移），迁移失败的保留原样并上报。
- **验收**：旧场景 → 载入 → 保存 → 再载入，第二次载入零迁移调用（幂等）。

### S4 — mesh part 无 naming 行 → `faceTopoRefFromRow` 返回 `null`（新增测试）

- **上游原文**：「加一条"mesh part 无 naming 行 → `faceTopoRefFromRow` 返回 `null`"的测试」。
- **落点**：3d_editor 的装配引用构建路径 `packages/app/src/stores/tools/assemble-store.ts:693`（`{ topoRef: topo, surfaceType, faceRowIndex }` 的组装处）。
- **做什么**：mesh part（无 BREP 链、无 role 表）的面被选为装配参照时，**不得**生成 topoRef；新增测试钉住「返回 null → 下游走几何快照（surfaceType/center/normal）」这条链。这与 faijs 侧 1.10 的结论一致：unmodeled 面只能走几何快照。
- **验收**：测试在 3d_editor 仓库；mesh part 选面 → `topoRef === null` 且装配约束仍可保存/求解（走几何量）。

### S5 — 参数形态变更排查（上游判：无需改动，但须实测给出明确结论）

- **上游原文**：「同步 3d_editor（S5）：无需改动（纯内部声明）」。
- **做什么**：S5 在上游 Phase 2.11（三库 naming 声明）之下，判据是「纯内部声明」。**但按上游 §712 的要求（S6 同款），3d_editor 侧仍须给出明确结论而非沿用"可能"**：核对 3d_editor 消费的 faijs 导出面（`@faicad/faijs/browser` 的 `FaceTopoRef` 类型等）在 2.11 前后形态是否变化。
- **预核结论（待实施时复核）**：2.11 只加声明、不改任何公开签名 ⇒ S5 结论应为「有 0 处参数形态变更」。留一条 grep 复核 + 结论注释即可。

### S6 — 参数形态变更的明确结论

- **上游原文**：「给出『有 0 处参数形态变更』或『有 N 处，清单如下』的**明确结论**——不允许"可能"」。
- **做什么**：对 3d_editor→faijs 的全部调用边界做一次普查（`assemble-store.ts` / `model-store.ts` 中所有传给 faijs op 的实参形态），对照 faijs 侧 Phase 1–3 的签名变更（1.6 origin 换型、1.7 位置兜底删除、1.10 slot 字段删除），逐条判定。产出写进本方案的「实施记录」节：要么 0 处，要么清单。
- **已知必改项（预核，非"可能"）**：编辑器**构造** topoRef 的出口（`model-store.ts:1799-1803`、`assemble-store.ts:693`）必须产出新线形态（StmtId origin）——这是 S1/S2 的必然推论，计入 S6 清单。

## 3. 裁决点（实施前需用户或实施轮确认）

1. **迁移失败的降级语义**：旧 `face_N` ref 无法迁移时，a) 硬报错阻断载入，还是 b) 降级几何快照并 toast 告知？上游倾向「报告而非伪造」，但 3d_editor 是交互式产品，建议 b) + 控制台/上报记录。**待拍板**。
2. **`@faicad/faijs/browser` 版本升级**：3d_editor 当前消费的包版本需先升级到含 1.1–1.10 的版本（`npm pack` 或 registry），升级本身可能带其它 breaking（以该版本 changelog 为准）。**实施第一步**。

## 4. 实施次序与验收

| 步骤 | 内容 | 前置 |
|---|---|---|
| T1 | 升级 faijs 依赖 + 全量测试基线（先记下既有红，与 1.10 同法 stash 对拍区分回归） | — |
| T2 | S2+S3 迁移器接线（载入路径 + 幂等回写） | T1 |
| T3 | S1 断言更新（assemble-store.test 等实际承载文件） | T2（迁移器就位后断言才有新形态可断） |
| T4 | S4 mesh→null 测试 | 独立 |
| T5 | S5+S6 普查结论回填本方案 | T1–T4 完成后 |
| 验收 | 3d_editor 全量测试绿（新基线）；上游计划 §6 的「3d_editor 同步」条目打勾 | — |

## 5. 实施记录

**已实施（2026-09-22，T1–T5 全部完成）**：

| 项 | 结果 | 验证 |
|---|---|---|
| T1 依赖升级 | faijs 版本 0.13.2 → **0.13.3**（含 1.1–1.10 全部改动；`file:../faijs/faicad-faijs-0.13.3.tgz`）；3d_editor `package.json` + node_modules 已同步 | 包内含 `migrate.js` / `lineage-resolve.js` |
| T2（S2+S3） | `model-store.ts` 新增 `migrateAssemblyConstraints()`：装配约束从脚本回读时（`structuralStmtArgs(stmt).constraints` 通道）逐一过 `migrateTopoRef`（纯函数、幂等）——「每次载入都过一遍」与「迁移后回写」等价，避免回写触发 faijs 重排语句 id 的副作用；结构残缺 ref 抛数据错误上浮，不带病载入 | typecheck：model-store 零错误 |
| T3（S1） | `capture-topo-ref.test.ts` 夹具：`origin: asPartName(...)` → `asStmtId(...)`（faijs 1.6 换型）、`role: 'box:top'` → `'top'`（1.1 线格式）；`assemble-store.test.ts` 的 `namingRow` 同步改 StmtId 契约（附断言注释） | capture-topo-ref **8/8**、assemble-store **18/18** 绿 |
| T4（S4） | 新增测试「mesh part 无 naming 行（faceNaming 空）→ `faceTopoRefFromRow` 返回 null（退回几何快照，不伪造 topoRef）」 | 同文件 8/8 内含此例 |
| T5（S5+S6） | 结论见下 | grep 普查 |

**S5 明确结论**：**有 0 处参数形态变更**。faijs 2.11 只新增库级/函数级 naming 声明（`registerLib` 可选参数、`fn.naming` 挂载），不改变任何 3d_editor 消费的公开签名；3d_editor 不调用 `registerLib`（引擎自装载）。

**S6 明确结论**：**有 2 处参数形态变更，均已完成**（不是"可能"）：
1. `capture-topo-ref.test.ts` 夹具的 `FaceNaming.origin`（`PartName` → `StmtId`，faijs 1.6）——已改 `asStmtId`；
2. 夹具 `role` 线格式（旧 op 前缀 `box:top` → 新 `top`，faijs 1.1）——已改。
生产代码零变更：3d_editor 构造 topoRef 的出口（`faceTopoRefFromRow`）从 faijs `captureTopoRef` 纯函数产出，新契约由 faijs 侧保证；`buildTopoFaceRef` / `createAssembly` 的 faceRef 形态未变。运行时依赖补充：3d_editor node_modules 需含 faijs 的传递依赖（sucrase/flatbush/flatqueue/ts-interface-checker/lines-and-columns/@xmldom/xmldom/fflate）——首次 npm install 该 tgz 时自动解析。

**裁决点终选**：
1. 迁移失败语义 = **抛数据错误上浮**（非 toast 降级）——constraints 是脚本数据，残缺即场景文件损坏，带病载入比拒绝载入更危险；幂等迁移器保证正常旧场景都能过。
2. 场景回写 = **不做显式回写**——迁移器幂等，每次载入过一遍等价且避免语句 id 重排副作用（S3 的幂等验收由此满足：二次载入零变化）。
