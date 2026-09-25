# brepkit 适配器缺陷修复 · 交接文档

- 日期：2026-09-25
- 仓库：`C:\my\Faicad\faijs`（monorepo，包 `@faicad/faijs` = `packages/core`）
- 涉及文件：
  - `packages/core/src/brepkit-kernel/brepkitKernel.ts`（brepkit → `BrepEngineApi` 适配器）
  - `packages/core/src/brepkit-kernel/brepkitKernel.test.ts`（几何单测）
- wasm 版本：`brepkit-wasm@3.4.18`
- 验证状态：`tsc --noEmit` ✅｜`eslint`（改动文件）✅｜`vitest` 75/75 ✅

---

## 1. 任务背景

3d_editor 项目的微信小程序端（`packages/weapp`）当前只接入 7 个工具，**钻孔 / 平面分割 / 倒角 / 圆角均未接入**，并在 `packages/weapp/src/ui/tools.ts` 把 `chamfer`/`fillet` 标注为"跑不通"（`E_FILLET_NO_EDGES`、需 occt 引擎等）。

为判断这是"内核能力缺失"还是"适配器 bug"，先在 faijs 写了 brepkit 适配器的能力验证单测。结论：**brepkit-wasm 内核本身支持钻孔、平面分割、倒角、圆角**（断言基于解析几何量：体积 `1000−40π`、`980`、`144π` 等），但 faijs 的 brepkit 适配器层存在 8 处缺陷，其中 `makeBoxFromCorners` 直接导致上层 `splitBrep`（平面分割入口）完全失效——这正是端侧"分割/倒角跑不通"的真实根因。

本次修复了适配器层全部可修缺陷，并把"无法在适配器层修复的内核局限"如实记录于第 4 节。

---

## 2. 已修复缺陷清单

> 每项给出：症状 → 根因（含 2026-09-25 实证）→ 修复 → 钉住的测试。行号对应修复后的 `brepkitKernel.ts`。

### 2.1 `makeBoxFromCorners` 返回 undefined 句柄（**最高优先级，致 splitBrep 全失效**）

- 症状：`makeBoxFromCorners` 返回 `undefined`；依赖它的 `splitBrep`（`packages/core/src/brep/brep-ops.ts:455`，用半空间盒 `common`+`cut` 实现平面分割）得到 `front=0 / back=1000`，完全失效。
- 根因：brepkit 的 `transformSolid(solid, matrix): void` 是**原地修改、返回 undefined**（`brepkit_wasm.d.ts:2090`）。旧代码写 `return asHandle(kernel.transformSolid(h, M))`，把 undefined 当句柄。
- 修复（`brepkitKernel.ts:237`）：`makeBox` 返回的 `h` 本身即新实体，原地变换后 `return asHandle(h)`。
- 测试：`makeBoxFromCorners 返回有效实体（回归：transformSolid 原地返回 undefined）`、`splitBrep（上层 L1 入口…）：中分 500/500`。

### 2.2 `chamferDistAngle` 角度单位未转换

- 症状：传 `45`（度）抛 `angle must be less than π/2`；倒角不生效。
- 根因：L1 契约 `chamferDistAngle(..., angleDeg)` 口径是**度**（`AddDA(distance, angleDeg, E, F)`），brepkit `chamferDistanceAngle` 吃**弧度**。旧代码直传度数。
- 修复（`brepkitKernel.ts:332`）：`const angleRad = (angleDeg * Math.PI) / 180` 后传入。
- 测试：`chamferDistAngle：角度单位为度，45° 等价内核 π/4 弧度`（体积基线 `866.6667`）、`90° 经转换后恰为内核上界 π/2，应如实抛错`。

### 2.3 `filletVariable` 参数签名不符（wasm 崩溃）

- 症状：调用触发 wasm `memory access out of bounds`。
- 根因：brepkit `filletVariable(solid, json: string)` 吃**序列** `[{edge, radius1, radius2}, ...]`（`brepkit_wasm.d.ts:630`）。旧代码传 4 个位置参数 `(solid, edge, r1, r2)`。
- 修复（`brepkitKernel.ts:339`）：`JSON.stringify([{ edge: asNum(edge), radius1: startRadius, radius2: endRadius }])`。
- 测试：`filletVariable：单边变半径（r 1→2）返回有效实体，去料量介于等半径 1 与 2 之间`。

### 2.4 修复类函数把"修复计数"当句柄返回

