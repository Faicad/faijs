# smlib 内存/闪退问题：考古 + 复现 + 根因报告

> 日期：2026-10-29
> 范围：usd-brep / faijs / 3d_editor 三项目联合，定位「weapp 端加载 pikachu-1.fai.js 随机闪退」
> 方法：只读考古（plan + commit diff + 源码精读）+ node 端复现探针（不改业务代码）
> 结论先行：**GB 级跨轮泄漏已被 680803b 根治（node 实测 wasm 堆恒定 128MB）；weapp 首载随机闪退的剩余根因不是「堆涨爆」，而是 (a) 句柄生命周期 UAF/重释放 + (d) 微信端 128MB wasm 初始堆预算，叠加 (c) 永不清理的 face/edge 借用句柄登记表。**

---

## 0. TL;DR

| 问题 | 实测结论 |
|---|---|
| 单轮 pikachu execute（node，weapp 同款 wasm） | **成功**，wasm 堆恒定 128MB（零增长），v8 heap 68→74MB |
| 预热+sweep 后，全新 runtime 再跑 pikachu | **成功**（内核单例未被轮末清扫损坏） |
| **同一持久 runtime 重跑 pikachu** | **在 splitByPlane→makeBox 处 SM 1007 崩溃**，wasm 堆仍恒定 128MB |
| GB 级跨轮泄漏（2026-10-27 实测 30 轮 ≈698MB） | 680803b 已根治（round-end sweep + C++ SmPolyBrep 桥泄漏修复） |

复现测试文件：
- `C:\my\Faicad\faijs\packages\core\test\smlib-kernel\smlib-memory-leak.repro.test.ts`
- `C:\my\Faicad\faijs\packages\core\test\smlib-kernel\smlib-leak-isolation.repro.test.ts`

---

## 1. 历史考古：之前尝试了几版方案？为什么都没解决？

按时间顺序共 **7 版**（含初始接入）。每版改了什么、为什么没根治 weapp 闪退：

### v0 — P0–P4 初始接入（2026-10-26，commits `59555d5`/`8aa7582`/`a88c343`/`dca1013`）
- 方案文档：`docs/plans/2026-10-26-smlib-brep-engine-plan.md`。
- **关键决策（泄漏的源头）**：P1.3.2（plan 第 388 行 / smlibKernel.ts:658-665）把 `release(shape)` 做成 **no-op**。原因：初版 `release` 真删 `SmBrep`，结果 `buildTopology` 的 transient 释放把 `solidCache` 仍持有的 `box2` 误删 → `subShapeHashes(box2)` 报 `GetFacesEx st=1001`。
- **为什么没解决**：这一版直接埋下「GC-less 内核 + no-op release = 只增不减」的根。`solidHandles` 只 `add` 不 `delete`（除布尔消耗外）。

### v1 — 方案 A：纯引用计数（2026-10-27，实测后回滚）
- 文档：`docs/plans/2026-10-27-smlib-handle-leak-plan.md` §方案 A。
- 做法：`solidHandles` 升级为引用计数，`release(h)` 递减归零才 `SmApiDeleteBrepEx`。
- **为什么没解决**：立刻暴露 **6 个既有用例 `1001` 失败**（`api/boolean.ts:147/154-158/192/252`、`compoundFns.ts`、`joinery-brep.ts` 等几十处 `release()` 调用点全都依赖 release 是 no-op 才无害——它们释放的是借用/输入句柄）。已回滚。

### v2 — 方案 B：受控释放 `disposeHandle`（2026-10-27 工作区实现，未根治）
- 文档同上 §方案 B。新增 `disposeHandle(shape)`（只删登记过的 SmBrep），runtime 在「覆盖旧值/缓存失效/dispose/链释放」时调用。
- 实测：**64 文件 828 项全绿**，但泄漏验收测试 `smlib-handle-reclaim.test.ts` 仍**红**：`wasm 堆增长 732233728 B 应 < 2MB`（≈24MB/轮）。
- **为什么没解决**：受控释放只覆盖 `solidCache` 每轮被覆盖的 ~5 个输出句柄；**op 内中间体**（布尔 copy、splitByPlane 半空间盒、内核内部对象，每轮几十~上百个）没有任何释放路径（release 仍是 no-op）。「只治了输出句柄那一半」。

