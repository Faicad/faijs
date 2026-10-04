# faijs-cadquery 全量移植路线图 —— 缺口全景 + 由易到难的开发计划

> 日期：2026-10-03
> 状态：**路线图（roadmap）** —— 本文是「还剩什么、按什么顺序做」的**唯一入口**。它取代 `2026-10-03-cadquery-port-decisions-and-backlog.md`（已删除，见 §9）。
> 范围：`packages/faijs-cadquery`（CadQuery 2.8.0 兼容层）及其内核依赖面 `occt-wasm`（经 `packages/core` 暴露）
> 上游基准：CadQuery **2.8.0**（`cq.py` + `out/cache/v2.8.0/tests/`）
> 参考体例：`2026-10-03-cadquery-object-stack-p3-plan.md`（已完成，批次分解 / 捕获纪律 / 验收判据的写法照搬）
>
> 上游源码取证位置：`C:\Users\ylt\cadquery-env\Lib\site-packages\cadquery\cq.py`；上游测试源码缓存于 `packages/faijs-cadquery/out/cache/v2.8.0/tests/`。

---

## 0. 定位与立场（**读这一节就够知道本文和旧文档差在哪**）

1. **唯一排除项有两类**：(a) UI 层可视化发布导出器 `GLTF` / `VTK.js` / `VRML`（共 **7** 条，见 §2.3）；(b) CadQuery 1.x 遗留的插件模式 `Workplane.plugin`（类方法猴补，2.x 已移除，**1** 条，见 §2.3）。两者均**非未来缺口**、明确不支持。`toJSON` 显示协议实际已实现（**ported**），不在此列。**除此之外，本条路线图不写「已决策不做」。**
2. **所有缺口都是要完成的项目。** 差别只在难度与依赖：
   - **本仓可做** ⇒ 排在 B0–B4；
   - **需先扩 occt-wasm 绑定** ⇒ 排在 B6，是**排期问题，不是「不做」**；
   - **需先补子系统**（装配求解器）⇒ 排在 B5。
3. **难度是排序坐标，不是取舍依据。** 「内核依赖」不等于「永远不做」，只等于「本仓单独立项动不了，须与内核迭代绑定」。
4. **每一项都带可执行判据。** 判据要么是「镜像 parity 逐位一致」，要么是「一次性 Python 捕获 → 固化进 TS 断言」（§7）。没有判据的条目不算立项。

---

## 1. 口径（三个数字源 + 实测纪律）

| 口径 | 数字 | 来源（实测） |
|---|---|---|
| **manifest**（导出变量级） | **697 = 496 ported / 146 blocked / 55 skipped** | `tests/manifest.json`（2026-10-04 **B2-7 addCavity** 后实读） |
| **coverage**（上游测试函数级） | **305 = 211 PORTABLE / 41 PORTABLE-WITH-STUB / 45 BLOCKED** | `tests/coverage.json`（2026-10-04 **B2-5** 后重算实读：`portableNow 211` / `portableWithStub 41` / `blocked 45`；B2-7 重算无变化） |
| **镜像文件** | **508** 个 `.fai.js` + **21** 个 `.fai.js.blocked` | `find tests -name "*.fai.js"`（2026-10-04 **B2-7** 后实测） |
| **包内单测** | 589 全绿（54 文件） | 2026-10-04 B2-7 实测 |

⚠ **两个分母不同源，不可换算**：manifest 的 496/146/55（合计 697）是「上游用例全集（变量级）」；coverage 的 305 是「ref manifest 里有 STEP 产物的子集」。

**coverage 已于 2026-10-03（B0-1/B0-4）重算并入库**：199/41/57 → **201/41/55**，只翻 3 条，逐条如下 ——

| case | 变更 | 原因 |
|---|---|---|
| `test_MergeTags` | BLOCKED(`end`) → **PORTABLE** | P3-4 已实现 `end`，旧 coverage 未跟上（B0-2 消账） |
| `test_assembly` | BLOCKED(`traverse`) → **PORTABLE** | `CqAssembly.traverse` 早已实现，但它是**类方法**、不在导出面名单里（B0-4 修 surface） |
| `test_name_geometries` | `addSubshape` → **`plane`** | 同上修 surface 后暴露真正缺口：free `plane()` 构造器（G-C6 / B1-5） |

审计曾预告「重算会翻转 130+ case」——那是 **2026-09-30 的历史事故**（当时把硬编码 surface 换成运行时解析），本次重算在修好的底座上进行，故只有 3 条。

> **B0-4 的 surface 修法（唯一改动）**：`analyze-coverage.py` 的 `CQ_COMPAT_EXTRA` 增补 `addSubshape` / `traverse` 两个 **CqAssembly 类方法名**（类成员不是顶层导出，文本 surface 扫不到）。**`remove` 刻意不加**：`Assembly.remove` 已实现，但 `Shape.remove` 是真缺口（G-C3），而 op universe 是**扁平名字集**——加 `remove` 会错误解锁 `test_shapes::test_remove` / `test_free_functions::test_sewing`。歧义名保持 "missing"（保守 = 诚实），列为建模局限。

⚠ **旧文档的一处硬错误（勿再传播）**：它写「镜像文件 551 个 `.fai.js`」。**实测 464**（`find tests -name "*.fai.js" | wc -l`）。凡引用镜像计数以本文 §1 为准。

**manifest 实测 blockedBy 分布（146 条，48 个 distinct，2026-10-04 **B2-7 addCavity 落地后**从 `manifest.json` 聚合）**：

```
14 op:assembly-solve      11 getfixturevalue         10 pending:mirror            9 kernel:fillet-chain-reapply
 5 interpPlate             5 kernel:sweep-multisection-pipe  5 op:fuzzy-bool        5 raises
 5 remove                  4 kernel:boolean-near-coincident-bspline  4 op:assembly-subshape-import  4 op:extrude-until-face
 4 op:prism-from-face      3 export                   3 filter                     3 kernel:sweep-aux-spine-mode
 3 narrow:sphere-angles    3 op:cutBlind.until-face   3 op:history-subshape        3 op:text-spine
 3 parametrize             2 __dir__                  2 history:images             2 importBin
 2 kernel:draft-existing-solid  2 kernel:hollow-intersection-join  2 kernel:shell-outward-opening  2 op:shell
 2 parametricCurve         2 plane                    2 project
…（其余 17 项各 1 条）
```

> **B2-7（addCavity）对分布的影响（2026-10-04）**：`op:addCavity`(3) 标签 **整个退役**—— free-function `addCavity(s, …cavities)` 已实现（`workplane.ts`，内核无多 shell `MakeSolid.Add`/`ShapeFix_Solid`，用等价布尔 cut 外−腔实现）。3 条 `test_addCavity__{b1,b2,br}` 镜像全 **PASS**（br = vol 7、f12/e24/v16、2 shells，与上游 ref 逐位一致）。
> ⇒ manifest 493/149/55 → **496/146/55**（ported +3、blocked −3），distinct 50 → **48**。
> **顺带的重分类（机器行为、符合预期）**：gen-manifest 按最新 coverage 把「阻塞 op 已实现、只欠镜像」的用例自动翻成 `pending:mirror` —— `plane`(5 条，另 2 条 BY_KEY 保留) 与 `imprint`(4 条) 两个标签清零并并入 `pending:mirror`(1→**10**)。这 9 条就是下一批「写镜像即解锁」的候选清单。

> **B2-5 对分布的影响（2026-10-04）**：`op:shape.offset`(4) 标签 **整个退役**（退役后 0 条）—— free-function `offset(s, t, {cap,both,tol})` 已实现（`workplane.ts`，见 B2-5）。4 条 `test_offset__r{1,2,3,4}` 镜像全 **PASS**（volΔ ≤2.22e-14、comΔ ≤8.24e-18、bboxΔ 0、布尔 0/0，逐位一致）。顺带补 **free-function `plane(w, l)`**（`plane()` 无参的 ±1e60「无限平面」重载**仍不支持、显式报错**）—— 它是 r1 镜像的前置（r1 = `cq.plane(1,1)` 后 `offset`）。**注意**：`plane` 标签（7 条）**未翻转**，因为这 7 条的 `plane` 只是「最后一个未实现 op」，每条**另需** `replace`(4) / `history`(2) / assembly 命名(1)（见 §2.2 G-C3/G-C18/G-D 系列）。
> ⇒ manifest 489/153/55 → **493/149/55**（ported +4、blocked −4），distinct 51 → **50**，blocked 总数 153 → **149**。coverage 函数级同步重算：**201/41/55 → 211/41/45**（+10 PORTABLE，见 §1 表；本次重算一次性消化 B1-13/B2-1/B2-2/B2-3b/B2-5 期间累积的未同步 —— 这几批当时未重跑 `analyze-coverage.py`）。

