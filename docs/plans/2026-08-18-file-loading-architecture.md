# 跨项目文件加载架构分析与变更设计（faijs ↔ 3d_editor）

> 日期：2026-08-18
> 定位：梳理 faijs 与 3d_editor 之间文件加载的架构分工、定位重复逻辑的根源，并给出单位猜测（unit guess）逻辑的归属变更设计。
> 关联：`docs/plans/2026-08-12-faijs-extraction-plan.md`（faijs 抽取过程）、`docs/api-contract.md`（load op 契约）、`../3d_editor/src/renderer/config/file-formats.ts`（guessStlUnit 现状）。

---

## 0. 需求原始来源（用户原话，最优先内容）

> 本文档全部结论以用户原话为第一依据。以下为原话记录：

**原话一（STL 无单位，系统猜测）**：
> "全都不正确。stl没有单位。本系统默认mm。碰到stl文件，本系统会猜测stl的尺寸单位。如果是米，意思是系统猜测它是米"

**原话二（猜测不限于米）**：
> "第二处表述还是不正确，系统也可能猜测为英寸，更大的可能是猜测为毫米。并不是stl就一定猜测为米。自己找到这方面的代码。如果找不到，可能在../3d_editor项目里，告诉我当地在哪里"

**原话三（质疑我的错误表述）**：
> "STL 文件使用米为单位？什么意思？"

**原话四（要求检查系统内表述）**：
> "系统里是否有这样错误的表述？"

**原话五（guess unit 归属问题）**：
> "这段guess unit的代码，放在哪个项目合适？"

**原话六（纠正：faijs 不走 OCCT 加载 STL）**：
> "faijs 通过 OCCT 加载 STL？ 错误。给我全面梳理清楚，文件处理的架构和分工。在两个项目之间"

**原话七（重复加载逻辑疑问）**：
> "为什么有重复的文件加载逻辑？"

**原话八（本文档任务）**：
> "写一份完整的分析文档和架构变更设计"

---

## 1. 现状：两个项目的文件处理架构

### 1.1 格式分工总表

| 格式 | 3d_editor | faijs |
|------|-----------|-------|
| **STL** | Three.js `STLLoader`（formatLoaders.ts:226-241） | Three.js `STLLoader`（mesh/io.ts:23-27） |
| **STEP/IGES/BREP** | OCCT `loadBrep`（formatLoaders.ts:399-448） | OCCT `loadBrep`（brep-ops.ts:608-639） |
| **GLB/glTF** | Three.js `GLTFLoader`（formatLoaders.ts:242-341） | 不处理 |
| **3MF** | 自定义 `parse3mfFast`（formatLoaders.ts:342-396） | 不处理 |
| **FCStd** | ZIP 解析 + OCCT（formatLoaders.ts:451-507） | 不处理 |
| **GCode** | Three.js `GCodeLoader` | 不处理 |

**关键结论：faijs 不通过 OCCT 加载 STL。** STL 在两个项目中都用 Three.js `STLLoader` 解析。OCCT 只在 STEP/IGES/BREP 路径（`kernel.importStep`）和 mesh→solid 重建（`meshReconstruct.ts`）中使用，后者不是常规 STL 导入。

### 1.2 STL 加载双路径（当前）

**3d_editor 路径（完整，含单位猜测）：**

```
STL 字节 → STLLoader.parse() → BufferGeometry → deriveNormals() → THREE.Mesh
                                                                        ↓
                                                          ModelGroup.tsx:436-455
                                                          guessStlUnit(bbox)
                                                          geo.scale(s,s,s)  ← 猜测非 mm 时
                                                          unitScaleFactors[i] = s
                                                                        ↓
                                                          ModelGroup.tsx:686-701
                                                          partTransforms[scopedId] = { position, scale }
```

**faijs 路径（headless，无单位猜测）：**

```
STL 字节 → STLLoader.parse() → geoToManifoldMesh() → Shape（原始坐标，不缩放）
```

