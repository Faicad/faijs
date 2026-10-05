# CadQuery 移植：`Shape.filter` / `Shape.sort`（λ 传参批次）技术实现方案 —— **已实施（终态）**

> 状态：**已实施并验证**（原为 plan-only，2026-10-05 落地）。命名由用户拍板为「一律带语义后缀」，见 §3.2。
> 上游上下文：`docs/plans/2026-10-03-cadquery-full-port-roadmap.md`（权威路线图，§10.4 N 序列）。本批 = **N3**，执行记录见路线图 §10.4.3。
> 交付物：`filterByPredicate`（= 上游 `Shape.filter`）、`sortByKey`（= 上游 `Shape.sort`）；镜像 `test_special__cf` / `test_special__cs`；3 条 API-op（`eachpoint` 函数形态**未做**，见 §3.3）。

## 0. 结论摘要（先看这段）

1. **「一条 API 解锁 3–5 条」这个前提不成立。** 原判为 **3 条用例、3 个彼此独立的 API**：
   - `test_special__cf` ← 需要 `Shape.filter` → **已交付**（`filterByPredicate`）
   - `test_special__cs` ← 需要 `Shape.sort` → **已交付**（`sortByKey`）
   - `testCompoundCenter__s` ← 需要 **`eachpoint(fcn)` 函数形态**（与 filter 无关）→ **未做**，属独立批次

2. **语言层不需要改。** λ 已被三实验证实可用（§2.4），最终落地走「先存变量再传 + `function` 声明体」（§3.4 解释了为什么**不能**用箭头体）。

3. **内核不需要改。** `iterShapes` / `makeCompound` / `getSubShapes` 都已在 faijs L1 引擎面；`childrenOf` 只是薄封装（§2.3）。

4. **`sort` 命名冲突已由用户指令消解** —— 不再走 A/B/C 三选一，而是「两个新 API 都带语义后缀」：`filterByPredicate` / `sortByKey`（§3.2）。

5. **本批净解锁 = 2 条镜像（cf + cs）+ 2 个公开 op + 2 条 DSL 硬约束的防回归测试。**

## 1. 范围（精确到 case id）

| # | 镜像目标 | 原 `blockedBy` | 所需新 API | ref 度量 | 状态 |
|---|---|---|---|---|---|
| 1 | `tests.test_shapes:::test_special__cf` | `filter` | `filterByPredicate(shape, pred)` | Compound, vol 1.0，topo f6/e12/v8 | **ported**，compare-one 逐位 PASS |
| 2 | `tests.test_shapes:::test_special__cs` | `filter` | `sortByKey(shape, key)` | Compound, vol 36（与 `c` 同） | **ported**，compare-one 逐位 PASS（顺序真值另钉单测，见 §3.2） |
| 3 | `tests.test_cad_objects::TestCadObjects::testCompoundCenter__s` | `eachpoint` | `eachpoint(fcn)` **函数形态** | Compound, vol 0.39269908169872403 | **未做**（独立批次） |

**明确排除**（避免范围蔓延）：

- `test_set_ops__simple_box`（`op:shape-operator-overload`）—— `Compound.__and__/__or__` 运算符重载（G-C19），与 λ 无关。
- `test_cadquery::TestCadQuery::test_map_apply_filter_sort__w` —— 已 ported（镜像只复现导出的 `w`，不跑 filter）。
- `test_sketch::test_filter` / `test_sort`（`test_sketch.py:865/875`）—— **不在 manifest**（无 STEP ref，不入 parity）。**注意**：这三处（`Shape` / `Workplane` / `Sketch`）正是「接收者重名」的实证，也是后缀命名的实质依据（§3.2）。
- `narrow:cutEach` —— 已消解（`testCutEach` 的 3 个变量全 ported）。

## 2. 事实核查（代码级证据）

### 2.1 上游语义（`cadquery` 2.8.0，OCP env）

