# cq-compat ⇄ CadQuery parity 项目交接说明

> 交接日期：2026-09-10
> 交接对象：接手的第三方开发方 / Agent
> 交接范围：`faijs` monorepo 中的 `packages/cq-compat`（CadQuery 兼容层）及其 parity（几何一致性）验证体系

---

## 0. 三分钟速览

**这个项目在做什么**
在 JS/TS（浏览器 + Node）里复刻 **CadQuery 2.8.0** 的几何建模能力，包名 `@faicad/cq-compat`，
底层几何内核是 `occt-wasm`（OCCT 编译到 WebAssembly），通过 faijs 的 BREP 链路驱动。

**怎么衡量做得对不对**
用「几何一致性比对（parity）」而不是单元测试来判定：

1. 用 **Python 侧的 CadQuery 2.8.0** 跑它自己的官方测试套件，把每个测试里建模出来的变量导出成 **参考 STEP**（`out/ref/*.step`）；
2. 用 **TS 侧的 cq-compat** 写一一对应的镜像脚本（`.fai.js`），导出成 **候选 STEP**（`out/cand/*.step`）；
3. 用 OCCT 同时读回两个 STEP，比较 **体积 / 质心 / 包围盒 / 布尔差体 / 拓扑计数**，判 PASS / PASS-NT / FAIL。

**当前基线（2026-09-10，实测）**

| 指标 | 值 |
|---|---|
| 参考用例（ref STEP） | 650 |
| 已导出候选（cand STEP） | 222 |
| PASS | 210 |
| PASS-NT（数值过、拓扑不同，记录不卡门） | 4 |
| FAIL | 0 |
| BLOCKED（无候选） | 436 |
| **parity** | **32.92%** |
| cq-compat 单元测试 | 109 passed（11 files）全绿 |

**一句话给接手方**：当前 FAIL = 0，是「已移植的都能对上」的状态；剩余 436 个 BLOCKED 是**还没写镜像脚本或 cq-compat 还缺算子**，不是回归。

---

## 1. 路径清单（全部为交接时实测存在的路径）

### 1.1 仓库与相关检出

| 用途 | 绝对路径 | 备注 |
|---|---|---|
| 主仓库（faijs monorepo） | `D:\Faicad\faijs` | branch `main`，HEAD `1df8cdb`；remote `origin`=github、`gitcode`=gitcode 镜像 |
| 兼容层包 | `D:\Faicad\faijs\packages\cq-compat` | 本次交接的核心 |
| 引擎包 | `D:\Faicad\faijs\packages\core` | `@faicad/faijs-core`，BREP 链 + faijs CLI |
| CadQuery Python 源码检出 | `C:\git\CADQ\cadquery` | **只用来 `git archive` 取 tag 快照，不用来运行** |
| mini_lathe 原始 Python 源码 | `C:\git\CADQ\mini_lathe` | origin `yuan-xy/mini_lathe`；faijs 侧移植在 `packages/mini_lathe` |
| 计划文档 | `D:\Faicad\faijs\docs\plans\2026-09-08-cq-compat-parity-phase2.md` | 1063 行，**必读**，含 A–J 全部阶段实施记录与「下一阶段候选」 |
| 上一版总体设计 | `D:\Faicad\faijs\docs\plans\2026-09-08-cq-compat-cadquery-parity.md` | 比对判据 §7.2、harness §4–§5 |

> ⚠️ **安全提示**：`.git/config` 里 `gitcode` remote 的 URL 内嵌了一个 OAuth2 token
> （`https://oauth2:<token>@gitcode.com/...`）。交接给第三方前请**轮换该 token**或改用凭据管理器。

### 1.2 环境（版本全部实测）

**Node 侧**

| 项 | 值 |
|---|---|
| 托管 Node | `C:\Users\ylt\.workbuddy\binaries\node\versions\22.22.2-2\node.exe`（v22.22.2）——**优先用这个** |
| 系统 Node（兜底） | `C:\Program Files\nodejs\node.exe`（v12.16.2，**太旧，不要用**） |
| 包管理器 | npm（workspace monorepo）；内网受限时用镜像 `https://registry.npmmirror.com` |
| 直接跑 TS | `npx tsx <file>`（`tsx` 已在 devDependencies） |
| 测试框架 | vitest 3.x |
| WASM 内核 | `occt-wasm` **3.8.4**（根 `package.json` 里有 `overrides` 锁版本，勿动） |