faijs 的 `mesh/io.ts` 注释自述："替代浏览器版的 io.ts（依赖 fileBlobStore / formatLoaders / model-store）"——它是有意的简化版，只支持 STL。

### 1.3 单位猜测逻辑（guessStlUnit）现状

**定义位置：** `3d_editor/src/renderer/config/file-formats.ts:433-443`

```ts
/** Guess STL unit from bounding box volume (heuristic). */
export function guessStlUnit(bbox): UnitSystem {
  const w = bbox.max.x - bbox.min.x
  const h = bbox.max.y - bbox.min.y
  const d = bbox.max.z - bbox.min.z
  const volume = w * h * d

  if (volume > 0 && volume < 0.008) return 'meter'   // cube root ≈ 0.2 → coords likely in meters
  if (volume > 0 && volume < 8.0)   return 'inch'    // cube root ≈ 2.0 → coords likely in inches
  return 'millimeter'                                  // default
}
```

配套数据：`UNIT_TO_MM`（file-formats.ts:402-410）—— `millimeter: 1, centimeter: 10, meter: 1000, inch: 25.4, foot: 304.8, micron: 0.001, angstrom: 0.0000001`。

**调用位置：** 仅 `ModelGroup.tsx:442`（STL 分支）与 `guessGlbUnit` 并列（GLB 分支 460-469）。**faijs 中零调用**（rg 已确认）。

**语义澄清（用户原话一、二）：** STL 文件**没有单位**。系统默认 mm。系统**猜测** STL 的尺寸单位——可能是米、英寸，**更可能是毫米**（默认分支）。猜测依据是 bounding box volume 的启发式阈值。

### 1.4 单位缩放信息如何跨项目传递（partTransform.scale）

```
ModelGroup.tsx:694-699       unitScaleFactors → engineState.partTransforms[scopedId].scale
ScriptEngine.ts:1323-1328    partTransforms[scopedId] → CadRuntime.replay({ partTransform: { position, scale } })
runtime.ts:193-198           brepChain.partTransform = { position, scale }
drill.ts:68-84               worldToLocalPosition = (worldPos - position) / scale
split.ts:56-84               worldToLocalVec3（同逻辑）+ bboxSize / scale
```

3d_editor 的渲染几何**已缩放**（mm 世界坐标），而 faijs 的 `cad.load` 返回**原始文件坐标**。两者通过 `partTransform.scale` 桥接：faijs 的 drill/split 将世界坐标的点击位置转换回原始坐标后再运算。

### 1.5 已修正的注释表述（本日提交 aa9023b、ab6d6bf）

`src/ops/drill.ts` 原有两处错误表述，已按用户原话修正：

| 位置 | 错误表述 | 修正后 |
|------|----------|--------|
| drill.ts:64 | "如 STL 从 meter 缩放到 mm 的 1000x" | "如系统猜测 STL 单位为非 mm 时会缩放" |
| drill.ts:224 | "（可能是 meter）" | "（系统可能猜测 STL 单位为非 mm）" |

错误本质：暗示"STL 自身带单位、从 meter 转换到 mm"；正确语义是"**系统猜测** STL 单位为非 mm 时缩放"。

---

## 2. 问题分析

### 2.1 重复的文件加载逻辑（原话七）

两套 STL 加载逻辑并存：

1. **3d_editor** `formatLoaders.ts:226-241`：STLLoader + deriveNormals + 单位猜测 → THREE.Mesh（渲染用）
2. **faijs** `mesh/io.ts:17-37`：STLLoader + geoToManifoldMesh → Shape（运算用，无单位猜测）

**历史根源：** faijs 是从 3d_editor 抽取的（2026-08-12 抽取计划）。抽取时 `mesh/io.ts` 是简化版——只支持 STL、无单位猜测、无 GLB/3MF。因为 faijs 的接口不完整，3d_editor 保留了完整加载链，导致两套逻辑各自维护。

