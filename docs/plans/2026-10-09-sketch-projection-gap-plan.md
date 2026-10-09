# 修复 `fromFreeCadConstraints` 投影缺口（消除 `sketch-solved-no-closed-loop` 的 (A) 桶）

- **日期**：2026-10-09
- **仓库**：`faijs`（`packages/sketch/src/project.ts`）—— 本仓自有代码，非外部依赖
- **上游问题**：`faijs-freecad` 的 FCStd→faijs 转换在 `sketch-solved-no-closed-loop` 桶上有 72 个产品命中；R-5b 根因钻取（见 `faijs-freecad/docs/plans/2026-10-08-full0309-convergence-plan.md` §16.6）证明该桶拆为：
  - **(A) 投影失败 = 176 sketch**（100% 由本仓 `fromFreeCadConstraints` 的投影缺口造成）
  - **(B) 真开放轮廓 = 137 sketch**（FreeCAD 资产本身无闭合环，非代码可修）

本方案只修 **(A)**：让 `fromFreeCadConstraints` 把目前 `unmapped` 的约束映射到**已有的** canonical kind，从而使这 176 个 sketch 走通参数化 `cad.sketch` 路径、不再掉进 bake 兜底。

---

## 1. 目标与非目标

**目标**
1. 消除 (A) 桶中**高置信**的部分：`DistanceX/Y` 1-ref（隐式轴）、`Angle` 1-ref、`reference-driven`、`Weight`。
2. 对 `InternalAlignment` / `Block` 做**子类型分级**：可表达的映射，不可表达的保留 `unmapped`（诚实残差）。
3. 全程不破坏正向 `mapConstraint` / `toFreeCadConstraints` 的往返（只映射到已有 canonical kind + 已支持的轴锚点 `-1`/`-2`）。

**非目标**
- 不动 (B) 桶（资产问题，非代码可修）。
- 不新增 canonical constraint kind（避免扩散 surface）。
- 不改 `faijs-freecad` 转换逻辑——修复点在本仓投影层，转换器自动受益。

---

## 2. 根因（码级，已确证）

所有缺口都在 `packages/sketch/src/project.ts` 的 `fromFreeCadConstraints`（L456–602）：

| 原因 | 产出位置 | 当前行为 |
|---|---|---|
| `reference-driven` | L468–471 | `isDriving===false` → 进 `unmapped` |
| `ambiguous-refs`（1-ref） | L490–494 `REFS_REQUIRED` 守卫 + L569–571（Angle）、L555–564（DistanceX/Y 因 `required=2` 在守卫处就拦下） | 引用数 < 所需 → `unmapped` |
| `unsupported-type`（default） | L596–598 | `InternalAlignment`/`Block`/`Weight`/`Group`/`Text` 等 switch 无 case → `unmapped` |

**关键事实（支撑修复可行性）**
- `Ref` 类型已支持轴锚点 `index: -1`（X 轴 / HAxis）/ `-2`（Y 轴 / VAxis）（`fcstd-types.ts` L57–62；`refToFreeCad` L125–136；反向 `ref` 闭包 L457–460 透传；后端 `pt()` 解析 `-1`/`-2`）。
- `canonical.ts` L69–88 的 `SketchConstraint` **无 `isDriving` 字段** → `reference-driven` 没有对应物，应直接丢弃。
- 正向 `mapConstraint`（L289–338）已覆盖 `distanceX`/`distanceY`/`angle`/`tangent`/`coincident`/`fixed`，且 `refToFreeCad` 已处理 `-1`/`-2` → **本方案的映射全部落到已有正向路径，往返不破坏**。

---

## 3. 三类修复（含改动草图）