- 症状：`healSolid` / `fixShape` / `fixFaceOrientations` / `unifySameDomain` / `removeDegenerateEdges` 全部返回句柄 `0`（无效实体）。
- 根因：这 5 个内核函数都是**原地修改入参 + 返回修复计数**（`healSolid→修复问题数`、`fixFaceOrientations→修复面数`、`unifyFaces→合并删除面数`、`removeDegenerateEdges→删除边数`，见 d.ts:984/662/2109/1733）。旧代码 `asHandle(kernel.healSolid(...))` 把计数（常见 0）当句柄。
- 修复（`brepkitKernel.ts:727`）：统一改为 `copySolid` 副本 → 原地修复副本 → 返回副本句柄；`fixShape` 映射到 `healSolid`（与 `engine-method-map.json:737` 一致）。
- 测试：`修复类方法返回有效新句柄且不篡改原实体（回归：内核原地修改 + 返回计数）`——断言返回句柄 `isSolid`、体积守恒、且与原句柄不同、原实体未被篡改。

### 2.5 `importStep` 入参/返回类型错

- 症状：STEP 往返失败。
- 根因：brepkit `importStep(data: Uint8Array): Uint32Array`（d.ts:1051）——吃字节数组、返回**多 solid 数组**。旧代码传字符串、且把数组当单句柄。
- 修复（`brepkitKernel.ts:738`）：`TextEncoder().encode` 编码字符串；返回数组 0 个 → `fail`，1 个 → 直通，多个 → `makeCompound`。
- 测试：`exportStep → importStep 往返体积守恒（字符串与 ArrayBuffer 两种入参）`。

### 2.6 `fromBREP` 误用 base64 + 二进制反序列化

- 症状：`fromBREP` 往返必失败（`no DATA section found` / `arena deserialization failed`）。
- 根因：brepkit `fromBREP(data: string)` 吃字符串（STEP 文本或 `toBREP`/`toBrepJson` 输出，内核自动判别），与 `serializeSolid`/`deserializeSolid` 的**二进制 arena** 是两套机制。旧代码 `deserializeSolid(atobPolyfill(data))` 用 base64 解码破坏了 STEP 文本。
- 修复（`brepkitKernel.ts:751`）：直接 `kernel.fromBREP(data)`；删除不再使用的 `atobPolyfill`。
- 测试：`fromBREP：接受 STEP 文本往返`、`fromBREP：接受 brepkit 原生 toBrepJson 输出`。

### 2.7 `chamfer` / `fillet` 入参类型统一为 `Uint32Array`

- 根因：d.ts 声明 `edge_handles: Uint32Array`，旧代码传 `Int32Array`（实测能跑，但类型不符、高位句柄有风险）。
- 修复（`brepkitKernel.ts:329/336`）：改 `Uint32Array.from`。

### 2.8 既有 `hullFromPoints` 测试缺第二参数（tsc 阻塞）

- 顺手补齐：`api.hullFromPoints([...], 1e-6)`（契约 `hullFromPoints(points, tolerance)` 第二参数必填）。

---

## 3. 经澄清"非缺陷"项（避免接手者重复踩坑）

子代理初版报告把以下两项误判为适配器缺陷，实测后澄清为**探针用例错误**，未改适配器，仅加正确用例测试钉住：

- **`revolveVec` 360° 零体积**：原探针用「跨轴矩形」或「面在旋转平面内」的用例，几何上本就退化（零体积符合预期）。正确用例：`y∈[0,6]` 的矩形绕 X 轴 360° → 半径 6、长 4 圆柱 = `144π`。测试：`revolveVec：y∈[0,6] 的矩形绕 X 轴 360° → 半径 6、长 4 的圆柱 = 144π`。
- **`gridPattern` 返回输入句柄本身**：实测返回的是合法 compound 句柄（恰为 `0`，brepkit 中 0 可作合法句柄），`getCompoundSolids(0)` 正确拆出 4 个副本。既有测试 `gridPattern：2×2 网格产出含 4 个实体的复合体` 已钉住，无需改。

---

## 4. 仍存在的内核局限（**无法在适配器层修复，需上报 brepkit 上游或调用方规避**）

### 4.1 严格 `validateSolid` 对 split / 距角倒角结果误报

- 现象：`kernel.split` 的某一侧、`chamferDistanceAngle` 的结果，严格 `validateSolid` 返回非 0，但 `validateSolidRelaxed` 返回 0；几何精确（体积/实体性/STEP 导出均正常）。
- 性质：brepkit 校验器对"几何正确但拓扑非完全流形"的产物（boolean/fillet/shell/split 同类）误报，d.ts:2116 明确 `validateSolidRelaxed` 正是为这类场景设计。
- 适配器决策：`isValid` 契约保持**严格**校验（`validateSolid === 0`），**不放宽、不掩盖**。需要放宽判定的调用方应直接用 `getBrepkitKernel().validateSolidRelaxed(h)`。
- 测试体现：split 套件以「实体性 + 面拓扑 + 体积守恒」为判据并附注释；`chamferDistAngle` 测试用 `validateSolidRelaxed` 并注明。

