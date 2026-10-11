# 同心圆嵌套失败修复计划（curve2d `intersectLineCircle`）

- 日期：2026-10-11
- 影响仓库：`faijs`（核心 `@faicad/faijs` / `packages/core`）
- 关联项目：`faijs-freecad`（FCStd→fai.js 翻译器）、`fcstd-port`（parity 验证）
- 状态：**已实施并端到端验证**（几何与 truth 吻合 ~3.6e-14）；提交待全量测试基线确认

## 1. 问题（已实证，非假设）

`fcstd-port` parity：pass 707 / fail 1135 / no-truth 437 / no_faijs_geometry 923。
fail 桶含 mech_b 293 个"+1 额外实体"——fai.js 比 truth 多产 1 个 solid。

代表样本 `ISO7092DIN433_M12FlatWasher`（空心垫圈）：
- truth：1 个空心件（solids=1, volume≈362.85, area≈570.20）。
- 当前代码：solids=2, volume≈893.78（= r10 圆柱 + r6.5 圆柱合成）。
  说明"带孔草图挤出"被拆成 2 个实心体，而非 1 个带孔体。

### 根因（逐层实证，已在 fai.js-freecad 用消费 dist 复现）

1. `cad.sketch({geoms:[circle r=6.5, circle r=10]})` → 求解 → `extractContours`
   正确产出 2 个嵌套闭环（各为整圆 arc，`kind:'arc', startAngle:0, endAngle:2π`）——
   **这一步正确，非 bug 源**（见 `faijs-freecad/_diag-extract.mjs`）。
2. `toContourBlueprints` → `profileSegToCurve`：当前 `geometry2d/adapt.ts:110`
   已对整圆特判 `sweep >= 2π - 1e-9 → makeCircle2d`，整圆走真圆——
   **"三点弧退化"旧假设已证伪**，此步也正确。
3. `organiseBlueprints`（`geometry2d/organise.ts:120`）靠 `addContainmentInfo`
   （`organise.ts:72`）→ `Blueprint.isInside`（射线法，`blueprint.ts:191`）判定包含关系。
4. **真根因在 `intersectLineCircle`（`packages/core/src/geometry2d/curve2d.ts:995`）**：
   - 该函数先用解析法算出射线-圆交点 `(px,py)`（**精确落在圆上**），随后用
     `refineParam`（`curve2d.ts:694`，80 样本粗网格）+ 极严二次校验
     `if ((cx2-px)² + (cy2-py)² > tol²·1e6) continue`（`curve2d.ts:885`，阈值≈1e-12）
     丢弃交点。
   - 实证（`faijs-freecad/_diag-linecircle.mjs`）：washer 射线从 `(-6.5,0)`（圆内）
     到 `outsidePointOf` 返回的 `(10.2,10.18)`，解析交点 `(6.274,7.787)` 距圆心
     `10.0000…` 精确在圆上；但 `refineParam` 粗网格返回的邻近参数重算点距交点 0.286，
     超 1e-12 → 交点被丢弃 → `intersectLineCircle` 返回 `[]`。
   - 后果：`isInside((-6.5,0))` 对 r10 外圆误判为 **false** → 同心圆**不被嵌套**
     → `organiseBlueprints` 返回 2 个 FLAT Blueprint → 2 个独立面 → 2 个 solid。

### 证明修复有效（不改变源码，仅临时 patch 消费 dist 验证）

- `_diag-fixproof.mjs`：用"按圆参数域校验交点"的修正版 `isInside` 复算，
  `outer.isInside(innerMid)` 由 false→**true**，`inner.isInside(outerMid)` 仍 false（正确）。
- 临时 patch 消费 dist `curve2d.js` 的 `intersectLineCircle` 后重跑 `_diag-organise3.mjs`：
  `organiseBlueprints` 由 2 FLAT → **1 COMPOUND**（外环 + 1 孔）。
- patch 已还原，未触碰 fai.js 源码。

## 2. 修复方案（最小、正确、无回归）

文件：`packages/core/src/geometry2d/curve2d.ts`，函数 `intersectLineCircle`（约 995-1027 行）。

**删除** line 880-886 风格的 refineParam 二次校验块：
```js
// 删除：
const tCirc = refineParam(cCirc, px, py);
if (tCirc === null) continue;
const [cx2, cy2] = evaluateCurve2d(cCirc, tCirc);
if ((cx2 - px) ** 2 + (cy2 - py) ** 2 > tol * tol * 1e6) continue;
```