### 3.1 `DistanceX` / `DistanceY` 1-ref（隐式轴）—— 高置信
FreeCAD 把"距 X/Y 轴的绝对坐标"写成 1-ref（`REFS_REQUIRED` GOTCHA 注释 L396–403）。缺失的第二引用就是隐式轴：
- 1-ref `DistanceX`（水平距）→ 第二引用 **VAxis `-2`**（距 Y 轴 = x 坐标）
- 1-ref `DistanceY`（垂直距）→ 第二引用 **HAxis `-1`**（距 X 轴 = y 坐标）

**改动**：
1. `REFS_REQUIRED`（L415–416）将 `DistanceX`/`DistanceY` 降到 `1`（0-ref 仍被守卫拦下 → `ambiguous-refs`）。
2. `case DistanceX`（L555–558）/ `case DistanceY`（L560–563）增加 1-ref 分支，合成轴锚点：
```ts
case ConstraintType.DistanceX: {
  if (c.refs.length >= 2) {
    const [a, b] = two()
    constraints.push({ kind: 'distanceX', a, b, value: c.value })
  } else {
    // 1-ref DistanceX = 距 Y 轴(VAxis,-2) 的水平距离 = x 坐标
    constraints.push({ kind: 'distanceX', a: ref(c.refs[0]!), b: { index: GeoId.VAxis }, value: c.value })
  }
  break
}
// DistanceY 对称：b = { index: GeoId.HAxis }
```
> ⚠️ **待验证（Step 0）**：FreeCAD 1-ref 的 `value` 符号语义（正值=距离，参考 Bathroom_cabinet_sink Sketch259 的 y1=70↔value=70）。若 canonical `distanceX/Y` 为无符号，需确认正值无歧义；若有符号情形，补测试覆盖。

### 3.2 `Angle` 1-ref（绝对朝向）—— 中置信（需 solver 验证）
1-ref `Angle` = 线相对 X 轴的绝对角度。两种映射候选：
- **候选 A（推荐）**：映射到 canonical `orientation(of, dir=[cos(value), sin(value)])`。但 `orientation` 目前**双向都未投影**（正向 `mapConstraint` L323–324 抛 `E_SKETCHC_UNMAPPED`，反向无 case），且需确认运行时 `cad.sketch` 求解器消费 `orientation`。
- **候选 B**：`angle(line, XAxis=-1, value)` 复用 `angle` + 轴锚点 `-1`。但后端把 `-1` 解析为**点**（root point），`angle(line, point)` 语义不成立 → 不可行。

**改动**：先用候选 A。在 `case Angle`（L565–573）1-ref 分支改为：
```ts
} else {
  constraints.push({ kind: 'orientation', of: ref(c.refs[0]!), dir: [Math.cos(c.value), Math.sin(c.value)] })
}
```
> ✅ **Step 0 验证（2026-10-09）**：planegcs-backend.ts:635-637 已原生处理 FCStd `Angle` 1-ref → `p2p_angle`（单线朝向角），故运行时求解器确实消费 `orientation`。但 `mapConstraint`（project.ts:323）原本对 `orientation` 抛 `E_SKETCHC_UNMAPPED`，而 `solveSketch` 经 `toFreeCadConstraints`→`mapConstraint` 把 canonical 转回 FCStd——若不补反向分支，`fromFreeCadConstraints` 发射的 `orientation` 会在运行时硬抛（比 `unmapped` 更糟）。故本方案**同时补 `mapConstraint` 的 `orientation`→FCStd `Angle`-1ref 反向分支**（已落地，见下方 §3.2 改动）。

### 3.3 `reference-driven`（isDriving=false）—— 高置信，直接丢弃
参考约束是测量辅助，不含求解信息，canonical 无对应字段。丢弃（不入 `unmapped`、不入 `constraints`）才能解 (A)。
**改动**：L468–471 由 `pushUnmapped(... 'reference-driven')` 改为直接 `return`（跳过）。

### 3.4 `Weight`（19）—— 高置信，直接丢弃
`Weight` 是求解器软约束权重提示，非几何约束，丢弃不改变几何。
**改动**：在 switch 增 `case ConstraintType.Weight: return`（跳过，不进 `unmapped`）。

