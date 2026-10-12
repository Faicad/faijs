# STEP 导出 2D 边集合的显式 opt-in 通道——设计计划

> 状态：**方案（未实施）**。日期 2026-10-12。
> 范围：`packages/core` 导出终端选择层（`node-host/cli.ts`、`brep/export/export-model.ts`）+ 回归测试；下游 `faijs-cadquery` smoke runner 一处适配。
> 关联但独立：free-face 缺陷已在 `3b923cd` 实施（compound 内自由面补齐），本文不重复其内容。

## 0. 用户原话（需求最原始内容）

> "到底step是否支持2D 边集合？我说的faijs不支持导出2D，只针对主项目的默认设置。如果其它第三方项目要自己手动导出，且符合step规范，应该支持。"

> "这个free-face 文档应该已经实施了呀。既然它和你前面说的事情无关。请单独写一份方案，处理边的step导出"

## 1. 背景与问题定位

### 1.1 STEP 规范本身支持 2D 边集合

| 几何 | STEP 表达 | 说明 |
|---|---|---|
| 游离面 / 开壳 | `SHELL_BASED_SURFACE_MODEL` + `OPEN_SHELL` | 已验证（free-face 文档 §1 的 ref STEP 即此形态） |
| 边集合 / 线框 | `GEOMETRIC_CURVE_SET`（AP203/AP214）；`EDGE_BASED_WIREFRAME_MODEL`（AP242） | OCCT STEP writer 支持 wireframe 写出 |

⇒ "不导出 2D"是 faijs 主项目的**默认策略**（防止未消费草图从后门写进 STEP 污染 parity area，见 `902699e`），不是 STEP 能力边界，也不应是内核写出口的能力边界。

### 1.2 现状链路：拦截点在哪（已对 2026-10-12 源码核验）

```
脚本终端（terminals）
  └─ cli.ts exportExecutionResult()      ← 拦截点①②都在这里
       ├─ selectExportableTerminals()    （隐藏过滤，includeHidden 先例）
       ├─ isExportableSolid()            ← 拦截点①：FACE/WIRE/EDGE/VERTEX 一律 false；
       │                                    COMPOUND/SHELL 递归查 solid，无 solid = 2D
       └─ solidExportable 为空 → 报 "All N live terminal(s) are 2D (no solid)"
  └─ step.ts exportStepFromSolids()      ← 写出口本身**不拦**：
       级联 solid→shell→face→edge + 游离补齐 + 整体兜底，
       注释明确"面/壳/边 compound 同样要能写进 STEP（U22）"
```

**结论：内核写出口已具备边写出能力；缺的只是终端选择层的一个显式放行开关。** 触发现场：`faijs-cadquery` 的 parity smoke 用例 `TestCQSelectors__testShape__res4`（`val(edgeCompound(w,'>Z'))`，纯 2D 边集合导 STEP）被拦截点①拒绝，729/730 中唯一的 FAIL。

### 1.3 为什么复用 `includeHidden` 模式

`cli.ts:471-510` 已有成熟先例：默认过滤 → 显式传参放行 → 明确报错提示"pass includeHidden to export them" → 过滤后**不得回退**。2D 放行走同一形态，行为可预期、语义对称。

## 2. 目标与非目标

**目标**：

1. 终端选择层提供显式 opt-in（`include2D`），开启后 2D 终端（face/wire/edge/vertex 及无 solid 的 compound）可走 STEP 导出；
2. 默认行为零变化（不开关时 2D 依旧被过滤并提示）；
3. 下游（`faijs-cadquery` smoke runner）能对 2D-only fixture 完成合规导出与 parity 比对。

**非目标（硬性红线）**：

- **STL 不在范围内**：STL 是三角网格格式，边集合无网格可言，2D opt-in 仅限 STEP（`--mode brep`）。mesh 链路遇 2D 维持现有报错。
- 不改 free-face 已落地的 step.ts 级联/补齐/兜底逻辑。
- 不改 `includeHidden` 的既有语义；两个开关正交（`includeHidden` 管"谁被看见"，`include2D` 管"什么能落盘"）。
- 不做 fuse、不改 XCAF 多 label 结构（同 free-face 文档红线）。

## 3. 设计

### 3.1 API 面（对齐 includeHidden 先例）

