# 2026-09-23 方案：废除第三方库命名声明（库作者零负担，声明只属于 op）

状态：方案（未实施）
日期：2026-09-23

## 1. 用户原话（最高优先级，一字不改）

1. 「给我改掉这个设计。库作者不需要申明这个东西」
2. 「第一，你的例子都是简单的op，不是库。库产生零件。第二，unmodeled到底什么意思，能否用于拓扑。前面那一堆Provenance又有何意义？」
3. 「可是如果要求写，必然都是什么unmodeled，有何意义？」
4. 「unmodeled又到底是个什么东西？」
5. 「这两层都很可疑：package.json faijs.naming/namingFor。 一个库，几何实体和零件各种各样，怎么可能申明这种垃圾。哪个所谓的申明，明显只适合op」

## 2. 背景与现状

### 2.1 现状行为（faijs 0.14.1，Phase 2.11-①/②/③）

`registerLib` 接纳第三方库时，裸函数必须获得命名声明，三层通道：

```
fn.naming（函数级，Phase 2.11-①）
  → options.naming（库级，registerLib 选项，②）
  → namingFor（宿主回调：按包名读 package.json 的 faijs.naming，②）
  → 都没有 → throw 硬失败（③，D11 裁决废除 blanket 默认）
```

- `packages/core/src/cad-runtime/admit-compat-lib.ts`：硬失败分支（本次问题的直接代码）；
- `packages/core/src/node-host/cli.ts`：`readLibNaming(pkg)` + `cliPortsLibLoader.options.namingFor`（CLI 范本）；
- `packages/core/src/cad-runtime/browser-lib-loader.ts`：`namingFor` + `prefetchMeta()`（抓 CDN 上包 package.json 的 `faijs.autoLift/naming`）；
- 三个第三方库 package.json 已写入 `"faijs": { "naming": { "kind": "unmodeled", "reason": "..." } }`（2.11-② 落地产物）。

### 2.2 用户批评的两层问题（本方案的核心依据）

1. **粒度错配**：库级声明（package.json `faijs.naming`）与 namingFor（按包名读一个声明）都隐含假设「一个库 = 一种几何规律」。**实际一个库是函数集合**：`spurGear` 产出齿轮、`flange` 产出法兰、`washer` 产出垫圈——几何实体和零件各种各样，面命名规律互不相同。**一个包级声明无法表达**，写了也是垃圾。
2. **声明只适合 op，不适合库**：op 是单一语句、单一几何规律（box 有 6 面固定角色、extrude 有顶面/侧面），所以 op 级命名（defineOp 的 `DUAL_OP_META.naming` / roleTable）合理且必要；**库是黑盒零件生产者，其函数级/库级命名声明没有信息量**（写不出来精确类别，写了也是 unmodeled）。

## 3. 目标

**库作者零负担：第三方库被引擎接纳并执行，不需要任何命名声明。**

- 裸函数无条件接纳为 compatOp，命名一律按默认 `unmodeled`（面引用走几何快照兜底），**不抛错、不读取任何库侧声明**；
- **删除库侧命名声明整条通道**（fn.naming / options.naming / namingFor / package.json faijs.naming 读取）；
- **声明只保留在 op 级**（defineOp 的 naming、内建 op 的 roleTable）——那是声明唯一合适的位置；
- 不静默掩盖：默认 unmodeled 有来源标记可审计，但不输出 stderr（CI stderr 零容忍）。

## 4. 设计

### 4.1 核心行为变更（admit-compat-lib.ts）

```
旧：裸函数 → fn.naming → options.naming → namingFor → 都没有 → throw
新：裸函数 → 一律接纳为 compatOp，naming 固定默认 unmodeled（reason 带 default: 前缀）
```

- 删除硬失败 throw 分支；
- 删除 `fn.naming` 读取（NamingCarrier）；
- 删除 `LibNamingOptions.naming`（options 参数可整体退化为无参或仅保留未来需要的字段）；
- compatOp 包装时 naming 直接写死默认 `{ kind: 'unmodeled', reason: 'default: bare function lift (library function), no op-level naming applies' }`。

### 4.2 删除的库侧通道（连带清理）

