# cq-compat blocked 项分类：内核限制 vs 远期阶段

> 日期：2026-09-11 ｜ 状态：分析文档（只写分析，不含实施；代码未做任何改动）
> 背景：Phase 2 parity 收尾后，cq-compat 剩余 ~398 个 BLOCKED 变量。需要把这些 blocked 项按"能否在兼容层内解决"切成两类，明确哪些等内核升级、哪些不在兼容层范围。
> 关联文档：
> - `docs/plans/2026-09-08-cq-compat-parity-phase2.md`（阶段 A–K 可达范围与 Stage G 闭环）
> - `docs/handover/2026-09-10-cq-compat-handover.md`（cq-compat 已移交第三方）
> - `packages/cq-compat/src/workplane.ts`（`resolveFaceSelector`、`compatFn` 投影链路）

---

## 0. 结论先行（TL;DR）

1. **两类 blocked 的根因不同，处置也不同**：
   - **内核限制（kernel-limited）** = occt-wasm / vendored brepjs 内核缺能力或语义不同，但兼容层可继续承载——标 `blocked` + 具体 `blockedBy`，等内核面（occt-wasm 升级 / 暴露新原语）补齐即可翻绿。**不新建子系统。**
   - **远期（future-phase / P6+）** = 需要新建 DSL、类模型或求解器（如 `BuildSketch` 上下文管理器、`assembly-solve` 约束求解器），**超出兼容层范围**，排 P6+ 单独立项，不在 parity 计划内。
2. **强行逼近内核限制项是红线违规**：这些项几何"差一点"但内核无忠实原语，硬逼近会产出错误几何（违反 fail-loud 红线），所以正确做法是标 `blocked` 等升级，而非启发式伪造。
3. **Stage G（slide_top）不属于上述任一类**——它是移植丢索引 + `resolveFaceSelector` 排序方向反，是**逻辑 bug**，已在 Phase 2 内修复（commit `31ec755`，复刻体积 88421.299 = CadQuery ref 零误差）。
4. **唯一 FAIL（`circletorectSweep`）是 compare 工具限制，非几何不符**（近重合 B 样条体上布尔差探针确定性失败，vol 差 1.1e-5），按红线如实保留 FAIL。
5. cq-compat 已于 2026-09-11 移交第三方，上述内核缺口现属第三方范围，本计划不再攻坚。

---

## 1. 分类判据

| 维度 | 内核限制 | 远期阶段 |
|---|---|---|
| 缺什么 | OCCT 能力未暴露 / 语义不同 | 整套 DSL / 类模型 / 求解器 |
| 兼容层能否承载 | 能（op 已存在，只等内核） | 不能（需要新建子系统） |
| 处置 | 标 `blocked` + `blockedBy`，等内核升级 | P6+ 单独立项，不在 parity |
| 硬逼近后果 | 错误几何，违反 fail-loud 红线 | 不在范围，无从逼近 |
| 典型代表 | sweep 多截面、shell 外扩、高椭圆主轴 | Sketch 类模型、assembly-solve 求解器 |

判据一句话：**"内层（内核）有缺口、兼容层可标 blocked 等升级" vs "需新建外层（子系统）承载、不在兼容层范围"。**

---

## 2. 内核限制项（kernel-limited）

cq-compat 把 CadQuery op 经 `compatFn(name)` 投影到 vendored brepjs / occt-wasm 内核。下列行为需要 OCCT 能力，但内核要么不暴露、要么语义不同：

### 2.1 sweep 真多截面 / 辅助脊线 / pipeShell
- **现状**：occt-wasm 的 `loft` / `sweep` 只覆盖单 profile + loft 式 multisection 近似。
- **缺口**：上游 `BRepOffsetAPI_MakePipeShell` 的多截面 / auxiliary spine / 自由函数 sweep 无等价入口。
- **表现**：aux spine 被静默丢弃或产出不同几何。
- **处置**：标 `blocked`，等内核暴露 `MakePipeShell`。

