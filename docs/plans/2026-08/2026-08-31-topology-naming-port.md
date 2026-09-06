# 拓扑命名（Topological Naming）移植方案：把 brepjs 的 shapeRef 体系接入 faijs

> 状态：方案（未实施）
> 日期：2026-08-31
> 关联：`docs/analysis/2026-08-31-adopt-brepjs-feasibility.md`、`docs/plans/2026-08-31-chamfer-brep-api-design.md`

---

## §0 更正：我此前反复陈述的一条判据是错的

在多个会话中（含 2026-08-31 的 brepjs 可行性分析报告 §7 与倒角方案 §2），我反复用下面这句话为 faijs 的 ordinal 方案辩护：

> 「faijs 不需要 brepjs 的 role 表：`.faijs` 是纯文本确定性重放，同一脚本重放出同一构造序列 → ordinal 稳定。」

**这句话是错的，本文予以撤回。** 用户当面给出的反例（原文照录）：

> 「假设我选择了拓扑面编号3，和另外一个模型进行了面对面重合装配。然后对模型做了倒角。然后移动位置，这时要重算装配，结果发现拓扑面编号3错了，因为倒角增加了面数。拓扑的追踪是任何CAD软件都必须处理的事情。」

### 0.1 错误的技术本质：混淆了两个正交的问题

| | 问题 A：重放确定性 | 问题 B：引用持久性 |
|---|---|---|
| 命题 | 同一份脚本从头执行 → 得到相同结果 | 脚本被**编辑后**，此前记录的选择仍指向同一语义实体 |
| 关注对象 | 结果**几何** | 引用的**语义** |
| faijs 现状 | ✅ 成立（纯文本确定性重放） | ❌ 不成立 |
| 依赖 | 脚本内容不变 | 脚本内容**会变** |

**关键**：即使重放完全确定，「重放出同一构造序列」也**推不出** ordinal 指向同一语义面 —— 因为**用户的选择是在编辑历史的某个时点做的，而那个选择要能在脚本被修改之后的新拓扑上被重新解析**。插入一条倒角语句就改变了构造序列本身，ordinal 作为**枚举序号**必然随之漂移。

一句话：**确定性保证"同样的输入得到同样的输出"，拓扑命名保证"改了输入以后，之前那句话指的还是那个东西"。前者成立推不出后者。**

### 0.2 ordinal 为什么必然失效（用户反例的逐步推演）

```
t0:  part1 = cad.box(30,30,10)        → 6 个面，ordinal 0..5
t1:  用户在 UI 选中顶面               → 记录 'o1.f3'
t2:  part3 = asm.mate(part1, part2, { faceA: 'o1.f3', ... })
                                       → 装配约束固化了 'o1.f3'
t3:  插入倒角 part1_v1 = cad.chamfer(part1, { edges: [...], d: 2 })
                                       → 顶面 4 条边各生成 1 个倒角面（+4）
                                       → 顶面被 modified（面积缩小）
                                       → OCCT 重建子形状枚举 → ordinal 重排
t4:  part1_v2 = cad.translate(part1_v1, [5,0,0])
t5:  重算装配 → 解析 'o1.f3'
     ✗ ordinal 3 现在指向的是倒角生成的斜面，或另一个原本无关的侧面
```

失败不在 t4（移动），移动本身保拓扑；失败在 **t3（倒角）改变了面集**，而 `'o1.f3'` 的语义是"枚举顺序第 3 个"，不是"用户当初选的那个顶面"。

### 0.3 三条面向后续的硬纪律

1. **ordinal 只能做显示与调试，不能做身份。** 身份必须由「随形状演化的稳定标识（hash 链）」承担，或由「与枚举顺序无关的语义名 + 几何快照」承担。
2. **不可定案即报错，禁止静默挑一个。** 沿用 brepjs 纪律（`HINT_MARGIN = 1e-6` 判 `ambiguous`）。把近似伪装成精确是静默错误。
3. **断链即冻结。** mesh 侧没有 OCCT 形状 → 没有 evolution → role 表无法推进。此时必须显式标记 `provenance: 'mesh-approx'`，不得编造稳定 id。

---

## §1 需求与验收口径

用户原话（本次需求）：

> 「给我写一份新的技术实施方案，主要是如何把brepjs的拓扑相关的代码移植过来。」
> 「拓扑的追踪是任何CAD软件都必须处理的事情。」

**验收口径**：以 §0 的用户反例作为**唯一的端到端判据**。方案成立 ⇔ 下面的脚本在插入倒角 + 移动之后，装配约束仍能解析到同一个语义面：

```
part1     = cad.box(30, 30, 10)
part2     = cad.box(10, 10, 10)
part3     = asm.mate(part1, part2, { faceA: <FaceRef>, faceB: <FaceRef> })
part1_v1  = cad.chamfer(part1, { edges: [<EdgeRef>], d: 2 })   // 插入：改变面集
part1_v2  = cad.translate(part1_v1, [5, 0, 0])                 // 移动：保拓扑
// 断言：resolveFaceRef(part3.params.faceA, part1_v2) === part1 当初被选中的那个顶面
```

---

## §2 问题建模：什么能持久化，什么不能

这是整个方案的支点。三类候选标识的可持久化性：

