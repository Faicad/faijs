# cq-compat ⇄ CadQuery 对等验证方案（v1）

> 状态：**实施中**（P0–P3 已落地；P2 首批 16 case / 27 var 端到端跑通，PASS 22 / FAIL 5；P4–P5 未开始。实测记录见 §11）
> 日期：2026-09-08
> 范围：`packages/cq-compat`、`packages/mini_lathe`（受影响的消费方）

---

## 1. 用户原始要求（原文引用）

> 这样，之前在没有验证cq-compat包与cadquery兼容的情况下，就直接用cq-compat写mini_lathe，所以问题很多。现在要补上这一环节。请写一份技术实施方案，保证cq-compat包与cadquery兼容。方法是跑cadquery项目里的tests目录里的测试，所有建模的测试用例，到处step。本项目cq-compat包建立同样的tests目录，然后验证双方的step文件一致。cadquery里面非建模的测试忽略，比如test_jupyter.py这种。请先写这份计划文档

拆解为四条硬性约束：

| 编号 | 约束 |
|---|---|
| C1 | 验证对象 = CadQuery 上游 `tests/` 目录中的**建模测试用例** |
| C2 | 参考侧产物 = CadQuery 跑测试时**导出 STEP** |
| C3 | `packages/cq-compat` 下建立**同样的 tests 目录**，逐用例镜像 |
| C4 | 判定 = **双方 STEP 文件一致**；非建模用例（如 `test_jupyter.py`）忽略 |

---

## 2. 为什么要做：现状取证

### 2.1 已完成的环境搭建（本次会话）

| 项 | 值 |
|---|---|
| Python 环境 | `C:\Users\ylt\cadquery-env`（venv，Python 3.13.12，pip + 清华镜像） |
| CadQuery | `cadquery 2.8.0` + `cadquery-ocp 7.9.3.1.1` |
| pytest | `9.1.1` |
| CadQuery 源码基线 | `v2.8.0` tag（本地 checkout `C:\git\CADQ\cadquery`，HEAD 实际停在 `a6bedc0` = `v2.8.0-20`，二选一必须锁定，见 §4） |

### 2.2 mini_lathe 实测：7/7 零件与 CadQuery 参考**不等价**

用新装的 CadQuery 跑 `C:\git\CADQ\mini_lathe`（远端最新 `15cf47d`）导出参考 STEP，再用本仓库
`packages/cq-compat/scripts/compare-step.ts` 与 faijs brep 模式产物对比：

| 零件 | 体积偏差 | 质心偏差(mm) | 拓扑 A(ref) → B(faijs) | 布尔差 (A-B / B-A, mm³) |
|---|---|---|---|---|
| bottom_plate | 0.0312% | 1.4e-4 | f28,e75,v50 → **f20,e51,v34** | 6.5 / 27.5 |
| middle_bottom | 0.0329% | 7.7e-4 | f28,e75,v50 → **f20,e51,v34** | 17.2 / 34.3 |
| middle_top | 0.1089% | 2.1e-3 | f28,e75,v50 → **f20,e51,v34** | 0 / 34.3 |
| top_plate | 0.0311% | 1.4e-4 | f28,e75,v50 → **f20,e51,v34** | 6.5 / 27.5 |
| axk | 0.1618% | 4.1e-2 | f24,e63,v42 → **f20,e47,v30** | 300.8 / 383.8 |
| slide_top | 1.7946% | 2.4e-1 | f70,e162,v108 → **f38,e98,v64** | 2016 / 3603 |
| slide_mid | 1.1296% | **2.914**（包围盒差 3mm） | f76,e181,v120,s1 → **f60,e164,v104,s2** | 46800 / 48260 |

四个板类零件（bp/mb/mt/tp）的 faijs 侧拓扑完全相同（f20,e51,v34），说明它们缺失的是**同一类特征**——
即"构造矩形 → vertices/edges 选取 → 钻孔"这条链没有被完整实现。

### 2.2.1 装配体级对比（`compare-assembly.ts`）

