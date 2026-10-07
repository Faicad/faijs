# 3d_editor 单位系统重构方案（2026-09-28）

**状态：方案（未实施）。faijs 侧 P1–P8 已落地（`@faicad/faijs@0.20.0`），本方案是 3d_editor 侧的对接改造计划。**

**实测基线**：本文档的路径与机制断言均于 2026-09-28 对 `C:/my/Faicad/3d_editor` 当前工作区源码逐条核对。

---

## 1. 背景与用户要求

### 1.1 用户原话

> 「faijs 目前把长度单位定死为 mm，这只是早期为了方便实现而定的，而现在 faijs 必须要能支持单位的设置。faijs 处理的是 3d 模型，单位当然是模型的重要参数之一。」

> 「formatCodeLine/codeToArgs的序列化改造，应当允许传递当前cad系统设置的单位。比如原单位mm，用户设置的系统单位inch，那么要自动换算，用户看到的尺寸是换算后的。且用户可以随时切换单位。」

> 「3d_editor 场景可设单位（mm/inch/米），生成的 faijs 脚本带上单位字面量 `n * UNIT`。」

### 1.2 faijs 已交付内容（`@0.20.0`）

| 交付项 | 位置 | 说明 |
|---|---|---|
| 单位系统核心 | `@faicad/faijs/units` | `UnitSpec`/`ValueWithUnits`/`UNIT_SCALE`/`UNIT_DIM`/`toBase`/`fromBase`/`unitFor`/`UnitContext`/`BASE_UNITS` |
| 脚本常量注册 | `security-scanner.ts` `S4_SAFE_GLOBALS` + `SEC_RESERVED_ASSIGN` | `MM`/`INCH`/`DEGREE`… 只读全局常量 |
| 静态量纲校验 | `metadata-extractor.ts` dimension pass | `E_DIM_BARE_NUMBER`/`E_DIM_MISMATCH` |
| 序列化 | `formatCodeLine(input, opts?)` | `UnitSerializeOptions = { units?, dims? }`；缺省 → 逐字节等价旧行为 |
| 反解析 | `codeToArgs(code, opts?)` + `parseUnitLiteral(text)` | 单位常量正确折叠（不再是 0）；`hasComputedArgs = true` |
| I/O | `importFile(buf, fmt, {unit})` | STL 显式单位；3MF 自动读 `<model unit>` |
| 3MF 解析 | `mesh/threemf-loader.ts` | ZIP → XML → `<model unit>` → mm 基准换算 |

### 1.3 3d_editor 当前状态（实测）

| 位置 | 当前行为 | 问题 |
|---|---|---|
| `config/file-formats.ts:388` `UNIT_TO_MM` | 本地换算表 | 重复真源，应收敛到 `@faicad/faijs/units` |
| `config/file-formats.ts:406` `parse3mfUnit` | 扫前 2048 字节原始 buffer | 对 deflate 压缩的 3MF 恒返回 `'millimeter'`（无效） |
| `config/file-formats.ts:420` `guessStlUnit` | bbox 体积启发式 | faijs 侧已支持 `importFile(buf,'stl',{unit})` |
| `stores/core/engine-store.ts:230,434-449` `unitScaleFactors` | 按文件单位缩放几何 | faijs `cad.load` 返回 mm 基准后无需缩放 |
| `engine/components/renderers/ModelGroup.tsx:425-486,714-730` | `geo.scale.set(...)` 按单位 | 同上 |
| `engine/script-engine/ScriptEngine.ts:1130-1139` `_computePartTransform` | 用 `unitScaleFactors` | 同上 |
| `stores/serialization/undo-registrations.ts:110` | 快照含 `unitScaleFactors` | 一并清理 |
| `engine/features/*.ts`（9 个 feature） | `buildArgs` 传裸 number | 需传 `{ units, dims }` 给 `formatCodeLine` |
| `scene-kernel/src/code/statement-builders.ts` | 调 `formatCodeLine` 无 opts | 需透传 `UnitSerializeOptions` |
| `engine/exporters/index.ts:46` `sourceUnitToScaleFactor` | 本地换算表 | 收敛到 `fromBase` |
| `engine/features/fai_split.ts:45-52` | `rx * Math.PI/180` | **保留不动**（度 → 弧度内核换算，不是重复真源） |

---