| 标识 | 能否写进 `.faijs` | 失效条件 | 证据 |
|---|---|---|---|
| **ordinal**（枚举序号） | ❌ | 任何改变面集的操作 | 用户反例；`topologyExt.ts:820/877` |
| **OCCT hash** | ❌ | 进程重启 / 形状重建 | brepjs 注释：`generated` 的 hash「refer to an intermediate shape, not the final result」（`shapeRefFns.ts:169-172`） |
| **语义 role 名**（`box:top`） | ✅ | 几何语义被破坏（如旋转到非轴对齐） | `shapeRefFns.ts:47-55` 按外法向判定 |
| **几何 hint**（法向/质心/面积/长度） | ✅ | 几何本身被改得面目全非 | `scoring.ts:32-79` |
| **role table**（role → hash[]） | ❌（内存态游标） | — | 随 evolution 推进，是运行时状态 |

**结论**：能落进 `.faijs` 文本的只有「**语义 role 名 + 几何 hint**」；hash 只能在**单次会话内**作为加速索引；role table 是内存游标，随模型演化推进，绝不落盘。

---

## §3 faijs 现状病灶（实测）

### 3.1 身份 = 纯 ordinal

`packages/core/src/occt-kernel/topologyExt.ts`：

```ts
:820   asEdgeId(`${occId}.e${ordinal}`), occId, shapeId, ordinal, curveType, ...
:877   asFaceId(`${occId}.f${ordinal}`), occId, shapeId, ordinal, surfaceType, ...
```

`FaceId = 'o1.f3'` —— 除了枚举序号，**没有任何身份信息**。

### 3.2 evolution 被降级成 ordinal 映射，且被当作可持久化

`packages/core/src/brep/face-evolution.ts:6-12`（模块头注释）：

> 「occt-wasm 的 \*WithHistory API 返回 BrepEvolutionData，其中 modified/generated 用面 hash（内存指针哈希）编码。本模块将其解码为 ordinal 映射（面枚举序号），**可安全持久化进 faijs 文本**。」

`decodeEvolution`（`:71-113`）把 hash 对**转换**成 `Map<inOrdinal, outOrdinal[]>`。**这一步是错误判据的落地**：它丢掉了唯一可靠的运行时身份（hash），换成了必然漂移的 ordinal。

### 3.3 变换操作用"假设"代替真实 history

`identityEvolution`（`:212-222`）：

```ts
// 变换操作不改变面的数量和顺序，每个面 ordinal i → [i]
// 避免调用 *WithHistory API（rotate/scale 的 WithHistory 签名与现有 Euler/Vec3 参数不兼容）
```

两处问题：
- 「避免调用」是**绕开问题**，不是解决问题。occt-wasm 3.8.4 已提供 `translateWithHistory` / `rotateWithHistory` / `scaleWithHistory`（见 §5），签名适配成本远低于假设失效的代价。
- 「rotate 不改变面顺序」这个假设**未被任何测试保护**。

### 3.4 `FaceEvolution` 是只写不读的死数据

全仓消费方（已实测 `grep -rn "face-evolution\|FaceEvolution" packages/*/src`）：

| 位置 | 角色 |
|---|---|
| `brep/face-evolution.ts:36,50,71,122,153,171,189,212` | 生产方 |
| `brep/brep-chain.ts:95-102,123,142` | 缓存（`faceEvolutionCache`） |
| `cad-runtime/module-executor.ts:90-91,127,135,398` | 槽位同步 |
| `cad-runtime/preview-exec.ts:32-33` | 预览层 get/set |

**零读取消费者。** 与 brepjs 的 `historyFns` / `capabilities` 同一病症：机制建好了，没人接线。

### 3.5 现有 `Reference` 已具备 hint 所需字段（好消息）

`packages/core/src/topology/types.ts:182-209` 的 `PickData` 已含：

- 面：`surfaceType`（`:203`）、`area`（`:204`）、`normal`（`:186`）、`center`（`:185`）
- 边：`curveType`（`:207`）、`length`（`:208`）、`center`（`:186`）
- 邻接：`adjacentSelectors`（`:193`）

**brepjs 的 `GeometricHint{ surfaceType, normal, centroid, area }` 与 `EdgeHint{ length, midpoint }` 所需字段 faijs 现成就有**，不需要新增几何采集代码。

---

## §4 brepjs 拓扑命名体系解剖

### 4.1 三层机制（自底向上）

| 层 | 职责 | 关键文件 | 生命周期 |
|---|---|---|---|
| **L-A 面来源标记** | 给面打**整数** tag，标"这块面来自哪条语句/哪个来源" | `topology/metadata/originTrackingFns.ts` | 内存，随形状走 |
| **L-B role 表** | `origin → role → hash[]`，随 evolution **推进** | `topology/shapeRef/shapeRefFns.ts` | 内存游标，**不落盘** |
| **L-C 解析** | exact → 分裂组内消歧 → 全形状几何 fallback | `shapeRefFns.ts` / `edgeRefFns.ts` / `refResolveFns.ts` | 调用时 |

> **L-A 与 L-B 是两回事，不可混淆**：L-A 的 `origin` 是**整数**（`originTrackingFns.ts:25` "opaque integer origin"，注释明说"Consumers assign meaning (e.g., source line number)"），服务**多色导出**；L-B 的 `origin` 是 **string**（语句/操作 id），服务**引用命名**。faijs 无多色导出需求，**L-A 不需要移植**。

