# smlib 句柄泄漏（GB 级）问题说明与方案评估

- **状态**：实施中（部分方案已实现并实测，结论为"不足以根治"，待审核决定下一步）
- **日期**：2026-10-27
- **影响面**：faijs `smlib-kernel` 适配器 + `cad-runtime` 的 BREP 句柄生命周期
- **受影响端**：微信小程序（BREP 内核 = smlib，常驻 worker，从不 dispose）
- **本文档目的**：把"已尝试的方案 / 各自碰到的障碍 / 下一步打算"交代清楚，交给他人审核

---

## 1. 现象

真机（微信小程序）执行 `pikachu-1.fai.js` 到后段时崩溃、手机闪退。用户报告（原话保留）：

> 这个皮卡丘的代码分割的功能确实没有报错了，但是他似乎把分割的上下搞反了…… 还还有一个问题就是这皮卡卡丘的模型，他执到很后面的时候就死机了，手机突然闪退，已经连着发生两次了，我怀疑是不问是有什么地方内存泄漏啊，或者是句柄泄漏之类的问题导致的。还有这个项目目目前也有其他人在处理，你不要动别人代码就行了，比如说你不要轻易地做全仓的全亮的一些变更，这样可能会无意覆盖别人代码

> 这个GB泄露的问题你你到底尝试了哪几种方案？每种方案都碰到了什么问题接下来你打打算采用哪种方案？请详细写一份说明文档，然后我需要把这个问题交给其他人审核。

结论先行：**句柄泄漏被实测坐实**，量级为 GB 级（见 §2）；它是真机闪退的**充分嫌疑**，但真机闪退是否**仅**由此引起，还需真机日志佐证（渲染/拓扑峰值也可能是叠加因素）。

---

## 2. 定量实测证据

三个探针均在 node（同一份 weapp vendored `smlib_standalone.wasm`，初始堆 `INITIAL_MEMORY=134217728` = 128MB）上跑，结论如下。

### 2.1 内核级：对象只增不减

循环 `makeBox(10,10,10)`，只看 wasm 堆 `memory.buffer.byteLength`：

| 观测点 | 数值 |
|---|---|
| 初始堆 | 134,217,728 B |
| 第 1 次 grow | iter ≈ **2599**（128MB → 128.0625MB） |
| 之后 | 每约 1 次调用 grow 一次，每次 **+64KB** |

即 **每次 `makeBox` 约泄漏 50KB 且永不回收**（128MB / 2599 ≈ 51.6KB/次）。

### 2.2 端到端：重复 execute 线性增长（GB 级）

脚本（5 条语句：box / sphere / union / cylinder / subtract），用真实 `runtime.execute` 重复 30 轮：

```
30 轮同脚本 execute：wasm 堆增长 732233728 B (≈698MB)   ← 约 24MB/轮
```

30 轮就接近 0.7GB；真机反复执行/AI 迭代几十轮即 OOM 闪退。

### 2.3 附带缺陷：grow 时 DataView 失效

`libsmlibKernel.ts` 的 `memOf(k)` 每次新建 `DataView`，但在**同一次 op 调用内**跨越内核调用持续使用（如 `splitByPlane` 内 `set nrm → SmApiCutEx → set -nrm`）。当内核在其中触发 `memory.grow`，旧 buffer 被 detach → 抛 `TypeError: Cannot perform DataView.prototype.setFloat64 on a detached ArrayBuffer`。这是独立于泄漏的健壮性缺陷，会让"内存已涨起来"的进程在某个 op 上直接崩。

---

## 3. 根因

### 3.1 直接原因：`release` 是 no-op

`smlib-kernel/smlibKernel.ts` 的 `release(shape)` 当前**什么都不做**（只留注释）。`dispose()` 才是真删（遍历 `solidHandles` 调 `SmApiDeleteBrepEx`），但：

- 端侧 worker 的 smlib kernel 是**全局常驻**（`initSmlibWasm` 幂等，产物作用域内只初始化一次）；
- 除了测试与 `runtime.dispose()`，**端侧从不调用 `dispose`**。

于是每次 op 创建的 `SmBrep`（经 `newSolid(ptr)` 登记进 `solidHandles`，约 50KB/个）只有"加入"、没有"删除"。

### 3.2 为什么当初改成 no-op（不是随手写的）

