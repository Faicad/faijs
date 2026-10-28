# SMLib 抽壳（Shell）缺陷分析

- 日期：2026-10-28
- 作者：faijs engine-compare 排查（MainAgent）
- 范围：SMLib（C++ 封装 WASM）抽壳操作与 occt 双引擎逐值比对
- 状态：**已复核并修复**（2026-10-28 二轮）。原文结论二、结论三经复核**判反/归因错误**，见文末「复核更正」；抽壳 `openFaces` 选择器路径的两处适配器缺陷已修，回归测试见 `packages/tests/faijs/shell/open-face-selector-parity.test.ts` 与 `packages/core/test/smlib-kernel/smlib-shape-kind-queries.test.ts`。

## 背景与任务来源

用户原始要求（原话）："你还需要检查 3d_editor 这个项目里，他有一个 Example 文件夹里面有一些 faijs 脚本，你要用 occt 和 SMlib 都跑一遍，然后验证它们是相等的。然后 SMlib 比如说抽壳的时候，他会默认把一个长方体的外表面做圆角，这个 bug 要检查一下，还有就是你一个长方体对它进行平面分割以后自然有破皮，这个问题你也检查一下，这都是 SMlib 的 bug，检查一下。"

本文档聚焦抽壳（Shell）部分。平面分割（splitByPlane）破面缺陷已在同日另一修复中解决（半空间盒+布尔差算法替代 SmApiCut，与 occt 逐值一致），不在本文范围。

## 排查方法

- 探针：`packages/tests/faijs/engine-compare/smlib-shell-split-probe.test.ts`（8 用例，观测性无断言）
- 比对框架：同一 `.fai.js` 脚本分别在 occt 与 smlib 内核执行，逐项比对 vol / area / tri / bbox / faceCount
- 内核源码定位：`C:\git\new\usd-brep\source\SM_API\src\SmApiBrep.cpp`、`source\SM_API\inc\SmApiBrep.h`、`wasm-probe\src\SmApiBridgeEx.cpp`

## 实测数据（20×20×20 长方体，厚度 2）

| 场景 | occt | smlib | 结论 |
|---|---|---|---|
| SHELL_TOP（移除顶面，点顶面开口） | vol=3392, area=3552, tri=28, bbox=[20,20,20], 11 面 | vol=3392, area=3552, tri=28, bbox=[20,20,20], 11 面 | **逐值一致** |
| SHELL_THIN（30×20×10 长条，厚 1，去顶面） | vol=1464, area=3028, tri=28, 11 面 | vol=1464, area=3028, tri=28, 11 面 | **逐值一致** |
| SHELL_FULL（全封闭，无开口面） | vol=4096, area=1536, tri=12, bbox=[16,16,16], 6 面 | vol=3904, area=3936, tri=24, bbox=[20,20,20], 12 面 | **封闭薄壁语义差** |
| SHELL_TWO（移除上下两顶面，即 faces="\|Z"） | vol=2880, area=3168, tri=32, 10 面 | `E_OP_FAILED: memory access out of bounds`，vol=0 | **内核级崩溃** |

## 结论一：圆角 bug 未复现

用户报告的"抽壳默认把长方体外表面做圆角"在当前探针场景下**未复现**：SHELL_TOP / SHELL_THIN 两个开口抽壳场景与 occt 逐值一致（体积、面积、三角面数、bbox、面数完全相同），结果中不存在圆角面。

未复现不等于不存在：用户观察到圆角的场景很可能是 3d_editor 实际 UI 操作的具体参数组合（当前探针覆盖厚度 1–2、单面/长条开口）。若要继续追查，需要用户提供真机复现的具体参数（形状尺寸、厚度、开口面选择）。建议将"圆角复现参数"列为待补充输入，而不是在缺少参数的情况下修改已与 occt 一致的路径。

## 结论二：SHELL_FULL 封闭薄壁语义差（smlib 出外壳而非向内薄壁）