### 4.2 类型契约（`shapeRef/shapeRefTypes.ts`）

```ts
// 面引用：语义 role 名 + 几何快照
interface ShapeRef {
  readonly origin: string;                 // 's0' / faijs 侧取 statementId
  readonly role: string;                   // 'box:top' | 'box:face_3'
  readonly hint: GeometricHint;
}
interface GeometricHint {
  readonly entityType: 'face';
  readonly surfaceType?: SurfaceType;
  readonly normal?: Vec3;
  readonly centroid?: Vec3;
  readonly area?: number;
}

// role 表：role 可映射到多个 hash（1→many 分裂的全部碎片）
type RoleTable = ReadonlyMap<string, ReadonlyMap<string, readonly number[]>>;
//                origin          role            hash[]

// 边引用：由两个邻接面的 role 定义（核心命题见 :88）
interface EdgeRef {
  readonly origin: string;
  readonly faceRoles: readonly [string, string];
  readonly hint: EdgeHint;                 // { entityType:'edge', length?, midpoint? }
}
```

核心命题（`shapeRefTypes.ts:88`）：**「An edge *is* the intersection of its two faces」**。边的身份骑在**已经稳定的面 role** 上，因此边引用**绕开了内核不可靠的 `generated` hash**（`:91-92` 明说 "sidesteps the kernel's unreliable `generated`-face hashes entirely"）。

### 4.3 role 分配：语义优先、位置兜底（`shapeRefFns.ts:105-128`）

`ROLE_ASSIGNERS`（`:82-87`）只覆盖 box / cylinder / cone / sphere，按**外法向**判语义名：

```ts
boxRoleFromNormal(n)  // :47-55   |n[axis]| > 0.9 → 'box:top'|'bottom'|'front'|'back'|'left'|'right'
cylinderRole / coneRole / sphereRole  // :67-79
```

**未识别的面一律退化为位置名** `${operationType}:face_${index}`（`:120`）。

> ⚠️ 这正是我此前误读的源头：我看到了"位置名兜底"，却把**分配时的命名方式**当成了**身份的维持机制**。实际身份完全由 `updateRoles` 沿 evolution 推进的 **hash 链**维持，ordinal 只在分配的那一瞬间被读了一次。**分配用 ordinal ≠ 身份靠 ordinal。**

### 4.4 role 表推进（`shapeRefFns.ts:149-198`）

```ts
function nextHashes(hashes, evolution) {
  for (const hash of hashes) {
    if (evolution.deleted.has(hash)) continue;                    // 删除 → 丢弃
    const modified = evolution.modified.get(hash);
    const targets = modified?.length ? modified : [hash];          // 修改 → 取全部后继
    for (const h of targets) if (!dup) successors.push(h);         // 未变 → 原样保留
  }
}
```

三点纪律：
- **1→many 保留全部碎片**（`:145-147`），不在推进时挑选；挑选推迟到解析阶段。
- 某个 role 的 hash 全被删 → **整个 role 从表中移除**（`:189`）。
- **`evolution.generated` 刻意不消费**（`:169-174`）：OCCT 上其 hash 指向中间形状而非最终结果，实测 cut/fuse 上 **0 个存活 generated hash**。

### 4.5 解析（`shapeRefFns.ts:265-300`）

```
1. exact：role 的 hash 集合 ∩ 当前形状面集
     - 恰好 1 个 → { confidence: 'exact' }
     - 0 个      → { reason: 'deleted' }
     - 多个      → 进 2（面被 split）
2. 在「该 role 追踪到的后继集合内」按 hint 打分消歧
     - 命中 → { confidence: 'geometric-fallback' }
     - 打分并列 → { reason: 'ambiguous', candidates }
     - 全不匹配 → 进 3
3. 全形状几何 fallback → 命中 / ambiguous / { reason: 'not-found' }
```

**关键设计**：第 2 步的候选集**仅限于该 role 的后继碎片**，不与全形状竞争。注释（`:216-218`）："Scoping the candidates to a role's tracked successors ... is what makes split-face disambiguation reliable — the fragments compete only with each other, not with unrelated geometry."

消歧阈值（`:204-207`）：`AMBIGUITY_THRESHOLD = 0.1`（最优与次优分差小于此即判 ambiguous）、`MIN_SCORE = 0.5`。

### 4.6 打分函数（`scoring.ts:32-79`）

```
surfaceType 匹配 +1.0；不匹配 → -Infinity（直接否决）
normal     dot < 0.707 → -Infinity；否则 +dot
centroid   distSq > 100(mm²) → -Infinity；否则 -distSq/100
area       |log(hintArea/faceArea)| > 1.0 → -logRatio
```

### 4.7 已有测试覆盖（有效性的硬证据）

`tests/shapeRefEditReplay.test.ts` 的用例**直接对应用户反例的机制**：

| 用例 | 场景 | 断言 |
|---|---|---|
| `:44` | box → fuse 一个块到顶面（顶面被 **modified**） | `updateRoles` 把 `box:top` 带到后继，`resolveRef` 经**表**（非几何猜测）命中，且是"向上的平面"而非侧壁 |
| `:73` | 大顶面被部分覆盖后 **split** 成两片（大片 z≈10 + 小块盖 z≈20） | 在**被追踪的后继集合内**消歧，命中大片：`z < 15` 且 `area > 100` |