**Python 侧（CadQuery 参考环境）**

| 项 | 值 |
|---|---|
| venv 解释器 | `C:\Users\ylt\cadquery-env\Scripts\python.exe` |
| Python | 3.13.14（MSC v.1944 64-bit AMD64） |
| cadquery | **2.8.0** |
| cadquery-ocp / -proxy | **7.9.3.1.1** |
| pytest | 9.1.1 |

重建 venv 的参考命令（国内镜像）：

```bash
python -m venv C:\Users\ylt\cadquery-env
C:\Users\ylt\cadquery-env\Scripts\python.exe -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple \
    cadquery==2.8.0 cadquery-ocp==7.9.3.1.1 pytest
```

### 1.3 版本锁定文件

`packages/cq-compat/tests/baseline.json`（**改这里等于改基线，需双方确认**）：

```json
{
  "cadquerySrc": "C:\\git\\CADQ\\cadquery",
  "cadqueryTag": "v2.8.0",
  "python": "C:\\Users\\ylt\\cadquery-env\\Scripts\\python.exe",
  "cadqueryVersion": "2.8.0",
  "ocp": "cadquery-ocp 7.9.3.1.1",
  "pytest": "9.1.1",
  "faijsOcct": "occt-wasm ^3.8.0",
  "targetModules": ["test_cadquery","test_shapes","test_workplanes","test_free_functions",
                    "test_hull","test_selectors","test_sketch","test_nurbs",
                    "test_cad_objects","test_assembly"]
}
```

> ❗ **CadQuery 源码检出的坑**：`C:\git\CADQ\cadquery` 当前 HEAD 是 `a6bedc0`（`v2.8.0-20`，
> 提交信息 "Try OCP 8.0.1"），它依赖 **OCP 8.0.1**，与 venv 里装的 7.9.3.1.1 **不兼容**。
> 所以所有参考数据一律以 **`v2.8.0` tag 快照**为准，通过 `git -C <src> archive v2.8.0 tests`
> 抽到 `packages/cq-compat/out/cache/v2.8.0/tests`（**只读快照，不要改用户检出**）。

---

## 2. 目录结构导览（cq-compat）

```
packages/cq-compat/
  src/
    index.ts              # cq-compat 公共导出面（Workplane / box / shell / wedge / loft / wire2d …）
    workplane.ts          # 【核心】Workplane 与各建模 op 的实现，绝大多数改动发生在这里
    step-compare.ts       # STEP 等价性比对（体积/质心/bbox/布尔差/拓扑）
    transpile.ts          # 上游 Python 用例 → .fai.js 镜像的辅助
    assembly.ts / assembly-compare.ts / browser.ts
    *.test.ts             # 单元测试（vitest，走 src alias）
  tests/
    baseline.json         # 版本锁定（见上）
    manifest.json         # 【三态唯一事实源】ported / blocked / skipped
    coverage.json         # 上游用例 AST 静态分析结果（分类 + 首个缺失 op）
    gen-manifest.ts       # 由 out/ref/manifest.json + coverage.json + 磁盘镜像 → manifest.json
    mark-blocked.ts       # 手工登记「不可复刻」的 block 标注（manual: true，会被 gen-manifest 保留）
    run-cand.ts           # 遍历镜像 .fai.js → 调 faijs CLI → out/cand/*.step
    compare.ts            # ref/cand 配对比对 → out/report.{md,json}
    ref-harness/
      cq_step_plugin.py   # pytest 插件：AST 注入导出语句，拦截测试变量
      run-ref.py          # 参考 STEP 导出驱动（git archive tag 快照）
      analyze-coverage.py # 上游用例静态分析 → coverage.json
    test_cadquery/        # 镜像用例（153 个 .fai.js）
    test_free_functions/  # 49
    test_workplanes/      # 8
    test_shapes/          # 5
    test_selectors/       # 4
    test_cad_objects/     # 1
    README.md / README.zh.md  # **先读这个**，含命令与红线
  out/                    # 全部 gitignore（.gitignore: `out/`）
    cache/v2.8.0/tests/   # 上游测试源码快照（1.5 MB）
    ref/                  # 参考 STEP（650 个，22 MB）+ manifest.json
    cand/                 # 候选 STEP（222 个，5.4 MB）
    report.md / report.json
    probe.py              # 取证：打印 STEP 的体积/质心/bbox/面数
    extract-case.py       # 取证：从 cache 快照里抠出上游某个测试方法的源码
```