### v3 — 方案 E：round-end sweep + C++ 桥泄漏修复（commit `680803b`，2026-10-27 20:49）★主修复
- diff 摘要（`git show 680803b`）：
  - TS 侧新增 `releaseAllExcept(keep)`（smlibKernel.ts:675-704）：登记表里除 keep 外的句柄一律 `SmApiDeleteBrepEx`；runtime `sweepGcLessTransients`（runtime.ts:1021-1032）在 execute/append/update 结果收集后调用，keep = solidCache + meshSolidRegistry。
  - 布尔 `booleanOp` 补 `if (result !== pa) solidHandles.delete(pa)`（smlibKernel.ts:646）——非流形等边缘路径会消耗 pa，不删会导致轮末清扫对悬垂指针双释放。
  - **每次内核调用后重取 DataView**（`memOf(k)`）——`memory.grow` 会 detach 旧 buffer（§2.3 健壮性）。
  - **C++ 侧**：`SmApiTessellateEx` 桥每次三角化泄漏内核侧 `SmPolyBrep`（≈27MB/轮），重编 wasm 后全路径删除。
- 验收（commit message）：30 轮 box/sphere/union/cylinder/subtract 堆保持 128MB。
- **为什么仍没解决 weapp 闪退（本报告实测补充）**：
  1. sweep **只在轮末跑一次**；单轮 execute 进行中，op 内中间体全程堆积（weapp 单轮就崩，轮末清扫来不及）。
  2. sweep 走 `SmApiDeleteBrepEx` 直删（smlibKernel.ts:699-703），**没有像 disposeHandle（:672）那样清 `triCacheByMemory`**——不一致。
  3. **faceHandles/edgeHandles 两个登记表（:85-86）永不清理**（详见 §3.4）。
  4. 本报告复现：同一持久 runtime 重跑 pikachu 仍在 `makeBox SM1007` 崩（§2.2）——说明轮末清扫 + 重执行的句柄交接仍有 UAF。

### v4 — `7a9c051`（2026-10-28 02:38）：meshShape 返回值拷出
- 修复 `meshShape` 返回指向桥 malloc 缓冲的 TypedArray view，finally 里 free 了缓冲 → 后续读到已释放/被 malloc 复用的垃圾（首三角顶点 (0,0,0)）。改为 `verts.slice()/normals.slice()/indices.slice()`（smlibKernel.ts:1650-1658）。
- **为什么没解决**：这是**渲染缺陷**（网格错位），不是内存泄漏/trap。commit message 明确「smlib line must NOT be released yet」。

### v5 — `ea02461`（2026-10-28 16:14）：bbox 按句柄种类分派 ★UAF 现场
- 根因：`getBoundingBox` 对所有句柄都调 `SmApiBrepBoundingBox(const SmBrep*)`，把 `SmFace*` 当 `SmBrep*` 解引用——**C++ 类型混淆**。20³ 盒 6 面实测 1 面 wasm OOB trap，其余返回倒置/退化/1e20 空盒。
- 修复：`getBoundingBox` 按 `faceHandles/edgeHandles/solidHandles` 分派到 Face/Edge/Brep 版（smlibKernel.ts:2168-2177）；`containsPoint` 从 unsupported 桩改为三角化+射线奇偶。
- **为什么没解决**：这只是堵住了**一条**类型混淆路径。`faceHandles/edgeHandles` 登记表本身的生命周期问题（§3.4）仍在。

### v6 — `4156d24`（2026-10-28 17:07）：shell 结果面朝向
- shell 返回前补 `SmApiUnifyNormalsEx`（smlibKernel.ts shell 区段），修内壁法向朝材料。
- **与 pikachu 无关**（pikachu 不用 shell/chamfer/fillet）。

### 双引擎方案（`2026-10-28-occt-smlib-dual-engine-api-plan.md`）与 weapp 切换方案（`2026-10-27-weapp-smlib-engine-switch-plan.md`）
- 这两份是**能力对账/切换**文档，不是泄漏修复。weapp 切换方案 §5 R1 早已标记「微信真机对 EH wasm（invoke_* 转发）兼容性从未真机验证」为**最高风险项**——本报告 §4 认为这是 weapp 闪退的环境级嫌疑之一。

---

## 2. 复现实验（node，weapp 同款 wasm）

