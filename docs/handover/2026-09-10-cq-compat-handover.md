# cq-compat ⇄ CadQuery parity 项目交接说明

> 首版 2026-09-10；**本版刷新 2026-09-11（基线数据、E1–E4 落地、E5/E6 缺口全部更新）**。交接对象：接手的第三方开发方 / Agent。交接范围：`faijs` monorepo 中的 `packages/cq-compat`（CadQuery 兼容层）及其 parity（几何一致性）验证体系。

---

## 0. 三分钟速览

**这个项目在做什么** 在 JS/TS（浏览器 + Node）里复刻 **CadQuery 2.8.0** 的几何建模能力，包名 `@faicad/cq-compat`，底层几何内核是 `occt-wasm`（OCCT 编译到 WebAssembly），通过 faijs 的 BREP 链路驱动。

**怎么衡量做得对不对** 用「几何一致性比对（parity）」而不是单元测试来判定：

1. 用 **Python 侧的 CadQuery 2.8.0** 跑它自己的官方测试套件，把每个测试里建模出来的变量导出成 **参考 STEP**（`out/ref/*.step`）；
2. 用 **TS 侧的 cq-compat** 写一一对应的镜像脚本（`.fai.js`），导出成 **候选 STEP**（`out/cand/*.step`）；
3. 用 OCCT 同时读回两个 STEP，比较 **体积 / 质心 / 包围盒 / 布尔差体 / 拓扑计数**，判 PASS / PASS-NT / FAIL。

**当前基线（2026-09-11 实测，`out/report.json`）**

| 指标 | 值 |
|---|---|
| 参考用例（ref STEP） | 650 |
| 已导出候选（cand STEP） | 241 |
| PASS | 228 |
| PASS-NT（数值过、拓扑不同，记录不卡门） | 4 |
| FAIL | 1（已精确归因，见 §6.1） |
| ERROR | 0 |
| BLOCKED（无候选） | 417 |
| **parity** | **35.69%** |
| cq-compat 单元测试 | 124 passed（15 files）全绿 |
| `tests/manifest.json` 条目 | 699（ported 233 / blocked 419 / skipped 47；其中手工 block 47） |

**一句话给接手方**：当前唯一 1 个 FAIL 的几何本身是对的（体积相对差 1.1e-5、拓扑逐位相同），失败的是比较器的布尔差探针在近重合 B 样条体上的鲁棒性；剩余 417 个 BLOCKED 是**还没写镜像脚本或 cq-compat 还缺算子**，不是回归。**最高性价比的下一步是把 `blockedBy: pending:mirror` 的 52 个用例写出来**（见 §8）。

### 0.1 本版相对首版的变更（2026-09-11）

| 项 | 首版（09-10） | 本版（09-11） |
|---|---|---|
| HEAD | `1df8cdb` | `651fb4e` |
| PASS / FAIL / parity | 220 / 0 / 34.46% | 228 / 1 / 35.69% |
| cand STEP | 232 | 241 |
| 单测 | 113 passed（11 files） | 124 passed（15 files） |
| 新增 cq-compat op | — | `splineFace` / `helix` / `splitFace` / `twistExtrude`（E1–E4，齿轮扩展） |
| 新发现缺口 | — | E5 `solidFromFaces` / E6 平面盖面（阻塞 `fai_cq_gears` 删 shim，见 §11） |

> ❗ **`out/` 是 gitignored 的**：接手后 `out/ref`、`out/cand`、`out/report.json` 都是空的，**第一件事是重跑参考导出**（见 §4.1）。上面的基线数字来自交付机的本地 `out/`，用于对照验收。

---

## 1. 路径清单（全部为交接时实测存在的路径）

### 1.1 仓库与相关检出

| 用途 | 绝对路径 | 备注 |
|---|---|---|
| 主仓库（faijs monorepo） | `D:\Faicad\faijs` | branch `main`，HEAD `651fb4e`；remote `origin`=github、`gitcode`=gitcode 镜像 |
| 兼容层包 | `D:\Faicad\faijs\packages\cq-compat` | 本次交接的核心 |
| 引擎包 | `D:\Faicad\faijs\packages\core` | `@faicad/faijs-core`，BREP 链 + faijs CLI |
| 齿轮库（cq-compat 的下游消费者） | `D:\Faicad\faijs\packages\fai_cq_gears` | 移植目标；因 E5/E6 缺口尚未切换，见 §11 |
| CadQuery Python 源码检出 | `C:\git\CADQ\cadquery` | **只用来 `git archive` 取 tag 快照，不用来运行** |
| mini_lathe 原始 Python 源码 | `C:\git\CADQ\mini_lathe` | origin `yuan-xy/mini_lathe`；faijs 侧移植在 `packages/mini_lathe` |
| 计划文档（**必读**） | `D:\Faicad\faijs\docs\plans\2026-09-08-cq-compat-parity-phase2.md` | 1230 行，含 A–K 全部阶段实施记录与「下一阶段候选」 |
| 齿轮扩展实施记录 | `D:\Faicad\faijs\docs\plans\2026-09-11-cq-compat-gears-extensions-e1-e4.md` | §13 实施事实 / §14 parity 镜像结论，**新增 op 前必读** |
| 上一版总体设计 | `D:\Faicad\faijs\docs\plans\2026-09-08-cq-compat-cadquery-parity.md` | 比对判据 §7.2、harness §4–§5 |