| 层级 | 参考（CadQuery） | faijs 移植 | 结论 |
|---|---|---|---|
| 结构 | 6 leaves：`axk, bp, mb, mt, slide_top, tp` | 7 leaves：`shape_axk, shape_bp, ..., shape_slide_top [1], shape_slide_top [2], shape_tp` | ✗ 零件名未对齐（用了脚本变量名），且 slide_top 被拆成 2 个零件 |
| 逐零件位姿/几何 | — | 全部 `not found in B` | ✗ 名称约定不兼容导致逐零件比对无法进行 |
| 整体融合几何 | 体积 295926.9 mm³ | 体积 124326.5 mm³（差 57.99%） | ✗ 包围盒差 5.5mm，双向布尔差 1.77e5 / 5.27e3 mm³ |

**读数**：装配体层的问题不是"精度不够"，而是**结构性不一致**——
① `union` 返回 compound 让一个零件裂成两个（文中 §2.3 第 3 条）；
② 零件命名/ XCAF 标签约定两侧不同 CadQuery 用 `.add(..., name=)`，faijs 侧沿用脚本变量名。
这条补丁必须在 P3 阶段处理，否则装配体用例即使几何对了也会被判 DIFFERENT。

### 2.3 已定位的直接原因

1. **选择器索引被静默丢弃**：`packages/cq-compat/src/workplane.ts:125-126`
   `sel.replace(/\[-?\d+\]$/, '')` 直接剥掉后缀，`faces(wp, sel)` 签名也只接受 `string`。
   上游 `slide_top.py` 的 `.faces("-Y")[1]` / `.faces("+Y")[1]`、`assemb.py` 的
   `"bp@faces@>Z[-2]"` 全部降级为纯方向选择。
2. **`cutBlind` 不遍历 `pushPoints`**：只在 workplane origin 切一个（见
   `docs/analysis/2026-09-08-cq-compat-union-compound-bug.md`）。`hole`、`cboreHole`、`cskHole` 疑同病。
3. **`union` 返回 compound 而非融合体**：见《`docs/analysis/2026-09-08-cq-compat-union-compound-bug.md`》；
   `slide_mid` 的 `s=2`（faijs）vs `s=1`（ref）与装配体里 slide_top 裂成两个零件，都是它的直接外显。
4. **API 覆盖面**：cq-compat 现导出 **30** 个函数，CadQuery `Workplane` 公开方法 **100+**
   （`cq.py` 中 `Workplane` 全量 `FunctionDef` 145 个，含重载/私有）。缺 `chamfer`、`revolve`、`loft`、
   `sweep`、`cylinder`、`sphere`、`wire/polyline/consolidateWires`、`eachpoint/combine`、
   `tag/workplaneFromTagged`、`polarArray/rarray`、`sketch/placeSketch`、`sortWiresByBuildOrder` 等。
   这意味着 CadQuery tests 里大量用例在 cq-compat 侧**根本无法表达**——必须先量化，再逐个补。

> 结论：本方案要解决的不是"再修几个 bug"，而是**补上一条可持续运行的等价性验证流水线**，
> 让 mini_lathe 这类消费方随时能回答"cq-compat 到底兼容到什么程度"。

---

## 3. 目标与非目标

**目标**

- G1 **参考侧产线**：一条命令从 CadQuery 上游建模测试导出全部 STEP + manifest（几何基线）。
- G2 **镜像侧产线**：`packages/cq-compat/tests/` 逐用例镜像 CadQuery tests，同一样例ID 映射到同名 STEP。
- G3 **判定**：一条命令跑完全部比对，输出三态（`PASS` / `FAIL` / `BLOCKED`）报告。
- G4 **修复驱动**：每个 `BLOCKED` 标注**首个阻塞 op**，`parity score` 单调可观测；修一个 op 解锁一批用例。

**非目标**

- 可视化/交互层：`test_vis.py`、`test_jupyter.py`、`test_fig.py`、`test_examples.py` —— 忽略
  （对应 C4）。
- 文件 IO 层：`test_exporters.py`、`test_importers.py`、`test_pickle.py` —— 一期忽略，
  二期可选纳入（其中含少量建模，但主测的是 STEP/STL/GLTF 导出链路本身，与本方案的几何等价判定无关）。
- 运行时/脚本封装：`test_cqgi.py`、`test_utils.py`、`test_geom.py` —— 忽略。
- **不追求逐位浮点等价**：参考侧用 OCCT 7.9（cadquery-ocp），faijs 用 `occt-wasm` 3.8.0，
  二者版本不同，倒角/圆角等操作的面数量天然不同；容差比对，并要求"体积/质心严格 + 布尔差严格"，
  拓扑计数作为**观察项**而非一期门禁（详见 §7.2）。