> `out/` 被 gitignore：**接手后第一件事是重跑参考导出**（见 §4.1），否则 `out/ref` 为空，
> 比对链无法工作。

---

## 3. 一致性比对机制（本项目的核心，务必吃透）

### 3.1 三态清单 `tests/manifest.json`

**粒度是「用例 + 变量」**（一个上游测试会导出多个变量，每个变量一个 STEP、一个镜像脚本）。
每个 entry 形如：

```json
"tests.test_cadquery::TestCadQuery::testBoundingBox__result": {
  "status": "blocked",            // ported | blocked | skipped
  "source": "tests.test_cadquery::TestCadQuery::testBoundingBox",
  "blockedBy": "op:threePointArc",
  "manual": true                  // 手工标注，gen-manifest 重跑时保留
}
```

- `ported`：磁盘上真的有对应 `.fai.js`
- `blocked`：**必须**填 `blockedBy`（说明缺哪个 op / kernel 能力）
- `skipped`：明确不在范围内（`ref-no-step` 等）

**红线**：
1. `blocked` 必须填 `blockedBy`，**禁止**把 `blocked` 记成 `ported`；
2. **FAIL 不允许靠放宽容差改成 PASS**（容差集中定义在 `compare.ts`，不要就地改）；
3. **新增镜像文件后必须重跑 `gen-manifest.ts`**，否则 manifest 与磁盘脱节
   （历史上出现过 manifest 记 27、磁盘实际 55 的口径失真）。

### 3.2 参考侧（Python）如何产出 ref STEP

`tests/ref-harness/cq_step_plugin.py` 是一个 pytest 插件：它在**不修改上游源码**的前提下，
用 **AST 注入**在每个测试函数返回前插入「把指定变量导出成 STEP」的代码，然后跑
`v2.8.0` tag 快照里的测试模块。

产物：
- `out/ref/tests.<module>__<Class>__<test>__<var>.step`
- `out/ref/manifest.json`（case → 导出变量 → STEP 文件名的映射，比对链依赖它）

> 模块级 pytest 函数（没有 class）命名会变成 `tests.<module>___<test>__<var>`（**三个下划线**），
> `compare.ts` 里有对应的兼容处理，不要手工去改文件名。

### 3.3 候选侧（TS）如何产出 cand STEP

镜像脚本是 **faijs JS 子集**（`.fai.js`）：只允许 `let` + 字面量 + `await` 调用，
**没有** `for` / `if` / 函数定义等（写镜像时最容易踩的坑）。示例：

```js
// source: test_cadquery.py::TestCadQuery::testClosedShell (var s1)
// s1 = Workplane("XY").box(2, 2, 2).shell(-0.1)
// Closed hollow, walls inward: 12 faces, vol 2.168 (= 8 - 1.8^3).
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane('XY'), 2, 2, 2)
let s1 = await cq.shell(b, -0.1)
let result = cq.val(s1)
```

**命名映射**（`compare.ts` 自动做，但写文件时必须遵守）：

```
ref  : out/ref/tests.test_cadquery__TestCadQuery__testBox__r.step
mirror: tests/test_cadquery/TestCadQuery__testBox__r.fai.js
cand : out/cand/TestCadQuery__testBox__r.step
```

脚本必须以 `let result = cq.val(...)` 结尾，变量名要与 ref 的 `__var__`（上例 `r`）一致。

