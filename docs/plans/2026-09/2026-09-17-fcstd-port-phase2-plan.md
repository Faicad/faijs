# FCStd → faijs 移植：第二阶段开发计划（M7–M13）

> 日期：2026-09-17
> 状态：**已拍板，可交付执行**
> 接续：`docs/plans/2026-09-15-fcstd-to-faijs-port-plan.md`（下称「前计划」，其 M0–M6 已完成部分见 §3）
> 全部现状数字来自 2026-09-17 本机复跑，证据日志见 §3.4

---

## 0. 如何使用本文档

| 项 | 说明 |
|---|---|
| 读者 | 接手 FCStd 移植后续开发的执行者（无需参与过一阶段） |
| 执行顺序 | **严格按 M7 → M13 顺序**。M7 是其余一切的前置：没有端到端测试，后续所有改动都不可验证 |
| 每阶段结构 | 目标 / 输入 / 产出 / 步骤 / **完成定义（DoD，逐条可勾选）** |
| 完成标准 | 该阶段所有 DoD 勾选 + `§5` 的复现命令全绿 |
| 术语 | 「样本集」= 本机 `D:/Faicad/FreeCAD` 下的 56 个 `.FCStd`；「前计划」= 2026-09-15 那份 |

**执行纪律（每阶段都适用，不重复）**：见 §10。三条最容易犯的：① 先写失败测试再改代码；② 禁止静默降级；③ 后台任务串行。

---

## 1. 用户原始要求（原文引用）

> @docs/plans/2026-09-15-fcstd-to-faijs-port-plan.md 分析这个文档，并查看目前的开发进度。然后写一份新的开发计划文档，规划后续的开发任务。

> 三个待你拍板，全部按你的意思来。请更新文档，并尽量把文档写的清晰无歧义，可以交给别人执行

即：① 续写计划；② 三个决策已拍板（§2）；③ 文档须无歧义、可转交执行。

---

## 2. 已拍板决策（**不再讨论，按此执行**）

### D-A：产物链路 = 限定 BREP 链

**结论**：FCStd 转换产物定位为 **BREP 链专用**。不补 mesh 实现。

**依据（实测）**：`cad.sketch` 是 `defineOp({ brep })` 无 mesh 实现（`api/sketch.ts:188`）；`extrude`/`revolve`/`linearPattern`/`circularPattern` 是 `compatOp(projectBrepOp(...))`（`api/generated/operations.ts:152/162/202/212`）；`chamfer`/`fillet` 同为 brep-only（`api/chamfer.ts:5` 明写「没有 mesh 实现」）。产物主链路 sketch→extrude/revolve→fillet/chamfer→pattern 无一具备 mesh 实现。

**落地要求（三条，缺一不可）**：

1. **schema**：`container.ts` 的 `FaiManifest` 增加字段 `requiresBrep: true`，写入 `manifest.json`。测试须断言该字段恒为 `true`。
2. **执行约定**：产物一律以 **`--mode brep`** 运行。端到端断言必须显式传 `--mode brep`，**不得依赖 `auto`**。
   - 背景（勿误解）：`cad-runtime/backend-dispatch.ts:110` 的 auto 规则是 `impls.brep && inputs.every(hasBrep) → brep`，链完整时 auto 也会走 brep；但 auto 遇能力缺失会静默降级到 mesh 并抛 `E_MESH_UNSUPPORTED`，为消除歧义，断言锁定 `brep`。
3. **mesh 模式行为**：已有设计即抛 `E_MESH_UNSUPPORTED`，**不需要改引擎**。产物说明文档须写明「本产物需要 BREP 链」。

**已知风险点（M7.3 必须实测）**：`cad.sketch` 声明了 `capabilities: ['directEdit']`（`api/sketch.ts:189`）。按 `backend-dispatch.ts:86-93`，brep 模式下引擎缺该能力会抛 `E_BREP_UNSUPPORTED: current engine lacks capability 'directEdit'`。若 M7.3 实测缺能力 → **记为阻塞项并上报**，不要自行删除 `capabilities` 声明。

