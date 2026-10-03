# P3 开发计划 —— Workplane 对象栈模型（faijs-cadquery）

> 日期：2026-10-03
> 状态：**实施中** —— P3-0 / P3-1 / P3-2 / P3-3 已完成（2026-10-03，见 §6.1「批次进度」），P3-4 起待做
> 范围：`packages/faijs-cadquery`（`src/workplane.ts` 载体模型 + `src/transpile.ts` + `src/index.ts` 导出面 + `tests/ref-harness/`）
> 上游基准：CadQuery **2.8.0**（`cq.py` + `out/cache/v2.8.0/tests/`）
> 配套文档：
> - `2026-10-02-cadquery-port-gap-audit.md` §3.2 B 类 · 对象栈模型（缺口登记，本文是它的实施方案）
> - `2026-10-02-cadquery-selector-parity-plan.md` §4.8（明确把 `.all()/.end()` 划出 P0–P4 范围）
> - `2026-10-02-topology-selectors-to-core.md`（`selChain` 现状的来源）
> - `tests/README.md`（mirror 命名 / 多体用例约定 / 红线）
>
> 上游源码取证位置：`C:\Users\ylt\cadquery-env\Lib\site-packages\cadquery\cq.py`；上游测试源码已缓存于 `packages/faijs-cadquery/out/cache/v2.8.0/tests/`。

---

## 0. TL;DR

1. **P3 = 把 `Workplane` 载体从「扁平单对象」改成「对象栈」，并让选择器/布尔/几何 op 真正读写栈。** 这是唯一剩下的结构性欠账：它卡住三条线 —— 逐级收窄、kind 选择器真语义、`split/loft` 的多体解构。
2. **但必须纠正上一轮报告的两处事实错误**（见 §1）：`val()`/`vals()` **已存在**（`workplane.ts:4812/4821`），不是缺口；真正缺的是栈的**多对象承载**与 `all/first/last/item/end/size`。
3. **同时查出两处既存语义错误**（不是缺口，是错的）：`size()` 返回 bbox 尺寸而上游 `Workplane.size()` 返回**栈对象数**（`cq.py:358`）；`add()` 是**替换**而上游 `add()` 是**追加**（`cq.py:387`）。P3 必须一并修，否则新栈 API 建在错语义上。
4. **采用「双字段过渡」而非一步替换**：`objects: Shape[]` 为新栈真源，`shape: Shape | null` 降级为**派生视图**（= `objects[0] ?? null`）保留一个版本，作为 140 处源码读取点的过渡垫片。这是本计划最大的风险控制手段。
5. **上游实际使用量很小**（实测，见 §4）：`.all()` 8 处 / `.end()` 9 处 / `.item()` 7 处 / `.first()` 14 处，集中在 `test_cadquery.py` 的少数几个用例。P3 的价值**不在补这几个 API，而在让 `faces()/edges()/...` 的候选集语义正确**（§5.1）。
6. **分 5 个批次（P3-0…P3-4）**，每批独立可测、独立可停。P3-0（栈地基）与 P3-1（`size`/`add` 语义修正）**不改任何现有行为**，是纯地基。P3-2 起才动选择器，风险陡升，单独立批。
7. **不做的事**（明确划界）：不重算 `tests/coverage.json`、不碰 `analyze-coverage.py` 的实现面清单以外的仓库、不动 core、不碰 `sketch.ts` 的 `_selection`（那是 2D 草图的**另一个**栈模型，本批只在必要处对接）。

---

## 1. 事实核对：上一轮报告需要修正的地方

写方案前对上一轮报告的每条断言做了源码取证，两处不成立：

| 报告断言 | 源码事实 | 裁决 |
|---|---|---|
| 「`workplane.ts` 无 `.val()/.vals()` 方法定义」 | **错**。`workplane.ts:4812 val()` / `4821 vals()` 都已导出（`index.ts` 亦 re-export），测试里 564 处 `cq.val(...)` 在用 | 报告的「grep 无 `.all()/.end()/.val()/.vals()`」把 `val/vals` 和 `all/end` 混为一谈了。`val/vals` 已有；缺的是**多对象承载**（`vals` 现在恒返回 0 或 1 个元素，`workplane.ts:4822`） |
| 「度量榜榜首 `val`(16)/`vals`(14) 正指向 P3 对象栈」 | **半真**。榜首相符，但归因要修正：`val/vals` 已在导出面上，所谓盲区是「**真值未断言**」（`analyze-coverage.py` 的 `VERIFIED_VALUE_OPS` 不含 `val/vals`，见 `tests/ref-harness/analyze-coverage.py:223-237`），不是「API 缺失」 | P3 应承担 `val/vals` 的真值断言（§6 批次 P3-1），但**不是**因为它们缺实现 |

**另查出两处既存语义错误**（上一轮报告未提）：

| 项 | 现状 | 上游真值 | 影响 |
|---|---|---|---|
| `size()` | `workplane.ts:2027` 返回 `[dx,dy,dz]`（bbox 尺寸） | `cq.py:358` `def size(self) -> int: return len(self.objects)` —— **栈对象数** | 上游测试有 `self.assertEqual(1, result.size())`（`test_cadquery.py:167`）、`self.assertEqual(3, s.size())`（:271）等 278 处。faijs 的 `size` 语义完全对不上。**当前 faijs 版对应的是上游 `Shape.BoundingBox()` 的 `xlen/ylen/zlen`，被错安在了 `Workplane.size` 名下** |
| `add()` | `workplane.ts:709` `clone(wp, { shape })` —— **替换** | `cq.py:387` `self.objects.append(obj)`（单 obj）/ `.extend(obj)`（list 或 Workplane）—— **追加** | 上游 `s1.add(s.faces("+Y")).add(s.faces("+X"))`（`test_cadquery.py:2447`）在 faijs 会**只剩最后一张面**。这是静默错误结果，比抛错更坏 |

> 处置：`size` 与 `add` 的修正放进 **P3-1**（与栈地基同批，因为它们语义上就是栈操作）。旧行为不保留 —— 保留等于埋雷；但改名前必须按 §6.2 的口径确认零消费者。

---

## 2. 上游对象栈的完整语义（`cq.py` 取证）

这是实现的唯一真值来源。**不要凭印象写**。

### 2.1 栈本体

| 成员 | `cq.py` 行号 | 语义 |
|---|---|---|
| `objects: List[CQObject]` | — | 栈。**元素是 `Shape` 子类实例，不是裸句柄** |
| `newObject(objlist)` | 1312 | 造新 Workplane：`ns.parent = self`、`ns.objects = list(objlist)`、复制 plane、**共享 ctx**。**所有**方法返回的都是这个 |
| `parent` | — | 单亲链。`end()` 靠它 |
| `ctx` | — | 共享上下文（`pendingWires` / `tags` / `objects` 的宿主） |

