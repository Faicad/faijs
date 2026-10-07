# Vendored 测量面引擎收敛修复方案（胶水方法合成 + 测量方法映射 + 注入缓存重置）

状态：方案（未实施）

日期：2026-09-23（2026-09-24 修订：补测量方法映射层与引擎契约缺口）

## 0. 用户原始需求（原文）

> 那么该如何修复这个问题，而且只是faijs自身的问题

> 写成一份开发计划文档

本方案是对话链中实锤的 faijs 侧缺陷的修复计划。全程排除 `src/vendored/` 逻辑改动——vendored brepjs 的内核注册表（`registerKernel(id, adapter)` 多条目 + `getKernel()` 取默认）从头到尾是引擎中立设计，实测非注释代码 0 处写死 occt；缺陷全部在 faijs 自己的桥接/装配层。

## 1. 事实前提（本会话实测证据，不再重议）

1. **vendored brepjs 无引擎写死**：`src/vendored/brepjs/` 下排除注释后 `occt` 字样仅 22 处，全部为 occt 适配器自身文件内的错误消息/自标识常量（`kernelId = 'occt-wasm'`）或缺省装配提示；注册表、measureFns、solverAdapter、全部 op 函数 0 处出现 occt。
2. **缺陷①（胶水方法缺失）**：`BrepEngineApi`（`brep/engine/primitives.ts`）不含 `createVector3d / createPoint3d / createDirection3d / createAxis1 / createAxis2 / createAxis3`；`wrapBrepEngineApi`（`api/occt-kernel-bridge.ts:127`）裸透传不出这 6 个方法 → `assertGlueMethodsComplete`（`:193`）对 brepkit 装配期拒绝注入。occt 分支走 `OcctWasmAdapter.fromKernel`（211 方法完整面），不受影响。
3. **缺陷②（注入缓存无重置）**：`injectCurrentBrepEngineAsKernel`（`api/occt-kernel-bridge.ts:82`）有模块级 `_injected` 缓存且无重置钩子——同进程 occt 注入成功后切 brepkit 再调注入，`if (_injected) return getVendoredKernel()` 短路返回 **occt 旧适配器**（跳过 `buildKernelAdapter` 与完整性检查）；旧适配器把 brepkit 数字句柄当 occt-wasm 指针解引用 → OOM/崩溃。已在 `measurement-parity.test.ts` 调试中以探针复现。
4. **缺陷③（注册 id 误导，次要）**：`registerKernel(VENDORED_OCCT_KERNEL_ID /* 'occt-wasm' */, adapter)` 的 id 恒为 `'occt-wasm'` 与实际引擎身份脱节。已证实 vendored 面调的都是无参 `getKernel()`（`vendored/brepjs/kernel/index.ts:155`），不按 id 取——id 纯为宿主侧判据（`getActiveKernelId()`）与 D10 globalThis 单例兼容，改名无功能收益。
5. **缺陷④（测量方法名与形态缺口，Phase B2 主战场）**：vendored 测量面**不**调用 `BrepEngineApi` 的方法名。`measureFns.ts` 直接 `getKernel().volume/area/length/centerOfMass/linearCenterOfMass`（`:67,:96,:128-129`，契约见 `kernel/interfaces/measureOps.ts:24-28`）；`BrepEngineApi` 测量段（`primitives.ts:267-270`）只有 `getBoundingBox / getVolume / getCenterOfMass`。occt 分支之所以可用，是因为 `OcctWasmAdapter` 内置了映射层（`occtWasm/measureOps.ts:38-80`）：`volume→k.getVolume`、`area→k.getSurfaceArea`、`centerOfMass→k.getCenterOfMass()` 并把 vec 对象转成 `[x,y,z]` 元组。`wrapBrepEngineApi` 的裸透传（`:132-135`）**没有这一层**——注入放行后 `kernel.volume` 是 `undefined`，执行期 `TypeError`，**不是**能力判定的静态拦截（`measureFns` 不经过 `backend-dispatch`）。
6. **缺陷⑤（引擎契约能力缺口，本方案不解决）**：`BrepEngineApi` 没有 `getSurfaceArea` / `getLength` / `getLinearCenterOfMass`。即 `area` / `length` / `linearCenterOfMass` 三个 vendored 查询在**任何**非 occt 引擎下都无源可映射，与包装层怎么写无关。见 §6 取舍。
7. **测试基线**：`packages/core/src/brep/engine/measurement-parity.test.ts` 已入库（6 用例通过）：BrepEngineApi 层 getVolume/getCenterOfMass/getBoundingBox 双引擎 parity 通过；vendored 测量面 occt 可用（体积 1000/面积 700/质心正确）；brepkit 注入被拒以 `rejects.toThrow(/missing glue method.*createVector3d/)` 钉死。文件头已预留升级条件。

