# Agent Note: ops-api-inventory generated from JSDoc

Status: implemented

[English](2026-08-30-ops-api-inventory-generator.md) | 中文

## Problem

`docs/ops-api-inventory.md` —— `.faijs` API 手册 —— 一直由手工维护并与 stdlib 算子逐渐脱节：每次运行时契约变更都要手动改文档，而文档门禁无法发现手册与真实算子签名之间的漂移。

## Decision

清单现在从 stdlib 真源生成。`scripts/gen-ops-api-inventory.ts` 从每个算子的 JSDoc 提取契约——`@group`/`@name`/`@doc-group` 负责分节、`@param params.<key>` 负责逐键参数表——并渲染三件产物：`docs/ops-api-inventory.md`（英文）、`docs/ops-api-inventory.zh.md`（中文）、`docs/ops-api-inventory.i18n.yaml`（配对记录）。两种语言都从同一份单语 JSDoc 生成，双语对不会漂移。

stdlib 算子 JSDoc 采用标准嵌套 `@param` 惯用法（`@param params.radius - …`），同时满足 verify-export-jsdoc 门禁：每个真实函数参数都有匹配的 `@param` 标签，不存在 stale 标签的存活空间。运行时缺省事实（参数描述里的 `type:…` / `required:true` / `default:…` 标记）被解析为类型/必填/默认三列；`@note` 块渲染为独立 blockquote 段落（相邻 `>` 行会在 GFM 中合并并触发 verify-md-wrap）。

内嵌标记承载代码无法表达的非运行时事实：`@qual`（✅/⚠️/❌ 界面品质状态）、`@compat`（输入形态兼容性）、`@also`（跨算子链接）。`gen-ops-api-inventory.ts --check` 校验已提交产物是否同步；它被接入 `npm run doc-sync` 链首，另有独立的 `gen-ops-api-inventory` / `check-ops-api-inventory` 脚本。

## Alternatives considered

- **非标准逐键标签。** 私有 `@params-members` 风格标签可以带着每个键的文档而不破坏标准契约，但用户拒绝了：JSDoc 必须保持标准，且门禁已把 `params.<key>` 识别为参数名 `params`。
- **AST 驱动提取键。** 从参数类型形状推导参数表会重复 JSDoc 已声明的事实，且没有并行文档源就无法承载散文（单位、默认值、含义）。
- **手工维护清单。** 既有方案；每次契约变更都要手工编辑，且没有任何门禁能检测过期。

## Consequences

- 每个契约事实现在只有一个归属（stdlib JSDoc）；除非生成器或 JSDoc 变化，生成的手册不会过期。
- doc-sync 链路以 `gen-ops-api-inventory.ts --check` 开头，手册失同步会在任何文档门禁运行之前就让链路失败。
- stdlib 算子的 JSDoc（此前缺失或畸形）现在是结构化的标准写法，把 verify-export-jsdoc 中算子函数的部分从红转为绿（仓库违规总数 1085 → 1041，其余全部为既有项）。
- `@note` 渲染采用每条一个 blockquote 段落以保持 GFM 正确。