| 位置 | 删除内容 |
|---|---|
| `admit-compat-lib.ts` | fn.naming 读取、LibNamingOptions.naming、硬失败 |
| `runtime.ts`（registerLib 调用处） | `naming: libLoader.options?.namingFor?.(resolved)` 传参 |
| `node-host/cli.ts` | `readLibNaming(pkg)`、`cliPortsLibLoader.options.namingFor` |
| `browser-lib-loader.ts` | `namingFor` 回调、prefetchMeta 中抓取 naming 的部分（autoLift 部分保留） |
| 库 package.json（三库） | `faijs.naming` 字段（顺带清理，单一真源） |

### 4.3 保留的机制（不动）

- **op 级命名**：defineOp 的 `DUAL_OP_META.naming`、内建 op 的 roleTable、拓扑身份系统（origin/role、FaceRef、几何快照兜底）——声明唯一合法位置，全部保留；
- 六类 Provenance 枚举 + op 链血缘规则（lineage.ts）——保留，服务于内建 op 链；
- `unmodeled` 语义（身份链断掉、引用降级几何匹配）——不变；
- `fn.outputs`（多输出名声明）：**与本方案无关**，维持现状，不在本方案改动范围；
- `faijs.autoLift` 声明（是否翻译成 op 的执行语义，非命名）——保留。

### 4.4 明确不做的事

- 不为库发明任何精确命名（做不到，也不该做）；
- 不保留"可选增强式"的库侧命名通道（用户已定性为垃圾；库若真能精确声明，正路是升级为 defineOp——那才是 op，不是库函数）；
- 不输出 stderr 警告（CI stderr 零容忍）。

## 5. 影响面

| 位置 | 改动 |
|---|---|
| `packages/core/src/cad-runtime/admit-compat-lib.ts` | 删硬失败 + 删声明读取，naming 固定默认 unmodeled |
| `packages/core/src/cad-runtime/admit-compat-lib.test.ts` | 「无声明 toThrow」改「无声明默认接纳」；删声明优先级用例（fn.naming>options.naming）；新增默认 reason 断言 |
| `packages/core/src/cad-runtime/runtime.ts` | 删 namingFor 传参 |
| `packages/core/src/node-host/cli.ts` | 删 readLibNaming / namingFor |
| `packages/core/src/cad-runtime/browser-lib-loader.ts` | 删 namingFor、prefetchMeta 的 naming 部分 |
| 三库 package.json | 删 `faijs.naming` 字段 |
| `docs/api-contract.md` §7.7–7.8 | 同步新行为 |
| `docs/library-dev-guide.md` | 删"必须声明命名"章节，改为"库函数自动默认 unmodeled，无需声明" |
| 拓扑身份计划（2026-09-22） | 标注 Phase 2.11-①/②/③ 已被本方案废除 |
| Agent Note | 实施时补一条 |
| 3d_editor `c4-brepjs-gear.test.ts` | 无需改夹具（默认接纳，测试恢复通过） |
| 3d_editor `node-lib-loader.ts` / 浏览器 loader | 无需补 namingFor |

## 6. 测试计划

faijs 侧：
1. 更新 `admit-compat-lib.test.ts`：无声明裸函数 → 接纳且 naming = 默认 unmodeled（断言 reason 前缀 `default:`）；已带 DUAL_OP_META 的原生 op 透传不变；非函数透传不变；
2. 跑 core 相关测试文件（`npm run test -w @faicad/faijs`）；
3. 全量单测确认无回归（CLI / browser-lib-loader 删改后相关测试同步更新）。

3d_editor 侧：
4. `c4-brepjs-gear.test.ts` 重跑，预期 2 个失败用例恢复通过。

## 7. 版本与发布

- 0.14.1 **尚未发布**（tarball 已打未发）。本修订属发布前设计修订，**版本号保持 0.14.1 不变**；
- faijs 改完测试通过后**重打 5 个包 tarball**（core/cq-compat/fai_cq_gears/fai_cq_warehouse/sheetmetal），其中三库 package.json 的 `faijs.naming` 顺带清除；
- 3d_editor 重装 faijs 0.14.1 tgz 验证（c4 恢复通过 + 全量单测）；
- 真实 npm 发布由用户/CI 执行（铁律：只写代码跑通，不做推送/发布）。

## 8. 实施决策（无待用户拍板项）

- `fn.outputs`：与本方案无关，维持现状，不改动；
- 三库 package.json 的 `faijs.naming`：随 tarball 重打一并清理（单一真源）；
- 默认 unmodeled 的审计口径：不计入「显式 unmodeled 应趋近于 0」统计，以 reason 前缀 `default:` 区分。
