# Agent Note: 拓扑面身份 = 因果坐标 (StmtId, RoleName)

状态：已实现

English | [中文](2026-09-22-topology-identity-coordinate.md)

领域：架构 / 拓扑命名 / 跨重放身份

## 问题

写进 `.fai.js` 的面引用，必须在模型被编辑并重跑后仍能解析到**同一个**面
（例如改圆角半径后再拾取同一个倒角面）。旧机制把身份表达成 BREP 面的
**内存指针哈希**（`face-evolution.ts`）：哈希是存活 OCCT 句柄的快照，整条
重放链都在为它付利息。

这导致的实际故障：

- 同一资产导入两次会共用一个 `origin`（资产名），于是两个**不同**实体的
  第 k 个面算出了**完全相同**的 `TopoRef`。
- 重命名 part 变量、或任何重建几何的改动都会换句柄、打断每一个已存引用——
  引用在重放后不稳定，而这正是它必须稳定的时候。
- 哈希是活着指针的快照，永远无法序列化、也无法跨会话比较。

## 决策

面身份 = **因果坐标 `(StmtId, RoleName)`**：

- `origin` = 产生该面的那条语句的 `StmtId`（`String(getCurrentStmt()?.id)`）。
  产生语句就是链根，原始体（primitive）也不例外。同一资产导入两次 = 两条
  语句 = 两个不同的 origin。
- `role` = 结构化 `RoleName`（七个封闭 kind：`semantic` / `wall` / `hole` /
  `replica` / `splinter` / `generated` / `imported`），序列化成规范、可逆的
  串：`top` / `wall:3` / `hole:1/wall:2` / `replica[2]/wall:3` /
  `splinter(top)#1` / `gen:fillet:0` / `imported:5`。
- `.fai.js` 里的线形态是字符串对 `{ origin, role }`。`display` 名（`PartName`）
  仅用于 UI，不参与身份、不参与解析。
- 身份经**角色表**传播：每个产出 BREP 几何的 op 通过
  `fromBrep(shape, { solid, roleTable })` 挂上 `RoleTable`；执行器自动把
  `slot.roleTable` 同步到 `roleTableCache`。原样幸存的面（hash 不变）与改型
  后继（1→N）继承坐标；只有真正**新造**的面才派生命名
  （`replica[k]/…`、`splinter(#j)`、`gen:fillet:i`、`cap:…`、`wall:i`）。

## 为什么否决那些看似显然的替代

- **`origin: PartName`**（旧形态）。否决：变量名会被重命名、同一资产多次
  导入会共享，既非全局唯一、也不跨重放稳定。`StmtId` 按构造唯一、且与命名
  解耦。
- **靠重放语句重新推导血缘**。否决：每次查询都重跑几何或重新推断参数绑定；
  登记式零重算、可审计。
- **每个 op 提供自定义 `(face, index, args, inputRoles) => RoleName` 函数**。
  否决：开放函数无法机器判定"你漏了哪一类"，而 G4（声明成本）要求可机检；
  六个封闭 `ProvenanceKind` 才能让生成器/编译器在漏声明时失败。
- **保留哈希作为身份**。直接否决：它是根因，不是表示选型。

## 后果

- **G3（抗重放）6/6 绿**：`g3-replay-chains.test.ts` — T0 链路守卫
  + 6 条链（extrude→fillet、extrude→cut、linearPattern、split、fai_drill、
    box→role 字面量→fillet）全通过。T1 词汇集相等现用 `Set` 语义——OCCT 面
    序跨重放不稳定，但出现的局部名**集合**稳定。
- **G1（覆盖率）未命名面数 = 0**：`phase0-coverage-baseline.test.ts` — 47/47
  面都带语义 role，0 位置名、0 空。
- **mesh 不参与**（D6）：引用 mesh 几何的面/边抛 `E_TOPO_MESH_UNSUPPORTED`；
  `assignPrimitiveFaceRoles` 与 `role:''` 兜底已删除。
- **`unmodeled` 是显式记账**，不是 TODO：凡无法给面命名的 op 必须声明
  `naming: { kind: 'unmodeled', reason }`（经 D11 对第三方库是 breaking）。
  审计：`unmodeled-whitelist.test.ts`。**⚠️ 对"裸函数库"尚不成立**——见下
  「第三方零件库」：它们经一条硬编码的 blanket `unmodeled` 默认被提升，而该默认
  被白名单排除在审计之外。
- **3d_editor 同步（H2/H3）**：改 `origin`/`role` 改变了每个已存 `TopoRef` 的
  线形态，故 `../3d_editor` 必须迁移（`migrateTopoRef`）并更新其两处断言。
  这是跨仓库项，仍未关闭。

## 血缘接线——已解决（§1.4/1.5）

