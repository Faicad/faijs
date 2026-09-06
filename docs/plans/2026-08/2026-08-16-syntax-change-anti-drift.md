# 语法变更防过时守卫计划（check() 预检 × gen-api-dts 素材）

> 日期：2026-08-16
> 定位：为 2026-08-14 修复的两处缺陷（`CadRuntime.check()` 引用预检不认 split outputs；`gen-api-dts` 素材不全）建立**系统性守卫**，防止后续语法变更时这两部分再次静默过时。
> 前置：两处缺陷已修复（`src/cad-runtime/runtime.ts:563` 注册 `stmt.outputs`；`scripts/gen-api-dts.ts` 补 faceOrdinal 第三参与 bboxCenter/bboxMin/bboxMax helper）。

---

## 1. 背景：为什么现在会过时

### 1.1 现状守卫盘点

| 部分 | 现有守卫 | 缺口 |
|---|---|---|
| `check()` outputs 预检 | `check.test.ts` 正/反 2 个用例（仅 split 解构） | 只有单点用例；若新增多输出 op 或新解构形态，`runtime.ts` ③ 的注册逻辑可能再次漏掉 `stmt.outputs`，无测试报警 |
| `gen-api-dts` 素材 | 生成脚本源头自动 | **无同步守卫**：没有任何测试验证「磁盘 `src/mesh/api.d.ts` == 生成器输出」。改 `args-schema.ts` / 改硬编码模板后忘跑脚本 → 静默漂移。`op-set-consistency.test.ts` 不覆盖 api.d.ts，`ci.ps1` 也无此检查 |
| GeomRef feature 清单 | 无 | parser 的 `GEOMREF_FEATURES`（`src/lang/parser.ts:64`）与生成器硬编码的 helper 列表是**两份独立清单**；`types.ts` 的 `feature` union 类型是第三份。新增 feature 需三处同步，任漏一处即漂移 |

### 1.2 触发漂移的真实场景

1. schema 加字段/加 op → 忘了跑 `npx tsx scripts/gen-api-dts.ts` → api.d.ts 落后（AI 素材误导）
2. parser/codegen 新增多输出形态（非 split）→ check() 预检漏注册 → AI 自检误报
3. 新增 GeomRef feature（如 `edgeCenter`）→ 只改 parser 不改生成器 → 素材缺失

---

## 2. 目标与不做什么

### 2.1 目标（三条防线）

- **防线一（结构性）**：GeomRef feature 单一事实源，消除「三份清单」。
- **防线二（测试拦截）**：api.d.ts 同步守卫测试 + check() 预检系统性用例。
- **防线三（CI 拦截）**：`gen-api-dts.ts --check` 漂移即非零退出，接入 `ci.ps1`。

### 2.2 明确不做（边界）

- **不**将 `SPECIAL_OPS` 硬编码模板（split/dovetailSplit/…/faceAt 的返回值形态）全部 schema 化——那属于更大的「生成器全自动化」重构，本次只做同步守卫，模板改动会被防线二/三捕获。
- **不**改动 `allocate-id.ts` 中遍历 `stmt.outputs` 的逻辑（功能正确，仅与其共用抽函数，见 §3.2 选项）。
- **不**改 demo 侧构建流程。

---

## 3. 方案设计

### 3.1 防线一：GeomRef feature 单一事实源

**现状**：`src/lang/parser.ts:64` 定义 `GEOMREF_FEATURES` Set；`src/lang/types.ts:37` 手写 union；生成器硬编码 helper 列表。

**改动**：

1. `src/lang/types.ts`（L0 零依赖层）新增：
   ```ts
   export const GEOMREF_FEATURES = [
     'bboxCenter', 'bboxMin', 'bboxMax', 'faceCenter', 'faceNormal',
   ] as const
   export type GeomRefFeature = typeof GEOMREF_FEATURES[number]
   ```
   `GeomRef.$geom.feature` 字段类型改为 `GeomRefFeature`（删除手写 union）。
