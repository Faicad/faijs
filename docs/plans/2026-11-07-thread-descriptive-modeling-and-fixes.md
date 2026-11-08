# 螺纹能力完善：描述性建模 + 缺陷修复方案（2026-11-07）

- 状态：**方案（未实施）**
- 范围：**仅 BREP 链**——mesh 链冻结：不新增能力、不修复缺陷、不写新测试（用户指令原文见 §0，决策 D8）
- 基线：2026-11-07 代码复核（6 个螺纹相关测试文件 55 用例全绿：`fai-drill-tapped` / `fai-drill-tapped.mesh` / `fai-drill-pipe` / `pmi-thread-hole` / `pmi-thread-e2e` / `threadFns`；其中 `fai-drill-tapped.mesh` 属 mesh 冻结基线，仅要求不红）
- 本文以**当前代码**为现状依据；历史 plans 文档不作为现状依据

## 0. 用户原始需求

> 「给我写一份文档，完善螺纹相关的能力。首要的是支持描述性建模，比如M16螺纹孔, 应该就可以了。什么都没有，就是通孔。不应该强制调用方写什么screwSpecIdx。然后是你提到的问题，从简单和容易处理的开始。」

> 「最后我要强调一下，mesh链路给我忽略，未来不再维护，只支持brep。文档里写清楚。」

> 「此外，我希望给ai看的api不暴露底层的原有的screwSpecIdx这套api。让ai写代码的时候，直接用M*这样的语义api。所以自动生成的jsdoc要考虑这一点。」

> 「此外，要能解析常见的组合，比如'M4 X 0.7 - 6H'这类的。这类就是带pmi的。如果是'M4 X 0.7'，则没有pmi。带上'↧ 18'则自动是深度18.」

拆解为两条主线 + 两条范围/可见性铁律：

1. **描述性建模**：`thread: 'M16'` 一个键即完整规格；不给 depth 就是通孔；不给 diameter 按规格表反算底孔；描述串支持完整图纸标注组合（公差等级后缀 + 深度后缀，§3.2/§3.3）——**串内带公差后缀（或显式 `threadClass`）才产出 PMI**。调用方**不写 `screwSpecIdx`**。
2. **缺陷修复**：按 2026-11-07 复核结论，从简单易处理的开始，逐项修复。
3. **范围铁律：mesh 链冻结，仅支持 BREP**。本方案一切新增能力与缺陷修复只落 BREP 链；mesh 侧缺陷只登记不修（§4-#5、#7）；既有 mesh 测试仅作冻结基线（不红即可），不写任何新 mesh 用例。
4. **可见性铁律：AI 面生成文档只暴露语义 API（`thread`/`spec`），不暴露旧三键（`screwSystem`/`screwSpecIdx`/`screwThread`、`screw` 的 `system`/`specIdx`）**。旧键在运行时与 TS 类型中原样保留（存量脚本零修改），但对 AI 可见的自动生成 JSDoc/手册里隐藏（§3.7）。

## 1. 现状基线（代码事实）

- 规格入口是三键组合：`screwSystem` + `screwSpecIdx` + `screwThread`（`extra/ops/fai_drill.ts:149-172`）。M16 攻丝孔今天要写 `screwSystem:'metric', screwSpecIdx:10, holeType:'tapped'`，"M16"这个人类写法无法直达。
- `fai_drill` 三孔型（simple/screw/tapped）+ `PmiThreadHole` 标注链路已闭环；PMI 走语句血缘注册表跨 op 存活（`api/pmi/registry.ts`）。
- 规格表：metric M2–M24、imperial #4–1"、pipe PT1/8–PT1/2（`primitives/screw/screw-db.ts`）。
- 已复核缺陷清单见 §4（含两链不一致、custom pitch 双链皆坏、3MF PMI round-trip 断等 13 项）。

## 2. 目标与非目标

### 2.1 目标

