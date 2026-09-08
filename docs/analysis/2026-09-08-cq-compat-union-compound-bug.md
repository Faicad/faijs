# cq-compat union 返回 compound 问题分析（更正版）

> 原交接文档标题为「cq-compat union 返回 compound 问题交接」，其「已排查结论」第 5/6 条
> （问题在 `cad.union` 链路、疑似根因在 `solidToShape`/`fromBrep`/`defineOp`）**经复现验证为误诊**。
> 本文档在原文档基础上更正根因，并补充两条新约束（CadQuery workplane stack 语义、STEP 比对必须走装配一致性比对）。

## 用户原始需求（原话）

1. 「分析这个文档里提到的 bug。」
2. 「要注意 cadquery 对 workplane 的特殊处理。比如 https://cadquery.readthedocs.io/en/latest/workplane.html#the-stack 」
3. 「所有 step 文件的比对，都必须走装配一致性比对。因为没法知道一个 step 是不是 compound 的。前面的 slide_top 这个案例就说明了之前的 bug。两个零件，一个是单独的，一个是 compound，结果比对通过了。实际上应该是不通过。」

## 问题概述

cq-compat 的 `extrude` boss 操作（在现有 shape 上挤出凸台并 union）在某种场景下返回
**compound（多个独立 solid）**，导致装配导出时一个零件被 XCAF 拆成多个独立零件；
或反过来——在当前代码状态下表现为**单个 solid 但几何位置错误**（见根因 B）。

## 复现场景

`packages/mini_lathe/src/parts/slide_top.fai.js`：

1. 创建主板 `box(110, 120, 8)`
2. `cutBlind` 切两个槽（`pushPoints` 两个位置 ±38.3）
3. `extrude` 在顶面挤出凸台 `box(20, 10, 13.7)`
4. 后续操作（cboreHole、中心孔、六角、最终切槽）

原文档记录：凸台 2740 mm³ + 主板 87268 mm³ 两个独立 solid，总体积正确但拓扑分裂。

## 已排查结论（更正版，全部经实测）

### 1. OCCT 底层正常 ✓（保留原结论）

直接 `kernel.fuse()` / `kernel.fuseWithHistory()` 测试：
- 有槽 box + 重叠凸台 → 1 个 solid ✓
- 无槽 box + 凸台 → 1 个 solid ✓

### 2. 不是 coplanar 面接触问题 ✓（保留，但注意）

`OVERLAP = 0.1` 已加在 extrude boss 分支。**注意：OVERLAP 只在 boss 底面确实落在完整
板材上时有效**；若槽恰好开在 boss 正下方，boss 底面（z=7.9）与槽底（z=7）仍有 0.9mm
间隙，OVERLAP 完全无效。

### 3. 不是 cutBlind 本身产生 compound ✓（保留，但需限定）

单独 cutBlind slots 后检查 → 1 个 solid ✓（切槽只会让一个 solid 少一块，不会分裂）。

### 4. 无 cutBlind 时 boss extrude 正常 ✓（保留，但需限定）

只做 `box → hole → boss extrude`（无槽）→ 1 个 solid ✓——因为此时 boss 底面压在完整
板材上，OVERLAP 生效。

### 5. ❌【更正】「问题在 faijs 的 cad.union 链路」是误诊

原结论说 `fuseWithHistory` 返回单 solid，但经 `solidToShape` + `fromBrep` 包装后变成
compound。**实测否定**：`cad.union(wp.shape, shifted)` 的行为完全符合 OCCT 语义——
对两个**不相交** solid，union 正确返回 compound（2 solids）；对相交 solid，正确返回
1 solid。`booleanBrep` / `solidToShape` / `fromBrep` / `defineOp` 均无 bug。

原文档直接 OCCT 测试与 faijs 链结果的差异，**不是链路差异，而是几何差异**：
- 直接测试的几何：两个**侧槽**（boss 部分压在完整板材上）→ boss 与板相交 → fuse → 1 solid；
- faijs 链的真实几何：`cutBlind` 忽略 `wp.pts`，**槽被切在 workplane origin（中心）**，
  恰好位于 boss 正下方 → boss 与板不相交（间隙 0.9）→ union 正确返回 2 solids。

### 6. ✅【更正】真正根因 A：`cutBlind` 忽略 `wp.pts`（CadQuery stack 语义缺失）

`packages/cq-compat/src/workplane.ts` 的 `cutBlind` 只用 `wp.origin` 创建一个切削工具
并 subtract 一次，**从不遍历 `wp.pts`**。slide_top 期望的是两个侧槽（x=±38.3），实际
只切了中心一个槽（体积验证：105600 − 27.4×36×1 = 104613.6，恰为单槽）。