## 2. 目标与非目标

**目标**：

- **G1（装配期断点）**：brepkit 装配下 `injectCurrentBrepEngineAsKernel()` 成功返回含 6 个胶水方法的适配器，`assertGlueMethodsComplete` 不再拒绝注入。
- **G2（测量面 parity，限于引擎契约已覆盖的能力）**：brepkit 装配下 vendored 测量面中 **`BrepEngineApi` 已具备的能力**（体积、质心、包围盒、`shapeType`、`isNull`）返回与 occt 一致的正确值；`measurement-parity.test.ts` 升级为双引擎 parity。
- **G3（注入跟随当前引擎）**：同进程多引擎装配（测试/宿主重装配）注入结果始终跟随当前激活引擎，消除短路旧适配器陷阱。
- **G4（缺口显式化）**：`area` / `length` / `linearCenterOfMass` 三个无源能力不许静默产出错值或裸 `TypeError`——在包装层登记为显式缺口，装配期可枚举、测试可断言。
- **G5**：`src/vendored/` 逻辑零改动。

**非目标**：

- 不改 vendored brepjs 任何逻辑（含 `kernel/index.ts` 的注册表实现）。唯一例外见 §6：为可靠重置模块级 `_frozen`，在 vendored 追加一个 **test-only 导出**（纯新增、不改既有逻辑、不进生产路径）。
- **不扩 `BrepEngineApi` 的几何能力**（不加 `getSurfaceArea`/`getLength`/`getLinearCenterOfMass`）。这是引擎契约变更，影响所有引擎适配器与能力声明，属独立议题；本方案只把它登记为显式缺口（G4），不伪造、不补桩。
- 胶水方法不加进 `BrepEngineApi`（理由见 §3.1）。
- 不处理 `wrapBrepEngineApi` 之外的方法面缺口（`BrepEngineApi` 之外的 vendored 方法，如 `meshBoolean`/`executeBatch`，属 Brep 引擎可切换重构 Phase 3 滚动范围，另行推进）。

## 3. 修复设计

### 3.1 修复①：胶水方法由包装层合成（Phase B1）

**位置**：`packages/core/src/api/occt-kernel-bridge.ts` 的 `wrapBrepEngineApi`。

**决策**：不在 `BrepEngineApi` 加胶水方法。`vendored/brepjs/kernel/occtWasm/constructionOps.ts:426-492` 实证这 6 个方法就是纯 JS 对象字面量（带 `delete: noop`），零内核调用，属于 vendored 面的**调用约定**而非内核能力；加进引擎契约会强迫每个引擎实现无几何意义的样板。合成位置是 faijs 自己的包装层——任何引擎的 primitives 经包装都能获得同一实现，天然引擎中立。

**合成形态（逐字段对齐 occt 路径，禁止按直觉构造）**：