1. `cad.fai_drill(part0, { thread: 'M16' })` 可用：通孔、底孔 Φ14（表反算）、无 PMI（串内无公差后缀）。
2. `cad.fai_drill(part0, { thread: 'M4 X 0.7 - 6H' })` 可用：PMI 产出（公差等级 6H 来自串）。
3. `cad.screw({ spec: 'M16', length: 40 })` 可用：不写 system/specIdx。
4. 描述串覆盖 metric（粗/细牙）、imperial（UNC/UNF）、pipe（PT/R），支持公差等级后缀（`-6H`/`-2B`）与深度后缀（`↧18`/`↓18`→`depth:18`）；解析失败显式报错，不静默回落。
5. §4 缺陷按易→难逐项修复，每项带防回归测试。

### 2.2 非目标

见 §8（锥管/NPT 几何、STEP 螺纹 PMI、外螺纹 PMI、helix/thread 的 mesh 实现等——均单列后续）。

## 3. 设计：描述性螺纹规格

### 3.1 键名（D1）

| op | 新键 | 理由 |
|---|---|---|
| `fai_drill` | `thread: 'M16'` | `thread` 键空闲；与用户心智「M16螺纹孔」直接对应 |
| `screw` | `spec: 'M16'` | `screw` 的 `thread` 键已被牙型枚举（'coarse'/'fine'/'custom'/'none'）占用，语义不可复用；改语义会破坏存量脚本（零修改红线） |

### 3.2 文法（`parseThreadSpec`）

```
metric  := 'M' <dia:number> [('×'|'x'|'X') <pitch:number>] ['-' <class>] [('↧'|'↓') <depth:number>]
           // M16、M16×1.5、M4 X 0.7 - 6H、M16-6H、M16-6H↧18
imperial:= ('#'<gauge> | <frac>" | <decimal>") ['-' <tpi>] ['-' <class>] [('↧'|'↓') <depth:number>]
           // 1/4"-20、1/4"-20-2B、#4-40-2B↧10、1/4"（缺省粗牙）
pipe    := ('PT'|'R'|'Rc') <size> [('↧'|'↓') <depth:number>]
           // PT1/8、R1/2（同表别名）、PT1/8↧12（pipe 无公差后缀，给了报错）
```

- **公差等级后缀**：metric `[4-8][GH]`（内螺纹 H 为主，G 为镀层余量）、imperial `1B|2B|3B`；表外（如 `-9Z`）→ `E_THREAD_SPEC`。pipe 不支持公差后缀（`PT1/8-6H` → `E_THREAD_SPEC`）。
- **深度后缀**：`↧`（U+21A7）或 `↓`（U+2193）后跟数值 → **`depth` 参数（孔深）**；与显式 `depth` 同给 → `E_ARG`（§3.3）。
- **空格全容忍**：`'M4 X 0.7 - 6H'` 合法（解析前归一空格）；全角 `×`、大小写 `x`/`X` 等价；`↧`/`↓` 等价。
- 解析结果：`ResolvedThreadSpec`（system / nominalDiameter / pitch / specLabel / pilotDia / toleranceClass? / depth?），与 `fai_drill` 现有 `ResolvedThread` 统一为一个类型（`screw-db` 侧产出，两 op 共用）。
- `specLabel` 输出**规格部分的规范化形式**（不含公差、不含深度）：`'M16'`、`'M16×1.5'`、`'1/4"-20'`、`'PT1/8'`——PMI 直接采用，`formatThreadSpec` 已优先 `specLabel`（`api/pmi/text.ts:34-39`），公差走独立字段 `toleranceClass`，深度走孔参数，显示层零改动。
- 大小写归一（`m16` → `M16`）。

### 3.3 错误与互斥（D3/D4）