- `Shape.filter(f)` = `compound(*filter(f, self))` —— `occ_impl/shapes.py:1928`。
- `Shape.sort(key)` = `compound(*sorted(self, key=key))` —— `occ_impl/shapes.py:1932`。
- 迭代单位 = **直接子节点**（`TopoDS_Iterator`），非递归展开 —— `Compound.__iter__`，`shapes.py:1732`。
- `Workplane.filter/sort` 作用在 `self.objects`（对象栈）—— `cq.py:4460` / `cq.py:4490`。
- 用例里的 λ：predicate `lambda x: x.Volume() <= 1`、key `lambda x: -x.Volume()` —— `test_shapes.py:398/401`。
- `compound()` 空参返回**空 Compound**（不是 None）—— `shapes.py:6208-6221`。
- `eachpoint(fcn)` 的 `fcn: Location → Shape`，例 `lambda loc: c.located(loc)` —— `test_cad_objects.py:278`。

### 2.2 faijs 现状（`packages/faijs-cadquery/src/`）—— 落地后

**本批新增**：

- `childrenOf(s)`（`shape-class.ts:374`）—— 唯一新增的迭代 helper：`kern().iterShapes(unwrapShape(s)).map(h => borrowShape(k.getShapeType(h), h))`。
- `filterByPredicate(shape, pred)`（`workplane.ts:5964`）、`sortByKey(shape, key)`（`workplane.ts:5994`）；`index.ts:103/104` 导出。
- `requiredHandle(shape, op)`（`workplane.ts`，本批内部 helper）—— 统一 `brepOf` 解析 + 缺件报错，返回 `ShapeHandle`。

**落地前已存在（本批复用，未改）**：

- Workplane 级组合子：`stackFilter`（`workplane.ts:5868`）、`stackMap`（`5879`）、`stackApply`（`5892`）、`sortStack`（`5909`）；均已导出（`index.ts:99-102`）。
- 类模型：`makeCompound`（`shape-class.ts:298`）、`solids`（`338`）、`wiresOf`（`318`）、`facesOf`（`363`）、`volumeOf`（`621`，**同步**）、`boundingBoxOf`（`612`）、`borrowShape`（`60`）、`unwrapShape`（`69`）、句柄解析 `brepH`（`98`）。
- DSL 层：`compound(...)`（`workplane.ts:5339`）、装配 helper `ownHandle`（`627`）/`toShape`（`630`）/`asBrepShape`（`83`）、`eachpoint`（`4557`，**item 形态**）、`cutEach`（`4511`）。
- `sort`（`workplane.ts:2444`）= **pending-wire 排序**（`'area'|'length'|'x'|'y'`），faijs 特有，**本批未动**（§3.2 说明为什么不必动）。

> ⚠ **行号漂移**：本方案初稿引用的 `volumeOf:600` 已过期，落地时实测为 `621`；`boundingBoxOf:612`。

### 2.3 内核能力（`node_modules/occt-wasm/dist/index.d.ts`）

- `iterShapes(shape): ShapeHandle[]`（:289）—— **精确等于 `TopoDS_Iterator`**。
- `makeCompound(shapes)`（:199）、`getSubShapes(shape, type)`（:271）、`isCompound`（:256）、`getShapeType`（:254）。
- 均已在 faijs L1 引擎面（`brep/engine/types.ts:342` iterShapes、`:356` makeCompound、`:358` getSubShapes）⇒ **零内核改动**。
- `iterShapes` 的「直接 vs 递归」语义已由**探针实测**（`src/shape-children.probe.test.ts`，5 测试）：flat compound → 2 子；nested → 2（**直接子，非递归**）；**普通 solid → 1 个 shell（不是 0）** —— 与 `TopoDS_Iterator` 逐位一致，**无叶子特例**。

### 2.4 阻塞根因：λ 到底卡在哪

三实验（直接跑 CLI）：

| 写法 | 结果 |
|---|---|
| `let pick = (x) => x`（顶层箭头声明） | ✅ PASS |
| `cq.filter(b1, (x) => true)`（内联箭头作实参） | ❌ `unsupported value expression: ArrowFunctionExpression`，抛自 `metadata-extractor.ts:810` |
| `let pick = ...; cq.filter(b1, pick)` | ❌ `__ns.cq.filter is not a function` —— **函数值已穿过全部校验** |

⇒ 本批次是**纯 op 缺口**，不是语法缺口。落地时**又踩到两条新约束**（§3.4），两条都已配双向防回归测试。

## 3. API 设计（终态）

### 3.1 `filterByPredicate(shape, pred)` —— 新增导出

```ts
export async function filterByPredicate(
  shape: Shape | null | undefined,
  pred: (child: CqShape) => boolean | Promise<boolean>,
): Promise<Shape>
```