### D-B：资产口径 = `.brp` 原样直存

**结论**：`assets/` 保存 FCStd ZIP 内的 **`.brp` 原始字节**（OCCT BREP 文本），**不重命名、不转 STEP**。

**落地要求**：
1. `build-fai-zip.ts` 保持现有「按 ZIP 成员原名拷入 `assets/`」的行为不变。
2. 文档口径统一为 `assets/*.brp`。**前计划 §2.1 的 `assets/*.step` 表述已同步修订**（本轮已改，附订注）。
3. 不再讨论 STEP 转换；若未来需要，另开议题。

### D-C：同一 Body 内多特征 = fuse 累加

**结论**：PartDesign Body 内特征按 `Body.Group` 顺序 **逐次 fuse**：第一个特征为基础，其后每个 Pad 与前序结果 `cad.union`，每个 Pocket 与前序结果 `cad.subtract`。

**落地要求**：
1. 禁止再用 `cad.group({ members: [...] })` 表达同一 Body 内的特征组合（那是装配语义，当前 `codegen.ts:194` 的用法是错的）。
2. `cad.union` 支持多输入（`api/boolean.ts:113`，`schema: { shapes: 'Shape*' }`），但**规定用链式二元调用**（`cad.union(prev, next)`），使每个中间结果都有独立变量名，便于 `mapping.json` 定位与调试。
3. 跨 Body 才用 `cad.group` 或分文件（M10 定义）。

---

## 3. 现状盘点（2026-09-17 实测）

### 3.1 代码资产

| 文件（`packages/core/src/fcstd/`） | 行数 | 前计划对应 | 状态 |
|---|---|---|---|
| `unpack.ts` | 72 | M1.1 | 完成 |
| `document.ts` | 160 | M1.2 | 完成 |
| `sketch-parse.ts` | 288 | M3.1 | 完成（5 种几何 + `First/Second/Third` 回退） |
| `planegcs-backend.ts` | 539 | M3.2 | 完成（15 类 P0 约束） |
| `sketch-solver.ts` | 71 | M3.2 / D5 | 完成 |
| `contour.ts` | 118 | M3.6 | 完成（线段/圆弧/整圆） |
| `sketch-verify.ts` | 69 | M3.5 / D3 | 完成（三级降级 + `maxPointDistance`） |
| `external-geo.ts` | 140 | M6.3 | 部分（投影已实现，全量解锁在 M13.3） |
| `expressions.ts` | 79 | M6.2 | **已实现、未接入**（G6） |
| `feature-translate.ts` | 470 | M4 | 完成（白名单 12 类） |
| `codegen.ts` | 243 | M5.1/M5.2 | 完成但**产出非法 JS**（G1） |
| `container.ts` | 83 | M2.1 | 完成（需按 D-A 加字段） |
| `build-fai-zip.ts` | 120 | M2.2–M2.4 | 完成（资产口径见 D-B） |

测试 9 个文件 1,227 行；`packages/core/scripts/` 三个脚本 267 行；`api/sketch.ts` 194 行 + `api/edge-ref.ts` 103 行。
提交链：`37da83d`(M0–M5) → `8e782e6`(M6 草图→cad 面) → `44a1c11`(LinearPattern/PolarPattern) → `a7792f8`(M6.1 Fillet/Chamfer + `cad.edgeRef`)。工作区干净。

> **订正一条过期认知**：曾流传「Chamfer 7 / Fillet 5 是唯一剩余翻译缺口」——该说法早于 `a7792f8`，**已不成立**。`feature-translate.ts:386-455` 已有完整 Fillet/Chamfer 分支，`feature-translate.test.ts` 有 7 个用例覆盖（含三类 ChamferType）。

### 3.2 单元 / 样本 / 求解

| 项 | 实测结果 |
|---|---|
| 单测 `npx vitest run src/fcstd` | **9 文件 / 58 用例全绿**（5.39s） |
| 样本扫描 56 个 `.FCStd` | **failures: 0**，SketchObject 126，geometry 640，constraints 1539（M7.5 修正口径后复跑，见 G10 订注） |
| 全样本求解 | **L0=122 / L1=4 / L2=0（96.8%）**；L1 成因 `unsupported-constraint`×1 + `delta-exceeds-t1(T1=1e-6)`×3 |

