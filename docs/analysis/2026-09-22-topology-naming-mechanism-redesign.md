# 拓扑命名：身份机制重构方案

> **本文件为完全重写版**（2026-09-22 第二轮）。它替代同文件上一版的设计部分（P1–P8），
> 不继承其结构。上一版的**盘点数据**经复核后保留了正确的部分，错误的已纠正（见 §2.4、§7.1）。
>
> 定位：理解 → 目标 → 设计 → 落地。不含实施代码。
> 与 [`2026-09-10-topological-naming-vs-geometric-selectors.md`](./2026-09-10-topological-naming-vs-geometric-selectors.md)
> 互补——那篇讲「身份（role）与几何谓词各解决什么」，本文讲「身份是什么、从哪来、怎么传递」。
>
> 前提（用户给定）：**不需要考虑 `.fai.js` 代码的兼容性**——可以改序列化形态、改身份语义、
> 一次性重生成 fixtures 里的引用字面量。

## 0. 用户原始需求（原话）

> 「这个问题，你先写一份分析文档，看看要如果更改设计。我需要一个全面的、合理的解决方案，不需要考虑
> .fai.js 代码的兼容性。就是拓扑命名的问题。我完全没看懂你说的 extrude 的特殊处理，而且看起来很可疑。
> 难道没有操作都要特殊处理？所以应该是机制有问题。」

> 「mesh处理不了拓扑。已有的代码也只是尝试一个近似拓扑，但实际上没法用。你的方案里，根本不需要考虑
> mesh的路径。把brep处理好。要彻底重新思考这个问题，而不是继承上一个方案。是否有更合理的处理办法。
> 而且，你没有写你对这个问题的理解。这是致命的。现有正确的理解，合理的目标，才有正确的设计。
> 先说说你的理解，以及这份方案应该实现哪些目标」

> 「说说你的理解，为何内核只给这些提供历史？来源 A｜内核历史：fillet/chamfer/cut/fuse/intersect」

> 「你这次判断对了。然后根据最新的理解，完全重写这份方案。把拓扑命名的问题彻底修正。」

---

## 1. 问题的正确表述

### 1.1 这不是「命名」问题，是「身份」问题

名字只是身份的**序列化形式**。真正要回答的是：**凭什么说一个面是"同一个面"？**

候选答案只有三个，两个是错的：

| 依据 | 行不行 | 为什么 |
|---|---|---|
| 枚举序号 | ✗ | 序号随拓扑变化漂移——这正是问题本身 |
| 几何（法向 / 面积 / 中心） | ✗ | ① 对称特征分不开「用户点的是哪一个」；② 改参数就改几何，而**名字存在的唯一理由就是抗参数变化** |
| **产生它的那次操作 + 那次操作把它当作什么** | ✓ | 唯一在重放下稳定的东西 |

所以身份的正确形态是**因果链上的坐标**：`（哪条语句, 那个角色）`。
现有代码里的 `RoleQualifier { origin, role }`（`topology/naming/types.ts:65-68`）恰好就是这个——**形态是对的**。

### 1.2 现状错在「把身份表达成什么」

形态对，但**表达错了**：

```ts
// topology/naming/types.ts:114
type RoleTable = ReadonlyMap<PartName, ReadonlyMap<string, readonly number[]>>
//                                                        ↑ 面 hash 列表
```

hash 是**内存指针哈希**（`brep/face-evolution.ts:6` 明写，上界 `% 2147483647`）。
它不是身份，它是**某一时刻的一次查询快照**。

一旦把身份表达成 hash，就被锁进一条链条：

> hash 每次执行都变 → 必须维护 hash→hash 的映射 → 映射只有内核历史能给 →
> 内核被认定只给 5 个 API → 2/3 的 op 断链 → 断链 = 无名 → 下游 `edgeRef` 炸

**整条链上每一环，都是在为一个错误的表达付利息。**
这比「op 忘了写建表代码」深一层：就算每个 op 都乖乖写，只要表达还是 hash，就得每个 op 都交映射，
就仍然走不通。

### 1.3 推论：每个 op 都是自己新造面的链根

现状把「链根」当成一种特殊身份——只有 `primitives` / `import_brep` / `extrude` 是链根，
其余 op 只做「传递」。这是错的。正确的是：

> **每个产形 op 同时做两件事：对自己新造的面负责命名，对继承来的面负责传递。**

`primitives` 只是「全部是新造」的退化情形。一旦这么看，
「倒角过渡面 / 布尔新面 / 拉伸侧壁无名」就不再是补丁，而是**机制本身被漏掉的那一半**。

---

## 2. 对应关系的两个来源（本次重构的核心认识）

op 需要回答的问题不是「我的输出面 hash 是哪些」，而是：
**「我的输出面，是从输入的哪些面、怎么变来的」**。

这个对应关系有**两个来源，且几乎不重叠**。现状只认了其中一个。

### 2.1 来源 A：内核历史（修改类 op）

OCCT 的历史来自 `BRepBuilderAPI_MakeShape::History()`——一个**虚函数，默认返回空**。
只有那些**内部本来就必须维护"输入面→输出面"映射**的算法才会 override 它：

- 布尔（`BRepAlgoAPI_BooleanOperation` / `BOPAlgo_Builder`）：必须记下哪些面被切掉、哪些被分裂成几片、哪些是交集新面——不记就做不出结果。
- 圆角 / 倒角（`BRepFilletAPI_MakeFillet` / `MakeChamfer`）：必须记下被滚过的面变成什么、过渡面是新造的。
- 壳 / 偏移 / 增厚（`BRepOffsetAPI_*`）：原面 → 偏移面。
- 变换（`BRepBuilderAPI_Transform` / `Copy`）：映射是恒等的，填 History 是琐碎的。

**历史是算法的工作记录被顺手暴露出来，不是有人为了拓扑命名去实现的。**

### 2.2 来源 B：构造语义（构造类 op）