2. `src/lang/parser.ts`：删除本地 `GEOMREF_FEATURES` Set，改从 `types.ts` import（`Set<GeomRefFeature>` 或直接 `GEOMREF_FEATURES.includes`）。行为不变。
3. `src/mesh/api-dts-gen.ts`（新文件，见 §3.2）从 `types.ts` 遍历 `GEOMREF_FEATURES` 生成 helper 签名：
   - `bboxCenter/bboxMin/bboxMax`：通用模板 `(of: string): { $geom: { of: string; feature: 'X' } }`
   - `faceCenter/faceNormal`：特殊模板（第二参 `anchor?: [number,number,number] | null`，第三参 `faceOrdinal?: number`）
   - 映射表以 `Record<GeomRefFeature, 'simple' | 'face'>` 表达，新增 feature 若未登记 → 生成器报错（fail-fast，逼开发者补模板）。

**效果**：新增 feature 只改 `types.ts` 一处；parser 与生成器自动跟进；漏登记模板直接报错而非静默缺素材。

### 3.2 防线二：同步守卫测试

**改动 A：生成器逻辑迁入 src（可测试）**

1. 新文件 `src/mesh/api-dts-gen.ts`：从 `scripts/gen-api-dts.ts` 迁入全部生成逻辑，导出 `generateApiDts(): string` 与 `GEOMREF_FEATURES` 生成部分。
2. `scripts/gen-api-dts.ts` 变薄壳：`import { generateApiDts } from '../src/mesh/api-dts-gen'` + 写文件。新增 `--check` 参数：只比对不写入，漂移输出 diff 并 `process.exit(1)`。
   - 注意：`src/mesh/api-dts-gen.ts` 会被 `npm run build` 编进 dist（无副作用，纯字符串函数）；确认 `scripts/` 不再被 lint/typecheck 覆盖的问题消失（生成逻辑进 src 后即被覆盖）。
3. 新测试 `src/mesh/api-dts-sync.test.ts`：
   ```ts
   const generated = generateApiDts()
   const onDisk = readFileSync('src/mesh/api.d.ts', 'utf-8')
   expect(generated).toBe(onDisk) // 失败提示：npx tsx scripts/gen-api-dts.ts
   ```
   - 覆盖「改 schema/模板忘跑脚本」：生成器输出 ≠ 磁盘 → 红。
   - 覆盖「手改 api.d.ts」：磁盘 ≠ 生成器输出 → 红。

**改动 B：check() 预检系统性用例**

1. `src/cad-runtime/runtime.ts`：把 ③ 阶段的注册逻辑抽为模块级函数
   ```ts
   function registerDefinedIds(definedIds: Set<string>, stmt: CadStatement): void {
     definedIds.add(stmt.id)
     for (const outId of stmt.outputs ?? []) definedIds.add(outId)
   }
   ```
   `check()` 调用它。单一调用点消除「未来新写一段漏 outputs」的可能。
2. `check.test.ts` 补系统性用例：
   - 遍历「所有多输出形态」断言预检通过。当前 parser 仅 split 解构一种形态（`src/lang/parser.ts:418-429`），测试登记表驱动：
     ```ts
     const MULTI_OUTPUT_FORMS = [
       { name: 'split destructure', code: `const { front: p1, back: p2 } = await cad.split(...)` },
     ]
     ```
     每个形态断言：解构输出 id 可被后续语句引用且 `check().ok === true`（现有正例保留，负例保留）。
   - 该登记表兼作「新增多输出形态时必须登记」的提示点：新形态未登记 → 无测试覆盖，评审时可见。
3. 选项（可不做）：`allocate-id.ts:29/67` 的 outputs 遍历改为复用同一工具函数（若抽到 `lang/types.ts` 或新建 `lang/statement-ids.ts`）。范围小、收益是单一事实源一致；若不想动 L1 依赖，跳过。