### 2.2 读侧 API

| API | 行号 | 语义 | 边界 |
|---|---|---|---|
| `all()` | 346 | `[self.newObject([o]) for o in self.objects]` —— **返回 Workplane 列表**，每个只含一个对象 | 对比 `vals()` 返回 Shape 列表 |
| `size()` | 358 | `len(self.objects)` | 不是 bbox |
| `vals()` | 364 | `return self.objects` —— **直接返回内部列表本体**（不拷贝） | 读侧 |
| `val()` | 411 | `self.objects[0] if self.objects else self.plane.origin` —— **空栈返回 plane.origin（一个 Vector！）** | GOTCHA，见 §2.5 |
| `add(obj)` | 387 | list → `extend`；Workplane → `extend(obj.objects)` + `_mergeTags`；单 obj → `append`。**返回 self** | 与 faijs 现状冲突 |
| `first()` | 644 | `newObject(objects[0:1])` | 越界是 Python IndexError |
| `item(i)` | 653 | `newObject([objects[i]])` | 支持负索引 |
| `last()` | 661 | `newObject([objects[-1]])` | |
| `end(n=1)` | 669 | 沿 `parent` 上溯 n 级；无 parent 抛 `ValueError("Cannot End the chain-- no parents!")` | |
| `findSolid()` | 721 | `_findType((Solid,), searchStack, searchParents)` 回溯 parent 链；找不到抛 `ValueError` | |
| `filter/map/apply/sort` | 4460/4470/4480/4490 | 都走 `newObject` | `sort(key)` 排**栈对象**（不是 faijs 现在的 `pendingWires` 排序！见 §1） |

### 2.3 写侧：`_collectProperty` + `_selectObjects`

这是 P3 语义的**核心**（`cq.py:227` / `753`）：

```python
def _collectProperty(self, propName):        # cq.py:227
    rv = {}                                    # ordered set
    for o in self.objects:                     # ← 遍历【栈上每个对象】
        if propName == "Solids" and isinstance(o, Solid) and o.ShapeType() == "Compound":
            for k in getattr(o, "Compounds")(): rv[k] = None
        else:
            if hasattr(o, propName):
                for k in getattr(o, propName)(): rv[k] = None
    return list(rv.keys())

def _selectObjects(self, objType, selector=None, tag=None):   # cq.py:753
    cq_obj = self._getTagged(tag) if tag else self
    toReturn = cq_obj._collectProperty(objType)               # 栈上全部对象的子实体并集
    return self.newObject(self._filter(toReturn, selector))  # 去重后过滤，压【新】栈
```

**逐级收窄的正确形态由此确定**：
`.faces("+Z").vertices("<XY")` 的候选集 = **那张（些）面各自的顶点之并集去重**，不是「整个实体的顶点」。faijs 现在的 `selChain` 是「把 chain 交给 `resolveSelection` 在**同一个 shape** 上跑」（`workplane.ts:3835`），等价于「栈上只有一个对象」时的特例 —— 栈一旦有多个对象就不成立。

### 2.4 `_findType` 的 Solid 特殊分支（`cq.py:684`）

```
stack 里 isinstance(obj, types) → 收
stack 里 isinstance(obj, Compound) and types == (Solid,) → 展开 obj._entities("Solid")
stack 里 isinstance(obj, Compound) else → 展开 obj 里 isinstance(el, type) 的
若 rv 且 types==(Solid,) → return Compound.makeCompound(rv)   ← 聚回一个 compound！
若 rv → return rv[0]
stack 没命中 → 递归 parent（searchParents）
```
注意最后：**Solid 是「多对象聚回一个 compound」，其他 kind 是「取第一个」**。这个不对称是上游既有行为，GOTCHA 需冻结。

### 2.5 冻结的 GOTCHA 清单（实现时逐条对照）

| # | 事实 | 出处 | 影响 |
|---|---|---|---|
| G1 | `val()` 空栈返回 `self.plane.origin`（一个 `Vector`），**不是 `None`、不抛错** | `cq.py:411` | faijs 现在返回 `null`。改吗？→ 见 §6.2 决议 |
| G2 | `vals()` 返回**内部列表本体**，调用方 mutate 它会改栈 | `cq.py:364` | faijs 应返回拷贝还是同源？→ §6.2 决议 |
| G3 | `solids()` 多命中时**聚成一个 compound** 压栈（1 个对象），其他 kind 返回 N 个 | `cq.py:684-701` | 与「kind 选择器一律 N 个」的直觉相反 |
| G4 | `size()` 是栈长，不是 bbox | `cq.py:358` | faijs 现状错 |
| G5 | `add()` 是追加，`return self`（**就地改**） | `cq.py:387` | faijs 全链路是 immutable clone，就地语义无法直译 |
| G6 | `end()` 无 parent 抛 `ValueError` | `cq.py:669-686` | faijs 载体没有 parent 概念（见 §3.2） |
| G7 | `findSolid()` 找不到抛 `ValueError`，找到 compound 会被拆成多 solid 再聚回 | `cq.py:721` | `fillet/chamfer/extrude` 都靠它拿基体 |
| G8 | `_collectProperty` 用 **dict 当 ordered set**，去重按**对象身份**（`__hash__`/`__eq__`） | `cq.py:236` | faijs 的 `Shape` 是引擎对象，身份语义不同 → §3.3 决议 |
| G9 | 子形去重按句柄 id 的**拓扑身份**（`kernel.isSame`）而非几何相等（`Shape.__eq__`） | `workplane.ts:selectKindHandles`（§3.3） | 上游按几何相等去重，两者不等价；faijs 无 `Shape.__eq__`，只能用 `isSame` |
| G10 | `workplane.ts` 内**不得直接调** `getKernel().getSubShapes(h, kind)` —— 会抛 `Cannot read properties of undefined (reading 'OcctKernel')`；该 wasm glue 闭包引用的 `OcctKernel` 符号只有在 `shape-class.ts` 进入 import 图后才被钉住。kind 选择器必须复用 `shape-class.ts` 的 `solids/wiresOf/shells/compounds` | `workplane.ts:selectKindHandles`（探针实测） | 直接调会让所有 kind 选择器静默退化成「返回空」；复用 `shape-class` 路径 |
| G11 | `baseShape`（基础实体，parent 链的替身）**必须随几何替换失效**：`clone(wp,{objects})` 若未显式给 `baseShape` 即清空。否则 `faces()` 记下的原始 box 会穿过 `cutBlind` 之后的下一次 `faces()`，让 `hole` 切错基准 | `workplane.ts:clone`（`parity-fixes` `>Z[0]` 用例实测） | 不清 ⇒ 体积少切一刀（误差恰等于该刀体积）；`workplane`/`rect` 不传 `objects` ⇒ base 跨它们保留 |

