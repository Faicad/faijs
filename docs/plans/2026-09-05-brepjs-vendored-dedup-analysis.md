# 2026-09-05 — brepjs vendored 重复代码清理分析

## 1. 目标与原则

**目标**：以 `packages/core/src/vendored/brepjs/` 为唯一真源，清理 `packages/core/src/` 下因「加入 vendored 前手动拷贝」而产生的重复代码，同时保持对外 API 兼容。

**原则**：

- 一个事实一个家：每条类型/函数定义只保留一份
- 对外 API 不变：用户调用的公开接口（`@faicad/faijs` 根门面 re-export 的面）签名与行为保持不变
- 不可运行时回退：删除重复后，所有引用指向 vendored 原件；不引入 try-catch 兜底

## 2. Git 时间线关键节点

| 时间 | Commit | 说明 |
|------|--------|------|
| 2026-08-30 | `b0d35cc` | monorepo 重构，`lang/types.ts`、`mesh/types.ts`、`brep/text/`、`brep/svg/` 等文件首次入库（此时 vendored 尚不存在） |
| P11–P12 | `f5ec733` / `67192ac` | brepjs 源码树作为 `vendored/brepjs/` 引入 |

手动拷贝在前、vendored 在后，因此以下 2 节列出的代码可能是「vendored 原件的手动副本」。

---

## 3. 确认重复项（可删除）

### 3.1 `lang/types.ts` — `Vec3` 类型（严重程度：高）

| 文件 | 行号 | 定义 |
|------|------|------|
| `lang/types.ts` | L18 | `export type Vec3 = [number, number, number]` |
| `mesh/types.ts` | L17 | `export type Vec3 = [number, number, number]` |
| `vendored/brepjs/core/types.ts` | L8 | `export type Vec3 = readonly [number, number, number]` |

**问题**：全代码库存在 3 处 `Vec3` 定义，其中 `lang/types.ts` 与 `mesh/types.ts` 均为 **mutable** tuple，vendored 版为 **readonly**。

**依赖分析**：
- `lang/types.ts` 的 `Vec3` 作为公开类型通过 `index.ts`/`browser.ts` 等入口 re-export，被 L0 IR codegen 使用。grep 结果显示：**没有任何文件从 `lang/types` 显式导入 `Vec3`**——说明 `lang/types.ts` 的 `Vec3` 是历史遗留的「拷贝-未使用」副本。
- `mesh/types.ts` 的 `Vec3` 是整个 L1 几何层的事实类型，被 `brep/`、`boolean/`、`primitives/`、`mesh/` 下大量文件使用。
- vendored 的 readonly `Vec3` 仅供 TS 兼容面（`api/generated/core.ts` L103、`api/compat/index.ts`）使用，与内部 L1 层通过 `borrowBrepjsShape`/`callBrepjs` 桥接。

**操作**：
1. 删除 `lang/types.ts` 的 `Vec3` 定义（整行 `export type Vec3 = [number, number, number]`）。
2. 若 L0 IR 层确实需要「字面量向量形参」的类型表示，改为从 `mesh/types.ts` 导入：`import type { Vec3 } from '../mesh/types'`。但 L0 层设计上不应依赖 L1，因此更干净的做法是：**不单独定义，直接用 `[number,number,number]` 内联**。
3. `mesh/types.ts` 的 `Vec3` 作为内部几何类型保留（mutable，与 vendored readonly 语义不同，各有用途）。
4. **对外兼容**：检查根门面 `src/index.ts`/`browser.ts` 是否从 `lang/types` re-export `Vec3` —— 若存在该 re-export，需改为从 `mesh/types` 或 vendored `core/types` 重新导出，确保下游 `3d_editor` 等消费方不受影响。

### 3.2 `lang/types.ts` — `JsonValue` 类型（严重程度：中）

| 文件 | 行号 | 定义 |
|------|------|------|
| `lang/types.ts` | L21–27 | `export type JsonValue = string \| number \| ...` |
| `mesh/types.ts` | L22–28 | `export type JsonValue = string \| number \| ...` |