| 情形 | 行为 |
|---|---|
| 解析失败（`'M16x'`、`'NPT1/2'`、`'M99'` 表外、`'-9Z'` 公差表外） | `E_THREAD_SPEC` 显式报错（含支持的文法说明），**绝不静默回落** |
| `thread` 与 `screwSystem`/`screwSpecIdx`/`screwThread` 同给 | `E_ARG`（防歧义，禁止静默优先级） |
| 串内 `↧18` 与显式 `depth` 同给 | `E_ARG`（同一事实两个来源，禁止隐式优先级） |
| 串内 `-6H` 与显式 `threadClass` 同给 | `E_ARG`（同上） |
| `thread:'M3'` + `holeType:'tapped'` 同给 | **合法**——语义同向，与缺省一致，等同不写 `holeType` |
| `thread:'M3'` + `holeType:'screw'` 同给 | **合法**——建模螺纹，底孔按表反算 |
| `thread` + `holeType:'simple'` | `E_ARG`（规格对光孔无意义） |
| `thread:'PT…'` + `holeType:'screw'` | 沿用既有「锥管牙型未实现」报错（`fai_drill.ts:203-208`） |
| `thread:'PT1/8-6H'`（pipe 带公差后缀） | `E_THREAD_SPEC`（§3.2：pipe 不支持公差后缀） |

**PMI 产出规则（描述串路径）**：描述串就是图纸标注语法——**串内带公差等级后缀（`-6H`），或调用方显式给出 `threadClass` 参数，才产出 `PmiThreadHole`**；两者皆无 → 只出几何（底孔），**不产出 PMI**（`'M4 X 0.7'` 即此情形）。描述串路径**不默认 `6H`**。旧三键路径行为不变：始终产出 PMI、metric 缺省 `6H`（既有行为，存量零修改）。

**旧写法原样保留（零修改红线）**：既有三键组合 `holeType:'tapped', screwSystem:'metric', screwSpecIdx:10, screwThread:'coarse'` 的语义与行为**完全不变**——`thread` 是新增的等价描述性入口，不取代三键。上表互斥仅约束**同一次调用**中 `thread` 与三键混用的情形（防歧义）；单独使用任一种写法互不影响。`screw` op 同理：`system`+`specIdx` 旧入口保留，`spec` 为新增入口。

### 3.4 默认值（D2，对齐「什么都没有，就是通孔」）

| 参数 | `thread` 存在时的缺省 | 来源 |
|---|---|---|
| `holeType` | `'tapped'`（"M16螺纹孔"的默认语义=攻丝孔；建模螺纹仍需显式 `holeType:'screw'`） | D2 |
| `depth` | `0`（通孔）——即 op 现有缺省，不改；串内 `↧18`/`↓18` 可直接给出（→ `depth:18`，与显式 `depth` 同给报错） | 既有契约 + §3.2 |
| `diameter` | 表反算底孔：metric `dia−pitch`（M16→14）、pipe 表内标准攻丝底孔 | `resolvePilotDiameter` 既有逻辑 |
| `threadClass` | **不默认**：来自串内公差后缀（`-6H`）或显式参数；皆无 → 不产出 PMI（§3.3 规则；imperial 显式时缺省 `'2B'` 仍适用于既有 #4-10 一族，§4-10） | D10 |
| `position`/`direction`/`faceNormal` | 与现状一致（position 缺省原点、direction 缺省 'normal'） | 既有契约 |

显式值永远优先于缺省（`diameter` 给了就用图纸值）——既有规则不变。

### 3.5 实现落点

| 层 | 位置 | 改动 |
|---|---|---|
| 解析器 | 新文件 `primitives/screw/thread-spec.ts` | `parseThreadSpec(spec: string): ResolvedThreadSpec`（纯函数、表驱动、无几何依赖；含公差等级后缀与 `↧`/`↓` 深度后缀解析，§3.2） |
| 规格表 | `primitives/screw/screw-db.ts` | metric 扩到 M64（M30×3.5/M36×4/M42×4.5/M48×5/M56×5.5/M64×6；细牙 2/3/3/3/4/4——标准值）；imperial/pipe 表维持现状 |
| `fai_drill` | `extra/ops/fai_drill.ts` | `resolveThread` 增 `thread` 分支；互斥校验（三键/`↧`vs `depth`/后缀 vs `threadClass`）；缺省 holeType；**PMI 产出条件接线**（串内公差后缀或显式 `threadClass`，§3.3） |
| `screw` | `api/screw.ts` | `spec` 键 → 解析出 system/specIdx/pitch 再走既有路径（BREP 实现零改动） |
| 库面导出 | `src/browser.ts` / `src/index.ts` | 导出 `parseThreadSpec`（与 `getScrewSpec` 等现有导出同批） |
| 生成物 | `gen-symbol-table`、`gen-api-dts`、`gen-ops-api-inventory` | 重跑生成器，收录新参数与新导出 |