> ⚠️ **安全提示（仍成立）**：`.git/config` 里 `gitcode` remote 的 URL 内嵌了一个 OAuth2 token（`https://oauth2:<token>@gitcode.com/...`）。交接给第三方前请**轮换该 token**或改用凭据管理器。
>
> ⚠️ **`cq_gears` Python 源在本机不存在**：`C:\git\CADQ\` 只有 `cadquery` 与 `mini_lathe`，`cadquery-env` 的 `site-packages` 也没有 gear 包。因此 `fai_cq_gears` 的 P2–P5（14 个齿轮类）**无法在本机逐字对照 Python 源翻译**；SpurGear 不受影响（v1 已有映射与注释）。详见 §11。

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

> ❗ **CadQuery 源码检出的坑**：`C:\git\CADQ\cadquery` 当前 HEAD 是 `a6bedc0`（`v2.8.0-20`，提交信息 "Try OCP 8.0.1"），它依赖 **OCP 8.0.1**，与 venv 里装的 7.9.3.1.1 **不兼容**。所以所有参考数据一律以 **`v2.8.0` tag 快照**为准，通过 `git -C <src> archive v2.8.0 tests` 抽到 `packages/cq-compat/out/cache/v2.8.0/tests`（**只读快照，不要改用户检出**）。

---

## 2. 目录结构导览（cq-compat）

```
packages/cq-compat/
  src/
    index.ts              # cq-compat 公共导出面（Workplane / box / shell / wedge / loft / wire2d /
                          #   splineFace / helix / splitFace / twistExtrude …）
    workplane.ts          # 【核心】Workplane 与各建模 op 的实现，绝大多数改动发生在这里
                          #   （齿轮扩展区在文件尾部，见 E1–E4）
    step-compare.ts       # STEP 等价性比对（体积/质心/bbox/布尔差/拓扑）
    transpile.ts          # 上游 Python 用例 → .fai.js 镜像的辅助
    assembly.ts / assembly-compare.ts / browser.ts
    gear-test-harness.ts  # 【测试用】原生内核 harness（非 .test.ts，不进 vitest 用例）
    *.test.ts             # 单元测试（vitest，走 src alias）
  tests/
    baseline.json         # 版本锁定（见上）
    manifest.json         # 【三态唯一事实源】ported / blocked / skipped（699 条）
    coverage.json         # 上游用例 AST 静态分析结果（分类 + 首个缺失 op）
    gen-manifest.ts       # 由 out/ref/manifest.json + coverage.json + 磁盘镜像 → manifest.json
    mark-blocked.ts       # 手工登记「不可复刻」的 block 标注（manual: true，会被 gen-manifest 保留）
    run-cand.ts           # 遍历镜像 .fai.js → 调 faijs CLI → out/cand/*.step
    compare.ts            # ref/cand 配对比对 → out/report.{md,json}
    ref-harness/
      cq_step_plugin.py   # pytest 插件：AST 注入导出语句，拦截测试变量
      run-ref.py          # 参考 STEP 导出驱动（git archive tag 快照）
      analyze-coverage.py # 上游用例静态分析 → coverage.json
    test_cadquery/        # 镜像用例（169 个 .fai.js + 9 个 .fai.js.blocked）
    test_free_functions/  # 52 + 1
    test_workplanes/      # 8
    test_shapes/          # 5
    test_selectors/       # 4 + 1
    test_cad_objects/     # 1
    README.md / README.zh.md  # **先读这个**，含命令与红线
  out/                    # 全部 gitignore（.gitignore: `out/`）
    cache/v2.8.0/tests/   # 上游测试源码快照（1.5 MB）
    ref/                  # 参考 STEP（650 个）+ manifest.json
    cand/                 # 候选 STEP（交付机 241 个）
    report.md / report.json
    probe.py              # 取证：打印 STEP 的体积/质心/bbox/面数
    extract-case.py       # 取证：从 cache 快照里抠出上游某个测试方法的源码
