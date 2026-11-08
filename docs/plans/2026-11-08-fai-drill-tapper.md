# 方案：`fai_drill_tapper` —— 双串攻丝钻孔 op

状态：已落地

## 需求（用户原话）

> 很好。现在，我想新增一个op就是fai_drill_tapper,
> fai_drill_tapper的输入必需提供两个字符串，一个是几何上显示的钻孔字符串如'Ø2.5 完全贯穿', 一个是后加工的字符串如'M3-6H 完全贯穿'。

## 语义定位

图纸上的攻丝孔常以双行标注表达：第一行是钻孔（底孔几何），第二行是后加工（攻丝）。本 op 把这对标注直接升为脚本面入口：

- **钻孔串（几何）**：决定实体几何——底孔圆柱（通孔或盲孔），直径、深度以钻孔串为唯一真源。
- **攻丝串（后加工）**：决定螺纹标注——system/规格/螺距/公差等级/螺纹深度，产出 `PmiThreadHole`（`pilot` + `thread` 双段结构，与 PMI 既有形状一一对应）。

与 `fai_drill` 的 `thread` 单串路径的关系：单串路径按表**反算**底孔（M3 → Φ2.5）；本 op 的底孔来自图纸钻孔串，**不反算、显式优先**。几何语义等同 `holeType:'tapped'`（底孔几何 + 螺纹 PMI，不建模牙型实体）。

## op 签名

```js
const p = cad.fai_drill_tapper(part0, {
  drill: 'Ø2.5 完全贯穿',      // 钻孔串（几何唯一真源）——必填
  tap: 'M3-6H 完全贯穿',       // 攻丝串（后加工标注）——必填
  position: [0, 0, 30],        // 与 fai_drill 同一套放置词汇
  direction: 'z',              // 'normal' | 'x' | 'y' | 'z'
  face: faceRef,               // FaceTopoRef（可选，同 fai_drill）
  partIndex: 0,                // compound 成员定位（可选，同 fai_drill）
})
```

不设数值型 `diameter`/`depth`/`threadDepth`/`threadClass` 参数：两串即唯一真源，避免串内-vs-参数双源互斥面（`fai_drill` 已有该互斥矩阵，本 op 从设计上裁掉）。放置参数（`position`/`direction`/`face`/`partIndex`）与 `fai_drill` 完全同构、复用同一实现。

## 文法设计

### 钻孔串（新 `parseDrillSpec`）

```
drillSpec   := 'Ø' <number> [ <depthPart> ]
depthPart   := 完全贯穿 | THRU | THROUGH | ↧<n> | ↓<n> | ▼<n> | 深<n> | <n> DEEP
```

- 直径符号**必写**（防裸数字歧义），枚举等价集：`Ø`(U+00D8)、`⌀`(U+2300)、`Φ`(U+03A6)、`φ`(U+03C6)、`ϕ`(U+03D5)、`∅`(U+2205)——全部映射到规范 `Ø`（OCR/绘图变体，预枚举白名单）。
- `<number>`：mm 小数，继承 OCR 数字层（数字逗号 `2,5`→`2.5`、前导点 `.25`、NFKC 全角）。
- 深度部件缺省 = 通孔（与 `fai_drill`「无 depth 即通孔」一致）。
- **裸数字深度拒绝**（`'Ø2.5 10'` 不合法）：深度必须带关键词，防 `'Ø2.5'` + 蹭进来的数字被误读为深度。

### 攻丝串（复用 `parseThreadSpec`，增量枚举关键词）

既有文法原样（metric/imperial/pipe、`-6H`、`↧n/↓n`、THRU/THROUGH、`n DEEP`），L2 关键词层**新增中文枚举**：

- `完全贯穿` → `thru: true`
- `深<n>`、`▼<n>` → `depth: <n>`

关键词归一发生在字母表守卫**之前**（枚举产生式先替换成 ASCII 关键词，守卫仍闭字母表；任何其他 CJK 字符照旧按码点拒绝）。因 `parseThreadSpec` 是唯一解析器，`fai_drill` 的 `thread` 与 `screw` 的 `spec` 同步获得这些关键词——增量文法，存量脚本零修改。

### 安全边界（逐条沿用 2026-11-08 OCR 白名单）

每串独立执行：≤64 字符（NFKC 前查）、不可见/双向控制字符（原文+NFKC 双查）、闭字母表守卫（同形异码/注入按码点拒绝）、公差等级闭字母表唯一修复（`GH`→`6H`）、自由数字绝不猜测（报错附最近表项建议，绝不自动应用）。钻孔串解析失败同码 `E_THREAD_SPEC`，错误信息标明出自哪一串。

## 语义映射（两串 → 几何 + PMI）

| 目标 | 来源 |
|---|---|
| 几何：底孔直径 | 钻孔串 `Ø<n>`（唯一真源，不按表反算） |
| 几何：底孔深度 | 钻孔串 depthPart（通孔 = `depth 0` 哨兵，盲孔 = 数值） |
| PMI `pilot.diameter` / `pilot.depth` | 钻孔串 |
| PMI `thread.standard`/`nominalDiameter`/`pitch`/`specLabel` | 攻丝串（`parseThreadSpec` 结果） |
| PMI `thread.toleranceClass` | 攻丝串 `-6H`（无则缺省不补——PMI 仍产出，已定案） |
| PMI `thread.depth` | 攻丝串 depthPart；缺省与钻孔深度同深（`fai_drill` 既有缺省规则） |

## 跨串校验矩阵（E_ARG）