**验证（A/B）**：同一管线，`cutBlind` 修正为按设计位置切两个侧槽后，boss union →
**1 个 solid**，体积 106367.2 = 105600 − 2×986.4 + 2760 − 20 ✓（与直接 OCCT 测试一致）。

### 7. ✅【新发现】真正根因 B：faijs direct-executor codegen 括号丢失

顶层语句（无 await，mini_lathe 文件正是这种写法）的 op 实参中的嵌套算术表达式被
`direct-executor.ts` 的 `transformArg` 递归重发射时**丢失括号**：

```
原式:  -((((15 - 8) / 2) + (10 / 2)) + 0.555)   = -9.055
发射:  -15 - 8 / 2 + 10 / 2 + 0.555             = -13.445   ← JS 优先级重解释
```

实测（挂钩 `new Function` 抓编译后源码）确认发射结果为
`__ctx.slide_top = await __ns.cq.extrude(…, 0, -15 - 8 / 2 + 10 / 2 + 0.555), …)`。

**影响**：boss 的 Y 偏移从 −9.055 变成 −13.445（下移 4.39mm），boss 底边压出槽区外的
完整板材（y∈[-18.445, -18] 条带，0.445mm 宽）→ 与板相交 0.9mm³ → union 融成 1 个
solid（**几何错误**：boss 位置错，零件被压成一个伪「正确」单 solid）。

**为什么原文档复现出 2 solids**：`debug-slide-top.ts` 等复现脚本用 `await` + async 函数
写法，函数体原样透传、不经 codegen 重发射 → 表达式求值正确（−9.055）→ boss 悬空 →
2 solids。**同一份几何，await/async 写法与顶层写法结果不同**，这正是本次复现最关键的线索。

**范围**：这是 faijs 引擎级 bug，影响所有「顶层语句 op 实参含嵌套算术」的 `.fai.js`，
不止 cq-compat。

## CadQuery workplane stack 语义（用户约束 1）

CadQuery 文档（the-stack）：每个 Workplane 有一个 stack（坐标系/点列表）；`pushPoints`
设置/追加点；`hole`/`cutBlind`/boss `extrude` 等特征操作**对 stack 中每个点创建特征**。

cq-compat 现状核对（`packages/cq-compat/src/workplane.ts`）：

| 函数 | CadQuery 语义 | cq-compat 现状 |
|---|---|---|
| `pushPoints` | 追加 pts | ✓ 追加 |
| `hole` | 遍历 pts 打孔 | ✓ 遍历，但返回时 `pts: []` **清空** |
| `cboreHole` | 每点孔 + 每点沉孔 | ✗ 沉孔阶段 pts 已被 hole 清空 → 只落在 `[[0,0]]` |
| `cskHole` | 每点孔 + 每点锪孔 | ✗ 同上 |
| `cutBlind` | 每点切一个槽 | ✗ 只用 `wp.origin`，单次切（根因 A） |
| `extrude` boss | 每点一个凸台 | ✗ 只用 `wp.origin`，单 boss |
| `workplane` | `centerOption`：默认 CenterOfMass（面心）/ CenterOfBoundBox | ✗ 忽略 centerOption，恒用整件 bbox 中心 |

slide_top 的 8 个 cboreHole 实测只打了 8 个通孔 + **1 个中心沉孔**（沉孔应为 8 个）；
`cutBlind` 只切了 1 个中心槽（应为 2 个侧槽）。修复方向见下文。

## STEP 比对必须走装配一致性比对（用户约束 2，已实测）

用户原话：「所有 step 文件的比对，都必须走装配一致性比对。因为没法知道一个 step 是不是
compound 的。」验证实验结果：

| 场景 | 比对方式 | 结果 |
|---|---|---|
| 参考 2 个零件 vs 候选 1 个 part（compound 含 2 solids，总 solid 数相同 2=2） | `compareStepFiles`（strict 与 loose） | **equivalent=true（错误通过）**：bbox/volume/COM/topology(总 solid 数)/boolean 五维全绿 |
| 同上 | `compareAssemblyFiles` | equivalent=false，structure（leaf 数/名字）正确判失败 |
| 单 solid vs 同几何 compound（共面接触） | 旧式「体积+包围盒」只比 | **错误通过**（体积差 0.0000%、bbox 全等） |
| 同上 | `compareStepFiles` | topology（solid 数 1 vs 2）可判失败 |

结论：
- `compareStepFiles` 只比对**整件总 solid 数**，对「1 个 compound part vs 多个 part」的
  分解差异完全失明——STEP 文件本身不暴露 compound/产品结构，无法预判。