```

> `out/` 被 gitignore：**接手后第一件事是重跑参考导出**（见 §4.1），否则 `out/ref` 为空，比对链无法工作。

---

## 3. 一致性比对机制（本项目的核心，务必吃透）

### 3.1 三态清单 `tests/manifest.json`

**粒度是「用例 + 变量」**（一个上游测试会导出多个变量，每个变量一个 STEP、一个镜像脚本）。每个 entry 形如：

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
- `skipped`：明确不在范围内（`ref-no-step` / `importStep` 组等）

**红线**：

1. `blocked` 必须填 `blockedBy`，**禁止**把 `blocked` 记成 `ported`；
2. **FAIL 不允许靠放宽容差改成 PASS**（容差集中定义在 `compare.ts`，不要就地改）；
3. **新增镜像文件后必须重跑 `gen-manifest.ts`**，否则 manifest 与磁盘脱节（历史上出现过 manifest 记 27、磁盘实际 55 的口径失真）；
4. **根因是内核/比较器限制 → 记 `blocked`（把根因写进 `blockedBy`）；根因是 cq-compat 几何差异 → 记 `FAIL`**。不允许把几何错误伪装成 `blocked` 来美化 parity。

### 3.2 参考侧（Python）如何产出 ref STEP

`tests/ref-harness/cq_step_plugin.py` 是一个 pytest 插件：它在**不修改上游源码**的前提下，用 **AST 注入**在每个测试函数返回前插入「把指定变量导出成 STEP」的代码，然后跑 `v2.8.0` tag 快照里的测试模块。

产物：

- `out/ref/tests.<module>__<Class>__<test>__<var>.step`
- `out/ref/manifest.json`（case → 导出变量 → STEP 文件名的映射，比对链依赖它）

> 模块级 pytest 函数（没有 class）命名会变成 `tests.<module>___<test>__<var>`（**三个下划线**），`compare.ts` 里有对应的兼容处理，不要手工去改文件名。

### 3.3 候选侧（TS）如何产出 cand STEP

镜像脚本是 **faijs JS 子集**（`.fai.js`）：只允许 `let` + 字面量 + `await` 调用，**没有** `for` / `if` / 函数定义等（写镜像时最容易踩的坑）。示例：

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

**多体用例约定（重要，踩过坑）**：ref 导出的是上游 `objects[0]`，**只含第一个实体**。所以 `combine=False` / 多点 eachpoint 的用例，镜像里**只 push 第一个点**（例如 `pushPoints(wp, [[-2, 0]])` 而非完整点阵）。违反会表现为体积差 100%、bbox 成倍偏大。完整 compound 的几何由 `src/*.test.ts` 单测覆盖，**不在 STEP 比对里验证**。

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

`parity = (PASS + PASS-NT) / refCases`，分母是 **ref 全量 650**，所以阻塞项会实打实拉低 parity，口径不能靠删 ref 作弊。

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

> ⚠️ **构建顺序是硬约束**：`packages/core/dist` 经常落后于 `src`；改了 core 后不先 build core，下游包会报 `${symbol} 不存在`。workspace 链接缺失时重跑 `npm install`。

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

> **已知噪音**：该脚本退出码可能是 139 / 段错误（venv 卸载 OCCT DLL 时），**JSON 已写完，可忽略**。

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

> ❗ **改了 `packages/cq-compat/src` 之后，必须先 `npm run build -w @faicad/cq-compat` 再跑 run-cand**——run-cand 是调 faijs CLI，CLI 经 `@faicad/cq-compat` 的 `main` 走 **dist**。（vitest 单测走 src alias，两者口径不同。）

### 4.5 比对出报告

```bash
npx tsx packages/cq-compat/tests/compare.ts
# 产物：packages/cq-compat/out/report.md（人读）+ out/report.json（机读）
```

一键串起来：`npm run compat:report`（= gen-manifest → run-cand → compare）。

### 4.6 测试与 CI

```bash
npm run test -w @faicad/cq-compat     # cq-compat 单测（vitest，走 src；约 5 分钟）
npm run typecheck -w @faicad/cq-compat
npm run lint -w @faicad/cq-compat
npm run doc-sync                      # 全仓文档门禁（提交前必过）
pwsh -NoProfile scripts/ci.ps1        # 全量 CI（慢，不要拿它找 bug）
```

**测试 stderr 零容忍**（CI 强制）：任何测试输出 `stderr |` 行即判失败。测试若故意触发错误，必须在测试内 spy `console.warn/error` 并断言，禁止全局静默。

---

## 5. 已知坑与红线（按被坑概率排序）

1. **`compare.ts` 扫的是 `out/cand/*.step` 目录，不读 manifest 的 blocked 标记。** 把一个 case 改判 blocked 后，**必须同时删掉对应的 `out/cand/<...>.step`**，否则它仍会被计成 FAIL。这是本项目最高频的踩坑点。
2. **改 src 后必须 build 再跑 run-cand**（见 §4.4）。改 core 则先 build core。
3. **同一文件不要并行编辑**（多个编辑会话并发写同一文件会互相覆盖，曾导致 `wedge` 导出丢失）。
4. **容差是集中定义的**，不要为了消 FAIL 就地放宽。
5. **新增镜像必须重跑 `gen-manifest.ts`**（见 §3.1 红线 3）。
6. **`.fai.js` 是受限 JS 子集**：没有 `for` / `if` / 函数定义 / 复杂表达式。写镜像前先看 `tests/test_cadquery/` 里的现成样例。
7. **Windows 下 `spawnSync` 解析不了无扩展名的 `npx` shim**，`run-cand.ts` 里已通过 `shell: true` 处理，不要「优化」掉。
8. **`analyze-coverage.py` 的 139 退出码是已知噪音**，不要当成失败去修。
9. **CadQuery 检出的 HEAD 依赖 OCP 8.0.1，与 venv 的 7.9.3.1.1 不兼容**——一律用 `v2.8.0` tag 快照。
10. **`tsx` 调试脚本不能直接 `import '@faicad/cq-compat'`**（模块解析会失败）。要调试就写临时 vitest 测试文件（模式照抄 `src/wire2d.test.ts` 的 `beforeAll` runtime 初始化）。
11. **上游语义不要停留在 CadQuery 的 Python 包装层**，用 `inspect.getsource` 逐层追到具体 OCCT 类（例如 `BRepBuilderAPI_MakeWire` 的 List 重载、`LocOpe_DPrism`、`MakeThickSolidByJoin`）。
12. **kernel 能力「声明存在 ≠ 可用」**：先扫 `node_modules/occt-wasm/dist/index.d.ts` 的方法清单，再写临时 vitest 探针实测（`offsetWire2D`、`draft`、`sweepOriented(auxSpine)` 都在实测中失败过）。
13. **【新增】直接调原生 kernel op 前必须配 `configureBackends`**（E1–E4 实施时踩到，见 §7.12）。`registerOcctBrepEngine()` 只初始化原生单例 + 注册引擎，**不**调 `configureBackends`；不配就调 op 会抛 "backends not configured"。也**不要**用 `createRuntime(ports,'brep')`——它的 `kernel.brep` 只在 `runtime.execute` 内惰性填充，直接调 op 取到 null。
14. **【新增】近重合 B 样条实体上的 `BRepAlgoAPI_Cut` 会单向失败**：`A−B` 正确、`B−A` 返回整体积。这不是构造 bug（几何逐位一致、STEP 往返后稳定复现），见 §6.1 与 §6.3-1。遇到「布尔差 = 全量体积」先怀疑它，不要盲改几何。
15. **【新增】occt-wasm 的 STEP 导出对裸 wire 有损**：helix 控制点 24 vs CadQuery 85，往返后长度 51.2505 → 44.1568。**影响面：所有以裸 wire/曲线为导出对象的 parity 用例**；面/实体用例不受影响（几何承载在面上）。见 §6.3-2。

---

## 6. 不可复刻 / 手工 block 的清单（交接时状态）

这些都已**证据充分、判定为 OCCT-WASM 或比较器能力缺口**，不要重复投入。登记落在 `tests/mark-blocked.ts` 的 `BY_KEY`（`manual: true`，会被 `gen-manifest` 保留），同时镜像文件改名为 `<name>.fai.js.blocked` 并删除对应 `out/cand/*.step`。

### 6.1 唯一 FAIL（如实保留，不是漏修）

| case | 状态 | 原因摘要 |
|---|---|---|
| `tests.test_cadquery__TestCadQuery__testMultisectionSweep__circletorectSweep` | **FAIL** | 直线脊线、截面已按位摆放 → multisection sweep ≡ smooth loft，镜像用 `cq.loft` 复刻：体积相对差 **1.1e-5**（75.5180 vs ref 75.5172，Δ 0.00085 mm³）、质心 1.03e-9、bbox 1.76e-5、**拓扑 f7/e15/v10 与 ref 逐位相同**，但布尔差探针返回 **75.517/75.518（= 全量）**：OCCT 在两个近重合 B 样条体上确定性失败（python OCCT 7.9 与 occt-wasm 均复现，common=0、cut 返回全量）。真实差异远低于 0.1 mm³ 布尔容差 → **工具限制而非几何不符，按红线 4 如实保留 FAIL 并归因**（见 phase2 计划 §7.29） |

> 交叉验证：让 cadquery 2.8.0 自己 `loft` 同一组截面得 75.2317，比 ref（75.5172）离得更远；faijs 的 75.5180 反而是更准的近似。所以这不是「我们做错了」。

### 6.2 kernel / 上游能力缺口（历史 block）

| case | blockedBy | 原因摘要 |
|---|---|---|
| `testClosedShell__s3` | 凹轮廓内偏移 | 凹棱柱内偏移时 `MakeThickSolidByJoin` 有缺口，wasm 侧无等价能力 |
| `testTaperedExtrudeHeight__s2` | 负 taper | 上游 ref 是 10 面体（4 PLANE + 4 角部 CONE，侧面积 `π·r·slant/4 = 3042.08`）。wasm 三条路全断：`offsetWire2D` 全部 JoinType 失败、`loft` 拒绝「底 4 边 vs 顶 8 边」、`draft` 直接失败 |
| `test_hollow__res2`、`test_hollow_open__res2` | 外偏移 intersection join | `t>0` 需要尖角 intersection join，kernel offset 只有 arc join（圆角） |
| `test_loft__r4` | `kernel:loft-coplanar-sections` | w1/w2 **共面**（都在 z=0）。occt-wasm `loft` 不暴露上游 `BRepOffsetAPI_ThruSections` 的 C2 continuity / uniform parametrization / degree / CheckCompatibility。非共面对照全部吻合（3 圆 12.566370；圆/椭圆/圆 16.755155），共面时 **19.798698 vs 上游 17.148726** |
| `testSimpleShell__s1`、`__s3` | `kernel:shell-outward-opening` | 正厚度 + 移除面（`MakeThickSolidByJoin` 外扩），kernel 只有 arc offset。试过「按移除面外法向切扫掠板」的启发式：s1 vol **1.047647 vs ref 1.031678**（布尔差 0.016，30 faces vs 23）、s3 **410.235431 vs 332.597162** → 已回滚为**显式抛错** |
| `testSimpleShell__s2` | `kernel:shell-intersection-join` | 同上的外扩，且需要 intersection join |
| `testEdgeTypesFilter__c` | `kernel:ellipse-tall-axis` | 内核椭圆**主轴恒在全局 X**（忽略 plane 自身轴）且拒绝 major < minor（`gp_Elips`）。高椭圆只能靠旋转，而 `applyMatrix` 走 `generalTransformWithHistory` 会重拟合（体积漂 +0.4%），plain `transform` / `rotate` 产出的 wire 被 `makeFace` 判为非平面 → 显式抛错 |
| `test_loft_to_vertex__c` | `ref:degenerate-compound-vertex` | 导出值是 `compound(plane(1,1), vertex(0,0,1))`，ref STEP 为退化 compound（vol **−0.037037**，单个孤立面），comparator 的布尔差探针直接失败 → 无候选可评分 |
| `testMultisectionSweep__specialSweep/arcSweep/normalSweep` | `op:sweep.multisection` | 非直线路径或路径相对摆放，需真实 MakePipeShell 多截面（内核只有单 profile sweep + loft 式 multisection 近似）。specialSweep 的 ref 还依赖 B 样条外插（bbox 超出截面跨度 ~1.09/侧） |
| `testSweep__result`、`test_sweep_aux__r1/r2` | `op:sweep.aux-spine` | 辅助脊线（binormal 旋转）；内核 `sweepPipeShell` legacy 路径**静默丢弃** auxiliary spine，等价几何不可达 |
| `test_sweep__r5~r8` | `op:sweep.pipeshell` | 自由函数 sweep() 作用于**面**/内 wire、B 样条脊线——profile 由脊线摆放（pipeShell 语义），不能用 as-is 截面 loft 复刻 |