> **B2-3b 对分布的影响（2026-10-04）**：`op:sweep.pipeshell`(4) 与 `op:sweep.multisection`(3) 两个标签 **整个退役**（退役后两者各 0 条，`op:sweep-*` 只剩 `op:sweep-sketch-sections`(1)，属 testSketch）。分三路：
> ① **r6 / r8 真解锁**（blocked → ported）：二者原被判「需要 pipeShell 路径」，实测**单轮廓路径已能精确复现**——r8（无孔 face）= 线级 `sweep(rect, spline)`（volΔ 3e-12、topo f6/e12/v8）；r6（带孔 face）= 上游 `Solid.sweep(face, path)` 的展开 `sweep(outerWire) cut sweep(innerWire)`（`shapes.py:4638-4655`；volΔ 2e-12、topo f7/e15/v10）。
> ② **r5 / r7 / specialSweep / arcSweep / normalSweep（5 条）→ `kernel:sweep-multisection-pipe`**：多截面 pipe 需要「一次 `MakePipeShell` + 每截面一次 `Add`」（`Solid.sweep_multi`，`shapes.py:4682`），而 occt-wasm **只暴露单轮廓** `sweepPipeShell(profile, spine, …)`（`index.d.ts:169`），无多 `Add` 绑定；`sweepWithLaw` 是「轮廓缩放」另一机制、`loft` 不跟随 spine。实测三条近似全不符（见 §3 B2-3 / mark-blocked.ts）。
> ③ **circletorectSweep（ported → blocked，`kernel:boolean-near-coincident-bspline`）**：cand 几何精确（volΔ 1.13e-5 相对、7 个面面积均在 1e-5 内、topo f7/e15/v10 全中），但 comparator 的布尔交叉检验在近重合 B 样条面上退化（`cut(ref,cand)` = 整个 ref、`common`=0、`fuse`=-2.1e-4）；两个实体各自与外部半盒布尔正常（36.7390/36.7395），把近重合破开（cand 缩放 0.98）后布尔即恢复（4.44）。同 twistExtrude 三条既有条目一类。
> ⇒ manifest 488/154/55 → **489/153/55**（ported +1、blocked −1），distinct 52 → **51**，blocked 总数 154 → **153**。coverage 函数级不变（`test_sweep` / `testMultisectionSweep` 静态分析早已是 PORTABLE / PORTABLE-WITH-STUB，`blockedBy: null`）。

> **B2-3a 对分布的影响（2026-10-04）**：`op:sweep.aux-spine`(3) → **`kernel:sweep-aux-spine-mode`**(3)。**这三条不是「解锁」而是重新定性** —— op 已实现（`sweepOriented` 的 Auxiliary 通道 + `splineWire3D`），但该内核模式与 CadQuery 的 `SetMode(aux, CurvilinearEquivalence=True)`（`occ_impl/shapes.py:4587`）不等价（实测：kernel 17759.16 vs ref 20218.35），且偏离不可检测（仅在导引线重参数化是恒等时偶然相符，如 `test_sweep_aux` 的长度 1 导引线）。故 `sweep(auxSpine=…)` **改为显式报错**（不再静默返回畸变几何）。`normal=`（SweepMode.FixedUp）**已实现并 1e-6 级相符**（vol 3.14159175 / f3/e3/v2），但无独立镜像（上游 `testSweep` 的 `normal=` 变量不是最终 `result`）。manifest 计数不变（488/154/55）、coverage 函数级不变；distinct 50→52 是本节口径按实测更正（原记 50 为陈旧值）。

> **B1-6 对分布的影响**：关掉 `op:extrude.both`(2) / `op:extrude.combine-s`(2) / `op:extrude.combine-cut`(1) 三个标签 ⇒ distinct 67→64、blocked 总数 198→193。

> **B1-7 对分布的影响**：关掉 `op:wedge-degenerate-top`(3) ⇒ distinct 64→63、blocked 总数 193→190、ported 457→460（新增 3 条 `testWedge*` 镜像）。**coverage 函数级不变**（`wedge` 早已 PORTABLE，见 §1 的两个分母不可换算）。

> **B1-3a 对分布的影响**：关掉 `op:Solid.makeCone`(1) / `op:CQ`(1) / `op:polyline`(1，**陈旧标签** —— `Workplane.polyline` 早已存在，缺的只是镜像) ⇒ distinct 63→58、blocked 总数 190→185、ported 460→465（新增 `testCone__s` / `testCone__t` / `testIbeam__res` / `testBoundingBox__result` / `testFindSolid__s` 五条镜像）。`op:Workplane.plugin` 已于 2026-10-04 重分类为 **skipped**（out-of-scope，归 §2.3，类 VTK/GLTF）—— 非未来缺口（其底层 `eachpoint` lambda 仍由 G-C25 跟踪）。

> **B1-13 对分布的影响（2026-10-04）**：关掉 `op:plane-toLocalCoords`(2) —— `Plane.toLocalCoords` / `Plane.mirrorInPlane` **早已实现并导出**（P2 落地），缺的只是两个 `.fai.js` 镜像 ⇒ 陈旧标签，同类 B1-3a。补 `TestCadObjects__testPlaneMethods__{local_box,mirror_box}` 两条镜像，`manifest` ported 468→470、blocked 174→172；**coverage 函数级不变**（`testPlaneMethods` 早已 PORTABLE）。两条均 **PASS**（volΔ=0、comΔ=0、topo f6/e12/v8 全中）。

> **B2-1 对分布的影响（2026-10-04）**：free-function `imprint(*shapes)` 已实现（`workplane.ts`，调 `kernel.fuseAll` —— `BRepAlgoAPI_Fuse` 对非重叠实体与 `BOPAlgo_Builder` 等价：共面合并、不删除 cell）。补 6 条镜像（`test_imprint__{b1,b2,b3,res,res_glue_full,res_glue_partial}`），全 **PASS**（volΔ=0、comΔ=0、topo 全中）。`manifest` ported 470→476、blocked 172→166；`imprint` 标签 12→6（剩 4 条 `test_imprinting` assembly 级 + 2 条 `b1_imp`/`b3_imp` 需 `history:images` G-C18）。**关键发现**：ref STEP 的面计数（f12）与 CadQuery `.Faces()`（f11）不一致 —— STEP 导出保留内面，`.Faces()` 只数外面；cand STEP 同样保留内面，所以 topo 对比仍全中。

> **B2-2 对分布的影响（2026-10-04）**：free-function `solid(*shapes)` + `solidWithInner(outer, inner[])` 已实现（`workplane.ts`）。`solid()` sew 所有面，单 shell 直接 `makeSolid`；多 shell（outer + inner voids）按体积找最大为 outer、boolean cut 其余。`solidWithInner()` 显式 outer + inner，inner 优先用 `wp.baseShape` 获取原始 solid handle 直接 cut（修复球面 sew 返回 Face 而非 Shell 的问题）。补 12 条镜像（`test_solid__{b,b_large,b_small,sphere1,sphere2,b1,s1,s2,s3,s4,s5,s6}`），全 **PASS**（volΔ=0、comΔ=0、topo 全中：s3/s4/s6 f18/e36/v24，s5 f8/e18/v12）。`manifest` ported 476→488、blocked 166→154；`solid` 标签 8→0、`op:solid-voids` 标签 4→0。**关键发现**：① CadQuery `sphere(d)` 参数是**直径**非半径；② `.moved(shape)` 移到 shape 的**中心**（`Location(self.Center())`）；③ `kernel.sew([sphereFace])` 返回 **Face** 而非 Shell，`makeSolid` 无法包装 —— 用 `wp.baseShape` 取原始 solid 绕过。

> **B1-6 对分布的影响**：关掉 `op:extrude.both`(2) / `op:extrude.combine-s`(2) / `op:extrude.combine-cut`(1) 三个标签 ⇒ distinct 67→64、blocked 总数 198→193。

> **B1-7 对分布的影响**：关掉 `op:wedge-degenerate-top`(3) ⇒ distinct 64→63、blocked 总数 193→190、ported 457→460（新增 3 条 `testWedge*` 镜像）。**coverage 函数级不变**（`wedge` 早已 PORTABLE，见 §1 的两个分母不可换算）。

> **B1-3a 对分布的影响**：关掉 `op:Solid.makeCone`(1) / `op:CQ`(1) / `op:polyline`(1，**陈旧标签** —— `Workplane.polyline` 早已存在，缺的只是镜像) ⇒ distinct 63→58、blocked 总数 190→185、ported 460→465（新增 `testCone__s` / `testCone__t` / `testIbeam__res` / `testBoundingBox__result` / `testFindSolid__s` 五条镜像）。`op:Workplane.plugin` 已于 2026-10-04 重分类为 **skipped**（out-of-scope，归 §2.3，类 VTK/GLTF）—— 非未来缺口（其底层 `eachpoint` lambda 仍由 G-C25 跟踪）。
>
> **B1-3a 实测订正（镜像约定，补 B0-6）**：B0-6 记「双终端是 compound 专属」——**不完整**。实测 `let s = <lib 函数产出的裸 Shape>` + `let t = await cq.CQ(s)` 也会导出 **两个终端**（`_0_s.step` + `_1_result.step`），即「被 lib 函数调用消费」不足以把裸 Shape 记为已消费（Workplane 值本来就不是终端，所以链式 Workplane 中间量没问题）。**写法纪律：裸 Shape 一律内联进消费它的调用，不单独 `let`。**（已写进 `TestCadQuery__testCone__t.fai.js` 的 GOTCHA 注释。）
>
> **B1-3a 第二条镜像约定**：`.fai.js` **不接受嵌套 `await` 作实参**（`E_VALUE: unsupported value expression: AwaitExpression`，`lang/metadata-extractor.ts:810`）。链必须摊平成逐句 `let`（Workplane 中间量是安全的），不能写 `cq.mirrorY(await cq.polyline(...))`。（已写进 `TestCadQuery__testIbeam__res.fai.js` 的 GOTCHA 注释。）

