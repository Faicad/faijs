# brepkit vs occt-wasm STEP 输出一致性分析报告

- 日期：2026-09-18
- 范围：`brepkit-wasm`（npm 3.4.18）与 `occt-wasm`（3.8.4）在 10 个基准几何用例上的 STEP 导出一致性、双向 STEP 互读、性能对比
- 结论载体：`scripts/brepkit-step-check/compare-npm.mjs`（双侧 npm 包纯 JS 驱动，可重复运行：`node scripts/brepkit-step-check/compare-npm.mjs <out-dir>`）；原始产物 `tmp/brepkit-step-check/npm-out/`（STEP 原件 ×20 + `report.json`）
- 下游影响：faijs BREP 链是否可用 brepkit 替换/并存 occt-wasm 的可行性评估输入

## 需求原话

> 请接入并测试C:\git\OpenCascade\brepkt几何内核，验证它与occt-wasm在输出step时的一致性

（用户原话中的 `brepkt` 为拼写差异，实际仓库为 `C:/git/OpenCascade/brepkit`。）

> 请写一份完整的分析报告，放在本项目

## TL;DR

1. **几何精度一致性：达标。** 10 个用例中 9 个体积差 ≤ 2.3e-16（浮点噪声级）；唯一例外是布尔 cut（C07），相对差 2.1e-5——brepkit 侧布尔结果的体积由数值积分得出，OCCT 侧给出解析精确值（1000−45π 闭式核对吻合）。面积差 ≤ 2.1e-5，bbox 全部吻合。
2. **STEP 结构：基本同构，两处差异。** 两侧都输出 `MANIFOLD_SOLID_BREP` + `ADVANCED_FACE` + 解析曲面实体，无 `POLYGONAL_FACE`。差异：球面拓扑不同（brepkit 2 半球 + 32 段直线赤道 vs OCCT 1 球面 + seam 曲线）；brepkit 圆锥的 `CONICAL_SURFACE` 半角参数写反（见下，真 bug）。
3. **brepkit STEP writer 真 bug（圆锥）：`CONICAL_SURFACE` 的 semi-angle 写成了内部定义的"与径向平面夹角"（1.3734 rad）而非 STEP 标准的"与轴夹角"（0.1974 rad），两者互补。** brepkit 自读回环不受影响（内部定义自洽），但 OCCT 按标准解读后把体积读成 1651.009（正确值 612.611）。本地 3.4.7 源码与 npm 3.4.18 行为一致，bug 未修复。
4. **STEP 互操作：单向。** OCCT 能读全部 10 个 brepkit STEP（圆锥除外均几何正确）；brepkit reader 读不了任何一个 OCCT STEP（缺 `SURFACE_CURVE`/`SEAM_CURVE` 支持）。
5. **轻微语法瑕疵：** OCCT 读每个 brepkit STEP 都报一次 `Incorrect Syntax: Fails Count: 1`（能容忍并正确读入）。已确认与 `SI_UNIT` 写法无关（改标准四参写法后报错依旧，且体积反而错）。来源未定位到具体实体，brepkit reader 本身不校验语法，需 brepkit 侧用标准 STEP 校验器（如 OCCT 的 `STEPControl_Reader` 严格模式或 FreeCAD 导入日志）进一步定位。

## 测试方法

### 内核接入方式

按用户要求，两侧均通过 **npm 包** 接入（非本地源码编译）：

| 侧 | 包 | 版本 | 入口 |
|---|---|---|---|
| brepkit | `brepkit-wasm` | 3.4.18 | `new BrepKernel()`（`import 'brepkit-wasm'`） |
| OCCT | `occt-wasm` | 3.8.4 | `await OcctKernel.init({ wasm })`（与 faijs `occtKernel.ts` 同款 wasm 内联加载路径） |