前计划 V2 首轮目标「L0 ≥ 80%」**已超额达成**。

### 3.3 端到端：**管线能跑，产物不可用**

| 样本（`D:/Faicad/FreeCAD/`） | translated | baked | preserved-only | L0 草图 |
|---|---|---|---|---|
| `data/tests/Crank.fcstd` | 0 | 16 | 0 | 0 |
| `data/tests/PadTest.fcstd` | **6** | 4 | 3 | **3** |
| `data/tests/ProjectTest.FCStd` | 0 | 1 | 0 | 0 |

`PadTest` 生成的 `model/main.fai.js` 首行（**非法**）：

```js
let part0 = cad.sketch(, { contours: [{"segments":[…],"closed":true}] }); // s0 Sketch
```

`npx tsx packages/core/scripts/faijs-cli.ts check <main.fai.js>`：

```
✅ …\main.fai.js: 1 error(s)
  [parse] [parser] line 4: SyntaxError: Unexpected token (4:23)
```

**结论：前计划 V7 明确 FAIL。当前状态是「能转换、不能用」。**

### 3.4 证据日志（仓库根，可复核）

`out-fcstd-test.log`（单测）、`out-scan-samples.log`（样本扫描）、`out-validate-solve.log`（全样本求解）、`out-probe-crank.log` / `out-probe-pad.log` / `out-probe-proj.log`（端到端）、`out-probe-check.log`（check 失败）。

---

## 4. 缺口清单

严重度：**致命** = 阻断交付；**高** = 阻断验收判据；**中/低** = 不阻断但必须闭环。

| 编号 | 严重度 | 缺口 | 精确定位 | 触发条件 | 影响 |
|---|---|---|---|---|---|
| **G1** | 致命 | 生成脚本语法非法（空位置参数） | `codegen.ts:231-243 renderArgs()`：`positional.join(', ')` 在 `inputs` 空时得 `''`，再拼 `, { … }` → `cad.sketch(, {…})` | 任何「无位置参数、只有具名参数」的调用（`cad.sketch`；`box`/`cylinder` 走具名也会中招） | **V7 FAIL** |
| **G2** | 高 | 全链路 brep-only | `api/sketch.ts:188`、`api/generated/operations.ts:152/162/202/212`、`api/chamfer.ts:5` | 产物任何主链路 | 已由 D-A 拍板处置 |
| **G3** | 高 | 坐标系与定位变换缺失 | `sketch-parse.ts:154-208` 只取 `X/Y`，丢弃 `Z`、不读 `Placement`/`AttachmentOffset`；`feature-translate.ts:199-208` 仅 Box/Cylinder 用 `placementPos` | 草图挂在非 XY 平面 / Body 带 Placement | V6 必挂 |
| **G4** | 高 | Pad/Pocket 只支持 `Length` | `feature-translate.ts:274-319` 未读 `Type`/`Length2`/`UpToFace`/`Offset` | `Type != 0`（样本集 `TwoLengthsPad*.FCStd` 三个文件命中） | 静默按 Length 处理，违反禁降级纪律 |
| **G5** | 高 | Body 语义与拆分未实现 | `codegen.ts:44-60 depsOf()` 未读 `Body.Group`；`codegen.ts:194` 用 `cad.group` | 任何多特征 Body（样本 37 个 Body） | 特征顺序与组合语义均错 |
| **G6** | 中 | M6.2 表达式未接入 | `expressions.ts` 只有 `expressions.test.ts` 引用；`feature-translate.propNum()` 从不查 `ExpressionEngine` | 前计划实测的 1,709 个 `<ExpressionEngine>` | 相关特征取到 0，产出错误几何 |
| **G7** | 中 | 资产提取零测试覆盖 | `build-fai-zip.ts:58-89,110-117` 的 `brpOwners` 正则提取 | — | 可能大面积失效且无人知晓 |
| **G8** | 中 | T1 未标定、4 个 L1 未定位 | `fcstd-to-fai-zip.ts:25` 写死 `T1 = 1e-6` | — | V2 数字缺依据 |
| **G9** | 中 | L1/L2 草图无轮廓资产 | 只写 `mapping.json`，无实体文件 | 外部几何解锁后 L2 会出现 | V3 归属物缺实体 |
| **G10** | 低 | 扫描统计口径 bug | `scan-fcstd-samples.ts:65-70`，geo/con 被文件内最后一个草图覆盖 | — | 复跑得 640，前计划记 786，数字打架 |
| **G11** | 低 | 脚本未接线、路径硬编码 | `validate-sketch-solve.ts:21` 硬编码 `D:/Faicad/FreeCAD` | 换机即废 | 不可重跑 |
| **G12** | 低 | CLI 输出中文乱码 | `fcstd-to-fai-zip.ts:183` 的 `—` 打成 `鈥?` | 控制台回显 | 污染 golden 断言 |
| **G13** | 可选 | 白名单扩容候选 | 见 M13 | — | 覆盖率提升 |