**多体用例约定（重要，踩过坑）**：
ref 导出的是上游 `objects[0]`，**只含第一个实体**。所以 `combine=False` / 多点 eachpoint 的用例，
镜像里**只 push 第一个点**（例如 `pushPoints(wp, [[-2, 0]])` 而非完整点阵）。
违反会表现为体积差 100%、bbox 成倍偏大。完整 compound 的几何由 `src/*.test.ts` 单测覆盖，
**不在 STEP 比对里验证**。

### 3.4 比对判据（`tests/compare.ts` + `src/step-compare.ts`）

对每个 ref/cand 配对计算：

| 指标 | 判据 |
|---|---|
| 体积相对差 | `volume.diffPct <= 0.1`（%） |
| 质心最大分量差 | `centerOfMass.maxDiff <= 1e-3` |
| 包围盒最大分量差 | `bbox.maxDiff <= 1e-3` |
| 布尔差体体积（A−B 与 B−A） | 各 `<= 0.1` |
| 拓扑（faces/edges/vertices） | 相等 → `PASS`；不等但数值全过 → `PASS-NT` |

调用参数固定为 `{ strictTopology: false, linearTolerance: 1e-3, volumeRelativeTolerance: 1e-3 }`。

`parity = (PASS + PASS-NT) / refCases`，分母是 **ref 全量 650**，所以阻塞项会实打实拉低 parity，
口径不能靠删 ref 作弊。

---

## 4. 完整命令手册

> 以下均在 `D:\Faicad\faijs` 下执行。若用 PowerShell，注意 `npx` 需要走 shell（脚本里已处理）。

### 4.0 首次接手：安装与构建

```bash
# 装依赖（网络受限时用国内镜像）
npm install --registry=https://registry.npmmirror.com

# 构建（顺序很重要：core → 门面 → cq-compat）
npm run build -w @faicad/faijs-core
npm run build                 # 根门面（会先 clean dist）
npm run build -w @faicad/cq-compat
```

> ⚠️ **构建顺序是硬约束**：`packages/core/dist` 经常落后于 `src`；改了 core 后不先 build core，
> 下游包会报 `${symbol} 不存在`。workspace 链接缺失时重跑 `npm install`。

### 4.1 参考 STEP（Python 侧）

```bash
# 产出约 650 个 STEP / 约 21 MB（已 gitignore）
C:/Users/ylt/cadquery-env/Scripts/python.exe packages/cq-compat/tests/ref-harness/run-ref.py
# 等价：npm run compat:ref
```

可加 `--modules test_cadquery,...` 限定模块、`--force` 强制重抽 tag 快照。

### 4.2 覆盖率静态分析（可选但是 gen-manifest 的输入）

```bash
C:/Users/ylt/cadquery-env/Scripts/python.exe packages/cq-compat/tests/ref-harness/analyze-coverage.py \
    --json packages/cq-compat/tests/coverage.json
```

> **已知噪音**：该脚本退出码可能是 139 / 段错误（venv 卸载 OCCT DLL 时），
> **JSON 已写完，可忽略**。

### 4.3 生成/刷新三态清单

```bash
npx tsx packages/cq-compat/tests/gen-manifest.ts
```

依赖 `out/ref/manifest.json`（所以 4.1 必须先跑）。它会保留已有手工标注（`status`/`blockedBy`/`manual`）。

### 4.4 导出候选 STEP

```bash
npx tsx packages/cq-compat/tests/run-cand.ts                 # 全量（约 20 分钟）
npx tsx packages/cq-compat/tests/run-cand.ts --only test_loft # 增量（推荐日常用）
npx tsx packages/cq-compat/tests/run-cand.ts --module test_free_functions
```

> ❗ **改了 `packages/cq-compat/src` 之后，必须先 `npm run build -w @faicad/cq-compat` 再跑 run-cand**——
> run-cand 是调 faijs CLI，CLI 经 `@faicad/cq-compat` 的 `main` 走 **dist**。
> （vitest 单测走 src alias，两者口径不同。）

### 4.5 比对出报告

```bash
npx tsx packages/cq-compat/tests/compare.ts
# 产物：packages/cq-compat/out/report.md（人读）+ out/report.json（机读）
```