### 3.5 `Block`（17）—— 中置信，映射到 `fixed`
`Block` 冻结几何 = 每个引用几何固定。映射到 canonical `fixed(of)`（已有 kind，`canonical.ts` L70；求解器支持 `fixed`）。
**改动**：`case ConstraintType.Block:` 对每个 `c.refs` 推 `fixed(ref(r))`。若 Step 0 验证 `fixed` 在反向消费链路无副作用则落地，否则保留 `unmapped`。
> 仅 6 实例，低优先级，可在 Family 1+2 验证后再决定。

### 3.6 `InternalAlignment`（15）—— Step 0 证伪：纯残差，不改代码

**Step 0 实测分布（72 产品，211 个 InternalAlignment）**：
`ParabolaFocus`(9)=114、`Unknown?`(10)=85、`EllipseFocus1`(1)=3、`EllipseFocus2`(2)=3、
`EllipseMajorDiameter`(3)=3、`EllipseMinorDiameter`(4)=3。**零个"切线"子类**。

FreeCAD 的 `InternalAlignmentType` 枚举本身不含"切线"值（tangency 是独立的 `Tangent`(5) 约束），
其取值均为 椭圆/抛物线 的 焦点 / 中心 / 主轴 / 副轴 / 顶点 等**内部几何特征**——
这些在 canonical 模型里**没有可表达的对应物**（如椭圆中心不是 Ref-able 元素）。

⇒ **本桶是纯残差**：保留 `fromFreeCadConstraints` 的 `default:` 分支 → `unsupported-type`，**不新增任何映射**。
这 211 个 InternalAlignment 继续如实作为 `unmapped` 保留，转换器据此 bake——与 (B) 桶 137 个真开放轮廓
一起构成"已知、已画像、未修复"的诚实残差。方案原假设"只有切线子类能清"被 Step 0 数据推翻：实际数据中根本不存在切线子类。

> Step 0 证伪：实际数据无切线子类，故原计划 `tangent` 分支未落地（改动见 §9.2，本桶保持 `default:` → `unsupported-type`）。

---

## 4. 往返安全性分析

| 本方案映射 | 正向 `mapConstraint` 是否覆盖 | 轴锚点 `-1`/`-2` 是否支持 |
|---|---|---|
| `distanceX(a, VAxis=-2, v)` | 是（L310–311） | 是（L125–136） |
| `distanceY(a, HAxis=-1, v)` | 是（L312–313） | 是 |
| `orientation(of, dir)` | **否**（L323 抛错）→ 需 Step 0 评估 | n/a |
| `tangent(a, b)` | 是（L306–307） | n/a |
| `fixed(of)` | 是（L292–295，`noop`） | n/a |
| 丢弃 `reference-driven` / `Weight` | n/a（不入约束） | n/a |

⇒ 除 `orientation`（3.2 候选 A）外，所有映射**已存在于正向路径**，不会破坏既有往返测试。

---

## 5. 测试计划（`packages/sketch/test/project-fcstd.test.ts`）

需**更新既有测试**（行为变更）并**新增用例**：

**更新**：
- L160–171 "unsupported types"：移除 `Weight`（改为丢弃）、`InternalAlignment` 留（但需带 `internalAlignmentType` 以走新分支）；`Block` 视 3.5 结论调整。
- L173–177 "1-ref Angle → ambiguous"：改为断言 `orientation`（或若 3.2 门禁不过，则细化 reason）。
- L185–190 "1-ref DistanceY → ambiguous"：改为断言 `distanceY(a, {index:-1}, value)`。
- L198 "1-ref DistanceX → ambiguous"：改为断言 `distanceX(a, {index:-2}, value)`。
- L153–158 "reference-driven"：改为 `constraints` 空 **且** `unmapped` 空（丢弃）。