---

## 5. 环境与现状复现（执行者第一步）

```powershell
# 1) 单测（PowerShell 下跑；Git Bash 的 npx 会被沙箱拦截 wsl.exe）
cd D:\Faicad\faijs\packages\core
npx vitest run src/fcstd
# 期望：Test Files 9 passed (9) / Tests 58 passed (58)

# 2) 样本集扫描
cd D:\Faicad\faijs
npx tsx packages/core/scripts/scan-fcstd-samples.ts D:/Faicad/FreeCAD
# 期望：files: 56, failures: 0

# 3) 全样本求解
npx tsx packages/core/scripts/validate-sketch-solve.ts
# 期望：sketches: 126 / L0: 122 / L1: 4 / L2: 0

# 4) 端到端（当前必失败，这是 G1 的复现）
npx tsx packages/core/scripts/fcstd-to-fai-zip.ts D:/Faicad/FreeCAD/data/tests/PadTest.fcstd $env:TEMP\pad.fai.zip
# 期望（当前）：translated=6 baked=4 preserved-only=3，且 model/main.fai.js 含 "cad.sketch(, {"

Expand-Archive $env:TEMP\pad.fai.zip $env:TEMP\pad -Force
npx tsx packages/core/scripts/faijs-cli.ts check $env:TEMP\pad\model\main.fai.js
# 期望（当前）：1 error(s) [parse] line 4: SyntaxError
```

**环境约束**：
- 样本集 `D:/Faicad/FreeCAD` 在仓库外。依赖语料的测试沿用 `external-geo.test.ts:30-39` 的惯例：`describe.skipIf(!sampleAvailable)`，根路径取 `process.env.FAIJS_FCSTD_CORPUS ?? 'D:/Faicad/FreeCAD'`。
- **Git Bash 下 `npx` 被沙箱拦（wsl.exe 黑名单）→ 一律用 PowerShell 跑测试/脚本**。
- BREP 测试需在 `beforeAll` 调 `initOcctWasm()`（见 `external-geo.test.ts:27`）。

---

## 6. 分阶段计划

### M7 — 端到端闭环（止血，最高优先）

**目标**：让产物能被 `check` 与 `run` 通过，并建立「此后任何改动都能被端到端验证」的护栏。

**输入**：现状代码 + 3 个样本。**产出**：修复后的 `codegen.ts`、`packages/tests/faijs/fcstd/` 集成测试、可 `npm run` 调用的脚本、修订后的统计口径。