两份定义 **字面完全相同**。

**依赖分析**：
- `lang/types.ts` 的 `JsonValue` 被 L0 层（`compile.ts`、`codegen.ts`、`statement-summary.ts` 等）用于 `ArgIR` 类型约束。
- `mesh/types.ts` 的 `JsonValue` 被 `mesh-primitives.ts`、`transform.ts` 等 L1 层文件使用。
- 双方均为内部类型，未作为公开 API 直接暴露。

**操作**：
1. 删除 `lang/types.ts` 的 `JsonValue` 导出。
2. `lang/types.ts` 内对 `JsonValue` 的引用改为内联定义（`JsonValue` 是 L0 层「值的 JSON 可序列化」语义的特化表示，L0 零依赖约束下不应向上依赖 L1）。
3. 或者——若 L0/L1 类型统一优先级更高——`lang/types.ts` 从 `mesh/types.ts` 重新导出 `JsonValue`，让 `mesh/types.ts` 作唯一真源。但这违反 L0 零依赖原则，**不建议**。

> **结论**：`JsonValue` 两份定义当前完全等价，但语义上下文不同（IR 层 vs 几何层）。保留各自定义、承认「同名但不同层」的微碎重复；**不作为删除候选**，记入 §6「已知的细微分散」清单。

---

## 4. 分歧实现（不可直接删除，需保留并迁移引用）

### 4.1 字体注册：`brep/text/fontRegistry.ts` vs `vendored/brepjs/text/fontRegistry.ts`

| 维度 | `brep/text/fontRegistry.ts` | `vendored/brepjs/text/fontRegistry.ts` |
|------|------|------|
| L 路径 | L1 BREP 内部 | L3 兼容面（re-exported via `api/generated/text.ts` L12） |
| `loadFont` 签名 | `(opts: {fontPath, fontFamily?, force?, loader?}) => Promise<Font>` | `async (fontPath, fontFamily?, force?) => Result<OpenTypeFont>` |
| `getFont` 返回 | `Font \| undefined` | `OpenTypeFont \| undefined` |
| 字体加载机制 | DI 注入 `loader: FontLoader`（支持 fs/worker 多宿主） | 直接 `fetch(url)` + `opentype.parse` |
| 依赖 | 项目自有的 `FontLoader` 接口 | `opentype.js`、`fetch` |
| 使用方 | `api/text.ts`、`api/engrave.ts`、`primitives/text-geometry.ts`、`node-host/node-font-provider.ts`、`browser-host/*`、`cad-runtime/ports.ts`（**全产业链**） | 仅 compat 面（`generated/text.ts`） |

**差异本质**：
- faijs 版本是**生产实现**，支持可注入字体加载器（file system / worker / browser fetch 三宿主）。
- vendored 版本是 **brepjs 原版实现**，仅作 compat 投影使用（让原 brepjs 用户代码中的 `getFont`/`loadFont` 在 faijs 兼容面仍可编译）。

**问题**：compat 面 `getFont` 通过 `generated/text.ts` 从 vendored 导出，只能看到 vendored `loadFont`（fetch 路径）加载的字体；faijs DI 注入的字体在 compat 面 **不可见**。

**操作**：
1. **不删除** `brep/text/fontRegistry.ts` —— 它是生产唯一真源。
2. `vendored/brepjs/text/fontRegistry.ts` 保留（作为 compat 构成部分）。
3. **潜在改进**（非本次必须）：让 compat 面的 `getFont` 委托到 faijs 的 `brep/text/fontRegistry.ts`，使 compat 层能访问 DI 注入的字体。需评估对 `OpenTypeFont` 与 `Font` 类型兼容性的影响。

### 4.2 文字转实体：`brep/text/text-to-solid.ts` vs `vendored/brepjs/text/textBlueprints.ts`