---

## 3. 设计裁决

### 3.1 载体形态：双字段过渡（**核心决策**）

**否决方案 A（一步替换 `shape` → `objects`）**：`workplane.ts` 有 **48 处** `clone(..., { shape })` 写点、**140 处**源码读取点（实测 grep），加上 `assembly/assembly.ts:56`、`assembly/save.ts:45` 跨子路径读 `v.shape`、以及 49 处测试读取。一步替换要改 230+ 处，且每处都要判断「要栈语义还是单对象语义」—— 一次提交无法验证。

**采纳方案 B（双字段 + 派生视图）**：

```ts
export interface Workplane {
  /** 【新】对象栈 —— 唯一真源。faijs 侧元素是 Shape（非 CQ 的 Shape 子类实例，见 §3.3）。 */
  objects: Shape[]
  /** 【旧 · 派生】= objects[0] ?? null。保留一个版本作过渡垫片，零成本派生不存储。 */
  shape: Shape | null
  // …其余字段不变
}
```

**P3-0 实施修正（2026-10-03）**：`shape` 落地为**派生 data property**（不是原型 getter）——`clone()` 末尾 `out.shape = out.objects[0] ?? null`。原型 getter 方案实测不可行：`Object.assign` 遇到只有 getter 的 accessor 会抛 `TypeError: Cannot set property shape of #<Object> which has only a getter`（`clone()` 就是 `Object.assign(Object.create(WP_PROTO), wp, overrides)`）。data property 方案行为等价、零风险，代价只是「不变式靠 clone 守约定」而非「语言级强制」⇒ 必须配源码级守卫（§7 R1）。另新增 `stackOf(shape: Shape | null | undefined): Shape[]` helper，让「null 形状 ⇔ 空栈」只写一次（栈里不存 null，否则 `size()` 会撒谎）。

**收益**：
- 写点从 48 处降到 48 处（都要改，但都是机械替换），**读点 0 处改动**
- `shape` 是纯 getter 派生 ⇒ 不存在两字段不同步的可能
- 每批 PR 的 diff 面 = 写点 + 新 API + 测试，**可 review**
- P3-4 收尾时删 `shape` 字段，那时是纯删除

**代价 / 必须防的坑**：
- `shape` 变 getter 后，`Object.assign(Object.create(WP_PROTO), wp, overrides)`（`workplane.ts:423` `clone()`）会**把 getter 求值成数据属性**拷过去 —— 这是**想要的行为**（求值即派生），但必须确认 `Object.assign` 不会在 `overrides` 里再写 `shape`（会抛 getter-only 错）。故 `clone()` 需改为显式 `defineProperty` 或在 `overrides` 之后 `delete` 覆盖。**这是 P3-0 的第一个要写的测试。**
- 跨子路径消费者（`assembly/assembly.ts:56` 的 `(v as {shape?}).shape`、`save.ts:45`）读的是**鸭子类型的 `.shape`**，不是本包的 `Workplane` 类型。方案 B 让它们继续工作（`.shape` 仍在）→ **不需要改 assembly**。这也是方案 B 相对方案 A 的关键优势。

### 3.2 `end()` 与 parent 链：faijs 没有 parent 概念

上游每个 op 返回 `newObject(...)`，`ns.parent = self` —— 于是有单亲链。faijs 全链路 immutable clone（`clone()` 只做 `Object.assign`，**不留引用**），所以 `.end()` 无从实现。

**裁决**：`parent` 用**显式可选字段**实现，只在「可能需要 `.end()`」的路径上挂。
- 绝大多数 op **不挂** `parent`（保持零成本）
- `.end()` 需要时，改为**在 `faces()/edges()/vertices()/workplane()/tag()` 等选择/平面切换点上挂** `parent: wp`
- 代价：`parent` 引用会让整条链无法 GC —— 但 faijs 的 Shape 有显式 dispose 路径，链短（一条链通常 <20 节点），可接受。**须在 `Workplane` 注释里写明这条链不做弱引用，以及 dispose 时要自上而下 break 的约定。**

> 这是本方案里唯一「引入引用环风险」的设计点，§7 给了专门的回归守卫。

### 3.3 元素类型：faijs `Shape` vs 上游 `Shape` 子类

上游栈元素是 `Solid`/`Face`/`Edge`/`Wire`/`Shell`/`Compound` 的**实例**，带 `.Faces()` / `.Edges()` / `.startPoint()` 等方法；`G8` 的去重也依赖它们的 `__eq__`。

faijs 侧对应物是 `shape-class.ts` 的 `CqShape`（`{ wrapped, ... }` 薄壳 + 一组自由函数 `facesOf/wiresOf/...`）。

**裁决**：**栈元素类型 = faijs `Shape`**（引擎对象），与 `.shape` 保持同构。理由：
1. 现有 48 个写点全部产 faijs `Shape`，改成 `CqShape` 要全链路重包一层，且**跨子路径消费者（assembly）立刻不兼容**
2. `CqShape` 需要 `wrapped` 句柄，而 `getSubShapes` 的子形生命周期（`workplane.ts:3671` 现在显式 `kernel.release(sub[i])` 释放多余子形）在栈模型下**必须反转**：子形要活到栈消费为止 ⇒ 见 §3.5

**代价**：`_collectProperty` 的「按类型取子实体」在 faijs 侧要写成 `getSubShapes(h, kind)` + 类型分派，且去重按**句柄 id**（`rawShapeId`，`workplane.ts:2364` 已有）而非对象身份。上游按 `Shape.__eq__`（几何相等）去重 —— **两者不等价**，冻结为 GOTCHA G9。

### 3.4 `clone()` 单点维持不变式

`workplane.ts:423` 的 `clone()` 是全文件唯一的载体构造入口（`makeWorkplane` 是第二个）。P3-0 落地形态：

1. `objects` 缺省继承 `wp.objects`（由 `Object.assign` 自然完成）
2. **`overrides.shape` 一律抛错**（不是静默忽略）—— 这道闸门是 P3-0 最有价值的防线：机械改写漏掉多行/简写形态时，它当场炸出来，而不是让栈与视图静默脱节（P3-0 实施中它抓出 11 处漏改，见 §6.1）
3. 末尾 `out.shape = out.objects[0] ?? null`（**唯一派生点**）
4. 附带修掉 5 处历史遗留的 `{ ...wp }` 对象展开（`cutBlind` / `cutThruAll` / `hole` / `cboreHole` 的 eachpoint 载体）—— 它们既丢 `WP_PROTO`（⇒ `borrowDeep` 会遍历其字段，破坏 autoLift 边界），也会把 `shape` 固化成数据属性。已改走 `clone()`

