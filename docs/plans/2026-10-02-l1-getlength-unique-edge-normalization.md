# L1 `getLength` 归一化为「唯一 edge 弧长之和」

> 状态：**方案已定，待实施**（基于本仓当前源码 + 两引擎实测探针，日期 2026-10-02）。
> 范围：`packages/core`（occt 适配器、brepkit 适配器、measurement op、能力表元数据、回归测试）、`packages/faijs-cadquery`（`lengthOf` 归一化 + JSDoc）。
> 说明：本文是 faijs 仓库内部实施记录；以当前源码与实测为准，不引用任何历史 plan 作为现状依据。

---

## 1. 问题

同一个 L1 方法 `getLength(shape)`，两个引擎对**实体**给出两个互不相等、且都不表示「实体总长」的数：

| 形态（盒 20×10×5） | occt 现状 | brepkit 现状 |
|---|---|---|
| solid | **280** | **20** |
| compound（2 盒） | **304** | **20** |
| wire（2 边） | 15 | **20** |
| face | 30 | 20 |

三条具体缺陷：

1. **occt 语义漂移**：`getLength` 裸透传 `BRepGProp::LinearProperties`（默认 `SkipShared=false`），按**面**遍历、把共享边计两次 ⇒ 实体得到的是 **Σ 面周长**，不是弧长（盒 280 = 2×140；compound 304 = 2×152）。
2. **brepkit 值不稳定**：适配器 `try { getEdgeCurveType } catch { wireLength }` 的判别对 solid / face / wire **都命中第一支**（`getEdgeCurveType` 不抛错），返回「首条边」长度 ⇒ 值随构建历史漂移（盒 20；另一盒 10；wire 应为 15 却给 20）。
3. **两处 JSDoc 与事实相反**：
   - `packages/core/src/api/measurement/index.ts:87` 宣称「两引擎同口径」——实测两引擎给 280 与 20（**不同口径**）；
   - `packages/faijs-cadquery/src/shape-class.ts:483` 宣称「`Shape.Length()` … for a wire/solid the sum of its edges」——但 **CadQuery 2.8.0 根本没有 `Shape.Length()` / `Solid.Length()`**。

---

## 2. 取证（实测，可复现）

### 2.1 三方语义对照

| 形态 | CadQuery 2.8.0 | faijs L1 契约参考（brepkit 原生名） | OCC 原生 |
|---|---|---|---|
| edge | `Edge.Length()` ✅ | `edgeLength(edge)` ✅ | ✔ |
| wire | `Wire.Length()` ✅ | `wireLength(wire)` ✅ | ✔ |
| face / solid / compound | **方法不存在** | solid → 首边（不稳定）；compound → `getSubShapes(compound,'edge')` = [] | `LinearProperties` 默认按面计 |

- **CadQuery 源码**：`cadquery/occ_impl/shapes.py:2317` `def Length` 只挂在 `Mixin1D`；实测 `Shape.Length` / `Solid.Length` 均 `hasattr == false`，`box.Length()` → `AttributeError`，`Wire.Length()` → 140，`Edge.Length()` → 1。
- **CadQuery 的 12 从哪来**：`sum(e.Length() for e in solid.Edges())` —— 客户端组合，不是任何内核方法的返回值。
- **OCC 原生**：真 OCC（OCP）与 opencascade.js 1.1.1 的 `LinearProperties` **默认都给 24**（单位盒），`SkipShared=true` 才给 12。⇒ occt-wasm 的 24 是忠实复刻，**不是 occt-wasm 的 bug**。

### 2.2 两引擎与「唯一边求和」实测

`packages/core/src/brep/engine/getlength-domain.probe.test.ts`（本方案新增；输出走 stdout）：

| 形态 | occt `getLength` | brepkit `getLength` | Σ 唯一边 `curveLength`（occt / brepkit） |
|---|---|---|---|
| solid | 280 | 20 | **140 / 140** |
| face[0] | 30 | 20 | — |
| edge[0] | 5 | 20（枚举顺序不同） | — |
| wire（2 边） | 15 | 20 | — |
| compound（2 盒） | 304 | 20（`getSubShapes(compound,'edge')`=**0**） | — |