| 方法 | 参数 | 返回对象（字段必须逐字对齐） |
|---|---|---|
| `createPoint3d` | `(x, y, z)` | `{ x, y, z, __type: 'point3d', delete: noop }` |
| `createDirection3d` | `(x, y, z)` | `{ x, y, z, __type: 'direction3d', delete: noop }` |
| `createVector3d` | `(x, y, z)` | `{ x, y, z, __type: 'vector3d', delete: noop }` |
| `createAxis1` | `(cx, cy, cz, dx, dy, dz)` | `{ origin: {x,y,z}, direction: {x,y,z}, __type: 'axis1', delete: noop }` |
| `createAxis2` | `(ox, oy, oz, zx, zy, zz, xx?, xy?, xz?)` | `{ origin: {x,y,z}, zDir: {x,y,z}, xDir?: {x,y,z}, __type: 'axis2', delete: noop }` |
| `createAxis3` | 同 `createAxis2`（9 参数） | 同上，`__type: 'axis3'` |

两个必须遵守的细节：

- **`delete` 不可省**：`kernelBoundary.withKernelPnt/withKernelVec/withKernelDir`（`:56-83`）在 `finally` 调 `.delete()`；缺字段即 `TypeError`。
- **轴字段名分两套**：axis1 是 `origin + direction`；axis2/axis3 是 `origin + zDir + xDir?`（vendored `makeKernelAx2/Ax3` 走 6 或 9 参数两形态，`:99-134`）。
- vendored 内部另有一套读法（`fromKernelVec` 读 `.X()/.Y()/.Z()`，与 create* 产出的小写 `.x` 不同源）。合成只保证与 **occt 适配器当前形态**一致，不试图统一 vendored 内部的两套约定。

`assertGlueMethodsComplete` 与 `GLUE_METHODS` 清单均不改——对合成后的适配器自然通过，检查本身保留（未来新引擎适配器漏合成的防线）。occt 分支不动。

### 3.2 修复②：注入缓存重置钩子（Phase A，先行独立落地）

**位置**：`packages/core/src/api/occt-kernel-bridge.ts`。

**新增 test-only 导出**：

```ts
/** Test-only: clear the injection cache and reset the vendored kernel registry
 * so a re-assembly (e.g. switching engines in tests) re-runs buildKernelAdapter
 * + assertGlueMethodsComplete for the new engine. */
export function __resetKernelInjectionForTests(): void {
  _injected = false
  __resetVendoredKernelRegistryForTests()
}
```

**vendored 侧重置必须走 test-only 导出，不能只写 globalThis**。理由（`vendored/brepjs/kernel/index.ts`）：

- `_frozen` 是**模块级变量**（`:99`），只有 `syncFromGlobal()`（`:104-111`）才会从 globalThis 拉回。只写 `globalThis.__FAICAD_FAIJS_KERNEL_REGISTRY__.frozen = false` **不会**改 `_frozen`，下一次 `registerKernel` 仍抛 `kernel registry frozen`（`:138-141`）。
- faijs 侧若自行重建该 globalThis 状态，必须硬编码复制 vendored 私有结构 `KernelRegistryState`（`stateVersion:1, kernels:Map, defaultKernelId, cachedDefault, frozen`；`:78-84`，且 `registryState()` 会校验 version）——vendored 升级时静默失效，lint/typecheck 抓不到。

**因此**：在 `vendored/brepjs/kernel/index.ts` 追加一个 test-only 导出（这是 G5 的唯一例外，纯新增、不改任何既有逻辑、不进生产路径）：

```ts
/** Test-only: reset the kernel registry (clear kernels, unfreeze) so a host
 * re-assembly in tests can register a different engine. Never called in prod. */
export function __resetKernelRegistryForTests(): void {
  _kernels.clear()
  _defaultKernelId = null
  _cachedDefault = null
  _frozen = false
  syncToGlobal()
}
```

**防回归测试**（新增，落在 `api/occt-kernel-bridge.test.ts` 或 measurement-parity 内）：occt 注册+注入 → `__resetEngineRegistriesForTests` + `__resetKernelInjectionForTests` → 注册 brepkit → 再注入 → 断言返回适配器的 `volume` 对 brepkit 盒句柄返回 1000（occt 旧适配器对 brepkit 数字句柄无法做到）。