---

## 4. 版本与基线锁定（必须先定，否则不可复现）

参考基线写入 `packages/cq-compat/tests/baseline.json`（新增，纳入 git）：

```json
{
  "cadquerySrc": "C:\\git\\CADQ\\cadquery",
  "cadqueryTag": "v2.8.0",
  "python": "C:\\Users\\ylt\\cadquery-env\\Scripts\\python.exe",
  "cadqueryVersion": "2.8.0",
  "ocp": "cadquery-ocp 7.9.3.1.1",
  "pytest": "9.1.1",
  "faijsOcct": "occt-wasm ^3.8.0"
}
```

**关键约束（踩过的坑，见 §5.6）**：本地 checkout HEAD 是 `a6bedc0`（`v2.8.0-20`，dev 分支，需要 OCP 8.0.1），
与 pip 装的 `cadquery 2.8.0`（OCP 7.9）**不兼容**（实际报错 `ModuleNotFoundError: No module named 'OCP.collections'`、
`cannot import name 'hlr'`）。因此：

- 参考**测试源码**用 `git -C <src> archive v2.8.0 tests | tar -x -C <cache>` 导出到缓存目录；
  **只读操作，不改动用户的 `C:\git\CADQ\cadquery` 工作树**。
- 参考**运行时**始终用 `baseline.json` 里锁定的 venv，且必须绑定到 **site-packages 安装的 cadquery**，
  不能被 pytest 前置的源码根目录抢先导入。

---

## 5. 参考侧（CadQuery）：自动 STEP 导出 harness

### 5.1 为什么不能依赖现有的 `saveModel`

`tests/__init__.py::BaseTest.saveModel()` 确实会写 STEP，但覆盖率极低：

| 文件 | 用例数 | 调用 saveModel | 覆盖率 |
|---|---|---|---|
| test_cadquery.py | 202 | 70 | ~35% |
| 其余全部测试文件 | ~430 | **0** | 0% |

→ 必须自己做捕获，不能靠约定。

### 5.2 机制：pytest 插件 + AST 注入 + `locals()` 快照

不改 CadQuery 源码文件，**在内存里做 AST 变换**：自定义 `MetaPathFinder` 拦截目标测试模块，
把每个用例重写为：

```python
def test_x(self):
    try:
        <原始 body>
    finally:
        __CQ_EXPORT__(locals(), "tests.test_x::Class::test_x")
```

- `try/finally` 而非末尾追加：保证 `return`、断言失败、异常路径都能触发导出。
- `locals()` 覆盖**所有命名过的中间变量**——链式调用产生的匿名 Workplane 不计，因此导出数量天然适中
  （实测平均每用例 ~2 个），且**变量名可在镜像侧对齐**。
- 插件本体定位：`packages/cq-compat/tests/ref-harness/cq_step_plugin.py`（POC 已在 `D:\tmp\cq-poc` 验证）。

### 5.3 捕获与过滤规则

只对 locals 中的 `Workplane / Shape / Assembly` 取值：

| 判据 | 处理 |
|---|---|
| `Workplane` | `.val()` 取 shape |
| `Assembly` | `.toCompound()` |
| `Shape.ShapeType()` ∈ Solid / Compound | 导出 |
| `ShapeType()` = CompSolid / Shell | **跳过**（实测 cadquery `exportStep` 内部对 COMPSOLID 抛 KeyError） |
| `Volume() <= 1e-6` | 跳过（Wire/Face/Sketch 等 2D 结果） |
| 其它类型（如 `Vector`） | 跳过并记录 reason（实测此类误判 43 条） |
| **`exportStep()` 返回 False** | **必须当作失败记录**（不抛异常，见 §5.6） |

### 5.4 产物布局

```
packages/cq-compat/out/ref/
  <module>__<Class>__<test>__<var>.step     # ":" → "_"
  manifest.json                             # case → [{var,type,volume,file}] / [{var,error}]
```

### 5.5 已验证数据（POC 实测，非估算）

采样：10 个建模测试文件、**622 用例全部 passed**、耗时 **62–99 秒**、导出
**305 个 case / 650 个 STEP / 20.7 MB**：