`BRepPrimAPI_MakePrism`（拉伸）是**从零构造**：拿一个 profile，按构造规则直接造出底面、顶面、
每条边扫出的侧面。它内部**不存在任何"输入面→输出面"的映射表**——因为它不是「修改」输入，
是「拿输入当模具造新东西」。没有内部工作记录 → 没人写 override → `History()` 返回空。

但正因为它是构造性的，对应关系是**确定的、可枚举的、由构造规则支配的**：

| op | 输出面 ↔ 输入的关系 |
|---|---|
| `extrude` | 底面 = profile；顶面 = profile 沿方向平移；侧面 *i* = profile 第 *i* 条边扫掠 |
| `revolve` | 旋转面 *i* = 第 *i* 条边绕轴旋转；端盖 = profile（非整周时） |
| `linearPattern` / `circularPattern` | 第 *k* 份第 *i* 面 ← 原第 *i* 面 |
| `mirror` | 原面集合 + 镜像面集合，逐面对应 |
| `copy` / `translate` / `rotate` / `scale` | 恒等 1:1 |

**这些不需要问内核，我们自己就知道——它们是操作的定义。**

### 2.3 对称性：内核没给历史，是「该 op 属于构造类」的信号

| | 内核**有**历史的 | 内核**没**历史的 |
|---|---|---|
| 性质 | 非构造的、局部修改 | 构造性的 |
| 对应关系 | 复杂、不可预测 | 由构造规则完全确定 |
| 谁能给 | 只能问内核 | **我们自己就知道** |
| 例 | boolean / fillet / chamfer / offset / shell | extrude / revolve / sweep / loft / pattern |

**「内核没给历史」不是能力缺口，它是分类信号。**
现状把它读成「算不出来」→ 判为无名。这是**最大的一处误判**：它不在「op 忘了写」那一层，
在「我们问错了问题」那一层。

### 2.4 实测纠正：内核给了 12 个，faijs 只绑了 5 个

上一版文档写「内核**只有** 5 个带历史的 API」，**这句是错的**。实测：

- `occt-wasm@3.8.4`（`package.json` 钉死版本）在 `dist/index.d.ts:458-472` 暴露 **12 个** `*WithHistory`：
  `translate` `fuse` `cut` `fillet` `rotate` `mirror` `scale` `intersect` `chamfer` `shell` `offset` `thicken`
- faijs 的 `BrepEngineApi`（`brep/engine/primitives.ts:167-185`）只声明 **5 个**：
  `fillet` / `chamfer` / `cut` / `fuse` / `intersect`
- 运行时对象不是裁剪过的副本——`brep/engine/adapters/occt.ts:29` 直接把 `initOcctWasm()` 的返回值
  当作 `primitives` 传下去。**那 7 个在运行时就在那儿，只是类型层没声明、没人调用。**

（口径：核的是 occt-wasm 的类型表面 + faijs 绑定路径，未起 wasm 实测运行时方法存在。）

**缺的 7 个里，4 个正好是 faijs 现在用近似伪造的：**
`translate` / `rotate` / `mirror` / `scale` 现在走 `identityHashEvolution`
（`brep/face-evolution.ts:209-222`）——做法是两端 `subShapeHashes` 按枚举序号逐位对齐、取 `min(长度)`，
注释写着「刚体变换/深拷贝不改变面数量与顺序」。**这是一个从未被验证的假设**（OCCT 不承诺面序稳定）。
内核明明能给权威映射，我们却在用序号对齐猜。

另 `shell` / `offset` / `thicken` 也在，而上一版把它们列进了「内核无历史的能力缺口」。

**这不是"要动 WASM 内核"，只是加类型声明 + 复用现成的 `decodeHashEvolution`。**

---

## 3. mesh 的定位（前提，不是讨论项）

**用户裁决：mesh 处理不了拓扑，方案里根本不需要考虑 mesh 路径。**

由此写死三条，不再讨论：

1. **拓扑身份是 BREP 专有能力。** mesh 路径下 `edgeRef` / `faceRef` 显式抛 `E_TOPO_MESH_UNSUPPORTED`
   （符合 AGENTS.md 的「静态规则、禁运行时回退」红线：不支持就暴露）。
2. **删除伪拓扑**。现有 `assignPrimitiveFaceRoles`（`topology/naming/build-naming.ts:90-106`）是
   「尝试一个近似拓扑，但实际上没法用」：只覆盖基本体、不跨 op 传播、不抗参数变化。
   它与 `topology/naming/roles.ts:68` 的 `ROLE_ASSIGNERS` 是同一份词汇表的第二次手抄。一并删除。
3. **删除 `role:''` 静默兜底**（`build-naming.ts:127/134`）。BREP 链上解析不出身份就是错误，
   不是空字符串。

---

## 4. 目标（可验收）

不是「做个机制」，是这六条。每条都有可复跑、可失败的判据。

| # | 目标 | 验收判据 |
|---|---|---|
| **G1 完备** | BREP 链上任何产物的每个面都有身份；无身份的面必须有可枚举、可归因的原因 | 覆盖率测试：跑 N 条真实链，输出每条产物「未命名面数」。目标 0；非 0 必须指向具体语句 + op |
| **G2 可归因** | 任何引用失败，报错指向「哪条语句的哪个 op、声明了什么类别、为什么没有」 | `no role table (nameless shape)` 这种**不指向任何东西**的报错全仓归零，绊线测试钉住 |
| **G3 抗重放** | 改参数重跑，引用解析到「同一个」面 | **至少 5 条链**，且每条都必须是**难的**（extrude 造面 / fillet 过渡面 / split 分片 / pattern 第 k 份 / boolean 新面），**不得使用任何 `@deprecated` op**；判据不是「解析成功」，是「解析结果与首次捕获语义等价」 |
| **G4 声明成本** | 新增 op 让产物有身份，动作 = 写一个类别标签，不是写 27 行管道；忘了写在**编译期 / 生成期**失败 | 刻意新增一个漏声明的 op → 生成 / 编译必须失败（防回归测试） |
| **G5 一致** | compat 面与 cad 面同名 op（`fillet` / `cut` / `split` / `mirror` / …）身份能力一致 | 同一份审计测试枚举两个命名空间，逐 name 比对声明存在性 |
| **G6 无静默降级** | 删掉一切「解析不了就猜」 | ① `roleOfOrdinal` 按 hash 反查，碰撞即歧义 → 报错；② `role:''` 兜底删除；③ 几何 hint 兜底保留，但**必须唯一胜出**，否则报错（复用 `resolve-face.ts:123` 的 `AMBIGUITY_THRESHOLD` 逻辑并覆盖全部路径） |