| 维度 | `brep/text/text-to-solid.ts` | `vendored/brepjs/text/textBlueprints.ts` |
|------|------|------|
| 主函数 | `textBlueprints(kernel, text, options) -> BrepHandle[]` + `textToSolid(kernel, text, options) -> BrepHandle` | `textBlueprints(text, options) -> Blueprints` |
| 几何后端 | OCCT 3D edges/wires/faces (`BrepEngineApi`) | 2D Blueprint 草图 (`BlueprintSketcher`) |
| Y 轴处理 | 不翻转（文字从左到右） | 翻转（镜像 `[0,0]`） |
| 孔洞处理 | OCCT 自动处理内孔 → `makeFace` | `organiseBlueprints` 分类 |
| CJK 处理 | 有 CJK 字符检查 + 缺字 throw | 无 |
| 仅内部路径 | L1 BREP产业链 | L3 兼容面（`generated/text.ts` 无 re-export） |

**算法相似度**：两者都走 `opentype.js PathCommand → edge/wire` 流程（M/L/Q/C/Z 命令映射），vendored 版用 `BlueprintSketcher.lineTo/.cubicBezierCurveTo`，faijs 版用 `kernel.makeLineEdge/makeBezierEdge`。**共享算法骨架，但几何后端完全不同**。

**操作**：**不删除任何一方**。两者服务于不同环节：
- `text-to-solid.ts` 是 BREP 文字 op 的核心实现（被 `api/text.ts` textBrep 使用）
- `vendored/.../textBlueprints.ts` 是 brepjs 兼容面构件（未直接被生产代码引用，仅在 L3 compat 表中有登记）

### 4.3 SVG 解析与挤出：`brep/svg/svg-to-solid.ts` vs `vendored/brepjs/io/svgImportFns.ts`

| 维度 | `brep/svg/svg-to-solid.ts` | `vendored/brepjs/io/svgImportFns.ts` |
|------|------|------|
| 输出类型 | `BrepHandle` (OCCT wire/face/solid) | `Curve2D[]` / `Blueprints` |
| 支持元素 | `<path>` + `<rect>` / `<circle>` / `<ellipse>` / `<line>` / `<polyline>` / `<polygon>` 全元素 | 仅 `<path d>` |
| 孔洞处理 | 完整（`classifyHoles` 按有符号面积 + 质心检测 + bbox 包含 分类） | 下游 `organiseBlueprints` 处理 |
| Transform | 支持 `<g transform="matrix(...)">` | 不处理 |
| Y 翻转 | `flipY(x, y) = {x, y:-y, z:0}` | `flipY(p) = [p[0], -p[1]]` |
| 共用算法 | sagitta 法中点圆弧、quad→cubic 贝塞尔、Shoelace 有符号面积 | 同 |

**操作**：**不删除任何一方**。虽然 tokenizer（`tokenizeSVGPath`）和 Y-flip 等基础函数看似重复，但：
- faijs 版面向 3D OCCT 实体构造，支持 SVG 全元素变换矩阵
- vendored 版面向 2D 蓝图系统
两者已是服务于不同几何图的独立实装。

---

## 5. 不重复项（确认为真独立）

以下文件 / 函数经验证在 `vendored/brepjs/` 中无对应，是 faijs 自有实现：

| 文件 | 说明 |
|------|------|
| `primitives/svg-extrude.ts` | THREE.js 网格挤出路径（mesh op，vendored 无此概念） |
| `primitives/parse-svg-size.ts` | viewBox/width/height 解析（两条路径共用，无对应 vendored 实现） |
| `api/internal/svg-asset-resolver.ts` | SVG 资产 ref 解析（faijs `cad.asset` 机制的运行时支撑） |
| `api/svgExtrude.ts` | SVG 挤出 op 入口（faijs 自有 creator op 形态） |
| `api/text.ts` | 文字创建 op 入口（faijs 自有） |
| `primitives/text-geometry.ts` | 文字网格几何生成（mesh path） |
| `primitives/text/cjk.ts` | CJK 字符检测与系统字体检索（OCCT 路径特需，vendored 无） |
| `node-host/node-font-provider.ts` | Node fs 字体提供者（宿主层） |
| `browser-host/browser-font-provider.ts` / `inline-csg-backend.ts` 等 | 浏览器宿主适配层 |
| `vendored/brepjs/utils/quaternion.ts` / `range.ts` / `vec3.ts` / `vec2d.ts` / `uuid.ts` / `zip.ts` | 仅在 vendored 使用，src/ 下无对应 |
| `boolean/dovetail-math.ts` 中的 `Vec3` / `cross` / `dot` / `scale` | 燕尾榫数学：仅内部使用，是 dovetail 算法自含的几何运算；与 vendored `vecOps.ts` 算法重合但上下文独立（燕尾榫计算密集，自包含更易优化与判断正确性），不值得抽出 |