**顺带统一判据**：`isKernelInjected()`（`:215`）用 `_injected || getActiveKernelId() !== null`，而注入的短路只看 `_injected`，二者不对称——存在「registry 已注入但 `_injected=false`」状态（同进程新模块实例 + `syncRegistryFromGlobal()` 拉回），此时 `isKernelInjected()` 为 true 但再调注入会走完整路径撞 frozen 抛错。把短路改为 `if (isKernelInjected()) return getVendoredKernel()`，语义与判据一致。

### 3.3 修复③：注册 id 保持现状 + 语义注释（Phase B1 顺手项）

`registerKernel(VENDORED_OCCT_KERNEL_ID, adapter)` 的 id **不改**（vendored 面无参取默认、不按 id 取，改名触及宿主判据与 D10 单例兼容，无功能收益）。仅在 `VENDORED_OCCT_KERNEL_ID` 常量处（`occt-kernel-bridge.ts:37`）补一句注释：id 是 vendored 注册表槽位名，非引擎身份标识；实际引擎由注入的 adapter 决定。

### 3.4 修复④：测量方法名与形态映射（Phase B2）

**位置**：`wrapBrepEngineApi`，在 3.1 合成之后追加。

**形态前提**：vendored 侧传入的 `shape` 是 `KernelShape`（`OcctWasmHandle` 视图或裸 number），`unwrap()`（`occtWasm/helpers.ts:45-49`）取 `.id` 或裸 number。`BrepEngineApi` 期望 `BrepHandle`（brepkit 为数字 id），因此映射函数需先 unwrap。faijs 侧自写一个 5 行 `unwrapHandle`（`typeof h === 'number' ? h : h.id`），不复用 `occtWasm/helpers` 以免把 occt 命名带进引擎中立路径。

**映射表（只映射 `BrepEngineApi` 真实具备的能力，逐条对齐 occt 分支口径）**：

| vendored KernelAdapter 方法 | vendored 期望返回 | 映射目标（`BrepEngineApi`） | 形态转换 |
|---|---|---|---|
| `volume(s)` | `number` | `getVolume(h)` | unwrap |
| `centerOfMass(s)` | `[x, y, z]` 元组 | `getCenterOfMass(h) → BrepVec3` | `{x,y,z}` → `[x,y,z]` |
| `boundingBox(s)` | `{ min: [x,y,z], max: [x,y,z] }` | `getBoundingBox(h, true) → BrepBoundingBox` | `{xmin..zmax}` → `{min:[..],max:[..]}` |
| `shapeType(s)` | `ShapeType` 字符串 | `shapeType(h)` | 同名同义，已由裸透传覆盖 |
| `isNull(s)` | `boolean` | `isNull(h)` | 同名同义，已由裸透传覆盖 |

**缺口登记表（G4）**：`area` / `length` / `linearCenterOfMass` 在 `BrepEngineApi` 无对应能力。处理方式——在 `wrapBrepEngineApi` 中显式登记为缺口常量：

```ts
/** vendored kernel methods with no source capability in BrepEngineApi.
 * Registered explicitly (not silently undefined): tests assert this list and
 * the engine-contract gap is a separate decision, not a wrapping bug. */
const UNMAPPED_VENDORED_MEASURE_METHODS = [
  'area', 'length', 'linearCenterOfMass',
] as const
```

装配期不因它们报错（注入照常放行），但测试用 `expect(adapter[m]).toBeUndefined()` 钉死"这是已知契约缺口"；同时 `measurement-parity` 的 brepkit 面**不**断言面积/长度。禁止为让测试变绿而补桩或返回 0——返回 0 是静默错值，比崩更难查。

**parity 断言范围**：brepkit 面只断言 `measureVolume`（1000）、`measureVolumeProps` 的 volume 与 centerOfMass（`(10, 5, 2.5)`）；`measureSurfaceProps`（面积 700）维持 occt-only，并在用例注释写明它依赖 `area`→`getSurfaceArea`，属引擎契约缺口。