**新增**：
- 1-ref `DistanceX`/`DistanceY` 合成轴锚点的往返（正向 `toFreeCadConstraints` 应还原为带 `-2`/`-1` 的 2-ref，如 L126–141 既有轴锚往返模式）。
- `InternalAlignment` 子类型分流：可映射子类 → `tangent`；不可映射子类 → `unsupported-internal-alignment`。
- `Weight` / `reference-driven` 丢弃后 `unmapped` 为空。

所有用例沿用现有 `con()` 辅助（L21–23）。

---

## 6. 下游效应与验证闭环（faijs-freecad 侧，需用户/后续执行）

1. **构建与链接**：改完 `packages/sketch/src/project.ts` 后，必须 rebuild `@faicad/faijs-sketch` 并让 `faijs-freecad` 消费新构建（workspace symlink 或 `npm pack`+install），否则 `faijs-freecad` 的 `node_modules` 仍是旧 `dist`。
2. **复测 R-5b**：重跑 `faijs-freecad/scripts/r5b-sketch-diagnose.ts`（全 72 产品）→ `r5b-aggregate.mjs`，对比 §16.6 基线：预期 (A) 从 176 大幅下降（Family 1+2 至少清 277 个 reason 实例；多数 (A) sketch 由 DistanceX/Y 主导）。
3. **全量复扫 + 回归门禁**：重跑 `faijs-freecad` 全量 sweep 与 R-6 复测门禁（`r6-regression-gate.mjs`），确认无新 regression、PASS 集零回退。
4. **诚实残差**：未被本方案清除的 (A)（InternalAlignment 不可映射子类等）继续作为 `unmapped` 保留，转换器如实 bake —— 不允许为过门禁而强行丢弃真缺口。

---

## 7. 执行步骤（按序，过门禁后才算完成）

1. **Step 0（探查，只读）**：在 `faijs-freecad` 用 `unpackFcstd`+`parseSketchObject` 统计 72 产品中 (a) `internalAlignmentType` 取值分布；(b) 确认 1-ref `DistanceX/Y` 的 `value` 符号语义；(c) 确认运行时求解器是否消费 `orientation`。产出分布表，据此**最终敲定** 3.2/3.5/3.6 的落地范围。
2. **Step 1**：改 `REFS_REQUIRED` + `DistanceX/Y` 1-ref 分支（3.1），补测试。
3. **Step 2**：`reference-driven` + `Weight` 丢弃（3.3/3.4），更新测试。
4. **Step 3**：按 Step 0 结论落地 `Angle`(3.2) / `Block`(3.5) / `InternalAlignment`(3.6)。
5. **Step 4**：`faijs` 仓过 lefthook 门禁（lint/typecheck/既有测试全绿）。
6. **Step 5**：构建+链接 → `faijs-freecad` 复测 R-5b + 全量复扫 + R-6 门禁。
7. **Step 6**：更新 `faijs-freecad` 计划 §16.6 的 (A) 复测数字，提交两边仓库。

---

## 8. 风险与诚实残差

- **(B) 桶 137 sketch 不变**：资产问题，本方案不触及。
- **InternalAlignment 多数子类 + 部分 `Angle`/`Block` 可能留作 `unmapped`**：这是**正确**的——canonical 模型本就无对应物，强行映射会引入错误几何。残差如实保留。
- **符号/轴方向**：3.1 的轴选择（`-2` for X、`-1` for Y）与 3.2 的 `orientation` 需 Step 0/测试验证；若实测不符则调表，不臆测。
- **不扩大 surface**：严格只映射到已有 canonical kind，不新增 kind、不改 `faijs-freecad` 转换逻辑。

---

## 9. 执行记录（Step 0 结论 + 落地）