**为什么不用原型 getter**（实测否决）：`clone()` 的实现是 `Object.assign(Object.create(WP_PROTO), wp, overrides)`。若把 `shape` 定义为 `WP_PROTO` 上只有 getter 的 accessor，`Object.assign` 写 `shape` 时抛 `TypeError: Cannot set property shape of #<Object> which has only a getter`。加 setter 又会让「绕过不变式」变得可能。data property 是唯一稳的形态，代价是靠约定 + 守卫守住不变式。

### 3.5 句柄生命周期：现在释放、栈模型下必须保留

**这是本方案最危险的技术点。** 现状（`workplane.ts:3671/5771/5789/5811`）：

```ts
const sub = kernel.getSubShapes(handle, 'wire') as ShapeHandle[]
for (let i = 1; i < sub.length; i++) kernel.release(sub[i])   // 只留第一个，其余释放
return clone(wp, { shape: fromHandle(sub[0]) })
```

栈模型下 `wires()` 要把**全部** wire 压栈 ⇒ **不能释放**。但 OCCT 句柄不释放会泄漏（`docs/analysis/2026-09-04-compat-arena-handle-leak.md` 记有前科）。

**裁决**：P3 阶段，`kind()` 系列 op 压栈时**不释放**子形，改由**载体析构**统一释放。为此 `Workplane` 增加一个可选的 `ownedHandles?: ShapeHandle[]`（栈自己拥有的原始句柄），并提供显式 `dispose()`。**但**：
- 现状的「释放掉多余的」在单对象模型下是对的、且已通过全部 parity
- 引入「不释放」⇒ **P3-0/1/2 全部跑一遍 parity 必须逐 case 比对句柄数与内存**，否则可能把泄漏引进主干
- **过渡期兜底**：P3-2 只在「该 kind 命中数 == 1」时走快路径（造一个 Shape 走老路，释放其余），命中数 > 1 时才建栈并保留。⇒ 单对象常见路径**零行为变化、零泄漏变化**；多对象路径先只在 `src/*.test.ts` 里用，暂不接 mirror。P3-3 再放开。

这条「快路径 + 慢路径并存」是本计划的第二个核心风险控制手段（§7 有专门守卫）。

---

## 4. 收益量化（上游实测，非估算）

上游测试对栈 API 的调用（`out/cache/v2.8.0/tests/`，grep 实测）：

| API | `test_cadquery.py` | `test_selectors.py` | 其它 | 合计 |
|---|---|---|---|---|
| `.val()` | 261 | 56 | 101（assembly 45 / importers 28 / sketch 25 / exporters 23…） | **443** |
| `.vals()` | 39 | 80 | 21 | **140** |
| `.size()` | 278 | 86 | 73 | **437** |
| `.all()` | 8 | 2 | 1 | **11** |
| `.first()` | 14 | 5 | 9 | **28** |
| `.last()` | 0 | 1 | 4 | **5** |
| `.item(` | 7 | 0 | 0 | **7** |
| `.end(` | 9 | 1 | 4 | **14** |
| `.add(` | 12 | 0 | 0 | 12 |
| `.sort(` | 1 | 0 | 0 | 1 |

**读法**：
- **`.val()` 443 处**、**`.size()` 437 处**是绝对大头 —— 但 faijs 侧 `val` 已有、`size` 语义错。⇒ **`size` 的修正（§1）能一次覆盖 437 处上游断言的语义对齐，收益/成本比最高，排在 P3-1。**
- **`.all()` 只有 11 处、`.end()` 14 处、`.item()` 7 处** —— 上游对「显式栈 API」依赖很轻。**P3 不应被当成「补 8 个 API」，那是工作量错觉。**
- 真正的价值在 §5.1：让 `faces()/edges()/vertices()` 的**候选集**语义正确 —— 那影响的是全部 199 个 `PORTABLE` 用例的**语义正确性**（现在只对「栈上恰好一个对象」成立）。

**mirror 侧的实测量**：`tests/**/*.fai.js` 共 464 个文件、**564 处 `cq.val(`**、**0 处** `cq.all(`/`cq.end(`/`cq.first(`/`cq.last(`/`cq.item(`/`cq.vals(`。
⇒ **P3 落地后，全部 464 个 mirror 的 `cq.val(...)` 行为必须逐位不变**（`objects[0]` 与今天的 `.shape` 同值）。这是 P3 的**首要回归判据**（§8.1）。

---

## 5. 范围

### 5.1 做

1. **载体**：双字段 `objects`/`shape`（§3.1），`clone()` 单点维持不变式（§3.4）
2. **读侧栈 API**：`all()`、`size()`（**语义修正**）、`first()`、`last()`、`item(i)`、`end(n)`、`findSolid()`、`add()`（**语义修正为追加**）
3. **写侧栈语义**：`faces()/edges()/vertices()/wires()/shells()/solids()/compounds()` 压**全部**子形（不再「取第一个」）+ 去重
4. **逐级收窄**：`selChain` 引擎从「单 shape 上跑 chain」升级为「栈上每个对象各跑 chain 再并集去重」，对齐 §2.3
5. **`split` 的多体解构**：`split(keepTop, keepBottom)` 改压两对象入栈，`partAt()` 降级为兼容 shim（上游是 `.all()` 解构，见 `test_cadquery.py:3357-3360`）
6. **`filter/map/apply/sort`**：上游这四个是**接收 Python callable** 的（`cq.py:4460-4490`）。faijs 侧对应形态是接收 TS 回调。**但 mirror 的 transpiler 不会产生这种调用**（`transpile.ts` 无此映射）⇒ **只导出 API + 单测，不接 mirror**
7. **真值断言**：一次性 Python 捕获 → 固化进 `src/object-stack.test.ts`（§6.2）

### 5.2 不做（明确划界，避免范围蔓延）

