# Agent Note: FCStd 移植 M10 — Body 顺序与多 Body 拆分（2026-09-17）

## 决策 1：Body.Group 作拓扑排序主序（M10.1）

Kahn 迭代顺序改为 `Body.Group` 序优先、文档序兜底（`depsOf` 的
Base/Tool/Profile/BaseFeature 链仍作依赖判定回退）。这保证 D-C 链式 fuse
严格按 PartDesign 特征顺序展开。

## 决策 2：Pocket base 规则定死（M10.2，探针实测）

PocketTest 探针：`Pocket.BaseFeature=Pad`、`Pocket001.BaseFeature=Pocket`
——BaseFeature **恒指向链上前一特征**。规则即：BaseFeature 有值时以其为准
（现有实现已是此行为），M9.4 的链式回退仅覆盖 BaseFeature 缺失/未解析形态。

## 决策 3：多 Body 拆分（M10.3/M10.5）

- 有几何的 Body 各产 `model/<BodyName>.fai.js`，末尾 `let <Body>_out = <链头>;`
  终端别名（faijs 无 identity op，纯 JS 赋值）
- `main.fai.js` 为聚合入口：`cad.group({ members: [<Body>_out, ...] })`
- 无 Body 几何 → 整体回落单文件 main（现有 e2e 形态不变）
- 散落 Part 特征（不归属任何 Body）留在 main.fai.js

## ⚠️ M10.4 实测结论（重要，两个待定项落定）

1. **仓库内不存在 `.fai.zip` 加载器**：grep 全仓无 zip-loader 消费代码，
   e2e 是解包后直接取 `model/main.fai.js` 执行。`manifest.entry` 已显式写死
   `model/main.fai.js`（container.ts），无需改动。
2. **真实语料的 Body 不带 `Group` 属性**：PadTest 的 Body 只有
   `Tip: Pad002`，特征链完全靠各特征的 `BaseFeature` 依赖表达。因此
   PadTest 走单文件回退路径（行为正确）；多文件拆分仅对带 Group 的
   Body 生效（合成 fixture 单测覆盖）。

**已知限制（如实记录）**：多 Body 产物的 `<Body>_out` 聚合引用
（`cad.group({ members: [Body_out, ...] })`）在 main 里引用的是其它文件的
变量——**没有加载器时跨文件变量不可解析**，多文件产物目前只能生成、
不能端到端 run。e2e 三样本均为单文件路径不受影响。待 M11+ 引入容器
加载器（消费 manifest.entry + model/ 多文件）后才能闭环，届时聚合入口
需要改为跨文件 import 或加载器拼装语义。

## 基线

e2e 三样本基线无变化（PadTest 4/6/3、Crank 0/16/0、ProjectTest 0/1/0）——
真实语料全部走单文件回退，无需更新。

## 测试

- `codegen.test.ts` 新增 2 例：双 Body 拆分 + 聚合引用、散落特征留 main
- 全量 fcstd 13 文件 / 92 用例 + e2e 三样本全绿
