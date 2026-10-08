# 引擎能力声明的定位与存废

> 方案出处：DeepSeek-V4.1-Flash + WorkBuddy
>
> 日期：2026-10-08

## 一、当前设计

### 1. 运行时判据：引擎自述（`BrepCapabilities`）

类型在 `packages/core/src/brep/engine/types.ts:385-414`，各适配器在自己的源码里写死一份：`packages/core/src/brep/engine/adapters/occt.ts:169-183`、`brepkit.ts:40-134`、`brep-mock.ts:462-464`（空对象）。字段分三类：逐核函数名 `evolution` / `methods`；族级布尔 `heal` / `directEdit` / `advSurface` / `assembly` / `meshLift`；引擎本质字段 `exact` / `brepExport` / `exactMeasurement` / `tessellationModel`。

它是装配期写入、之后只读：注册表由 `freezeEngineRegistries()`（`packages/core/src/brep/engine/registry.ts:55-57`）冻结，运行期经 `packages/core/src/cad-runtime/runtime.ts:586-588` 的 `get brepCapabilities()` 转发到当前 BREP 链。运行期的展开点只有一个：`engineCapabilitySet()`（`packages/core/src/cad-runtime/backend-dispatch.ts:94-105`），把 `evolution` + `methods` + 五个布尔折成一个名字集合。

### 2. 构建期产物：容量映射表（`capability-map.json`）

`packages/core/src/api/surface/capability-map.json` 由 `packages/core/scripts/gen-capability-map.ts` 生成，逐 op 记录它实际调用了哪些内核方法（35 条）。它不参与运行时分派，是构建期清单。与之配套的是 op 声明侧：`packages/core/src/api/surface/arg-spec.ts` 逐条给 `capabilities`，生成物 `packages/core/src/api/generated/*.ts` 承接，三方一致性由 `packages/core/test/api/surface/arg-spec-capabilities.test.ts` 钉住。

以上两个部件是两件事，存废判断必须分开做。

## 二、判断一：使用方要问的是「这个结果有没有名字」，不是「引擎支持什么」

### 1. 几何结果：使用方不需要知道实现

同一 op 的两条实现路径产出几何一致的 `Shape`。现成证据是 `fillet` 的实现体根本不查声明：`packages/core/src/api/fillet.ts:130-144` 无条件调 `filletWithRoleTable`，落到 `packages/core/src/brep/face-evolution.ts:667` 的 `kernel.filletWithHistory`。它敢不分叉，是因为 `filletWithHistory` 在 `evolution` 名单里对两个引擎都成立（`occt.ts:171` 全量、`brepkit.ts:47` 含此名）。

### 2. 命名可用性：使用方会被动撞到

结果带 `roleTable` 时，`cad.faceRef` / `cad.edgeRef` 按 role 血统解析成功；不带时直接抛错：`packages/core/src/api/face-ref.ts:67-70` 与 `packages/core/src/api/edge-ref.ts:95` 都抛 `E_TOPO_NOT_FOUND ... has no role table (nameless shape)`。同一个脚本换引擎就抛错，这是行为契约差异。

### 3. 今日不可查

`cad.*` 命名空间（`packages/core/src/api/api-namespace.ts:128-213`）里没有任何引擎或能力查询项；`brepEngineId` 只在内部使用（`packages/core/src/api/extrude.ts:569`、`packages/core/src/api/internal/l3-bridge.ts:110`）。使用方只能靠撞。

### 4. 结构性问题：逐结果事实不能用引擎全局属性表达

使用方要问的是「**这个结果**的面有没有名字」，这是逐调用的事实。同一个引擎上三条反例：

- `packages/core/src/api/fillet.ts:17` — occt 上等半径 fillet 产 `roleTable`，变半径走 `filletVariable` 明确不产。
- `packages/core/src/api/chamfer.ts:270-276` — occt 上 `distanceAngle` / `twoDistances` 只挂 `identityEvolution` + 原 `inputTable`，与 `equal` 分支的真演化不同档。
- `packages/core/src/api/shell.ts:94-95` — 网格实体路径完全不产 `faceEvolution`。

⇒「引擎支持 `XWithHistory`」不等于「这一步结果有演化」。引擎级布尔在结构上表达不了逐结果的事实。

### 5. 正确的暴露形态

`roleTable` 本来就挂在结果 `Shape` 上（`packages/core/src/api/fillet.ts:146-149` 的 `fromBrep(..., { solid, faceEvolution, roleTable })`）。使用方已在按对象操作（`cad.faceRef(result, 3)`），它天然该问对象。今天缺的不是「引擎支不支持」的查询，而是一个不抛错的、**对象级**的命名可查询性询问。

## 三、判断二：能力表的存废

### 1. 可直接删除，零行为变化