描述串解析位于共享参数层，`thread`/`spec` 键的**支持与测试目标仅为 BREP 链**（D8）；mesh 链行为不定义、不承诺、不测试。

### 3.6 生成物与文档同步

- `fai_drill` JSDoc 增 `@param params.thread`（含文法示例）；`screw` JSDoc 增 `@param params.spec`。
- `docs/ops-api-inventory.md` 重跑生成器更新（该生成器已停用、仅手动重生成入口，重生成时按 §3.7 隐藏旧键）。
- 实施落地时按仓库规则在同 PR 附 Agent Note（决策 D1–D9 的留档处）。

### 3.7 AI 面文档可见性：隐藏旧三键，只暴露语义 API

**目标**：AI（写 `.fai.js` 代码的模型）看到的 API 手册/参考里，`fai_drill` 只宣传 `thread: 'M16'`，`screw` 只宣传 `spec: 'M16'`；旧三键不出现，让 AI 自然写出语义 API 而不是被引去写 `screwSpecIdx: 10`。

**AI 面产线（改动落点）**：

| 产线 | 角色 | 改动 |
|---|---|---|
| `scripts/gen-skill-docs.ts` | AI 面手册权威产线（`--emit` 输出被 ai-gateway 消费为 `prompts/partials/all_<kernel>_<version>.md`） | 过滤被标记隐藏的 `@param` 条目；`fai_drill` 的参数面输出 `thread`（含文法示例），不输出 `screwSystem`/`screwSpecIdx`/`screwThread`；`screw` 输出 `spec`，不输出 `system`/`specIdx`（`screw.thread` 牙型枚举保留可见） |
| `packages/core/scripts/gen-api-dts.ts` | 生成 `packages/core/src/mesh/api.d.ts`（内嵌 JSDoc 函数目录，工具/AI 可见） | 同一隐藏约定下过滤旧键的 `@param` 行 |
| `scripts/gen-ops-api-inventory.ts` | 已停用（2026-10-08），仅手动重生成 `docs/ops-api-inventory.md` | 手动重生成时同样遵守隐藏约定 |

**机制（隐藏约定，单一真源）**：旧键的 `@param` JSDoc 行统一标注隐藏标记（实施时定一种并三处一致，候选：`@param` 行内 `@internal` 尾标 / 独立 `@internal` 块标记 schema 键）；`defineOp` 的 args-schema 中旧键同步标记。生成器按标记过滤——**不改 TS 类型、不改运行时**：旧三键在参数接口与运行时校验中原样保留（存量脚本零修改红线），仅从 AI 可见的生成文档面隐去。

**守卫**：新增守卫测试断言生成产物——`gen-skill-docs --emit` 输出含 `thread`/`spec` 与文法示例，不含 `screwSpecIdx`/`screwSystem`/`screwThread`（`fai_drill` 参数面）与 `screw` 的 `system`/`specIdx`；`api.d.ts` 同口径（§6-U14）。防退化：后续任何人给新参数写 JSDoc 时漏标隐藏不会被静默放过。

## 4. 缺陷修复清单（易 → 难排序）

「容易」判据：改动面小、无既有测试基线变化、可独立验证。每项修复**必须**带防回归测试（验证留档铁律）。mesh 侧缺陷标「不修——mesh 链冻结（D8）」：只登记，不修复、不测试。