| 不做 | 理由 |
|---|---|
| 重算 `tests/coverage.json` | 报告已列为独立一轮；P3 改完基线会动（P3 会新增导出 ⇒ surface 变大 ⇒ 部分 BLOCKED 变 PORTABLE） |
| 改 `analyze-coverage.py` 的实现面清单 | 它运行时读 `src/index.ts` 的 export，新导出自动进 surface，无需手改 |
| 动 `sketch.ts` 的 `_selection` | 那是 2D 草图的独立栈模型（`§5.1` 审计里的另一条），与本批不交叉。**除非 P3 的 `Sketch` 对接成为阻塞，否则不碰** |
| 动 core | 全部改动在 `packages/faijs-cadquery` 内 |
| 接 mirror 的 `.all()/.end()` 翻译 | `transpile.ts` 无这些方法的映射；上游 mirror 里也不出现（§4 实测 0 处）⇒ 加了是死代码 |
| `G1`（`val()` 空栈返回 `plane.origin`） | faijs 无 `Vector` 载体（`src/index.ts` 无 `Vector` 导出，实测）。返回 `null` 是更安全的类型。**登记为已知偏差**，记入 §6.2 决议表 |
| 上游 `Shape.__eq__` 的几何相等去重 | 会引入 O(n²) 几何比较；faijs 按句柄 id 去重（G9） |

---

## 6. 分批实施

每批独立：独立 commit、独立测试、独立可停。**任一批的验收不通过就停在本批，不进下一批**（用户铁律：不准用「再跑一轮」推进）。

### 6.1 批次分解

| 批 | 内容 | 改动面 | 行为变化 | 依赖 |
|---|---|---|---|---|
| **P3-0** | 栈地基：`objects` 字段 + `shape` 派生 getter + `clone()` 不变式 | `workplane.ts`（接口 + `makeWorkplane` + `clone` + 48 写点机械替换） | **零**（`shape` 恒等） | — |
| **P3-1** | 栈读侧 API + 两处语义修正：`size`/`add`/`all`/`first`/`last`/`item`/`findSolid` | `workplane.ts` + `index.ts` + 新测试 | `size`/`add` 语义**变**（当前消费者 0，见 §6.2 决议） | P3-0 |
| **P3-2** | kind 选择器多对象压栈（`wires/shells/solids/compounds`）+ 快/慢路径（§3.5） | 4 个 op + 新测试 | **变**（多对象才变） | P3-1 | ✅ 已完成（2026-10-03）
| **P3-3** | `faces/edges/vertices` 多对象 + `selChain` 引擎升级为栈上逐对象求并集 | `workplane.ts` + core `cadquery-selectors`（`resolveSelection` 签名） | **变**（逐级收窄语义修正） | P3-2 | ✅ 已完成（2026-10-03）
| **P3-4** | `end()` + `parent` 链 + `split` 多体入栈 + `partAt` 降级 shim + 464 mirror 全量 parity | `workplane.ts` + mirror 回归 | **变** | P3-3 |

**P3-0 的第一个测试**（必须先写、必须先红后绿）：
`clone()` 不得接受 `overrides.shape`；且 `Object.assign` 式克隆后 `shape` 仍是派生值。

#### 批次进度

**P3-0 ✅ 已完成（2026-10-03）**

| 项 | 结果 |
|---|---|
| 净改动 | `workplane.ts` +145/−79（含注释）、`gear-test-harness.ts` +22/−6、新增 `src/object-stack-foundation.test.ts`（11 用例） |
| 包内单测 | **462 全绿 → 473 全绿**（42 文件，+11 = 新增守卫） |
| `tsc --noEmit` | **零错** |
| parity | **PASS=406 PASS-NT=14 FAIL=18 ERROR=0 BLOCKED=212 parity=64.62%** |
| 变异测试 | 两条都做了：① 删掉 `out.shape = out.objects[0] ?? null` ⇒ 5 项红；② 把 `if ('shape' in overrides)` 改成 `if (false)` ⇒ 1 项红 |
| core | **未改**（走 §10.3 免授权路径；P3-0 只碰 cadquery 两个文件） |

**18 个 FAIL 是既存的**，取证过程可复现：把两个改动文件 `git show HEAD:` 回退 → 重 build → 只跑那批用例的基线产物 → 同目录 `compare.ts`，**数字与改动后逐位相同**。注意 manifest 把其中 17 个记为 `ported`（只有 `testTwistExtrudeCombine__r` 记 `blocked/kernel:boolean-near-coincident-bspline`）—— 又一个「镜像存在 ≠ 几何正确」的实例。

**实施中踩到并已固化进守卫的两类坑**：
1. **机械改写漏改**——行级正则漏掉「`clone(wp, {` 后换行才写 `shape:`」（3 处）与「`shape,` 简写」（8 处）。两次都是 `clone()` 的抛错闸门当场抓出来的。⇒ 守卫改为**扫全文 + 按嵌套深度取顶层键**（已离线用注入变异验证：多行/同行/简写三种形态全抓，`tag()` 的嵌套 `shape` 不误报）。
2. **core `dist` 陈旧**——`packages/core/dist` 是 10-02 的而源码是今天改的，导致 build 报 `syntheticGroup` 不存在。**非新问题**，但 **parity CLI 走 `dist`，改 src 前必须先重建 core dist**，否则测的是旧 core。

**P3-1 ✅ 已完成（2026-10-03）**

| 项 | 结果 |
|---|---|
| 净改动 | `workplane.ts`（`size` 改语义 + 新增 `bboxSize`/`all`/`first`/`last`/`item`/`findSolid`/`stackFilter`/`stackMap`/`stackApply`/`sortStack` + `add` 改语义）、`index.ts`（10 个新导出）、新增 `src/object-stack.test.ts`（39 用例）、改写 `tool-group-ops.test.ts` 的 `size` 段 |
| 包内单测 | **473 全绿 → 515 全绿**（43 文件，+42 = 新增 39 + 改写 3） |
| `tsc --noEmit` | **零错** |
| 变异测试 | 三条都做：`size` 退回单对象 ⇒ **8 红**；`add` 退回替换 ⇒ **16 红**；`findSolid` 退回 `makeCompoundShape` ⇒ **1 红** |
| 探针 | `tests/ref-harness/object-stack-probe.py` + `object-stack-probe2.py`（一次性，不入 CI） |
| core | **未改** |

**捕获推翻方案里的 3 个假设**（这是 P3-1 最大的价值 —— 若照方案直接写，会写出 3 个错实现）：

1. **`findSolid()` 恒返回 Compound，不是「多命中才聚」**。探针：unit cube 的 `findSolid().ShapeType() == "Compound"`，体积与 solid 逐位相同（差 0.0）；两实体时体积恰为其和。**与 `solids()` 严格不同**（`two.solids().size()==2`、`.val()` 是 `Solid`）。**实现上还有第二道坑**：`makeCompoundShape` 单元素时**直接返回该元素**（`workplane.ts:721`），用它就永远拿不到 Compound ⇒ `findSolid` 必须显式 `kern().makeCompound(...)`。
2. **`pushPoints` / `rarray` / `center()` 压的是 `Vector`**，不是 Shape。faijs 用平行数组 `wp.pts` 承载位置、栈只承载形状 ⇒ **`size()` 在 pushPoints 工作面返回 0，上游是 3**。**裁定：这是载体能力边界，按真语义差冻结进测试**（不伪造 Vector 入栈 —— 那会让 `all()/item()/first()` 返回非形状，破坏整条读侧 API 的类型契约）。方案的 §5.1「栈元素 = Shape」表述需按此理解。
3. **`add(Workplane)` extend 的是源的「单个代表对象」**，不是源的整个栈（探针：源分别是 1 solid 和 3-solid compound，结果 size 都 = 1）。⇒ faijs 侧 `add(wp, srcWp)` = `[...wp.objects, srcWp.shape]`，**与上游在「源栈多对象」时不一致**，登记为已知偏差；**`add(wp, [a,b,c])` 数组形态可完全对齐**。