**`shapeType` 值域兼容性须显式断言**：`measureVolumeProps`（`measureFns.ts:61`）用 `kernel.shapeType()` 过滤 solid/compsolid/compound，非这三类**静默返回 volume=0**（不报错）。`BrepSubShapeType`（`brep/engine/types.ts:127`）含 `'solid'` 但未见 compsolid/compound。因此 parity 用例必须先断言 brepkit 对盒句柄的 `shapeType` 返回 `'solid'`，再断言体积——否则失败时只会看到"体积 0"，无法区分是映射错还是类型判定错。

## 4. 分阶段交付

### Phase A — 注入缓存重置（修复②，先行）

- `occt-kernel-bridge.ts`：`__resetKernelInjectionForTests`；注入短路改用 `isKernelInjected()`；
- `vendored/brepjs/kernel/index.ts`：`__resetKernelRegistryForTests`（G5 唯一例外，test-only 新增）；
- 防回归测试：切引擎后再注入返回新引擎适配器；
- 验证：新测试 + `measurement-parity.test.ts` + `engine-switch-p2/p3.test.ts` + `registry.test.ts` 全绿。

### Phase B1 — 胶水方法合成（修复①③）

- `wrapBrepEngineApi` 按 §3.1 形态表合成 6 方法（含 `__type` 与 `delete: noop`；axis2/3 用 `zDir`/`xDir` 与 9 参数）；
- `VENDORED_OCCT_KERNEL_ID` 注释补语义；
- 验证：`assertGlueMethodsComplete` 对 brepkit 通过；`engine-switch-p2.test.ts:192` bare-engine 用例仍覆盖"缺胶水方法的裸引擎被拒"。

### Phase B2 — 测量方法映射 + parity 升级（修复④）

- `wrapBrepEngineApi` 追加 §3.4 映射表 5 项 + `unwrapHandle`；
- 缺口常量 `UNMAPPED_VENDORED_MEASURE_METHODS` + 缺口登记测试；
- `measurement-parity.test.ts` 升级：brepkit 的 `measureVolume` / `measureVolumeProps` parity（体积 1000、质心 (10,5,2.5)、盒/球双几何），先断言 `shapeType === 'solid'`；原"注入被拒"GOTCHA 用例改为验证 brepkit 注入**成功**且 `isKernelInjected()` 为 true；面积用例维持 occt-only 并注明原因；
- 验证：升级后 measurement-parity 全绿 → engine-switch 系列 → compat op 受影响单测（`api/internal/compat-op.test.ts` 等）。

### Phase C — 文档与门禁

- `docs/api-contract.md` §7.10（装配期适配器注入）：补记"胶水方法由 `wrapBrepEngineApi` 在包装层合成（纯数据构造、引擎中立）；测量方法经映射表对齐 vendored 名与 BrepEngineApi 名；`area`/`length`/`linearCenterOfMass` 为引擎契约缺口；注入缓存有 test-only 重置钩子"；
- Agent Note（`.agents/notes/implemented/feature/`）：记录注入缓存陷阱的发现过程（OOM 复现路径）、vendored/brepjs 与 BrepEngineApi 两套方法名口径的差异清单、`_frozen` 模块级变量导致 globalThis 重置失效的细节、vendored 零逻辑改动证明（22 处命中归类 + 唯一 test-only 例外）；
- `npm run doc-sync` 通过；受影响单测全绿后跑一次 `scripts/ci.ps1`，失败项只重跑失败用例。

## 5. 验收判据