### 2.1 实验设置
- wasm：weapp vendor 与 faijs vendor **字节级一致**（`smlib_standalone.wasm` 6,936,012 B，sha256 `2BEE82D688A8997C…`，即 `7a9c051` 含泄漏修复版）——**排除「端侧跑旧 wasm」**。
- 脚本：真实 `3d_editor/docs/examples/pikachu-1.fai.js`（14 球体 + 2 次 splitByPlane + 尾杆 3 box×2 union + 1 group）。
- 判决量：`memory.buffer.byteLength`（wasm 堆单调高水位）+ `process.memoryUsage().heapUsed`。
  注：`solidHandles` 是 smlibKernel.ts:66 的模块级私有 `Set`，未导出、未挂 globalThis，外部无法读 size——沿用 2026-10-27 方案 §2 的堆字节口径。

### 2.2 实测数据

| 场景 | wasm 堆 | v8 heap | 结果 |
|---|---|---|---|
| 预热（fresh runtime 跑 pikachu ×1） | 128.0 MB（初始，未增长） | 68→74 MB | ✅ `failedAt=undefined` |
| 预热+sweep 后，**裸 makeBox 探针** | — | — | ✅ 返回正常句柄 6350064 |
| 预热+sweep 后，**全新 runtime** 跑 pikachu | — | — | ✅ `failedAt=undefined` |
| **同一持久 runtime 重跑 pikachu（loop round 1）** | 128.0 MB（**仍零增长**） | 80.8→74.5 MB | ❌ index 12 / `splitByPlane` / `makeBox failed: SM status 1007` |

关键判读：
1. **GB 级跨轮泄漏确已根治**：单轮 wasm 堆恒定 128MB，没有 2026-10-27 的「每轮 ≈24MB」线性增长。
2. **重跑崩溃时堆零增长** → 不是 OOM/malloc 返回 0，而是**句柄生命周期错误（UAF/双重释放）导致内核进入坏态**，后续 `SmApiCreateBox` 返回 1007（INVALID_INPUT）。
3. **内核单例未被轮末清扫损坏**（隔离探针：全新 runtime 重跑成功）→ 故障在「同一 runtime 持久重执行」的句柄交接，不在 sweep 本身。

### 2.3 如何复现
```powershell
cd C:\my\Faicad\faijs
# 隔离探针（证明内核未坏）：
$env:REPRO_PROBE='1'; npx vitest run test/smlib-kernel/smlib-leak-isolation.repro.test.ts
# 重跑崩溃（同一 runtime 循环）：
$env:REPRO_LEAK='1'; $env:REPRO_ROUNDS='5'
npx vitest run test/smlib-kernel/smlib-memory-leak.repro.test.ts
```
（`.repro.test.ts` 默认 skip，需上述 env 开启；不进 CI。）

---

## 3. 根因分析（精读 smlibKernel.ts 2451 行）

### 3.1 `booleanOp()`（smlibKernel.ts:616-654）逐分支核对

```
624  SmApiBrepCopy(a, aCopy)   → pa = copy(a)
625  SmApiBrepCopy(b, bCopy)   → pb = copy(b)   ← pb 从不登记进 solidHandles
631  solidHandles.add(pa)
633  SmApiBoolean*(pa, pb, out)  ← 原地消耗：pa 变结果、pb 被内核 delete
```

| 分支 | pa（copy a） | pb（copy b） | 评估 |
|---|---|---|---|
| 成功，`result===pa`（流形标准布尔） | 登记→原地变结果→保留 | 内核 delete（未登记，无双重释放） | ✅ 正确 |
| 成功，`result!==pa`（非流形边缘） | :646 `delete(pa)`（被内核消耗） | 内核 delete | ✅ 680803b 已补防御 |
| **失败（st≠1000）** | :636-637 delete + `SmApiDeleteBrepEx(pa)` | **既不登记也不 delete**（注释 :635「pb 归属内核，不碰」） | ⚠️ **若内核失败路径不删 pb，pb 泄漏** |

- **可疑点答案**：
  - b 副本（pb）被内核 delete 后是否还在 solidHandles？→ **从未登记，不在表里**，正确。
  - `result===pa` 时 pb 副本有没有 delete？→ pb 由内核在成功路径 delete；TS 侧不碰，正确。
  - **失败时 pb 副本有没有 delete？→ 没有**（:634-638 只删 pa）。这是一个**真实泄漏路径**，但 pikachu 的布尔都成功，未触发。