- mini_lathe 之前的验证标准是「与 CadQuery 输出的体积 / 包围盒在容差内一致」
  （见 `docs/plans/2026-09-06-cadquery-compat-and-multifile-faijs.md`），正是 slide_top
  被拆成 2 solids 仍通过的原因（总积体与 bbox 一致）。
- **规则**：所有 STEP 比对一律使用 `compareAssemblyFiles`（装配一致性：structure
  leaf 数+名字、逐 part 几何/位姿/颜色、整体 boolean），`compareStepFiles` 只能作
  geometry 兜底参考，不能作为唯一判据。fai_cq_gears 移植方案中 `compareStepFiles`
  的用法（`docs/plans/2026-09-08-fai-cq-gears-port.md`）需同步改为
  `compareAssemblyFiles`。

## 建议修复方向（更正后）

1. **修 `cutBlind`**：遍历 `wp.pts`，逐点创建切削工具并链式 subtract（根因 A）。
2. **修 `cboreHole` / `cskHole`**：`hole` 不再清空 pts（或沉孔/锪孔阶段使用调用前的 pts）。
3. **修 `extrude` boss 分支**：遍历 `wp.pts` 逐点 union（CadQuery 每点一个凸台）。
4. **修 faijs `direct-executor.ts` 的 `transformArg`**：BinaryExpression/UnaryExpression
   递归发射时**保留括号**（子表达式重新加括号），否则顶层嵌套算术全部错值（根因 B，引擎级）。
5. **`workplane` 支持 `centerOption`**：默认 CenterOfMass（面心）、CenterOfBoundBox。
6. 修复后重导全部 7 个零件 + 装配，**全部走 `compareAssemblyFiles`** 与 CadQuery 参考比对。

## 相关文件

| 文件 | 作用 |
|---|---|
| `packages/cq-compat/src/workplane.ts` | cq-compat Workplane 实现（cutBlind/hole/cboreHole/extrude 的 pts 处理） |
| `packages/core/src/cad-runtime/direct-executor.ts` | 顶层语句 transform（transformArg 括号丢失 bug） |
| `packages/cq-compat/src/step-compare.ts` | 整件 STEP 比对（不可作唯一判据） |
| `packages/cq-compat/src/assembly-compare.ts` | 装配一致性比对（必须项） |
| `packages/core/src/api/boolean.ts` | `booleanBrep` / `union` defineOp（无 bug） |
| `packages/core/src/brep/face-evolution.ts` | `booleanWithRoleTable` / `fuseWithHistory`（无 bug） |
| `packages/core/src/brep/brep-ops.ts` | `solidToShape`（无 bug） |
| `packages/core/src/shape.ts` | `fromBrep` / `solid` / `brepOf`（无 bug） |

## 复现/验证脚本

`packages/mini_lathe/scripts/`：
- `test-fuse.ts` / `test-fuse-slot.ts` / `test-fuse-history.ts` — 直接 OCCT fuse 对照
- `debug-slide-top.ts` — await/async 复现（正确几何，2 solids）

本次分析的验证实验（可复跑，均在 `--mode brep` 下）：
1. **A/B 根因 A**：`cutBlind` 修正为两个侧槽 ±38.3 后 boss → 1 solid（106367.2）；
   现状（中心单槽）→ 2 solids（2760 + 104243.9）。
2. **根因 B 源码抓取**：挂钩 `new Function`，顶层路径发射出
   `…0, -15 - 8 / 2 + 10 / 2 + 0.555…`（原式 `-((((15-8)/2)+(10/2))+0.555)`）。
3. **await/顶层对照**：同管线 async+await 写法 → boss Y=−9.055 → 2 solids；顶层写法 →
   Y=−13.445 → 1 solid（几何错误）。
4. **STEP 比对**：构造「2 parts vs 1 compound part（同总 solid 数）」与「单 solid vs
   同几何 compound」，`compareStepFiles` 错误通过、`compareAssemblyFiles` 正确失败；
   旧式体积+bbox 只比对单 solid vs compound 错误通过。

## 当前代码状态

- `OVERLAP = 0.1` 已加在 extrude boss 分支（临时措施；对根因 A 场景无效，见第 2 节）。
- 当前完整 `slide_top.fai.js`（顶层写法）受根因 B 影响，导出为 1 个 solid（90027.2 mm³），
  但 boss 位置错误（Y 偏移 −13.445 而非 −9.055）——不是原文档所述的 2 solids。
- 原文档复现数字（2740/87268）来自 await/async 写法路径（正确几何下的 2 solids），
  与顶层文件实际导出不一致，说明原文档的「当前代码状态」描述不准确。
- 其他 6 个零件未发现此问题（但需在修复后统一重验）。
- 未提交：workplane.ts 的 OVERLAP 修改、各种测试 .fai.js、调试脚本。