| 步骤 | 内容 | 文件 |
|---|---|---|
| M7.1 | 修 `renderArgs()`：位置段 = `[...inputs, ...literals]` 逐项渲染后**过滤空串**再 `join(', ')`；具名段非空时才以 `, ` 连接；**位置段为空时不得输出前导逗号** | `src/fcstd/codegen.ts` |
| M7.1b | 补单测：无位置参数的调用不得产出 `cad.x(, {` | `src/fcstd/codegen.test.ts` |
| M7.2 | 新建 `packages/tests/faijs/fcstd/fcstd-e2e.test.ts`：三样本断言（基线见表下） | 新文件 |
| M7.3 | 断言链：转换 → 取 `model/main.fai.js` → `check` 零错误 → `run --mode brep --out *.step` 成功（见 D-A 第 2、3 条与风险点） | 同上 |
| M7.4 | `validate-sketch-solve.ts` 的样本根改为参数（`process.argv[2]`）；三个脚本接入 `packages/core/package.json` 的 `scripts` | `scripts/*.ts`、`packages/core/package.json` |
| M7.5 | 修 `scan-fcstd-samples.ts:65-70` 的 geo/con 统计（每个草图各自累加），重跑并把权威数字回填本文档 §3.2 | `scripts/scan-fcstd-samples.ts` |
| M7.6 | G12：CLI 注释行改用 ASCII（`-` 替代 `—`） | `scripts/fcstd-to-fai-zip.ts:183` |

**e2e 基线（M7.2 断言值，随后续阶段演进需显式更新并写明原因）**

| 样本 | translated | baked | preserved-only | L0 草图 |
|---|---|---|---|---|
| `data/tests/PadTest.fcstd` | 6 | 4 | 3 | 3 |
| `data/tests/Crank.fcstd` | 0 | 16 | 0 | 0 |
| `data/tests/ProjectTest.FCStd` | 0 | 1 | 0 | 0 |

**M7 DoD**（逐条勾选）
- [ ] `npx vitest run src/fcstd` 全绿，且新增 M7.1b 用例
- [ ] 三样本生成的 `model/main.fai.js` 中**不存在** `(, ` 片段
- [ ] `faijs-cli.ts check` 对三样本产物均 **0 error**
- [ ] `faijs-cli.ts run --mode brep --out <tmp>.step` 对 `PadTest` 产物**成功**；若遇 `E_BREP_UNSUPPORTED ... 'directEdit'` → 记为阻塞项并上报（**不得自行删 `capabilities`**）
- [ ] `manifest.json` 含 `requiresBrep: true`（D-A 第 1 条），且 `container` 相关单测断言该字段
- [ ] 三个脚本可经 `npm run` 调用；`validate-sketch-solve.ts` 支持传入样本根
- [ ] `scan-fcstd-samples.ts` 的 geometry/constraints 数字已修正并回填 §3.2
- [ ] `packages/tests/faijs/fcstd/` 测试在语料缺失时 `skip`（CI 绿）

---

### M8 — 坐标系与定位变换

**目标**：让草图轮廓与特征位置落在其真实 3D 位置，为 V6 几何保真扫清最大障碍。

**输入**：M7 的 e2e 护栏。**产出**：`sketch-parse.ts` / `feature-translate.ts` 的定位处理 + 比对测试。

| 步骤 | 内容 | 文件 |
|---|---|---|
| M8.1 | 解析 `SketchObject` 的 `Placement`（`PropertyPlacement`：`Px/Py/Pz` + `Q0..Q3` 四元数）与 `AttachmentOffset`；**四元数→矩阵的换算须按 FreeCAD 源码标定并落测试，不得凭记忆写** | `src/fcstd/placement.ts`（新） |
| M8.2 | 草图 3D→2D：按草图法向建正交基，把 `X/Y/Z` 投到 `(u,v)`；**法向非 ±Z 时按平面基变换，不得丢弃 Z** | `src/fcstd/sketch-parse.ts` |
| M8.3 | 变换传递：Pad/Pocket/Revolution/Pattern 与 Body 的 `Placement` 合成进轮廓坐标，或降级为 `cad.translate` / `cad.rotate_euler` 调用（二选一需实测后选定并写清理由） | `src/fcstd/feature-translate.ts` |
| M8.4 | 比对测试：含非 XY 草图的样本（如 `PadTest` 的 `Sketch002`，实测 y≈52.1）做「轮廓 2D 坐标 vs 草图局部真值」逐点比对 | `src/fcstd/placement.test.ts`（新） |