> **G3 是核心。** 若方案做完 G1/G2/G4/G5/G6 全绿而 G3 仍只有一条 `box→translate`，
> 等于没做——因为它没有证明机制能干它唯一该干的那件事。

**G3 的现状（必须先说清楚的坏消息）**：全仓只有一条抗重放测试
（`packages/tests/faijs/topology-naming/topology-naming.test.ts:64`，`box→translate`），
而它是最弱的一条：`box` 是 `ROLE_ASSIGNERS` 里唯一真正有语义命名器的；`translate` 是 1:1 恒等、
零面增删；断言只有 `resolved.ordinal > 0` 与 `hint.normal == [0,0,1]`。
**更糟**：`cad.translate` 在 `api/transform.ts:116` 标着 `@deprecated`
（「`../3d_editor` 特有，不属于 faijs 平台面，将来会删除」）。

> **这套机制唯一被验证过的抗重放链路，跑在一个预定要删掉的 op 上。**
> 现在没有人知道这套机制到底能不能用。Phase 0 的第一件事就是把它变成已知。

---

## 5. 设计

### 5.1 身份形态：`(StmtId, role)`

```ts
interface FaceIdentity {
  origin: StmtId      // 权威：产生这个面的那条语句（全局唯一）
  role: RoleName      // 那条语句把它当作什么 —— 结构化、封闭，见 §5.1.1
  display?: PartName  // 仅显示用，不参与身份判定
}
```

相对现状的两处修正：

- **origin 从 PartName 改为 StmtId**。现状 origin 有两种选法（`primitives` 用语句 LHS、
  `import_brep` 用资产名，`import-brep.ts:77`），后者导致**同一资产导入两次共用 origin**、
  两个不同实体的第 k 个面算出完全相同的 ref。StmtId 天然唯一，且与变量重命名解耦。
- **`role` 不再混两个命名空间**。现状 `assignRoles(kernel, solid, opType)` 里 `opType` 一身二职
  （`roles.ts:92` 查词汇表 + `roles.ts:105` 拼位置名前缀），而 origin 又是语句 LHS，
  于是名字里混进 `part14` 与 `extrude:face_3` 两个来源（上一版记为 C6）。

#### 5.1.1 role 的契约：语句局部名，不是任意字符串

**定义**：`role` 是**一条语句对自己产出的每个面起的局部名**。作用域就是那一条语句；全局唯一性由
`(origin, role)` 二元组提供，**不要求 role 全局唯一**。类比：函数内的局部变量名。

因此 `role` 不能是任意字符串，它受四条约束：

| # | 约束 | 失效后果 |
|---|---|---|
| **R1 局部唯一** | 同一语句内，一个 role 只能指一个面 | 引用歧义 |
| **R2 封闭可枚举** | 取值域由产生它的 op **声明**，是有限集合 | role 要写进 `.fai.js`（`TopoRef` 是 JSON 安全的），不可枚举 = 魔法串 = 无法补全、无法校验、无法审计覆盖率 |
| **R3 抗参数变化** | 改参数重放，同一个面的 role 不变 | 整个机制失效——这是名字存在的唯一理由 |
| **R4 结构化可分解** | role 可构造、可拆解、可比较 | `pattern` 的第 k 份、`split` 的第 j 片无法表达，复合身份只能靠字符串拼接 |

**现状违反情况**（`role: string`，`naming/types.ts:67` 无任何约束）：

- `roles.ts:105` 的位置兜底 `` `${opType}:face_${index}` `` 违反 **R3**——`index` 是 OCCT 枚举序号，
  OCCT 不承诺面序稳定，改参即漂。真正抗重放的只有语义角色（`box:top` 等），
  这也解释了为什么 G3 唯一那条测试能过：它测的是语义角色，不是位置名。
- `box:top` 里的 `box:` 前缀违反 **R1 的精神**——它把本属 `origin` 的来源信息塞进了 role，
  因为现状 origin 选的是 part 变量名/资产名，不可靠。origin 改 StmtId 后该前缀应删除。
- 扁平串违反 **R4**：`pattern` / `split` 的复合身份现在无处安放。

**目标形态**：内部结构化为带 kind 的联合，序列化为规范串（可逆解析）：

```ts
type RoleName =
  | { kind: 'semantic'; name: string }                 // 'top' 'bottom' 'lateral' …（op 词汇表封闭）
  | { kind: 'wall';     index: number }                // 构造性索引：profile 第 i 条边扫出的面
  | { kind: 'replica';  k: number; inner: RoleName }   // pattern 第 k 份
  | { kind: 'splinter'; inner: RoleName; index: number } // split 第 j 片
  | { kind: 'generated'; op: string; index: number }   // fillet/chamfer 过渡面（新造面）
```

序列化（进 `.fai.js`）：`top` / `wall:3` / `replica[2]/wall:3` / `splinter(top)#1` / `gen:fillet:0`。

各 op 的词汇表（封闭、由 op 声明）：

