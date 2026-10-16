# skill 文档全自动生成（删除 skills/ 手写文件）

- 日期：2026-10-09
- 状态：待评审
- 背景：外观 API（`setColor`/`setMaterial` 等）已实现但从未出现在 skill 文档中，暴露了手写文档链路的结构性问题。

> **补注（2026-10-16）**：按「提示词保密」要求，`skills/*.md` 成品文件已从 faijs 仓库移除（不再落盘/提交）。生成器 `scripts/gen-skill-docs.ts` 重构为**基础提示词生成 API**：导出 `generateApiManual('brepkit'|'occt')` / `generateSkillOverview()`，CLI 用 `--emit <kernel>` 输出到 stdout（不再写文件、不再有 `--check`）。手册的组装、存放与版本化由 ai-gateway 项目掌控（其 `sync:faijs` 以子进程消费 `--emit`）。输出不变式（章节齐全、bucket 过滤、无 `{{`、无 `cad.edgeRef(`/`cad.faceRef(` 调用形态、标题标记、确定性）由 `packages/tests/faijs/promptgen/gen-skill-docs.test.ts` 锁定。`prompts/` 目录保留，与本次需求无关。

## 0. 用户原话（逐字）

> 分析../faijs项目生成的skill文件里，为何没有设置颜色、材质这类的api？

> 你需要搞清楚本项目prompts的生成的整个流程，要能够自动化处理。也就是faijs某个新增的api，在发版的时候要能自动更新出现在最新的skill文件里。

> ../faijs/skills这个目录的很多手写文件要删除，这个skill要能够自动化生成。而且要包括core/faijs_core/sketch的所有在脚本层面可用的api。

（范围确认：用户选择覆盖**全部库**，含 sheetmetal/gears/fasteners；非 API 说明性内容可以直接写在生成脚本里。）

## 1. 现状与问题

### 1.1 现有链路

```
手写 skills/core.md / sketch.md / sheetmetal.md / faijs-gears.md / faijs-fasteners.md / faijs-extra.md / SKILL.md
        │
        ▼  scripts/gen-engine-skill-docs.ts（gen:engine-skill-docs）
  运行时读引擎归属（DUAL_OP_META / SCRIPT_FACE_OPS / 源码扫描 assertEngineFor）
  但只做一件事：按 op 名标题（### `opName`）【过滤】手写 core.md
        │
        ▼
  skills/all_occt.md、skills/all_brepkit.md（半生成：结构自动，内容来自手写 core.md）
        │
        ▼  CI doc-sync：gen-engine-skill-docs --check
  只保证 all_*.md 不落后于 core.md（生成物 vs 手写源）
        │
        ▼  发版（config.faijsVersion）→ ai-gateway: bun run sync:faijs
  拷为 prompts/partials/all_<kernel>_<version>.md（ai-gateway 侧已闭环）
```

### 1.2 三个结构性缺陷

1. **生成器只过滤、不补全**。`gen-engine-skill-docs.ts` 的内容唯一来源是手写 `core.md`；core.md 没写的东西，输出永远没有。
2. **Shape 实例方法在 op 管道之外**。`appearance.ts` 明确设计为"不是 op（不进 defineOp/api-namespace/args-schema），是 Shape 实例方法"。所以 `setColor`/`setMaterial`/`setAppearance`/`setOpacity`/`setFaceColor`/`setFaceMaterial`/`getAppearance` 不在任何权威清单里，文档生成器根本看不见它们。
3. **没有反向覆盖守卫**。现有守卫方向都是"生成物不落后于手写源"，没有"运行时脚本面的每个 API 必须在文档里"的检查。`api-surface-snapshot.json` 只守 npm 导出面；`gen-ops-api-inventory.ts`（曾是从 JSDoc 生成 API 文档的方向）已于 2026-10-08 被裁定 deprecated。

## 2. 目标

1. **删除 `skills/` 全部手写 API 文档**（core.md、sketch.md、sheetmetal.md、faijs-gears.md、faijs-fasteners.md、faijs-extra.md、faijs-cadquery.md、generate-all-md.mjs 及其余手写文件）。
2. skill 文档 **100% 生成**，唯一产物为：
   - `skills/SKILL.md`（概述 + 单位制 + 脚本结构 + 库目录表）
   - `skills/all_occt.md`、`skills/all_brepkit.md`（ai-gateway 消费的完整 API 手册）