注：`brepkit-wasm` 用 `npm install --no-save` 装入 node_modules，未进 package.json（faijs 未决定接入，不形成正式依赖）。本地 brepkit 仓库（3.4.7，`C:/git/OpenCascade/brepkit`）的 `bindings/ts` 仍是占位实现（`initBrepkit()` 未加载 wasm），不可用作正式接入路径；仅其 Rust crates 被用于一个辅助探针（验证 brepkit 自读回环，见下）。

### 基准用例（10 个，覆盖两种曲面类型集 + 布尔 + 变换）

| 用例 | 几何 | 覆盖点 |
|---|---|---|
| C01 | box 10×20×30，居中 | 平面 |
| C02 | cylinder r5 h20，底面在原点 | 圆柱面 + 平面 |
| C03 | cylinder r5 h20，z 居中（平移） | 平移变换 |
| C04 | sphere r7.5，居中 | 球面（seam 处理） |
| C05 | cone r1=5 r2=2 h15，底面在原点 | 圆锥面（semi-angle 定义） |
| C06 | torus R10 r4，居中 | 环面 |
| C07 | box 10³ 切 cylinder r3 h10（贯穿） | 布尔 cut |
| C08 | 两个 10³ box 融合（z 向重叠 5） | 布尔 fuse |
| C09 | box 8³ ∩ cylinder r6 h8 | 布尔 intersect |
| C10 | cylinder r5 h20 居中后绕 X 旋转 30° | 旋转变换 |

### 对比维度

每个用例两侧各构建同一几何、导出 STEP，对比：体积、表面积、bbox（6 值）、STEP 实体类型普查（逐 `#N = TYPE(` 行计数）、文件字节数/行数；另做双向 STEP 互读（每侧 kernel 读另一侧的 STEP 文件，报告读回体积/实体数）。

另用本地 brepkit Rust crates 做**自读回环**验证（brepkit 读回自己写的 STEP）：10/10 成功，体积与原始几何完全一致——证明 brepkit 圆锥的 STEP 文本按其内部定义是自洽的，问题只在跨内核解读。

## 结果

### 主对比表（brepkit 3.4.18 vs occt-wasm 3.8.4）

| 用例 | 体积相对差 | 面积相对差 | bbox | 曲面实体 | OCCT←brepkit 读回 | brepkit←OCCT 读回 |
|---|---|---|---|---|---|---|
| C01 box | 0 | 0 | ✓ | ✓ | ✓ 6000.000 | ✗ `SURFACE_CURVE` 不支持 |
| C02 cylinder | 1.5e-16 | 2.0e-5 | ✓ | ✓ | ✓ 1570.796（=π·25·20） | ✗ |
| C03 cylinder 平移 | 1.5e-16 | 2.0e-5 | ✓ | ✓ | ✓ 1570.796 | ✗ |
| C04 sphere | 1.3e-16 | 1.6e-16 | ✓ | **2 vs 1** | ✓ 1767.146（=4/3π·7.5³） | ✗ `SEAM_CURVE`/空 wire |
| C05 cone | 1.9e-16 | 2.1e-5 | ✓ | ✓（数值同，语义错） | **✗ 1651.009 ≠ 612.611** | ✗ |
| C06 torus | 4.3e-16 | 0 | ✓ | ✓ | ✓ 3158.273（=2π²·10·16） | ✗ `SEAM_CURVE` |
| C07 box−cyl | **2.1e-5** | 0 | ✓ | ✓ | ✓ 858.628（=1000−45π） | ✗ |
| C08 box∪box | 2.3e-16 | 2.0e-16 | ✓ | ✓（12 平面） | ✓ 2000.000 | ✗ |
| C09 box∩cyl | 2.2e-16 | 0 | ✓ | ✓ | ✓ 256.000 | ✗ |
| C10 cyl 旋转 | 1.5e-16 | 2.0e-5 | ✓ | ✓ | ✓ 1570.796 | ✗ |