### 6.3 E1–E4 齿轮扩展原语的 block（2026-09-11 新增，**给 fai_cq_gears 与后续原生 op 复用**）

E1–E4 已实现并导出（`splineFace` / `helix` / `splitFace` / `twistExtrude`），但 parity 层只有 E3 能判分：

| op | 镜像 | 状态 | 本质（实测证据） |
|---|---|---|---|
| E3 `splitFace` | `TestCadQuery__testSplitKeeping{Bottom,Half,Both}__result.fai.js` | **PASS ×3** | volDiffPct 1.9e-6、centroid 7e-9、bbox 2e-7、bool [0,0]、拓扑 f8/e18/v12 全等 |
| E4 `twistExtrude` | `…testTwistExtrude__r.fai.js.blocked` | BLOCKED | 几何机器精度一致（volDiffPct 2.6e-5 %、centroid 3.6e-14、顶点全等、拓扑 f6/e12/v8），但布尔差单向失败 |
| E2 `helix` | `…testMakeHelix__r.fai.js.blocked` | BLOCKED | 内存中 wire 精确（len 51.250548550 vs ref 51.250549089），导出后劣化（STEP 保真度） |
| E1 `splineFace` | `TestFace__testSplineApproxPoly__r.fai.js.blocked` | BLOCKED | 与 `Face.makeSplineApprox` 在多项式网格上逐位一致（area 1608.303209872）；主因是**比较器对非实体无 volume/CoM 定义**（实测 volPct 575 %、centroid 9.5e15，而 bbox 4.4e-16、拓扑 f1/e4/v4 全等） |