> **数据卫生（B0-5 已完成）**：原分布里有 **3 条 `blockedBy` 是整句散文**（2 条 hollow 精度、1 条 Assembly 说明）。已规范化为标签：hollow 两条 → `kernel:hollow-intersection-join`（见 G-F9 / B6-2）；`test_name_geometries__assy` → `plane`（原散文声称「Assembly API 已实现、待写镜像」，经 B0-4 修 surface 后暴露真因是 free `plane()` 缺失，见 G-C6 / B1-5）。manifest 整体只改这 3 行，452/198/47 不变。

---

## 2. 缺口全景（全量清单）

### 2.1 前置状态：**已完成，不要重做**（2026-10-02 ~ 2026-10-03）

| 类 | 内容 | 载体 |
|---|---|---|
| **A** Shape 内省查询子集 | `volumeOf/areaOf/lengthOf/boundingBoxOf/centerOfMassOf/isValidShape/geomTypeOf` + `centerOf/radiusOf/shapeTypeOf` | `src/shape-class.ts` |
| **P1** 度量断言 | 20 用例真值断言 | `src/shape-class.test.ts` |
| **P2** Plane 变换 | `toLocalCoords/toWorldCoords/mirrorInPlane` + 向量形态（16 用例） | `src/plane.ts` |
| **P4** 对象选择器类 | CenterNth/LengthNth/AreaNth/RadiusNth/Box/NearestToShape/And/Sum/Subtract/Inverse（43 用例） | `src/object-selectors.ts` |
| **E1** kind 选择器 | `wiresOf()` + `wires/shells/solids/compounds` 真语义（12 用例） | `src/shape-class.ts` + `kind-selectors.test.ts` |
| **E2** 2D 草图选择器 | `applyStringSelector` 用 `Center()` + 1e-4 簇容差 + 真求交 `and`（18 用例） | `src/sketch.ts` |
| **E3b 可做部分** | `importStep` 走 XCAF（装配名/成员名/颜色/位姿）+ 非装配抛错 + 命名色解析（13 用例） | `src/assembly/save.ts` + `core/src/occt-kernel/stepColorParser.ts` |
| **B** 对象栈模型 | P3-0…P3-4 全完：`objects` 真源、`all/size/first/last/item/end/findSolid/add`、kind/faces/edges/vertices 即时压栈、`split` 双体、`parent` 全链 | `src/workplane.ts` |

> **B 的残留**（P3 明确未做、已登记为独立批）见 §2.2 的 **G-B1…G-B8**——对象栈的**主体**已完成，残留是回填与清理，不是重做。

### 2.2 全部未完成缺口（**这就是「还剩什么」的全集**）

难度标尺：**1**=免费/机械 · **2**=小（单文件小改） · **3**=中（新几何原语，内核已有能力） · **4**=大（结构性/新子系统） · **5**=需先扩 occt-wasm 绑定。

#### 类 A · Shape 类模型剩余面（难度 2–4）

| ID | 缺口 | 影响 | 难度 | 依赖 |
|---|---|---|---|---|
| **G-A1** | `Shape` 剩余 ~74 方法：构造器（`makeBox/makeCylinder/makeCone/makeSphere/makeSolid`）、变换（`transform/translate/rotate/rotateAboutCenter`）、几何操作（`Sections/Shells/CompSolids/fuse/cut/intersect`）、度量距离（`distToShape/distance/largestDimension/matrixOfInertia`） | `matrixOfInertia`/`CombinedCenter`/`largestDimension`/`cast` 等 blocked | 2–4 | 内核已具备原语，逐个暴露 |
| **G-A2** | Shape 域 `Shells()/CompSolids()/Compounds()` 剩余 kind（`wiresOf` 已做） | `CompSolids`/`Shells` blocked（各 1） | 2 | — |
| **G-A3** | `_collectProperty` 的 **Solid→Compounds 特例**（`cq.py:227`） | 上游行为；2.8.0 公开 API 上不可达，但**为完全对齐仍应实现** | 2 | — |

#### 类 B · Workplane / 对象栈遗留（难度 2–4）

| ID | 缺口 | 影响 | 难度 | 依赖 |
|---|---|---|---|---|
| **G-B1** | `findSolid` 回填 **parent 链**（上游默认 `searchParents=True`，`cq.py:721`）；当前只搜当前栈 | 与 P3-3 `baseShape` 机制二选一，不可并存 | 4 | 独立批 |
| **G-B2** | `val()` 空栈返回 `plane.origin`（上游 `cq.py:411`，返回 `Vector`）；faijs 返回 `null` | 需 `Vector` 载体 | 3 | 需新增 `Vector` 类型 |
| **G-B3** | mirror 的 `.all()/.end()/.val()/.vals()` **transpile 映射**（`transpile.ts` 无这些方法） | 当前 mirror 0 处真实调用，但为**双端完整**应补 | 2 | — |
| **G-B4** | 删除 `shape` 派生字段（48 写点 + 140 源码读点 + 跨子路径 assembly 鸭子读者） | 技术债，零功能收益 | 4 | 独立机械批 |
| **G-B5** | `Sketch.push` 留 `Location` 而非顶点（上游 `_select` 里 `isinstance(el, Location)` 跳过） | 2D 草图选后语义 | 3 | 需 G-B2 的 `Location`/`Vector` 面 |
| **G-B6** | `Sketch._selection` 就地可变语义审计（上游就地可变，faijs 需对齐或登记） | 2D 草图栈 | 3 | — |
| **G-B7** | `pushPoints`/`rarray`/`center()` 的 **Vector 入栈**（上游 `size()==3`，faijs 平行数组 `pts` ⇒ `0`） | `size()` 语义差 | 3 | 与 G-B2 同源（需 Vector 载体） |
| **G-B8** | `add(Workplane)` 应 extend **整个源栈**（上游 `extend(obj.objects)`）；faijs 只收源的单代表对象 | 栈长差 | 3 | — |

#### 类 C · 几何 op —— faijs 侧可做（难度 2–3）

| ID | 缺口 | 影响条数 | 难度 |
|---|---|---|---|
| **G-C1** | `imprint`（压印） | **12→6** | 3 ✅ B2-1 |
| **G-C2** | `interpPlate`（插值板） | **5** | 3 |
| **G-C3** | `remove`（移除子形） | **5** | 2 |
| **G-C4** | `project`（边→面投影） | **2** | 3 |
| **G-C5** | `draft`（既有实体拔模，free function） | **2** | 3 |
| **G-C6** | free-function `plane()` 构造器 —— **2026-10-04 B2-5 部分落地**：`plane(w, l)` 已实现（`workplane.ts`，= `face(rect(Workplane('XY'), w, l))`）；`plane()` **无参**的 ±1e60「无限平面」重载**明确不支持、显式报错**（内核无对应原语）。⚠ **manifest `plane` 标签 7 条一条未翻转**——该标签只是「最后一个未实现 op」，每条各自**另需** `replace`(4)/`history`(2)/assembly 命名(1)（r1 镜像已用上 `plane(w,l)`） | **6** | 2 |
| **G-C7** | `prism` tilt（非法向挤出，1）+ from/to-face（4，见 G-F11） | **5** | 3 |
| **G-C8** | `solid(...)` 内 void 缝合（4）+ `Solid.addCavity`（3） | **7→0 ✅** | 3 ✅ B2-2（solid 4）+ B2-7（addCavity 3，等价布尔 cut，内核无多 shell `MakeSolid.Add`） |
| **G-C9** | `sweep` pipeshell / multisection / ~~aux-spine~~ —— **2026-10-04 B2-3b 全量定性**：r6/r8 单轮廓已解锁（**portable**）；r5/r7 + special/arc/normalSweep 共 5 条是**多截面 pipe**（内核无多 `Add` 绑定）→ 移 B6-11；aux-spine 移 B6-10（内核 Auxiliary 模式 ≠ CadQuery `SetMode(aux, CV=True)`） | **0**（+3+5 内核） | 3 |
| **G-C10** ✅ **已闭（B1-6, 2026-10-03）** | ~~`extrude` 的 `both=`（2）/ `combine="cut"`（1）/ `combine="s"`（2）~~ | ~~**5**~~ **0** | 2 |
| **G-C11** | `extrude("next"/"last")` until-face（4）+ `cutBlind.until-face`（3）+ 索引选择器 `faces(">X[1]")` | **7** | 3 |
| **G-C12** | ~~`shape.offset`（4）~~ ✅ **已关 2026-10-04（B2-5）**；剩 `offset2D` multi-region（1） | **5→1** | 3 |
| **G-C13** | `parametricCurve`（2）+ `parametricSurface`（1） | **3** | 3 |
| **G-C14** | ~~`cutEach`~~ ✅ **已关 2026-10-03（B1-8）** | **3→0** | 2 |
| **G-C15** | `hollow`（closed / 带移除面） | **3** | 3 |
| **G-C16** | `text` spine 重载（3）+ `faceOn`（1） | **4** | 3 |
| **G-C17** ✅ **已关 2026-10-03（B1-7）** | `wedge` 退化顶面（`op:wedge-degenerate-top`）—— `xmin==xmax && zmin==zmax` 时底环 → 顶点 loft（`loftWithVertices`） | **3→0** | — |
| **G-C18** | `History` 子形状反查（`op.generated/first/last`） | **3** | 3 |
| **G-C19** | Shape **运算符重载**（`faces(">Z") \| faces("<Z")`）—— ⚠ **2026-10-03 实测订正**：JS 无运算符重载，`.fai.js` 是 JS 子集 ⇒ 需要 core `lang/` 语法层扩展（非本仓单独立项）；且 `test_set_ops` **只断言 `.size()`**（非几何），parity 本就无法验证它 ⇒ **保持 blocked，不写 stub 镜像**（与 `importBin` 的几何锚点 stub 同样处理：不冒充 ported） | **1** | 4（core） |
| **G-C20** | 零散 free：~~`Solid.makeCone`~~ / ~~`CQ()` 包装~~ / ~~`Workplane.polyline`（陈旧标签）~~（**三项已关 2026-10-03 B1-3a**）/ `Workplane.plugin`（CadQuery 1.x 遗留，`Workplane.plugin` 方法 2.x 已移除；明确不支持，归 §2.3 排除，类 VTK/GLTF）/ free `threePointArc`（待判） | **5→1** | 2 |
| **G-C21** | IO：`importBrep`（5）/ `importBin`（2）/ `export`（native BREP + STL 变体；**VRML/GLTF/VTK.js 归 §2.3 排除**） | **12** | 2 |
| **G-C22** | `sweep-sketch-sections`（1）+ `extrude-taper-sketch`（1） | **2** | 3 |
| **G-C23** | `shell`（`op:shell` 2）+ `pendingWires` 多轮廓（1） | **3** | 3 |
| **G-C24** | `CombinedCenter`（1）/ `filter`（3）/ `matrixOfInertia`（1）/ `cast`（1）/ `largestDimension`（1）/ `consolidateWires` | **8** | 2 |
| **G-C25** | `eachpoint` **lambda 形态**（对象形态已实现；`.fai.js` 无函数字面量需语法支持）—— **2026-10-03 归并**（plugin 已于 2026-10-04 移出，归 §2.3 排除）：`op:eachpoint`（`testCompoundCenter__s`）、`narrow:cutEach` 的 lambda 形态、`narrow:filter`（`test_special`）**三条同源**——都要「函数字面量」，同属 `.fai.js` 语法扩展长线 | **3** | 4 |
| **G-C26** | `narrow:sphere-angles`（3）+ `narrow:chamfer-asym`（1）：参数未打通（faijs 侧，待判定） | **4** | 2 |
| **G-C27** | **Assembly 子路径导入被自动装载成根包命名空间**（`test_toCompound__assy1` / `__c3`）：镜像 specifier 正确（`@faicad/faijs-cadquery/assembly`），但 core `lang/metadata-extractor.ts:145` 的 `derivePackageName()` **丢掉子路径**（`@faicad/faijs-cadquery/assembly` → `@faicad/faijs-cadquery`）；`runtime.autoLoadLibsFromImports`（`cad-runtime/runtime.ts:1212`）遂 `loadLib(packageName)` 装载**根包** ⇒ 运行时 `cqa.constraint is not a function`（root 不导出 assembly API）。**根因在 core，改 core 需授权**；**非「陈旧 dist」**——`dist/assembly/index.js` 确实导出 `constraint` 且是新鲜产物（B0 期间误判，2026-10-03 实测证伪）。 | **2** | 3 |