**危害：**
- 单位猜测逻辑单点存在于 3d_editor，faijs headless（CLI/脚本）加载 STL 时行为不一致
- 两处 STLLoader 调用可能漂移（如 3d_editor 加了 deriveNormals，faijs 没有）
- 任何单位猜测策略变更都要在 3d_editor 单独维护

### 2.2 单位猜测归属不当（原话五）

`guessStlUnit` 是**几何数据预处理**，属于引擎层职责：

- faijs 是底层引擎，应独立完成"字节 → 几何"的完整流程，包括单位猜测
- 现状：faijs headless 加载 STL 不猜测单位 → 与 3d_editor 渲染路径行为不一致
- 3d_editor 是上层宿主，不应承担底层几何数据的单位推断

### 2.3 注释表述错误（原话一、二、四，已修复）

drill.ts 的注释曾错误描述"STL 从 meter 缩放到 mm"。已在本次会话修正（§1.5）。系统内其它位置（split.ts、runtime.ts）表述为"单位缩放"，无具体单位断言，检查通过。

---

## 3. 架构变更设计

### 3.1 目标

1. `guessStlUnit` / `UNIT_TO_MM` 成为 **faijs 的公共 API**（单一来源）
2. faijs 的 `cad.load`（mesh 路径）加载 STL 时**自动应用单位猜测**，返回的 Shape 为 mm 坐标（与 3d_editor 渲染一致）
3. 3d_editor 从 faijs import `guessStlUnit` / `UNIT_TO_MM`，删除本地实现
4. faijs headless（CLI）与 3d_editor 行为一致

### 3.2 方案对比

#### 方案 A：仅移动纯函数（最小改动）

`guessStlUnit` / `UNIT_TO_MM` 移入 faijs，从 `@faicad/faijs/browser` 导出；3d_editor 改为 import，删本地定义。

- 优点：改动小，1-2 小时
- 缺点：faijs headless 的 `cad.load` 仍不猜单位；两处"应用缩放"的调用点仍分离（3d_editor 在 ModelGroup 缩放几何，faijs 不缩放）
- 结论：只解决"代码重复"，不解决"行为不一致"

#### 方案 B：faijs 的 cad.load 自动猜测并缩放（推荐）

在方案 A 基础上，faijs 的 `importFile`（mesh/io.ts）内部增加单位猜测：

```
STL 字节 → STLLoader.parse() → BufferGeometry → 计算 bbox → guessStlUnit
        → 非 mm 时 scale(s,s,s) → geoToManifoldMesh() → Shape（mm 坐标）
```

- faijs headless 行为与 3d_editor 渲染一致（同一启发式、同一输入 → 同一缩放）
- 3d_editor 的 `partTransform.scale` 机制**保留**（渲染几何居中偏移仍由 position 桥接；scale 仍用于 drill/split 的参数换算），但 scale 的来源由 3d_editor 的 ModelGroup 与 faijs 各自计算——两者输入相同（同一 STL 字节），结果必然一致，无需传递
- 需要同时导出 `guessStlUnit`（供 3d_editor 渲染路径使用，避免重复实现）
- 优点：彻底解决行为不一致；faijs 独立可用
- 缺点：`importFile` 需新增 bbox 计算与缩放（约几十行）；需确认 `geoToManifoldMesh` 输入为 BufferGeometry 时可安全缩放

#### 方案 C：faijs 返回 { shape, scale } 由宿主应用

`importFile` 返回 `{ shape, scale }`，3d_editor 拿到 scale 后自己缩放渲染几何。

- 优点：单一事实来源（scale 由 faijs 算出）
- 缺点：改动面大（Shape 返回类型、所有 cad.load 调用点）；3d_editor 渲染与 faijs 运算仍然分离，只是 scale 计算集中
- 结论：收益与成本不成比例

### 3.3 推荐：方案 B 实施步骤