- 迭代 = `childrenOf(requiredHandle(shape, 'filterByPredicate'))`（直接子节点，非递归）。
- 保留项 → `kern().makeCompound(handles)` → `toShape(...)` 包回 mesh `Shape`。
- **空结果 → 空 compound，不是 `null`**（与上游 `compound(*[])` 一致）。⚠ 落地时修正了初稿：初稿写「返回 `null`」，实测 `makeCompound([])` 合法（vol 0、type `compound`），故改为返回空 compound。
- predicate 收到 **`CqShape`（借用视图）**：`volumeOf`/`areaOf` 经 `unwrapShape` 只识别 `.handle`，传 mesh `Shape` 会静默拿到错误输入。

### 3.2 命名：`filterByPredicate` / `sortByKey`（用户拍板「一律带语义后缀」）

**为什么用带后缀命名（不只是避撞名）**：`filter` / `sort` 在上游各有**三个接收者** —— `Shape.filter/sort`（`occ_impl/shapes.py:1928/1932`）、`Workplane.filter/sort`（`cq.py:4460/4490`）、`Sketch.filter/sort`（`test_sketch.py:865/875`）。而 coverage 分析器的 op universe 是**扁平名字集**（`analyze-coverage.py:575` 的 `missing = [n for n in ops if n not in CQ_COMPAT_OPS]`），**无法分辨接收者**。

⇒ 若把裸 `filter` / `sort` 加进 `CQ_COMPAT_OPS`：本批只实现了 `Shape.filter`（+ 既有 `stackFilter` 覆盖 `Workplane` 语义），但扁平集合会**把 `Sketch.filter` 案例也误判为 portable** —— 假解锁。**后缀名是「歧义接收者的正确处置」，不是命名洁癖。**

**为什么 `sortByKey` 而非 `sortByPredicate`**：`sort` 的第二参是 **key extractor**（`x => -x.Volume()`，返回值参与排序比较），不是 predicate（返回布尔）。机械照抄用户的举例名会**语义失真**，故取 `sortByKey`。

**`analyze-coverage.py` 的处置**：`filter` / `sort` **故意不加**进 `CQ_COMPAT_EXTRA`，只加了一段块注释说明原因；并保留 `test_special` 的 `blockedBy: filter` 作为**刻意假阴性**（该条目在 manifest 已 ported，但 coverage 侧不动 —— 两个口径本就记不同的事，见 §6.6）。

> ⚠ **`cs` 的顺序真值不在 parity 里**：`compare.ts` 判定面只有 5 个量（`volume.diffPct` / `centerOfMass.maxDiff` / `bbox.maxDiff` / 双向布尔体积 / topo f/e/v，`compare.ts:117-129`），**全部与顺序无关**，也**不含 solids 计数**。而 `sort` 的全部语义就是顺序 ⇒ `cs` 正序/反序/乱序**全都 PASS**。
> 处置：`cs` 镜像**照写**（机械解锁），但头部注释写明「**ORDER-BLIND，真值钉在 `shape-filter.test.ts`**」—— 顺序正确性由单测的三条断言（`[27,8,1]` / `[1,8,27]` / 稳定性）保证，不靠 comparator。

### 3.3 `eachpoint(fcn)` 函数形态 —— **本批未做**（独立批次）

上游 `eachpoint(fcn, combine)` 的 `fcn: Location → Shape`；faijs 现有 `eachpoint(target, item)` 只接受 item。设计要点（留待独立批次）：第二参为 function 时对每个 location 调 `fcn(loc)` 得 `Shape`，汇入既有 `combineEachpoint`（`workplane.ts:849`）。`loc` 形态与 `Shape.located(loc)` 语义**必须先一次性 Python 捕获**（本仓纪律：`imprint`/`sweep`/`offset` 曾三次凭印象写错）。

### 3.4 λ 传参约定（两条 DSL 硬约束，均已配防回归测试）

落地时发现两条**语言层约束**，都写进了镜像注释：