### 2.2 `draft` 作用于已有实体面族
- **现状**：`kernel.draft` 直接失败；仅支持从零建尖角六面体。
- **缺口**：不支持外扩角部 CONE / arc-join（上游 `BRepOffsetAPI_DraftAngle` 作用于现有面族 + 给定中性面）。
- **处置**：标 `blocked`。

### 2.3 `shell` 外扩（正厚度 + 移除面）
- **现状**：内核只给圆角（arc）offset。
- **缺口**：上游 `MakeThickSolidByJoin` 的尖角 **intersection-join** 无等价。
- **实证回滚**："切扫掠板"启发式实测体积偏 0.016+ → 已回滚为显式抛错（见 `packages/cq-compat/src/workplane.ts` 历史记录）。
- **处置**：标 `blocked`，等内核暴露 `MakeThickSolidByJoin`。

### 2.4 高椭圆主轴
- **现状**：occt-wasm 椭圆主轴恒在全局 X、拒 major<minor。
- **缺口**：旋转会重新逼近引入 +0.4% 漂移。
- **处置**：显式抛错（`blocked`），不是几何不符。

### 2.5 共面 loft
- **表现**：`loft(wires,…)` 对共面截面数值失真（19.80 vs 17.15）。
- **处置**：标 `blocked`。

### 2.6 STEP 裸 helix wire 保真度
- **表现**：导出处控制点 24 vs CadQuery 85（helix 长度 51.25 → 44.16）。
- **根因**：STEP 导出对裸 wire 有损，非几何内核问题。
- **处置**：标 `blocked`（E2 `helix` 因此 BLOCKED，见计划文档 E1–E4 章节）。

### 2.7 近重合 B 样条实体布尔差
- **表现**：`BRepAlgoAPI_Cut` 单向失败（`B−A` 返回整体积且 `isValid=true`）。
- **影响**：compare 工具在 `out/cand/*.step` 上跑布尔差探针确定性失败。
- **处置**：这是 **compare 工具限制，非几何不符**——唯一 FAIL `circletorectSweep` 几何 OK（volΔ 1.1e-5、拓扑 f7/e15/v10 全等），按红线如实保留 FAIL。

---

## 3. 远期阶段项（future-phase / P6+）

这些需要新建子系统，兼容层 37 个函数式 op 无法承载，排 P6+：

### 3.1 Sketch（`BuildSketch` 类模型）
- **缺口**：上下文管理器 + Mode 机制 + 独立约束求解器 + 惰性几何。
- **阻断点**：`.fai.js` 子集无 Python 上下文管理器 / 闭包语义承载；cq-compat 无类模型。
- **处置**：P6+ 新建 DSL / 类模型。

### 3.2 nurbs / hull
- **缺口**：上游 test 不在 ref 基线（650 case）内、零覆盖。
- **前置**：需先扩 ref baseline + 建类模型。
- **处置**：P6+。

### 3.3 assembly-solve（约束求解器）
- **规模**：~8 var。
- **缺口**：求解器输出非整角度 / 欠定位无法反推几何 → 需真实约束求解器，远超兼容层范围。
- **处置**：P6+ 单独立项。

---

## 4. 与 Phase 2 计划的关系

- Phase 2 可达范围（阶段 A–K）已全部完成：parity **38.62%**（PASS 247 / FAIL 1 / BLOCKED 398，refCases 650），`pending:mirror` **0**，cq-compat 单测绿，smoke 入 CI。
- 剩余 ~398 blocked var **全部属本节 §2 / §3**，非本计划可达范围。
- Stage G（slide_top）是移交前的最后内部消费方修复，已闭环（commit `31ec755`），不属于 blocked 类。
- cq-compat 已移交第三方（2026-09-11），上述内核缺口现属第三方范围；本计划不再攻坚，待第三方 / 内核面升级后翻绿。

---

## 5. 红线约束（处置依据）

来自 cq-compat parity 红线（计划文档）：
- 内核 / 比较器限制 → `blocked`（写根因），**几何不符 → `FAIL`**。
- 未通过验证的启发式必须**回滚为显式抛错**（shell 外扩开口的"切扫掠板"法已回滚）。
- `compare.ts` 扫 `out/cand/*.step` 不读 manifest 的 blocked → 改判 blocked 后必须删对应 cand STEP（最高频坑）。
- 容差集中在 `compare.ts`，禁止就地放宽消 FAIL。