## 2. 重构目标

1. **删除 `unitScaleFactors` 桥接**：`cad.load` 返回 mm 基准几何，渲染层不再缩放。
2. **9 个 feature 生成单位字面量**：`buildArgs` → `formatCodeLine(input, { units, dims })`。
3. **D9 参数改名**：`anglesDeg` → `angles`、`depth_mm` → `depth`、`inPlaneAngleDeg` → `inPlaneAngle` 等。
4. **导入单位探测收敛**：删除 `parse3mfUnit`/`UNIT_TO_MM`，引用 `@faicad/faijs/units`。
5. **导出反算收敛**：`sourceUnitToScaleFactor` 内部用 `fromBase`。
6. **系统显示单位设置器**：工程设置加单位选择（mm/inch/米），面板换算，切换幂等。
7. **`sourceUnit` 元数据保留**：文件来源单位与系统显示单位分离。

---

## 3. 详细方案

### 3.1 删除 `unitScaleFactors` 桥接（最大简化收益）

**前提**：faijs `cad.load({ format: 'stl' })` 和 `cad.load({ format: '3mf' })` 现在返回 mm 基准坐标（3MF 自动读 `<model unit>` 并换算；STL 由调用方显式声明 `opts.unit`）。

| 位置 | 改造 |
|---|---|
| `engine-store.ts:230` | 删除 `unitScaleFactors` 状态字段 |
| `engine-store.ts:434-449` | 删除相关读写逻辑 |
| `ModelGroup.tsx:425-486` | 删除 `unitScaleFactors` 计算 |
| `ModelGroup.tsx:714-730` | 删除 `geo.scale.set(...)` 缩放 |
| `ScriptEngine.ts:1130-1139` | 删除 `_computePartTransform` 中的缩放逻辑 |
| `undo-registrations.ts:110` | 从快照字段清单中移除 `unitScaleFactors` |

**注意**：`partTransform.scale` 不删除（仍用于 position 居中偏移），但 scale 值恒为 1（mm 基准 = 渲染世界坐标）。drill/split 中的 `worldToLocalPosition = (worldPos - position) / scale` 逻辑保留，因 scale=1 时退化为纯偏移。

### 3.2 9 个 feature 的 `buildArgs` 改造

每个 feature 需要做两件事：
1. 调 `formatCodeLine` 时传 `{ units, dims }`（`dims` 从 op 的 `paramDims` + `slotMap` 取）
2. 参数名去单位后缀（D9）

#### 3.2.1 feature 清单与量纲声明

| feature | 文件 | 有量纲参数 | 无量纲参数 |
|---|---|---|---|
| `fai_extrude` | `features/fai_extrude.ts` | `length` (length) | — |
| `primitive` | `features/primitive.ts` | `size`(length,vec3)、`radius`(length)、`height`(length)、`r1`/`r2`(length) | `segments`(number)、`center`(vec3,方向) |
| `engrave` | `features/engrave.ts` | `depth` (length) | — |
| `fillet` | `features/fillet.ts` | `radius` (length) | — |
| `chamfer` | `features/chamfer.ts` | 宽度(length)、角度(angle) | — |
| `fai_drill` | `features/fai_drill.ts` | `diameter`(length)、`depth`(length) | — |
| `fai_split` | `features/fai_split.ts` | `offset`(length)、`tenonSideLength`(length)、`tenonSideLengthTolerance`(length) | `normal`(vec3,方向)、`inPlaneAngle`(angle) |
| `knurl` | `features/knurl.ts` | `knurlTextureHeight`(length)、`knurlRefineLength`(length)、`faceCenter`(vec3,length) | `knurlScaleU/V`(无量纲)、`knurlMappingMode`(枚举)、`knurlInvertDisplacement`(bool)、`faceNormal`(vec3,方向) |
| `transform` | `features/transform.ts` | `offset`(vec3,length)、`angles`(vec3,angle) | `factor`(无量纲) |

#### 3.2.2 D9 参数改名清单

| 现名 | 新名 | 影响文件 |
|---|---|---|
| `anglesDeg` | `angles` | `features/transform.ts`、`scene-kernel/code/statement-builders.ts` |
| `depth_mm` | `depth` | `features/engrave.ts` |
| `inPlaneAngleDeg` | `inPlaneAngle` | `features/fai_split.ts` |
| `pressureAngleDeg` | `pressureAngle` | faijs 侧已改（如果涉及 3d_editor 调用） |

