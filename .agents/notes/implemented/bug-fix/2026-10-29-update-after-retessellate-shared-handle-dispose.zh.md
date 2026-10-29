# Agent Note：CadRuntime solid 缓存的共享句柄感知释放

Status: implemented

[English](2026-10-29-update-after-retessellate-shared-handle-dispose.md) | 中文

## Problem

weapp 皮卡丘模型在 LOD 精化流程后崩溃：`execute` → `retessellate`（精化到 L1）→
AI 编辑 → 增量 `update`。故障从 `[smlib-kernel] getSubShapes(face): bridge failed
(n=1001, …)` 开始，大脚本升级为 wasm `memory access out of bounds`，真机上表现为
NaN 顶点 → NaN 相机 → 整画布空白（数据完好）。

node worker-sim 复现钉死了触发条件：**没有** `retessellate` 时 `update` 通过；
**有**则必崩——与 `splitByPlane` 无关。因此缺陷在 faijs 内部的
`retessellate` × `update` 交互里。

探针测试 + `disposeHandle` 监视把杀链逐帧钉死（转储句柄值：ball=scaled=body=0x54…、
eye=eyeMoved=0x54…）：

1. smlib 变换类 op **原地写回**——`translate`/`scale3d` 返回同一句柄——于是多个
   `solidCache` 条目共享一个句柄（eye=eyeMoved；ball=scaled=body）。
2. `update` 的重放逻辑调用 `releasePartCaches(replayKeys)`，无视共享，把共享句柄
   真删，而未参与重放的兄弟条目仍引用它。兄弟条目悬垂，重放在**已释放的 wasm
   内存**上执行（node 下 ghost 调用侥幸通过；真机读已释放堆产生 NaN）。
3. 释放内存上的重放失败，`update` 降级为全量重执行。分配器把刚释放的块复用给新
   solid，该地址在内核句柄表里重新注册。`setSolidAndTess` 随后释放它的**陈旧**
   prev 句柄——守卫 `solidHandles.has(n)` 通过，因为该地址已有新的活体租户——
   把活体真删。
4. 收尾拓扑重建（被 `retessellate` 清空的 `topologyCache` 强制触发）读取被杀的
   solid → SM_ERR 1001 → 规模上去后 wasm OOB。

「对照组」路径（无精化的 update）同样不健康：它通过只是因为重放恰好跑在
释放但未改写的 ghost 内存上，且拓扑缓存命中掩盖了重建。修复前两条路径都在
已释放内存上操作。

## Decision

`CadRuntime` 的句柄释放改为**共享感知：最后一个引用者释放**，落在单一收口点
（`packages/core/src/cad-runtime/runtime.ts`）：

- `disposeSolidHandle` 在 `solidCache` 或 `meshSolidRegistry` 仍有条目引用该句柄时
  跳过真删（`isSolidHandleReferenced` 扫两张表）。
- 调用方**先**移除自身引用，**再**释放：
  - `setSolidAndTess` 先覆盖缓存条目，再释放 prev（自身条目不再算引用者）；
  - `releasePartCaches` 先删键，再释放句柄——共享该句柄的兄弟条目让它保持存活，
    重放于是跑在活体上；
  - `dispose()` 先把句柄快照进 `Set`、清空两张注册表，再逐个释放（否则共享守卫
    会拦住 teardown 里的共享句柄，整个缓存泄漏）。

修复后探针的重放在活体上执行、成功且不降级，收尾从活体 solid 重建拓扑——整条
流程不再有任何已释放内存操作。

回归钉在 `test/cad-runtime/update-after-retessellate.probe.test.ts`：对照组（无
精化）+ 崩溃探针（execute → retessellate → update），断言 update 成功、
`solidCache` 全部句柄经 `getSubShapes` 仍可查询、终端拓扑在 `topologyCache`
中完成重建。

## Alternatives considered

- **在 `retessellateOne` 里失效 `faceEvolutionCache`/`roleTableCache`。**
  作为修复方案被证伪：监视显示 `retessellate` 既不杀也不释放任何句柄；它唯一的
  作用是清空 `topologyCache`，崩溃只是在那里*暴露*。杀发生在 `update` 的
  释放/重放/降级路径。
- **改 smlib 内核（变换改拷贝、不原地写回）。** 所有权在 runtime 的持久
  `solidCache`；内核不知道哪些零件仍引用一个 shape。消灭共享还会让每条变换链的
  wasm 内存成倍增长。持有缓存的 runtime 必须持有生命周期。
- **地址复用检测（释放前对比 tombstone）。** 脆弱：依赖分配器行为，且仍需要知道
  谁在引用句柄。扫两张小表是确定性的、代价低。
- **宁可泄漏（共享有歧义就干脆不释放）。** 否决：handle-reclaim、leak-isolation、
  arena-bounded 这些套件存在的意义就是让 wasm 堆有界；「安全的泄漏」直接回退这些
  保证。

## Consequences

- `releasePartCaches` 不再释放与非重放零件共享的句柄；被重放语句在活体上执行；
  降级全量路径不再可能杀死复用地址的租户。
- 没有引入泄漏：最后一个引用者仍会释放，重构后的 teardown（`dispose`）不可能被
  守卫拦住。由既有 `smlib-handle-reclaim`、`scope-import-transients`、
  `arena-bounded` 套件，加上 cad-runtime / smlib-kernel / tessellation-lod 全量
  运行验证（65 文件、705 测试全绿；改动文件 typecheck 与 lint 干净）。
- weapp「精化后 update」流程从源头不再产生 NaN 顶点。设备侧表现层修复（相机落后
  一帧、精化调度）是另外的事，在 3d_editor 仓库。
- 仍开放、不在本次范围：`retessellateOne` 只失效
  `topologyCache`/`namingCache`（`faceEvolutionCache`/`roleTableCache` 未动——潜在
  陈旧，暂无观察到的缺陷）；原地变换别名意味着共享 solid 的 BREP 会跟随兄弟变换，
  而它的缓存显示 mesh 不会——目前被掩盖，因为共享零件不是终端。