3. 覆盖**脚本层面全部可用 API**：
   - `cad.*` 平台 op（core `createApiNamespace()` + `SCRIPT_FACE_OPS` 生成面）
   - `cad.sketch`（sketch 库合并进 cad）
   - 编辑器 op（faijs-extra：`ALL_EDITOR_OPS`）
   - **Shape 实例方法**（`setColor`/`setMaterial`/`setAppearance`/`setOpacity`/`setFaceColor`/`setFaceMaterial`/`getAppearance` 等）
   - 领域库导出（`@faicad/sheetmetal`、`@faicad/faijs-gears`、`@faicad/faijs-fasteners` 的脚本可 import 函数）
4. **新增 API 发版自动出现**：任何新 op / 新 Shape 方法 / 新领域库导出，只要通过编译与门禁，重新生成即出现在 skill 文档中；漏写文档（缺 JSDoc 标签）直接 CI 红，而不是静默缺失。

## 3. 权威数据源（全部机器可读，零手写清单）

| API 类别 | 权威来源 | 提取方式 |
|---|---|---|
| core 平台 op | `createApiNamespace()` + `DUAL_OP_META`（defineOp 元数据：name/schema/slotMap/engines）+ op 包装点前置 JSDoc（`@group`/`@param`/`@returns`/`@example`/`@async`） | 运行时 import + TypeScript Compiler API 抽 JSDoc（仓库已有 `scripts/jsdoc.ts` 基建） |
| 生成脚本面 op | `api/generated/script-face-manifest.ts`（`SCRIPT_FACE_OPS`，含 engines） | 直接 import |
| sketch | `@faicad/faijs-sketch` 的 `SKETCH_OPS` + `cad.sketch` op 定义 JSDoc | 运行时 import + Compiler API |
| 编辑器 op | `@faicad/faijs-extra` 的 `ALL_EDITOR_OPS` + op 定义 JSDoc | 运行时 import + Compiler API |
| Shape 实例方法 | `shape.ts` 的 `SolidShape`/`CurveShape` extends 接口（`ShapeAppearanceMethods`、`ShapeMetaMethods`）+ 各接口成员 JSDoc | **TypeScript Compiler API**：解析 `ShapeMetaMethods`/`ShapeAppearanceMethods` 接口声明，逐成员提取签名与 JSDoc。无需新增手工登记表——接口即清单（新增方法 = 改接口 + 写 JSDoc，生成器自动跟上） |
| sheetmetal/gears/fasteners | 各包 `src/index.ts` 的公共导出（函数/const）+ 源符号 JSDoc | 运行时 import 枚举导出面 + Compiler API 沿 re-export 找到源符号抽 JSDoc |

> 设计裁决：**接口即清单**。Shape 方法不做手工 manifest；`ShapeAppearanceMethods` 这类接口本身就是单一真源，生成器用 TS AST 抽取。这与"arg-spec 是 L3 唯一人工维护点"的哲学一致，但更彻底——连维护点都省了。
>
> 领域库同理：`index.ts` 的 export 面即清单（`check-api-coverage.ts`/`api-surface-snapshot` 已证明导出面可枚举、可守卫）。

## 4. 生成器设计

新脚本 `scripts/gen-skill-docs.ts`（替代 `gen-engine-skill-docs.ts`）：

```
输入（全自动枚举，零手写文档输入）：
  ① 运行时装配完整 cad namespace：
     mergeEditorNamespace(mergeSketchNamespace(createApiNamespace()))
  ② TS Compiler API 扫描各包 src：
     - core api/*.ts：defineOp 调用点的 JSDoc（@group/@param/@returns/@example/@async/@qual）
     - shape.ts：SolidShape/CurveShape extends 的实例方法接口 → 成员签名 + JSDoc
     - sketch/faijs-extra/sheetmetal/faijs-gears/faijs-fasteners：
       src/index.ts 导出面 → re-export 源符号 JSDoc
  ③ SCRIPT_FACE_OPS 的 engines 字段 + DUAL_OP_META.engines → 三桶分类
     （common / occt-only / brepkit-only，沿用现规则）

输出：
  skills/SKILL.md        — 概述（说明性文字以常量内嵌在生成脚本中）+ 库目录表（由①②自动生成）
  skills/all_occt.md     — 全量 API 手册（occt 视角）
  skills/all_brepkit.md  — 全量 API 手册（brepkit 视角）
```

### 4.1 文档结构（all_*.md）

