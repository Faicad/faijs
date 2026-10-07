# 方案：G3 拓扑身份族（edgeRef 105+3）——分析与开发计划

- 日期：2026-10-06
- 归属：`packages/core`（`api/edge-ref.ts` / `api/topo-resolve.ts` / `topology/naming`）+ fcstd-port（语料侧验证）
- 触发：faijs-freecad 独立仓计划 §3.2（G3 拓扑身份 105）+ 本日残余移交（edgeRef 3 条）
- 状态：**立项（未实施）**
- 铁律：每条 edgeRef 必须能在**转换期**判定「这条一定能解析」；判不了 ⇒ honest bake（冻结几何），**不发射、不运行期重试、不带伤继续**。

---

## 1. 问题一句话

`cad.fillet` / `cad.chamfer` 的选边参数 `EdgeTopoRef` 需要「边序号 → 相邻两面 role 对」的解析；语料里 101+ 个产品的解析在运行期失败（三处 `TopoRefError` 抛点），因为**FCStd 端的边序号/role 血统在 faijs 重建后的形状上对不上**。

## 2. 实测现场（2026-10-06，fcstd-port `out/g3-family-list.json` / `g3-family-buckets.json`）

G3 族 run-fail **101**（计划旧记 105 是 10-04 全量口径；本日残余 +3 为同类）：

| 桶 | 数量 | 错误签名 | 抛点 |
|---|---|---|---|
| **edge-ordinal-out-of-range** | 46 | `edge ordinal N out of range [1, M]` | `edge-ref.ts:68` |
| **no-role-lineage** | 36 | `adjacent face ordinal N has no role lineage` | `edge-ref.ts:108` |
| **edge-needs-two-face-pair** | 18 | `edge N has 1 adjacent face(s); an EdgeTopoRef needs a two-face pair` | `edge-ref.ts:86` |
| face-role-variant | 1 | `adjacent face ordinal 3 has no role lineage`（chamfer 面） | `edge-ref.ts:108` |

典型样本：Yellow_gearmotor 族（`edge ordinal 16 out of range [1, 6]`——FCStd 记 16 条边，faijs 重建后同一 solid 只剩 6 条）、LinearSlide-MGN12 族（chamfer 37/49 越界）、ISO4762 螺钉族（`two-face pair`）。

## 3. 根因分析（按抛点归因）

### 3.1 ordinal-out-of-range（46 条）——**序号域失配**

FCStd 的 `EdgeN` 序号锚定在 **FreeCAD 端特征链终态**的形状上；faijs 重放特征链时，上游 op（尤其布尔/倒角）产生的中间形状边数与 FreeCAD 不同（例：faijs 的 `union` 把共面合并、或 fuse 的 keepHidden 语义把源保留为隐藏终端——两者枚举出的边集合不同）⇒ `EdgeN=16` 在只有 6 条边的重建 solid 上直接越界。

**关键事实**：本仓 `edge-ref.ts:10-14` 已记档「faijs 第 N 条边 == FreeCAD EdgeN」——该对齐只在**同一形状**上成立；跨特征链（引用上游特征的边）不成立。46 条全是**跨特征引用**（`cad.fillet(上游变量, { edges: [cad.edgeRef(上游变量, N)] })`，N 是 FCStd 端该上游特征终态的序号，而 faijs 的上游变量是链中间态）。

### 3.2 no-role-lineage（36 条）——**role 表断链**

`edgeRef` 由相邻两面反查 `{origin, role}`；当邻面来自**冻结资产**（`cad.import_brep`，天然无 role 表）或 **keepHidden 隐藏终端**（role 表缓存残缺）时血统断链。`topo-resolve.ts` 的 `recoverEdgeFaceRole`（沿血缘重算 hash 集）只救回一部分。

### 3.3 needs-two-face-pair（18 条）——**退化边**

边只有 1 个邻面（开壳边/接缝边）。ISO4762 螺钉族：FreeCAD 端该边在完整壳上有两面，faijs 重建的中间态是开壳。**这类多数不该修**——接缝边倒角在语义上就存疑，转换期判 gap 或换相邻实体边更诚实。