### Phase 3a：零行为修正（无基线影响）

| # | 缺陷 | 位置 | 修法 |
|---|---|---|---|
| 1 | JSDoc 默认值与代码不符（20 vs 12） | `api/brep-operations/threadFns.ts:46,88` | 注释 `sectionsPerTurn` 默认改为 12 |
| 2 | `ScrewThread` 类型漏 `'custom'`（类型谎言） | `extra/mesh/drill-hole/drill-types.ts:23` | 联合类型补 `'custom'` |
| 3 | `screwPitchCustom` 未进 `fai_drill` JSDoc/参数面 | `extra/ops/fai_drill.ts` JSDoc | 补 `@param`（与 #4 联动） |

### Phase 3b：易修 bug（行为修复，基线影响小）

| # | 缺陷 | 位置 | 修法 |
|---|---|---|---|
| 4 | brep 链 custom pitch 回落粗牙（`threadToPitchMm` 未传 pitchCustom） | `extra/ops/fai_drill.ts:352` | 传入 `params.screwPitchCustom` |
| 5 | mesh 链 custom pitch 硬编码 0 → pitch=0 → 直纹槽非螺旋 | `extra/mesh/fai_drill.ts:94`、`drill-hole/DrillHoleCore.ts` | **不修——mesh 链冻结（D8）**，仅登记 |
| 6 | brep 通孔 screw 螺纹高度硬编码 20mm | `extra/ops/fai_drill.ts:358` | 复用 `computeDrillGeometry` 通孔分支的 bbox 推导高度 |
| 7 | mesh 头高中心补偿用 `spec.dia`（1.0×），实际头高 0.6/0.5×dia → 刀具错位 ~0.2×dia | `extra/mesh/drill-hole/DrillHoleCore.ts:77`、`extra/mesh/fai_drill.ts:77` | **不修——mesh 链冻结（D8）**，仅登记 |
| 8 | imperial 攻丝孔 PMI 无缺省公差等级 | `extra/ops/fai_drill.ts:246-247` | imperial 缺省 `'2B'`（更新 imperial PMI 断言基线） |
| 9 | `handedness` 数据断线：`PmiThreadSpec.handedness` 无产出方（显示层已支持 LH） | `extra/ops/fai_drill.ts` | 增可选参数 `handedness: 'right'|'left'` → 写入 PMI（**仅标注**；几何左旋不在本期） |

### Phase 3c：交换链修复

| # | 缺陷 | 位置 | 修法 |
|---|---|---|---|
| 10 | `threemf-pmi.ts` 死代码：`serializePmiFor3mf`/`parsePmiFrom3mfMetadata` 零调用方；导出侧手写同款 XML（两处真源） | `brep/export/export-model.ts:451`、`mesh/threemf-pmi.ts` | 导出侧改调 `serializePmiFor3mf`（单一真源） |
| 11 | 3MF PMI round-trip 断：导入侧不回读 `faijs:pmi` | 3MF 加载链路 | 接线 `parsePmiFrom3mfMetadata` → 挂到载入 Shape 的 `pmi` 字段；round-trip 测试（导出→导入→`pmiThreads` 不丢） |

### Phase 4：BREP 语义修正（基线变更，需回归）