| # | 约束 | 代码级根因 | 违反后果 |
|---|---|---|---|
| 1 | **λ 必须用 `function` 声明体，不能用箭头体** | 箭头函数体内**看不到 `cq` 命名空间**：`hoistText`（`direct-executor.ts:1287`）只提升 ctx/declared 名、**不重写命名空间**；只有 `transformFunction`（`:1010`）会注入 `const cq = __ns.cq` | `cq is not defined`（`{callee:'filterByPredicate', lineNo:7}`） |
| 2 | **op 必须 `await` 回调** | DSL `function` **恒为 async**：`transformFunction` 生成 `__ctx.name = async function name(…)`（`direct-executor.ts:1012`）⇒ 回调返回 Promise ⇒ Promise 恒真 ⇒ 朴素 `Array.filter` 会保留全部子形状 | predicate 明明只选 1 个 box，结果 vol 36（全保留） |

对应测试（`src/shape-filter.test.ts`）：①「箭头体失败 / `function` 声明成功」**双向**断言；②「async predicate 仍得 vol 1」防回归。

- 镜像写法：`function isSmall(x) { return cq.volumeOf(x) <= 1 }` + `await cq.filterByPredicate(c, isSmall)`。
- λ 体内只调用**同步**测量（`volumeOf`/`areaOf`），**不 `await`**。

## 4. 实现步骤（终态回填）

### 阶段 0 — 探针 ✅

1. ✅ `iterShapes` 语义探针 → 落成 `src/shape-children.probe.test.ts`（91 行，5 测试）：flat 2 子 / nested 2 直接子 / **solid → 1 shell** / 子句柄可重组（vol 1+27）。
2. ✅ λ 端到端链路固化进 `src/shape-filter.test.ts`。

### 阶段 1 — `filterByPredicate` ✅

3. ✅ `childrenOf`（`shape-class.ts:374`）。
4. ✅ `filterByPredicate`（`workplane.ts:5964`）+ `index.ts:103` 导出（含 JSDoc，`verify-export-jsdoc` 通过）。
5. ✅ 单测 `src/shape-filter.test.ts`（234 行，13 测试）：三 box 匹配捕获（vol 36 / f18e36v24 / 子体积 [1,8,27]）· `cf` 精确几何 · 多子保留（vol 35）· **空结果 → 空 compound** · **await 异步谓词** · 谓词收到可测量子形状 · `null` 报错 · **CLI `autoLift:false` 用例** · 箭头体 GOTCHA 双向断言。
6. ✅ 镜像 `tests/test_shapes/test_special__cf.fai.js`：

```js
import * as cq from '@faicad/faijs-cadquery'
let b1 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let b2 = await cq.box(cq.Workplane(), 2, 2, 2, { centered: [true, true, false] })
let b3 = await cq.box(cq.Workplane(), 3, 3, 3, { centered: [true, true, false] })
let c = cq.compound(cq.val(b1), cq.val(b2), cq.val(b3))
function isSmall(x) { return cq.volumeOf(x) <= 1 }
let result = await cq.filterByPredicate(c, isSmall)
```

7. ✅ `run-cand` 导出 + `compare-one` PASS；`gen-manifest.ts` 刷新。

### 阶段 2 — `sortByKey` ✅（按 §3.2 命名，非 A/B/C）

8. ✅ 实现 + 单测（key 语义、返回顺序三条断言）。
9. ✅ **`cs` 镜像照写**（初稿「建议不写」被推翻）—— comparator 顺序盲区改由单测真值兜底。

### 阶段 3 — `eachpoint(fcn)` ⏸

10. ⏸ **未做**，独立批次（§3.3）。

### 阶段 4 — 收尾 ✅

11. ✅ 构建 + 包内 vitest。
12. ✅ 提交（显式路径）。
13. ✅ 路线图 §10.4.3 + `.workbuddy/memory`。

## 5. 测试与验证清单（实测结果）