| 文件 | 导出用例数 |
|---|---|
| test_cadquery.py | 148 |
| test_assembly.py | 68 |
| test_free_functions.py | 38 |
| test_selectors.py | 30 |
| test_shapes.py | 11 |
| test_workplanes.py | 7 |
| test_cad_objects.py | 3 |
| 捕获异常 | 47（43 条类型误判 + 少数 COMPSOLID，已可归入 §5.3 过滤表） |

### 5.6 踩坑清单（全部为实测所得，写进实现以免重犯）

1. `Shape.exportStep()` **失败返回 `False` 而不抛异常** —— 输出目录不存在时静默丢失全部文件。
   必须先 `os.makedirs(OUT, exist_ok=True)`，且逐条检查返回值。
2. 从 CadQuery **源码根目录**运行 pytest，`cadquery/` 包会抢先被导入 → 必须先用 site-packages
   版本（插件顶层 `import cadquery`），或干脆只用 tag 快照 + 独立缓存目录。
3. 自定义 loader 不会自动注入 `__file__` / `__package__` —— 缺失会让测试模块里的
   `Path(__file__).parent` 直接 `NameError`（`test_cadquery.py:33` 就是这么炸的）。
4. CadQuery dev 版(pip 外)与 release 版的 import 不兼容，见 §4。
5. 非建模文件的 **collection 阶段 import 报错会中断整轮收集**（`test_jupyter` 缺 IPython、
   `test_fig` 缺 docutils）→ 必须用**显式白名单文件列表**，不要用 `--ignore` 反向过滤。
6. `pytest_collect`/plugin 不可用 `pytest_pyfunc_call` 包装拿到局部变量——那条路走不通，
   AST 注入是唯一干净方案。

---

## 6. cq-compat 侧：镜像 tests 目录

### 6.1 目录结构（严格镜像 CadQuery `tests/` 文件名）

```
packages/cq-compat/
  tests/
    baseline.json                      # §4 版本锁定
    manifest.json                      # 用例三态清单（唯一事实源）
    README.md                          # 如何新增/重跑/判读
    ref-harness/
      cq_step_plugin.py                # §5 pytest 插件
      run-ref.py                       # 导出参考 STEP 的驱动（读 baseline.json）
    run-cand.ts                        # 遍历 *.fai.js → out/cand/*.step
    compare.ts                         # 批量比对 → report
    out/                               # gitignore：ref/ cand/ report.*
    test_cadquery/
      TestCadQuery__testBox.__fai.js
      ...
    test_shapes/
    test_assembly/
    test_free_functions/
    test_selectors/
    test_workplanes/
    test_nurbs/
    test_sketch/
    test_cad_objects/
    test_hull/
```

用例 ID = `<module>__<Class>__<test>__<var>`，两侧文件名逐字相同，比对时按名配对。

### 6.2 三态清单（`tests/manifest.json`）

```json
{
  "tests.test_cadquery__TestCadQuery__testToSVG__r": {
    "status": "ported",
    "source": "test_cadquery.py::TestCadQuery::testToSVG",
    "blockedBy": null
  },
  "tests.test_cadquery__TestCadQuery__testLoft__r": {
    "status": "blocked",
    "source": "test_cadquery.py::TestCadQuery::testLoft",
    "blockedBy": "op:loft"
  }
}
```

- `ported`：镜像脚本存在且成功导出 STEP（可比对）
- `blocked`：脚本无法写出 / 依赖未实现 op，必须填 `blockedBy`（首个阻塞 op 或依赖，如 `deps:cq_warehouse`）
- `skipped`：非建模（C4）或依赖外部 IO 资源

**红线**：禁止把 `blocked` 记成 `ported`；`FAIL` 不得用放宽容差的方式改成 `PASS`。

### 6.3 移植管线

1. harness 在导出参考 STEP 的同时，顺带把每个用例 body **剥离断言**后落成 `case.py`
   （建模语句 + 导出语句），作为移植输入。
2. 复用现有 `packages/cq-compat/scripts/transpile-file.ts`（Python → `.fai.js`，已支持链式调用、
   list comprehension、`math`、函数抽取）自动生成初版。