测试文件头注释（`:1-8`）明示其定位：其他 shapeRef 测试"either bypasses the role table (`new Map()`, forcing the geometric fallback) or asserts only 'didn't crash / area > 0'"，而这两个**走真实 `ShapeEvolution` 的 exact path 并断言面身份**。

**且该测试 `describe.skipIf(!isOcctFamily)`，`isOcctFamily = currentKernelId === 'occt' || currentKernelId === 'occt-wasm'`（`:31,43`）** —— faijs 用的正是 `occt-wasm`，**这套机制在 faijs 的引擎上验证过**。

---

## §5 移植可行性：地基已就位（关键核实）

### 5.1 occt-wasm 版本比对

| | brepjs | faijs |
|---|---|---|
| devDependency | `occt-wasm: 4.3.0` | `occt-wasm: 3.8.4` |
| peerDependency | `^3.8.0 \|\| ^4.0.0` | — |
| 实装 | — | **3.8.4** |

faijs 的 3.8.4 **落在 brepjs 声明的兼容区间内**。

### 5.2 brepjs 依赖的 12 个 `*WithHistory` API，faijs 的 3.8.4 **全部具备**

实测 `C:\my\Faicad\faijs\node_modules\occt-wasm\dist\index.d.ts:458-472`（高层封装，非 raw）：

```
translateWithHistory / rotateWithHistory / mirrorWithHistory / scaleWithHistory
fuseWithHistory / cutWithHistory / intersectWithHistory
filletWithHistory / chamferWithHistory
shellWithHistory / offsetWithHistory / thickenWithHistory
```

以及 `hashCode(shape, upperBound)`（`:285`）、`subShapeHashes(shape, type, hashUpperBound)`（`:279`）。

### 5.3 hash 上界常量一致

| | 常量 | 值 |
|---|---|---|
| brepjs | `HASH_CODE_MAX`（`src/core/constants.ts:2`） | `2147483647` |
| faijs | `HASH_UPPER_BOUND`（`brep/face-evolution.ts:19`） | `2147483647` |

**完全一致。** faijs 现已在调用 `kernel.subShapeHashes(shape, 'face', HASH_UPPER_BOUND)`（`face-evolution.ts:37`），与 brepjs 的 `subShapeHashes(input, 'face')` 同源。

### 5.4 结论

> **移植不需要换包、不需要 fork brepjs、不需要重编译 C++、不需要额外 wasm。** 内核能力、版本区间、hash 常量、几何采集字段四项地基全部就位。缺的是**上层的 role 表与解析层**，那正是本次要移植的部分。

---

## §6 移植方案：分层架构

### 6.1 总体分层

```
┌─ P0 持久化层 ─ 写进 .faijs 文本 ────────────────────────┐
│  FaceRef { origin, role, hint }                          │
│  EdgeRef { origin, faceRoles:[role,role], hint }         │
│  语义 role 名 + 几何 hint —— 与枚举顺序无关              │
└──────────────────────────────────────────────────────────┘
                        ↕ 解析时结合
┌─ P1 运行时层 ─ 内存，不落盘 ─────────────────────────────┐
│  RoleTable: Map<origin, Map<role, hash[]>>               │
│  随每条 BREP 语句的 ShapeEvolution 推进                   │
│  作为语句产物的组成部分进入 ModuleExecutor 的缓存/失效体系 │
└──────────────────────────────────────────────────────────┘
                        ↑ 推进
┌─ P2 内核层 ─ occt-wasm *WithHistory ────────────────────┐
│  已有：cut/fuse/intersect + translate/rotate/scale 假设    │
│  待补：fillet/chamfer/shell/offset（3.8.4 已提供）        │
└──────────────────────────────────────────────────────────┘
```

### 6.2 P0：持久化引用契约

```ts
// packages/core/src/topology/naming/types.ts

/** 面的稳定引用。写进 .faijs，跨会话、跨重建有效。 */
export interface FaceRef {
  readonly kind: 'face';
  /** 该面诞生于哪条语句 —— faijs 侧取 statementId（'part1_v0'），不是 op 类型。 */
  readonly origin: string;
  /** 语义 role 名（'box:top'）或位置兜底名（'box:face_3'）。 */
  readonly role: string;
  readonly hint: FaceHint;
}

export interface FaceHint {
  readonly surfaceType?: string;
  readonly normal?: readonly [number, number, number];
  readonly centroid?: readonly [number, number, number];
  readonly area?: number;
}

/** 边的稳定引用：由两个邻接面的 role 定义（"边是两面的交线"）。 */
export interface EdgeRef {
  readonly kind: 'edge';
  readonly origin: string;
  readonly faceRoles: readonly [string, string];
  readonly hint: EdgeHint;
}

export interface EdgeHint {
  readonly length?: number;
  readonly midpoint?: readonly [number, number, number];
}
```

**判定规则**（与 brepjs 一致）：`isFaceRef` 看 `typeof role === 'string'`；`isEdgeRef` 看 `faceRoles.length === 2`（`refResolveFns.ts:49-59`）。

### 6.3 P1：role 表与推进