- 体积差 = |brepkit − occt| / |brepkit|。OCCT 侧布尔/解析值均与闭式值精确吻合，故差值完全来自 brepkit 侧数值积分（`volume(solid, 0.01)` 的 tol=0.01 自适应细分）。
- 面积差主要来自圆柱/圆锥侧面：brepkit `surfaceArea` 同样走数值积分，相对差 ≤2.1e-5；平面体（C01/C07/C08/C09）差 0。
- 读回列中 ✓ 数值 = 读回体积，括号内为闭式精确值核对。

### 性能（构建 + 导出 STEP，单用例，ms）

| 用例 | brepkit | occt-wasm |
|---|---|---|
| C01 box | 0 | 4 |
| C02 cylinder | 0 | 4 |
| C07 cut | 70 | 70 |
| C08 fuse | 8 | 62 |
| C10 旋转 | 2 | 65 |

简单实体 brepkit 快 5–10 倍；布尔运算两者相当（~70ms）。brepkit 文件更小（C01：8.8KB vs 15.5KB）。

### STEP 实体普查差异（非零差值项）

| 实体类型 | brepkit | occt-wasm | 说明 |
|---|---|---|---|
| `SPHERICAL_SURFACE` | 2 | 1 | 球拆半球（见下） |
| `SURFACE_CURVE` | 0 | 5+ | OCCT 为每条边写 surface curve；brepkit 不写 |
| `SEAM_CURVE` | 0 | 1 | 球/环 seam；brepkit 用直线赤道代替 |
| `MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_LIST` 等表达层 | 0 | 有 | brepkit 不含表达层（颜色等） |
| `SI_UNIT`/`LENGTH_UNIT` | 有 | 有 | 两侧都写（写法不同，见"轻微语法瑕疵"） |

## 关键发现详解

### 1. brepkit 圆锥 STEP 导出 semi-angle 写反（真 bug）

STEP `CONICAL_SURFACE` 实体的 `semi_angle` 参数按 ISO 10303 定义是**半锥面与轴线的夹角**（0 < α < π/2）。brepkit 内部 `ConicalSurface.half_angle` 定义的是与径向平面（垂直于轴的平面）的夹角，两者互补（β = π/2 − α）。

实测（C05，r1=5 r2=2 h15，半轴角 α = atan(3/15) ≈ 0.1974 rad）：

- brepkit 写出 `CONICAL_SURFACE(..., 1.3734)`（= π/2 − 0.1974，内部定义直接外泄）
- occt-wasm 写出 `CONICAL_SURFACE(..., 0.1974)`（标准定义）
- brepkit 自读回环：正确（按内部定义解读，自洽）
- OCCT 读 brepkit STEP：把 semi-angle 按标准解读为 1.3734 rad → 锥面张角完全错误 → 体积读成 1651.009（正确 612.611 = π·15/3·(25+4+2)）

定位：`crates/io/src/step/writer.rs` 圆锥分支，应写 `std::f64::consts::FRAC_PI_2 - cone.half_angle()` 而非 `cone.half_angle()`。本地 3.4.7 与 npm 3.4.18 行为一致。

### 2. 球面拓扑差异（非 bug，风格差异）

- brepkit：2 个半球面 + 32 段直线赤道（`makeSphere(7.5, 32)` 的 segments 参数离散出赤道直线段），无 seam 曲线。
- occt-wasm：1 个完整球面 + `SEAM_CURVE`（一条半圆 seam）。

几何等价（体积/面积/bbox 全部吻合），OCCT 能正确读回 brepkit 的双半球。但 brepkit 的 32 段直线赤道是其 NURBS 化离散的一部分，若下游做曲面类型统计或特征识别会看到"球 = 2 面"而非"球 = 1 面"。

### 3. 布尔体积差（2.1e-5，C07）

OCCT 的 `getVolume` 对布尔结果给出解析精确值 858.628331（= 1000 − 45π，闭式核对精确到 6 位）。brepkit 的 `volume(solid, tol)` 是 tol=0.01 的自适应数值积分，得 858.646 附近值，相对差 2.1e-5。非几何错误，是测量方法差异；brepkit 侧调小 tol 可收敛。

