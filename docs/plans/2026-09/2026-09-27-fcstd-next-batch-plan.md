# FCStd 全量转换 · 下一批开发计划（2026-09-27）

> 状态：**方案（未实施）**——等实施指令。前置：131 个 `exit 3221225794` 已于 2026-09-27 重跑消解（纯环境性瞬断，零代码改动），本计划接续 `2026-09-25-fcstd-full-conversion-plan.md` 的非草图工作项。
> 草图相关缺口（B2′ 草图求解、B3 外部几何、C0 开放轮廓，约 659 个 translation-gaps）**继续挂起**，等草图库改版落地，不在本计划范围。

---

## 0. 用户要求（原话）

> 请先写一份新的文档，规划下一步的开发计划。并明确发现一个解决一个的纪律。

### 0.1 过程中的流程裁定（2026-09-27，重跑 131 个期间）

> 注意，一次只能跑一个任务。而且为什么做不到每修复一个fcstd文件，就更新进度？总是要批量跑所有fsctd文件后，才更新进度？

**由此确立两条纪律**（并入 §2 开发纪律，长期有效）：

1. **一次只能跑一个任务**：同一时间只允许一个工作项/一个文件的流水线在跑，不开并行。
2. **逐文件汇报**：每跑完/修完一个 `.FCStd`，**立即汇报该文件结果**，绝不攒批。旧计划「每完成一项即提交」只约束了提交粒度，漏了汇报粒度——本计划补上：**汇报粒度 = 文件粒度**。

---

## 1. 现状基线（2026-09-27，131 个重跑完成后实测）

| stage1 | 数量 | 说明 |
|---|---|---|
| ok | **2,391** | convert 通过（含本轮 +131） |
| gap | 800 | 659 个草图族（挂起）+ 141 个其它 |
| failed | 11 | exit 1 |

重跑 131 个的去向（逐行对账）：

| 去向 | 数量 | 构成 |
|---|---|---|
| **parity=pass**（晋升入库） | 1 | `Windows/Casement/Simple 2-panes window` |
| **parity=fail**（convert ok + run ok + STEP + inv，数值差异） | 85 | volume/area/bbox/com/solids 全谱系；**solids 数量不一致是普遍特征**（1vs2 … 10vs172） |
| **run-fail**（convert ok，run 期报错） | 45 | 两大族：①`fillet/chamfer edgeRef 血统`（门窗/开关/伺服类，约 37）；②`revolve: REVOLVE_FAILED`（Mannequin_mp 系列 8 个） |

> 注：manifest 旧行里残留的 `convertError: exit 3221225794` 字段未随重跑清除（process-one 只覆盖部分字段），对账以逐行 `stage1` 为准，勿以旧字段判断。

---

## 2. 开发纪律（继承 2026-09-25 计划 §1/§5，新增三条）

1. **发现一个解决一个**（用户 2026-09-25 原话纪律，重申）：不等基线、不攒清单。撞上一个失败签名 → 定位根因 → 改代码 → 同文件验证 → 立即提交 → 顺手取下一个。**不把问题列全再动手，不做"前置调研阶段"。**
2. **单文件闭环**：一个文件的 convert→run→truth→inv→parity 在 `process-one <rel> --reconvert` 走通即闭环，不依赖全量跑。
3. **一次只能跑一个任务**（2026-09-27 新增）：流水线串行，无并行批次。
4. **逐文件汇报**（2026-09-27 新增）：每文件完成立即汇报结果；批量只能出现在"同签名相邻文件确认不回归"（2–3 个），且同样逐个汇报。
5. **测试留档**：每项实现伴随 faijs 内合成 fixture 单测，GOTCHA 注释踩坑；探针脚本保留在 `scripts/`。
6. **真差异显式留 reason**：不允许靠放宽阈值变绿。
7. **每项独立提交**：conventional commits，写明消掉的签名。

---

## 3. 工作项（按取点明确度排序，逐个击破）

### W1 · `revolve: REVOLVE_FAILED`（8 个，签名最集中，先攻）