| op | role 词汇 | 来源 |
|---|---|---|
| `box` | `top/bottom/left/right/front/back` | 法向判定，**构造时一次性固化** |
| `cylinder` / `cone` | `lateral/top/bottom`；`sphere`: `surface` | 同上 |
| `extrude` | `bottom`（=profile）/ `top` / `wall:<i>`，i ∈ profile 边序 | 构造语义（来源 B） |
| `revolve` | `wall:<i>` / `cap:start` / `cap:end` | 构造语义 |
| `fillet` / `chamfer` | 继承面沿用原 role；过渡面 `gen:<op>:<i>` | 内核历史 + 新造面记账 |
| `pattern` / `mirror` | `replica[<k>]/<原 role>` | 复制语义 |
| `split` / `section` | `splinter(<原 role>)#<j>` | 分片语义 |

**R3 的关键澄清：几何判定 ≠ 不稳定。** `box:top` 是用法向判定的，但判定**发生在链根构造的那一瞬间**，
结果固化成 role；只要这个 box 还是 box，`top` 就永远是 `top`。真正的红线不是"不许用几何判定"，
而是：**判定必须唯一胜出，歧义即报错**（对称情形、阈值边界）。这与 G6 是同一条。

**role 是公开契约，不是内部实现细节。** 一旦 `TopoRef` 被写进 `.fai.js`（现状 `cad.edgeRef(part, N)`
还只收序号，但目标是身份化引用），**改一个 op 的 role 词汇就是 breaking change**——会破坏存量脚本。
因此：词汇表必须随 op 声明一起进生成产物（API 手册 / `.d.ts`），且变更需版本化。
这也是 G4「声明成本 = 写一个类别标签」之外，op 作者对 role 词汇的第二项责任。

### 5.2 血缘图：执行期构建，不出 IR

「沿链回走」需要知道「part3 是由哪些 part 经哪条语句来的」。两处现有设施已经够了：

- **`brepChainState.solidCache: Map<PartName, BrepHandle>`**（`brep/brep-chain.ts:76`）——
  所有具名 part 的 OCCT 句柄在 runtime 实例级持久存活。**沿链回走不需要重跑几何。**
- **`nameOf(shape): PartName | undefined`**（`runtime-state.ts:400`）——
  由 Shape 反查变量名。因此 `defineOp` 包装器在执行时就能拿到输入的 PartName，
  **不需要改 IR**（`ExecutionAnchor` 只有 `id/outputs/callee`，没有 `inputs`，但运行时不需要它）。

于是在 `defineOp` 的包装器里登记一个节点——这是**唯一同时持有 args / inputs / stmt / 返回值**的位置
（`define-op.ts:274-281`，`inputs` 已在 :274 现成算出）：

```ts
interface LineageNode {
  stmt: StmtId
  op: string
  inputs: PartName[]        // inputs.map(nameOf)
  outputs: PartName[]
  kind: ProvenanceKind      // op 声明的类别（§5.3）
  evolution?: HashEvolution // kind='kernel' 时执行期记录
}
```

> 上一版把登记口放在 `shape.ts:fromBrep` 是错的：那里只有输出句柄，
> 拿不到 inputs 与输入 roleTable，`derived` 做不到，只剩 `root`。

### 5.3 类别声明：封闭集合

op 只需声明**一类**，框架实现该类。集合封闭：

| kind | 语义 | op 需写的 | 覆盖 |
|---|---|---|---|
| `kernel` | 内核给历史 | 调用内核 `XxxWithHistory` 变体 | boolean / fillet / chamfer / shell / offset / 变换（绑定补齐后） |
| `identity` | 1:1，第 i 面 → 第 i 面 | **零** | copy / translate / rotate / scale（绑定补齐后改走 kernel） |
| `replicate(k)` | 第 k 份第 i 面 ← 第 i 面 | 份数 k | linearPattern / circularPattern / gridPattern / mirror(k=2) |
| `construct(enumerator)` | 输出面 ↔ 输入的构造规则 | 一个枚举器 | extrude / revolve / sweep / loft |
| `subdivide` | 每输入面 → 若干片 | **零** | split / section |
| `opaque(reason)` | 显式记账：算不出来 | 理由字符串 | 应趋近于 0 |

- `identity` / `replicate` / `subdivide` **零 op 代码**，覆盖多数。
- `construct` 需要枚举器，但这类 op **只有 extrude / revolve / sweep / loft 几个**——
  因为那本来就是它们的构造定义，不是额外负担（§2.2）。
- **`opaque` 不是逃生舱**，是「有名有姓的缺口」，会被审计测试列成清单（§6 Phase 4）。

#### 5.3.1 声明载荷：kind 已蕴含「继承面」，op 只需再交「新造面词汇」

一个 op 的命名职责是两件事：

1. **继承面的处置** —— 由 `kind` 完全决定（`identity` 全留 / `kernel` 按历史 /
   `subdivide` 分裂 / `replicate` 复制 / `construct` 抛弃）。**不需要 op 写任何东西。**
2. **新造面的词汇** —— 只有 `construct` 与 `kernel` **会造新面**，才有这一项。

于是声明的实际载荷比看起来小得多：

- `identity` / `subdivide` / `replicate(k)`：**零声明**（不造新面；`replicate` 的每份是副本，
  role 由框架按 `replica[k]/<inner>` 生成）。
- `construct`：**必须给词汇表**（这就是它的构造定义）。
- `kernel`：**新造面的指认方式**，二选一：
  - `byAdjacency` —— 新面用「它桥接的两个继承面」指认（`fillet`/`chamfer` 的过渡面**已经这么做了**，
    见 `DerivedFaceTopoRef.between`，`naming/types.ts:98-103`）。这类 op 只需写 `byAdjacency`。
  - `explicit(词表)` —— op 自带新面词表。
  - ⚠️ **不能依赖内核的 `generated`**：实测它恒空（`face-evolution.ts:140` 注释「0 存活」），
    所以 `kernel` 类的 `byAdjacency`/`explicit` 是**必填**，不是可选优化。

统一的新造面词汇口径（三个前缀，封闭）：

```
cap:<name>      端面 / 盖面      cap:top  cap:bottom  cap:start  cap:end
wall:<i>        由第 i 条边扫出/旋出的侧面（i = 输入 profile 的边序）
hole:<j>[/…]    第 j 个内环（profile 带孔时）下的同名子结构
```

