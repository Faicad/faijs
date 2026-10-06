# Agent Note: API 测试覆盖门禁（基于源码，分包运行）

状态：已实现

[English](2026-10-06-api-export-coverage-gate.md) | 中文

## 问题

旧门禁（`packages/core/scripts/check-api-coverage.ts`）有三个设计缺陷：

1. **读 `dist` 而非源码**：导出面从编译后的 JS 加载，需要先 build 才能运行门禁，且 dist/src 可能不同步。
2. **跨包反向依赖**：core 的脚本扫描 `faijs-extra`、`sketch`、`draw`——core 不应该知道这些包的存在。
3. **Token 匹配，非参数覆盖**：门禁只检查函数名是否作为词边界 token 出现在测试源码中，无法判断参数是否被实际测过。

## 决策

新门禁（`scripts/check-api-test-coverage.ts`）替代旧门禁。基于源码、分包运行，执行两级检查：

- **L1（函数覆盖）**：包 `package.json` `exports` 中的每个值导出（函数、op、类、const）必须在该包的 `test/` 文件或 `.fai.js` fixture 中被名字引用。
- **L2（参数覆盖）**：对于 op，每个 schema/JSDoc 声明的参数必须作为属性名出现在测试中的调用点。对于非 op 函数，只检查选项容器参数的属性（位置参数如 `shape`/`part` 仅由 L1 验证）。

门禁使用 TypeScript Compiler API 解析源文件（非 `dist`），因此无需 build 即可运行。每个包运行自己的门禁；core 不扫描其他包。

## 覆盖方法

### 导出面提取（P2）

1. 读取 `package.json` `exports`，将每个具体键映射到其源码 `.ts` 文件（dist 镜像 src）。
2. 从入口构建 `ts.Program`，用 `checker.getExportsOfModule` 获取所有导出符号。
3. 通过 `resolveSymbol`（别名解析）跟随 re-export 链。
4. 对于 op（`defineOp`/`compatOp`），按优先级从以下来源提取参数：
   - `schema` 字段键（最可靠）
   - JSDoc `@param` 标签（处理点号名如 `@param params.depth`）
   - `paramDims` 键（部分但可靠）
5. 对于非 op 函数，从 TS 签名提取；只有选项容器参数（`options`、`params` 等）的属性在 L2 检查。

### L1/L2 门禁（P3）

- 将测试文件和 `.fai.js` fixture 解析为 AST。
- 收集所有标识符（L1）和调用点对象字面量属性名（L2）。
- 对任何缺口输出 `API — missing [params]` 并非零退出。

### Baseline 机制（P4 过渡）

初始缺口很大（全包 244 L1 + 58 L2）。每包的 baseline 文件（`api-coverage-baseline.json`）记录已知缺口。门禁只对**不在** baseline 中的新缺口失败——这防止退化，同时允许 P4 增量关闭缺口。

- `--generate-baseline`：将当前缺口写入 baseline 文件。
- 当 baseline 中的缺口被新测试关闭后，下次 `--generate-baseline` 时自动移除。
- 当所有缺口关闭后，baseline 文件可删除；门禁会打印提醒。
- baseline 文件被 git 追踪，保证团队一致性。

## 测试目录迁移（P1）

所有 `*.test.ts(x)` 文件从 `src/` 迁移到各包的 `test/` 目录。配置更新：`vitest.config.ts` 包含 `test/`，`tsconfig.build.json` 排除 `test/`。一次性迁移脚本（`migrate-tests-to-test-dir.mjs`、`fix-*.mjs`）使用后删除。

## 考虑过的替代方案

- **运行时 `dist` 扫描**（旧方案）：已否决——耦合 build，dist/src 漂移风险。
- **从 core 跨包扫描**（旧方案）：已否决——创建反向依赖，违反分包自治。
- **仅 token 匹配**（旧方案）：已否决——无法验证参数覆盖，这是用户明确要求。

## 后果

- 新导出无测试时 CI 立即失败。
- 现有 op 新增参数时 CI 失败，直到有测试覆盖。
- 门禁无需 `npm run build` 即可运行（基于源码）。
- 每个包拥有自己的覆盖检查（`check:api-coverage` script 在各 `package.json` 中）。
- 旧 `packages/core/scripts/check-api-coverage.ts` 和 `list-exports.ts` 已删除。