一键串起来：`npm run compat:report`（= gen-manifest → run-cand → compare）。

### 4.6 测试与 CI

```bash
npm run test -w @faicad/cq-compat     # cq-compat 单测（vitest，走 src）
npm run typecheck -w @faicad/cq-compat
npm run lint -w @faicad/cq-compat
pwsh -NoProfile scripts/ci.ps1        # 全量 CI（慢，不要拿它找 bug）
```

**测试 stderr 零容忍**（CI 强制）：任何测试输出 `stderr |` 行即判失败。
测试若故意触发错误，必须在测试内 spy `console.warn/error` 并断言，禁止全局静默。

---

## 5. 已知坑与红线（按被坑概率排序）

1. **`compare.ts` 扫的是 `out/cand/*.step` 目录，不读 manifest 的 blocked 标记。**
   把一个 case 改判 blocked 后，**必须同时删掉对应的 `out/cand/<...>.step`**，否则它仍会被
   计成 FAIL。这是本项目最高频的踩坑点。
2. **改 src 后必须 build 再跑 run-cand**（见 §4.4）。改 core 则先 build core。
3. **同一文件不要并行编辑**（多个编辑会话并发写同一文件会互相覆盖，曾导致 `wedge` 导出丢失）。
4. **容差是集中定义的**，不要为了消 FAIL 就地放宽。
5. **新增镜像必须重跑 `gen-manifest.ts`**（见 §3.1 红线 3）。
6. **`.fai.js` 是受限 JS 子集**：没有 `for` / `if` / 函数定义 / 复杂表达式。写镜像前先看
   `tests/test_cadquery/` 里的现成样例。
7. **Windows 下 `spawnSync` 解析不了无扩展名的 `npx` shim**，`run-cand.ts` 里已通过 `shell: true` 处理，
   不要「优化」掉。
8. **`analyze-coverage.py` 的 139 退出码是已知噪音**，不要当成失败去修。
9. **CadQuery 检出的 HEAD 依赖 OCP 8.0.1，与 venv 的 7.9.3.1.1 不兼容**——一律用 `v2.8.0` tag 快照。
10. **`tsx` 调试脚本不能直接 `import '@faicad/cq-compat'`**（模块解析会失败）。要调试就写临时
    vitest 测试文件（模式照抄 `src/wire2d.test.ts` 的 `beforeAll` runtime 初始化）。
11. **上游语义不要停留在 CadQuery 的 Python 包装层**，用 `inspect.getsource` 逐层追到具体 OCCT 类
    （例如 `BRepBuilderAPI_MakeWire` 的 List 重载、`LocOpe_DPrism`、`MakeThickSolidByJoin`）。
12. **kernel 能力「声明存在 ≠ 可用」**：先扫 `node_modules/occt-wasm/dist/index.d.ts` 的方法清单，
    再写临时 vitest 探针实测（`offsetWire2D`、`draft` 都在实测中全线失败过）。

---

## 6. 已确认不可复刻 / 手工 block 的清单（交接时状态）

这些都是**证据充分、已判定为 OCCT-WASM 能力缺口**的，不要重复投入：

| case | blockedBy | 原因摘要 |
|---|---|---|
| `testClosedShell__s3` | 凹轮廓内偏移 | 凹棱柱内偏移时 `MakeThickSolidByJoin` 有缺口，wasm 侧无等价能力 |
| `testTaperedExtrudeHeight__s2` | 负 taper | 上游 ref 是 10 面体（4 PLANE + 4 角部 CONE，侧面积 `π·r·slant/4 = 3042.08`）。wasm 三条路全断：`offsetWire2D` 全部 JoinType 失败、`loft` 拒绝「底 4 边 vs 顶 8 边」、`draft` 直接失败 |
| `test_hollow__res2`、`test_hollow_open__res2` | 外偏移 intersection join | `t>0` 需要尖角 intersection join，kernel offset 只有 arc join（圆角） |

其余 blocked 项见 `tests/manifest.json`（`status: "blocked"`）与 `tests/mark-blocked.ts` 里的手工登记表。

## 7. 关键语义差异（写新镜像前必须知道）

