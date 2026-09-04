# 问题报告：compat e2e ⑦「arena 有界」断言失败 —— 重复执行泄漏 kernel 存活句柄

日期：2026-09-04　　状态：**已解决（见 §9 根因与修复）** —— §1–§8 为归因记录；根因、修复与验证见 §9。

## 1. 问题一句话

`@faicad/faijs-tests` 的 compat e2e ⑦（`sheetmetal-flow` 与 `mech-lib-flow`）断言「重复相同执行保持 kernel arena 有界」，
实际 `shapeCount` 增长 **2484 > 200**，且经归因实验证明：**该泄漏在 P26 提交（e882b77）本身就存在，与本次工作区任何改动无关**。

## 2. 现象（实测数据）

| 探针 | 结果 |
|---|---|
| `sheetmetal-flow.test.ts` ⑦（4 次重复 `execute(SCRIPT)`） | growth = **2484**（≈ 621/次），确定性复现 |
| `mech-lib-flow.test.ts` 同型断言 | 同样红 |
| 单 `cad.box` 裸脚本（独立 runtime，auto 模式） | `shapeCount` 线性增长 **+69/次**（139→208→277→346） |
| `NODE_OPTIONS=--expose-gc` 强制 GC + FinalizationRegistry 冲刷（3 轮 gc + 120ms 间隔） | growth 不变（= 276）——**排除 GC 滞后假说** |

失败点：`packages/tests/faijs/compat-e2e/sheetmetal-flow.test.ts:221`（`expect(growth).toBeLessThanOrEqual(200)`）。

## 3. 关键语义澄清（避免误判的两个事实）

1. **`shapeCount` 是 occt-wasm wasm 侧的存活计数，不是创建计数。**
   来源：`node_modules/occt-wasm/dist/index.js:1283` — `get shapeCount() { return this.#raw.getShapeCount(); }`。
   所以 ⑦ 红 = **旧 shape 没有被释放**，是真实泄漏，不是计数口径问题。
2. **`execute()` 是全量重跑，⑦ 的「有界」依赖句柄释放机制。**
   `runtime.executeIR` → `executor.executeAll`（`packages/core/src/cad-runtime/module-executor.ts:231`）无条件重跑全部语句
   （测试注释「same code: cache hit, no rebuild」指的正是这一前提：重跑时旧句柄经「顶替释放」
   （`module-executor.ts:284-287`）与 keep 登记释放回收，存活数才保持有界）。
   红 = 重跑产生的构建中间产物没有被释放路径回收。

## 4. 与用户观察的一致性说明

`npm run test -w @faicad/sheetmetal`（233 个测试）**通过，且与 ⑦ 红不矛盾**：
该套件是 sheetmetal 包自身的单测，**不包含** ⑦；⑦ 位于 `@faicad/faijs-tests` 工作区的 `compat-e2e/` 目录，两套测试不重叠。

## 5. 归因排查记录（已排除项）

| 排除项 | 方法 | 结果 |
|---|---|---|
| 本会话引擎改动（runtime.ts P0/P2、result-unwrap.ts OpError、l3-bridge.ts borrow view） | 备份→替换为 HEAD 版本→实跑 ⑦ | 仍 2484 |
| 另一 agent 的改动（compat-op.ts、module-executor.ts、script-face-manifest.ts） | 同上，6 个引擎文件全部还原 HEAD 后实跑 | 仍 **2484（一字不差）** |
| occt-wasm 版本漂移（`^3.7.0` caret 范围） | 安装版本 3.8.4 == package-lock；安装时间 2026-08-30，期间未变 | 排除 |
| GC / FinalizationRegistry 滞后 | 强制 GC + 冲刷实验 | 排除 |
| brep/mesh/lang 目录存在未审查改动 | `git status` + `git diff HEAD --stat` 全量清点 | 零改动 |

**结论：泄漏在 e882b77 提交的引擎代码中即存在；任何工作区改动都不是诱因。**

## 6. 与历史记录的矛盾（未解释）

项目记忆记录「P26 核查：sheetmetal e2e **7/7 全绿（实跑）**」。但今日在 HEAD 引擎树上 ⑦ 确定性红（2484），
且 6 文件全 HEAD 对照实验数值完全一致。**「当时全绿」与「现在 HEAD 必红」无法同时成立**，何时/为何变红未知。
该矛盾本身也是待查问题的一部分。

## 7. 影响与风险

- 泄漏随执行次数线性增长：宿主场景（3d_editor 多轮编辑、增量执行、重复 execute）会逐步耗尽 occt-wasm arena，
  长会话最终必然触发 arena 分配失败或 wasm 内存膨胀。