**替换为**：用解析交点的真实几何（已在圆上）+ 圆参数域校验：
```js
// 解析交点 (px,py) 精确在圆上；只须确认其落在圆的（可能 trim 的）参数域内。
const ang = Math.atan2(py - circ.cy, px - circ.cx);      // 外圆 basis 角
const tBasis = circ.sense ? ang : -ang;
let tb = tBasis % (2 * Math.PI);
if (tb < 0) tb += 2 * Math.PI;
let inDom;
if (cCirc.kind2d === 'circle') {
  inDom = true;                                          // 整圆：恒在域内
} else {
  // trimmed 弧：tStart/tEnd 已按 basis 角（含 sense）表达
  const lo = cCirc.tStart, hi = cCirc.tEnd;
  inDom = tb >= Math.min(lo, hi) - 1e-9 && tb <= Math.max(lo, hi) + 1e-9;
}
if (!inDom) continue;
```

要点：
- `cCirc` 是传入的原始曲线（可能 `trimmed`），`circ` 是 `unwrapCurve` 后的 basis 圆，二者一致。
- 整圆：`cCirc.kind2d === 'circle'` → 永远接受（修复核心，覆盖 washer/管/环/筒）。
- trim 弧：按 basis 角落在 `[tStart,tEnd]` 校验，正确处理 sense=false（`tBasis=-ang` 与 tStart/tEnd 同一空间）。
- 不再依赖 `refineParam` 粗网格，交点精度由解析解保证（≈机器精度）。
- `refineParam` / `evaluateCurve2d` 在该函数内不再被引用；若全文件再无引用可保留（勿删公共函数）。

### 为什么无回归
- 该改动使 line-circle 交点**更多更准**（此前大量有效交点被误弃）。`isInside`（射线法包含判定）与 `Blueprint.intersects`（相交判定）均受益。
- 唯一行为变化：trim 弧的边界交点判定更严格（按真实域），但此前 refineParam 也未按 trim 域校验（仅按整圆最近点），故不会比现状更差。
- 不改变 line-line / circle-circle / numerical 分支。

## 3. 测试（护栏，防止回归）

在 `packages/core/src/geometry2d/` 下补/扩 unit test（建议 `curve2d.test.ts` 新增 `intersectLineCircle` 用例 + `organise.test.ts` 嵌套用例）：

1. `intersectLineCircle`：射线起点在圆内、终点在圆外 → 必须返回恰好 1 个交点（满圆）。
2. `organiseBlueprints`：两个同心整圆（r6.5 / r10）→ 返回 1 个 `CompoundBlueprint`，`blueprints[0]` 为外环、其余为孔。
3. `Blueprint.isInside`：圆内点→true、圆外点→false、圆上点→false。
4. （可选）trim 弧的 line-circle：交点落域外时不返回。

现有护栏 `sketch-arc-ccw-gotcha.test.ts` 不受影响（改的是相交，非圆弧 CCW）。

## 4. 落地步骤（授权后执行）

1. 编辑 `packages/core/src/geometry2d/curve2d.ts` `intersectLineCircle`（§2）。
2. 补 §3 单测；`npm run test`（core）确保全绿。
3. 在 `faijs` 仓按 lefthook 门禁提交（`verify-export-jsdoc` / eslint / whitespace / line-ending / `verify-translation-pairing` / `check-lockstep` / `check-ghost-deps`），**严禁 `--no-verify`**。
4. 在 `faijs-freecad` 重建消费 dist（`npm pack` + install 或 symlink），确认消费新构建。
5. `fcstd-port` 端对 mech_b 桶（及全量）重跑 parity，量化净改善：预期 mech_b 293 个 "+1" 大量转 pass；同时暴露其余 fail 桶（另因）。
6. 刷新 `fcstd-port` parity 口径数字（pass/fail/no-truth/no_faijs_geometry）。

## 5. 实施结果（已验证）

