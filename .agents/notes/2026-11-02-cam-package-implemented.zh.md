# Agent Note：新增 @faicad/cam 包（BREP.io CAM 移植内核）

Status: implemented

## Problem

将 BREP.io 的 CAM 功能移植到 3d_editor web 端（weapp 二期）。算法内核承载在 faijs
新增 `@faicad/cam` 声明库包内：CAM 声明进 sceneScript（可重放 / AI 可控），复用
faijs worker 新增 `camGenerate` 指令执行（BREP 句柄不出 worker），执行结果经
`camBuild` 采集回主线程，不进场景树、不新增 undo。

## Decision

新增 `packages/cam` workspace 包（version 0.45.19，与家族版本线一致）：

- 骨架照 sheetmetal：`faijs.autoLift=false`、`peerDependencies: { "@faicad/faijs": "^0.45.0" }`、
  单入口 `exports: { "." }`、build = `tsc -p tsconfig.build.json && node ../../scripts/fix-import-extensions.mjs dist`。
- 唯一第三方依赖 `clipper-lib@6.4.2`（无类型声明 → `src/clipper-lib.d.ts` 一行
  `declare module 'clipper-lib'`）。
- 根 `package.json`：workspaces 数组在 `packages/sheetmetal` 之后插入 `packages/cam`；
  build 链在 sheetmetal 之后插入 `npm run build -w @faicad/cam`。
- `node scripts/gen-importmap.mjs` 重跑：cdn/versions.json 等为 `@faicad/cam@0.45.19`
  增加 pin。

## API 面（src/index.ts 全量导出）

- 声明入口（fai-script 侧）：`cam.machine` / `cam.stock` / `cam.op.roughing` /
  `cam.op.surfacing`（lib.ts → collect.ts 模块级 `_current` 收集器，对齐 fai-animation
  运行时模式；`import type { Shape } from '@faicad/faijs/browser'`）。
- worker 侧唯一入口：`generateToolpathForDeclaration(op, target, machine)` +
  `resolveFaceTriangles(op, shape, triangles)`（faces: `undefined`/`'all'`→全件；
  `number | number[]`→按 `faceRanges` 过滤，无 faceRanges 或空选区硬抛错；
  entity 引用数组硬抛错，要求宿主预解析为 face indices）。
- 算法：`generateSurfacingToolpath`（球头三接触解析解 + TriangleFootprint XY 空间哈希 +
  自适应采样 + serpentine 链接；本期仅支持球刀）、`generateRoughingToolpath`（shadow
  loops 等高粗加工，clipper union/offset）、`generateGcodeForCamToolpathProgram` +
  `combineCamToolpathPrograms`（G-code 后处理）、`flattenCamToolpathProgram`（回放仿真
  数据层）、`makeStockMesh`（box/cylinder/custom）、`CamMachineProfile`/`CamStockProfile`
  默认值 + 归一化。

## 行为要点（测试中记录）

- 坐标：`toMachinePoint` 恒等（3d_editor +Z-up，不需要 BREP.io 的 [x,y,z]→[x,z,y] 交换）。
- 空结果语义：算法内部任何失败均返回空 program + warnings，不向外抛异常
  （surfacing 栅格密度门禁 throw 也在主流程 try/catch 内转为 warning）。
- roughing 端到端产出**一条连续路径**（makeRoughingContinuousPath 合并全部 level），
  `summary.levelCount` = 切片数；刀路 z 落在各切片 bottomZ（buildDepthLevels 语义：
  topZ 不含、bottomZ 含）。
- gcode `tokenSpacer=false` 时主轴字为 `M3S12000`（先 M3 后 S）。
- 测试 fixture 注意：`makeBoxMesh(size, center=[0,0,0])` 盒体 z∈[-5,5]；需要 z∈[0,10]
  时显式传 `center=[0,0,5]`。

## 验证

- 10 个 test 文件 82 用例全绿（vitest run -w @faicad/cam）。
- typecheck / lint / build 通过；`check-api-test-coverage --package=cam` 通过
  （L1 77 导出、L2 16 APIs 零缺口，含专门 api-coverage.test.ts）。
- `check-workspaces-order`、`check-lockstep` 通过（gen-importmap 已重跑）。