| 层 | 改动 |
|---|---|
| `cliRun` options | 新增 `include2D?: boolean`（缺省 `false`），与 `includeHidden` 并列 |
| CLI flag | `--include-2d`（仅 `--mode brep` + STEP/合法 brep 格式时生效；`--mode mesh` 或 `.stl` 下传入 → 明确报错 `E_MESH_UNSUPPORTED` 语义的提示，不静默忽略） |
| `exportExecutionResult()` | 签名加 `include2D`；过滤逻辑改为 `if (!includeHidden && !include2D)` 才执行 `isExportableSolid` 过滤；`skipped2d` 提示仅在"过滤实际发生"时出现 |
| `export-model.ts` | **实施核验（2026-10-12）：无需改动**。`exportModel/exportModelSync` 以 solid/shape 为输入，不经终端选择层，本身没有 2D 过滤；2D 拦截只存在于 `cli.ts` |
| 错误提示 | 2D 全被拦时，报错文案追加 `pass include2D to export 2D-only results as STEP`（与 includeHidden 的提示同构） |

### 3.2 放行后的写出形态

`include2D` 开启时，2D 终端原样进入 `exportStepFromSolids()`，由既有级联分派：

- edge compound → 命中 `edge` 层（或各层全空时整体兜底单 label）→ XCAF 写出（P1 探针确认具体 STEP 实体形态）；
- face compound / open shell → 已由 free-face 修复覆盖，形态 `SHELL_BASED_SURFACE_MODEL`。

**不新增任何"包装"逻辑**（不把边伪造成面/壳），写出什么就是什么，由 XCAF writer 决定，与 ref 侧（cadquery `Shape.exportStep`）行为对齐。

### 3.3 探针（实施前必做，结论入档冻结为常驻测试）

| # | 命题 | 判据 |
|---|---|---|
| **P1** | XCAF `addShape` 吃 edge compound（box 的 4 条顶边）写出什么 STEP 实体（`GEOMETRIC_CURVE_SET` / `EDGE_BASED_WIREFRAME_MODEL` / 其它） | 记录实际实体形态；确认文本合法、可被 `compareStepFiles` 或其边量级口径读回 |
| **P2** | `compareStepFiles` 对 2D-only STEP 的比对口径：f/e/v 计数能否直接用；体积/质心/bbox 是否需按 2D 语义跳过 | 确定 cadquery smoke runner 对 `res4` 类用例的比对策略 |
| **P3** | `include2D` 开启时混合 compound（shell + 游离边）是否全部落盘 | 级联 + 游离补齐对 edge 层同样生效（free-face 逻辑复用），应全出 |

探针落 `packages/core/test/brep/export/step-edge-2d.probe.test.ts`，正负结论都留常驻断言。

## 4. 实施步骤

| 步骤 | 内容 | 验收 |
|---|---|---|
| T1 | 跑 P1/P2/P3，结论回填 §3.3 | 探针测试常驻 |
| T2 | `cli.ts`：`include2D` 参数 + CLI flag + 过滤逻辑改造 + 报错文案 | 单测：默认拦 2D（回归）、开关放行、mesh/stl 下开关报错 |
| T3 | ~~`export-model.ts` 两处调用点透传~~ 实施核验为无需改动（该文件无终端级过滤，见 §3.1） | — |
| T4 | 门禁：`eslint packages/core/src` + `npm run typecheck` + `verify-export-jsdoc` | 三项全过 |
| T5 | 下游 `faijs-cadquery`：smoke runner 对 2D-only fixture 传 `--include-2d`，比对口径按 P2 结论调整 | `TestCQSelectors__testShape__res4` 由 FAIL 转 PASS，其余 729 用例零翻红 |
| T6 | faijs 家族发版（走 `set-version` 流程）+ cadquery 发版（对齐家族线，peer/dev 依赖同步） | registry 可查、demo e2e 不受影响 |

## 5. 影响面

| 调用方 | 位置 | 说明 |
|---|---|---|
| `node-host/cli.ts` | `:360` `:384` `:471-510` | 拦截点改造主体 |
| `brep/export/export-model.ts` | L1→L2 两处调用 | 透传参数 |
| `packages/demo` | 无 | demo 不开开关，零影响 |
| `faijs-cadquery` tests | smoke runner | 唯一直接受益下游 |
| API 测试覆盖门禁 | `check-api-test-coverage` | 新参数 `include2D` 必须在调用点被覆盖（L2），T2/T3 的测试即为覆盖点 |

## 6. 验收标准

1. 默认行为零变化：不开 `--include-2d`，现有全部 STEP/STL 导出测试零翻红（含 2D 拦截提示文案）。
2. `--include-2d` 下：2D-only 终端合规写出 STEP，P1 探针记录的实体形态作为断言冻结。
3. cadquery parity smoke 730/730 全绿。
4. `--mode mesh` / `.stl` 下传 `--include-2d` 报明确错误，不静默。
5. 门禁全过（eslint / typecheck / verify-export-jsdoc / check-lockstep）。

## 7. 待拍板

1. 开关命名：`include2D` / `--include-2d` 是否认可（与 `includeHidden` 对仗）；
2. §3.1 中"mesh/stl 下传开关报错"的严格程度（明确报错 vs 静默忽略）——本方案取明确报错。