#### 3.2.3 改造模式

```ts
// 改造前
const codeLine = formatCodeLine({
  callee: 'fai_extrude',
  positional: [partRef, { length: params.extrudeLength }],
  outputs: ['part1'],
})

// 改造后
import { type UnitContext, type UnitSerializeOptions } from '@faicad/faijs/env-agnostic'

const unitOpts: UnitSerializeOptions = {
  units: projectSettings.units,  // { length: 'inch', angle: 'degree' }
  dims: { byKey: { length: 'length' } },
}
const codeLine = formatCodeLine({
  callee: 'fai_extrude',
  positional: [partRef, { length: params.extrudeLength }],
  outputs: ['part1'],
}, unitOpts)
// 产出: `let part1 = cad.fai_extrude(part0, { length: 10 * INCH })`
```

### 3.3 导入单位探测收敛

| 函数 | 改造 |
|---|---|
| `parse3mfUnit` (`file-formats.ts:406`) | **删除**。faijs 3MF 解析已自动读 `<model unit>` 并换算到 mm 基准 |
| `UNIT_TO_MM` (`file-formats.ts:388`) | **删除**。换算引用 `import { UNIT_SCALE, toBase } from '@faicad/faijs/units'` |
| `guessStlUnit` (`file-formats.ts:420`) | **保留**启发式猜测，但内部换算改用 `@faicad/faijs/units`；猜测结果传给 `cad.load({ format: 'stl', unit })` |
| `guessGlbUnit` (`file-formats.ts:436`) | **保留**，仅兼容路径，待定 |

**注意 `UnitSystem` 类型**：3d_editor 本地定义的 `UnitSystem` 与 faijs 的 `UnitName` 有命名差异（`'millimeter'` vs `'mm'`）。收敛时需要做一层映射或直接迁移到 `UnitName`。

### 3.4 导出反算收敛

`engine/exporters/index.ts:46` 的 `sourceUnitToScaleFactor` 保留（导出时按 `sourceUnit` 反算），内部换算表收敛到 `fromBase`：

```ts
// 改造前
const scale = UNIT_TO_MM[sourceUnit]  // 本地表

// 改造后
import { fromBase } from '@faicad/faijs/units'
const scale = fromBase(1, sourceUnit, 'length')  // 1 base mm → sourceUnit value
```

### 3.5 系统显示单位设置器（新增）

#### 3.5.1 工程设置

- 工程元数据新增 `units: UnitContext`（缺省 `{ length: 'mm', angle: 'degree' }`）
- 存入工程序列化（不进 faijs，D10.1）
- 设置面板提供 mm/inch/米 三选项（角度固定 degree，不暴露 radian 切换）

#### 3.5.2 面板换算

- 各 panel 长度/角度输入框旁显示当前系统单位（如 `10 in` 而非硬编码 `10mm`）
- 读取：`displayValue = fromBase(baseValue, units[dim], dim)`
- 写入：`baseValue = toBase(inputValue, units[dim], dim)`

#### 3.5.3 切换单位

- **只重投影宿主自己生成的行**（用宿主基准参数模型）
- 用户手写的行不改写（混合单位合法）
- 切换后重新 `check()`（验证量纲一致）
- 幂等保证：mm → inch → mm 后文本逐字节一致

#### 3.5.4 label 显示

`hostArgToDisplay`（`@faicad/faijs/env-agnostic`）对 `expr-ref` 直接渲染 `text`，故 `10 * INCH` 天然可显示。feature 内部硬编码单位后缀的文案改为按系统单位渲染。

### 3.6 `sourceUnit` 元数据保留

- `sourceUnit` 作为文件元数据（"这个文件本来是英寸"）保留在快照/工程序列化里
- 供 UI 显示与导出反算用
- **几何层不再承担单位标签**（Shape 不加 unit 字段）
- 与"系统显示单位"区分：`sourceUnit` 是文件来源单位，系统单位是界面显示单位，两者独立

---

## 4. `statement-builders.ts` 改造

`packages/scene-kernel/src/code/statement-builders.ts` 是 `formatCodeLine` 的调用方。需要：