```ts
// packages/core/src/topology/naming/roleTable.ts
export type RoleTable = ReadonlyMap<string, ReadonlyMap<string, readonly number[]>>;

/** 分配：语义优先，位置兜底。origin 取 statementId。 */
export function assignRoles(
  kernel: BrepEngineApi, shape: BrepHandle, origin: string, opType: string
): Map<string, number[]>;

/** 推进：沿一次 ShapeEvolution 把每个 role 的 hash 集推进到后继。 */
export function updateRoles(
  roles: RoleTable, origin: string, evolution: ShapeEvolutionHash
): RoleTable;
```

`ShapeEvolutionHash` 是**保留 hash 的**演化记录（与现状 `FaceEvolution`（ordinal 版）区分）：

```ts
export interface ShapeEvolutionHash {
  readonly modified:  ReadonlyMap<number, readonly number[]>;  // inHash → outHash[]
  readonly deleted:   ReadonlySet<number>;
  // generated 刻意不消费：OCCT 上其 hash 指向中间形状（brepjs 实测 0 存活）
}
```

### 6.4 P2：解析与消歧

```ts
// packages/core/src/topology/naming/resolve.ts
export type NamingResolution =
  | { ok: true; entity: BrepSubShapeHandle; confidence: 'exact' | 'geometric-fallback' }
  | { ok: false; reason: 'deleted' | 'ambiguous' | 'not-found'; candidates?: BrepSubShapeHandle[] };

export function resolveFaceRef(ref: FaceRef, roles: RoleTable, shape: BrepHandle): NamingResolution;
export function resolveEdgeRef(ref: EdgeRef, roles: RoleTable, shape: BrepHandle): NamingResolution;
```

三级解析（与 §4.5 同构）：

1. **exact**：`roles[origin][role]` 的 hash 集 ∩ 当前面集，恰好 1 个 → `'exact'`
2. **分裂消歧**：多个存活 → **仅在后继集合内**按 hint 打分 → `'geometric-fallback'`；并列 → `ambiguous`
3. **全形状 fallback** → 命中 / `ambiguous` / `not-found`

`survivors.length === 0` → `deleted`（brepjs 语义：role 的所有 hash 都被删）。

### 6.5 与 3d_editor 的接口：零转换

3d_editor 选中态已是 `'topology|edge|o1.e7'`（`selection-store.ts:42-72`）。迁移后**字符串保持同一形状**（`o1.f3` / `o1.e7` 继续做**显示 id**），但 `Reference` 额外携带 `FaceRef` / `EdgeRef` 作为**身份载荷**：

```
显示：  FaceId  = 'o1.f3'            （ordinal，仅显示与调试，不做身份）
身份：  FaceRef = { origin:'part1_v0', role:'box:top', hint:{...} }   （写进脚本）
```

**3d_editor 不需要改选中态格式**，只需在生成脚本参数时从 `Reference` 取 `FaceRef` 而非 `FaceId`。

---

## §7 移植清单：brepjs → faijs 逐文件映射

| brepjs 源文件 | faijs 目标 | 移植方式 | 说明 |
|---|---|---|---|
| `shapeRef/shapeRefTypes.ts` | `topology/naming/types.ts` | **契约照搬** | 类型定义，改 import 路径即可 |
| `shapeRef/scoring.ts` | `topology/naming/scoring.ts` | **照搬** | 打分函数，纯几何，无内核耦合 |
| `shapeRef/shapeRefFns.ts`（`assignRoles`/`updateRoles`/`resolveRef`） | `topology/naming/roleTable.ts` + `resolve.ts` | **改造** | `getKernel()` → 显式 `BrepEngineApi` 参数；`Shape3D` → `BrepHandle`；`Result<T>` → `throw` |
| `shapeRef/roleLookup.ts` | `topology/naming/roleLookup.ts` | **照搬** | 正/反向查找 |
| `shapeRef/edgeRefFns.ts` | `topology/naming/edgeRef.ts` | **改造** | 同上；`facesOfEdge`/`sharedEdges` 需 faijs 侧邻接查询对应物 |
| `shapeRef/refResolveFns.ts` | `topology/naming/resolve.ts` | **照搬 dispatch** | `resolveRefParams` 对 faijs 增量执行直接有用 |
| `shapeRef/vertexRefFns.ts` | 暂不移植 | — | 顶点引用 faijs 暂无需求 |
| `shapeRef/derivedFaceRefFns.ts` | **暂不移植，登记为已知缺口** | — | 倒角/圆角生成面的命名，依赖法向混合判定；faijs 倒角先行用 `EdgeRef` 入参，生成面命名后置 |
| `topology/evolutionFns.ts`（`*WithEvolution`） | 扩 `brep/face-evolution.ts` | **改造 + 补全** | 现有 cut/fuse/intersect 保留；**新增 fillet/chamfer/shell**；`decodeEvolution` 改为保留 hash |
| `topology/metadata/originTrackingFns.ts` | **不移植** | — | 整数 origin tag，服务多色导出，与命名无关 |
| `topology/metadata/metadataPropagation.ts` | **不移植** | — | 同上（face tag / color 传播） |

### 7.1 必须改造的四处（不可照抄）