#### 类 D · 装配（难度 4–5）

| ID | 缺口 | 影响 | 难度 | 依赖 |
|---|---|---|---|---|
| **G-D1** | **装配约束求解器**（`op:assembly-solve`：PointOnLine / 表达式语法 Point / tag 选择 / FixedAxis / unary） | **14** | 4 | 自研 pure-TS 全局 NLP 求解器 |
| **G-D2** | STEP **子形状 name/color/layer** 读回（`op:assembly-subshape-import`） | **4** | 5 | `XCAFDocument` 需补 `ShapeTool.GetSubShapes`/`LayerTool` |
| **G-D3** | **导出侧写装配结构**（无几何装配 label） | — | 5 | `XCAFDocument` 需补 `NewShape`/`AddAssembly` |
| **G-D4** | `raises` 错误路径（重名/空 solve/非法约束/无几何断言）—— 需 harness 支持 `pytest.raises` | **5** | 3 | harness |
| **G-D5** | `test_toCompound` 系列 **4 条 parity FAIL**（`assy0` / `c1` / `c2` / `nested_assy`）：此前因双终端**从未配对**（一直 BLOCKED），B0-6 修好导出后暴露真实几何不符（vol Δ 61%、centroid Δ 1.3–8.4、bbox Δ 4–15）。B0-6 新暴露 | **4** | 4 | 装配 loc 链 / `toCompound` 语义 |

#### 类 E · harness / 镜像框架（难度 3–4）

| ID | 缺口 | 影响 | 难度 |
|---|---|---|---|
| **G-E1** | `getfixturevalue`（pytest fixture 反射） | **11** | 4 |
| **G-E2** | `parametrize` | **3** | 3 |
| **G-E3** | `__dir__`（反射式用例） | **2** | 3 |
| **G-E4** | `fixture` 机制 | **1** | 4 |
| **G-E5** | `pending:mirror` 残量 + 镜像框架 `compare-targeted` 对 compound 的读取（双终端残留已由 **B0-6 收口**：畸形产物 0 + 守卫测试） | **2** | 2 |

#### 类 F · 内核依赖（需先扩 occt-wasm 绑定；难度 5，但**都是项目**）

| ID | 缺口 | 影响 | 需补的绑定 |
|---|---|---|---|
| **G-F1** | `shell` 外向开口（2）+ shell 交并（1） | 3 | `MakeThickSolidByJoin` intersection-join offset |
| **G-F2** | `draft` 既有实体拔模 | 2 | `BRepOffsetAPI_DraftAngle` 对已有 solid |
| **G-F3** | `loft` 共面截面 | 1 | `BRepOffsetAPI_ThruSections` 参数（C2/一致性检查） |
| **G-F4** | 近重合 B-spline 布尔（扭曲体 cut/union；**+ circletorectSweep 多截面 sweep 的直纹/平滑过渡面**） | **4** | 布尔容差通道 / 稳健化 |
| **G-F5** | 高椭圆（major<minor 拒绝） | 1 | `gp_Elips` 参数构造 / 轴重定向 |
| **G-F6** | 多边形 cutThruAll 崩溃 | 1 | `makePolygonPrismAt` 崩溃根因 |
| **G-F7** | fillet 对 fillet 产出再 fillet 被拒 | **9** | kernel fillet 的 TopoDS 接受面 |
| **G-F8** | STEP 写出 B-spline wire 精度退化 | 1 | STEP writer 保真 |
| **G-F9** | `hollow(t>0)` 精度（arc-join vs intersection-join） | 2 | 同 G-F1 |
| **G-F10** | `prism` from/to-face | 4 | `BRepFeat_MakePrism`（~80 行绑定） |
| **G-F11** | `chamfer` **非对称双距离**（`narrow:chamfer-asym`，`testChamferAsymmetrical__cube`）—— 2026-10-03 实测定性：上游走 `BRepFilletAPI_MakeChamfer.Add(d1, d2, edge, face)`（`occ_impl/shapes.py:4011-4022`，逐 edge 配 edge→face 映射表），occt-wasm 只暴露 `chamfer(distance)` 与 `chamferDistAngle(distance, angleDeg)`，**没有双距离通道** ⇒ 属内核绑定缺口，不是 faijs 侧参数没打通 | 1 | `BRepFilletAPI_MakeChamfer::Add(d1,d2,E,F)` + edge→face map |
| **G-F12** | **多截面 pipe shell**（`kernel:sweep-multisection-pipe`）—— 2026-10-04 B2-3b 定性：上游 `Solid.sweep_multi`（`occ_impl/shapes.py:4682`）建**一个** `BRepOffsetAPI_MakePipeShell(spine)` 后**每截面 `Add(section, False, False)` 一次**；occt-wasm 只暴露**单轮廓**包装 `sweepPipeShell(profile, spine, freenet?, smooth?)`（`index.d.ts:169`），无多 `Add` 绑定（`sweepWithLaw` 是轮廓缩放另一机制，`loft` 不跟随 spine）。实测 loft / 单轮廓 / per-section-fuse 三种近似全不符（见 §1 B2-3b 注） | **5** | 暴露多截面 `Add`（`BRepOffsetAPI_MakePipeShell::Add` × N + `Build`/`MakeSolid`） |

#### 类 G · ref 侧异常（**不是 faijs 缺口**，但需重新推导镜像）

| ID | 项 | 处置 |
|---|---|---|
| **G-G1** | `op:extrude-until-face` 的 ref 与源码直读不符（`wp_ref` 实测 s3/vol 2125 vs 应为 s2/2000） | 补 op 后**重新推导镜像**（不可照源码写） |
| **G-G2** | `ref:degenerate-compound-vertex`（`test_loft_to_vertex__c` 的 ref 是退化 compound，comparator 布尔探针失败） | 需 comparator 支持非 solid 度量 |
| **G-G3** | `testText__obj1` / `test_history_sweep__res` ref 异常（ref 是纯盒） | 已按 ref 冻结，注释钉死；不需动 |

### 2.3 唯一排除项（**两类**）