`smlib-kernel/smlibKernel.ts` 的 `release` 注释与 `docs/plans/2026-10-26-smlib-brep-engine-plan.md` §388 记录了历史：初版 `release` 真删，结果 `buildTopology` 的 transient 释放（`transient` 里含 `getSubShapes(shape,'solid')` 返回的**借用**实体句柄）把 `solidCache` 仍持有的 `box2` 误删 → 后续 `buildNamingInput` 的 `subShapesHashes(box2)` 报 `GetFacesEx st=SM_ERR=1001`。于是改成"全 no-op"，把删除责任全部推给内核自身的布尔消耗与 `dispose`。

**关键点：这个 no-op 是"为了不误删"的妥协，代价就是泄漏。** 两者是一枚硬币的两面。

### 3.3 释放契约的错位

`brep/engine/primitives.ts` 的 L1 契约把 `release` 定义为"**手工释放句柄（GC 型引擎实现为 no-op）**"——即契约假设内核**自己有 GC**（brepkit 有、occt 有 arena）。smlib 是 **GC-less 的原生指针内核**（句柄 = wasm 堆 `SmBrep*`），这个契约对它是**缺失语义**：没人真正回收。

### 3.4 泄漏的两个来源

1. **输出句柄**：每条语句的产物登记进 `runtime.solidCache`（键 = PartName）；重赋值/重执行时旧值被 `Map.set` 覆盖，旧句柄无释放路径。
2. **op 内中间体**（主要来源）：每个 op 内部还会创建大量 `SmBrep`（副本化、内核内部对象等）；它们是"局部临时"，本应 op 内释放，但对 smlib 没有任何释放路径生效（`release` no-op）。

---

## 4. 已尝试的方案与各自碰到的障碍

### 方案 0：维持现状（`release` no-op）——基线

- 结果：泄漏，GB 级（§2）。
- 不采纳。

### 方案 A：纯引用计数（根治方向）

**做法**：`smlibKernel` 内把 `solidHandles`（Set）升级为引用计数表——

- `newSolid(ptr)`：登记并计数 +1（创建者拥有）；
- `release(h)`：登记过的递减，归零才 `SmApiDeleteBrepEx`；未登记（face/edge 借用指针）no-op；
- `dispose()`：清空全部。

**实测结果**：立刻暴露 **6 个既有用例 `1001` 失败**（10 个测试文件里 3 个文件）：

```
[smlib-kernel] getSubShapes(face): bridge failed (n=1001, shape=5629632)   ← buildNamingInput
FAIL  engine-switch-smlib.test.ts > extrude：面实体沿 +Z 拉伸成体
```

**障碍**：faijs 里有**几十处 `release()` 调用点**，它们此前**全部**依赖 smlib `release` 是 no-op 才无害——其中大量释放的是**借用/输入句柄**（它们并不拥有该对象）。一旦 `release` 真删除，就误删下游仍在用的对象。已知调用点分布（节选）：

| 文件 | 调用点（行号） |
|---|---|
| `api/boolean.ts` | 147, 154–155, 158, 192, 252 |
| `api/brep-operations/compoundFns.ts` | 63, 197, 233, 237, 243–244, 280, 284, 290–291, 327 |
| `api/brep-operations/joinery-brep.ts` | 312–314, 319, 364, 403, 527, 531–532, 546–547, 634–635, 652–653 |
| `api/brep-operations/primitiveFns.ts` | 35, 57, 105 |
| `api/brep-operations/patternFns.ts` | 39, 212 |
| `api/brep-operations/hullFns.ts` / `healingFns.ts` | 46 / 268 |

要让 A 成立，必须**逐文件校正这几十处的所有权语义**（谁创建、谁持有、谁负责释放），这属于跨多个 op 文件的大范围改动——与用户"别大改、别跟别人撞"的要求直接冲突（用户原话见 §1）。

**处置**：已实测后**回滚**，仓库回到全绿。

### 方案 B：受控释放（新增 `disposeHandle`，仅在 runtime 侧真删）

**做法**（当前工作区已实现，未提交）：

- `smlibKernel` 新增 `disposeHandle(shape)`：只删登记过的 `SmBrep*`（未登记 no-op）；
- L1 契约 `BrepEngineApi` 加**可选** `disposeHandle?`（GC 型引擎不实现 → runtime 回退 `release`）；
- 只在 runtime 的持有者释放点调用它：
  - `cad-runtime/runtime.ts`：新增私有 `disposeSolidHandle(h)`，用于 `setSolidAndTess`（覆盖旧值）、`releasePartCaches`、`dispose`；
  - `brep/brep-chain.ts`：`releaseBrepChainState` 改用 `disposeHandle`。