| # | brepjs 原设计 | faijs 必须改 | 理由 |
|---|---|---|---|
| **C1** | `decodeEvolution` 输出 hash 映射，role 表用 hash | 现状输出 **ordinal** 映射 | 现状把运行时身份降级了。改为 `ShapeEvolutionHash` 保留 hash；ordinal 映射降级为**调试辅助**，不参与身份 |
| **C2** | `ROLE_ASSIGNERS` 按 **op 类型**（`box`/`cylinder`）分配 | faijs 的 `origin` 取 **statementId**（`part1_v0`） | faijs 是 `libname.opname(args)`，同一 op 可在多语句出现；op 类型不足以定位来源 |
| **C3** | `identityEvolution` 变换走合成 identity，**并明确避免调 WithHistory** | 改为**真正调用** `translateWithHistory` / `rotateWithHistory` / `scaleWithHistory` | 3.8.4 已提供（§5.2）。brepjs 对 `generalTransform` 才合成 identity（`occtWasm/evolutionOps.ts:194-201`），且注释限定"Affine transforms preserve topology"。faijs 应**先真调，仅在无对应 C++ 入口时合成** |
| **C4** | 单内核单表示（只有 `KernelShape`） | faijs 有 **BREP/mesh 双链路** | 见 §8.1，brepjs 无此问题 |

### 7.2 可复用的既有 faijs 资产

- `PickData`（`topology/types.ts:182-209`）：hint 字段**现成**（§3.5）
- `BrepEngineApi.subShapeHashes` / `hashCode`：已在用（`face-evolution.ts:37`）
- `HASH_UPPER_BOUND = 2147483647`：与 brepjs 一致（§5.3）
- `faceEvolutionCache`（`brep-chain.ts:102`）：**改造后复用**为 role table 的存储位（见 §8.2）

---

## §8 faijs 特有难点与对策（brepjs 无对应设计）

### 8.1 难点一：BREP 断链后没有 evolution

**问题**：brepjs 全程单一表示，evolution 永远可得。faijs 断链后（`dispatchPath === 'mesh'`）该 part 只剩 `Shape = {positions, indices}`，**没有 OCCT 句柄 → 没有 evolution → role 表无法推进**。

**对策（三条硬规则）**：

1. **断链即冻结 + 标记**：断链瞬间，把该 part 的 role 表快照冻结，并给所有引用打 `provenance: 'mesh-approx'`。
2. **禁止给 mesh 面编造稳定 id**：mesh 侧的面由三角化聚类得到，没有拓扑身份。给它发 id 是把近似伪装成精确（§0.3 纪律 3）。
3. **引用跨断链解析 = 显式失败**：`resolveFaceRef` 遇到 `provenance: 'mesh-approx'` 的目标，返回 `{ ok:false, reason:'not-found' }` 并附 `candidates`，由上层决定是让用户重选还是走几何近似。**不得静默命中。**

> 用户此前的判断——「也许只是简单的让数据格式兼容」——**成立一半**：**id 空间可以统一**（共用 `o1.f3` 显示 id 与 `Reference` 结构），但**稳定性必须分层标记**，不能让 mesh 侧假装自己有演化史。

### 8.2 难点二：语句级增量与缓存失效

**问题**：`ModuleExecutor` 按 `statementKey` 缓存语句产物。`FaceEvolution` 目前只是"顺带同步"（`module-executor.ts:398`），无人消费。role 表必须成为**一等产物**，否则增量重算时会读到过期的 hash。

**对策**：把 `roleTable` 纳入语句产物契约：

```
语句产物 = { shape: Shape, brepHandle?: Handle, roleTable?: RoleTable, namingProvenance: 'brep'|'mesh-approx' }
```

失效规则：
- `statementKey` 不变 → 复用缓存的 `roleTable`（含其推进状态）
- `statementKey` 变 → **该语句及其全部下游**的 role 表重算（hash 是会话内游标，与句柄同生命周期）
- 插入新语句 → 下游 role 表沿新 evolution 重新推进

⚠️ **推论**：role 表与 OCCT 句柄**同生命周期**。句柄被 `release` / 会话重建 → role 表作废 → 必须靠 P0 的 `role + hint` 重新 `assignRoles` 冷启动（对应 brepjs 的 `resolveRefIn`，其稳定性受限于 role 分配方案，见 `refResolveFns.ts:110-116`）。

### 8.3 难点三：写进 `.faijs` 文本

**问题**：brepjs 的 ref 活在内存/JSON 里。faijs 必须能塞进 `partN = lib.op(args...)` 的参数位。

**对策**：`FaceRef` / `EdgeRef` 是**纯 JSON 字面量**，可直接作为参数值：

```js
part1    = cad.box(30, 30, 10)
part2    = cad.box(10, 10, 10)
part3    = asm.mate(part1, part2, {
  faceA: { kind:'face', origin:'part1_v0', role:'box:top',
           hint:{ surfaceType:'PLANE', normal:[0,0,1], centroid:[0,0,10], area:900 } },
  faceB: { kind:'face', origin:'part2_v0', role:'box:bottom',
           hint:{ surfaceType:'PLANE', normal:[0,0,-1], centroid:[0,0,0], area:100 } },
})
part1_v1 = cad.chamfer(part1, {
  edges: [{ kind:'edge', origin:'part1_v0', faceRoles:['box:top','box:front'],
            hint:{ length:30, midpoint:[0,-15,10] } }],
  d: 2,
})
part1_v2 = cad.translate(part1_v1, [5, 0, 0])
```