- **取点文件**：`DummiesAndSculptures/Mannequin_mp/Mannequin_mp-dummy-1850mm-sitting-000.FCStd`
- **签名**：`Execution failed at statement -1 (callee: revolve): [faijs/brepjs-compat] revolve: REVOLVE_FAILED: Revolution operation failed`
- **与 A3 的区别**：A3（已修）是弧 ccw 误判导致轮廓跨转轴退化挂死；本族是**回转操作本身失败返回**（不挂死、秒级失败），是 A3 修复未覆盖的另一根因。
- **根因方向**：`Part::Revolution` / `PartDesign::Revolution` 翻译出的轴/角度/轮廓环是否合法（如 360° 多实体、轮廓自交、轴在轮廓上）；`api/revolve` 与 compat 层的失败分支缺诊断——先让错误带出"哪条轮廓/哪个参数"。
- **改动位置**：`packages/fcstd/src/feature-translate.ts` Revolution 分支 + `packages/core/src/api/revolve`（或其 compat 投影）错误信息；必要时 `external-geo.ts`。
- **单测**：合成 fixture 复现 REVOLVE_FAILED 的最小输入；修复后断言通过 + 错误信息可读性。

### W2 · `fillet/chamfer edgeRef 血统`（约 37 个，量最大但族内分散）

- **取点文件**：`Architectural Parts/Doors/Shutter/Double doors with shutters and trim.FCStd`（`fillet: adjacent face ordinal 7 has no role lineage`）、`Architectural Parts/Hydro equipment/Wall-Hung-Toilets.FCStd`（`edge ordinal 32 out of range [1, 16]`）
- **签名**：两类——①`adjacent face ordinal N has no role lineage`；②`edge ordinal N out of range`
- **根因方向**：A2 修复（extrude 侧面 role 覆盖 10/10）只解决了"拉伸侧壁无 role"一族；本族疑似**圆角/倒角之后再圆角**的链中段（Chained fillet → fillet），roleTable 在第二级 fillet 后丢失 lineage。ordinal 越界则指向翻译出的边索引与实际边数脱节（上游布尔/阵列后边数变了）。
- **改动位置**：`packages/core/src/brep/` role lineage 登记 + `packages/core/src/api/fillet.ts`/`chamfer.ts` 的 edgeRef 解析。
- **验证**：Shutter 门族逐文件跑，逐文件汇报。

### W3 · parity=fail 数值族（85 个，排在 run-fail 清零后）

- **取点文件**：`Electrical Parts/Servos/Futaba3003/Futaba3003-6-arms-horn.fcstd`（solids 10vs172，差异最大）；`Architectural Parts/Beams/Profile HEB.FCStd`（solids 1vs2，差异最小）
- **策略**：**先小后大**——从 solids 1vs2 取点找共性根因（疑似 fuse 后未合并/未拆分，或布尔顺序差异），一个根因往往横扫一族；10vs172 这类极端案例最后单独啃。
- **改动位置**：`packages/core/src/boolean/`、`api/extrude.ts`/`fuse` 翻译分支；`placement.ts` 若证实是坐标合成差。
- **纪律**：不放宽 TOL；每个修正配体积/面积精确断言的单测。

### W4 · 141 个 `exit 3221225794` 之外残存的 gap（非草图部分）

- 待 W1–W3 清出后，重提 800 gap 台账中非草图条目（`pocket-missing-dependency` 余 6 个等），逐个定位——**不在本轮展开**，避免与草图改版撞车。

---

## 4. 执行节奏（每个工作项的标准循环）

```
取 1 个文件 → process-one --reconvert（单任务串行）→ 立即汇报该文件结果
  → 若失败签名：定位根因 → 改代码 + 单测 → 同文件复跑 → 立即汇报
  → 相邻同签名 2–3 个文件确认不回归（逐个汇报）→ 提交 → 取下一个
```

每完成一个文件、每一项修复，都有一次对用户的显式汇报；禁止「跑完一批再说」。

---

## 5. 验收

- W1：Mannequin_mp 8 个全部 run ok（进 parity 或显式 D1 reason）。
- W2：37 个 edgeRef 族 run ok；`no role lineage` / `edge ordinal out of range` 两种签名在语料归零。
- W3：85 个 parity=fail 逐项归因——要么 pass，要么显式 reason 留档；solids 数量不一致的共性根因消解后同族文件批量转绿（仍逐文件汇报）。
- 全程：单测随项落库、每项独立提交、stderr 零容忍。