- 各 op 的 `release()` 维持现状（引用语义、不删）。

**实测结果**：

- 回归面：**64 文件 828 项全绿**（受控释放没有破坏任何既有用例）；
- 泄漏面：新增回归测试 `test/smlib-kernel/smlib-handle-reclaim.test.ts`（重复 execute 30 轮）——**失败**：

```
AssertionError: wasm 堆增长 732233728 B 应 < 2MB   （≈24MB/轮）
```

**障碍**：受控释放只覆盖 `solidCache` 里**每轮被覆盖的 ~5 个输出句柄**；op 内中间体（`union`/`subtract` 的 copy、内核内部对象，每轮几十~上百个）**没有任何释放路径**（`release` 仍是 no-op）。即：**只在 runtime 侧补释放点，覆盖不到 op 内中间体**。

**结论**：受控释放**不足以根治**，只能算"治了输出句柄那一半"。

### 方案 C（未实施）：每轮全量 execute 前清空 GC-less 内核

**做法**：对支持 `disposeHandle` 的 GC-less 引擎，在**全量 execute 开始前**调 `kernel.dispose()` 清空全部内核对象，并清 runtime 相关缓存，靠随后"整段代码重放"重建。

**预期**：每轮归零，泄漏不再跨轮累积。

**已知风险/障碍（未验证）**：

1. **悬垂句柄**：上一轮返回给上层的 `brep handle` 会被删；若 3d_editor 的 worker/主线程跨 execute 持有旧句柄（导出、装配、undo），会 use-after-free。需先确认外部不跨轮持旧 handle。
2. **增量执行**：DirectExecutor 有 `append/update`（增量重放，不重跑全段），这类路径**不能**清空内核。

### 方案 D（未实施）：方案 A 的补全版

内容 = A 的引用计数 + 逐文件修正几十处 `release` 所有权语义。改动最大、最彻底；与"别大改"冲突，但若定位后只改真正泄漏的少数路径，可缩小范围（见方案 E）。

### 方案 E（未实施，候选）：轮末释放"非终端"句柄（受控 + 批量）

**做法**：`smlibKernel` 已记录全部创建的 solid（`solidHandles`）。新增 `releaseAllExcept(keep: Set<handle>)`：释放本内核中**不属于 keep** 的全部句柄；runtime 在 execute 结束（结果收集完）后调用，`keep` = 当前 `solidCache` 的全部句柄 + 网格实体句柄。

**预期**：能覆盖 op 内中间体（它们也被 `newSolid` 登记），且**保留终端句柄**（避免方案 C 的悬垂问题）。

**风险**：需确认 `keep` 集合完备（漏掉某个仍需持有的句柄会误删）。仍属"内核 + runtime"改动，不碰 op 文件。

---

## 5. 方案对比

| 方案 | 改动面 | 能否覆盖 op 内中间体 | 主要障碍 | 状态 |
|---|---|---|---|---|
| 0 现状 | 无 | — | 泄漏 GB 级 | 基线 |
| A 纯引用计数 | kernel + 几十处 op | 能 | 需逐点修 `release` 语义，误删风暴 | 实测后回滚 |
| B 受控释放 | kernel + runtime + brep-chain | **否**（仅输出句柄） | 30 轮仍 +698MB | 已实现，不足 |
| C 每轮全量重建 | kernel + runtime | 能 | 上轮 handle 悬垂；增量不能清 | 未实施 |
| E 轮末释放非终端 | kernel + runtime | 能 | `keep` 集合必须完备 | 未实施（候选） |
| D A 补全版 | kernel + 几十处 op | 能 | 大范围改动 | 未实施 |

---

## 6. 接下来打算采用的方案（待审核）

**推荐：先按方案 E（轮末释放非终端句柄）推进，并把方案 C 作为兜底。**

理由：

1. E 的改动面与 B 同级（只在 `smlibKernel` + `runtime`），**不碰那几十处 op 的 `release`**，符合"不做全仓变更、不覆盖他人代码"的约束；
2. E 基于内核已有的 `solidHandles` 登记，能覆盖 op 内中间体——这正是 B 覆盖不到的部分；
3. 相比 C，E 保留终端句柄，回避"上轮 handle 悬垂"的外部依赖问题。