3. 人工校对 / 补 op；对每个 `.fai.js` 头部保留 `source:` 注释，指向上游用例出处。
4. 脚本须以 `let result = ...` 结尾，变量名与参考侧 `__var__` 对齐。
5. 现存 transpile 不支持的 Python 语法（上下文管理器、decorator、`with raises`、`pytest.parametrize`）
   记为 `blocked`，不手工绕过。

### 6.4 当前可实现性预判

按 §2.3 第 4 条，一期只能覆盖 cq-compat 已实现 op 的用例子集；
预计首批 `ported` 集中在 `rect/box/extrude/cut/cutBlind/hole/fillet/union/translate/rotate/workplane/faces/edges`
组合上（mini_lathe 已用到的大致就是这个集合）。
**先跑出覆盖清单，再按 `blockedBy` 频次排序决定 op 补齐顺序**——这是本方案的核心收益。

### 6.5 移植用例清单（2026-09-08 实测，`tests/ref-harness/analyze-coverage.py` 产出）

回答"到底移植哪些测试"：对 CadQuery v2.8.0 全部 305 个建模 case 的函数体做 AST 分析
（只追每个 case **实际导出 STEP 的变量**的定义链，断言脚手架不计入），并与 cq-compat 已实现的
30 个 Workplane op + 4 个 Assembly op 做差集。产物入库为 `tests/coverage.json`，
三态清单 `tests/manifest.json` 由 `tests/gen-manifest.ts` 消费它生成。

**分类结果（305 case）：**

| 类别 | case 数 | 含义 |
|---|---|---|
| PORTABLE | 117 | 几何链完全落在已实现 op 内，**可直接移植** |
| PORTABLE-WITH-STUB | 33 | 几何来自 `tests/__init__.py` 的 helper（`makeUnitCube`/`makeCube` = rect+extrude），镜像里用已实现 op 复原即可 |
| BLOCKED | 155 | 缺 op，首个缺失 op 已标注（见下表） |

**STEP 级三态（650 个 ref STEP + 47 无产物）：`tests/manifest.json` = 27 ported / 623 blocked / 47 skipped。**
blocked 中 `pending:mirror` 238 个（op 齐备、只差写镜像脚本），其余按首个缺失 op 排行：

| blockedBy | var 数 | | blockedBy | var 数 |
|---|---|---|---|---|
| `op:moved` | 75 | | `op:cylinder` | 14 |
| `op:importStep` | 23 | | `op:face`（形状工厂） | 13 |
| `op:sphere` | 22 | | `deps:load/save`（文件 IO） | 13 |
| `op:close` | 19 | | `op:siblings`（Assembly） | 12 |
| `op:loft` | 18 | | `op:cutThruAll` | 11 |

**P2 首批 16 个 case / 27 个镜像文件**（已全部落地 `tests/test_cadquery/`，选择标准：
覆盖全部已实现 op 组合 + 包含 mini_lathe 踩过的所有坑位模式 + 每 case 的 var 数少以便端到端先行）：

| # | 上游 case | var | 首轮判定 | 说明 |
|---|---|---|---|---|
| 1 | testBoxDefaults | s | PASS（修复 box 后） | box 基础 |
| 2 | testBoxPointList | s | FAIL（预期） | `box(combine=)` 未实现 |
| 3 | testCut | currentS/toCut/resS/sugar | PASS×4 | cut + `__sub__` 糖 |
| 4 | testIntersect | currentS/toIntersect/b1/b2/resS/sugar | PASS×6 | intersect + `__and__` 糖 + box origin 平移等效 |
| 5 | testUnionNoArgs | objects1/objects2 | PASS×2 | union 熔合 |
| 6 | testFillet | c | PASS | makeUnitCube stub + `\|Z` 边圆角 |
| 7 | testCounterBores | c/c2 | PASS×2 | pushPoints×cboreHole（c 需 depth 参数） |
| 8 | testCounterSinks | result | PASS | fc 矩形顶点 × cskHole |
| 9 | testAngledHoles | s | PASS（修复 transformed 后） | named plane `front` + 60° 倾斜孔 |
| 10 | testSimpleWorkplane | r | PASS | faces→workplane→cutBlind |
| 11 | testMultiFaceWorkplane | s | FAIL（布尔差 0.100 恰在容差上） | faces 后直接 rect+cutBlind（内部空腔） |
| 12 | testNestedCircle | s | FAIL（预期） | 双 circle 环形 pending，单值 pendingCircle 未覆盖 |
| 13 | testTwoWorkplanes | r/t | FAIL（预期） | 连续两个 rect 的 pending-wires 列表语义 |
| 14 | testRotate | box | PASS | 上游丢弃 rotate 结果，STEP 为未旋转 box |
| 15 | testTranslateSolid | c/d | PASS×2 | makeUnitCube stub + translate |
| 16 | testBoxDefaults/…其余 | — | — | 共 27 var，命名 `<Class>__<test>__<var>.fai.js` 与 ref STEP 一一对应 |