- `curve2d.ts` `intersectLineCircle`：整圆直接接受解析交点并 `continue`；trim 弧沿用原 `refineParam` 路径（最小改动，零回归风险）。
- `npm run typecheck`（tsc --noEmit）**0 错**。
- 单测：`packages/core/test/geometry2d/organise.test.ts` 新增
  - `isInside ray-cast is correct against a full circle`（圆内 true / 圆外 false / 边界 false）
  - `concentric full circles → CompoundBlueprint (washer regression)`
  - geometry2d 全套 **88/88 通过**（原 86 + 新增 2）。
- **端到端（真实 OCCT，`rebased-convert-one.ts`）**：

  | | solids | volume | area |
  |---|---|---|---|
  | 修复前 | 2 | 893.7831099463 | 1101.1282250832 |
  | 修复后 | **1** | **362.8539514896289** | **570.199066626561** |
  | truth | 1 | 362.8539514896212 | 570.1990666265476 |

  相对误差 ≈ 3.6e-14（parity 容差 1e-5）→ **通过**。

### ⚠️ 部署坑（务必记住）
`npm install`（本次为补 `earcut`）会重新解析并把 `faijs-freecad/node_modules/@faicad/faijs`
打回**发布版**，覆盖同步进去的修复 dist。验证命令：
`grep -c "cCirc.kind2d === 'circle'" <...>/dist/geometry2d/curve2d.js` 须为 1。
任何 `npm install` 后必须**重新同步 dist 再复测**。

## 7. 追加：trim 弧推广（2026-10-12 实证）

§5 的最小改动只覆盖整圆（`kind2d==='circle'`）。全量复测暴露 trim 弧同样受害，
故按 §2 原设计推广。

### 实证（faijs-freecad）

样本 `Mechanical Parts/Profiles EN/EN10219 Rectangular Hollow Sections/
Rectangular hollow section 100x50x6.3 EN10219 S235JRH.FCStd`（矩形空心型材）：

- 发射形态：单个 `cad.sketch`，16 个 geom = 内圆角矩形 4 line + 4 arc(r=6.3)
  + 外圆角矩形 4 line + 4 arc(r=9.45)。
- `extractContours` **正确**产出 2 个闭环（bbox 内 x[-18.7,18.7] / 外 x[-25,25]）。
- `profileSegToCurve` 后 curve 类型为 `line` + **`trimmed`**（非 `circle`）。
- `organiseBlueprints` 返回 **2 FLAT**；`isInside` 双向均 **false** → 不嵌套 → 2 实体。
  对应 parity 判定 `solids(1vs2)`（truth 1 空心件，fai.js 2 实心体）。
- 诊断脚本：`faijs-freecad/_diag-nest.mjs`（从真实 fai.js 提取 geoms → solve →
  extractContours → Blueprint → organise 的端到端探针）。

### 规模（fcstd-port 基线 verdicts）

solids-fail 681 按方向拆分（`solids(<truth>vs<faijs>)`）：

| 方向 | 数量 | 说明 |
|---|---|---|
| fai.js **多于** truth | 328 | 孔未嵌套 → 多实体。垫圈 98（整圆，§5 已修）+ 其余 ~230 多为矩形/方形空心型材等 **trim 弧**轮廓 |
| fai.js **少于** truth | 353 | 欠产出（多终端导出不全 / 零件丢失），**与本次根因无关**，需另案诊断 |

故 trim 弧推广的目标增量约 **230** 个，远大于整圆的 98。

### 方案

`intersectLineCircle` 内：取 basis 圆（整圆自身，或 `trimmed.basis` 为圆），
令 `ang = atan2(py-cy, px-cx)`、`tBasis = sense ? ang : -ang`；
- 整圆 → 恒接受（§5 已有）；
- trimmed → 用 `tBasis` 落在 `[tStart, tEnd]` 判定（模 2π 归一化后与 span 比较），
  **替代** `refineParam` 粗网格距离复检。

basis 非圆（ellipse / bezier / bspline 的 trimmed）继续走原 `refineParam` 路径，不动。

## 6. 范围与不确定性（诚实披露）

- 本修复**只解决"同心整圆不被嵌套"这一类**。1135 fail 是多种根因的合集；本修复预期覆盖 mech_b 293 个 "+1" 的全部，并可能外溢吸收同源于"实体数/体积不符"的其他桶，但**不能保证 1135→0**。
- 修复后须以 parity 重跑的实测数字为准，不得外推。
- 不动 faijs-freecad 驱动层（其 `isSubtractiveFeature` 修复对真实 union 漏减性仍正确，但与本类无关）。