落地步骤与验收：

1. `smlibKernel` 新增 `releaseAllExcept(keep)`（宁可保守：未列入 keep 的登记句柄才释放）。
2. `runtime` 在 `execute` 结果收集完成后调用，`keep` = `solidCache` 全部句柄 + 网格实体句柄；**增量（append/update）路径不调用**。
3. 同时修 §2.3 的 DataView detach 缺陷（grow 后重取视图）。
4. 验收判据：
   - `test/smlib-kernel/smlib-handle-reclaim.test.ts` 由红转绿（30 轮增长 < 2MB）；
   - 现有 64 文件 828 项回归保持全绿（重点：`engine-switch-*`、`api/split-by-plane*`、拓扑/命名链）；
   - 3d_editor 端到端：`faijs-worker-loopback.pikachu-example.test.ts` + `weapp worker-sim` 全绿；
   - 若 E 出现 `keep` 集合漏项导致的 `1001`，则降级到 C 并先做"外部是否跨轮持 handle"的确认。

**并行待办（与泄漏解耦，但真机闪退需一起看）**：

- 真机日志（`[weapp-exec-timing]`/内存曲线）确认闪退主因是否是泄漏；
- 评估 wasm 初始堆 `INITIAL_MEMORY=128MB` 在 iOS 微信的占用是否本身就是闪退叠加因素（如需，可评估调小初始堆 + 允许增长）。

---

## 7. 待审核问题清单

1. **方案 E 的 `keep` 集合边界**：除 `solidCache` 与网格实体句柄外，是否还有其它必须跨轮保留的句柄（如 `brepSolids` 导出条目、装配/动画持有的句柄、undo 栈）？请审核者指出遗漏。
2. **方案 C 的可行性**：3d_editor worker 是否存在**跨 execute** 持有旧 `brep handle` 的地方？若有，C 必须排除。
3. **是否接受方案 D（大改）**：若要求彻底、且允许改那几十处 op 的 `release` 语义，D 才是终局；请评估该改动面是否可接受。
4. **`release` 契约修订**：L1 目前把 `release` 定义为"GC 型 no-op"。smlib 是 GC-less，是否应把该契约明确拆成"引用语义 `release`"与"受控真删 `disposeHandle`"两级（本方案 B 已引入 `disposeHandle`，需确认是否作为正式契约）。
5. **验收阈值**：`30 轮 < 2MB` 是否合适？是否需要更长的稳定性跑（如 200 轮）作为真机前的硬门禁。

---

## 8. 附：当前工作区改动清单（未提交）

faijs（问题真源，本节所有代码位置均在此）：

| 文件 | 改动 | 性质 |
|---|---|---|
| `packages/core/src/smlib-kernel/smlibKernel.ts` | `splitByPlane` 交换法向（positive=法向正侧）；新增 `disposeHandle` | 方向修复 + 受控释放 |
| `packages/core/src/brep/engine/primitives.ts` | `BrepEngineApi` 加可选 `disposeHandle?` | 契约 |
| `packages/core/src/cad-runtime/runtime.ts` | 新增 `disposeSolidHandle`；`setSolidAndTess`/`releasePartCaches`/`dispose` 改用它 | 受控释放 |
| `packages/core/src/brep/brep-chain.ts` | `releaseBrepChainState` 改用 `disposeHandle` | 受控释放 |
| `packages/core/test/smlib-kernel/smlib-split-direction.test.ts` | 新增（方向回归，绿） | 测试 |
| `packages/core/test/smlib-kernel/smlib-handle-reclaim.test.ts` | 新增（泄漏验收，**当前红**） | 测试 |
| `packages/core/test/smlib-kernel/smlib-p2-ops.test.ts` | 纠正被固化的方向断言 | 测试 |

已提交（供对照）：faijs `68ddc71`（split 成员命名 + smlib 桥 4×4 修复，0.45.8）、3d_editor `c6b5e6a4`（升级 0.45.8 + 新 wasm）。

3d_editor：仅 `packages/weapp/src/smlib/smlib_standalone.wasm`（随 0.45.8 更新）与新 e2e 测试；**未触碰其它人的代码**。

> 注：`smlib-handle-reclaim.test.ts` 目前是**红**测试，是"泄漏未根治"的显式验收判据；在方案落定前建议保留为红（或临时 `it.fails`），不要静默跳过。