```
> auto-generated banner（gen-skill-docs.ts，勿手改；npm run gen:skill-docs）
── 概述/脚本结构/单位制/Result/拓扑引用（SKILL.md 内嵌说明，生成脚本常量）
── cad.* 平台 op（按 @group 分组；每 op：签名、参数表、示例、engines 徽标）
   ├ core 平台面
   ├ SCRIPT_FACE_OPS 生成面
   ├ cad.sketch
   └ 编辑器 op（fai_drill/…/svgExtrude）
── Shape 实例方法（setColor/setMaterial/setAppearance/setOpacity/setFaceColor/
   setFaceMaterial/getAppearance + MetaMethods；含 E_FACE_UNAVAILABLE/E_FACE_INDEX
   错误契约与 faceRanges 面序号说明——这些都在接口 JSDoc 里，生成器原样投影）
── 领域库（import 指引 + 各包导出函数：签名、参数、示例）
   ├ @faicad/sheetmetal
   ├ @faicad/faijs-gears
   └ @faicad/faijs-fasteners
```

- **引擎分桶只作用于 `cad.*` op**（沿用现规则）；Shape 方法与领域库函数双引擎通用，进两份文档。
- `faijs-cadquery.md`（cq-compat）维持现状不进生成范围（ai-gateway 不消费），该文件可留可删另行裁定。
- 非核心库的章节标题保持与现有手写版相近的信息密度，但**内容来源是 JSDoc，不是手写 md**。

### 4.2 JSDoc 完整性门禁（关键新增）

新增 `scripts/verify-script-face-jsdoc.ts` 并接入 `doc-sync`：

- 脚本面全集（op ∪ Shape 方法 ∪ 领域库导出）中，每个 API 必须具备：描述 + `@param`（逐参数）+ `@returns`（或明确 void）+ 至少一个 `@example`。
- 缺失即非零退出，报出 `file:line` 清单。

**这正是外观 API 问题的根治点**：`box1.setColor()` 这类方法只要进了接口并写了 JSDoc，就被自动抽进 skill 文档；没写 JSDoc 则 CI 红——"新增 API 自动出现在 skill 文件"由"生成器不依赖手写文档" + "JSDoc 门禁强制补全"两条共同保证。

### 4.3 CI / 发版接线

```
gen:surface（不变）→ gen-skill-docs → verify-script-face-jsdoc → doc-sync --check
```

- `doc-sync` 链中 `gen-engine-skill-docs --check` 替换为 `gen-skill-docs --check`（新增 stale 检查：重新生成结果与磁盘逐字节一致）。
- CI 与 pre-commit 不变入口（`npm run doc-sync`），发版前必然触发。
- 发版流程不变：改 `config.faijsVersion` → ai-gateway `bun run sync:faijs` 拉取最新 `all_<kernel>.md`（下游已闭环，无需改动）。

## 5. 迁移步骤

1. 实现数据源枚举层（cad namespace 运行时装配 + TS AST 抽取），先跑通 core op 投影，与现 `all_occt.md` 内容 diff 校准（允许格式差异，API 集必须等价——用 op 名集合 diff 验证）。
2. 补 Shape 方法投影（appearance/meta 接口），补齐 `ShapeAppearanceMethods` 成员 JSDoc（现有 JSDoc 已较全，主要补 `@example`）。
3. 补 sketch/extra 投影；为 `cad.sketch` 与编辑器 op 的 JSDoc 补标签。
4. 补三个领域库投影；按门禁清单逐个补缺失的 `@param`/`@example`（工作量主要在此，sheetmetal 约 35 个导出、fasteners 约 30 个、gears 约 15 个）。
5. 实现 `verify-script-face-jsdoc.ts`，接入 `doc-sync`。
6. 生成新 `SKILL.md`/`all_occt.md`/`all_brepkit.md`，删除全部手写 skill 文件与 `generate-all-md.mjs`；`gen-engine-skill-docs.ts` 删除（无历史兼容红线）。
7. ai-gateway 侧跑 `bun run sync:faijs --check` 验证新文档通过同步守卫（纯材料、无 `{{`、标题标记）。

## 6. 验收

- [ ] `skills/` 目录仅含 `SKILL.md`、`all_occt.md`、`all_brepkit.md`（+cq-compat 裁定结果），全部带 auto-generated banner。
- [ ] `grep -c setColor skills/all_occt.md` ≥ 1（外观 API 在文档中，含参数表与示例）。
- [ ] op 名集合等价校验：生成文档中的 cad.* op 集合 ≡ 运行时 namespace 键集（脚本内断言，不靠人工 diff）。
- [ ] 删除任一 op 的 `@example` → `npm run doc-sync` 红；恢复后绿。
- [ ] 新增一个最小 defineOp（带 JSDoc）→ `gen:skill-docs` 后自动出现在两份 all_*.md，无需改任何文档文件。
- [ ] `bun run sync:faijs --check`（ai-gateway）通过。