**唯一在两引擎间逐位一致的量** = 按拓扑去重后的边弧长之和（140 == 140）。目标值（归一化后）：solid 140、face 30、wire 15、compound 152（= 140 + 12）。

### 2.3 为什么 280 不是「另一种正确」

`LinearProperties` 默认口径**随拓扑维数漂移**：对 face，该面只有一层 wire，边不重复（face 30 = 该面周长）；对 solid，每条边被 2 个面共享，于是翻倍（280 = 2×140）。**一个会随维数改变含义的量，不能同时是三种形态的名字。** 相比之下「唯一 edge 弧长之和」对所有形态自洽，且与 CadQuery 的 `sum(Edges)` 逐位同值。

---

## 3. 决策

**L1 `getLength(shape)` 的语义 := 「shape 中所有唯一 edge 的弧长之和」，两个适配器都按此实现。**

- edge → 自身弧长；wire → 其边之和；face → 边界边之和；solid → 全部边之和；compound → 子实体边之和。
- 对 edge / wire 与 CadQuery 的 `Edge.Length()` / `Wire.Length()` **逐位一致**（CadQuery parity 不破）。
- 对 face / solid / compound 是 CadQuery **未定义形态**上的一处扩展，其值恰等于 CadQuery 用户手写 `sum(e.Length() for e in shape.Edges())` 的结果（故 parity 语义等价）。

### 3.1 为什么不选「收紧论域为 edge/wire，其它抛错」

这条更贴 CadQuery 的类设计（`Mixin1D.Length`），但代价是：两个适配器都要新增形态判别 + 新错误码；上层（`measurement.length`、`lengthOf`、vendored `measureLength`）全部要各自补一段组合求和；且 `getLength(solid)` 由「返回数字」变「抛错」是**破坏性**变更。而归一化路径下「两引擎一致」这个 L1 的根本要求**已经能达成**（实测 140 == 140），无需引入破坏。

### 3.2 为什么不选「保持内核原样」

那等于承认 L1 面允许「同一个方法在两个引擎上给出 280 与 20」，与 D5「核心面只进双方都有的」及 measurement op 的「两引擎同口径」承诺直接矛盾。

---

## 4. 实施

### 4.1 occt 适配器（`packages/core/src/occt-kernel/occt-primitives.ts:411`）

把裸透传改为「取唯一 edge 求和」，用 occt-wasm 的 arena 检查点回收中间句柄：

```ts
getLength: (shape) => {
  const h = asShape(shape)
  const mark = k.checkpoint()
  try {
    let total = 0
    for (const e of k.getSubShapes(h, 'edge')) total += k.getLength(e)
    return total
  } finally {
    k.releaseSince(mark)
  }
},
```

- `checkpoint()` / `releaseSince()` 是 occt-wasm 为「枚举 `getSubShapes` 句柄后批量回收」提供的机制（`occt-wasm/dist/index.d.ts:274-279, 498-511`）；本仓此前无使用先例，本方案为首次。
- `asShape` / `asHandle` 是纯类型断言（`occt-primitives.ts:37-38`），不新增句柄；`h` 在 checkpoint 之前产生，不会被回收。

### 4.2 brepkit 适配器（`packages/core/src/brepkit-kernel/brepkitKernel.ts:1318`）

对象变量名是 `api`（`:561 const api: BrepkitEngineExtras = {`），`getLength` 内可复用同对象的 `getSubShapes`：

```ts
getLength(shape: BrepHandle): number {
  let total = 0
  for (const e of api.getSubShapes(shape, 'edge')) total += api.curveLength(e)
  return total
},
```

### 4.2b brepkit 的 compound edge 枚举（必需子修复）

实测 `getSubShapes(compound, 'edge')` 在 brepkit 下返回 **[]**（`brepkitKernel.ts:1031-1037` 的 `knownCompounds` 分支只处理 `'face'` / `'solid'`），而 occt 返回全部子边（24）。若不补，归一化后 `getLength(compound)` 会从现状 20 变成 **0**（比现状更糟，且是「静默 0」）。

补法：在 `knownCompounds` 分支加 `'edge'`——对每个子句柄按其已知集合分发（面→`getFaceEdges`、wire→`getWireEdges`、edge→自身、其余→`getSolidEdges`），与 occt 的 `getSubShapes(compound,'edge')` 行为对齐。