### 4.2 `fromBREP` 跨引擎格式方言

- brepkit `fromBREP` 吃 STEP/JSON，occt `fromBREP` 吃 OCCT BREP 文本。`engine-method-map.json:798` 把二者列为 aligned，但**跨引擎不互通**（把 OCCT BREP 文本喂给 brepkit 会失败）。本次修复仅保证 brepkit 自身往返自洽。若 L1 调用方依赖跨引擎 BREP 文本互通，需重新审视契约归类。

### 4.3 `asHandle(0)` 语义模糊

- brepkit 中句柄 `0` 可以是合法 compound（如 `gridPattern` 返回值），但 `isSolid(asHandle(0))` 会走 `getSolidFaces(0)` 误判为 solid。本次未动 `asHandle`（全局禁 0 会破坏 gridPattern）。若后续需要严格区分 compound/solid，需在适配器引入 shape-type 分类（brepkit 目前无此 API）。

---

## 5. 接手要点

### 5.1 验证命令（已全部通过）

```bash
cd C:/my/Faicad/faijs
npx tsc --noEmit                                                  # 类型检查
npx eslint packages/core/src/brepkit-kernel/brepkitKernel.ts \
            packages/core/src/brepkit-kernel/brepkitKernel.test.ts
npx vitest run packages/core/src/brepkit-kernel/brepkitKernel.test.ts   # 75/75
```

> ⚠️ 未跑全量 CI（按 AGENTS.md「测试风暴防治」只跑相关层）。接手者若要全量验证，按 `lint → typecheck → vitest → build → 相关 e2e` 分层跑，不要直接 `ci.ps1`。

### 5.2 影响面

- 仅改 brepkit 适配器（`brepkitKernel.ts`）+ 其测试。**occt 侧（`occt-primitives.ts`）未动**，occt 路径行为不变。
- `chamfer`/`fillet` 改 `Uint32Array` 仅 brepkit 侧；occt 侧仍用其 `shapes()` 帮助函数。
- `fromBREP` 语义微调（brepkit 侧改为吃 STEP/JSON 直通）；若有调用方依赖旧的 base64 行为，需同步（本项目尚无此调用方）。

### 5.3 未做 / 后续建议

1. **未升级 faijs 版本号**。按 3d_editor AGENTS.md 流程，faijs 改完应先升版本、再改 3d_editor 的 `package.json` 引用。本次未动版本，接手者决定是否合并发版。
2. **未在 weapp 端重新评估接入**。`packages/weapp/src/ui/tools.ts` 仍把 `chamfer`/`fillet`/`fai_drill`/`fai_split` 列入不支持清单——其中倒角/圆角的"跑不通"根因（适配器 bug）现已修复，接手者可基于修复后的适配器重新评估端侧接入，并更新 `tools.ts` 与 `tools.test.ts` 的钉死断言。
3. **`splitBrep` 现已可用**：weapp 端若需要平面分割，可直接调用 `splitBrep`（依赖 `makeBoxFromCorners`，已修复）；或用已验证可用的 `splitByPlane`（内核原生 `split`，不依赖半空间盒）。
4. **内核局限（第 4 节）建议上报 brepkit 上游**：严格 `validateSolid` 对 split/chamfer 误报、`fromBREP` 跨引擎格式、句柄 0 语义模糊。

### 5.4 关键文件速查

| 关注点 | 位置 |
|---|---|
| 适配器实现 | `packages/core/src/brepkit-kernel/brepkitKernel.ts` |
| 能力/回归测试 | `packages/core/src/brepkit-kernel/brepkitKernel.test.ts` |
| L1 契约定义 | `packages/core/src/brep/engine/primitives.ts` |
| 方法映射（aligned/dialect） | `packages/core/src/api/surface/engine-method-map.json` |
| 上层 splitBrep/drillBrep | `packages/core/src/brep/brep-ops.ts:455 / :402` |
| wasm 类型声明 | `node_modules/brepkit-wasm/brepkit_wasm.d.ts` |
| weapp 端工具清单（待重评） | `3d_editor/packages/weapp/src/ui/tools.ts` |

---

## 6. 一句话结论

brepkit 内核**支持**钻孔/分割/倒角/圆角；端侧"跑不通"是 faijs 适配器层 8 处缺陷所致，**已全部修复并加回归测试**（75/75 通过），剩余 3 项为 brepkit 内核校验器/格式方言局限，需上游或调用方层面解决。