**M8 DoD**
- [ ] 四元数→矩阵有独立单测，用已知旋转（90°/180° 绕各轴）的解析解校验
- [ ] 全部 L0 草图的轮廓坐标在给定平面基下与 FreeCAD 落盘值逐点一致（容差 1e-6）
- [ ] 非 XY 平面草图不再静默丢 Z；任何无法建基的情形**显式抛错并降级 L2**，不猜
- [ ] 三样本 e2e 仍全绿（基线如变化须写明原因）

---

### M9 — Pad/Pocket 语义完整化

**目标**：消除 G4 的静默降级，并落地 D-C 的 fuse 累加。

| 步骤 | 内容 | 文件 |
|---|---|---|
| M9.1 | 解析 `Type` 枚举与配套属性：`Length2`、`Offset`、`UpToFace`、`TaperAngle` | `feature-translate.ts` |
| M9.2 | `Length` → 单段 extrude；`TwoLengths` → 双段（正向 `Length` + 反向 `Length2`）后 union；`ThroughAll` → **显式烘焙并记 reason**（不得按 bbox 猜长度） | 同上 |
| M9.3 | `UpToLast` / `UpToFace` → 依赖面引用锚点，本阶段**显式烘焙 + reason** | 同上 |
| M9.4 | **D-C 落地**：同一 Body 内特征按序 fuse 累加，链式二元 `cad.union` / `cad.subtract`；删除 `cad.group` 的同 Body 组合用法 | `codegen.ts` |

**M9 DoD**
- [ ] `TwoLengthsPadWithExpression.FCStd`、`TwoLengthsPadCrossObjectRef.FCStd`、`TwoLengthsPadCyclicExpr.FCStd` 三个样本产出正确双段或**有明确烘焙 reason**
- [ ] 代码内不存在「`Type` 未识别却按 Length 处理」的分支
- [ ] 同 Body 多特征的产物为 `union`/`subtract` 链，无 `cad.group`
- [ ] 每个未支持 `Type` 在 `mapping.json` 有 `reason`

---

### M10 — Body 顺序与多 Body 拆分

**目标**：落地前计划 M5.1（Body.Group 优先）与 M5.3（多 Body 拆分）。

| 步骤 | 内容 | 文件 |
|---|---|---|
| M10.1 | 解析 `PartDesign::Body` 的 `Group`（`LinkList`）作为特征主顺序；`depsOf()` 保留现有 `Base/Tool/Profile/BaseFeature/Originals/Shapes` 作为回退 | `codegen.ts` |
| M10.2 | Body 内 Pocket 的 base = **链上前一个特征的变量**（`Body.Group` 顺序）；仅当 `BaseFeature` 有值时以 `BaseFeature` 为准。此规则需先探针确认样本实际形态，再定死 | `feature-translate.ts` |
| M10.3 | 多 Body → `model/<BodyName>.fai.js`；`model/main.fai.js` 为聚合入口（跨 Body 用 `cad.group`） | `codegen.ts`、`container.ts` |
| M10.4 | 实测 `zip-loader.ts` 是否默认命中 `model/main.fai.js`；未命中则在 `manifest.entry` 显式写（前计划 §11 待定项 ③） | 探针 + `container.ts` |
| M10.5 | 未归属任何 Body 的散落 Part 特征归入 `main.fai.js` | `codegen.ts` |

**M10 DoD**
- [ ] 37 个 Body 全部分组正确（报表可查）
- [ ] 多 Body 样本产出多个脚本文件，`manifest.entry` 能被加载器命中（M10.4 有实测结论）
- [ ] e2e 基线更新并写明原因

---

### M11 — 表达式接入与资产收口

**目标**：闭环 G6、G7、G9，落地 D-B。