---

## 6. 已知的细微分散（可后续处理）

| 项 | 当前状态 | 建议 |
|----|----------|------|
| `lang/types.ts` 的 `JsonValue` | 与 `mesh/types.ts` 字面相同 | 承认跨层重复；若未来 L0 类型消费方迁移完毕，可改为仅 mesh 持有 |
| `mesh/types.ts` 的 `NRAD_DEFAULT` / `NRAD_MIN` / `NRAD_MAX` / `clampNRad` | 仅在 mesh 使用 | 保留，是 mesh primitives 的专有参数约定 |

---

## 7. 操作清单（按执行顺序）

### 阶段 A — 删除确认重复（低风险）

- [ ] **A1**：删除 `lang/types.ts` L18 的 `export type Vec3 = [number, number, number]`
- [ ] **A2**：检查根门面 `src/index.ts`、`src/browser.ts` 对 Vec3 的 re-export；若存在，改为从 `mesh/types.ts`（内部层）或 vendored `core/types`（对外兼容层）重新导出
- [ ] **A3**：跑 `npm run typecheck` + `npm run test -w @faicad/faijs-core` 全绿

### 阶段 B — 后续改进（可选，不影响对外）

- [ ] **B1**：评估让 compat 面的 `getFont`（`api/generated/text.ts` L12）委托到 faijs 自有 `brep/text/fontRegistry.ts`，使 DI 注入字体在 compat 面也可见
- [ ] **B2**：`lang/types.ts` 的 `JsonValue` → 确认是否真有必要独立定义；若 L0 内部全部自包含使用，保留现状

### 阶段 C — 测试关门

- [ ] **C1**：跑 `npm run pack` 生成 tgz，确认无断裂 import
- [ ] **C2**：让 `3d_editor` 项目消费此 tgz，跑其 E2E 确保根门面 re-export 的 Vec3 等类型未断裂

---

## 8. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 删除 `lang/types.ts` Vec3 后，某些文件实际 import 自 lang 而非 mesh | 阶段 A3 的 typecheck + vitest 全量跑会捕获（compile error / missing export） |
| 根门面 re-export 改了来源，3d_editor 消费不到 | 阶段 C2 的 3d_editor E2E 验证 |
| 本次未触碰 text / svg 分歧实现，无行为变化 | text / svg 两路径均未改，本分析已论证 |

回滚方式：`git checkout -- packages/core/src/lang/types.ts` 还原；从 mesh 或 vendored 导入的改动由 typecheck 指引修复。

---

## 9. 总结

以 vendored/brepjs 为准本次能**安全删除**的只有 **1 项**：`lang/types.ts` 中无下游引用的 `Vec3`。其余疑似重复（text 文字、svg 解析、字体注册）实则为**服务于不同几何后端**（OCCT 3D vs Blueprint 2D）或**不同宿主抽象层**（DI 注入 vs fetch）的分歧实现，不应强行合并——强行以 vendored 替换会破坏 faijs DI 多宿主架构、破坏 SVG 全元素支持与变换矩阵支持。

这一点需要在后续库开发规范中强调：**vendored 作为 compat 投影的「参考实现」存在，不代表是 faijs 的真源**。faijs 真源始终是 `packages/core/src/` 下单责的、与宿主/几何后端匹配的具体实装；vendored 只对 L3 的 TS 兼容面负责。