`wall:<i>` 的稳定性是**递归的**：它稳定 ⇔ profile 的边序稳定 ⇔ profile 的来源 op 的词汇稳定。
所以 G3 的链必须覆盖「profile 本身也是构造产物」的情形（`sketch → extrude → fillet` 正属此类）。

#### 5.3.2 逐条声明表

**「42」的口径先钉死**（§7.1 同此口径）：42 = `arg-spec.ts` 里 `kind: 'brep-op'` 的条目数，
**不是** `generated/*.ts` 的 `export const` 数（两者恰好都是 42，纯属巧合，极易混淆）。
按**生效层**四分，合计数必须自洽：

| 生效层 | 条数 | 名单 |
|---|---|---|
| **投影**（`scriptFace: true`，进 cad 面 + 符号表） | **27** | `script-face-manifest.ts` 30 条 − 3 条 view 类（非产形） |
| **投影**（单独接线，不在 manifest） | **1** | `revolve`（`api-namespace.ts:48`） |
| **手写覆盖**（同名，手写优先，生成版不生效） | **6** | `box` `cylinder` `cone` `scale` `fillet` `extrude` |
| **未接线**（生成版是死代码） | **8** | `sweep` `complexExtrude` `twistExtrude` `roof` `thread` `section` `shell` `fixSelfIntersection` |
| | **42** | 27 + 1 + 6 + 8 |

> **未接线的 8 条在 cad 面与 mesh 面都没有同名实现**（`grep` 确认），即能力真的缺失，
> 不是「别名不同」。唯一的名称干扰是 `thread`：另有一处**同名不同物**的
> `brepjsCompat.thread`（`api/index.ts:104`，来自 `api/brep-mirror/threadFns.ts` 的库作者面
> brepjs 形态函数），它既不是 cad op、也不走 `arg-spec`。命名声明表必须区分
> 「cad 面 op」与「库作者面函数」，否则会重演「一个名字两份实现」这类混淆。
>
> **对 G4 的意义**：`naming` 必填只加在**生效的那一层**——6 条手写覆盖声明在 `defineOp` 里，
> 27+1 条投影声明在 `arg-spec` 里。8 条未接线的不该要求声明，而应从 `brep-op`
> **改标 `skip`（reason: 未接线）**，否则就是给死代码加负担、且掩盖「能力缺失」这个真实状态
> （属待拍板项，见 §8）。

**表 B1｜生成投射层（42 条 `brep-op`）**

| op | kind | 新造面词汇 | 生效层 |
|---|---|---|---|
| `torus` | `construct` | `surface`（单闭合面） | 投影 |
| `ellipsoid` | `construct` | `surface` | 投影 |
| `makeBaseBox` | `construct` | `cap:top` `cap:bottom` + `wall:{left,right,front,back}` | 投影 |
| `box` | `construct` | 同 `makeBaseBox` | 手写覆盖（`primitives.ts:138`） |
| `cylinder` | `construct` | `wall:lateral` + `cap:top` `cap:bottom` | 手写覆盖（`primitives.ts:227`） |
| `cone` | `construct` | `wall:lateral` + `cap:top` `cap:bottom` | 手写覆盖（`primitives.ts:266`） |
| `extrude` | `construct` | `cap:bottom` `cap:top` + `wall:<i>`（+ `hole:<j>/…`） | 手写覆盖（`extrude.ts:356`） |
| `revolve` | `construct` | `wall:<i>` + `cap:{start,end}`（不足 360° 时） | 投影（`api-namespace.ts:48` 单接线） |
| `sweep` | `construct` | `wall:<i>` + `cap:{start,end}` | **未接线** |
| `complexExtrude` | `construct` | 同 `extrude` | **未接线** |
| `twistExtrude` | `construct` | 同 `extrude` | **未接线** |
| `roof` | `construct` | `cap:<平面序号>` + `wall:<i>` | **未接线** |
| `thread` | `construct` | `shank` + `helix` | **未接线**（待探针定稿） |
| `linearPattern` | `replicate(k)` | — （`replica[k]/<inner>` 由框架生成） | 投影 |
| `circularPattern` | `replicate(k)` | — | 投影 |
| `gridPattern` | `replicate(k)` | — | 投影 |
| `rectangularPattern` | `replicate(k)` | — | 投影 |
| `mirrorJoin` | `replicate(2)` | — | 投影 |
| `drill` | `kernel`（组合布尔） | `byAdjacency`（孔壁由上下缘面桥接） | 投影 |
| `pocket` | `kernel`（组合布尔） | `byAdjacency` | 投影 |
| `boss` | `kernel`（组合布尔） | `byAdjacency` | 投影 |
| `fuse` | `kernel` | `byAdjacency` | 投影 |
| `cut` | `kernel` | `byAdjacency` | 投影 |
| `split` | `subdivide` | — | 投影 |
| `section` | `subdivide` / `opaque` | —（产 face/shell 非实体，待探针） | **未接线** |
| `fillet` | `kernel` + `byAdjacency` | 过渡面 `gen:fillet(<A>,<B>)` | 手写覆盖（`fillet.ts:142`） |
| `shell` | `kernel` | `inner(<原 role>)` | **未接线** |
| `offset` | `kernel` | `offset(<原 role>)` | 投影 |
| `rotate` | `kernel`（绑定补齐后） | — | 投影 |
| `scale` | `kernel`（绑定补齐后） | — | 手写覆盖（`transform.ts:189`，`@deprecated`） |
| `mirror` | `kernel`（绑定补齐后） | — | 投影 |
| `clone` | `identity` | — | 投影 |
| `applyMatrix` | `identity` | — | 投影 |
| `transformCopy` | `identity` | — | 投影 |
| `locate` | `identity` | — | 投影 |
| `heal` | `opaque`（待探针：内核无历史且面数可变） | — | 投影 |
| `simplify` | `opaque`（同上） | — | 投影 |
| `autoHeal` | `opaque`（同上） | — | 投影 |
| `fixShape` | `opaque`（同上） | — | 投影 |
| `healSolid` | `opaque`（同上） | — | 投影 |
| `fixSelfIntersection` | `opaque`（同上） | — | **未接线** |
| `convexHull` | `opaque`（面数随输入点集，无稳定词汇） | — | 投影 |