**阶段 1：移动纯函数到 faijs**
1. 在 faijs 新建 `src/ops/unit-guess.ts`：迁移 `UnitSystem`、`UNIT_TO_MM`、`guessStlUnit`（含 JSDoc，按用户原话描述语义：STL 无单位、系统猜测、默认 mm）
2. 从 `src/mesh/index.ts` / `src/index.ts` / `src/browser.ts` 导出
3. 3d_editor：`file-formats.ts` 删除本地 `guessStlUnit` / `UNIT_TO_MM` 定义，改为 `import { guessStlUnit, UNIT_TO_MM } from '@faicad/faijs/browser'`（`UnitSystem` 类型随迁）
4. 3d_editor 侧测试 `file-formats.test.ts` 的 guessStlUnit 用例迁移到 faijs（或保留为对 faijs 导入的断言）

**阶段 2：faijs 的 cad.load 自动猜测**
5. `src/mesh/io.ts` 的 `importFile`：STL 分支在 parse 后 `computeBoundingBox()` → `guessStlUnit` → 非 mm 时 `geo.scale(UNIT_TO_MM[guessed])` → 再 `geoToManifoldMesh`
6. 补充 faijs 测试：构造 0.1m 立方体 STL 字节 → load 后 bbox 应为 100mm；1 英寸立方体 → 25.4mm；20mm 立方体 → 不缩放

**阶段 3：清理与验证**
7. 运行 faijs 全量 CI（`pwsh scripts/ci.ps1`）
8. 3d_editor 侧回归：STL 导入尺寸、drill/split 在 STL 源上的坐标换算（依赖 `partTransform.scale` 的既有测试 `script-engine.test.ts:1457+`）
9. 检查系统内注释表述统一为"系统猜测 STL 单位"语义（§2.3）

### 3.4 边界与风险

| 风险 | 缓解 |
|------|------|
| 3d_editor 的 `file-formats.ts` 中 `UnitSystem` 被多处引用（exporters、snapshot-io 等） | 阶段 1 中确认引用点，类型从 faijs re-export 或保留本地类型定义（仅逻辑迁移） |
| `geoToManifoldMesh` 对缩放后 BufferGeometry 的兼容性 | 阶段 2 前先验证（缩放只改 position 属性，index 不变，预期无碍） |
| faijs 与 3d_editor 的 guessStlUnit 输入不一致（3d_editor 用 clone 后含矩阵的 geo，faijs 用原始 parse 结果） | 同一 STL 字节的原始 bbox 一致；3d_editor 的 matrixWorld 应用于缩放之前（ModelGroup.tsx:429-430），需核对顺序 |
| 既有 STL fixture 测试（csg.test.ts 的 loadStlFixture 等）预期 bbox 变化 | 阶段 3 回归时逐一核对；这些测试走 3d_editor 本地加载路径，若 3d_editor 仍用本地逻辑则不受影响 |

### 3.5 不做的事

- **不合并** 3d_editor 的 `formatLoaders.ts` 与 faijs 的 `mesh/io.ts`：输出格式不同（THREE.Mesh vs Shape），职责不同（渲染 vs 运算），重复的只是 STL 解析这一步，由 Three.js 单一库承载，不需要消除
- **不改变** `partTransform` 契约（position + scale 桥接机制继续有效）
- **不引入** OCCT 加载 STL：维持现状（Three.js STLLoader 双路径）

---

## 4. 验收标准

1. `guessStlUnit` / `UNIT_TO_MM` 在 faijs 有唯一实现，3d_editor 无本地重复定义
2. faijs `cad.load` 加载 STL 后返回的 Shape bbox 为 mm 坐标（猜测非 mm 时已缩放）
3. faijs CLI（`npx tsx scripts/faijs-cli.ts run`）加载 STL 与 3d_editor 渲染尺寸一致
4. 系统内无"STL 从某单位转换为另一单位"的错误表述
5. 两个项目的 lint/typecheck/测试全绿