### 4. brepkit reader 读不了 OCCT STEP

10/10 失败，原因集中在两类：

- 9/10 报 `unsupported entity SURFACE_CURVE`（OCCT 为边附加的曲面曲线参数化实体，brepkit reader 未实现）
- C04 球报空 wire（`SEAM_CURVE` 导致 wire 解析失败）

结论：**brepkit 目前只能读自己的 STEP**。faijs 场景中"加载第三方 STEP 源文件再参与布尔"的链路（如 `.fai.js` 引用外部 STEP）brepkit 不可用；occt-wasm 该链路正常。

### 5. OCCT 读 brepkit STEP 的 `Incorrect Syntax: Fails Count: 1`

每个 brepkit 文件 OCCT 都报一次（能容忍、正确读入）。已做的排除实验：

- 改 `SI_UNIT` 为规范三参 `($,.MILLI.,.METRE.)`：报错依旧，且体积被错读为 6e12（单位链被破坏）
- 改 `SI_UNIT` 为规范四参 `($,.MILLI.,.METRE.)`（LENGTH_UNIT 下标准写法）：报错依旧，体积同样错

即报错与 `SI_UNIT` 写法无关；原写法（两参）反而是唯一能让 OCCT 读对单位的写法。报错来源实体未定位，brepkit reader 不做严格语法校验，需外部标准校验器进一步定位（建议 brepkit 侧用 OCCT 严格模式或 `CheckSTEP` 工具复现）。

## 对 faijs 接入的含义

| 维度 | 评估 |
|---|---|
| 几何精度 | ✅ 达标（≤1e-15，布尔 2e-5 可接受） |
| STEP 导出（交付正确性） | ⚠️ 圆锥 semi-angle bug 阻塞——交付含圆锥的 STEP 会被标准阅读器解读错 |
| STEP 互读（加载外部 STEP） | ❌ brepkit reader 不可用（SURFACE_CURVE/SEAM_CURVE 缺失）；occt-wasm 正常 |
| 性能 | ✅ 简单实体快 5–10 倍，布尔相当，文件更小 |
| 生态 | ⚠️ 本地 3.4.7 无 CI 产物、TS 绑定占位；npm 3.4.18 可用但圆锥 bug 未修 |

若推进替换/并存 occt-wasm，前置条件：(a) brepkit 修圆锥 writer bug；(b) brepkit reader 支持 `SURFACE_CURVE`（至少跳过容忍）；(c) 定位并修复 `Incorrect Syntax` 来源。在 (b) 落地前，faijs 的 STEP 加载链路（`load` 引用外部 STEP）必须继续走 occt-wasm。

## 复现

```bash
# 安装（--no-save，不进 package.json）
npm install --no-save --no-audit --no-fund brepkit-wasm@3.4.18

# 运行对比（产物落 tmp/brepkit-step-check/npm-out/）
node scripts/brepkit-step-check/compare-npm.mjs tmp/brepkit-step-check/npm-out

# 辅助：brepkit 自读回环（Rust 探针，需 Rust 工具链）
cd scripts/brepkit-step-check && cargo build --release
./target/release/brepkit-step-check.exe ../../tmp/brepkit-step-check/brepkit-out
```

## 原始产物索引

| 路径 | 内容 |
|---|---|
| `scripts/brepkit-step-check/compare-npm.mjs` | 主对比脚本（npm 双侧 + 双向互读） |
| `scripts/brepkit-step-check/`（Cargo.toml, src/main.rs） | Rust 探针（自读回环证据） |
| `tmp/brepkit-step-check/npm-out/bk/*.step` | brepkit 导出的 10 份 STEP |
| `tmp/brepkit-step-check/npm-out/oc/*.step` | occt-wasm 导出的 10 份 STEP |
| `tmp/brepkit-step-check/npm-out/report.json` | 完整对比数据（体积/面积/bbox/普查/互读） |
| `tmp/brepkit-step-check/brepkit-out/roundtrip/manifest.json` | brepkit 自读回环清单 |