- occt 语义：向内抽壳——20³ 盒厚 2 后内部掏空，bbox 缩到 [16,16,16]，6 个平面，面积 1536
- smlib 语义：**偏移外壳**——结果仍是 20³ 外轮廓（bbox=[20,20,20]），12 面（内外面都保留），面积 3936
- 体积差异：smlib 3904 vs occt 4096，且 smlib 的 bbox 不随厚度内缩

这是**封闭薄壁语义差异**而非泄漏/崩溃：smlib 在"无开口面抽壳"时输出的是外表面偏移壳体（含内外面），与 occt 的"向内薄壁实体"不同。对用户可见影响：全封闭抽壳在 smlib 下结果体积/外观与 occt 不一致，不能用于双引擎等价比对。

内核路径：`SmApiShellBrepFull`（SmApiBrep.h:490 签名 `(pBrep, dOffsetDistance, bDoExtendedOffset, bDoSelfInt, bCreateOffsetSolid, rFacesToShell, rpResult)`），桥 `SmApiBridgeEx.cpp:472 SmApiShellBrepFullEx` 透传。语义差异源于内核实现本身，非桥层问题。

## 结论三：SHELL_TWO（移除上下两顶面）内存越界崩溃（内核级，未修复）

smlib 在 `faces="|Z"`（同时移除上下两个顶面）时直接 `E_OP_FAILED: memory access out of bounds`，无输出。occt 同参数正常输出闭合实体（vol=2880, 10 面）。

定位：崩溃发生在内核 SmApiShellBrepFullEx 多面移除路径（去两个相对顶面），疑似内核在删面/缝合时访问已释放或越界内存。属**内核级缺陷**，faijs 适配层无法规避——需要 SMLib C++ 侧（SmApiShellBrepFull 多面移除分支）修复后重新编译 wasm。

## 结论与建议（供审核）

1. 开口抽壳（点顶面/长条）在 smlib 与 occt 下结果一致，**无圆角、无破面**，双引擎等价比对通过——此路径不需要改动。
2. 全封闭抽壳（无开口面）smlib 语义为"偏移外壳"，与 occt"向内薄壁"不同——若产品需要全封闭抽壳的双引擎一致性，需在内核侧对齐语义（或在 faijs 层对全封闭场景显式降级/告警，避免静默输出不同几何）。
3. 多顶面移除（\|Z）在 smlib 下崩溃——**必须内核修复**（SMLib C++ 多面移除路径），faijs 层无解；修复前应在该场景给出明确错误提示而不是 OOB 崩溃。
4. 圆角 bug：当前无复现参数，需要用户提供 3d_editor 真机复现的具体形状/厚度/开口组合后再追查。

## 附：相关文件索引

- 探针：`packages/tests/faijs/engine-compare/smlib-shell-split-probe.test.ts`
- 内核源码：`C:\git\new\usd-brep\source\SM_API\inc\SmApiBrep.h`（SmApiShellBrepFull 签名 :490）
- 桥：`C:\git\new\usd-brep\wasm-probe\src\SmApiBridgeEx.cpp`（SmApiShellBrepFullEx :472）
- 修复提交：`c72882e fix(smlib-kernel): splitByPlane solid halves + transform rotation transpose`

---

# 复核更正（2026-10-28 二轮）

上文结论二、结论三**不成立**。用户质疑"抽壳是常用命令，SMLib 不支持很奇怪"是对的——SMLib 支持，
问题在 faijs 的 smlib 适配层与本文的基准选择。

## 更正一：全封闭抽壳，**occt 侧才是异常**（结论二把基准选反了）

复核把两边结果逐项换算成已知几何（20³ 盒、壁厚 2，向内等厚薄壁的解析解）：