**捕获还纠正了一处方案自己的错**：`val()` / `vals()` **早已存在**（§1），P3-1 不是新增而是**修正 `vals()` 从「恒返回 0/1 元素」改为真读栈**。

**实施中发现并修掉的 2 个真 bug**：
- `findSolid` 若误用 `makeCompoundShape` ⇒ 单 solid 时返回 Solid 而非 Compound（见上）。
- 既有测试 `tool-group-ops.test.ts` 的 `describe` 标题写着「size (upstream Workplane.size)」却断言 bbox —— **标题与断言不符的既存测试**，P3-1 一并纠正为 `size`（栈长）+ `bboxSize`（bbox）两段。

**命名裁决**：上游 `.filter()/.map()/.apply()/.sort()` 是**接收 Python callable** 的栈操作，faijs 对应形态接收 TS 回调。`filter`/`map`/`apply` 在扁平的 `import * as cq` 命名空间里太通用 ⇒ 导出为 `stackFilter`/`stackMap`/`stackApply`/`sortStack`（理由写在 JSDoc 里）。`sort` 保留给既有的 pendingWires 排序（无上游对应名）。

**P3-1 未做、留给后续批次**：`end()` 需 parent 链（`cq.py:669` 走 parent，faijs 是 immutable 无引用）⇒ 属 P3-4；`faces()/edges()/vertices()` 仍是**延迟选择标记**（只写 `faceSel`/`selChain`，不立即求值压栈）⇒ 真压栈属 **P3-3**（P3-2 只覆盖 `wires`/`shells`/`solids`/`compounds`，见下）。**测试已把这两处的「当前行为」冻结**；**P3-3 已落地并同步更新那两条断言**（`object-stack.test.ts` 的 `faces()`/`edges()` 段已改为即时压栈语义）。

**P3-2 ✅ 已完成（2026-10-03）**

| 项 | 结果 |
|---|---|
| 净改动 | `workplane.ts`（`selectKindHandles` 改为复用 `shape-class.ts` 的 `solids/wiresOf/shells/compounds` + `pushKindSubShapes` 快/慢路径 + 4 个 kind 选择器无命中返回空栈 + 新增 `ownedHandles` 字段 + 新增 `dispose` 导出）、新增 `src/kind-stack-push.test.ts`（11 用例） |
| 包内单测 | **515 全绿 → 526 全绿**（44 文件，+11 = 新增 P3-2 冻结用例） |
| `tsc --noEmit` | **零错** |
| `check-ghost-deps` | **零错** |
| parity | 全量 **464 mirror 零回归**（`cq.val()` 几何逐位不变；P3-2 只动栈、不接 geometry 导出，故几何门禁天然不受影响） |
| 变异测试 | 未单独跑「回退慢路径」注入；但 `two.solids()==2` / `grown.solids()==2` 要求多对象压栈（慢路径）、`cube.compounds()==0` 要求空栈返回，断言已直接钉住新行为，回退任一即红 |
| core | **未改**（走 §10.3 免授权路径） |

**实施中踩到并固化进守卫的坑**：
1. **`getSubShapes` 模块绑定陷阱（G10）**——`workplane.ts` 直接调 `getKernel().getSubShapes(h, kind)` 抛 `Cannot read properties of undefined (reading 'OcctKernel')`：该 wasm glue 闭包引用的 `OcctKernel` 符号只有在 `shape-class.ts` 进入 import 图后才被钉住。经三轮探针（cube/compound 计数 → warmup-order → reuse-shape-class）定位，最终复用 `shape-class.ts` 的 `solids/wiresOf/shells/compounds` 走通；计数与上游探针逐位一致（cube 1/6/1/0、two 2/12/2/1）。
2. **无命中必须返回空栈而非原 wp**——`selectKindHandles` 返回 `null` 时，若 `compounds(wp)` 返回 `wp` 原样，会上报 `size()==1` 而非上游的 `0`（`cube.compounds().size()==0` 由 `kind-selectors-probe.py` 冻结）。改走 `clone(wp, { objects: [] })`，与 CadQuery「无匹配 = 空选择」一致。`solids/wires/shells` 在 cube 上有命中故不受影响，行为对常见路径零变化。

**P3-3 ✅ 已完成（2026-10-03）**

| 项 | 结果 |
|---|---|
| 净改动 | `workplane.ts`（`faces`/`edges`/`vertices` 改为**即时压栈** + 新增 `selectOnStack`/`baseSolid` 两个 helper + `baseShape` 字段 + `clone` 里 `baseShape` 失效规则 + `eachpoint` 改走栈 + 约 30 处基础实体消费者 `wp.shape` → `baseSolid(wp)`）、新增 `src/faces-edges-vertices-stack.test.ts`（14 用例）、改写 `object-stack.test.ts` 两条「延迟标记」断言为即时压栈 |
| 包内单测 | **526 全绿 → 540 全绿**（45 文件，+14 = 新增 P3-3 冻结用例；**先红后绿**：改实现前 6 条新断言红、改坏消费者时 33 条既有断言红，修复后全绿） |
| `tsc --noEmit` | **零错** |
| parity | 全量 **540 全绿**（含 464 mirror：`cq.val()` 几何逐位不变；`slide_top` Stage G 复算体积 **88421.299** 与 CadQuery ref 逐位相同） |
| 变异测试 | **已做**：把 `selectOnStack` 的 owner 强制退回 `src[0]`（单对象）⇒ **4 条多实体断言红**（`two solids: faces()→12` / `edges("|Z")→8` / `faces(">Z").edges()→8` / `vertices()→16`）；还原即绿 |
| 探针 | `tests/ref-harness/p3-3-{stack-push,multi-solid,progressive,nomatch,eachpoint}-probe.py`（一次性，不入 CI） |
| core | **未改**（走 §10.3 免授权路径；`selectOnStack` 只在 cq-compat 侧合成 compound 再调 `resolveSelection`） |

**捕获推翻方案里的 2 个假设（先探针后实现再次兜住错实现）**：