| 步骤 | 内容 | 文件 |
|---|---|---|
| M11.1 | 把 `expressions.ts` 接入属性读取链：`propNum()` 优先取 `ExpressionEngine` 的常量值，取不到再回落 `<Float>` | `feature-translate.ts` |
| M11.2 | 非常量表达式（跨对象引用、含标识符运算）→ 显式烘焙 + `reason`，**不做启发式估值** | 同上 |
| M11.3 | **D-B 落地**：`assets/` 保存 `.brp` 原字节；补测试断言「`assets/` 条目数 == `mapping.json.artifacts` 中资产条目数」（当前 G7 零覆盖） | `build-fai-zip.ts` + 测试 |
| M11.4 | L1/L2 草图轮廓资产落盘 `assets/<Sketch>.contour.json`，补齐 V3 实体 | `fcstd-to-fai-zip.ts` |

**M11 DoD**
- [ ] `TwoLengthsPadWithExpression.FCStd` 取到表达式值而非 0（有断言）
- [ ] `assets/` 与 `mapping.json.artifacts` 数量一致的测试通过
- [ ] L1/L2 草图有对应 `assets/<Sketch>.contour.json`
- [ ] 非常量表达式全部进 `baked` 且带 reason

---

### M12 — 保真度验收与标定

**目标**：产出可重跑的保真度报表与有依据的容差。

| 步骤 | 内容 | 文件 |
|---|---|---|
| M12.1 | **T1 标定**：跑全样本输出 delta 分布（P50/P90/P99/max），取分布尾部外的合理值，取代写死的 1e-6（前计划 §8「标定先于实现」） | `scripts/calibrate-t1.ts`（新） |
| M12.2 | 定位 4 个 L1：输出「文件 / 草图 / 约束类型」三元组；若 `unsupported-constraint` 确为 `InternalAlignment`(15)，评估是否升级进 P0 集 | 探针脚本 |
| M12.3 | **V6 几何保真**：faijs 重算 vs FCStd 原 BREP —— 体积相对误差（**必须用三角化 `meshVolume`，禁用 `getVolume`**，见 MEMORY.md 的 BRepGProp 混叠坑）、质心距离、bbox 对角偏差、采样 Hausdorff | `scripts/verify-geometry.ts`（新） |
| M12.4 | **V5 覆盖率双口径报表**：① 全量对象覆盖率；② **非 Python 建模对象覆盖率**（前计划 §8 定义） | `scripts/coverage-report.ts`（新） |
| M12.5 | **V4 人工抽样**：由 `freecad/` 影子重打包，抽样 ≥3 个样本交 FreeCAD 打开验证（人工，记录结论） | 人工 |

**M12 DoD**
- [ ] T1 有分布报告支撑，且写在一处（容差集中管理约定）
- [ ] 4 个 L1 全部定位；归零或每条有明确原因
- [ ] V5 / V6 有可重跑脚本 + 门槛值
- [ ] V4 有 ≥3 个样本的人工验证记录

---

### M13 — 覆盖率扩展（**可选，须先有 M12.4 数字**）

| 步骤 | 内容 |
|---|---|
| M13.1 | 探针：`Part::Feature` 那 70 个对象的真实子类型与可译性——**摸清前不得进白名单** |
| M13.2 | 按性价比排序扩容：`Part::Offset2D`(22) → `Part::Mirroring`(4) → `Part::Sphere`(1) / `PartDesign::AdditiveSphere`(1) → `Part::Compound`(5) / `Part::MultiCommon`(1) |
| M13.3 | M6.3 外部几何全量解锁（当前影响面仅 5 个文件，`external-geo.ts` 已可用） |

**M13 DoD**：覆盖率口径 ② 较 M12 有可测提升；新增类型均有单测 + e2e 覆盖。

---

## 7. 验收判据总表