1. **E4 `twistExtrude`（`kernel:boolean-near-coincident-bspline`）**。上游走 `Solid.extrudeLinearWithRotation` → `BRepOffsetAPI_MakePipeShell(spine).SetMode(auxSpine=helix, False).MakeSolid()`；cq-compat 用「离散旋转截面 + 平滑 loft」逼近（顶点与 ref 逐位一致，体积差 2.6e-7）。近重合时 `BRepAlgoAPI_Cut` **单向失败**：`A−B=2.6e-4`（正确），`B−A=999.99`（=整体积，`isValid=true`）。与截面数无关（4/8/16/32/64/128 在 in-process 下 0/1000 抖动），经 STEP 往返后稳定复现。occt-wasm 的 `sweepOriented(..., SweepMode.Auxiliary, ..., auxSpine)` 复刻上游算法反而更差（vol 999.83，偏离 0.17 %），故保留 loft。
2. **E2 `helix`（`kernel:step-export-wire-fidelity`）**。内存 wire 精确；`kernel.exportStep` 写出的 helix B 样条控制点明显少于 CadQuery（24 vs 85 个 `CARTESIAN_POINT`），往返后长度 51.2505491 → **44.1568406**、bbox 偏 5.4e-3。**影响面**：所有以裸 wire/曲线为导出对象的 parity 用例（面/实体用例不受影响）。
3. **E1 `splineFace`（`comparator:non-solid-metrics`，主因）**。面是非实体，`volume`/`centre-of-mass` 无定义；bbox 与拓扑全等。**曲面算法差异已不是主因**：E1 默认改用 S2 `row-approx-loft` 后，在齿面网格上与 `Face.makeSplineApprox` 等价到 4.2e-11（直纹）/ 5.6e-7（螺旋）。历史背景：`grid` 策略（occt-wasm `bsplineSurface`）实测对网格**插值**，而 `makeSplineApprox` 是 `GeomAPI_PointsToBSplineSurface(DegMin=1, DegMax=3, Tol3D=1e-2)` 的 ≤3 次**逼近**；二者仅在多项式网格上逐位一致。
4. **更正（重要）**：CadQuery 2.8.0 **没有 `Face.makeSplineSurface`**（全仓 grep 零命中），B 样条曲面只有 `Face.makeSplineApprox`。若齿廓需要 ≤3 次逼近曲面，occt-wasm 当前**无对应原语**（缺口需向 occt-wasm 或 vendored 层申请 `GeomAPI_PointsToBSplineSurface` 投影）。
5. **复现 E1/E2 的 ref**：本批未把 E1/E2 的自定义 ref 计入 `refCases`（保持与 `run-ref.py` 上游口径一致，避免口径失真）；配方写在对应 `.fai.js.blocked` 注释里，解除 block 时按配方用 cadquery-env 重新导出 STEP 并 upsert `out/ref/manifest.json`。

---

## 7. 关键语义差异（写新镜像前必须知道）