1. **`MakeWire` 语义差异（最关键的隐性差异）**
   上游 CadQuery 2.8 的 `Wire.assembleEdges` 用的是 `BRepBuilderAPI_MakeWire` 的 **List 重载**，
   **保留全部边**（包括不连续的）；而 wasm `kernel.makeWire` 是**逐边**语义，会**静默丢弃**
   接不上开口端的边。cq-compat 侧用 `reorderForWireAssembly`（链尾开口端 DFS 重排）复刻；
   多段断链无法复刻（回退原序）。曾导致 `testSplineShape__r` 的样条边被丢弃、候选体退化成矩形棱柱。
2. **`kernel.shell(solid, [], +t)` = 纯内偏移体**，不是上游的 hollow。
   cq-compat `shell` 的语义：`t<0` = `solid − 内偏移体`；`t>0` = `外偏移体 − solid`。
3. **taper**：上游 `Solid.extrudeLinear` 用 `LocOpe_DPrism`，高度是 `h / cos(taper)`；
   cq-compat 用 kernel `draftPrism` 复刻，**正角（收窄）一致，负角不可复刻**。
4. **`wedge`**：kernel 没有 `makeWedge`，cq-compat 用 `loft(wires, { ruled: true })` 精确构造
   （实测体积 5.3333 命中 OCCT）。
5. **`clean` 语义**：走 `cleanShapes`（unifySameDomain），**非体积守恒**，与上游同源一致。
6. **loft 退化顶点**：vendored `loft` 支持 `startPoint` / `endPoint`（内部走 `kernel.loftWithVertices`），
   cq-compat `loft` 选项已透出。face→vertex 是 ruled 四棱锥；vertex→face→vertex 是平滑样条体
   （vol 1.0667 ≠ 直纹 0.6667）。
7. **`eachPoints(wp)`**（`pushPoints` → `currentPoint` → `origin`）是 eachpoint op 的**唯一取值入口**，
   新增 op 一律走它。
8. **raw kernel API 细节**（`getKernel()` 来自 `packages/core/src/occt-kernel/occtKernel.ts`；
   入口 `packages/core/src/vendored/brepjs/kernel/index.js`）：
   - `getSubShapes` 返回**数组**（不是 `.size()/.delete()` 向量）
   - `translate(shape, dx, dy, dz)` 三参
   - `makeBox(w, h, d)` 是**尺寸**、从原点出发
   - bbox 字段是 `xmin/xmax/ymin/ymax/zmin/zmax`（**不是** `minX/maxX`）
   - `KernelShape` = `{ __occtWasm, type, id }`，raw API 收**数字 id**

---

## 8. 当前进度与下一步（阶段 K）

阶段 A–J 全部完成，记录在 `docs/plans/2026-09-08-cq-compat-parity-phase2.md` §7.1–§7.26。

**阶段 K 候选清单（按 §7.26 的排序，直接可做）**：

- `test_loft__r4`（capped 多截面：circle / ellipse / 旋转 circle）
- `test_loft__r6`（带孔面 loft）
- `test_loft_face__*`（需要 `add(shape)` 与 compound 度量）
- `testUnionCompound__obj`
- `testPlanes__result`
- `test_findFromEdge__part2`
- `testOpenCornerShell__s`
- `test_sweep__r*`（8 项）

**推荐工作节奏**：
1. 选一批候选 → 用 `out/extract-case.py` 抠出上游源码 → 读 `docs/plans` 里同类阶段的记录；
2. 写 `.fai.js` 镜像 → `gen-manifest` → `run-cand --only <子串>` → `compare`；
3. 失败的先解剖 ref STEP 的**逐面几何类型**（PLANE/CONE/BSPLINE + 面积 + 质心）判断上游走的
   是哪条 OCCT 路径，再决定「复刻」还是「manual block」；
4. 确认不可复刻：`mark-blocked.ts` 登记 `manual: true` + 具体 `blockedBy`，并**删掉 cand STEP**；
5. 收尾：`npm run test -w @faicad/cq-compat` 全绿 + `compare` 的 FAIL=0，然后在
   `docs/plans/2026-09-08-cq-compat-parity-phase2.md` 追加 `### 7.27 阶段 K …` 记录。