**表 B2｜手写层（`defineOp` / 平台 op）**

| op | 定义处 | kind | 新造面词汇 |
|---|---|---|---|
| `sphere` | `primitives.ts:179` | `construct` | `surface` |
| `wedge` | `primitives.ts:306` | `construct` | `cap:*` ×5 + `wall:*`（同 box 变体） |
| `box`/`cylinder`/`cone` | `primitives.ts:138/227/266` | `construct` | 见表 B1 |
| `sketch` | `sketch.ts:193` | `construct`（链根，产 face） | 面的边序 = profile 边序（**新造面的词汇根**） |
| `text` | `text.ts:100` | `construct`（链根） | `glyph:<j>` 等（待定稿） |
| `screw` | `screw.ts:165` | `construct`（链根） | `shank` + `thread`（待定稿） |
| `svgExtrude` | `svgExtrude.ts:61` | `construct` | 同 `extrude`（`cap:*` + `wall:<i>`） |
| `union` | `boolean.ts:113` | `kernel` | `byAdjacency` |
| `subtract` | `boolean.ts:138` | `kernel` | `byAdjacency` |
| `intersect` | `boolean.ts:162` | `kernel` | `byAdjacency` |
| `chamfer` | `chamfer.ts:268` | `kernel` + `byAdjacency` | 过渡面 `gen:chamfer(<A>,<B>)` |
| `fillet` | `fillet.ts:142` | `kernel` + `byAdjacency` | 过渡面 `gen:fillet(<A>,<B>)` |
| `engrave` | `engrave.ts:197` | `kernel`（若内核有）否则 `opaque` | 待探针 |
| `fai_drill` | `fai_drill.ts:247` | `kernel`（组合布尔） | `byAdjacency`（`@deprecated`） |
| `fai_extrude` | `fai_extrude.ts:67` | `construct` | 同 `extrude`（`@deprecated`） |
| `fai_split` | `fai_split.ts:266` | `subdivide` | —（`@deprecated`） |
| `import_brep` | `import-brep.ts` | `construct`（**链根**） | `imported:<i>`（i = 导入面序） |
| `compound`（几何） | `compound-geom.ts` | **不产形** | 成员各自 origin；本 op 不建新身份 |
| `group`/`assembly` | `compound.ts` | **不产形** | 同上（`@deprecated`） |
| `copy` | `copy.ts:72` | `identity` | —（`@deprecated`） |
| `place` | `place.ts:105` | `identity`（刚体，面序不变） | — |
| `translate`/`rotate_euler`/`scale3d` | `transform.ts:123/156/225` | `identity` 或 `kernel`（同 `rotate`，待 Phase 0 裁定） | —（`@deprecated`） |
| `sdf` / `knurl` | `sdf.ts:38` / `knurl.ts:44` | **mesh-only** | 不参与（§3） |

**表 B3｜非产形 op**（列此仅为封闭性，不要求任何命名声明）：
`faceNormal` / `bboxCenter` / `bboxMin` / `bboxMax`（查询）、`edgeRef` / `faceRef`（引用）、
`asset`（资产）、`jointTrajectory` / `inverseKinematics` / `mechanismDOF`（装配求解）、
`load`（编辑器 op，第 8 个 `@deprecated`）、`viewCamera` / `projectView` / `projectSheet`（投影视图）。

#### 5.3.3 G4 的钉死机制：漏声明 = 生成期/编译期失败

两个入口，都必须**硬失败**，不得有默认值：

1. **生成投射层**：`ArgSpecEntry` 增 `naming` 字段（`arg-spec.ts`）。
   `gen-l3-surface.ts` 产出时，若 `kind === 'brep-op'` 且 `scriptFace === true` 而 `naming` 缺失
   → **`throw`**（不是 `warn`、不是填默认）。这天然排除了 3 条 view 类（它们不是 `brep-op`）。
2. **手写层**：`defineOp` 的 options 增**必填** `naming`。缺则 **TS 编译错误**。
   - ⚠️ 这是**对第三方库的 breaking change**（`fai_cq_gears` / `fai_cq_warehouse` / `sheetmetal`
     的每一处 `defineOp` 都要改）。用户解除的是 `.fai.js` 脚本兼容，**不是库源码兼容**——
     口径必须明确：要么接受 breaking 并给迁移期，要么为库提供 `naming: { kind: 'opaque', reason: ... }`
     的显式退化（**仍是显式声明，不是默认值**）。
3. **防回归测试**（G4 的判据）：刻意构造一个漏 `naming` 的 op 条目 → 生成器必须抛错；
   另构造一个漏 `naming` 的 `defineOp` → `tsc --noEmit` 必须失败。两条都留在仓库。

#### 5.3.4 表中「待探针定稿」的 6 项（不写成结论）

按 §7.4 的口径，以下**不能凭读码下结论**，由 Phase 0 覆盖率探针给出实测分布后回填：

1. `heal` / `simplify` / `autoHeal` / `fixShape` / `healSolid` 是否真有内核历史（若无 → `opaque` 清单会变长）。
2. `thread` / `screw` 的面结构（`shank`+`helix` 是按直觉写的）。
3. `roof` 的平面/壁面构成。
4. `convexHull` 是否真的无稳定词汇（有可能按输入点序给出 `hull:<i>`）。
5. `engrave` 是否等价于 `cut` 的组合（若是 → 直接复用 `kernel`）。
6. 刚体变换（`place`/`translate`/`rotate_euler`/`rotate`/`mirror`/`scale`）**面序是否真的不变**——
   若 Phase 0 探针证实，可全线用 `identity`（零代码）；若不证实，必须走 `kernel`。
   现在 `identityHashEvolution`（`face-evolution.ts:209-222`）已经在**假设**它成立而无人验证。