| 钻孔串深度 | 攻丝串深度 | 结果 |
|---|---|---|
| 通 | （缺省/通） | 合法：通孔 + 通丝 |
| 通 | 深 n | 合法：通底孔 + 定长丝（`pilot.depth = 0` 哨兵、`thread.depth = n`）——用户定案（2026-11-08），需绕过既有 `threadDepth ≤ depth` 哨兵比较（见实现清单第 2 条） |
| 深 n | （缺省） | 合法：丝深 = n（同深） |
| 深 n | 通/完全贯穿 | **拒绝**：盲孔不可能通丝 |
| 深 n | 深 m≤n | 合法：孔底光底 n−m |
| 深 n | 深 m>n | **拒绝**：丝深超孔深 |

直径硬界：`0 < 钻孔直径 < 螺纹公称大径`，违者 E_ARG（底孔 ≥ 大径无牙可攻）。**不要求**钻孔直径等于表值底孔（图纸是真源；允许偏离表值，只卡硬界）。

## 实现清单

1. `packages/core/src/primitives/screw/drill-spec.ts`——`parseDrillSpec` + 直径符号等价集 + 共享深度关键词（关键词词表从 `thread-spec.ts` 提出为共享层，中文枚举同时进 `parseThreadSpec` L2）。
2. `packages/core/src/extra/ops/fai_drill_tapper.ts`——`defineOp`，**仅 BREP 实现**（D8：新能力不落 mesh；mesh 模式显式 `E_MESH_UNSUPPORTED`）；内部：两串解析 → 跨串校验 → 复用 `fai_drill` 的 tapped 内部路径（显式 `diameter`/`depth`/`threadDepth`/`threadClass` 透传，底孔显式值优先为既有行为）。**通底孔 + 定长丝**（钻孔「完全贯穿」+ 攻丝「深n」）组合：既有 tapped 路径的 `threadDepth ≤ depth` 校验按 `0 = 通孔` 哨兵会拒绝 `threadDepth n > 0 = depth`——该组合需拆出可复用段绕过哨兵比较（PMI 逐字段直构：`pilot.depth = 0`、`thread.depth = n`），盲孔路径校验（`m ≤ n`）原样保留。
3. `packages/core/src/extra/op-names.ts`——`EDITOR_OPS` 增 `'fai_drill_tapper'`（A 组轻量，无重依赖）。
4. `extra/editor-ops.ts` / `extra/index.ts` / `api/api-namespace.ts`——re-export + 命名空间登记。
5. `npm run gen:surface`——symbol table + script-face manifest 再生；`gen-api-dts` / `gen-ops-api-inventory` 按需再生（JSDoc 即文档源）。
6. 写回语义：裸调用 `fai_drill_tapper(part0)` 按结构判定回写（direct-executor.ts:1721 既有规则），实施时验证无需硬编码清单。
7. 文档：JSDoc → `docs/ops-api-inventory.md`/`.zh.md` 再生；双语 Agent Note（implemented/feature/）。
8. 门禁：lint / typecheck / 相关测试 / api-coverage / doc-sync 分步单项全绿。

## 测试方案

- `drill-spec.test.ts`（新）：文法接受/拒绝矩阵、直径符号 6 变体、OCR 数字层、安全 11 类对齐、`'Ø2.5 10'` 裸数字拒绝（GOTCHA）。
- `thread-spec.test.ts`（增）：`完全贯穿`/`深<n>`/`▼<n>` 进 `parseThreadSpec`；关键词先于守卫归一。
- `fai-drill-tapper.test.ts`（新）：通+通/盲+盲（含光底）几何与 PMI 字段逐断言、跨串 E_ARG 矩阵逐行、直径硬界、`E_THREAD_SPEC` 透传（含建议文案）、BREP-only、`position`/`direction`/`face`/`partIndex` 放置、compound。
- `packages/tests/faijs/` 增 1 个 `.fai.js` fixture（双串调用端到端 + PMI round-trip）。

## Alternatives considered

**扩展 `fai_drill` 加 `drill` 键（`thread` + `drill` 双键同给）而非新 op。** 用户明确要新 op；且双串是独立的标注模式（双行标注），独立 op 让 `fai_drill` 参数面保持稳定，互斥矩阵不叠加。

**攻丝串深度映射为孔深（照搬 `fai_drill` `thread` 键的 `↧n`→`depth` 语义）。** 否决：本 op 孔几何由钻孔串全权所有；攻丝串的深度是**有效螺纹深度**（PMI `thread.depth`），双串各管一段才与 PMI `pilot`+`thread` 结构对齐。

**建模牙型实体（`holeType:'screw'` 语义）。** 否决（v1）：用户定位钻孔串为「几何上显示的钻孔」、攻丝串为「后加工」——即底孔几何 + 攻丝标注，正是 `tapped` 语义。

**数值参数与串并开（`diameter` + `drill` 同给等组合）。** 否决：两串即唯一真源，从设计上消灭双源互斥面。

**钻孔直径必须等于表值底孔。** 否决：图纸是真源（挤丝/成型丝底孔偏离表值是真实场景），只卡 `0 < d < 公称` 硬界。

## 已确认决策（2026-11-08 用户拍板）

- **键名**：`drill` + `tap`。
- **通孔 + 攻丝定深**（钻孔「完全贯穿」+ 攻丝「深8」）：**允许**——通底孔上的定长丝，PMI 记 `pilot.depth = 0`（通）+ `thread.depth = 8`；实现绕过既有哨兵比较（盲孔路径的 `m ≤ n` 校验不变）。
- **攻丝串无公差等级**（`'M3 完全贯穿'`）：**仍产 PMI**，`toleranceClass` 缺省不补（本 op 的目的就是攻丝标注；`PmiThreadSpec.toleranceClass` 本就是可选字段）。
- **管螺纹**：**支持**——`parseThreadSpec` 既有 pipe 能力随之开放，同一硬界规则 `0 < 底孔 < 公称大径`。