| 字段 | 引擎声明处 | 消费方 |
| --- | --- | --- |
| `exact` / `brepExport` / `exactMeasurement` / `tessellationModel` | `occt.ts:179-182`、`brepkit.ts:131-133` | 无。`engineCapabilitySet`（`backend-dispatch.ts:94-105`）不收它们，全仓无读取点 |
| `assembly` | `occt.ts:177`、`brepkit.ts:129` | 无 op 声明、无读取点。名字仅存在于 `backend-dispatch.ts:68` 与 `:102` |
| `meshLift` | `brepkit.ts:130`（occt 未声明） | 无 op 声明、无读取点。名字仅存在于 `backend-dispatch.ts:69` 与 `:103` |

删除时一并处理 `BrepCapabilityName`（`backend-dispatch.ts:64-71`）里的两个族名与 `engineCapabilitySet` 的两行。`assembly` 若要重新启用，其真实语义（能否写 XCAF 装配树）已由 `methods` 里的 `createXCAFDocument` / `importXCAFFromSTEP`（`types.ts:363-364`）承担，不需要独立布尔。

### 2. 无 op 需求，但有引擎声明（可删，需先确认语义归属）

| 字段 | 引擎声明处 | op 声明数 |
| --- | --- | --- |
| `heal` | `occt.ts:174`、`brepkit.ts:126` 均为 `true` | 0 |
| `advSurface` | `occt.ts:176` 为 `true`、`brepkit.ts:128` 为 `false` | 0 |

两者的名字在 `BrepCapabilityName`（`backend-dispatch.ts:65,67`）与 `engineCapabilitySet`（`:99,101`）里，但没有任何 op 声明它们。注意 `heal` op 本身（`packages/core/src/api/brep-operations/healingFns.ts:24`、`packages/core/src/api/generated/topology.ts:187`）是靠 `engines: ["occt"]` 门控的，与 `heal` 布尔无关。

### 3. 不能直接删除（有活消费方）

| 字段 | 消费方 |
| --- | --- |
| `directEdit` | 16 处 op 声明：`api/draft.ts:129`、`api/feature-repair.ts:97,127,152,182,206,230`、`api/fillet-variable.ts:72`、`api/fillet.ts:217`、`api/profile.ts:359`、`api/punch-hole.ts:260`、`api/section-by-plane.ts:71`、`api/shell.ts:150`、`api/sketch-on-face.ts:323`、`api/sketch-on-plane.ts:151`、`api/split-by-plane.ts:69` |
| `evolution` + `methods` | 通用门禁 `firstMissingCapability`（`backend-dispatch.ts:115-121`）经 `define-op.ts:459-460` 在每次双路 op 调用时求交；另有 6 处 op 体分叉直接读它 |

6 处 op 体分叉：`api/boolean.ts:103`（`fuseWithHistory` / `cutWithHistory` / `intersectWithHistory`）、`api/chamfer.ts:237`（`chamferWithHistory`）、`api/shell.ts:89`（`shellWithHistory`）、`api/transform.ts:148-151`（`translateWithHistory` / `scaleWithHistory` / `rotateWithHistory`）、`api/brep-operations/topologyFns.ts:239`（`mirrorWithHistory`）与 `:287`（`rotateWithHistory`）。

### 4. 主体不是「删或不删」，而是「判据放哪」

第 3 类是真活肉，删不掉；可选的只是判据归属，三个候选：

| 判据 | 形态 | 代价 |
| --- | --- | --- |
| 引擎自述（现状） | op 体读 `caps.has('chamferWithHistory')` | 声明与实例可能漂移，靠 `packages/core/test/brep/engine/engine-switch-p3.test.ts` 的「声明 ⊆ 实例」守卫兜底 |
| 引擎身份 | op 体读 `brepEngineId === 'occt'`（`runtime.ts:583` 已提供） | 把「引擎 × 核函数」矩阵的知识下放到每处 op 体；新增引擎要改所有分叉点 |
| 装配时绑定 | 适配器在 `registerBrepEngine` 时把 L1 方法名绑到具体实现，op 体无条件调用 | op 体不含任何判据，最贴合「实现说了算」；但需要 L1 接口接受「同一方法在不同引擎绑到不同实现」，并明确这仍属装配期决定、不是运行期回退 |

三个候选都能做到「静态、写代码时刻确定」。差异在于「哪个引擎有哪些核函数」这条矩阵知识放在哪一层：现状放适配器（集中，但需守卫），身份方案放 op 体（分散），绑定方案放适配器装配代码（集中且无查询）。这一点需要拍板。

## 四、结论

1. 使用方的正确问题域是**结果对象**，不是引擎：几何结果与实现无关；命名可用性必须可查，且应以「这张面有没有 role 血统」这种逐对象的形态暴露，而不是新增一个「引擎支不支持 history」的全局查询。
2. 能力表**不能整体删除**：`evolution` + `methods` 与 `directEdit` 有活消费方。
3. 能力表中**有一半可直接删除且零行为变化**：`exact` / `brepExport` / `exactMeasurement` / `tessellationModel` 与 `assembly` / `meshLift`；`heal` / `advSurface` 在确认语义归属后同批可删。
4. `capability-map.json` 是构建期审计产物，与运行时分派无关，其存废单独判定，不受上述影响。