1. **`MakeWire` 语义差异（最关键的隐性差异）** 上游 CadQuery 2.8 的 `Wire.assembleEdges` 用的是 `BRepBuilderAPI_MakeWire` 的 **List 重载**，**保留全部边**（包括不连续的）；而 wasm `kernel.makeWire` 是**逐边**语义，会**静默丢弃**接不上开口端的边。cq-compat 侧用 `reorderForWireAssembly`（链尾开口端 DFS 重排）复刻；多段断链无法复刻（回退原序）。曾导致 `testSplineShape__r` 的样条边被丢弃、候选体退化成矩形棱柱。
2. **`kernel.shell(solid, [], +t)` = 纯内偏移体**，不是上游的 hollow。cq-compat `shell` 的语义：`t<0` = `solid − 内偏移体`；`t>0` = `外偏移体 − solid`。
3. **taper**：上游 `Solid.extrudeLinear` 用 `LocOpe_DPrism`，高度是 `h / cos(taper)`；cq-compat 用 kernel `draftPrism` 复刻，**正角（收窄）一致，负角不可复刻**。
4. **`wedge`**：kernel 没有 `makeWedge`，cq-compat 用 `loft(wires, { ruled: true })` 精确构造（实测体积 5.3333 命中 OCCT）。
5. **`clean` 语义**：走 `cleanShapes`（unifySameDomain），**非体积守恒**，与上游同源一致。
6. **loft 退化顶点**：vendored `loft` 支持 `startPoint` / `endPoint`（内部走 `kernel.loftWithVertices`），cq-compat `loft` 选项已透出。face→vertex 是 ruled 四棱锥；vertex→face→vertex 是平滑样条体（vol 1.0667 ≠ 直纹 0.6667）。
7. **`eachPoints(wp)`**（`pushPoints` → `currentPoint` → `origin`）是 eachpoint op 的**唯一取值入口**，新增 op 一律走它。
8. **raw kernel API 细节**（`getKernel()` 来自 `packages/core/src/occt-kernel/occtKernel.ts`；入口 `packages/core/src/vendored/brepjs/kernel/index.js`）：
   - `getSubShapes` 返回**数组**（不是 `.size()/.delete()` 向量）
   - `translate(shape, dx, dy, dz)` 三参
   - `makeBox(w, h, d)` 是**尺寸**、从原点出发
   - bbox 字段是 `xmin/xmax/ymin/ymax/zmin/zmax`（**不是** `minX/maxX`）
   - `KernelShape` = `{ __occtWasm, type, id }`，raw API 收**数字 id**
9. **椭圆的轴向是硬约束**：内核椭圆**主轴恒在全局 X**（忽略 plane 自身轴），且 `major >= minor`（否则 `gp_Elips: invalid construction parameters`）。`x_radius > y_radius` 的椭圆直接构造即可；`y_radius > x_radius` 的「高椭圆」**不可复刻**（旋转入口都会重拟合曲线）→ cq-compat 显式抛错，不静默输出近似椭圆。
10. **面截面 loft 走的是「缝合」不是「多 wire 截面」**：上游 `cadquery/func.py::loft` 对 face 截面先对**外**轮廓建一个 `BRepOffsetAPI_ThruSections(cap=True)`，再对**每个内孔索引**各建一个独立 ThruSections，最后 `solid(side, *sides, top, bot)` 缝成一个实体并把内孔 cap 从外 cap 上减掉。等价于**capped 实体求差**——实测 `loft(f1, f2)` 与 `loft(outer) − Σ loft(inner_k)` 的 vol（3.047991271384902）与面数（16）完全一致，因此镜像用现成 op 分解即可，**不需要** kernel 支持「每截面多 wire」。
11. **`ellipse` / `face` / `vertex` 是 cq-compat 公开 op**（分别对应上游 `ellipse(x_r, y_r)` / `face(*wires)` / `vertex(x, y, z)`），底层是 core `api/brepjs-compat` 的 `makeEllipseEdge` / `makeFace` / `makeVertex` 投影。
12. **【新增·E1–E4】** occt-wasm 原生内核的三个硬陷阱（实测）：
    - **`Vec3` 是 `{x,y,z}` 对象，不是 `[x,y,z]` 元组**——传点参数必须 `(t)=>({x:t[0],y:t[1],z:t[2]})`，否则 `.x` 为 undefined → 几何全 NaN（crate 侧读 `origin.x/.y/.z` 与 `#flattenPoints` 的 `p.x/.y/.z`）。
    - **`fromHandle` 依赖 `configureBackends({kernel:{brep:getKernel()}})`**（见 §5 坑 13）。
    - **原生 `rotate(shape, {point,direction}, angleRad)` 收弧度**且轴是 `{ point, direction }` 对象；CadQuery 的 `twistExtrude(angle=deg)` 要自行 `angle*t*π/180`。
13. **【新增·E1–E4】`splineFace` 有两个策略**：默认 `strategy: 'row-approx-loft'`（S2：逐行 `approximatePoints(tol=1e-2)` → `makeWire` → `loft` → 取唯一 face，命中 §4.5 精度要求），可选 `'grid'`（occt-wasm `bsplineSurface`，**插值**语义，仅作对照）。API 签名见 `index.ts` 导出：`splineFace(wp, grid, {rows, cols, tolerance?})`。

---

## 8. 当前进度与下一步

阶段 A–K 全部完成，记录在 `docs/plans/2026-09-08-cq-compat-parity-phase2.md` §7.1–§7.29；**齿轮扩展 E1–E4 也已落地**，记录在 `docs/plans/2026-09-11-cq-compat-gears-extensions-e1-e4.md` §13–§14。