| # | 缺陷 | 位置 | 修法（仅 BREP 链） |
|---|---|---|---|
| 12 | brep 链 `tolerance` 未生效：mesh 孔径 +0.3mm、brep 名义孔径 → 同参数两链孔径差 0.3mm | `brep/brep-ops.ts:415` | `computeDrillGeometry` 半径 +`tolerance/2`（`tolerance` 参数在 BREP 链生效）；更新既有体积断言 |
| 13 | `cad.screw` brep 外螺纹大径超公称（牙顶伸出 shank 0.6P → M6 大径 Ø7.2；mesh=Ø6） | `api/screw.ts:49-53`、`threadFns.ts:85` | 统一牙型：crest=公称大径、root=公称−2×depth；brep shank 取 root 半径、`threadBrep` 从 root 起牙；大径=公称断言（mesh 侧 0.85 系数不动——冻结） |
| 14 | 两链 `holeType:'screw'` 产出不同的孔：mesh 忽略 `diameter`、按公称径切牙+头腔；brep 切 0.3mm 浅槽、无头腔 | `extra/ops/fai_drill.ts:355-360`、`drill-hole/DrillHoleCore.ts:59-108` | BREP 链定义并修正语义：**底孔 = `diameter`（缺省表反算），牙顶升到公称大径**；brep 侧 `threadBrep` 半径取底孔、牙深取 `(公称−底孔)/2`；`screwHead` 头腔几何单列后续项（mesh 侧不动——冻结） |
| 15 | `mirror` 无 `pmiRemap`：镜像后 `PmiThreadHole.axis`/`PmiNote.anchor` 世界坐标错位 | `api/replicate.ts:477` | 先核 `PmiAffine`（`api/pmi/affine.ts`）是否支持反射（det=−1）；不支持则先扩展 affine 再登记 `mirror` 的 `pmiRemap`；镜像 round-trip 测试 |

## 5. 实施顺序与验收判据

| 阶段 | 内容 | 验收 |
|---|---|---|
| Phase 1 | §3 描述性建模主线（解析器 + 表扩充 + 两 op 接入 + 生成物；仅 BREP 链为支持面） | 验收用例见 §6-U1~U2、U4~U6、U12~U16 |
| Phase 2 | §4-1~4、6、8~9（3a/3b 易修项；#5/#7 mesh 冻结不修） | 每项独立防回归测试；既有 55 用例不红（#8 允许更新 imperial PMI 断言；mesh 用例为冻结基线） |
| Phase 3 | §4-10~11（交换链） | 3MF PMI round-trip 测试绿 |
| Phase 4 | §4-12~15（BREP 语义修正，逐项独立提交、可回滚） | BREP 语义测试（§6-U7~U9）；受影响基线同步更新 |
| 收尾 | lint / typecheck / doc-sync / 生成器重跑 | 全绿后跑**一次** `scripts/ci.ps1`；CI 红的测试只针对性重跑 |

顺序理由（D7）：描述性建模是用户首要诉求且不依赖缺陷修复，先落地即可用；易修项紧随其后扩大可用面；基线变更项影响存量断言与 `../3d_editor` 消费面，放最后逐项隔离。

## 6. 测试计划

