# FCStd v3 产物运行契约（宿主侧要求）

状态：现行契约（2026-09-28）。面向所有要**执行** FCStd 转换产物（`.fai.zip` 内的 `.fai.js`）的宿主——
3d_editor、小程序 worker、脚本 runner 等。转换端（`@faicad/faijs-fcstd` CLI）不执行产物，不适用本文。

## 1. 背景事实

FCStd 转换产物的脚本会调用以下 op，它们**不在** core 的 `createApiNamespace()` 平台面里：

- `cad.sketch` —— 由 `@faicad/faijs-sketch` 提供（参数化草图，含 82.5% 语料文件）；
- `cad.draw` —— 由 `@faicad/faijs-draw` 提供（Draft 图纸重建）。

这是既定的库拆分契约：core 只带平台面，库 op 由宿主决定是否合并。宿主漏合并时，产物能通过
`cliCheck` 之外的转换检查、却在运行时报 `__ns.cad.sketch is not a function`。静态防线是
`cliCheck` 的 unknown-op 守卫（symbol 阶段报错）——宿主装配完成后应先 `check` 再 `run`。

## 2. 契约要求（缺一即 run 失败）

1. **合并库命名空间**：宿主注册的 `cad` lib 必须在 `createApiNamespace()` 之上合并
   sketch 与 draw 两个库面：

   ```ts
   import { createApiNamespace } from '@faicad/faijs'
   import { mergeSketchNamespace, registerSketchSymbols, installSketchSolver } from '@faicad/faijs-sketch'
   import { createNodePlanegcsSolver } from '@faicad/faijs-sketch/node'
   import { mergeDrawNamespace, registerDrawSymbols } from '@faicad/faijs-draw'

   const cad = mergeDrawNamespace(mergeSketchNamespace(createApiNamespace()))
   rt.registerLib('cad', cad, { default: true })
   registerSketchSymbols()
   registerDrawSymbols()
   installSketchSolver(createNodePlanegcsSolver)   // Node；浏览器端用浏览器 solver
   ```

   两个 `merge*Namespace` 均为纯函数（无注册副作用）；`register*Symbols` 把 op 名登记进
   symbol table（静态分析可见）；`installSketchSolver` 注入 planegcs 求解器（参数化草图
   运行时重解依赖它，缺了报 solver 缺失类错误）。

2. **注册一次、全程有效**：solver 经模块级安装，整个进程共享；多 worker 场景每个 worker
   各自安装。

3. **资产目录**：产物含 `assets/freecad/` 冻结 `.brp` 时，`cliRun` 需传 `assetsDir`
   （或在容器内相对解析），缺了报 asset-not-found 类错误。

4. **BREP 模式**：产物面向 `--mode brep`（STEP 导出链）验证；mesh 路径对部分 op 报
   `E_MESH_UNSUPPORTED`，属预期（静态分派，无运行时回退）。

## 3. 防回归锚点

- 宿主装配的反向断言（裸命名空间必红）：fcstd-port `test/unit/cad-namespace.test.ts`。
- faijs 侧 unknown-op 静态守卫：`packages/core/src/node-host/cli.test.ts`
  （`cliCheck` 对未注册 op → ok=false, stage=symbol）。
- fcstd 包自测已合并命名空间的 e2e：`packages/fcstd/src/container-open-e2e.test.ts`。