**因分析器盲区需人工排除的**：`testIbeam`（polyline/mirrorY 未实现但 `r` 变量因是 2D wire
未被 harness 导出，静态分析看不到）→ 已标 `blocked(op:polyline)`；
`testTaperedExtrudeCutBlind` → `blocked(op:extrude.taper)`；
`test_mirror` / `test_mirror_axis` → `blocked(op:mirror.axisPoint)`。

**分析器盲区（已知，需人工复核）**：helper 内自由函数跨模块引用不展开（仅 `tests/__init__.py`）；
只追导出变量的定义链，未导出的中间 2D wire 上的 op 不可见——首批 16 个 case 已逐个人工核对过源码。

---

## 7. 比对与判定

### 7.1 复用现有工具

`packages/cq-compat/src/step-compare.ts::compareStepFiles`（CLI `compare-step.ts`）已实现：
包围盒、体积、质心、拓扑计数、双向布尔差。**不新写比对器**，只加批量驱动 `tests/compare.ts`。

### 7.2 判定规则

| 档 | 条件（默认容差） | 结果 |
|---|---|---|
| 几何一致 | volume rel ≤ 1e-3；centroid ≤ 1e-3 mm；bbox ≤ 1e-3 mm；双向布尔差 ≤ 0.1 mm³ | `PASS` |
| 数值接近但拓扑不同 | 上述数值通过、拓扑计数不同 | `PASS-NT`（入库观察，不阻断；配 TODO 说明） |
| 任一项超差 | — | `FAIL` |

一期**不启用 `--strict-topology`**：参考侧 OCCT 7.9 与 faijs `occt-wasm` 3.8.0 不同，
圆角/倒角面数差异不可消除（mini_lathe 已见 f28→f20）。待 faijs brep 链与参考 OCCT 对齐后再收紧。

### 7.3 报告

`out/report.md`（人读）+ `out/report.json`（机器读），至少含：
PASS / PASS-NT / FAIL / BLOCKED / SKIPPED 计数、逐用例的偏差数值、`blockedBy` Top-N 排行。

### 7.4 Parity Score

```
parity = PASS 数 / (PASS 数 + BLOCKED 数 + FAIL 数)
```

每轮运行写入 `report.json`，并作为后续每个 op 补齐 PR 的量化目标。

---

## 8. 实施计划

| 阶段 | 内容 | 产物 | 依赖 | 状态（2026-09-08） |
|---|---|---|---|---|
| P0 | 已在本会话完成：CadQuery 环境 + 导出机制 POC（622 passed / 305 case / 650 step） | 本方案文档、`baseline.json` 草稿 | 无 | ✅ |
| P1 | 参考侧落地：`ref-harness/` 插件 + `run-ref.py`（读 baseline，tag 快照导出到缓存目录，整体只读、不改动用户的工作树），跑出首份全量参考资产 | `out/ref/*` + `ref/manifest.json` | P0 | ✅（650 STEP + manifest；快照在 `out/cache/v2.8.0/tests`） |
| P2 | 镜像骨架：`tests/` 目录 + `manifest.json` 生成器 + `run-cand.ts` + `compare.ts`，**先挑 20 个高价值用例跑通端到端** | 端到端流水线可跑 | P1 | ✅（16 case / 27 var，清单见 §6.5；`analyze-coverage.py` + `coverage.json` 产出 blockedBy 实测排行） |
| P3 | 首批修复（已知四处，见 §2.3 与 §2.2.1）：选择器索引 / pushPoints 传播 / union compound / **装配体零件命名与 CadQuery `name=` 对齐**；每修一处重跑受影响用例 | 四处定点修复 + 覆盖率回升 | P2 | ✅（此前已修四处；本轮由镜像比对再修 5 处，见 §11.2） |
| P4 | 规模化移植：按 `blockedBy` 频次补 op（`chamfer` → `revolve` → `sweep/loft` → 2D wire 面 → 阵列/日记），每批配 unit test（`packages/cq-compat/src/*.test.ts`）与对应 case 解锁 | manifest 大规模转 `ported` | P3 | ⬜ 未开始（238 个 `pending:mirror` var 可先行；op 补齐顺序按 §6.5 排行：moved → sphere → close → loft → cylinder） |
| P5 | 回归治理：把 smoke 子集（≤30 case，参考 STEP 作为 fixture 入库）接入 `vitest`/CI；全量刷新由本地作业定期执行 | CI 门禁 | P4 | ⬜ 未开始（`scripts/ci.ps1` 的逐包测试列表尚未包含 `@faicad/cq-compat`） |