### 3.3 防线三：CI 集成

1. `scripts/ci.ps1` 在「3/5 npm run build」后插入：
   ```
   Step -Label '3.5/5  gen-api-dts --check（api.d.ts 同步）' -Block { npx tsx scripts/gen-api-dts.ts --check }
   ```
   （步骤编号顺延，或并入现有步骤；执行顺序上放 build 前更早暴露。）
2. `scripts/ci.sh` 同步加一步（Linux/macOS 一致性）。

---

## 4. 实施步骤（含验证）

| # | 任务 | 文件 | 验证 |
|---|---|---|---|
| 1 | 单一事实源：`GEOMREF_FEATURES` 常量 + 推导类型 | `src/lang/types.ts`、`src/lang/parser.ts` | `npx vitest run src/lang/parser.test.ts src/lang/codegen.test.ts` |
| 2 | 生成逻辑迁入 `src/mesh/api-dts-gen.ts`，scripts 变薄壳 + `--check` | 新 `src/mesh/api-dts-gen.ts`、`scripts/gen-api-dts.ts` | `npx tsx scripts/gen-api-dts.ts --check` 退出 0；手改 api.d.ts 一处后退出 1 并显示 diff |
| 3 | 同步守卫测试 | 新 `src/mesh/api-dts-sync.test.ts` | 正常绿；手改 api.d.ts 一处 → 红 |
| 4 | check() 注册逻辑抽函数 + 系统性用例 | `src/cad-runtime/runtime.ts`、`src/cad-runtime/check.test.ts` | `npx vitest run src/cad-runtime/check.test.ts` |
| 5 | CI 接入 | `scripts/ci.ps1`、`scripts/ci.sh` | 本机跑 `pwsh -NoProfile scripts/ci.ps1`（或至少新 step 单跑） |
| 6 | 全量回归 | — | `npm run lint`、`npm run typecheck`、`npm test` |

**变更文件清单**：`src/lang/types.ts`、`src/lang/parser.ts`、`src/mesh/api-dts-gen.ts`（新）、`src/mesh/api-dts-sync.test.ts`（新）、`scripts/gen-api-dts.ts`、`src/cad-runtime/runtime.ts`、`src/cad-runtime/check.test.ts`、`scripts/ci.ps1`、`scripts/ci.sh`。`src/mesh/api.d.ts` 由生成器重跑产出（应无 diff，验证守卫闭环）。

---

## 5. 验收标准

1. **漂移三场景全部变红**：
   - 改 `args-schema.ts` 加字段、不跑生成器 → `api-dts-sync.test.ts` 红
   - 手改 `api.d.ts` 一行 → 测试红 + `--check` 非零
   - 在 `types.ts` 的 `GEOMREF_FEATURES` 加 `'edgeCenter'` 不登记模板 → 生成器报错
2. **新增多输出形态未登记时**：`check.test.ts` 的形态登记表评审可见（无自动报警，属评审项——如需要可加「断言登记表非空」的弱守卫）。
3. 全量 lint/typecheck/vitest 绿，`ci.ps1` 全流程过。

---

## 6. 风险与备注

- **`api-dts-gen.ts` 进 src/ 的构建影响**：纯字符串函数，无运行时依赖；`dist/` 会多一个模块，无害。备选：放 `src/lang/` 更贴 L0（生成器本质是 lang 层素材），但 `api.d.ts` 在 mesh 目录——**位置决策：跟随产出物所在目录（`src/mesh/`），不引任何 mesh 运行时模块**。
- **`GEOMREF_FEATURES` 常量放 types.ts 而非 parser.ts**：types.ts 是 L0 零依赖且 parser/codegen/generator 共同依赖层，避免 parser → generator 反向依赖。
- **`--check` 的实现**：diff 用简单逐行对比输出（不引第三方 diff 库），提示语给出重跑命令。
- 本计划文档随实施 commit 一起提交（遵守 doc 不单独提交规则）。