### 8.1 剩余 BLOCKED 的自动归因分布（gen-manifest 从 coverage 推导，交付机实测）

| blockedBy | 条数 | 说明 |
|---|---|---|
| `Assembly` | 56 | Assembly 类未移植（依赖装配求解器，远期） |
| **`pending:mirror`** | **52** | **上游用例的 op 已齐、只差写镜像——最高性价比，建议优先** |
| `stub:makeBox` | 33 | 上游测试基类 helper（`makeBox` 等）未支持 |
| `split` / `face` | 13 / 13 | 需对应 op 语义补齐（如 `split` 平面裁切扩展、`face` 构造入口） |
| `siblings` / `shells` | 12 / 12 | 选择器/构造器语义缺口 |
| `getfixturevalue` | 11 | 依赖 pytest fixture，无法 AST 导出 |
| `text` / `images` / `importStep` | 9 / 8 / 8 | 字体、贴图、文件 IO（**需裁决是否整组 skipped**，见 §11 Q2） |
| `makeCompound` / `eachpoint` / `generated` | 8 / 7 / 7 | compound 构造、多点语义、生成式用例 |
| `finalize` / `raises` | 6 / 6 | 上游 helper 语义（异常路径用例） |
| `interpPlate` / `remove` / `importBrep` / `tag` / `replace` | 5 / 5 / 4 / 4 / 4 | 各缺一个 op |
| `step-export:faces-compound` | 4 | candid 导出面 compound 时的 STEP 保真度 |
| `op:shape.offset` / `op:sweep.pipeshell` | 4 / 4 | 内核 offset / sweep 能力缺口 |

> `pending:mirror` 的例子：`testCutBlindUntilFace__wp_ref_regular_cut`、`testToSVG__r`、`test_faceOn__f2` 等。做法就是从 `out/cache/v2.8.0/tests` 抠出上游源码 → 写 `.fai.js` → `gen-manifest` → `run-cand --only <子串>` → `compare`。

### 8.2 推荐工作节奏

1. 选一批候选 → 用 `out/extract-case.py` 抠出上游源码 → 读 `docs/plans` 里同类阶段的记录；
2. 写 `.fai.js` 镜像 → `gen-manifest` → `run-cand --only <子串>` → `compare`；
3. 失败的先解剖 ref STEP 的**逐面几何类型**（PLANE/CONE/BSPLINE + 面积 + 质心）判断上游走的是哪条 OCCT 路径，再决定「复刻」还是「manual block」；
4. 确认不可复刻：`mark-blocked.ts` 登记 `manual: true` + 具体 `blockedBy`，并**删掉 cand STEP**；
5. 收尾：`npm run test -w @faicad/cq-compat` 全绿 + `compare` 的 FAIL 数不增加，然后在 phase2 计划追加 `### 7.2x 阶段 K …` 记录（**并保持本交接文档 §0 的基线表同步**）。

### 8.3 cq-compat 的下游消费者：`fai_cq_gears`

`packages/fai_cq_gears` 是 cq-compat 的**硬阻塞消费者**（架构决策见 `docs/plans/2026-09-11-fai-cq-gears-port.md` §1）。E1–E4 落地后它的 `src/kernel.ts` 临时 shim 本应删除，但实测**还差两个 cq-compat 原语才能删干净**（E5/E6，见 §11）。接手方若先做 cq-compat 本体 parity，可暂不动 `fai_cq_gears`。

---

## 9. 取证 / 调试工具箱

| 需求 | 手段 |
|---|---|
| 看某个 STEP 的体积/质心/包围盒/面数 | `C:/Users/ylt/cadquery-env/Scripts/python.exe packages/cq-compat/out/probe.py <a.step> <b.step>` |
| 抠出上游某个测试方法的源码 | `C:/Users/ylt/cadquery-env/Scripts/python.exe packages/cq-compat/out/extract-case.py TestCadQuery.testLoft` |
| 查上游某函数的真实实现（追到 OCCT 类） | `C:/Users/ylt/cadquery-env/Scripts/python.exe -c "import inspect, cadquery; print(inspect.getsource(cadquery.Solid.extrudeLinear))"` |
| 查 wasm kernel 有哪些方法 | 扫 `node_modules/occt-wasm/dist/index.d.ts` |
| 实测某个 kernel 方法能不能用 | 写临时 vitest 文件（照抄 `src/wire2d.test.ts` 的 beforeAll 初始化），不要用裸 tsx 脚本 |
| 原生内核 op 的测试 harness | 复用 `src/gear-test-harness.ts`（`setupNativeKernel` / `kernel` / `mkWP` / `bbox` / `area`），注意其中 `configureBackends` 的写法 |
| 单个镜像脚本干跑校验 | `npx tsx packages/core/scripts/faijs-cli.ts check <file.fai.js>` |
| 单个镜像脚本执行并导出 | `npx tsx packages/core/scripts/faijs-cli.ts run <file.fai.js> --out x.step --mode brep` |

---

## 10. 接手验证清单（DoD）

按顺序跑完，全部通过才算环境接住了：