## 4. 5.6 内核能力盘点（实测 `node_modules/occt-wasm/dist/{index,types}.d.ts`）

| API | 签名 | 对 G3 的意义 |
|---|---|---|
| `*WithHistory` 全族 | `(…, inputFaceHashes, hashUpperBound) → EvolutionData` | **官方演化三元组**：`modified/generated/deleted`（面 hash 域）——core 的 boolean.ts/fillet.ts **已在用**（`BrepEvolutionData`，`engine/types.ts:137`） |
| `subShapeHashes` | `(shape, type, bound) → number[]` | face/edge 级指纹（core 已用于 roleTable，`topo-resolve.ts`） |
| `filletWithHistory` | `(solid, edges, radius, hashes, bound)` | fillet 链的演化已可拿（core `fillet.ts` 在用） |
| `sweepAdvanced` | `:219`（H 组用） | 与 G3 无关 |

**结论**：面级演化数据**已经可用且 core 已在消费**——G3 的缺口不是「内核没有 API」，而是 **(a) 边级序号重映射没人做**（EvolutionData 只有面 hash；边要经由「邻面对」间接追踪），**(b) 演化数据没有暴露给本仓**（core 内部消费后丢弃，fcstd 转换期拿不到），**(c) 断链 role 表的恢复覆盖不足**。

## 5. 修复路线（按铁律排序）

### 路线 A（主）：转换期演化链预演算 + 边序号重映射

本仓在**转换期**用 kernel 直连（先例：`external-geo.ts:265`、`draft-draw.ts:195`）重放特征链的每个拓扑变更 op，逐步维护「FCStd 端序号 → faijs 当前形状边 handle」映射：

1. 链上每个 op 发生前，对**输入形状**调 `subShapeHashes(solid,'edge')` 建边指纹表；
2. op 发生（`fuse/cut/fillet…` 用 `*WithHistory`）后，用输出形状的边指纹 × 邻面对 hash 匹配，把旧边映射到新边（`EvolutionData.modified/generated` 给面级，边经由「其两面都映射到了哪里」传导；面 1→2 分裂时边随其所属面走）；
3. 发射 `edgeRef` 时把 FCStd 的 `EdgeN` 翻译成**当前形状**的序号；
4. **静态判据**：映射链每一步都能唯一对应 ⇒ 发射重映射后的序号；任何一步一对多/丢失 ⇒ 显式 gap（`edgeref-lineage-unresolvable`），该 fillet/chamfer 走 honest bake。

**前提（core 依赖 X-4）**：本仓转换期需要 kernel 直连 `*WithHistory` + `subShapeHashes`——L1 契约已有（`engine/types.ts`），本仓 S-2 先例已直连 `getKernel()`，**预计无需 core 新开通道**，需实施时核实 L1 面覆盖。

### 路线 B（辅，断链子类）：role 表恢复增强

`recoverEdgeFaceRole` 的血缘回走扩展到 keepHidden 隐藏终端与 import_brep 资产面：资产面无 role 表是**语义必然**（冻结几何没有历史）——这条不修，改为**转换期识别**「edgeRef 的 of 形状是 import_brep 产物」⇒ 直接 honest bake（资产的几何已在 FCStd 冻结，bake 无损）。

### 路线 C（退化边）：显式 gap

`two-face-pair` 18 条：转换期检测到目标边在重建形状上不足两面 ⇒ 显式 gap（`edgeref-degenerate-edge`），不运行期抛错。个别样本（ISO4762）可能通过「引用终态而非中间态」在路线 A 中自然解决——先 A 后 C，C 收 A 的残量。

## 6. 开发批次