**关键**：这里序列化的**不是 hash**（不能落盘），而是 `role + hint`。解析时再由内存中的 role 表把 `role` 翻译成当前 hash。这也顺带解决了 UI 录制的可读性 —— `role:'box:top'` 比 `hash: 1837420913` 对人类友好得多。

---

## §9 分阶段实施计划

| 阶段 | 内容 | 交付物 | 完成判据 |
|---|---|---|---|
| **M1 内核层补全** | `face-evolution.ts` 输出 `ShapeEvolutionHash`（保留 hash）；新增 `chamferWithHistory` / `filletWithHistory` / `shellWithHistory` 封装；`identityEvolution` 改为真调 `translateWithHistory` 等 | `brep/face-evolution.ts` 改造 | `decodeEvolution` 返回的 key/value 是 hash 而非 ordinal；三个新封装各有单测 |
| **M2 命名层移植** | 新建 `topology/naming/`：`types.ts` / `scoring.ts` / `roleTable.ts` / `roleLookup.ts` / `resolve.ts` / `edgeRef.ts` | 6 个新文件 | 单元测试覆盖 exact / split 消歧 / ambiguous / deleted / not-found 五条路径 |
| **M3 role 分配接入** | `assignRoles` 以 **statementId** 为 origin；接入 `cad.box` / `cad.cylinder` 等基本体的语义命名器 | `primitives-brep.ts` 接线 | `cad.box` 产物的 role 含 `box:top` 语义名而非纯 `face_N` |
| **M4 断链与增量** | role 表纳入语句产物；断链冻结 + `provenance` 标记；`module-executor` 失效联动 | `brep-chain.ts` / `module-executor.ts` 改造 | 断链后引用解析返回显式失败而非静默命中 |
| **M5 端到端验收** | 用户反例脚本（§1）+ 倒角链路打通 | `packages/tests/faijs/naming/` | §1 断言通过：插入倒角 + 移动后装配约束仍命中同一语义面 |
| **M6 3d_editor 对接** | `Reference` 携带 `FaceRef`/`EdgeRef`；生成脚本时写 ref 而非 ordinal 字符串 | 3d_editor 侧（跨仓） | UI 录制出的脚本含 `role + hint` |

**M1–M5 在 faijs 仓内闭环，M6 跨仓。** 建议 M5 通过后再动 3d_editor。

---

## §10 测试方案（提纲）

### 分层

| 层 | 位置 | 测什么 |
|---|---|---|
| 单元 | `packages/core/src/topology/naming/*.test.ts` | 打分函数、`nextHashes` 推进语义、`RoleTable` 不可变性 |
| 集成 | `packages/core/src/brep/face-evolution.test.ts` 扩展 | `ShapeEvolutionHash` 解码、三个新 WithHistory 封装 |
| 端到端 | `packages/tests/faijs/naming/` | 用户反例脚本 |

### 关键测点（对齐 brepjs 已有的两个用例，见 §4.7）

1. **modified 追踪**：box → fuse 一个块到顶面 → `box:top` 经表命中，且是向上的平面（`upness > 0.7`）。
2. **split 消歧**：大顶面被部分覆盖后分成两片 → 在被追踪的后继集合内消歧，命中大片（`z < 15` 且 `area > 100`）。
3. **倒角后仍命中**（用户反例核心）：box → 选顶面 → chamfer（改变面集）→ translate → `resolveFaceRef` 仍命中顶面。
4. **negative**：删除被引用的面 → `reason: 'deleted'`；两个候选打分并列 → `reason: 'ambiguous'` + `candidates`；断链后解析 → `reason: 'not-found'`。
5. **不可变性**：`updateRoles` 返回新表，入参表不被改动。

> 所有测试按 `CLAUDE.md` 的分层流程跑：`lint` → `tsc --noEmit` → `vitest run` → 相关 e2e。**不跑全量 e2e，不跑 CI 总脚本。**

---

## §11 风险登记

| # | 风险 | 影响 | 对策 |
|---|---|---|---|
| **N1** | `assignRoles` 仅 4 种基本体有语义命名器，其余退化位置名 | 非基本体（extrude/loft/svg 等）的引用稳定性退回 ordinal 水平 | M3 后评估：为高频 op 补语义命名器；位置名至少配强 hint 兜底 |
| **N2** | `generated` 在 occt-wasm 上 0 存活 hash（brepjs 实测） | **倒角/圆角生成的新面无法被 role 表追踪** | 倒角入参走 `EdgeRef`（骑在面 role 上，绕开 generated）；生成面命名依赖 `derivedFaceRefFns`，列为 M5 后的已知缺口 |
| **N3** | hash 与 OCCT 句柄同生命周期，会话/重建后失效 | 冷启动时只能靠 `role + hint` 重新解析，稳定性受 role 分配方案限制 | 语义命名器覆盖优先（降低对位置名的依赖）；冷启动失败必须显式报错而非静默 |
| **N4** | 断链后 role 表无法推进 | mesh 侧引用全部退化为 `not-found` | 显式 `provenance` 标记 + 上层引导用户重选；禁止编造 |
| **N5** | `faceEvolutionCache` 现为死数据，改造可能影响现有 3d_editor 契约 | 跨仓回归 | M4 保持 `setFaceEvolution` 签名兼容，内部语义切换 |
| **N6** | `identityEvolution` 的"变换保序"假设无测试保护 | 假设失效会静默错配 | M1 改为真调 `translateWithHistory` 等，并加"变换后 role 表逐面一一对应"断言 |
| **N7** | brepjs 版本漂移（现 adapter 依赖 18.119.2） | 移植后若上游改契约，需同步 | 本次移植是**源码级采纳**（非运行时依赖），漂移风险仅限契约参考；新代码自带测试即门禁 |