### 4.2c faijs-cadquery `lengthOf` 归一化（必需；实施中修正）

**原判断被实测证伪。** 本方案初稿以为 `packages/faijs-cadquery` 零代码改动，实则不然：`faijs-cadquery/src/shape-class.ts:13` 直接 `import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'`，用的是**裸 occt-wasm kernel**，绕过了 L1 适配器 `occt-primitives.ts`。因此 `lengthOf(box)` 仍是 24，CadQuery parity 未修（`shape-class.test.ts:260` 的旧断言正因如此一直通过）。

修法：`lengthOf` 在 class 层做同口径归一化——`checkpoint()` → `getSubShapes(shape,'edge')` → 逐条 `curveLength` 求和 → `releaseSince(mark)`，与 core L1 的 `getLength` 同值。同步把 `shape-class.test.ts:260` 的断言 `24 → 12`，并把注释从「kernel-level gap GOTCHA」改为「已在 class 层归一化」。

（`sketch.ts:1106/1108/1609` 的 `getLength` 调用传的是 wire/edge，裸 kernel 在 1 维形态上本就正确，不改。）

### 4.3 能力表元数据（`packages/core/scripts/gen-engine-method-map.ts:176`）

现记为 `brepkit: 'wireLength'`、note「wire/edge 入参差异适配器判别」——已不准确。改为组合实现口径（对齐同表 `surfaceCenterOfMass` 的 `brepkit: null` + 「适配器组合实现」先例），随后重跑该生成器刷新 `src/api/surface/engine-method-map.json`。

### 4.4 JSDoc 修正

- `api/measurement/index.ts:87-90`：把「solid 按内核口径计边」改为「按唯一 edge 弧长求和（两引擎同口径）」。
- `faijs-cadquery/src/shape-class.ts:483-485`：删掉臆造的 `` `Shape.Length()` ``，写明「CadQuery 无 `Solid.Length()`；本函数值 = `sum(e.Length() for e in Edges())`」。

### 4.5 回归测试

- `getlength-domain.probe.test.ts` 由「仅打印」升级为「断言版」：锁定 solid / compound 在两引擎的归一值，以及 `getLength === Σ unique-edge curveLength`。
- 更新 `api/measurement/measurement-script.test.ts`：occt 段 `280 → 140`；brepkit 段由「只验有限正数」改为「断言 == 140（与 occt 一致）」。
- 复查 `profile-multi-island.test.ts:130`、`sketch-on-plane-e2e.test.ts:141`、`sketch-on-face-e2e.test.ts:110` 的输入形态，确认值不变。

### 4.6 审计文档回填

`docs/plans/2026-10-02-cadquery-port-gap-audit.md` 中把本项由「occt-wasm bug / 内核级缺口」改为「OCC 默认 `SkipShared=false` 口径 vs faijs 唯一 edge 语义的差异」，并标记为已修。

---

## 5. 验收

1. `getlength-domain.probe.test.ts` 绿：两引擎 `getLength(solid) == 140 == Σ unique-edge curveLength`，`getLength(compound) == 152`。
2. `measurement-script.test.ts` 绿（occt / brepkit 都 140）；`shape-class.test.ts` 绿（`lengthOf(unitBox) == 12`）。
3. `packages/core` 全量测试无**新增**失败；`packages/faijs-cadquery` 全量测试无新增失败。
4. `npm run typecheck` 不新增红（HEAD 既有 10 项属基线）。
5. 能力表生成器重跑后产物无额外 diff（除 note 字段）。

---

## 6. 风险与回退

- **brepkit compound 枚举补丁的影响面**：`getSubShapes(compound,'edge')` 的其它调用方行为会从「空」变为「有边」。若出现回归，回退 4.2b 并在本文 §7 记录；此时必须让 `getLength(compound)` **显式抛错**，而不是静默 0。
- **性能**：`getLength(solid)` 由 O(1) 变为 O(E) 次内核调用；该函数不在渲染热路径，可接受。

---

## 7. 明确不做

- 不给 `getLength` 增加第二参数 / 开关（能力缺口用「补实现」解决，不加旁路）。
- 不改 `api/generated/measurement.ts`（vendored 借入面）的语义——它经 `getBrepApi().getLength` 自动跟随归一化。
- 不动 `BrepEngineApi` 的方法签名与错误体系。