1. brepkit 装配下 `injectCurrentBrepEngineAsKernel()` 成功返回含 6 胶水方法的适配器（形态逐字段符合 §3.1 表）。
2. brepkit 装配下 vendored `measureVolume` / `measureVolumeProps` 对 brepkit 盒句柄返回体积 1000 与质心 (10, 5, 2.5)，与 occt 一致；brepkit `shapeType` 对盒返回 `'solid'`（显式断言，防止静默 0 值）。
3. `area` / `length` / `linearCenterOfMass` 在缺口登记表内，测试钉死其为 `undefined`；`measureSurfaceProps` 维持 occt-only 且用例注明原因。无补桩、无伪造返回值。
4. `measurement-parity.test.ts` 双引擎 parity 全绿；原"brepkit 注入被拒"断言移除。
5. 同进程 occt→brepkit 重装配后再注入，返回 brepkit 适配器（防回归测试钉死）；无 OOM/崩溃路径残留。
6. `isKernelInjected()` 与注入短路判据一致（均含 `getActiveKernelId()` 分支）。
7. `src/vendored/` git diff 仅含 `__resetKernelRegistryForTests` 一个 test-only 新增导出，无既有逻辑改动。
8. `BrepEngineApi` 接口方法数不变，`_AssertSatisfiesBrepEngineApi` 守卫两引擎均通过。
9. occt 路径行为零变化（occt 分支未动，既有测试全绿佐证）。
10. `docs/api-contract.md` §7.10 更新 + Agent Note 落地 + doc-sync 通过。

## 6. 明确的设计选择

| 选择 | 决定 | 理由 |
|---|---|---|
| 胶水方法加在哪 | `wrapBrepEngineApi` 包装层合成，不扩 `BrepEngineApi` | 胶水方法是 vendored 调用约定（纯数据构造），非内核能力；扩接口会污染引擎契约、强迫样板实现；包装层是 faijs 自有代码 |
| 测量方法名差异怎么办 | 包装层加映射表（vendored 名 → BrepEngineApi 名 + 元组/包围盒形态转换） | 差异是两套口径的历史产物，收敛点应在 faijs 自己的桥接层；occt 分支的等价映射就在 `OcctWasmAdapter` 里，非 occt 分支缺的就是这一层 |
| `area`/`length`/`linearCenterOfMass` 无源可映射 | **登记为显式缺口，不补桩、不返回 0、不扩接口** | 返回 0 是静默错值；补桩违反红线；扩 `BrepEngineApi` 是引擎契约变更（影响所有适配器与能力声明），属独立议题，需单独拍板 |
| vendored registry 重置路径 | vendored 追加 test-only 导出（G5 唯一例外） | `_frozen` 是模块级变量，只写 globalThis 无效；faijs 侧重建 globalThis 状态需硬编码复制 vendored 私有结构，升级时静默失效。加一个纯新增的 test-only 导出不动任何逻辑，代价远低于脆弱的间接同步 |
| 注册 id 是否改 | 不改（`'occt-wasm'` 保留为槽位名） | vendored 面无参取默认、不按 id 取（实测 0 处）；改名触及宿主判据与 D10 单例兼容，无功能收益 |
| 缺内核方法（非胶水、非测量）的处理 | 维持能力判定/unsupported 静态拦截 | 属 Brep 可切换重构 Phase 3 滚动范围；本方案只打通"注入被拒"与"测量面名不对"两个断点 |

## 7. 风险与回退

- **合成/映射字段不匹配**（最高风险）：vendored 消费方按字段名深消费合成对象与元组；防线 = §3.1 逐字段核对表 + Phase B2 parity 测试走真实消费路径。若 parity 失败，按失败字段回改实现（迭代点收敛在 `wrapBrepEngineApi` 单函数内）。
- **`shapeType` 静默 0 值**：brepkit 对 compound/compsolid 的类型标识可能落在 vendored 过滤条件之外，导致体积静默为 0。防线 = 验收判据 2 要求先显式断言 `shapeType`。
- **globalThis 重置破坏其它测试**：`__resetKernelInjectionForTests` 只在测试内显式调用；既有测试不调它，行为不变。CI stderr 零容忍下确认重置不产生任何 console 输出。
- **Phase B2 暴露更多缺口**：映射表只覆盖测量面；若 parity 触发测量面之外的 vendored 方法名缺口，按同一模式（映射 or 登记缺口）在 `wrapBrepEngineApi` 内滚动处理，不扩大方案范围。
- **整体回退**：源码改动集中在 `occt-kernel-bridge.ts`（合成 + 映射 + 重置钩子）+ vendored 一个 test-only 导出；回退 = revert 这两个文件 + 测试文件恢复 occt-only 断言；无数据/格式迁移，无跨包联动。