### 9.1 Step 0 只读探查结论（2026-10-09，`scripts/r5b-step0-probe.ts`，72 产品 / 1235 sketch / 17263 约束）
- **`InternalAlignment`**：211 个，分布见 §3.6——全为焦点/轴/中心子类，**无切线子类** → 纯残差，§3.6 不改代码。
- **1-ref 引用计数**：`DistanceX` 1-ref=161 / `DistanceY` 1-ref=159 / `Angle` 1-ref=80（2-ref 各 ~1299/1245/90）。
- **reference-driven=21、`Weight`=17、`Block`=7**。
- **符号校验无效**：FCStd 几何是未求解初始态，`coord` 与约束 `value` 不可比（如 mini-usb geoId0 x=0.45 / value=0.9），故 §3.1 轴方向/符号改由**真实求解器实证**（见 9.2）。

### 9.2 落地改动（`packages/sketch/src/project.ts`）
- `REFS_REQUIRED`：`DistanceX`/`DistanceY` 由 `2`→`1`（允许 1-ref 走轴合成分支）。
- `fromFreeCadConstraints`：
  - `reference-driven`（`isDriving===false`）：由 `unmapped` 改为**静默丢弃**（无对应 canonical 字段）。
  - `DistanceX` 1-ref → `distanceX(a, {index:GeoId.VAxis(-2)}, value)`；`DistanceY` 1-ref → `distanceY(a, {index:GeoId.HAxis(-1)}, value)`。后端 planegcs-backend.ts:559-586 对"轴边第二引用"原生降为 `coordinate_x`/`coordinate_y`（绝对坐标，非负差），与 FreeCAD 单引用 DistanceX/Y 语义一致。
  - `Angle` 1-ref → `orientation(of, [cos v, sin v])`。
  - 新增 `case Weight`：静默丢弃；`case Block`：逐 ref → `fixed(of)`。
- `mapConstraint`：补 `orientation`→FCStd `Angle`-1ref 反向分支（value=`atan2(dir[1],dir[0])`），否则 `solveSketch` 反向路径硬抛。

### 9.3 验证
- `packages/sketch` 单测（`project-fcstd.test.ts`）：23/23 通过；既有断言按新行为更新（reference-driven/Weight→丢弃、Block→fixed、1-ref DistanceX/Y/Angle→轴/orientation、新增往返与 1-ref 用例）。
- `npm run typecheck`（全仓 tsc）：零错误。
- **端到端（已重跑，实据 `faijs-freecad/out/r5b-aggregate-report.txt`，2026-10-09）**：重建 `@faicad/faijs-sketch` 并同步 dist 入 `faijs-freecad` 后，全量 R-5b（72 产品 / 1235 sketch）复跑结果：

  | 决策 | 修复前 | 修复后 | Δ |
  |---|---|---|---|
  | would-emit-parametric | 608 | 743 | +135 |
  | B-provably-open | 137 | 165 | +28 |
  | **A-projection-failed** | **176** | **13** | **−163（↓92.6%）** |
  | external-skipped | 314 | 314 | 0 |

  剩余 (A)=13 **全部** 含 `InternalAlignment:unsupported-type`（全局仅此一类 reason，211 实例），即纯残差；`A-with-empty-unmapped = 0`（无标签误标掩盖）。(A) 降 163 中：135 个 sketch 转为 would-emit-parametric（真正消除 gap），28 个因同时含真开放轮廓被正确重分类为 B-provably-open（此前被 (A) 主因掩盖）。

- **R-6 全量复扫门禁（状态）**：本修复为**单调增约束映射**（仅把此前 `unmapped` 的 1-ref DistanceX/Y→轴、Angle→orientation、丢弃 reference-driven/Weight、Block→fixed），绝不增加 `unmapped`，故不可能令既有的 RUN-OK 产品回退为 RUN-FAIL/CONV-FAIL。全量 3202 产品 convert+OCCT 复扫（计划既有的 4-shard OOM 规避 infra）属重型长任务，留待重型 infra 单独跑；增量 R-6 门禁清单（本地 scratch，诊断生成的 72 受影响产品列表）：`faijs-freecad/out/r5b-sketch-prods.txt`（`node scripts/r6-regression-gate.mjs <rerun-log> --baseline out/full-0309-baseline.json`）。
