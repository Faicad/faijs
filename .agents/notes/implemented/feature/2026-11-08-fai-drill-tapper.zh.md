# Agent Note: `fai_drill_tapper` 双串攻丝孔 op

Status: implemented

[English](2026-11-08-fai-drill-tapper.md) | 中文

## Problem

编辑器从图纸标注创建攻丝孔，而图纸上是**两条独立的串**：底孔标注（`Φ2.5↓12` / `Ø2.5 THRU`）与攻丝标注（`M3-6H↓8` / `PT1/8`）。`fai_drill` 只接受单条描述性螺纹串或显式数字参数——没有一个 op 能原样接收这两条标注串、做交叉校验并产出带 PMI 的攻丝孔。

用户拍板（2026-11-08）：键名为 `drill` + `tap`；**通孔 + 攻丝定深允许**（丝深超过孔深无意义，但丝浅于通孔是正常工艺）；**无公差等级也产 PMI、且绝不补默认公差**（没标注公差的孔就按没标注建模——不发明 `6H`/`2B`）；管螺纹（`PT1/8`）支持。mesh 链冻结，故该 op 仅 BREP。

## Decision

`fai_drill_tapper`（extra/ops/fai_drill_tapper.ts）是 brep-only `defineOp`，经编辑器四件套注册（`op-names.ts` EDITOR_OPS、`editor-ops.ts`、`extra/index.ts`、`api/api-namespace.ts`）。

- **`parseDrillSpec`**（primitives/screw/drill-spec.ts）把底孔串解析为 `ResolvedDrillSpec { diameter, depth（0 = 通）, thru }`，白名单哲学与 `parseThreadSpec` 一致：长度上限、不可见字符拒绝（原文 + NFKC）、NFKC、直径字形映射 `[Ø⌀Φφ∅] → Ø`、CN 关键词（`深n → ↓n`、`完全贯穿 → THRU`）、边缘杂质剥离、**压缩前多数值守卫**（`Ø2.5 10` 绝不并成 `2.510`）、逗号小数、闭字母表 `Ø 0-9 ↓ .`、矛盾显式报错（THRU+↓、THRU+DEEP、↓+DEEP）。
- **共享文本层** `spec-text.ts`：`ThreadSpecError`、长度/不可见/杂质正则、`DEEP_RE`、`THROUGH_RE`、箭头变体（含 `▼` U+25BC）单点存放；`thread-spec.ts` import 并 re-export `ThreadSpecError`，其 CN 替换插在杂质剥离后、`DEEP` 之前。
- **双串交叉校验**（`normalizeTapperParams`）：底孔直径必须 ≥ 螺纹公称大径；THRU 攻丝配盲孔、丝深大于孔深都以 `E_ARG` 拒绝。双串形式拥有派生字段——与串同时显式给出 `diameter, depth, thread, threadDepth, threadClass, holeType, screwSystem, screwSpecIdx, screwThread, screwPitchCustom, tolerance` 任何之一即 `E_ARG`。
- **不补默认公差（用户 Q3）**：内部 `fai_drill` 参数带 `thread: params.tap`，于是 `params.thread !== undefined`，`6H`/`2B` 默认分支永不触发；PMI 无条件产出——该 op 的语义就是攻丝孔。label 沿用 `formatThreadHole`（如 `M3-6H 通（底孔 Φ2.5 通，攻丝）`、`PT1/8 ↓20（底孔 Φ8.7 ↓20，攻丝）`）。
- **通孔 + 定长丝（用户 Q2）** 下游零改动：`buildThreadHolePmi` 本就取 `pilotDepth > 0 ? min(threadDepth, pilotDepth) : threadDepth`。
- **复用优先于重实现**：`fai_drill.ts` 导出五个内部件（`drillBrepPath`、`buildThreadHolePmi`、`faceNormalFrom`、`resolveDirection`、`inwardDirection`）；tapper 构造参数后委托给完全相同的 BREP 路径，几何与同径 `fai_drill` simple 逐位一致（等价测试钉死）。

## Alternatives considered

**合并为单串（`'Ø2.5↓12 M3-6H'`）。** 否决：图纸上就是两条标注；双串与 OCR 读到的内容 1:1 对应，且每条串的文法保持封闭。

**复用 `fai_drill` 的 `normalizeDrillParams`。** 否决：其单串互斥规则（thread vs diameter 等）不适用于两条互释的串；tapper 改为交叉校验，`assertDrillParams` 仅作防御层保留。

**tap 串缺公差时自动补默认公差等级。** 用户否决：PMI 必须如实陈述标注；发明的 `6H` 是静默的几何谎言。

**拒绝通孔 + 攻丝定深。** 用户否决：这是合法工艺；既有 min 分支已能表达。

**mesh 实现。** 不做：mesh 链冻结（2026-11-07）；brep-only `defineOp` 使 mesh 分派天然 `E_MESH_UNSUPPORTED`。

## Consequences

- 22 个核心 BREP 测试（`test/extra/ops/fai-drill-tapper.test.ts`）与 4 个 e2e 测试（`packages/tests` `faijs/tapper/`，brep 模式编辑器运行时 + PMI round-trip）通过；screw 目录（164/164）与 core 全量在 `gen-api-dts` 再生后保持绿。
- CN 关键词与 `▼` 在螺纹、底孔两个文法中都可用；`'Ø2.5 THRU ↓10'` 经闭字母表拒绝（串中 THRU），`'Ø2.5 ↓10 THRU'` 经矛盾检查拒绝——两者皆拒，各有测试钉死。
- `parseDrillSpec`/`ResolvedDrillSpec` 经 `primitives/index.ts` 与 `browser.ts` 再导出（公开面）；symbol table 增至 180 条，`ops-api-inventory` 由 JSDoc 再生。
- GOTCHA 以注释 + 测试保留：对 `throw new ThreadSpecError(` 语句做 `replaceAll` 会把 `fail()` 助手自身改写成自递归——助手那一行必须保持直接 `throw new ThreadSpecError(...)`。
- 仅 BREP 链；mesh 链冻结、未触碰。