**CI 取舍**：全量参考资产 20.7 MB、且 CI 里装 Python+CadQuery 代价过大；
所以 CI 只跑**已入库的 smoke 子集 + fixture STEP**，全量 parity 由本地

`npm run compat:all` 产出并在 PR 里贴报告。

---

## 9. 验收标准

1. `npm run compat:ref`（`-w @faicad/cq-compat`）能从锁定的 CadQuery tag 复现参考资产，
   退出码 0，且 manifest 用例数与本版本承诺一致。
2. `npm run compat:report` 输出三态清单；`manifest.json` 中无 `<no status>`、无 `blockedBy` 为空的 blocked 项。
3. mini_lathe 7 零件重跑 `compare-step`：`slide_top` / `slide_mid` 的
   **solids 数必须与参考一致**（s=1），体积相对偏差 ≤ 0.01%。
4. 每新增一个 cq-compat op，必须同时新增或解锁至少一个镜像用例，避免"实现了但没人验证它就写等价保证"。

---

## 10. 风险与开放问题

| # | 风险 | 处置 |
|---|---|---|
| R1 | OCCT 版本差异导致"永远不可能拓扑一致" | 一期以几何量+布尔差为门禁，明示例外并在 doc 记录；中长期推动 faijs brep 链升级 |
| R2 | CadQuery 用例依赖 `pytest.parametrize` / fixture / 外部文件（字体、testdata） | 先 `skipped` 并注明原因；参数化用例仅取默认参数实例 |
| R3 | 部分用例借助插件机制（`Workplane.makeCubes = ...`）动态扩展 | 一期标 `blocked(op:plugin)`；cq-compat 是否支持插件注册待裁决 |
| R4 | `assembly` 类用例涉及约束求解，faijs 侧路径不同 | 拆出单独门禁；先用 `toCompound` 比整体积，再议 XCAF 结构比对 |
| R5 | 参考资产体积增长 | 只入库 smoke 子集；全量资产进 `out/`（gitignore）+ 可选制品 |

**待裁决（需用户拍板，不在本文档擅自决定）**：

- Q1：参考基线用 `v2.8.0` tag（当前方案，稳定）还是本地 checkout HEAD `a6bedc0`（dev，需换 OCP 8.0.1）？
- Q2：一期是否需要把 `test_exporters.py` / `test_importers.py` 中的建模用例择优纳入？
- Q3：`parity score` 是否作为发版门禁（如要求 ≥ 60% 才可 pack）？

---

## 11. 实施记录（2026-09-08 P0–P3）

### 11.1 交付物

| 文件 | 说明 |
|---|---|
| `tests/ref-harness/cq_step_plugin.py` / `run-ref.py` | 参考 STEP 导出（pytest 插件 + AST 注入），`out/ref/` = 650 STEP + manifest |
| `tests/ref-harness/analyze-coverage.py` | 上游 case AST 分析 → `tests/coverage.json`（分类 + blockedBy） |
| `tests/gen-manifest.ts` | 三态清单生成（case+var 粒度；消费 coverage.json；保留人工标注、丢弃机器默认值） |
| `tests/run-cand.ts` | 遍历 `tests/<module>/*.fai.js` → faijs CLI brep 导出 `out/cand/*.step`（修复 Windows spawnSync npx ENOENT） |
| `tests/compare.ts` | 按名配对 → `out/report.{md,json}`（PASS/PASS-NT/FAIL/ERROR，parity 计入分母） |
| `tests/test_cadquery/*.fai.js` ×27 | P2 首批镜像（§6.5 清单） |
| `tests/manifest.json` / `tests/coverage.json` / `tests/baseline.json` | 三态唯一事实源 + 分类数据 + 版本锁定 |