- [ ] `npm run build -w @faicad/faijs-core && npm run build && npm run build -w @faicad/cq-compat` 无错误
- [ ] `C:/Users/ylt/cadquery-env/Scripts/python.exe packages/cq-compat/tests/ref-harness/run-ref.py` → `out/ref` 有 **650** 个 `.step`
- [ ] `npx tsx packages/cq-compat/tests/gen-manifest.ts` → `tests/manifest.json` 条目数不减少（基线 699）
- [ ] `npx tsx packages/cq-compat/tests/run-cand.ts` → `out/cand` 有 **241** 个 `.step`（全量约 20 分钟）
- [ ] `npx tsx packages/cq-compat/tests/compare.ts` → 输出 `PASS=228 PASS-NT=4 FAIL=1 ERROR=0 BLOCKED=417 parity=35.69%`
- [ ] `npm run test -w @faicad/cq-compat` → **124 passed / 0 failed（15 files）**
- [ ] `npm run typecheck -w @faicad/cq-compat` 无错误
- [ ] `npm run doc-sync` 全绿

若 PASS/parity 与基线不一致，**先查是不是 `out/cand` 里残留了已 block 用例的 STEP**（坑 #1）。另注意 `out/cand` 里可能有若干形如 `<case>.step_0_*` / `.step_1_*` 的中间产物（多步导出残留），它们不参与配对计分，属于无害噪音。

---

## 11. 待裁决事项（不在计划内擅自决定）

**沿用 phase2 计划 §8 的开放问题**（`docs/plans/2026-09-08-cq-compat-parity-phase2.md:821`）：

- **Q1**：参考基线用 `v2.8.0` tag（现状）还是本地 dev HEAD `a6bedc0`（需换 OCP 8.0.1）？
- **Q2**：`importStep` / `load` / `save` / `export` 组（46 var）是否整组标 `skipped`？
- **Q3**：`parity score` 是否作为发版门禁（如 ≥60% 才准 pack）？
- **Q4**：阶段 B 的 288 var 是否**全量推进**到「写不出来为止」，还是先只做与 coverage PORTABLE 交集的那一批（约 174 case / 318 var）？
- **Q5**：阶段 F1 的 `pendingWires` 改造若导致旧镜像回归，是**回退改造**还是**修旧镜像**？

**本版新增（2026-09-11）**：

- **Q6【高】**：`fai_cq_gears` 的 E5/E6 缺口是否现在补？——删 shim 还差两个 cq-compat 原语：
  - **E5 `solidFromFaces`**（sew + makeSolid + fixFaceOrientations）：cq-compat 现有 op 里没有 sew/makeSolid/solidify（`shell` 是抽壳，不是缝合）；v1 `spur_gear.ts:126-132` 依赖原生 `kernel.sew/makeSolid/fixFaceOrientations`。
  - **E6 平面盖面**（`boundaryFace`）：v1 `spur_gear.ts:51-76`（`planarCapAtZ`）从既有面 `getSubShapes(f,'edge')` 收边界边 → `connectEdgesToWires` → `healWire` → `makeFace`；cq-compat 的 `wire` op 只吃**绘图描述符**（`pendingEdges`），**无法**消费外部内核边。
  - 两者都是 occt-wasm 原生方法的薄封装（`sew` / `makeSolid` / `fixFaceOrientations` / `getSubShapes` / `makeWire` / `healWire` / `makeFace` 均在 `index.d.ts`），可仿 E1–E4 模式落进 cq-compat。**API 形态待拍板**（建议 `solidFromFaces(wp, faces[], opts?)` + `boundaryFace(wp, faces[], plane, tol)`）。
- **Q7【高】**：`cq_gears` Python 源在本机不存在 → `fai_cq_gears` 的 P2–P5（Ring/Bevel/Rack/Worm/Pairs 等 14 类）无法逐字对照翻译。可选：(a) 拿回 `cq_gears` 源；(b) 仅靠已入库的 `fixtures/reference/*.step` 做 T2 反推（**不足以 1:1 复刻参数语义**）。是否先只推进 SpurGear 单链？
- **Q8【中】**：`fai_cq_gears` 的 `src/index.ts` 只应先覆盖已实现的类；其余在 P2–P5 落地前应**返回显式错误**（不静默占位），避免 `registerLib` 装载后调用得到假结果。

**接手方在动这几项之前必须先拿到明确授权。**

---

## 12. 附：最小知识卡片

```
parity 链路：  run-ref.py(Python/CadQuery2.8.0) → out/ref/*.step
                                                          ↓ compare.ts
               .fai.js 镜像 → faijs CLI(brep) → out/cand/*.step

判据：volΔ% ≤ 0.1 且 CoMΔ ≤ 1e-3 且 bboxΔ ≤ 1e-3 且 双向布尔差 ≤ 0.1
      + 拓扑一致 → PASS；拓扑不一致 → PASS-NT
parity = (PASS + PASS-NT) / 650

block 分类原则：内核/比较器限制 → blocked（写清根因）；几何不符 → FAIL（不许放宽容差）

四个必须记住的坑：
  1) block 一个 case 要同时删 out/cand/<case>.step（compare 扫目录不读 manifest）
  2) 改 src 后必须 npm run build -w @faicad/cq-compat 再 run-cand（CLI 走 dist）
  3) 新增镜像后必须重跑 gen-manifest.ts
  4) 直接调原生 kernel op 前必须 configureBackends（否则 "backends not configured"）

当前基线（2026-09-11）：PASS 228 / PASS-NT 4 / FAIL 1 / ERROR 0 / BLOCKED 417 / parity 35.69%
                       单测 124 passed（15 files）
```