计划里的 `registerStep` 血缘图（一个登记函数 + `wrapBrepOne` 与 `compatOp`
边界两个调用点，§4.3）**曾被推迟到 Phase 2.3 批次**，现在**已接线**：
`registerStep` 即 `LineageGraph.register`，运行期单例即 `runtimeLineage`。

- **接线点唯一**：落在 `define-op.wrapped`（`runtimeLineage.register`）。因
  `compatOp` 建在 `defineOp` **之上**（非并行第二路径），生成投影与手写 op
  共用这一处——`compatOp` 边界无需第二个调用点。
- **按执行清图**：`direct-executor.runCode` 起始清零，故每次全量重放
  （`execute` / `append` / `update`）自洽，N3 不会因"上轮的同名语句"误报。
- **嵌套调用**（实现内部再调 op 或自身，共享同一 `getCurrentStmt()` 锚点）
  由模块级 `registeringStmts` 守卫跳过；该标记必须**贯穿完整 await 实现期**——
  首版在 `register` 后同步删除 ⇒ 嵌套调用仍撞 N3（9 例红）。
- N1/N2/N3 现在**运行期生效**。载体：
  `packages/tests/faijs/topology-naming/lineage-wiring.test.ts`（图被填充
  + 重放幂等）。

**本次接线暴露的一处计划缺陷**：§1.3 的附加守卫 `E_TOPO_PART_REDEFINED` 误杀
**重赋值**（`part0 = cad.translate(part0, …)`），使
`api/dual-form-contract.test.ts` 回退 8 例。已**废除**：身份是
`(StmtId, RoleName)`，`PartName` 只是反查索引，故重绑同名**最后写者胜**
（且 `stmtOf` / `nodeOfPart` 本就无生产消费方）。

## 下游消费方：装配约束

计划 §1 开头那条链的终点写着「`fillet` / `cut` / `drill` / **`assembly`** 的
参数」。这条链在本仓的落点是 `core/src/api/assembly/types.ts:47`：

```
EntityRef = { part: PartName; face: FaceRef }
FaceRef   = { topoRef: FaceTopoRef } | { surfaceType, center, normal }
```

两层正交身份在此相遇，只有一层归本设计：

- `part: PartName` 是**实例身份**（选了哪个零件）——是名字不是坐标，本设计不涉及；
- `face` 是**面身份**（贴在哪个面上）——本设计产出 `topoRef`，几何快照只是兜底。

装配**解算**（约束 → 变换，`api/assembly/solve.ts`，P1 起走 brepjs solverAdapter）
与本设计正交且先于它存在；装配**引用**才是它的需求侧。⇒ 本设计最大的下游在
**本仓**，不是 `../3d_editor`。

## 第三方零件库——D11 按原文没有落脚点（§2.11）

实测；计划的两条前提均不成立：

1. `fai_cq_gears` / `fai_cq_warehouse` / `sheetmetal` 是**本仓 workspace 包**
   （根 `package.json` 的 `workspaces`），不是兄弟仓库——故 §2.11 是本仓工作；
2. 它们**零** `defineOp` / `compatOp` 调用。它们导出裸 `Result` 函数
   （如 `spur_gear()`：无几何输入、一次内核构建成 solid），经 `registerLib` 的
   `autoLift` 提升。故「每处 `defineOp` 加 `naming`」没有落脚点。

真实状态：`cad-runtime/admit-compat-lib.ts` 对**每个**裸函数硬编码

```
naming: { kind: 'unmodeled', reason: 'admitCompatLib: bare function lift, provenance not declared' }
```

——一条 blanket 默认，正是 D11 否决的那个旁路，且被
`unmodeled-whitelist.test.ts` 排除在审计外。当前**无库级/函数级 `naming` 声明
通道**（`registerLib` 只收 `autoLift?: boolean`；`admitCompatLib` 只认可裸函数的
`fn.outputs` 注解，不读 `fn.naming`）。

**声明 `unmodeled` 的后果——真实代价**：`roles.ts` 的 `ROLE_ASSIGNERS` 只覆盖
`box` / `cylinder` / `cone` / `sphere`，且位置兜底已删（Phase 1.7）⇒ 这四种之外的
op **贡献不了 role** → `role: null` → **产不出 `topoRef`**。故零件库声明
`unmodeled` 会把它的面逼到装配里的几何快照上，参数一变就数值漂移。轴类装配
（`EdgeRef.axis` / 圆柱面 axis）走纯几何量，**不受影响**——这正是「零件库不需要
拓扑」成立的确切边界。

⇒ §2.11 的次序：**① 新增声明通道 → ② 库显式声明 → ③ 才可把 blanket 默认改硬
失败。** 跳过 ① 直接做 ③ 会即刻打断三库装载。