| 量 | 解析解（向内薄壁实体） | occt 实测 | smlib 实测 |
|---|---|---|---|
| 体积 | 8000 − 16³ = **3904** | 4096 ❌ | **3904** ✅ |
| 表面积 | 6×20² + 6×16² = **3936** | 1536 ❌ | **3936** ✅ |
| bbox | 20³（外轮廓不变） | 16³，min=[2,2,2] ❌ | 20³ ✅ |
| 面数 / shell 数 | 12（外 6 + 内 6）/ 1 | 6 / 1 ❌ | 12 / 1 ✅ |

occt 返回的 4096 / 16³ / min[2,2,2] / 6 面 / 面积 1536 恰好是**内腔那个 16³ 实心盒**，
即 `offset(−2)` 体，不是薄壁。原文把它当"正确语义"，然后给 smlib 记了一条"语义差"——反了。

内核头文件本身就写明了 smlib 的语义（`SmApiBrep.h`，SmApiShellBrepFull 的
`bCreateOffsetSolid` 参数说明）："*manifold inputs always return Boolean wall volume*"。
smlib 的行为与声明一致。

结论：`occt-wasm` 的 `shell(solid, [], …)` 在"无移除面"时退化成 inward offset，这是
**occt 适配链路**的缺陷（影响全封闭抽壳的双引擎一致性），需单独处理；不应记为 smlib 缺陷。

## 更正二：`|Z` 崩溃**不在内核**，在 faijs 选择器解析（结论三归因错误）

复核用同一 smlib 内核、绕开 faijs op 层，直接对 20³ 盒的 6 个面做**全部 15 种双面组合**：

```
[smlib-shell-2face#0,1] vol=2880.00 area=3168.00 faces=10   ← 对面（=|Z 的两张面）
[smlib-shell-2face#2,3] vol=2880.00 area=3168.00 faces=10
[smlib-shell-2face#4,5] vol=2880.00 area=3168.00 faces=10
其余 12 种邻面组合 = 2816.00 / 3048.00 / 10 面
```

15/15 全部成功，且与 occt 逐值相同（对面 2880、邻面 2816）。**内核多面移除路径没有缺陷。**

崩溃真实位置（栈级定位）：`resolveSelectorToFaceRefs(shape, "|Z")` **自身**抛 wasm trap，
根本没走到 `shell`。`"|Z"` 是 ParallelDirSelector，需要面的外向法向，链路为

```
resolveSelectorToFaceRefs("|Z")
  → entityDirection → orientedFaceNormal(face, owner)      [api/cadquery-selectors/entity.ts:167]
  → getBoundingBox(face)                                   ← ① wasm trap（首先炸在这）
  → containsPoint(owner, probe)                            ← ② 未实现（修好①后再撞）
```

`">Z"` / `"<Z"` 不用法向（只用面心），`"%PLANE"` 只用 `geomType`，所以三者在原文探针里都"正常"，
掩盖了问题——只有 `|` / `#`（平行/垂直）家族会踩到。

### ① `getBoundingBox` 的 C++ 类型混淆（真 bug）

内核把包围盒拆成三个独立 API，参数 ABI 完全相同、首参类型不同：

- `SmApiBrepBoundingBox(const SmBrep*, bTight, rMin, rMax)`
- `SmApiFaceBoundingBox(const SmFace*, bTight, rMin, rMax)`
- `SmApiEdgeBoundingBox(const SmEdge*, bTight, rMin, rMax)`

`smlibKernel.getBoundingBox` 对**任何**句柄都调 Brep 版。SmFace* 被当 SmBrep* 解引用后
（`pBrep->CalculateBoundingBox()` 读的是 SmFace 的字段），20³ 盒 6 个面实测：

```
face#0 → wasm "memory access out of bounds"（trap）
face#1 → {zmin:20, zmax:0}          ← 倒置盒
face#2 → {ymin:0, ymax:0}           ← 退化盒
face#4 → {zmin:20, zmax:-4.4e-15}   ← 倒置
face#5 → ±1e20                      ← 空盒哨兵
```

不是"内核不支持"，是适配器喂错了 API。

### ② `containsPoint` 缺失（能力缺口）