当前指标：**27 ported → PASS 22 / FAIL 5；parity = 22/650 = 3.38%**（分母 = 全部 ref STEP，诚实口径）。
cq-compat 单测 16/16 通过。

### 11.2 由镜像比对直接揪出并修复的语义 bug（每处均经 ref STEP 比对验证）

1. **`box()` 不是 centered 语义**：公开 op 沿用了工具体 helper（makeBoxAt）"从面沿 normal 抬 h/2"
   的行为，而 CadQuery `box` 默认 `centered=(True,True,True)`（三维居中于 origin）。
   一个 bug 挂了 7 个镜像用例（testBoxDefaults / testIntersect×4 / testRotate），修复后全部解锁。
2. **`cboreHole` 沉孔多切 1 mm**：工具体高度写成 `cboreDepth + 1`（上游精确 `cboreDepth`）；
   同时补上上游的 `depth` 参数（`depth=None` 穿透语义）。修复后 testCounterBores c/c2 解锁，
   且 **mini_lathe slide_mid 从 0.166% 体积差变为完全等价**。
3. **`transformed(rotate=…)` 完全没生效**：旧实现调用只旋转 shape 的 `rotate()` op（对空 workplane
   直接 no-op）。按上游 `Plane.rotated` 重写：绕平面自身基轴（x→y→z 复合）旋转方向向量，
   origin 不动、shape 不动。
4. **named planes 表只有 3 个**：上游 12 个（XY/YZ/ZX/XZ/YX/ZY/front/back/left/right/top/bottom）。
   `front` ≠ XZ（= XY！），旧表静默 fallback 会把方向做错。补全全表并对未知名抛错（上游行为）。
   顺带 `orientZTo` 从轴对齐查表改为通用欧拉分解（任意倾斜 normal 的圆柱/锥工具体可用）。
5. **比对/清单工具的命名粒度**：manifest 以 case+var 为粒度（§6.2 定义），mirror fileKey =
   `<module>/<Class>__<test>__<var>`；compare 按 ref manifest 反查配对。

### 11.3 mini_lathe 回归（验收标准 3 进展）

| 零件 | 修复前 | 修复后 |
|---|---|---|
| bottom_plate / middle_bottom / middle_top / top_plate / axk | 完全等价 | 完全等价（不变） |
| slide_mid | 0.166% 体积差、拓扑不同 | **完全等价**（vol Δ=0，f76/e181/v120 全同，布尔差 0） |
| slide_top | 0.144%（假象：cbore 多切 1mm 恰好补偿缺失特征） | **2.50%**（f73 vs f70，B−A=2646 mm³——cbore 修正后暴露真实缺口） |

slide_top 的余差是移植脚本与上游 `slide_top.py` 的特征差异（ref 多 3 面 21 点），
下一步按布尔差定位到具体 op 链；`verify-all.ts` 的过期断言（期望 slide_mid=2 leaf、
依赖未入库的 legacy 工件）需同步改写。

## 附录：关键命令（均已在本会话实际执行验证）

```bash
# 参考：导出某个 tag 的 tests 快照（只读，不碰用户仓库）
git -C "C:/git/CADQ/cadquery" archive v2.8.0 tests | tar -x -C <cache>

# 参考：跑建模测试并导出 STEP
CQ_TARGET_MODULES='["tests.test_cadquery", ...]' \
CQ_SOURCE_DIRS='["<cache>/tests"]' \
CQ_STEP_OUT=<cq-compat>/out/ref \
C:/Users/ylt/cadquery-env/Scripts/python.exe -m pytest -p cq_step_plugin <cache>/tests/test_cadquery.py ...

# 候选：faijs 侧导出
npx tsx packages/core/scripts/faijs-cli.ts run <case>.fai.js --out out/cand/<case>.step --mode brep

# 判定
npx tsx packages/cq-compat/scripts/compare-step.ts <ref>.step <cand>.step --json
npx tsx packages/cq-compat/scripts/compare-assembly.ts <ref>.step <cand>.step
```