### 5.4 查询：沿链回走，产物上的表只是缓存

```
resolve(identity, atPart):
  1. 从 identity.origin 那条语句出发，沿血缘图走到 atPart 的语句
  2. 每一步按该步的 kind 推进 hash 集合（hash 只是中间表示，不是身份）
  3. 任一步推进不了 → 精确报错：哪条语句、哪个 op、声明了什么 kind、为什么
```

产物上的 `roleTable` **降级为这条路径的缓存**：miss 就重算，**不再是错误来源**。
这一条直接消灭了「忘了建表 = 静默无名」——缓存 miss 是可恢复的，真正的错误只剩
「链上某一步声明了 `opaque`」，而那是有名有姓的。

> 上一版把这条（它的 O4「全量血缘图」）判成「要多付重放与存储成本，不是第一步」，**这个判断错了**：
> 它假设要重跑几何，实际只需在已存活的中间产物上走一遍对应关系（`solidCache` 已保证存活）。

### 5.5 失败语义

| 情形 | 行为 |
|---|---|
| 链上某步 `opaque` | 抛 `E_TOPO_OPAQUE`，带「s7 的 `cad.engrave` 声明 opaque（原因：…）」 |
| 面在途中被删除 | 抛 `E_TOPO_DELETED`（已有） |
| mesh 路径下引用拓扑 | 抛 `E_TOPO_MESH_UNSUPPORTED`（新增，§3） |
| 几何 hint 兜底不唯一 | 抛 `E_TOPO_AMBIGUOUS`（已有一条路径，需覆盖全部） |
| 未声明类别 | **编译期 / 生成期失败**，不是运行期 |

---

## 6. 落地

原则：**先把问题变可见，再改行为**；每一阶段独立可验，且都能说清「G3 又绿了几条」。

| 阶段 | 内容 | 验收 |
|---|---|---|
| **Phase 0 补能力 + 摸底** | ① 补齐 7 个已存在的 `*WithHistory` 绑定（`translate`/`rotate`/`mirror`/`scale`/`shell`/`offset`/`thicken`）；② 删掉 `identityHashEvolution`，或为其「面序稳定」假设补一条测试；③ 写 G3 的 5 条难链测试，**让它们现在红着**；④ 把 §5.3.4 的 6 项「待探针定稿」测出来并回填 §5.3.2 表 B1 | 绑定单测全绿；5 条难链的当前失败率有实测基线（这份基线就是后续每一阶段的进度尺）；§5.3.4 的 6 项只剩 `opaque`/词表两种确定结论，无「待定」 |
| **Phase 1 身份与血缘** | §5.1 + §5.1.1（`role: RoleName` 结构化）+ §5.2：origin 改 StmtId（修 `import_brep` 撞名）、`role` 去 opType 混入、血缘图登记进 `defineOp` 包装器 | G2 达成（`nameless shape` 类报错归零）；G3 的 5 条链不回退 |
| **Phase 2 类别声明** | §5.3.1 载荷定义 + §5.3.3 双入口强制：`arg-spec.ts` 加 `naming` 列（27+1 条投影）、`defineOp` 的 `naming` 必填（手写层 + 6 条同名覆盖）、8 条未接线的改标 `skip`；§5.3.2 表 B1/B2 逐条回填 | G4 达成（漏声明 → **生成期/编译期**失败，§5.3.3 的两条防回归测试）；G5 达成（两命名空间逐 name 比对） |
| **Phase 3 构造类** | `construct` 枚举器：extrude（`cap:bottom`/`cap:top`/`wall:<i>`）、revolve、sweep、roof；`kernel` 类的 `byAdjacency`（fillet/chamfer 过渡面） | G3 至少绿 2 条（extrude 造面链、fillet 过渡面链）；`registerExtrudeRoles` 整段删除 |
| **Phase 4 不变式** | 覆盖率与无陈旧断言（§4 G1），`opaque` 全部进白名单并给出理由 | G1 达成；G3 至少绿 4 条 |
| **Phase 5 清债** | §3 三条（删 `assignPrimitiveFaceRoles` / `role:''` / mesh 侧伪拓扑）；`opaque` 趋零 | G6 达成；G3 全绿 |

---

## 7. 盘点（复核结果）

### 7.1 产形入口

| 类别 | 数量 | 现状有身份 |
|---|---|---|
| 手写 `defineOp` 的 brep 路径 | 19 文件 / 21 处 `fromBrep` | **9 处**（primitives / import_brep / boolean / fillet / chamfer / copy / place / transform / extrude），12 处无 |
| 生成投影 `compatOp` | **42 条 `brep-op`**（`arg-spec.ts` 的 `kind: 'brep-op'` 条目；生效层四分见 §5.3.2） | **0，且结构上不可能**（`CompatSpec:56-59` / `BrepResult:72-75` 无字段 + 文件标「生成文件，勿手改」） |
| SDK 第三方库 | 经 `defineOp` → `wrapBrepOne` | 默认无 |

> **口径更正（两次都数错了同一个东西）**：42 的权威定义是 `arg-spec.ts` 里 `kind: 'brep-op'` 的
> **条目数**。我第一轮数是 `generated/*.ts` 的 `export const` 数（得 45，判文档错），
> 第二轮又用同一数法得 16+25+1=42，于是「纠正」回来说文档是对的——**两次都在数 `export const`，
> 从没数过 `brep-op` 条目**。两者数值恰好相等（都是 42），结论表面上没受影响，
> 但概念是错的：决定「要加多少条 `naming` 声明」的是**后者**，而且后者还带「生效层」这个
> 前者完全看不见的维度（27/1/6/8 的分解）。
> 真正的数字不是 42 这一个，是 §5.3.2 那张四分表。