`smlibKernel.containsPoint` 原是 `unsupported` 桩——SMLib 确实没有点分类 API（`SmApiQueries`
全表 + 227 个 wasm 导出里都没有 containment 查询）。但 L1 契约要求它（`primitives.ts` 注释：
"CadQuery 面法线定向（`Face.normalAt()` 的 outward 探针）需要它"），occt / brepkit 都有。

**GOTCHA（容易踩反）**：不能"直接信 `surfaceNormal` 省掉探针"。smlib 的 `surfaceNormal`
只反映**曲面构造朝向**，不反映材料朝向——实测抽壳结果的内腔面朝向与材料相反
（内壁 x=2 给 −X，occt 给 +X；11 个面里 5 个反）。所以必须真做包含判定。

## 修复（两处，均在 smlib 适配器层，未改 C++ / 未重编 wasm）

`smlib-kernel/smlibKernel.ts`：

1. **句柄种类登记 + 包围盒按种类分派**（`:85` `faceHandles`/`edgeHandles`，`:2148` 分派）：
   `getSubShapes` 枚举面/边时登记（面/边是 brep-owned 借用指针，不释放）；`getBoundingBox`
   按登记表选 `SmApiFaceBoundingBox` / `SmApiEdgeBoundingBox` / `SmApiBrepBoundingBox`。
   未登记句柄按 brep 处理（裸桥直调产出的 brep 走这条；生产路径的面/边一律经 `getSubShapes`）。
2. **`containsPoint` 几何实现**（`:2044`，辅助 `:134` `rayCrossings` / `:165` `PARITY_RAY_DIR`）：
   三角化 + 射线奇偶（固定非轴对齐方向，避面/边双计数），按句柄缓存三角网
   （`WeakMap` 键 = 内核 `memory`，跨内核实例隔离；`disposeHandle` 时清条目防指针复用）。
   compound → 逐零件；面/边句柄 → 显式失败（无"包含"语义，不猜）。

## 修复后实测（双引擎逐值）

| 场景（20³，厚 2） | occt | smlib（修复后） |
|---|---|---|
| `openFaces: ">Z"` / `"<Z"` | 3392 / 3552 / 11 面 | 3392 / 3552 / 11 面 ✅ |
| `openFaces: "|Z"` | 2880 / 3168 / 10 面 | **2880 / 3168 / 10 面** ✅（修复前：wasm trap） |
| `openFaces: "|X"` | 2880 / 3168 / 10 面 | 2880 / 3168 / 10 面 ✅ |

回归测试：

- `packages/tests/faijs/shell/open-face-selector-parity.test.ts` —— 双引擎逐值门禁（含 `|Z` 回归）
- `packages/core/test/smlib-kernel/smlib-shape-kind-queries.test.ts` —— 句柄种类分派、
  `containsPoint` 内/外/壁内、以及"surfaceNormal 不是外向法向"这条 GOTCHA

## 仍未解决（不在本次修复范围）

1. **occt 全封闭抽壳语义**：`shell(solid, [], t)` 退化为 inward offset（见更正一）。要修需在
   occt 侧对"无移除面"另行构造（如 `cut(solid, offset(solid,-t))`），会改动 occt 结果与面演化，
   需单独立项。
2. **`%PLANE`（移除全部 6 面）**：内核返回的 brep 再枚举面得到 `n=1001` 的坏结果
   （`getSubShapes(face): bridge failed`）。这是非法输入（把整个外表面都开掉），应在参数层
   显式拒绝，而不是把坏 brep 交给下游。
3. **圆角 bug**：复核仍未能复现 smlib 侧圆角（与原文一致）。补充线索：`occt-wasm` 的
   `shell(...)` 默认 `JoinType.Arc`（"rounds those edges with a radius equal to `thickness`"，
   `occt-wasm/dist/index.d.ts:166-172`），若真机圆角来自 occt 链路而非 smlib，方向应转到
   该默认 joinType。仍需用户提供真机复现参数才能定案。