| 项 | 影响 | 理由 |
|---|---|---|
| `GLTF` / `VTK.js` / `VRML` 可视化导出器 | manifest **7** 条：VTK.js 3（`test_vtkjs_export` / `test_save_vtkjs` / `test_export_vtkjs`）、glTF 3（`test_save_gltf__nested_assy_sphere` / `test_exportGLTF__nested_assy_sphere` / `test_save_gltf_boxes2`）、VRML 1（`test_vrml_export`） | 它们是上游 **Assembly 的可视化发布导出器**，是「看图」出口而非建模能力。faijs 侧 UI 预览走**更轻量**的幽灵渲染/叠加层，不依赖导出几何。内核也**并非做不到**（`occt-wasm` 有 `XAFDocument.exportGLTF()`），**不做的理由是「没有需求」**。 |
| `Workplane.plugin` / CadQuery 插件模式（类方法猴补 + `eachpoint` lambda） | manifest 1 条（`testCylinderPlugin__s`） | CadQuery 1.x 遗留 API（`Workplane.plugin` 方法在 2.x 已彻底移除）。上游 `testCylinderPlugin` 仅演示「给 `Workplane` 类动态挂自定义方法、内部调 `eachpoint`」的扩展模式——并非独立建模能力。faijs 不提供类猴补/函数字面量通道（`.fai.js` 是 JS 子集、无 lambda），且此模式无需求 ⇒ **明确不支持，非未来缺口**。底层 `eachpoint` lambda 能力仍由 G-C25 / `testCompoundCenter__s` 跟踪。 |

> **边界说明**：`export`（blockedBy=`export` 现剩 3 条：`native_export` / `save_stl_formats` / `export_errors`）里含 **native/BREP** 与 **STL 变体** —— 这两类是**建模数据出口，不是 UI 层**，**保留为待办**（见 G-C21）。其中的 **VRML/GLTF/VTK.js 共 7 条**已重分类为 `skipped`，归本条排除。

---

## 3. 由易到难的开发计划（B0 → B6）

> **批次纪律（照搬 P3）**：每批独立 commit、独立测试、独立可停。**任一批验收不过就停在本批，不进下一批**。每批开工**先跑一次性 Python 捕获**（§7），**捕获若推翻本表结论，以捕获为准并回写本表**（这是 P3 三次「捕获推翻方案假设」换来的纪律）。

| 批 | 主题 | 难度 | 规模 | 预期解锁 | 依赖 |
|---|---|---|---|---|---|
| **B0** ✅ | 尺子与免费增量（**已完成 2026-10-03**） | 1 | 小 | coverage 重算 201/41/55 + 散文归零 + 畸形产物归零 | — |
| **B1** | 小粒度 op（单文件，无新原语） | 2 | 中 | ~40 条 | B0 |
| **B2** | 中粒度几何 op（内核已有原语） | 3 | 大 | ~60 条 | B1 |
| **B3** | 结构性收口（Shape 类模型 + 栈残留） | 4 | 大 | Shape 面 + 栈对齐 | B2 |
| **B4** | harness 增强（框架机制） | 3–4 | 中 | ~22 条 | B1 |
| **B5** | 装配（求解器 + 子形状元数据 + 导出结构） | 4–5 | 特大 | 14 + 4 + 1 | B4 |
| **B6** | 内核依赖（occt-wasm 绑定补齐） | 5 | 特大 | ~26 条 | 内核迭代 |

> B1/B2/B4 之间**无强依赖**，可按人手并行；B3 依赖 B2（先补 Shape 值面再做结构性删除）；B5/B6 是长线。

---

### B0 · 尺子与免费增量（难度 1）—— **已完成 2026-10-03**

| 序 | 项 | 结果 | 证据 |
|---|---|---|---|
| **B0-1** | **重算 `coverage.json`** | ✅ 已重算并入库：199/41/57 → **201/41/55**（只翻 3 条，见 §1 表） | `tests/coverage.json` 顶层标量；与 `git show HEAD:` 版逐条 diff |
| **B0-2** | `end` 消账 | ✅ `test_MergeTags` 自然由 BLOCKED(`end`) → PORTABLE，`end` 从 `blockedByTop`/`missingOpTop` 消失 | coverage diff |
| **B0-3** | `pending:mirror` 真·纯几何残量 | ⏸ **未做**（本次未触及，仍是 B1 的独立项） | — |
| **B0-4** | **导出面 vs 实现面差集** | ✅ workplane.ts ↔ index.ts 差集 = `{asBrepShape, dispose}`，**两者都是 faijs 内部机制**（上游无对应），导出反而污染兼容面 ⇒ 不动。**另发现**类方法不在 surface：`CqAssembly` 的 `addSubshape`/`traverse` 已实现却判 missing ⇒ 补进 `CQ_COMPAT_EXTRA`（`remove` 因同名 `Shape.remove` 缺而**刻意不加**） | `analyze-coverage.py` `CQ_COMPAT_EXTRA`；coverage 翻转 2 条 |
| **B0-5** | 数据卫生 | ✅ 3 条散文 `blockedBy` → 标签（2× `kernel:hollow-intersection-join`，1× `plane`）。走 `mark-blocked.ts` 的 `BY_KEY` 写入口，`gen-manifest` 重跑，manifest 只改这 3 行 | `manifest.json` diff = 3 行；散文计数 0 |
| **B0-6** | 双终端/命名残留核查 | ✅ **畸形产物归零**（删 44 个遗留 + 修 25 个镜像 + 修 2 个旧包名引用 + 加守卫测试）。**但新暴露 6 条既有缺陷**（见 G-C27 / G-D5） | `ls out/cand \| grep -c '\.step_[0-9]'` = **0**；守卫测试 `src/mirror-export-convention.test.ts`（含变异验证） |

> B0-1/2/4/5 是**先修尺子**：后续所有度量都基于它。B0-6 破了「不夹带代码改动」的初衷——它必须改镜像才能达成「畸形产物 0」，改动范围已限定在 `tests/**/*.fai.js` 与一个新测试。
>
> **双终端根因（实测 2026-10-03，非猜测）**：`core/src/cad-runtime/live-shapes.ts` 的 `lineConsumes` 是**名字/入参驱动**，`let r = <compound 变量>` 这种裸别名**不**把该 compound 记为「已消费」⇒ 同名两终端各写一个 `_<i>_<name>.step`。受控探针：compound 形态 2 个产物，shape 形态 1 个产物 ⇒ 规则是 **compound 专属**，不是「禁一切别名」。**修在镜像侧（内联 producer）**；core 侧未动（需授权）。

---

### B1 · 小粒度 op（难度 2；单文件、单测友好、影响面小）

> **⚠ 开工前实测订正（2026-10-03，读上游 `out/cache/v2.8.0/tests/*.py` + 内核 `primitives.ts` / `occt-kernel/*` 面）**：本表原由「coverage `blockedByTop` 计数」推导，**未逐项核全链路可行性**，开测即推翻多处：
> 1. **「解锁」= 实现 op + 新写 mirror**（实测：452 ported **全部有镜像**、198 blocked **全部无镜像**，逐条 `existsSync(mirrorPath(key))`）⇒ 只补 API 而镜像不变，parity **零变化**。
> 2. **`remove` / `replace` 是内核依赖**：上游用 `BRepTools_ReShape`（`occ_impl/shapes.py:1892` / `:1872`），faijs 内核层（`brep/engine/primitives.ts` + `occt-kernel/*`）**未暴露** ⇒ 应移 B6（或用 `getSubShapes + sew` 近似，须 parity 验证）。**B1-4 与 B1-5 的 `replace` 部分据此下修。**
> 3. **`narrow:sphere-angles` 是内核依赖**：`workplane.ts:1099` 已注明 partial sweep 无法由 `cad.sphere` 原语表达 ⇒ 按 B1-10 预置二分支**移 B6**。
> 4. **`cutEach`（B1-8）/ `filter`（B1-2 的 `test_special`）/ `solid` 带 `inner`（B1-2）需 `.fai.js` 没有的 lambda 或多 op 组合** ⇒ 实际门槛高于「难度 2」。
> 5. **B1-1 口径错**，见下行。

> **✅ B1-6 已完成（2026-10-03，本批第一个落地项）**：`extrude(wp,h,combine,{taper,both})` — `combine∈{cut,s}` 委托 `cutBlind`、`both=True` 从 ±h 两平面各挤 h 再 fuse；`cutBlind` 补 `depth<0` 沿 −normal 的方向号规则。5 条镜像 `testExtrude__{s,wp_ref,wp,wp_ref_regular_cut,r}` + 6 单测 + 4 变异全绿；manifest **452→457 ported / 198→193 blocked**，coverage 函数级 **不变**（`testExtrude` 早已 PORTABLE，见 §1）。

按「一次导出/一次小原语就能解锁多条」排序：