| 项 | 判据 | 结果 |
|---|---|---|
| 单元测试 | 新增 `shape-filter.test.ts` + `shape-children.probe.test.ts` 全绿；含 `autoLift:false` CLI 条件用例 | ✅ 包内 vitest **616 通过 / 57 文件**，**零 stderr** |
| 回归 | tsc 零新错 + 包内 vitest 全绿 | ✅ `npm run build -w @faicad/faijs-cadquery` 通过 |
| parity | `run-cand` + `compare-one` PASS | ✅ `c` / `cf` / `cs` **三条逐位 PASS**（`volΔ%=0.00e+0 comΔ=0.00e+0 bboxΔ=0.00e+0`；cf `f6/e12/v8`） |
| manifest | `gen-manifest.ts` 后 `cf`/`cs` blocked → ported | ✅ **524 ported / 118 blocked / 55 skipped**（较落地前 +2 ported / -2 blocked） |
| 镜像总数 | 逐文件清扫 | ✅ **536**（`tests/**/*.fai.js`）+ **22**（`tests/ref-capture/**`） |
| coverage | `analyze-coverage.py` 结果不变（故意） | ✅ 214 missing / 41 op-blocked / 42 unknown（未把 `filter`/`sort` 加进 `CQ_COMPAT_EXTRA`，见 §3.2） |
| 门禁 | lefthook pre-commit | ✅ `verify-export-jsdoc` 通过；`analyze-coverage.py --self-test` **8/8** 通过 |

## 6. 风险与未决项（终态）

1. **`sort` 命名冲突** —— ✅ 已由用户指令消解为后缀名（§3.2）。
2. **`cs` 顺序零敏感度** —— ✅ 已处置：镜像照写 + 真值钉单测（§3.2 末）。
3. **`iterShapes` 归属/递归语义** —— ✅ 探针实测；返回句柄经 `borrowShape` **借用**，无 `release` 负担。
4. **predicate 参数层（`CqShape` vs mesh `Shape`）** —— 本批选 `CqShape`（零改动）；若未来要让 predicate 内使用任意 DSL op，须升级 `unwrapShape`。
5. **`eachpoint(fcn)` 的 `Location` 语义** —— ⏸ 未做，需 Python 捕获（独立批次）。
6. **覆盖率双口径**：coverage（源码级：「上游源码用到的 op 是否已导出」）与 manifest（镜像级：「镜像写了没」）在 `test_special` 上**故意不一致** —— 这是**正确的**，不是 bug。

## 7. 与路线图 / 记忆的衔接

- 本方案 = 路线图 §10.4 的 **N3**（N1 已落地 `c063167b`、N2 已落地 `test_special__c`）。执行记录见路线图 §10.4.3。
- **订正历史判断**：此前把 `filter` / `eachpoint` 的 λ 形态归入「`.fai.js` 语法长线（C 组）」——**错**。λ 已可用，它们是**纯 op 缺口（B 组）**；路线图 C 组已把 `filter` 两项移除（`5 → 1`，仅余 `eachpoint`）。

## 参考（行号均落地时实测）

- `packages/faijs-cadquery/src/`：`workplane.ts`（`2444` sort / `4511` cutEach / `4557` eachpoint / `5339` compound / `5868` stackFilter / `5909` sortStack / **`5964` filterByPredicate / `5994` sortByKey** / `838` makeCompoundShape / `849` combineEachpoint）、`shape-class.ts`（`60` borrowShape / `69` unwrapShape / `98` brepH / `298` makeCompound / `338` solids / **`374` childrenOf** / `612` boundingBoxOf / `621` volumeOf）、`index.ts`（`99-102` stack 组合子 / **`103` filterByPredicate / `104` sortByKey** / `118` sort / `141-142` eachpoint·cutEach / `248` volumeOf）。
- `packages/core/src/brep/engine/types.ts`（`342` iterShapes / `356` makeCompound / `358` getSubShapes）。
- `node_modules/occt-wasm/dist/index.d.ts`（`199` makeCompound / `254` getShapeType / `256` isCompound / `271` getSubShapes / `289` iterShapes）。
- `packages/core/src/lang/metadata-extractor.ts:810`（`parseValueExpr` 默认分支）。
- `packages/core/src/cad-runtime/direct-executor.ts`（`1010`/`1012` `transformFunction` 注入命名空间 + 恒 async；`1287` `hoistText` 不重写命名空间）。
- `packages/faijs-cadquery/tests/compare.ts:117-129`（判定面）。
- `packages/faijs-cadquery/tests/ref-harness/analyze-coverage.py:78-95/575`。
- 上游：`cadquery/occ_impl/shapes.py:1732/1928/1932/6208`、`cadquery/cq.py:4460/4490`、`out/cache/v2.8.0/tests/test_shapes.py:398/401`、`out/cache/v2.8.0/tests/test_cad_objects.py:278`、`out/cache/v2.8.0/tests/test_sketch.py:865/875`。