1. `buildAppend` / `buildInsertAt` / `buildReplaceAt` 等**透传** `UnitSerializeOptions`（从宿主注入）
2. 不在共享层硬编码单位——单位上下文由调用方（web script-store / weapp scene-store）从工程设置取

```ts
// 改造前
export function buildAppend(code: string, codeLine: string): AppendResult

// 改造后（可选 opts 透传，缺省 = 旧行为）
export function buildAppend(
  code: string,
  codeLine: string,
  opts?: UnitSerializeOptions,
): AppendResult
```

**注意**：`buildAppend` 接收的是已格式化的 `codeLine`（字符串），`formatCodeLine` 在调用方已完成。`opts` 的透传点在调用 `formatCodeLine` 的 feature 层（§3.2.3），不在 `statement-builders.ts`。`statement-builders.ts` 的改动仅限于 **`codeToArgs` 回填路径**需要透传 `opDims`：

```ts
import { codeToArgs, type CodeToArgsOptions } from '@faicad/faijs/env-agnostic'

export function backfillArgs(codeLine: string, opts?: CodeToArgsOptions) {
  return codeToArgs(codeLine, opts)
}
```

---

## 5. 实施阶段

### S1. 升级 faijs 依赖版本

- `3d_editor/packages/app/package.json`：`@faicad/faijs` 从 `^0.19.0` → `^0.20.0`
- 验证 `faicad-faijs-0.20.0.tgz` 已安装

### S2. 删除 `unitScaleFactors` 桥接（§3.1）

- 删除 4 个位置的 `unitScaleFactors` 相关代码
- 验证 `cad.load` 返回 mm 基准后渲染几何尺寸正确
- 回归：STL 导入尺寸、drill/split 坐标换算

### S3. 9 个 feature + D9 改名（§3.2）

- 按 feature 分批改造 `buildArgs`
- 同步做 D9 参数改名
- 每批改造后跑对应 feature 的回归测试

### S4. 导入单位探测收敛（§3.3）+ 导出反算收敛（§3.4）

- 删除 `parse3mfUnit` / `UNIT_TO_MM`
- `guessStlUnit` 内部换算收敛
- 导出反算用 `fromBase`

### S5. 系统单位设置器 + 面板换算 + 切换重投影（§3.5）

- 工程设置加单位选择
- 各 panel 输入框换算
- 切换单位重投影逻辑
- label 显示按系统单位

### S6. `sourceUnit` 元数据保留（§3.6）

- 确认序列化不变
- UI 显示 sourceUnit

---

## 6. 风险

| 风险 | 判据 | 应对 |
|---|---|---|
| `unitScaleFactors` 删除后渲染尺寸错误 | 导入的 STL/3MF 尺寸不对 | 验证 `cad.load` 返回 mm 基准；3MF 的 `<model unit>` 正确换算 |
| D9 改名后存量脚本断裂 | 用户已有工程的脚本参数名不匹配 | 3d_editor 未正式上线，不做兼容；改名同批做 |
| 角度双重换算 | 45° 变 0.785° | `fai_split.ts:45-52` 的 `* Math.PI/180` 保留不动（内核换算） |
| 系统单位切换非幂等 | mm → inch → mm 文本不一致 | faijs 侧 `formatUnitLiteral` + `parseUnitLiteral` 往返测试已覆盖 |
| `UnitSystem` vs `UnitName` 类型不匹配 | `'millimeter'` vs `'mm'` | 收敛时统一到 `UnitName`，或做映射层 |
| 面板换算精度 | 浮点误差累积 | 用基准值（mm）作为真源，显示值仅做投影 |

---

## 7. 验收清单

- [ ] `unitScaleFactors` 在全仓库无引用（grep 确认）
- [ ] `UNIT_TO_MM` 在 3d_editor 侧无本地定义
- [ ] `parse3mfUnit` 已删除
- [ ] 9 个 feature 的 `buildArgs` 传 `{ units, dims }`
- [ ] D9 参数改名完成（`anglesDeg` → `angles` 等）
- [ ] 工程设置可切换单位（mm/inch/米）
- [ ] 切换单位后脚本文本幂等
- [ ] 导入 STL/3MF 尺寸正确
- [ ] 导出反算正确
- [ ] drill/split 在导入模型上的坐标换算正确
- [ ] `sourceUnit` 元数据在序列化中保留