**9 处「有身份」里有 3 个是 `@deprecated` 的编辑器 op**（`copy.ts:66`、`transform.ts:116/147/180/216`）。
也就是说，平台面上真正有身份的产形 op 更少。

### 7.2 无身份的 12 处（手写）

这 12 处 = 21 处 `fromBrep` − 9 处已建表。**各自的类别与 role 词汇表见 §5.3.2 表 B2**
（此处只盘点「哪几处没有身份」，不重复声明内容）。

| 文件 | 处数 | 输入形态 |
|---|---|---|
| `sketch.ts`（:174 + :178） | 2 | 新造（轮廓 → 面） |
| `text.ts` | 1 | 新造 |
| `screw.ts` | 1 | 新造 |
| `svgExtrude.ts` | 1 | 新造 |
| `engrave.ts` | 1 | `input: Shape`（吃实体改实体） |
| `fai_split.ts`（:173 + :174） | 2 | `input: Shape` |
| `fai_drill.ts` | 1 | `input: Shape` |
| `fai_extrude.ts` | 1 | `input: Shape` |
| `compound-geom.ts` | 1 | `members: Shape[]`（结构聚合，非产形） |
| `load.ts` | 1 | 资产导入（编辑器 op） |
| | **12** | |

### 7.3 删除清单

| 位置 | 内容 | 由谁吸收 |
|---|---|---|
| `api/extrude.ts:43-70` | `registerExtrudeRoles` 整段 | Phase 3 `construct` |
| `shape.ts:68` | `if (holder.roleTable)` 条件写入 | §5.4（表降级为缓存） |
| `shape.ts:79` | `BrepHolder.roleTable?: unknown` | §5.2 |
| `topology/naming/roles.ts:261-265` | `assignGeneratedPositionalRoles`（空 hash 死代码） | `construct` |
| `brep/face-evolution.ts:298` | `void outPart` | `construct` |
| `topology/naming/build-naming.ts:90-106` | `assignPrimitiveFaceRoles`（mesh 伪拓扑） | §3 删除 |
| `topology/naming/build-naming.ts:127/134` | `role: ''` 兜底 | §3 删除 |
| 各 op 的 `roleTable as ReadonlyMap<unknown, unknown>` 断言 | 约 9 个文件 | §5.2 类型化 |
| `brep/face-evolution.ts:209-222` | `identityHashEvolution`（序号对齐近似） | Phase 0 绑定真 `WithHistory` 后删除 |

### 7.4 已知未决（不写成结论）

1. `cut` 产生的孔壁在 OCCT 里通常是工具体 B 的面被 modified，按 A/B 拆流后会挂到 **B 的 origin 下的 role**。
   用户视角「被切出来的孔」挂的是刀具体名——是否可接受、以及「既非 A 也非 B」的新面到底有多少，
   需 Phase 0 的覆盖率探针给实测分布，不能凭读码下结论。
2. `generated` 面（倒角过渡面、布尔新面）实测「0 存活」（`face-evolution.ts:140` 注释），
   所以它们必须走 `construct` 枚举器，不能靠内核。

---

## 8. 待拍板

| # | 问题 | 我的倾向 |
|---|---|---|
| 1 | G3 的 5 条难链选哪 5 条 | `extrude→fillet` / `sketch→extrude→cut` / `pattern` / `split` / `boolean 新面`。但你有 FCStd 语料的实际分布，该你定 |
| 2 | `construct` 枚举器是否允许用几何判定认领自己的面（如「沿方向平移后与 profile 重合的面 = 顶面」） | 允许则声明成本低，但把几何判定引进身份链；不允许则每个 `construct` op 要写纯拓扑枚举。倾向**允许但限定为构造参数的直接推论**，不许做模糊匹配 |
| 3 | Phase 0 是否先写 G3 的 5 条测试让它们红着 | **是**。这样每阶段能说清「又绿了几条」，而不是最后才发现 Greener 但没 Green |
| 4 | `origin` 用 StmtId 后，既有 `.fai.js` 里的 `{origin:'part0'}` 字面量如何处理 | 一次性重生成（用户已解除兼容约束）。但需确认 fixtures / demo 的引用字面量能被脚本批量改写 |
| 5 | `naming` 进 `DualOpOptions` 且必填 = 对 `fai_cq_gears` / `fai_cq_warehouse` / `sheetmetal` 是 breaking | 用户解除的是 `.fai.js` 兼容，不是库源码兼容。倾向：库产物默认 `opaque` 并记账（不 breaking），平台 op 必填 |
| 6 | 本文档按 AGENTS.md 的文档分类应属 `docs/plans/`（方案设计）而非 `docs/analysis/` | 因你指名重写本文件，暂留原路径；如需迁移说一声 |
| 7 | 8 条未接线的 `brep-op`（`sweep` `complexExtrude` `twistExtrude` `roof` `thread` `section` `shell` `fixSelfIntersection`）在 `arg-spec` 里是否改标 `skip` | 倾向**改标 `skip`（reason: 未接线）**：给死代码加 `naming` 声明会掩盖「能力缺失」这个真实状态，而 `skip` 的 `reason` 字段本就是为这类登记设计的。但这是**超出命名范围的改动**（会导致 generated 分片缩小、符号表收窄），需你确认 |
| 8 | `arg-spec` 的 `naming` 列里，6 条「手写覆盖」生成版（`box` `cylinder` `cone` `scale` `fillet` `extrude`）如何标注 | 倾向与 7 同法标 `skip` + `reason: overridden by handwritten <file>`，让「同一 op 名只有一处 naming 权威」成为可机器校验的事实，而不是靠人去记 |
| 9 | §5.1.1 的 `RoleName` 结构化联合要不要**现在**就上，还是先保留 `string` 只加词表校验 | 倾向先上结构化：`replica[k]/…` 与 `splinter(…)#j` 若先用扁平串，之后改结构化就是又一次 breaking。代价是 `.fai.js` 里的字面量形态要一次定对 |
