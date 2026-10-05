# CadQuery 移植：`Shape.filter` / `Shape.sort`（λ 传参批次）技术实现方案

> 状态：方案（plan-only）。本会话只产出本计划，不改任何代码。
> 上游上下文：`docs/plans/2026-10-03-cadquery-full-port-roadmap.md`（权威路线图，§10.4 N 序列）。
> 本文取代路线图 §10.4 中 N2 之后的位置：**N3 = 本批**。

## 0. 结论摘要（先看这段）

1. **「一条 API 解锁 3–5 条」这个前提不成立。** 本批次是 **3 条用例、3 个彼此独立的 API**：
   - `test_special__cf` ← 需要 `filter`
   - `test_special__cs` ← 需要 `sort`
   - `testCompoundCenter__s` ← 需要 **`eachpoint(fcn)` 函数形态**（与 `filter` 无关）

   `Shape.filter` 单独落地**只解锁 1 条（cf）**。

2. **语言层不需要改。** λ 已被三实验证实可用：顶层箭头声明 PASS、λ 先存变量再传 PASS（穿过全部校验）、只有「内联箭头写在实参位置」被拒（`metadata-extractor.ts:810`）。→ 镜像写法规定为「先存变量再传」，**零语法改动**。

3. **内核不需要改。** `iterShapes`（`Compound.__iter__` 的直接子节点对应物）、`makeCompound`、`getSubShapes` 都已在 faijs L1 引擎面（`packages/core/src/brep/engine/types.ts:342/356/358`），faijs-cadquery 已在用 `getSubShapes`。

4. **唯一必须你拍板的是 `sort` 的命名冲突**（`sort` 已被 faijs 特有的 pending-wire 排序占用，见 §3.2）。

5. **建议 `cs` 不写镜像**（comparator 对顺序零敏感，PASS 不证明 sort 正确，见 §3.2 末尾）。即本批次净解锁 = **cf（1）+ CompoundCenter（1，若做 eachpoint 形态）= 2 条有意义**。

## 1. 范围（精确到 case id）

| # | 镜像目标 | `blockedBy` | 所需新 API | ref 度量 |
|---|---|---|---|---|
| 1 | `tests.test_shapes:::test_special__cf` | `filter` | `filter(shape, pred)` | Compound, vol 1.0，topo f6/e12/v8 |
| 2 | `tests.test_shapes:::test_special__cs` | `filter` | `sort(shape, key)`（§3.2 命名待定） | Compound, vol 36（与 `c` 同） |
| 3 | `tests.test_cad_objects::TestCadObjects::testCompoundCenter__s` | `eachpoint` | `eachpoint(fcn)` **函数形态** | Compound, vol 0.39269908169872403 |

**明确排除**（避免范围蔓延）：

- `test_set_ops__simple_box`（`op:shape-operator-overload`）—— 是 `Compound.__and__/__or__` 运算符重载（G-C19），与 λ 无关。
- `test_cadquery::TestCadQuery::test_map_apply_filter_sort__w` —— 已 ported（镜像只复现导出的 `w`，不跑 filter）。
- `test_sketch::test_filter` / `test_sort`（`test_sketch.py:865/875`）—— **不在 manifest**（无 STEP ref，不入 parity）。
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

### 2.2 faijs 现状（`packages/faijs-cadquery/src/`）

**已存在**：

- Workplane 级组合子：`stackFilter`（`workplane.ts:5868`）、`stackMap`（`5879`）、`stackApply`（`5892`）、`sortStack`（`5909`）；均已导出（`index.ts:99-102`）。
- 类模型：`makeCompound`（`shape-class.ts:298`）、`solids`（`338`）、`wiresOf`（`318`）、`facesOf`（`363`）、`volumeOf`（`600`，**同步**）、`borrowShape`（`60`）、`unwrapShape`（`69`）、句柄解析 `brepH`（`98`）。
- DSL 层：`compound(...)`（`workplane.ts:5339`，返回 mesh `Shape | null`）、装配 helper `ownHandle`（`627`）/`toShape`（`630`）/`asBrepShape`（`83`）、`eachpoint`（`4557`，**item 形态**：`Workplane | Shape`）、`cutEach`（`4511`）。
- `sort`（`workplane.ts:2444`）= **pending-wire 排序**（`'area'|'length'|'x'|'y'`），faijs 特有；其 docstring 自述「has no upstream counterpart under this name」。

**缺失**：

