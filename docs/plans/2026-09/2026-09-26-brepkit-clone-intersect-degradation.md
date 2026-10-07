# brepkit 适配器 clone / intersect 优雅降级方案

> 日期：2026-09-26
> 状态：已落地
> 关联：multi-engine-op-parity 测试框架、A/B/C/D 批 brepkit 适配器修复

## 用户需求（原话）

> 「不支持这两个App必须要支持呀，因为jishu能力其实都是具备的区别，只是在拓普普扩展方面，这应该可以优雅降级或者怎么处」

即：当前在 brepkit 上完全不可用的两个 op（clone、intersect）必须支持 brepkit。用户判断：内核基础能力都具备，差异只在拓扑/命名扩展层面，应通过优雅降级处理，而非直接拒绝。

## 问题定位

### clone

- 声明：`api/surface/arg-spec.ts` 中 `engines: ['occt']` + `naming: { kind: 'identity' }`
- 实现：`brep-mirror/topologyFns.ts#cloneBrep` → `kernel.copyShape(handle)`，纯深拷贝，无 occt 特有 API
- brepkit 适配器：A 批已补 `copyShape` 能力（调 `kernel.copySolid`），真实实现存在
- 阻碍：仅 `engines: ['occt']` 白名单

### intersect

- 声明：`api/boolean.ts` 中 `capabilities: ['intersectWithHistory']`
- 实现：`booleanBrep(shapes, 'intersect')` → 经 `booleanWithRoleTable` 调内核 `intersectWithHistory`
- brepkit 适配器：有普通 `intersect(a,b)`（`brepkitKernel.ts`），但 evolution 声明仅 `['fuseWithHistory','cutWithHistory','filletWithHistory']`，无 `intersectWithHistory`
- 阻碍：capabilities 静态门控在执行前报 `lacks capability 'intersectWithHistory'`

## 命名契约真相（clone 降级的前提）

### identity 命名 = ordinal 1:1，非 hash

经读 `topology/naming/lineage*.ts`、`lineage-resolve.ts` 实测确认：

- identity 类 op 的演化是恒等映射：第 i 面 → 第 i 面，跨节点回走用**序号键**（ordinal），不是 face hash
- hash 仅在 root 锚定和落地时做 ordinal↔hash 换算（`identityHashEvolution` 调 `kernel.subShapeHashes` 按序号配对）
- 两个 identity 函数（`identityEvolution`、`identityHashEvolution`）都是引擎中立的，只用 `kernel.subShapeHashes`

### 断点：clone 裸 handle 不传播 roleTable

探针实测（`box → clone → edgeRef(clone,1) → fillet`）：

| 引擎 | clone 本身 | edgeRef(clone,1) |
|---|---|---|
| occt | 跑通 | 报 `nameless shape`（input shape has no role table） |
| brepkit（改动前） | 报 `requires engine occt` | — |
| brepkit（改动后） | 跑通 | 报与 occt 完全相同的 `nameless shape` |

根因：`cloneBrep` 是生成式 selfhost 投影，返回裸 handle，经 `defineOp.wrapBrepOne → fromHandle → fromBrep` 时**不带 faceEvolution、不传播 roleTable**。而手写的 `placeBrep` 显式调了 `propagateAllOrigins` + `identityEvolution` + `identityHashEvolution`。

**关键结论**：roleTable 缺失是**引擎中立**的既有行为（occt 上 clone 产物同样无名），不是 brepkit 特有缺口。因此 brepkit 上开放 clone 后，行为与 occt 一致 = 优雅降级（结构化 `E_TOPO_NOT_FOUND`，不崩溃、不静默选错面）。

## 降级方案

### clone：engines 白名单 → 能力路由

- `arg-spec.ts`：clone 条目 `engines: ['occt']` → `capabilities: ['copyShape']`
- 重跑 `gen-l3-surface.ts` 重新生成 `generated/topology.ts`（未手改生成文件）
- 能力声明如实：`cloneBrep` 只调 `kernel.copyShape`，brepkit 适配器已声明该能力（engine-switch-p3 守卫通过）
- occt 行为零变化（occt 也有 copyShape，能力路由通过后走同一实现）

### intersect：capabilities 门控 → 中立 op + booleanBrep 内静态分派