| 序 | 项 | 影响 | 动作要点 |
|---|---|---|---|
| **B1-1** ⚠ **2026-10-03 二次订正（无 ref ⇒ 不进 parity）** | ~~**G-C21 IO 通道**~~：① `out/ref/` 里**没有** `test_bin_import_export` 的参考 STEP（实测 `ls out/ref \| grep -i bin_import` = 0 条）⇒ 这 2 条**永远无法配对**，补镜像也不产生 parity 信号；② 真阻塞是内核只暴露 `loadCached(brepString)`（读）而**没有 BREP 字节写出通道**（occt-wasm 只 `exportStep`/`exportStl`），且 `.fai.js` 无文件 IO ⇒ 端到端 importBin 需要内核补「写出」绑定；③ `importBrep` 标签实测 0、`export` 5 条归 B5/§2.3（同前）⇒ **净收益 0，本项降为「内核依赖 + 无 ref」，从 B1 移出**（保留 `importBin` 标签） | **2→0（不进 parity）** | 内核 `BRepTools` 写出绑定 |
| **B1-2** | **G-C24 零散值面**（filter 3 / CombinedCenter 1 / matrixOfInertia 1 / cast 1 / largestDimension 1 / consolidateWires） | 8 | 多为 Shape 域小函数 + Workplane 镜像 |
| **B1-3** ✅ **B1-3a 已完成 2026-10-03** | **G-C20 零散 free**（Solid.makeCone / CQ / Workplane.plugin / free threePointArc / free polyline）—— **B1-3a**：① `solidMakeCone(radius1, radius2, height)`（走内核 `makeCone`，因 core `cad.cone` 断言 `radiusBottom>0`、拒绝上游允许的「底半径=0」；`radius1` 是**底**半径，ref 质心 z=1.5 是判据）+ ② `CQ`（上游 `CQ = Workplane` 别名，`cq.py:4565`，`CQ(s)` = 以 s 为栈的 XY workplane，`parent=null`）⇒ `testCone__s` / `__t` 双 PASS；③ `op:polyline` 是**陈旧标签**（`Workplane.polyline` 早已存在，缺的是镜像）⇒ 补 `testIbeam__res`，**PASS-NT**（几何逐位一致 vol 5800 / 布尔差 0，镜像轴上有未愈合接缝：cand f15/e39/v26 vs ref f14/e36/v24）；④ `op:threePointArc` **同为陈旧标签** ⇒ 补 `testBoundingBox__result`（25 步摊平链），**PASS**（vol 13234.9225135，topo f26/e72/v48 全中）；⑤ `op:findSolid` **亦是陈旧标签**（P3 起已导出）⇒ 补 `testFindSolid__s`，**PASS**（两未合立方体的 compound，vol 2 / f12/e24/v16/s2）。7 单测 + 3 变异全绿。**剩余 1 项**：free `threePointArc`（待判）；`Workplane.plugin` 明确不支持、已归 §2.3 排除（类 VTK/GLTF），非未来缺口 | 5→**1** | 自由函数构造器 + 类式包装 |
| **B1-4** | **G-C3 remove** ⚠ **内核依赖**：上游 `Shape.remove` 用 `BRepTools_ReShape`（faijs 内核未暴露）⇒ 移 **B6**（或用 `getSubShapes + sew/compound` 近似后跑 parity；`test_remove` 需 `innerShells()`） | 5 | 见 B6 |
| **B1-5** | **G-C6 free `plane()`** | 6 | 自由函数平面构造器（`plane(1,1)`） |
| **B1-6** ✅ **已完成 2026-10-03** | **G-C10 extrude 变体**（both 2 / combine-cut 1 / combine-s 2）—— `extrude(wp,h,combine,{taper,both})`：`combine∈{cut,s}` 委托 `cutBlind`（cq.py:3063-3065）、`both=True` 从 ±h 两平面各挤 h 再 fuse（cq.py:3788-3792）；`cutBlind` 补方向号规则（`depth<0` 沿 −normal，cq.py:3526-3528）。5 条镜像（`testExtrude__{s,wp_ref,wp,wp_ref_regular_cut,r}`）+ 6 单测 + 4 变异全绿 | 5→**0** | 消费面参数通道 |
| **B1-7** ✅ **已完成 2026-10-03** | **G-C17 wedge 退化顶面** —— `xmin==xmax && zmin==zmax` 时改走「底环 → 顶点」loft（`loftWithVertices` = `BRepOffsetAPI_ThruSections::AddVertex`），产出 5 面四棱锥。**连带修 pre-existing CLI bug**：楔体把内核自建的 solid 喂给 `cad.translate`，在 CLI 的 `autoLift:false` 宿主下被 N1 守卫拒绝（`E_TOPO_UNTRACKED_INPUT`）⇒ 改内核级 `translateBrep`。3 条镜像（`testWedge{Defaults,PointList,Combined}__s`）+ 2 单测 + 3 变异全绿 | 3→**0** | 消费面几何构造 |
| **B1-8** ✅ **已完成 2026-10-03** | **G-C14 cutEach** —— 对象形态 `cutEach(wp, item, {clean})`（lambda 形态不可达，同 G-C25）：上下文实体取 `wp.baseShape ?? findSolid(wp)`（上游靠 `findSolid(searchParents=True)` 穿过 `vertices()` 收缩，faijs 的 `findSolid` 只读当前栈 ⇒ 用 P3-3 的 `baseShape` 当替身；无实体时照上游抛错）；逐 locus 放置 item 并切掉（等价于上游一次性 `cut(*results)`）。**连带抽出 `eachpointLocations` / `translateHandle` 两处 helper**（`eachpoint` 复用，39 条 `object-stack.test.ts` 冻结断言不变）。3 条镜像（`testCutEach__w` / `__c` = 两个基础立方体、`__w0` = 真切割结果 vol 4）+ 3 单测 + 2 变异全绿 | 3→**0** | 逐子形切割 |
| **B1-9** ✅ **已判定 2026-10-03（结论=不做，理由见 G-C19）** | **G-C19 运算符重载** —— JS 无运算符重载（需 core `lang/` 扩展）+ 该用例只断言 `size()` ⇒ **保持 blocked 且不写 stub**；从 B1 移出，与 G-C25（lambda）同归「`.fai.js` 语法扩展」长线 | 1→**0（保持 blocked）** | — |
| **B1-10** ✅ **已判定 2026-10-03（结论=移 B6）** | **G-C26 narrow 参数**（chamfer-asym 1）—— ⚠ `sphere-angles`（3）已定性内核侧（`workplane.ts:1099`）；chamfer-asym **本日读源码定性也是内核侧**：上游 `BRepFilletAPI_MakeChamfer.Add(d1,d2,E,F)`（`occ_impl/shapes.py:4011-4022`），occt-wasm 只有 `chamfer(d)` / `chamferDistAngle(d,angle)`，**无双距离通道**（`workplane.ts:5312` 的显式抛错是正确终态）⇒ 整项移 **B6-9 / G-F11**，本批**无剩余** | 1→**0** | — |
| **B1-11** | **G-B3 mirror transpile 映射** | — | `.all()/.end()/.val()/.vals()` 进 `transpile.ts`（即便当前 mirror 0 处，为双端完整） |
| **B1-12** | **G-A2/G-A3 Shape 域 kind + `_collectProperty` 特例** | 2 | `Shells()/CompSolids()/Compounds()` + Solid→Compounds 特例 |
| **B1-13** ✅ **已完成 2026-10-04** | **陈旧标签：`Plane.toLocalCoords` / `Plane.mirrorInPlane`** —— 两个 API 早已实现（`src/plane.ts`）并导出（`src/index.ts`），P2 已 probe 验证；`testPlaneMethods__{local_box,mirror_box}` 只是缺 `.fai.js` 镜像。补镜像 + `plane.ts` 加 Workplane/mesh-`Shape` 入参重载（`.fai.js` runtime 只产 mesh-backed Workplane，裸 handle 路径会 "Invalid shape ID: 0"）。2 条镜像 **PASS**（volΔ=0 / comΔ=0 / topo f6/e12/v8）；2 单测 + 变异（`boxCorner` 翻轴断言）全绿。 | **2→0** | — |

**B1 验收**：每项配单测（先红后绿）+ 变异测试（回退即红）；镜像项 parity 逐位；门禁全过（§4）。

---

### B2 · 中粒度几何 op（难度 3；内核已有原语，需新组合）

| 序 | 项 | 影响 | 动作要点 |
|---|---|---|---|
| **B2-1** | **G-C1 imprint** ✅ | 12→6 | 已落地 2026-10-04：`fuseAll` 实现 free-function `imprint`，6 变量镜像全 PASS；剩 4 条 assembly-imprint（B5）+ 2 条 `history:images`（G-C18） |
| **B2-2** | **G-C8 solid voids** ✅ | 7→0 | 已落地 2026-10-04：`solid()` + `solidWithInner()` 实现 free-function solid（sew + boolean cut 内 void），12 变量镜像全 PASS（B2-2）；`addCavity` 3 条由 **B2-7** 收官（等价布尔 cut，ref vol 7 / f12 / 2 shells 逐位复现） |
| **B2-3** | **G-C9 sweep 族**（pipeshell 4 / multisection 3 / aux-spine 3） —— ✅ **2026-10-04 B2-3b 收官：本仓可做项已清零**。① **r6 / r8 解锁**（单轮廓路径已够：r8 = `sweep(rect, spline)`；r6 = 上游 `Solid.sweep(face)` 的展开 `sweep(outer) cut sweep(inner)`，均 1e-12 级相符）；② **r5 / r7 / special / arc / normalSweep（5 条）改判内核依赖 B6-11**（多截面 pipe 无多 `Add` 绑定，实测 loft/单轮廓/per-section 三种近似全不符）；③ **circletorectSweep 按近重合布尔约定改判**（cand 几何精确到 1.13e-5，comparator 布尔退化）；④ aux-spine 已于 B2-3a 改判 B6-10（`sweep(auxSpine=…)` 现显式报错，`normal=` 已实现并单测锁定） | 10 → **0** | — |
| **B2-4** | **G-C2 interpPlate** | 5 | 插值板（点云 → 曲面片） |
| **B2-5** ✅ **已完成 2026-10-04** | **G-C12 offset**（~~offset2D multi-region 1~~ / ~~shape.offset 4~~）—— free-function `offset(s, t, {cap, both, tol})` 已实现（`workplane.ts`）：对栈上每个 **Face/Shell** 调内核 `thicken(h, t, tol)`；`opts.both` = `fuse(thicken(+t), thicken(−t))`；多元素包 `makeCompound`；`cap:false` 与「非 Face/Shell」显式报错。**关键实证（推翻 §7 旧记）**：内核 `thicken` 与上游 `Shape.offset(t)` **逐位等价** —— `plane(1,1)` vol 1 / `box.shells()` −0.25 → vol 0.875(f12) / `both` → vol 2(f10) / `moved` compound → vol 4(f20)，四条 ref 全复现。顺带补 free **`plane(w,l)`**（G-C6 部分落地，r1 的前置）。4 条镜像 `test_offset__r{1,2,3,4}` 全 **PASS**（volΔ ≤2.22e-14、comΔ ≤8.24e-18、bboxΔ 0、布尔 0/0）+ 7 单测 + 2 变异全绿。**剩 `offset2D` multi-region 1 条**（需 `MakeOffset2D` 多区域分裂语义，本批未做） | 5→**1** | ~~`MakeOffset2D` 多区域分裂语义 + `BRepOffset_MakeOffset`~~ **实际只需内核 `thicken`**（offset2D 残条才需 `MakeOffset2D`） |
| **B2-6** | **G-C11 until-face 族**（extrude 4 / cutBlind 3 / 索引选择器） | 7 | `extrude("next"/"last")` + `faces(">X[1]")` 索引；**G-G1 的 ref 异常需重新推导** |
| **B2-7** | **G-C23 shell / pendingWires** | 3 | `shell` 带移除面 + 多轮廓 pendingWires（上游构造 rect 内孔 = 10 面） |
| **B2-8** | **G-C5 draft + G-C4 project + G-C18 History** | 6 | draft 既有实体 / 边→面投影 / History 子形状反查 |
| **B2-9** | **G-C13 parametricCurve / parametricSurface** | 3 | 参数曲线/曲面构造 |
| **B2-10** | **G-C16 text-spine + faceOn** | 4 | 沿 spine 排字 + 球面刻字 |
| **B2-11** | **G-C15 hollow + G-C22 sweep-sketch-sections / extrude-taper-sketch** | 5 | hollow 闭合/带移除面；sketch 截面 sweep（xDir 全帧） |
| **B2-12** | **G-C7 prism tilt**（from-face 见 B5/内核） | 1 | 非法向方向挤出 |