- **`filter` 未导出**（`index.ts` 无 `filter`，grep 计数 0）⇒ `cq.filter` 不存在 —— 即实验 3 报 `__ns.cq.filter is not a function` 的直接原因。
- **Shape 级 `sort` 不存在**（`sort` 被 pending-wire 占用；`sortStack` 只服务 Workplane）。
- **`eachpoint` 无函数形态**（现签名只接受 `Workplane | Shape` 作 item，不接受 `Location → Shape`）。

### 2.3 内核能力（`node_modules/occt-wasm/dist/index.d.ts`）

- `iterShapes(shape): ShapeHandle[]`（:289）—— 直接子节点迭代。
- `makeCompound(shapes)`（:199）、`getSubShapes(shape, type)`（:271）、`isCompound`（:256）、`getShapeType`（:254）。
- 均已在 faijs L1 引擎面（`brep/engine/types.ts:342` iterShapes、`:356` makeCompound、`:358` getSubShapes）⇒ **零内核改动**。
- ⚠ `iterShapes` 的「直接 vs 递归」语义**尚未在 faijs-cadquery 侧实测**（本仓无使用先例）⇒ 实现前先跑探针（§4 阶段 0）。

### 2.4 阻塞根因：λ 到底卡在哪

三实验（直接跑 CLI，已固化结论）：

| 写法 | 结果 |
|---|---|
| `let pick = (x) => x`（顶层箭头声明） | ✅ PASS |
| `cq.filter(b1, (x) => true)`（内联箭头作实参） | ❌ `unsupported value expression: ArrowFunctionExpression`，抛自 `metadata-extractor.ts:810` |
| `let pick = ...; cq.filter(b1, pick)` | ❌ `__ns.cq.filter is not a function` —— **函数值已穿过全部校验** |

⇒ 本批次是**纯 op 缺口**，不是语法缺口。λ 体内调用的 `volumeOf`（`shape-class.ts:600`）是同步函数 ⇒ predicate 无需 async，实现复杂度低。

## 3. API 设计

### 3.1 `filter(target, pred)` —— 新增导出，无命名冲突

```ts
export function filter(
  target: Workplane | Shape,
  pred: (x: CqShape) => boolean,
): Shape | null
```

派发规则：

- `target` 是 **Workplane** → 直接复用 `stackFilter`（`wp.objects.filter(pred)`），保持单一真源，不新写一份栈过滤。
- `target` 是 **mesh `Shape`** → 解析 brep 句柄（复用 `shape-class.ts:98` 的 `brepH` 逻辑）→ `kern().iterShapes(h)` → 每个子句柄 `borrowShape(kind, handle)` → `pred` 过滤 → 对保留项 `kern().makeCompound(handles)` → `toShape(...)` 包回 mesh `Shape`。
- **空结果** → 返回 `null`（与现有 `cq.compound()` 空参行为一致）。⚠ 偏差留档：上游返回**空 Compound**（`shapes.py:6208`），非 None。

**predicate 收到 `CqShape`（借用视图）**，理由：`volumeOf`/`areaOf` 等测量函数经 `unwrapShape`（`shape-class.ts:69`）只识别 `.handle`；若传 mesh `Shape`，`unwrapShape` 会原样透传 → `introspect().getVolume(<对象>)` 静默拿到错误输入。

- 镜像写法：`let pick = (x) => cq.volumeOf(x) <= 1`。
- 备选（**不推荐**，影响面大）：升级 `unwrapShape` 让测量函数也识别 mesh `Shape`（`brepOf` 回退）——这会把改动扩散到所有测量/选择函数。

### 3.2 `sort` —— 命名冲突，**需拍板**

上游 `Shape.sort` 与 `Workplane.sort` 同名；faijs 现状把 `sort` 给了 pending-wire 排序、`sortStack` 给了对象栈排序。

| 方案 | 做法 | 风险 |
|---|---|---|
| **A（推荐）** | 把 `sortStack` 泛化成 `sortStack(Workplane \| Shape, key)`，Shape 分支用 §3.1 的同一迭代 helper；镜像写 `cq.sortStack(c, key)` | 零破坏；名字不忠实上游 |
| **B** | 把 pending-wire `sort` 改名 `sortWires`，把 `sort` 让给上游语义（`Shape.sort` / `Workplane.sort` 同名派发） | **破坏公开 API** —— `sort` 在 parity corpus 无消费点（grep 证实），但可能被 `../3d_editor` 等外部消费 |
| **C** | 新增独立名 `shapeSort` | 零破坏；命名最不忠实 |

推荐 **A**：改动最小、零破坏，且 `sortStack` 本来就是「上游 `.sort(key)`」的对应实现，只是目前只覆盖 Workplane。