| 用例 | 断言 |
|---|---|
| U1 `thread-spec.test.ts` | `M16`/`M16×1.5`/`m16x1.5`/`1/4"-20`/`#4-40`/`1/4"`/`PT1/8`/`R1/2` 解析正确；组合形式 `'M4 X 0.7 - 6H'`/`'M16-6H↧18'`/`'1/4"-20-2B↧10'` 解析正确（class/depth 各归其位，`specLabel` 不含公差与深度）；`NPT1/2`、`M99`、`'M16x'`、`'-9Z'`、`'PT1/8-6H'` → `E_THREAD_SPEC`；`specLabel` 规范化 |
| U2 brep e2e | `fai_drill(thread:'M16')`：通孔、底孔 Φ14、体积/面数与同径 simple 一致；**无 PMI**（串内无公差后缀，§3.3 规则） |
| U3 | **取消——mesh 链冻结（D8）**，不写 mesh 用例 |
| U4 互斥与合法组合 | `thread`+`screwSpecIdx` → `E_ARG`；`thread`+`holeType:'simple'` → `E_ARG`；`thread:'M3'`+`holeType:'tapped'` → **合法**（等同缺省）；`thread:'M3'`+`holeType:'screw'` → **合法**；`thread:'PT1/8'`+`holeType:'screw'` → 锥管报错 |
| U5 盲孔 | `thread:'M16-6H', depth:24, threadDepth:20` → PMI `M16-6H ↓20（底孔 Φ14 ↓24，攻丝）`（`depth:24` 显式、串内无 `↧`，合法） |
| U6 screw op | `screw({spec:'M16', length:40})` BREP 链产出公称 Ø16 |
| U7 `tolerance` 生效（#12 后，BREP） | `tolerance:0.3` → BREP 孔径=名义+0.3；缺省 → 名义孔径 |
| U8 牙型（#13 后，BREP） | `cad.screw` BREP 大径=公称 ±0.05；体积在容差带内 |
| U9 screw 孔语义（#14 后，BREP） | BREP 链 `holeType:'screw'`：底孔=表反算值、牙顶到公称；custom pitch（#4 后）螺旋螺距正确 |
| U10 round-trip（#10/#11 后） | 3MF 导出→导入 `pmiThreads` 逐字段不丢 |
| U11 mirror（#15 后） | `mirror` 后 `PmiThreadHole.axis` 重映射正确 |
| U12 旧入口等价 | 既有三键写法行为不变（回归面兜底）；三键 M16（`screwSystem:'metric', screwSpecIdx:10, screwThread:'coarse'`）与 `thread:'M16'` 解析出同一 `ResolvedThreadSpec`（system/specIdx/pitch/specLabel 逐字段相等） |
| U13 合法组合（§3.3） | `thread:'M3'`+`holeType:'tapped'` 等同缺省；`thread:'M3'`+`holeType:'screw'` 建模螺纹 |
| U14 AI 面可见性守卫（§3.7） | `gen-skill-docs --emit` 输出含 `thread`/`spec` 与文法示例，不含 `screwSpecIdx`/`screwSystem`/`screwThread`（fai_drill 面）与 `screw` 的 `system`/`specIdx`；`api.d.ts` 同口径 |
| U15 PMI 组合语义（§3.3 规则） | `thread:'M4 X 0.7 - 6H'` → PMI `standard:'metric'`、`specLabel:'M4×0.7'`、`toleranceClass:'6H'`；`thread:'M4×0.7'` → **无 PMI**；`thread:'M4×0.7'` + 显式 `threadClass:'6H'` → PMI 产出（公差来自显式参数） |
| U16 深度后缀互斥（§3.3 规则） | `thread:'M16-6H↧18'` → `depth=18` 盲孔 + PMI；`thread:'M16↧18'` + `depth:20` → `E_ARG`；`thread:'M16-6H'` + `threadClass:'7H'` → `E_ARG` |

回归面：既有 6 个测试文件 55 用例（`fai-drill-tapped.mesh` 等 mesh 用例为冻结基线，仅要求不红）；`test/api/pmi/pmi-export-wiring.test.ts`；`export-model` 相关测试。

## 7. 风险与已知边界

| 风险 | 应对 |
|---|---|
| #12/#13/#14 改变既有 BREP 几何基线（体积、面数、STEP 输出） | 逐项独立提交；基线更新与代码同 commit；`../3d_editor` 消费面同步检查（`fai_` op 变更警戒） |
| #14 头腔语义（`screwHead`）：BREP 链现无头腔几何 | 本期先落「底孔+牙」核心语义；`screwHead` 头腔几何单列后续项并登记 |
| #15 `PmiAffine` 反射支持未核实 | 实施首步先写 affine 探针测试（det=−1 的 compose/remap），结论落测试后再动 `mirror` |
| 规格表扩充引入笔误风险 | 表值逐项对照 ISO 261/ISO 262 标准值写进 U1 断言 |
| 描述串与既有 `screwThread` 键名易混淆 | JSDoc 明示分工：`thread` 是**规格**（'M16'），`screwThread` 是**牙型**（'coarse'）；`thread` 存在时后者禁用 |
| mesh 链冻结后，调用方在 mesh 模式遇到已登记缺陷（#5/#7）无修复路径 | 文档与 JSDoc 明示 BREP-only 支持面；mesh 行为不定义不承诺（D8），不做静默兜底 |
| 描述路径「无公差后缀 → 无 PMI」与旧三键路径「始终 PMI + 缺省 6H」语义不同（D10），调用方可能混淆 | JSDoc 与文法示例写明产出条件（`-6H` 后缀或显式 `threadClass`）；U15/U16 锁死两侧行为；PMI 产出差异在测试与文档如实呈现，不假装一致 |