选方向 A（中立 op + 实现内静态分派），不选方向 B（defineOp 能力析取）的原因：方向 B 需改框架级 `firstMissingCapability`/`dispatchPath` 语义，爆炸半径大；方向 A 只需在 `booleanBrep` 内读同一份声明能力集做静态分支。

具体改动（`api/boolean.ts`）：

1. `intersect` op 移除 `capabilities: ['intersectWithHistory']`，变为中立 op
2. `booleanBrep` 内按 `engineCapabilitySet(getBackends().config.brepCapabilities)` 静态定轨：
   - 引擎**声明**了 `*WithHistory`（occt）→ `booleanWithRoleTable` 历史路径，产出 faceEvolution + roleTable
   - 否则（brepkit）→ L1 裸 `kernel[op](a,b)`，无 faceEvolution、不传播 roleTable
3. fuse/cut **保留**各自 `*WithHistory` 能力声明——dispatchPath gate 保证它们到达时引擎必已声明历史方法，`useHistory` 恒为 true，行为零变化

**naming 如实降级**：brepkit 上 intersect 结果无面身份（lineage 节点 `kind:'kernel'` 但不 attach 演化）。**没有**用恒等映射伪造演化表——结果实体面 hash 与输入根本不同，伪造即假身份。

## 验证结果

### 对拍测试（multi-engine-op-parity）

| op | occt | brepkit 2.129.15 | brepkit 3.4.18 | brepkit 4.0.32 | bbox |
|---|---|---|---|---|---|
| clone | PASS | PASS | PASS | PASS | [20,10,5]（四引擎精确一致） |
| intersect | PASS | PASS | PASS | PASS | [16,16,20]（四引擎精确一致） |

- parity combos：129 → **132**（clone + intersect 从 error 移入 parity）
- error combos：24 → **21**（剩余 chamfer/loft/screw/draft/thicken/knurl/sdf，全是 occt-only 或 mesh-only）
- mismatches = **0**

### 回归测试

- `brepkit-clone-fix.test.ts`（2 例）：brepkit 三版本 clone 几何一致 + occt 不回退 + edgeRef(clone) 四引擎一致报 nameless shape
- `brepkit-intersect-fix.test.ts`（4 例）：occt 历史路径（带面演化）+ 三版本 brepkit 裸路径（无面演化、几何正确）

### 既有测试无回退

- brepkitKernel.test.ts：75/75
- engine-switch-p2/p3：13/13
- arg-spec-capabilities / evolution-declaration：9/9
- boolean-vc8：2/2
- naming 全套：144/144

## 剩余缺口（如实说明）

1. **clone 产物无面身份**：`edgeRef(clone,n)` / `faceRef(clone,n)` 在 clone 产物上不可用，occt 与 brepkit 均如此。这是生成式裸 handle 投影的既有行为（与手写 `place` 的全传播不同）。若未来要让 clone 产物可被选边，需在 `cloneBrep` 里像 `placeBrep` 那样传播 roleTable，但依赖「brepkit `copySolid` 后面枚举序保持」这一尚未验证的假设，贸然做有静默选错面的风险。
2. **brepkit 上 intersect 结果无面身份**：后续在结果面上做 selection/命名追踪时，无法知道哪张输出面来自哪个输入。若未来 brepkit 声明了 `intersectWithHistory`，分支自动切回历史路径，无需改代码。
3. **三版本 brepkit 行为完全一致**：2.129.15 / 3.4.18 / 4.0.32 无版本差异，根因全在适配器层而非 wasm 内核。

## 变更文件清单

| 文件 | 改动 |
|---|---|
| `api/surface/arg-spec.ts` | clone：engines→capabilities:['copyShape'] |
| `api/generated/topology.ts` | 重新生成（clone 条目） |
| `api/boolean.ts` | intersect 移除 capabilities；booleanBrep 加历史/裸路径静态分派 |
| `api/surface/arg-spec-capabilities.test.ts` | intersect 能力断言同步更新 |
| `brep/engine/multi-engine-op-parity.test.ts` | clone/intersect 移入 parity；清理 capability-gap 死分支 |
| `brep/engine/brepkit-clone-fix.test.ts` | 新增回归测试 |
| `brep/engine/brepkit-intersect-fix.test.ts` | 新增回归测试 |
| `brep/engine/multi-engine-results.json` | 重新生成（132 parity + 21 error） |