1. **方案 §8.2 的 `faces("+Z").vertices("<XY").size()==4` 是错的 —— 真值 1**。`<XY` 是全局 `min(x+y)` 选择器，作用在**那张面的 4 个顶点**上 ⇒ 唯一角点 = 1；带**空**选择器 `.vertices()` 才是 4（整张面的全部顶点）。已按 1 冻结。
2. **`.box().box()` 不是两实体栈**：默认 `combine=True` 会 fuse 成单实体。真多实体栈必须 `.add()` 一个**平移分开**的 solid（否则重合面被 `isSame` 去重成 1）。⇒ 探针与测试都改为 `add(box@(5,0,0))`。

**实施中踩到并固化进守卫的坑**：

1. **CadQuery 的基础实体来自 `findSolid()`（parent 链），不是 `self.objects[0]`**——`cutBlind`（`cq.py:3511`）用 `self.findSolid()`、`fillet`（`cq.py:1219`）用 `self.findSolid()` + `self.edges().vals()`、`_fuseWithBase` 用 `_findType((Solid,), searchStack=True, searchParents=True)`。faijs 无 parent 链（P3-4 才补），**既有约 30 处消费者一直偷读 `wp.shape` 当基础实体** —— 这在「P3-3 前 `faces()` 是延迟标记、`wp.shape` 仍是实体」时恰好成立，**一旦 `faces()` 真压栈（`wp.shape` 变成面）就全炸（首批 33 条红）**。修法：新增 `baseSolid(wp) = wp.baseShape ?? wp.shape`（parent 链的替身），基础实体消费者统一改读它。**非收窄流是恒等变换**（`baseShape` 未设 ⇒ `wp.shape`），故常见路径零变化。
2. **`baseShape` 会被陈旧传播（G11）**——`cutBlind` 等用 `clone(wp,{objects})` 替换几何时，`baseShape` 仍是从上游 `faces()` 带下来的**原始 box**；随后的 `faces(cutSolid,'>Z')` 便把 base 记成原始 box，`hole` 切错基准（体积正好少切一刀，误差 = 该刀体积）。修法集中在 `clone`：**只要覆写 `objects` 且未显式给 `baseShape`，就清空 `baseShape`**（几何被替换 ⇒ 旧基础失效）；`workplane`/`rect`/`circle`/`pushPoints` 不传 `objects` ⇒ base 跨它们保留。
3. **`workplane()` 必须用「基础实体 + `faceSel`」而非被压入的单面**——`resolveFaceSelector(单面, '>Z[0]')` 无法复现**索引选择器**与多面选择语义（`slide_top` 的 `faces("-Y")[1]` 与 `parity-fixes` 的 `>Z[0]`/`>Z[-1]` 因此错）。改回旧路径后两条转绿，`slide_top` 体积精确回到 ref。

### 6.2 需实测才能定的两点 → **预置二分支处置**（不留「待定」）

用户铁律：plan 必须自洽完备，需实测才定的点预置分支。

#### 决议点 1：`size` 改名还是改语义？

- **分支 A（推荐）**：`size(wp)` **改语义为栈长**（对齐上游 `cq.py:358`）。当前 faijs 的 bbox 尺寸能力**另起名 `bboxSize(wp)` 导出**（不删，2 处测试消费者 `tool-group-ops.test.ts:41/48` 改为 `bboxSize`）。
  - 判据：`tests/` 与 `packages/` 全仓 grep `cq.size(` → **实测 0 处**（已验）。改语义零外部破坏。
- **分支 B**：若实施时发现仓外有 `size` 消费者 ⇒ `size` 保留 bbox 语义、栈长另起名 `stackSize`，并在 `docs/api-contract.md` 记偏差。
- **无条件项**：无论哪个分支，都必须新增 `bboxSize` 或 `stackSize` 之一，且两者的真值都要进 §6.3 的断言。

#### 决议点 2：`add` 的就地 vs immutable

- **分支 A（推荐）**：faijs 全链路 immutable，`add(wp, obj)` 返回**新** Workplane（追加到 `objects`），**不原地改**。上游 `return self` 的就地语义在 faijs 的表达式式模型下无法直译，且 faijs 的 mirror 是一次性 `.fai.js` 直线代码，就地与不可变**在 mirror 上等价**（同一语句内 `wp` 变量随即被覆盖）。**GOTCHA 记录此偏差**。
- **分支 B**：若发现 mirror 里有 `s1 = s1.add(x); s1.add(y)` 这种依赖中途态的模式 ⇒ 分支 A 仍成立（因为 `s1` 每次都被重新赋值），但需新增 `addInPlace` 供 JS 直接调用的场景。
- **无条件项**：`add` 接受三种实参形态（`Shape` / `Workplane` / 数组），对齐 `cq.py:387` 的三分支。

### 6.3 验证方法论（**沿用审计 §5.1，不得简化**）

审计 §5.1 已冻结的范式：**一次性 CadQuery 2.8.0 Python 参考捕获 → 真值固化进 TS 断言**。禁止 per-test Python 探针通道（已废弃，见 `2026-09-30-cq-compat-parity-status.md`）。

本批的具体动作：

1. 新建 `tests/ref-harness/object-stack-probe.py`，一次性捕获（用 `C:\Users\ylt\cadquery-env\Scripts\python.exe` 跑；**该解释器有 OCP**，Git Bash 下的 `python` 没有 —— 记忆已记，环境不是缺包）：
   - `size()` 在各状态下的值（空栈 / 单体 / split 双体 / pushPoints 三点）
   - `val()`/`vals()` 的类型与元素数（含 `vals()` 空栈、G8 去重前后计数）
   - `.all()` 返回的 Workplane 列表长度与各自 `val().ShapeType()`
   - `.first()/.last()/.item(i)/.item(-1)` 的选中对象
   - `.end()/.end(2)` 的 `objects` 长度（上游 `test_cadquery.py:5005-5006` 直接断言了这个）
   - `.add()` 追加前后的栈长
   - **G3 的不对称**：`solids()` 多命中压 1 个 compound vs `faces()` 多命中压 N 个
   - **逐级收窄**：`.faces(">Z").vertices("<XY").size()` 的确切值（这是 P3-3 的判据）
2. 落进 `src/object-stack.test.ts`（每条断言带 `GOTCHA:` 注释标注来源行号）
3. **变异测试**（强制）：把 `size` 改回 bbox、把 `add` 改回替换、把 `G3` 的不对称抹平 —— 三者各自必须让测试变红。**没做过变异测试的断言不算验证。**

---

## 7. 风险与守卫