> ⚠ **`cs` 是否写镜像另论**：`compare.ts` 判定面只有 5 个量（`volume.diffPct` / `centerOfMass.maxDiff` / `bbox.maxDiff` / 双向布尔体积 / topo f/e/v，`compare.ts:117-129`），**全部与顺序无关**。而 `sort` 的全部语义就是顺序 ⇒ `cs` 的正序/反序/乱序**全都 PASS**，PASS 不能证明 sort 实现正确。
> 即：实现 `sort` 能「机械解锁」`cs`，但**建议不写 `cs` 镜像**（保持 blocked），除非明确接受「parity = 几何复现度」而非「API 移植度」的口径。
> 对比：`cf` 值得写 —— vol 1 vs 36 有**证伪力**（选错 box 立刻 FAIL）。

### 3.3 `eachpoint(fcn)` 函数形态 —— 第三条 API（**独立于 filter**）

上游 `eachpoint(fcn, combine)` 的 `fcn: Location → Shape`；faijs 现有 `eachpoint(wp, item)` 只接受 item。

设计：`eachpoint(target, itemOrFcn, opts?)` —— 第二参为 function 时，对每个 location 调 `fcn(loc)` 得 `Shape`，再汇入既有 combine 路径（`combineEachpoint`，`workplane.ts:849`）。

- `loc` 的形态与 `Shape.located(loc)` 语义**必须一次性 Python 捕获后再实现**（本仓纪律：`imprint`/`sweep`/`offset` 曾三次凭印象写错）。
- 若该形态成本超预期，**可拆为独立批次**（它不属于 `Shape.filter` 的范畴）。

### 3.4 λ 传参约定（写进镜像注释 + 库文档）

- 镜像一律「**先存变量再传**」：`let pick = (x) => ...` + `cq.filter(c, pick)`。**不要**写内联箭头实参。
- λ 体内只调用**同步**测量（`volumeOf`/`areaOf` 等），**不 `await`**。

## 4. 实现步骤（分阶段，每阶段独立可验证）

### 阶段 0 — 探针（一次性，不改产品代码）

1. `iterShapes` 语义探针（新增 `src/*.probe.test.ts` 或一次性脚本）：对 `compound(box1,box2,box3)` 断言返回 3 个 solid；对嵌套 compound 观察是否递归；**确认返回句柄的归属**（借用 vs 拥有）——决定要不要 `release`，避免泄漏/悬垂。
2. λ 端到端探针：固化「顶层箭头 + 变量传递 → op 收到函数」的最小链路（已有实验 3 证据，此处落成测试）。

### 阶段 1 — `filter`（核心交付）

3. 实现 children 迭代 helper（建议放 `shape-class.ts`，紧邻 `solids`/`facesOf`）：`iterChildren(handle): CqShape[]`，基于 `kern().iterShapes` + `borrowShape`。
4. 在 `workplane.ts` 导出 `filter(target, pred)`（§3.1）；`index.ts` 补 `filter` 导出（并补 JSDoc —— `verify-export-jsdoc` 门禁会查）。
5. 单测 `src/shape-filter.test.ts`：
   - ① 三 box compound → `filter(vol ≤ 1)` 保留 1 个、几何 = `box(1,1,1)`；
   - ② Workplane 分支 == `stackFilter`；
   - ③ 空结果 → `null`；
   - ④ predicate 收到对象可被 `volumeOf` 正确测量；
   - ⑤ **CLI 条件用例**：`registerLib('cq', cq, { packageName, autoLift:false })`（否则是**假绿** —— 记忆已载该陷阱）。
6. 镜像 `tests/test_shapes/test_special__cf.fai.js`：

```js
// source: test_shapes.py::test_special (var cf)
// cf = c.filter(lambda x: x.Volume() <= 1)   — Shape.filter
// ref: Compound vol 1.0, topo f6/e12/v8 (the box(1,1,1) member)
import * as cq from '@faicad/faijs-cadquery'
let b1 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let b2 = await cq.box(cq.Workplane(), 2, 2, 2, { centered: [true, true, false] })
let b3 = await cq.box(cq.Workplane(), 3, 3, 3, { centered: [true, true, false] })
let c = cq.compound(cq.val(b1), cq.val(b2), cq.val(b3))
let pick = (x) => cq.volumeOf(x) <= 1
let result = cq.filter(c, pick)
```

7. `run-cand` 导出 + `compare-one` 验 PASS；`gen-manifest.ts` 刷新（⚠ `manual:true` 条目需先删字段才翻状态 —— 记忆已载）；重跑 `analyze-coverage.py`（预期 `missingOps` 去掉 `filter`、`test_special` 迁出 BLOCKED）。