### 3.2 临时对象登记情况（哪些入 solidHandles、哪些没入）

| API | 临时对象 | 是否登记 | 释放路径 |
|---|---|---|---|
| makeBox/Cylinder/Sphere… | `newSolid(ptr)` | ✅ 登记 | 轮末 sweep / disposeHandle |
| booleanOp pa（copy a） | :631 add | ✅ | 同上 |
| booleanOp pb（copy b） | — | ❌ 从不登记 | 靠内核消耗（成功路径）；**失败路径泄漏** |
| splitByPlane 的 posBox/negBox | `makeBoxFromCorners→makeBox→newSolid` | ✅ | 轮末 sweep（finally 里 `primitives.release()` 是 no-op，不删） |
| translate/scale/rotate/transform | **in-place**（:476/1202/1224/1249 返回原句柄），不产新对象 | — | 无泄漏（in-place 是内存友好的） |
| meshShape 的 `buf`（桥 malloc） | :1662 `k.free(buf)` | — | ✅ finally 释放；C++ SmPolyBrep 已在 wasm 修复 |
| getSubShapes 返回的 face/edge | `noteFaceHandles/noteEdgeHandles` 登记进 **faceHandles/edgeHandles** | 借用 | 见 §3.4——**永不清理** |

### 3.3 `disposeHandle` / `SmApiDeleteBrepEx` 调用点全清单

| 调用点 | 位置 | 行为 |
|---|---|---|
| `disposeHandle(shape)` | smlibKernel.ts:666-674 | 删登记表 + **清 triCache** + `SmApiDeleteBrepEx` |
| `releaseAllExcept(keep)` | :699-703 | 遍历 solidHandles，非 keep 者 delete + `SmApiDeleteBrepEx`，**但不清 triCache** |
| `dispose()` | :705-707 | 遍历全表 `SmApiDeleteBrepEx` + clear |
| booleanOp 失败 | :637 | `SmApiDeleteBrepEx(pa)` |
| runtime `disposeSolidHandle` | runtime.ts:2503+ | 覆盖旧值/缓存失效/dispose 时 → kernel.disposeHandle |

**缺口**：`releaseAllExcept` 与 `disposeHandle` 对 triCache 的清理不一致（前者漏清）。`triCacheByMemory`（:121）键是 memory，disposeHandle 清单条，containsPoint 缓存满 8 条整体 clear（:2084）——**清扫时机基本完备，但 releaseAllExcept 路径漏清**。

### 3.4 ★ face/edge 借用句柄登记表永不清理（最大潜伏 UAF）

- `faceHandles = new Set()`（:85）、`edgeHandles = new Set()`（:86）是**模块级、只增不减**。
- 每次 `getSubShapes(shape,'face'/'edge')`（:1831/:1848）都把内核返回的 `SmFace*/SmEdge*` 指针登记进去。
- 这些 face/edge 是 **brep-owned 借用指针**——父 solid 被 `releaseAllExcept`/`disposeHandle` 删除时，C++ 会连带释放其 face/edge，但 **faceHandles/edgeHandles 里的指针条目不删**。
- 后果：
  1. 登记表随执行轮次**单调膨胀**（weapp worker 常驻，只增不减）；
  2. 被释放的 face 地址日后被 malloc 复用时，`faceHandles.has(复用地址)` 仍为真——若该地址恰好被传给 face 类 API（`SmApiFaceBoundingBox`/`SmApiFaceGetBoundaryLoopsEx`），就是对**已释放 SmFace 的 UAF**。ea02461 修了「类型分派」，但没修「登记表里的悬垂指针」。
- 这与 §2.2 重跑时 `makeBox SM1007` 的坏态相容：重执行中 dispose 旧 solid → 旧 face 指针悬垂在 faceHandles → 后续按表分派时踩中。

### 3.5 与 brepkitKernel 对比：为什么 brepkit 不闪退