> **每项开工前先一次性 Python 捕获**（§7）：`imprint`/`sweep`/`offset` 的语义细节极易凭印象写错（P3 三次踩中）。

---

### B3 · 结构性收口（难度 4；Shape 类模型完整化 + 栈残留）

| 序 | 项 | 难度 | 动作要点 |
|---|---|---|---|
| **B3-1** | **G-A1 Shape 剩余 ~74 方法** | 4 | 按四组拆：①构造器 ②变换（transform/translate/rotate/rotateAboutCenter）③几何操作（Sections/Shells/CompSolids/fuse/cut/intersect）④度量距离（distToShape/distance）。**必须再拆批**，逐组一次性捕获 → TS 断言 |
| **B3-2** | **G-B1 `findSolid` 回填 parent 链** | 4 | 与 P3-3 `baseShape` 机制**二选一**；改它会翻 `object-stack.test.ts` 冻结断言 ⇒ 独立批 + 全量 parity |
| **B3-3** | **G-B2 + G-B7 Vector 载体 + Vector 入栈** | 3 | 新增 `Vector` 类型（`src/index.ts` 当前无导出）⇒ `val()` 空栈返回 `plane.origin`、`pushPoints` 入栈 Vector（`size()` 对齐上游 3） |
| **B3-4** | **G-B5 + G-B6 Sketch.push / `_selection` 语义** | 3 | push 留 `Location`（依赖 B3-3）；`_selection` 就地可变审计 |
| **B3-5** | **G-B8 `add(Workplane)` extend 整个源栈** | 3 | 对齐 `cq.py:387` 的 `extend(obj.objects)` |
| **B3-6** | **G-B4 删除 `shape` 派生字段** | 4 | 48 写点 + 140 源码读点 + 跨子路径 assembly 鸭子读者 + 49 测试读点；**机械改写 + 全量 parity 兜底** |
| **B3-7** | **G-C25 eachpoint lambda 形态** | 4 | `.fai.js` 无函数字面量 ⇒ 需 `.fai.js` 子集语法扩展（上游 lambda 形态） |

> B3 的每一项都是**独立批**，因为它们各自会翻动冻结断言或跨子路径消费者。**零功能收益的清理（G-B4）排在功能之后**。

---

### B4 · harness 增强（难度 3–4；一次改动解锁多条）

| 序 | 项 | 影响 | 动作要点 |
|---|---|---|---|
| **B4-1** | **G-E2 parametrize** | 3 | 镜像框架支持参数化用例展开 |
| **B4-2** | **G-E3 `__dir__`** | 2 | 反射式用例 |
| **B4-3** | **G-D4 `raises`** | 5 | harness 支持 `pytest.raises` 错误路径断言（spy `console.*` 满足 stderr 零容忍） |
| **B4-4** | **G-E1 getfixturevalue** | 11 | pytest fixture 反射（杠杆最高） |
| **B4-5** | **G-E4 fixture** | 1 | fixture 机制 |
| **B4-6** | **G-E5 镜像框架残留** | 2 | compound 读取 / targeted（双终端已随 B0-6 收口） |

---

### B5 · 装配（难度 4–5；最大子系统）

| 序 | 项 | 影响 | 依赖 |
|---|---|---|---|
| **B5-1** | **G-D1 装配约束求解器**（pure-TS 全局 NLP，对标 CadQuery solver 语义） | 14 | 独立子系统设计 |
| **B5-2** | **G-D3 导出侧装配结构** | — | `XCAFDocument` 补 `NewShape`/`AddAssembly`（**内核依赖**，需与内核迭代绑定） |
| **B5-3** | **G-D2 子形状 name/color/layer 读回** | 4 | `XCAFDocument` 补 `ShapeTool.GetSubShapes`/`LayerTool`（内核依赖） |
| **B5-4** | **G-F10 prism from/to-face** | 4 | `BRepFeat_MakePrism` 绑定（~80 行，内核依赖） |

> B5-2/B5-3 是**内核能力缺口**：本仓单独立项动不了，须先扩 `XCAFDocument`。**仍是待办项目**，只是依赖在 B6。

---

### B6 · 内核依赖（难度 5；occt-wasm 绑定补齐 —— 需与内核迭代绑定）

| 序 | 项 | 影响 | 需补的绑定 |
|---|---|---|---|
| **B6-1** | **G-F7 fillet-chain-reapply** | 9 | fillet 接受 fillet 产出（TopoDS::Solid 接受面） |
| **B6-2** | **G-F1 + G-F9 shell/offset intersection-join** | 5 | `MakeThickSolidByJoin` intersection-join offset |
| **B6-3** | **G-F4 boolean-near-coincident-bspline** | 3 | 布尔容差/稳健化 |
| **B6-4** | **G-F2 draft-existing-solid** | 2 | `BRepOffsetAPI_DraftAngle` 对已有 solid |
| **B6-5** | **G-F5 ellipse-tall-axis** | 1 | `gp_Elips` 参数构造 |
| **B6-6** | **G-F3 loft-coplanar-sections** | 1 | `ThruSections` 参数 |
| **B6-7** | **G-F8 step-export-wire-fidelity** | 1 | STEP writer 保真 |
| **B6-8** | **G-F6 crash-polygon-cutThruAll** | 1 | 崩溃根因 |
| **B6-9** | **G-F11 chamfer 双距离**（`narrow:chamfer-asym`）—— 2026-10-03 从 B1-10 移入（定性见 G-F11） | 1 | `BRepFilletAPI_MakeChamfer::Add(d1,d2,E,F)` + edge→face map |
| **B6-10** | **sweep 辅脊（`kernel:sweep-aux-spine-mode`）** —— 2026-10-04 从 B2-3 移入：CadQuery 用 `BRepOffsetAPI_MakePipeShell::SetMode(aux, CurvilinearEquivalence=True)`（`occ_impl/shapes.py:4587`），而 `sweepOriented(mode=Auxiliary)` 不等价（实测 17759.16 vs ref 20218.35；OCP 的 CV=False 20500.44 / default 20500.46 / Frenet 19295.97 均不符）。`sweep(auxSpine=…)` 已改显式报错。 | 3 | 在辅助脊模式下暴露 `CurvilinearEquivalence` 标志（或按 OCCT 语义重写该模式） |
| **B6-11** | **多截面 pipe shell（`kernel:sweep-multisection-pipe`）** —— 2026-10-04 从 B2-3 移入（B2-3b）：`r5` / `r7` / `TestCadQuery::testMultisectionSweep__{specialSweep,arcSweep,normalSweep}`。上游 `Solid.sweep_multi`（`occ_impl/shapes.py:4682`）与 free `sweep(sections, path)` 都建**一个** `BRepOffsetAPI_MakePipeShell(spine)` 然后每截面 `Add(section, False, False)` 一次（后者见 `shapes.py:7127`+`7249`）。occt-wasm 只暴露单轮廓 `sweepPipeShell(profile, spine, freenet?, smooth?)`（`index.d.ts:169`）⇒ **无多 `Add` 绑定**。实测三种近似全不符：specialSweep loft[c@-10,c@0,r@10] 65.73（Δ5.3%）/ 单轮廓 62.83（Δ0.65%，且 3 face vs ref 7）/ sweep(rect) 80.00（Δ28%）；r5 单轮廓 vol 对得上（Δ8.8e-6）但 **bb z[-0.008,1.400] vs ref [0,1]**（单轮廓端盖垂直于 spine，多截面在给定截面平面封盖 ⇒ 不同实体）。arcSweep（弧脊）与 r7（两不同截面）连 loft 都无法近似。**内核依赖、本仓不做绕行**：`sweep(multisection=…)` 现状是 per-section pipeShell + fuse 的近似，仅在「同形截面 + 直线脊」时等价（那 3 条已用 loft 镜像精确命中）。 | 5 | 暴露多截面 `Add`（`BRepOffsetAPI_MakePipeShell`：N×`Add` + `Build` + `MakeSolid`） |