---

## §12 调研足迹

### brepjs（`C:/git/OpenCascade/brepjs`，v18.164.0）

| 文件 | 核实内容 |
|---|---|
| `topology/shapeRef/shapeRefTypes.ts` | `ShapeRef:31-38`、`GeometricHint:15-21`、`RoleTable:52`、`EdgeRef:94-99`、核心命题 `:88`、`DerivedFaceRef:177-188` |
| `topology/shapeRef/shapeRefFns.ts` | `boxRoleFromNormal:47-55`、`ROLE_ASSIGNERS:82-87`、`assignRoles:105-128`（位置兜底 `:120`）、`nextHashes:149-158`、`updateRoles:176-198`（generated 不消费 `:169-174`）、`scoreFaces:220-252`、`resolveRef:265-300` |
| `topology/shapeRef/edgeRefFns.ts` | `captureEdgeHint:24-31`、`HINT_MARGIN:47`、`bestByHint:55-80`、`createEdgeRef:91-103`、`resolveEdgeRef:111-139` |
| `topology/shapeRef/roleLookup.ts` | `roleOfFace:39-47`、`facesForRole:50-59` |
| `topology/shapeRef/scoring.ts` | `defaultScorer:32-79` |
| `topology/shapeRef/refResolveFns.ts` | `LineageRef:21`、`resolveLineageRef:78-99`、`resolveRefIn:117-119`（稳定性受 role 方案限制 `:110-116`）、`resolveRefParams:141-164` |
| `topology/evolutionFns.ts` | `EvolutionResult:32`、`chamferWithEvolution:383-464`（`collectInputFaceHashes:439` → `chamferWithHistory:440` → `propagateAllMetadata:452`） |
| `topology/metadata/metadataPropagation.ts` | `hasAnyMetadata:38`、`collectInputFaceHashes:42-53`、`propagateAllMetadata:66-74`、`propagateMetadataThroughRelocation:108-128` |
| `topology/metadata/originTrackingFns.ts` | `setShapeOrigin:25-32`（**整数** origin）、`propagateOriginsFromEvolution:49-101`、`propagateOriginsByHash:227-312` |
| `kernel/interfaces/evolutionOps.ts` | 12 个 `*WithHistory` 接口签名（`:22-135`） |
| `kernel/occtWasm/evolutionOps.ts` | `parseEvolution:35-68`、`chamferWithHistory:305-325`、`filletWithHistory:283-303`、`applyComposedTransformWithHistory:422-449`（按 index 配对，注释"Affine transforms preserve topology"） |
| `tests/shapeRefEditReplay.test.ts` | 用例 `:44`（modified 追踪）、`:73`（split 消歧）；`isOcctFamily:31,43` |
| `package.json` | `occt-wasm: 4.3.0`（`:281`）、peer `^3.8.0 \|\| ^4.0.0`（`:298`） |

### faijs（本仓，均未改动）

| 文件 | 核实内容 |
|---|---|
| `occt-kernel/topologyExt.ts` | `asEdgeId(\`${occId}.e${ordinal}\`) :820`、`asFaceId(\`${occId}.f${ordinal}\`) :877` |
| `brep/face-evolution.ts` | `HASH_UPPER_BOUND:19`、"可安全持久化" `:7-8`、`decodeEvolution:71-113`、`identityEvolution:212-222`（"避免调用 WithHistory" `:206`） |
| `brep/brep-chain.ts` | `faceEvolutionCache:95-102,123,142` |
| `cad-runtime/module-executor.ts` | `setFaceEvolution:90-91,127,135,398` |
| `cad-runtime/preview-exec.ts` | `getFaceEvolution/setFaceEvolution:32-33` |
| `topology/types.ts` | `Reference:166-179`、`PickData:182-209`（hint 字段现成） |
| `topology/build-face-ids.ts` | 逐三角形 faceId（rowIndex），非 ordinal 字符串 id |
| `identity.ts` | `FaceId:76`、`EdgeId:78`、`asFaceId:195`、`asEdgeId:204` |
| 各 `package.json` | `occt-wasm: 3.8.4`（根 `:110,135`、core `:43`、demo/mech-lib/stdlib `^3.8.0`） |

### occt-wasm 实装核实（`C:/my/Faicad/faijs/node_modules/occt-wasm` @ 3.8.4）

| 文件 | 核实内容 |
|---|---|
| `dist/index.d.ts` | `hashCode:285`、`subShapeHashes:279`、**12 个 `*WithHistory`:458-472** |
| `dist/raw-types.d.ts` | `RawEvolutionData:61-66`、`*WithHistory` raw 签名 `:276-287` |