- 泄漏点指向引擎释放路径（顶替释放 / keepSink / checkpoint 之一）未覆盖重跑产生的全部中间产物，
  意味着**所有**走重复执行的路径都在积累，与 compat 边界无关（裸 `cad.box` 也泄漏 +69/次）。

## 8. 待回答的问题（只列问题）

1. 泄漏的确切源头在哪条释放路径：顶替释放、keepSink、vendored checkpoint，还是 occt-wasm `release` 的覆盖面不足？
2. 裸 `cad.box`（auto 模式）一次执行为何产生 69 个**存活** shape？其中多少来自 box 本体、多少来自三角化/派生产物？
3. 「7/7 全绿」记录与当前 HEAD 必红的矛盾：当时的运行条件是什么（哪个提交、哪个工作区状态、哪个命令）？
4. mesh 路径（纯 manifold）是否同样存在 wasm 存活计数增长，还是仅 BREP 链泄漏？

## 9. 根因、修复与验证（2026-09-04 已解决）

### 9.1 根因

泄漏源是 **`getSubShapes()` 查询句柄未释放**。occt-wasm 的 `getSubShapes`/`subShapeHashes` 会把每个子形状复制进独立 arena 槽位，调用方只读取几何与查询量（center/normal/surfaceType/hash/`isSame` 匹配），从不 release。重复 `execute()` 全量重跑时，每次执行产生的这些临时槽位经「顶替释放 / keep 登记」不被任何释放路径回收 → arena 线性增长。三处实测贡献：

| 泄漏点 | 文件 | 每次量级 |
|---|---|---|
| `buildSelectorManifest` 子形状枚举（face/edge/solid/shell + 逐面/逐 entry 子枚举） | `occt-kernel/topologyExt.ts` | 单 box ≈ +63 |
| `assignRoles` 的面句柄（`getSubShapes(shape,'face')`） | `topology/naming/roles.ts` | 单 box 6 面 |
| `reconstructSolidFromMesh` 的面缝合向量 | `occt-kernel/meshReconstruct.ts` | faceCount（mesh→brep 路径） |

裸 box 的 +54…+69/次即前两处之和；`topo-resolve.ts`/`chamfer.ts` 把句柄放进消费方持有的 `ResolutionContext`，属消费者续用，不在本次释放范围（见 Agent Note）。

### 9.2 修复方式

统一在「只作临时查询、不交给调用方」的 `getSubShapes` 结果处，由创建它的函数立即释放：`buildSelectorManifest` 用 `transient[] + finally` 批量释放；`assignRoles` 在读取几何 hint 后于 `finally` 释放；`reconstructSolidFromMesh` 在缝合循环末尾释放 faces（并顺手释放未返回的 `fixShape` 中间体）。

### 9.3 验证

- 归因探针（事后删除）：裸 `cad.box` 二次执行 delta = **0**（修复后），`getShapeType` 逐句柄空活验证全部为「Invalid shape ID」。
- compat e2e ⑦：`sheetmetal-flow`（growth ≤ 200）与 `mech-lib-flow`（growth ≤ 400）**实跑全绿**；`compat-op` ④ 同绿。
- 新增核心回归 `packages/core/src/cad-runtime/arena-bounded.test.ts`：裸 `cad.box` ×10，断言存活 `shapeCount` 相对预热基线 ≤ 100（修复前 ×10 ≈ +540，必然触发）。
- 相关套件：core `cad-runtime`/`api`（269）、`occt-kernel`、`brep-topology`、`step-export`、`topology/naming`、mech-lib `b7` 全绿。

### 9.4 待回答问题的收尾

1. **确切断哪条释放路径**：`keep 登记/顶替释放` 之外，`buildSelectorManifest`/`assignRoles` 的 `getSubShapes` 子句柄在未登记路径上被遗漏。
2. **裸 box 的存活 69 个来自哪**：`buildSelectManifest`（~63）+ `assignRoles`（7），均已释放，二次执行 delta = 0。
3. **「7/7 全绿」与 HEAD 必红的矛盾**：泄漏早于 P26 提交即存在（e882b77 引擎自带），当时全绿记录与今日必红不相容的历史原因未再深挖——本次修复后在当前 HEAD 上 ⑦ 稳定全绿，此矛盾不再构成风险。
4. **mesh 路径（纯 manifold）**：`shapeCount` 是 occt-wasm 侧计数，manifold 不进 occt arena；mesh 路径无 wasm 存活增长，泄漏仅发生在 BREP 链。