---

## 9. 取证 / 调试工具箱

| 需求 | 手段 |
|---|---|
| 看某个 STEP 的体积/质心/包围盒/面数 | `C:/Users/ylt/cadquery-env/Scripts/python.exe packages/cq-compat/out/probe.py <a.step> <b.step>` |
| 抠出上游某个测试方法的源码 | `C:/Users/ylt/cadquery-env/Scripts/python.exe packages/cq-compat/out/extract-case.py TestCadQuery.testLoft` |
| 查上游某函数的真实实现（追到 OCCT 类） | `C:/Users/ylt/cadquery-env/Scripts/python.exe -c "import inspect, cadquery; print(inspect.getsource(cadquery.Solid.extrudeLinear))"` |
| 查 wasm kernel 有哪些方法 | 扫 `node_modules/occt-wasm/dist/index.d.ts` |
| 实测某个 kernel 方法能不能用 | 写临时 vitest 文件（照抄 `src/wire2d.test.ts` 的 beforeAll 初始化），不要用裸 tsx 脚本 |
| 单个镜像脚本干跑校验 | `npx tsx packages/core/scripts/faijs-cli.ts check <file.fai.js>` |
| 单个镜像脚本执行并导出 | `npx tsx packages/core/scripts/faijs-cli.ts run <file.fai.js> --out x.step --mode brep` |

---

## 10. 接手验证清单（DoD）

按顺序跑完，全部通过才算环境接住了：

- [ ] `npm run build -w @faicad/faijs-core && npm run build && npm run build -w @faicad/cq-compat` 无错误
- [ ] `C:/Users/ylt/cadquery-env/Scripts/python.exe packages/cq-compat/tests/ref-harness/run-ref.py` → `out/ref` 有 **650** 个 `.step`
- [ ] `npx tsx packages/cq-compat/tests/gen-manifest.ts` → `tests/manifest.json` 条目数不减少
- [ ] `npx tsx packages/cq-compat/tests/run-cand.ts` → `out/cand` 有 **222** 个 `.step`（全量约 20 分钟）
- [ ] `npx tsx packages/cq-compat/tests/compare.ts` → 输出 `PASS=210 PASS-NT=4 FAIL=0 ERROR=0 BLOCKED=436 parity=32.92%`
- [ ] `npm run test -w @faicad/cq-compat` → 109 passed / 0 failed
- [ ] `npm run typecheck -w @faicad/cq-compat` 无错误

若 PASS/parity 与基线不一致，**先查是不是 `out/cand` 里残留了已 block 用例的 STEP**（坑 #1）。

---

## 11. 待用户裁决的事项（不在计划内擅自决定）

见 `docs/plans/2026-09-08-cq-compat-parity-phase2.md` §8「待裁决」：

- 阶段 G（mini_lathe `slide_top` 缺口定位，难度 ★★★★）是否启动；
- 阶段 I 的深水 op / 文件 IO 一期只做评估还是实现；
- 阶段 J 远期项（Sketch / nurbs / hull）明确不在一期范围；
- parity 目标值（是否设定门槛，例如 60% 才允许宣称「可用」）。

接手方在动这几项之前**必须先拿到明确授权**。

---

## 12. 附：最小知识卡片

```
parity 链路：  run-ref.py(Python/CadQuery2.8.0) → out/ref/*.step
                                                          ↓ compare.ts
               .fai.js 镜像 → faijs CLI(brep) → out/cand/*.step

判据：volΔ% ≤ 0.1 且 CoMΔ ≤ 1e-3 且 bboxΔ ≤ 1e-3 且 双向布尔差 ≤ 0.1
      + 拓扑一致 → PASS；拓扑不一致 → PASS-NT
parity = (PASS + PASS-NT) / 650

三个必须记住的坑：
  1) block 一个 case 要同时删 out/cand/<case>.step（compare 扫目录不读 manifest）
  2) 改 src 后必须 npm run build -w @faicad/cq-compat 再 run-cand（CLI 走 dist）
  3) 新增镜像后必须重跑 gen-manifest.ts
```