| 编号 | 判据 | 现状（2026-09-17 实测） | 目标 | 归属 |
|---|---|---|---|---|
| V1 | 容器保真（影子 sha256） | **达成**（5 例单测） | 保持 | — |
| V2 | 草图求解 L0 占比 | **96.8%**（122/126） | 定位并消化 4 个 L1 | M12.2 |
| V3 | 零静默丢失 | 部分（有 disposition，L1/L2 无实体资产） | 达成 | M11.4 |
| V4 | 可还原（FreeCAD 重开） | 未做 | 人工抽样 ≥3 | M12.5 |
| V5 | 翻译覆盖率（双口径） | 未量化（PadTest 6/13、Crank 0/16） | 可重跑报表 | M12.4 |
| V6 | 几何保真（体积/质心/bbox/Hausdorff） | 未做 | 可重跑脚本 + 门槛 | M12.3 |
| V7 | 脚本可执行（`faijs-cli check`） | **FAIL**（G1） | **零错误** | **M7** |
| V8 | 端到端 golden | 无 | 三样本 golden 测试 | M7.2 |

---

## 8. 风险登记

| 编号 | 风险 | 影响 | 对策 | 状态 |
|---|---|---|---|---|
| R-A | 产物从未端到端验证（G1 说明单测全绿 ≠ 产物可用） | 高 | M7 先建 e2e 再改码；此后每阶段出口须有 e2e 断言 | 已规划 |
| R-B | 全链路 brep-only | 高 | **D-A 已拍板**：限定 BREP 链 + manifest 标注 + 断言锁 `--mode brep` | **已拍板** |
| R-C | 坐标系/Placement 缺失致 V6 不可达标 | 高 | M8 专项；四元数解析须实测标定 | 已规划 |
| R-D | 1,709 个表达式未降级 | 中 | M11.1 接入；非常量一律烘焙 | 已规划 |
| R-E | `.brp` 提取零测试覆盖 | 中 | M11.3 补断言；口径由 D-B 固定 | 已拍板口径 |
| R-F | 样本统计口径不一致，覆盖率数字可能失真 | 低 | M7.5 先修统计再谈覆盖 | 已规划 |
| R-G | Python 系对象占绝大多数（874+），覆盖率天花板 | 中 | 前计划 R4' 已记录；用 V5 双口径如实统计 | 沿用 |
| R-H | `cad.sketch` 的 `directEdit` 能力缺失可能导致 brep 模式抛错 | 中 | M7.3 必测；命中即上报，不得自行删声明 | 新增 |
| R-I | e2e 依赖仓库外语料，CI 可能无此路径 | 低 | 沿用 `describe.skipIf` 惯例 + `FAIJS_FCSTD_CORPUS` 覆盖 | 已规划 |

---

## 9. 剩余待定项

1. **M13 是否执行**：等 M12.4 的非 Python 覆盖率数字出来再定（前计划 §11 第 4 条同理）。
2. **`Part::Feature`（70 个）是否需要探针摸底**：若多为 Import/Clone 类容器，扩白名单意义有限。

（原 D-A / D-B / D-C 已拍板，见 §2；原「样本集来源」问题在前计划已解除。）

---

## 10. 实施纪律（继承 AGENTS.md 与前计划 §12）

1. **先失败测试、再改代码**。G1 的教训是缺陷逃过 58 个单测——只有端到端断言能抓住。M7 之后每阶段出口必须同时有单测与 e2e 断言。
2. **禁止静默降级**。G4（`Type` 未支持却按 Length 处理）是现行违规，M9 必须消除；任何降级写进 `mapping.json` 的 `reason`。
3. **未验证的启发式回滚为显式抛错**。M8 的坐标系变换、M9 的 `ThroughAll`、M10.2 的 base 归属规则均不得猜测。
4. **容差只写一处**。V2 的 T1、V6 的比对容差集中管理，不散落。
5. **标定先于实现**。T1 由 M12.1 实测分布给出，不得先写死再解释。
6. **串行跑后台任务**。构建/测试/全样本验证严禁并行（用户全局铁律）。
7. **测试与 Agent Note 同 PR**。每阶段出口带测试 + 非平凡变更的 Agent Note。
8. **阶段性提交用 `--no-verify`**。此期间不跑 lefthook / `doc-sync` / 全仓 tsc-eslint；只为「代码是否真能跑」跑与被改文件直接相关的单测。
9. **环境**：Git Bash 下 `npx` 被沙箱拦，测试与脚本一律用 PowerShell 跑。