### 阶段 2 — `sort`（按 §3.2 决策后开工）

8. 按选定方案实现 + 单测（key 函数语义、返回顺序）。
9. **决策后再定**是否写 `cs` 镜像（推荐不写）。

### 阶段 3 — `eachpoint(fcn)`（独立批次）

10. Python 捕获 `Location` / `located` 语义 → 实现 `eachpoint(target, fcn, opts)` → 写 `testCompoundCenter__s` 镜像。

### 阶段 4 — 收尾

11. `npm run build -w @faicad/faijs-cadquery`（tsc）+ 包内 vitest 全绿（基线 **598**）。
12. 提交：**显式路径**，只带本批 cadquery 文件；工作树里的 freecad / probe 脚本**一律不带**；过 lefthook 门禁。
13. 更新路线图 §10.4（N3 行 → 终态）与 `.workbuddy/memory`。

## 5. 测试与验证清单

| 项 | 判据 |
|---|---|
| 单元测试 | 新增 `src/shape-filter.test.ts` 全绿；**必含 `autoLift:false` 的 CLI 条件用例** |
| 回归 | `npm run build -w @faicad/faijs-cadquery`（tsc 零新错）+ 包内 vitest（598+N 全绿、**零 stderr**）|
| parity | `run-cand` 导出成功 + `compare-one` PASS（`cf`：volΔ/comΔ/bboxΔ ≤ 容差，topo f6/e12/v8）|
| manifest | `gen-manifest.ts` 后 `cf`：blocked → ported（blocked 120 → 119）|
| coverage | `analyze-coverage.py` 后 `missingOps` 去掉 `filter`；`test_special` 迁出 BLOCKED |
| 门禁 | lefthook pre-commit 过（`filter` 需 JSDoc，否则 `verify-export-jsdoc` 失败）|

## 6. 风险与未决项

1. **`sort` 命名冲突**（§3.2）—— 需你拍板 A / B / C。
2. **`cs` 是否写**（零敏感度）—— 建议不写。
3. **`iterShapes` 归属/递归语义未实测** —— 阶段 0 探针；若句柄归我方所有，需处理 `release`。
4. **predicate 参数层（`CqShape` vs mesh `Shape`）** —— 本方案选 `CqShape`（零改动）；若未来要让 predicate 内使用任意 DSL op，须升级 `unwrapShape`。
5. **`eachpoint(fcn)` 的 `Location` 语义** —— 需 Python 捕获，成本可能高于 `filter`。
6. **覆盖率双口径**：写镜像后 coverage（源码级）与 manifest（镜像级）会不一致 —— 这是**正确的**（一个记「上游源码用到的 op 是否已导出」，一个记「镜像写了没」）。

## 7. 与路线图 / 记忆的衔接

- 本方案 = 路线图 §10.4 的 **N3**（N1 已落地 `c063167b`、N2 已落地 `test_special__c`）。
- **订正历史判断**：此前把 `filter` / `eachpoint` 的 λ 形态归入「`.fai.js` 语法长线（C 组）」——**错**。λ 已可用（三实验），它们是**纯 op 缺口（B 组）**。若采纳本方案，路线图 C 组应把 `filter` 两项移除。

## 参考（行号均本轮实测）

- `packages/faijs-cadquery/src/`：`workplane.ts`（`2444` sort / `4511` cutEach / `4557` eachpoint / `5339` compound / `5868` stackFilter / `5909` sortStack / `838` makeCompoundShape / `849` combineEachpoint）、`shape-class.ts`（`60` borrowShape / `69` unwrapShape / `98` brepH / `298` makeCompound / `338` solids / `600` volumeOf）、`index.ts`（`99-102` stack 组合子 / `118` sort / `141-142` eachpoint·cutEach / `248` volumeOf）。
- `packages/core/src/brep/engine/types.ts`（`342` iterShapes / `356` makeCompound / `358` getSubShapes）。
- `node_modules/occt-wasm/dist/index.d.ts`（`199` makeCompound / `254` getShapeType / `256` isCompound / `271` getSubShapes / `289` iterShapes）。
- `packages/core/src/lang/metadata-extractor.ts:810`（`parseValueExpr` 默认分支）。
- `packages/faijs-cadquery/tests/compare.ts:117-129`（判定面）。
- 上游：`cadquery/occ_impl/shapes.py:1732/1928/1932/6208`、`cadquery/cq.py:4460/4490`、`out/cache/v2.8.0/tests/test_shapes.py:398/401`、`out/cache/v2.8.0/tests/test_cad_objects.py:278`。