---

## 6. fai_cq_gears 消费映射（cq_gears 0.62 源码实际核查，2026-09-11 补）

> 触发：用户确认 `C:\git\CADQ\cq_gears` 已有源码（2026-09-11 21:49 检出）。此前计划文档
> `docs/plans/2026-09-11-fai-cq-gears-port.md` L7 称"Python 源本机不存在"——**已证伪**，6 个类可逐字对照翻译。
> 本节以源码 grep 为准，修正"继续任务"对话中"WormGear 可能用 pipeShell、BevelGear 可能用 loft"的"部分相关"判断（**作废**）。

### 6.1 cq_gears 实际消费的 op（grep 证据，cq_gears 0.62）

| op | cq-compat 类比 | 消费类（file:line） | 阻断状态 |
|---|---|---|---|
| `cq.Face.makeSplineApprox` | E1 `splineFace` | Spur:200 / Worm:121 / Bevel:203 / Rack:112 | **E1 BLOCKED → 阻断 4 类** |
| `wp.twistExtrude(...)` | E4 `twistExtrude` | Spur:279/511/517（仅 `twist_angle≠0`）；CrossedHelical/Hyperbolic 继承 Spur（crossed_helical_gear.py:23/26） | **E4 BLOCKED → 阻断斜齿 Spur 族** |
| `cq.Solid.makeSolid(shell)` | E5 `solidFromFaces`（sew+makeSolid） | Spur:470 / Worm:224 / Bevel:313 / Ring:226 / Rack:250 | **E5 未补齐 → 全 6 类 #1 硬阻塞** |
| `face.split(plane)` | E3 `splitFace` | Worm:192/196 / Bevel:209/216 / Rack:162/172 | E3 已 PASS（3 case）→ 可用非阻塞 |
| `extrude` / `cut` / `Workplane` | 通用 | 全类 | 已支持 |

### 6.2 cq_gears 不消费的 op（推翻"部分相关"假设）

- `helix()` op（§2.6 E2）：全项目 **0 调用**——WormGear 螺纹由 `makeSplineApprox` 建（非 `helix` op）。⇒ **§2.6 不影响 fai_cq_gears**。
- `loft`（§2.5）：**0**——BevelGear 锥度由 makeSplineApprox + split 建，非 loft。
- `sweep` / `MakePipeShell`（§2.1）：**0**——无类用 pipeShell。
- `draft`（§2.2）：**0**；`MakeThickSolid`（§2.3）：**0**；`BrepOffsetAPI`：**0**；高椭圆主轴（§2.4）：**0**。
- Sketch（§3.1）/ assembly-solve（§3.3）/ nurbs-hull（§3.2）：均未使用。

### 6.3 修正后影响结论

1. **真正阻断 fai_cq_gears 的分析文档内核限制项 = 仅 §2.7（近重合 B 样条布尔差）**，经 E1（4 类）+ E4（斜齿 Spur 族）体现。其余内核限制项（sweep/draft/shell/loft/helix/椭圆）**均非 cq_gears 消费者**。
2. 远期项（§3）仍不影响——cq_gears 命令式建实体，不碰 `BuildSketch`、不跑约束求解器。
3. **真正的 #1 硬阻塞仍在文档之外：E5 `solidFromFaces`（全 6 类 makeSolid/sew）+ E6 平面盖面**——属"兼容层缺封装原语"，非纯内核限制；解锁需补 cq-compat 公开 op（occt-wasm `index.d.ts` 已有 `sew`/`makeSolid`/`fixFaceOrientations` 方法，仿 E1–E4 模式封装即可）。
4. 计划文档 L7"源缺失"已证伪 → 6 类可 1:1 翻译，原"14 类无法对照"担忧解除（实际本机 cq_gears 0.62 仅 6 类：Spur / Worm / Bevel / Ring / Rack / CrossedHelical+Hyperbolic 子类）。
5. cq-compat 已移交第三方（2026-09-11），E1/E4 的内核解锁（§2.7）与 E5/E6 封装补齐均受第三方节奏约束。