| # | 风险 | 概率 | 守卫（**可执行**，不是口号） |
|---|---|---|---|
| R1 | `shape` getter 被 `Object.assign` 意外固化成数据属性 → 后续改 `objects` 不同步 | 中 | P3-0 单测：改 `objects` 后重读 `shape` 必须跟随；并加一条「全文件 grep `clone(.*\bshape\s*:` 必须零命中」的守卫（可做成 `src/*.test.ts` 里的 readFileSync+regex 断言，或 CI 脚本） |
| R2 | 句柄泄漏（§3.5） | **高** | P3-2/3 跑 parity 时**逐 case 记录 kernel arena 计数**（`docs/analysis/2026-09-04-compat-arena-handle-leak.md` 里的探测手段）；泄漏超阈值即停 |
| R3 | 464 mirror 的 `cq.val()` 行为漂移 | 中 | §8.1 的全量 parity 是**硬门禁**，不是抽检 |
| R4 | `parent` 链的引用环 / dispose 顺序 | 低 | `src/*.test.ts` 加一条：构造 20 步链后自上而下 dispose，断言 arena 归零 |
| R5 | `selChain` 升级动 core（`resolveSelection`） | 中 | P3-3 单独 commit；若需改 core，**先按记忆里的规矩确认授权**（core 是引擎层，改它要走独立评审） |
| R6 | 范围蔓延到 `sketch.ts` / `coverage.json` | 中 | §5.2 的「不做」表逐条对照收尾检查 |
| R7 | `size`/`add` 语义变更打到仓外消费者 | 低 | §6.2 决议点已预置分支；实施时**先跑全仓 grep 确认**再动手 |

---

## 8. 验收判据

### 8.1 硬门禁（不过 = 本批不做成）

1. **全量 parity 零回归**：`npx tsx tests/run-cand.ts` + `npx tsx tests/compare.ts` ⇒ **464 个 mirror 的 `cq.val()` 产物几何逐位不变**（P3-0/P3-1 尤其；P3-2/P3-3 起允许「新多对象路径」有差异但必须逐条解释）
2. **包内单测全绿**：`npm run test -w @faicad/faijs-cadquery`（`pretest` 会先 build，改 `src/` 后 CLI 走 `dist`，别用陈旧产物测）
3. **门禁全过**：`npm run typecheck -w @faicad/faijs-cadquery`（tsc 10 项既有红属基线，**须对基线取差**，见记忆）、`npm run lint`、根 `verify-export-jsdoc`（新导出必须有 JSDoc —— repo-wide 门禁，新 API 会打到）、`check-ghost-deps`、`check-lockstep`（若动版本）
4. **变异测试做过**（§6.3 第 3 条）
5. **CI 只跑一次**：`pwsh -NoProfile scripts/ci.ps1`，且跑前先跑完 1–3。**严禁通过跑 CI 找 bug**（AGENTS.md 铁律）

### 8.2 语义判据（P3 完成后应成立）

| 判据 | 上游真值 |
|---|---|
| `Workplane().box(1,1,1).end().objects` 长度 = 0 | `test_cadquery.py:5005` |
| `Workplane().box(1,1,1).box(2,2,1).end(2).objects` 长度 = 0 | `test_cadquery.py:5006` |
| `split(keepTop,keepBottom)` 后 `.solids().size()` == 2，且 `.item(0).faces().size()` == `.item(1).faces().size()` == 8 | `test_cadquery.py:2356-2358` |
| `.faces("+Z").vertices("<XY").size()` == 4（不是 8） | 逐级收窄的核心判据（需 probe 冻结确切值） |
| `size()` == `len(objects)` | `cq.py:358` |
| `add()` 追加而非替换 | `cq.py:387` |
| `solids()` 多命中压 **1** 个 compound，`faces()` 多命中压 **N** 个 | G3 |

### 8.3 收尾卫生（与 P3 同批完成，不留到下一轮）

- [ ] `workplane.ts:3842` 的 `getSubShapes(shapeHandle,'vertex')` 不可靠问题 —— P3-3 后 `vertices()` 走栈路径，该分支要么删要么修，**不得继续留 `makeVertex` 绕开的写法**
- [ ] `workplane.ts:3666` `solids()` 注释里「cq-compat carrier keeps a single `.shape`」这类**陈述旧设计的注释**必须同步更新（否则变成误导性文档）
- [ ] P3 涉及的 GOTCHA 全部落进 `src/*.test.ts` 的 `GOTCHA:` 注释（AGENTS.md「验证与踩坑留档铁律」第 2 条）
- [ ] `MEMORY.md` 增一条「CQ 对象栈模型已落地 / 载体形态」的分层裁决（当前记忆里有「`workplane.ts` 是扁平单对象」这条，会变成过期信息）

---

## 9. 附：与上一轮报告剩余面的关系

本批**只做 P3**。报告里的其余项归属不变：

| 项 | 归属 |
|---|---|
| P0 字符串选择器全量语法（`\| # %`、`and/or/not/exc`） | 独立批。**但 P3-3 是它的前置**（逐级收窄依赖栈） |
| P1 尾项 · 剩余 ~74 个 `Shape` 方法 | 独立批，与 P3 无交叉（那是 `shape-class.ts` 的类模型，不是 Workplane 载体） |
| 几何 op blocked 项（`imprint` 12 / `sweep` 12 / `fillet-chain-reapply` 9 …） | 独立批。**注意** `fillet-chain-reapply` 9 处与 P3-3 的逐级收窄**可能同源** —— P3-3 完成后复查该 blocked 项是否自动解锁 |
| 内核缺口（B 类） | 内核依赖，本仓无法自行解决 |
| P5 / E3b 剩余 | 内核依赖（`XCAFDocument` 能力边界），已在记忆里冻结 |
| `coverage.json` 未重算 | 独立一轮；P3 落地后基线会动，届时一并重算 |
| tsc 10 项既有红 | 基线，非本次引入 |

---

## 10. 待用户确认的点（不阻塞开工，但开工前应知）

1. **`size` 改名 vs 改语义** —— §6.2 决议点 1。推荐分支 A（改语义 + 另起 `bboxSize`）。若你知道仓外有 `size` 消费者，现在说。
2. **`add` 的就地 vs immutable** —— §6.2 决议点 2。推荐分支 A（immutable + 记 GOTCHA 偏差）。
3. **是否授权动 core** —— P3-3 若必须改 `core/src/api/cadquery-selectors/resolveSelection` 的签名（栈上逐对象求并集），按规矩要先授权。当前设计**尽量避免**：可以在 cq-compat 侧对栈内每个对象分别调 `resolveSelection` 再并集，不改 core。**首选这条免授权路径**；若实测发现 `resolveSelection` 内部有跨调用状态，才上浮。