| 批 | 内容 | 验收判据 |
|---|---|---|
| **G3-0** | 侦察：对本仓 46+36+18 条按「of 形状是否链中间态 / 是否 import_brep 产物 / 目标边邻面数」做静态画像，确定各路线的实际覆盖数 | ✅ **已完成（2026-10-06，fcstd-port `tools/_g3-profile.mjs` → `out/g3-0-profile.json`）**：101 产品全量画像（每个 edgeRef 调用的 of 变量声明 op 分类）。**关键数字**：`chain-intermediate`（路线 A 域，链中间态形状上的引用）**101 产品全命中**（sig×kind：ordinal 46 / no-role-lineage 36 / two-face-pair 18 / other 1）；`asset`（路线 B 域，import_brep 产物上的引用）**6 产品**（ordinal 3 + no-role-lineage 2 + two-face-pair 1）；primitive 直接声明（box/cylinder 上的引用）**3 产品**（局部序号失配，路线 A 单步变体）。**路线覆盖修正**：A 是绝对主力（~95%），B 收 6 条，C 的 two-face-pair 18 条也全落在 A 域（重映射后邻面数可能恢复，重映射不可解才落 C） |
| **G3-1** | 路线 A 骨架：本仓转换期演化链预演算器（拓扑变更 op 的边指纹映射），取点 Yellow_gearmotor_L（ordinal 16→? 重映射） | 取点 1 条转 RUN-OK；映射不可判处显式 gap |
| **G3-2** | 路线 A 全量：46 条 ordinal 桶批量重映射 | 46 条分布 = RUN-OK ∪ 显式 gap，**零运行期 edgeRef 抛错**；留档测试 + 变异（把映射表改坏 ⇒ 红） |
| **G3-3** | 路线 B：import_brep 产物上的 edgeRef ⇒ 转换期识别 + honest bake（36 条 no-role-lineage 中资产面部分） | 对应样本从 run-fail 转 gap（显式、有 reason） |
| **G3-4** | 路线 C：退化边显式 gap（18 条 two-face-pair） | 同上 |
| **G3-5** | 全量复测：101+3 条的桶变化 + 既有 pass 零回归 | 桶分布落盘；**零回归**（PASS 集合只增不减，以当时可用基线为准——E-5 全量 parity 批准后补终判） |

循环纪律：取点 → 复现 → 定位 → 改 + 测 → 同文件复跑 → rebuild + 提交 → 下一个；一类一修；长任务串行且**批量 sweep 须用户批准**。

## 7. 风险与守卫

| ID | 风险 | 守卫 |
|---|---|---|
| R-A | 边指纹在 op 后不唯一（对称几何同 hash）| 映射链要求**唯一对应**；一对多 ⇒ 显式 gap，不猜 |
| R-B | 转换期预演算与运行期执行的结果形状不一致（同代码同输入应一致；但 keepHidden 等运行时状态可能影响） | G3-1 取点阶段对拍「预演算终态 vs 运行期终态」的边数/hash；不一致 ⇒ 该链路判 gap |
| R-C | 误把可解析的判成 gap（过度保守） | G3-0 画像给出理论上限；每批验收报「转 OK / 转 gap / 残留」三数字，残留显著高于画像时停下分析，不硬推 |
| R-D | core L1 面不含所需 kernel 方法 | G3-0 同步核实；缺 ⇒ 走 core 授权开通道（X-4 追加），期间该子类维持 run-fail 现状 |
| R-E | 与 E-5 全量 parity 的基线耦合 | G3 各批验收用**定向复测**（rebased-sweep 单桶），全量终判统一归 E-5 |

## 8. 验收判据（汇总）

1. 101+3 条的运行期 `TopoRefError` **清零**（每条转为 RUN-OK 或显式 gap，reason 可归因）；
2. 留档测试 + 变异承重（映射器、检测器各至少一份 `.test.ts`）；
3. 零回归：定向复测的既有 RUN-OK 样本不翻红；
4. 静态判据先行：任何发射的重映射序号，转换期已判定可解析；判定不了 ⇒ gap。

留存物：本方案 + `fcstd-port/out/g3-family-{list,buckets}.json`（101 条现场与分桶）。
