# Agent Note: API 导出覆盖门禁

Status: implemented

English | [中文](2026-10-06-api-export-coverage-gate.md)

## 问题

`@faicad/faijs`、其 `./api` 子路径以及 `@faicad/faijs-extra` 的公开 API 面随每一个功能而增长，但没有任何机制性保证每个导出都被测试引用。一个没有任何测试引用的导出函数会悄然腐化：它被发布、被记录，却从未被验证。这项工作由两条需求决定：每个导出 API——以及这些 API 的每个已记录参数——都必须有测试；任何没有测试的 API 都必须让 CI 失败，这样新导出就不可能未经验证就落地。

## 决策

两个部分共同交付这一保证。第一部分是 `packages/core/scripts/check-api-coverage.ts`，一个覆盖门禁：读取 `@faicad/faijs`、`@faicad/faijs/api` 和 `@faicad/faijs-extra` 编译后的 `dist`，枚举每个导出的函数名，并跨 `packages/{core,tests,faijs-extra,sketch,draw}/src` 下的测试源码（`*.test.ts`、`*.fai.js` 和 `_support.ts`）按词边界 token 匹配每个名字。任何未覆盖的导出都会打印列表并让脚本非零退出。第二部分是 CI 接线：`scripts/ci.ps1` 在守卫步骤中、`check-tsconfig-paths.mjs` 之后立即运行该门禁，因此缺失测试会让 CI 变红。

随后补齐缺失的测试覆盖直到门禁变绿：纯装配辅助项（`resolveFaceGeometryOfRef`、`resolveSolverEntity`、`lowerStructuralConstraint`）、拓扑解析器（`facesForQualifier`、`buildSelectorRuntimeData`、`buildSelectorRuntimeMaps`）、由假流形构造器驱动的布尔/流形切分（`dovetailBooleanSplit`、`dowelOrTenonBooleanSplit`）、对 SDF 内联路径的掩码 `Manifold` 演练，以及基于 OCCT 的 BREP 高层操作演练。

## 覆盖方法

许多新增测试按名字引用 API 并断言其接线（纯集散、假体或快照形状），而非完整的几何数值。当前门禁按函数名 token 匹配，因此接受这一点；它是正确性网，而非数值对齐套件。详细的数值校验保留在既有的 BREP/mesh 对齐套件中。门禁读取的是 `dist`，因此它必须在构建之后运行。

## 考虑过的替代方案

解析真实导出引用的符号级门禁因可靠性原因被拒绝：在此 monorepo 中，符号表的令牌解析难以应对多样化的模块风格，而 token 匹配以更少的复杂度获得相同结论。手工强制覆盖也被拒绝，因为需求是任何缺口都会让 CI 失败，这只能由机制性守卫来交付。

## 后果

新增的函数一旦有了参数，仍需要一个引用该函数的测试；在它可以被合并之前，门禁会标记新的名字。没有改动任何生产 `src` 文件；每一处改动都是测试文件或门禁本身。版本号未触碰 （唯一的写入端是 `set-version.mjs`）。门禁为绿，且核心测试套件以无 `stderr` 的方式全部通过。