> 内核跟踪文档：`docs/analysis/2026-09-29-occt-wasm-gap-plan.md`（§10.1 fillet-chain / §10.4 prism-from-face）。**本表逐项对应过去，不再是「已定性、不排期」。**

---

## 4. 每批的验收判据（硬门禁，不过 = 本批不做成）

1. **全量 parity 零回归**：`npx tsx tests/run-cand.ts` + `npx tsx tests/compare.ts` ⇒ 480 个 mirror 的 `cq.val()` 产物几何逐位不变（新解锁项允许新增 PASS，但不许让既有 PASS 翻红）。**PASS-NT（几何逐位一致、仅拓扑差）算通过**——`compare.ts:155` 的 parity 口径就是 `(pass + passNt) / refCaseCount`；但必须在镜像注释 + manifest `reason` 里写明差异（如 `pass-nt:mirror-seam`）。
2. **包内单测全绿**：`npm run test -w @faicad/faijs-cadquery`（`pretest` 会先 build；改 `src/` 后 CLI 走 `dist`，**别用陈旧产物测**）。
3. **门禁全过**：`npm run typecheck -w @faicad/faijs-cadquery`（根 `tsc` 10 项既有红属基线，**对基线取差**）、`npm run lint`、根 `verify-export-jsdoc`（新导出必须有 JSDoc）、`check-ghost-deps`、`check-lockstep`（若动版本）。
4. **变异测试做过**：把新实现的关键分支改坏，断言必须变红。**没做过变异测试的断言不算验证。**
5. **CI 只跑一次**：`pwsh -NoProfile scripts/ci.ps1`，且跑前先跑完 1–3。**严禁通过跑 CI 找 bug**（AGENTS.md 铁律）。
6. **数据同步**：改判任何 blocked ⇒ **同时**更新 `manifest.json`（经 `mark-blocked.ts`）、`coverage.json`（重算）、本文 §2/§3 计数。**只改一处会让下一轮重算把结论翻转**（§6 纪律 1）。

---

## 5. 风险与守卫

| # | 风险 | 概率 | 守卫（可执行） |
|---|---|---|---|
| R1 | 照源码直写 op、语义写错（P3 三次踩中） | **高** | 每项**先一次性 Python 捕获**（§7），捕获推翻方案即回写本表 |
| R2 | `shape` 字段删除（G-B4）打到跨子路径 assembly 鸭子读者 | 高 | 单独立批 + 全量 parity + assembly 单测；**先跑全仓 grep 确认读者面** |
| R3 | `findSolid` 走 parent（G-B1）翻 `object-stack.test.ts` 冻结断言 | 中 | 单独立批；变更前先列出会翻的断言清单 |
| R4 | 内核依赖项被当成「已定性不做」而沉底 | 中 | §3 B6 逐项列明「需补的绑定」；每项保留 blockedBy 标签，不许删 |
| R5 | coverage 重算翻转大量 case | ~~高~~→**已实测低** | B0-1 独立一轮、不夹带改动；逐条解释翻转。**实测结果：只翻 3 条**（不是审计预告的 130+，那是 2026-09-30 的历史事故）。后续每次重算仍按此纪律 |
| R6 | 句柄泄漏（kind 选择器多对象不释放） | 中 | B1-12 跑 parity 时逐 case 记 kernel arena 计数（`docs/analysis/2026-09-04-compat-arena-handle-leak.md`） |
| R7 | 范围蔓延到 §2.3 排除项以外的「不做」 | 中 | §2.3 是**唯一**排除清单；任何新增「不做」必须回写 §2.3 并说明，**不得散落在正文** |

---

## 6. 三条必须遵守的作业纪律（都是踩过的坑）

1. **尺子与尺子不同步会打架**：`coverage.json` 与 `manifest.json`（经 `mark-blocked.ts`）是两套独立标注。改判任何一条 blocked，必须**同时**更新两处 + 本文 §2/§3；只改一处会导致下一轮重算把结论翻转。已发生过的真实事故：`op:split-all` 闭合后旧理由仍在流传。
2. **新立项一律走「一次性 Python 捕获 → 真值固化进 TS 断言」**（`2026-10-02-cadquery-port-gap-audit.md` §5.1），**不建 per-run 探针通道**。`val`/`vals` 的度量盲区是「真值未断言」不是「API 缺失」——两者早已导出（`workplane.ts:5256/5270`），只是 `VERIFIED_VALUE_OPS` 没收。
3. **grep 计数必先排注释、且路径要确认存在**（判「某 API 0 处使用」前必查）：
   - 路径不存在 ⇒ **任何模式都返回 0**（看起来像「0 处使用」）；
   - 注释被计入 ⇒ **假阳**：镜像 `.fai.js` 里有大量 `// for o in box2.all():` 这类注释，`grep -F '.all('` 报「5 文件 / 21 处」，逐条核后**真实调用为 0**；
   - 只查 `cq.all(` 会**漏掉**链式/变量调用形态。
   **两个口径都要跑 + 人工判别是否注释。**

---

## 7. 验证方法论（沿用，不得简化）

**范式**：一次性 CadQuery 2.8.0 Python 参考捕获 → 真值固化进 TS 断言（禁止 per-run 探针通道）。

第 1 步用 `C:\Users\ylt\cadquery-env\Scripts\python.exe`（**该解释器有 OCP**；Git Bash 下的 `python` 没有 —— 是解释器选错，不是缺包）。第 2 步把捕获值手抄成 `*.test.ts` 硬编码期望，反直觉语义标 `GOTCHA:`。第 3 步 faijs 用自家 OCCT 内核重算同值并断言（容差：center 1e-6、bbox 1e-3、volume 1e-6·rel）。第 4 步 Python 脚本一次性、不入 CI。

**四类非 STEP 输出的比对要点**：

| 输出类型 | 比对内容 | 容差 |
|---|---|---|
| 选择结果（子形状引用） | 选中实体 `{type, center}` 保序集合 + count | center 1e-6，顺序敏感 |
| 几何量 / 元数据 | `Volume()/Center()/BoundingBox()/isValid()/geomType()` 等返回值 | 体积 1e-6·rel、bbox 1e-3、bool 精确 |
| 坐标变换结果 | `Plane.toLocalCoords`/`mirrorInPlane` 变换后坐标 | 坐标 1e-6 |
| 对象栈解构 | `.all()/.vals()` 的多对象集合（数量 + 各自几何） | 同几何量容差 |

---

## 8. 复算 / 复验命令（备查）

```bash
# coverage 重算（需 OCP python；见 tests/baseline.json）
C:/Users/ylt/cadquery-env/Scripts/python.exe packages/faijs-cadquery/tests/ref-harness/analyze-coverage.py --json packages/faijs-cadquery/tests/coverage.json

# manifest 重算（先 mark-blocked，再 gen-manifest）
node_modules/tsx/dist/cli.mjs packages/faijs-cadquery/tests/mark-blocked.ts
node_modules/tsx/dist/cli.mjs packages/faijs-cadquery/tests/gen-manifest.ts

# 读 ref STEP 的精确 vol/CoM/bbox/拓扑（写镜像前先 probe，别照源码猜）
node_modules/tsx/dist/cli.mjs packages/faijs-cadquery/tests/probe-ref.ts <ref>.step

# 单镜像 parity（cand 导出 + 比对）
node_modules/tsx/dist/cli.mjs packages/core/scripts/faijs-cli.ts run <mirror>.fai.js --out out/cand/<case>.step --mode brep
node_modules/tsx/dist/cli.mjs packages/faijs-cadquery/tests/compare.ts --only <substr>

# 门禁
node_modules/tsx/dist/cli.mjs scripts/verify-export-jsdoc.ts
node_modules/typescript/bin/tsc --noEmit -p packages/core/tsconfig.json
node_modules/eslint/bin/eslint.js packages/core/src packages/faijs-cadquery/src
node_modules/vitest/vitest.mjs run   # 在 packages/faijs-cadquery 下
```

---

## 9. 与旧文档的关系（已删除物 + 事实出处）

- **`2026-10-03-cadquery-port-decisions-and-backlog.md` 已删除**。它把大量缺口写成「已决策不做 / 不可解」，与「除 UI 可视化导出外全部要移植」的既定方向冲突；且含一处硬错误（镜像数写 551，实测 464）。本文取代它，成为唯一「还剩什么」入口。
- 事实出处（**背景查阅，非「拼答案」来源**）：
  - `docs/plans/2026-10-02-cadquery-port-gap-audit.md` —— 沉默缺口 A–E 类、§5.1 一次性捕获范式
  - `docs/plans/2026-09-30-cq-compat-parity-status.md` —— manifest 基线、§3.2–3.6 四类待办、§8.4 镜像 GOTCHA
  - `docs/plans/2026-10-03-cadquery-object-stack-p3-plan.md` —— P3 五批（已完成，本文体例来源）
  - `docs/analysis/2026-09-29-occt-wasm-gap-plan.md` —— §10.1 fillet-chain / §10.4 prism-from-face（B6 逐项对应）
  - `packages/faijs-cadquery/tests/coverage.json` / `manifest.json` / `mark-blocked.ts` —— §1 计数、§2.2 明细