- brepkit 是 **GC 型内核**（wasm-bindgen + Rust 侧引用计数/Drop）。其 `release`/`dispose` 都是 **no-op**（brepkitKernel.ts:726-727），对象生命周期由 Rust 自己 GC。
- smlib 是 **GC-less 原生指针内核**（裸 C++ `new`，无 GC）。faijs L1 契约把 `release` 定义为「GC 型引擎 no-op」——这个契约对 smlib **语义缺失**（2026-10-27 方案 §3.3 已指出）。适配器被迫用模块级 `solidHandles` Set 手工模拟 GC，但没有 per-statement/per-runtime 作用域，也没有原子的句柄所有权追踪。
- **结论**：不是 smlib 几何算错，是「GC-less 内核套了一个不完整的手工 GC」。

---

## 4. 根因排序（证据支撑）

| 排名 | 类别 | 判定 | 证据 |
|---|---|---|---|
| **#1** | **(a) TS 句柄生命周期 UAF / 重释放** | **最可能** | §2.2：同一 runtime 重跑 pikachu 在 `makeBox SM1007` 崩，堆零增长（非 OOM）；§3.4 face/edge 登记表永不清理；§3.1 失败分支 pb 泄漏 |
| **#2** | **(d) wasm 堆配置 / 微信内存预算** | **高度可疑（环境级）** | INITIAL_MEMORY=128MB（weapp 切换方案 §3.2/§5 R2）；手机 worker 内存受限时 memory.grow 失败 → malloc 返回 0 → 指针解引用 trap → 微信内核直接杀进程（无 JS 堆栈），与「随机语句、无堆栈、每次不同」吻合 |
| #3 | (c) 句柄类型混淆 UAF | 部分修、潜伏仍在 | ea02461 修了 bbox 分派，但 faceHandles/edgeHandles 悬垂条目（§3.4）未修 |
| #4 | (b) C++ 内核内部临时对象泄漏 | 主要项已修 | SmPolyBrep 桥泄漏已在 680803b 重编 wasm 修复；端侧 wasm 已是修复版（sha 一致）。残余：booleanOp 失败分支 pb 泄漏（pikachu 未触发） |
| #5 | (e) 多实例/Worker 句柄串通 | **排除** | §2.2 隔离探针：单 kernel 单例，全新 runtime 重跑成功；不存在第二个 smlib 实例 |

### 为什么 v3–v6 都没根治 weapp 首载闪退
- v3 治的是**跨轮** GB 泄漏（node 已证堆平），但 weapp 是**单轮首载**就崩——轮末清扫在单轮结束才跑，救不了单轮中途。
- v5 只堵了**一条**类型混淆路径（bbox）；face/edge 登记表的悬垂指针、重执行的 dispose 交接仍在。
- 环境级 #2（128MB 初始堆 + 微信 EH/invoke 转发，weapp 方案 R1 自承「从未真机验证」）从未被任何一版触碰。

---

## 5. 阻塞 / 待确认

1. **真机日志缺失**：weapp 闪退无 JS 堆栈，本报告只能 node 侧推断。需要真机 `[weapp-exec-timing]`/内存曲线，确认首载崩溃是 malloc-trap（堆涨）还是 invoke-null-function（EH 转发）。
2. **重执行 1007 的精确机制**：§2.2 复现的「同一 runtime 重跑 makeBox 1007」尚未二分定位是 disposeSolidHandle 误删 live handle，还是 faceHandles 悬垂分派——需在复现测试里加内存断点式探针。
3. **微信 EH/invoke 转发**：weapp 方案 R1 至今未真机返回码校验验证，是环境级最大盲区。

---

## 附：关键文件与 commit 索引
- 适配器：`packages/core/src/smlib-kernel/smlibKernel.ts`（booleanOp :616-654；release/disposeHandle/releaseAllExcept :658-708；face/edge 登记 :85-98；bbox 分派 :2168-2177；containsPoint :2065-2089）
- 轮末清扫：`packages/core/src/cad-runtime/runtime.ts`（sweepGcLessTransients :1021-1032；execute/append 调用 :1044/:1061）
- commit：`680803b`（round-end sweep + C++ SmPolyBrep 修复）、`7a9c051`（meshShape 拷出）、`ea02461`（bbox kind 分派）、`4156d24`（shell 法向）
- 复现测试：`packages/core/test/smlib-kernel/smlib-memory-leak.repro.test.ts`、`smlib-leak-isolation.repro.test.ts`