## 8. 明确不做（后续单列）

1. 锥管牙型几何（1:16 锥度）与 NPT——`pipe` 维持 tapped-only；描述串 `NPT…` 显式报错而非静默。
2. STEP 螺纹 PMI（阻塞在 occt-wasm 无 thread_aspect API）；STEP PMI 导入。
3. 外螺纹 PMI 类型（`PmiItem` 暂只有 `threadHole`）。
4. 几何左旋（`threadBrep.lefthand` 接入 fai_drill/screw 几何路径）——本期 `handedness` 只进 PMI（§4-9）。
5. `count`（4×M6）与孔阵列联动。
6. `helix`/`thread` 的 mesh 实现、`knurl` 的 BREP 实现。
7. fasteners 包参数表与 core `screw-db` 的合并。
8. mesh 链的一切后续开发与修复（含 §4-#5、#7 登记的 mesh 缺陷维持现状）；mesh 侧 `screwHead` 头腔、`rRoot` 0.85 系数等既有行为不动。

## 决策点汇总

| # | 决策 | 理由 |
|---|---|---|
| D1 | `fai_drill` 用 `thread`、`screw` 用 `spec` | `screw.thread` 已被牙型枚举占用，不可复用语义；存量脚本零修改 |
| D2 | `thread` 存在时 `holeType` 缺省 `'tapped'` | "M16螺纹孔"默认语义=攻丝孔（底孔+PMI）；建模螺纹需显式 `holeType:'screw'` |
| D3 | 解析失败/表外 → `E_THREAD_SPEC` 显式报错 | 静默降级比报错危险（项目红线）；表按标准值扩到 M64 |
| D4 | `thread` 与三键互斥、与 `holeType:'simple'` 互斥；与显式 `holeType:'tapped'`/`'screw'` 同给**合法**（语义同向不冲突） | 防歧义；禁止隐式优先级；三键旧写法单独使用不受影响（存量脚本零修改红线） |
| D5 | 描述性路径复用既有 tapped 契约（BREP 链；几何=底孔） | 不引入新语义分叉；#14 修正 BREP 的 screw 孔语义 |
| D6 | PMI `specLabel` 直接用规范化描述串 | `formatThreadSpec` 已优先 `specLabel`，显示层零改动 |
| D7 | 实施顺序=描述性主线 → 易修 → 交换链 → BREP 语义修正 | 用户首要诉求先行；基线变更逐项隔离可回滚 |
| D8 | **mesh 链冻结，仅支持/维护 BREP** | 用户指令 2026-11-07（原文见 §0）：mesh 缺陷只登记不修（#5/#7）；既有 mesh 测试仅作冻结基线；新能力测试目标只有 BREP |
| D9 | AI 面生成文档隐藏旧三键（`screwSystem`/`screwSpecIdx`/`screwThread`、`screw` 的 `system`/`specIdx`），只宣传 `thread`/`spec` 语义 API | 用户指令 2026-11-07（原文见 §0）：AI 写代码直接用 `M*` 语义 API；TS 类型与运行时不变（存量脚本零修改），仅生成文档面隐藏（§3.7） |
| D10 | **描述串 = 图纸标注语法**：公差等级后缀（`-6H`）或显式 `threadClass` 才产出 PMI；皆无 → 只出几何不出 PMI（描述路径不默认 `6H`）；`↧`/`↓` 深度后缀 → `depth`（孔深），与显式 `depth` 同给 `E_ARG` | 用户指令 2026-11-07（原文见 §0 + 两点语义确认）：`'M4×0.7-6H'` 带公差才是标注；`'M4×0.7'` 无 PMI；`↧18`=深度 18；旧三键路径行为不变（始终 PMI、metric 缺省 6H） |
