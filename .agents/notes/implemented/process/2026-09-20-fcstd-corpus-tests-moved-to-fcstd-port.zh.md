# Agent Note: fcstd 语料依赖测试迁至 fcstd-port/test/FreeCAD

Status: implemented

English | [中文](2026-09-20-fcstd-corpus-tests-moved-to-fcstd-port.md)

## Problem

faijs 仓库携带两类 FCStd 测试：(a) 合成 fixture 单元测试（parser 坑、
codegen、placement 数学、容器、白名单翻译），随处可跑；(b) 语料依赖测试，
需要本机 FreeCAD 源码树（`D:/Faicad/FreeCAD`，经 `FAIJS_FCSTD_CORPUS`）的
真实 `.FCStd` 样本——语料缺失时在 CI 跳过。与用户确认的归属铁律：库/语料
分析代码在 `D:/Faicad/fcstd-port`；faijs 只保留通用 FCStd→`.fai.zip` 能力。
语料测试及其 fixture 应与语料同处一地，而不是留在 faijs。

## Decision

- **迁移（6 个测试文件）** → `fcstd-port/test/FreeCAD/`：`convert.test.ts`、
  `placement-corpus.test.ts`、`external-geo.test.ts`、
  `solver-wrong-solution.test.ts`（原 `packages/core/src/fcstd/`）、
  `fcstd-e2e.test.ts`、`fcstd-g9-contour.test.ts`（原
  `packages/tests/faijs/fcstd/`）。
- **迁移 fixture** → `fcstd-port/test/FreeCAD/fixtures/`：
  `packages/fixtures/data/fcstd/` 的 3 个 `.FCStd` 样本（hole_puzzle、
  taperedballnose、TestSketchCarbonCopyReverseMapping）。
- **免打包消费**：fcstd-port 新增 `vitest.config.ts`，把 `@faicad/faijs/*`
  alias 到 faijs 源码树（`../faijs/packages/core/src/`），迁移后的测试永远
  锻炼当前引擎代码，而非打包 tgz。
- **import 改写**为公开子路径（`@faicad/faijs/fcstd`、
  `@faicad/faijs/fcstd-convert`、`@faicad/faijs/node`）；`ConstraintType` /
  `PointPos` 需从 `.../fcstd/sketch-parse.js` 取——它们在 barrel 里是
  type-only 再导出（GOTCHA）。
- **faijs 保留**全部合成 fixture 单元测试（11 文件 / 112 用例）——发布代码
  的「验证留档为测试」铁律仍满足；管线本身的 CI 覆盖不丢。

## Alternatives considered

- **全部 fcstd 测试迁走、faijs 零保留** — 否决（用户决策）：发布模块零在库
  测试违反验证留档铁律；合成坑例本就不是 FreeCAD 语料，放 `FreeCAD/` 子目录
  语义也不对。
- **fcstd-port 测试消费打包 tgz** — 否决：对引擎改动是滞后的；源码 alias
  让测试保持实时（与 demo 的 M7 免打包同一模型）。

## Consequences

- fcstd-port：`npm test`（vitest）跑 6 文件 / 16 用例，全绿；测试依赖同级
  `../faijs` checkout（缺失即快速失败）与本机 FreeCAD 语料（缺失跳过语义
  保留）。
- faijs：`packages/tests` workspace 全量 1609 通过；core fcstd 套件 112
  通过。e2e golden 基线已按 H10 更新：Crank 不再把
  `Part::Part2DObjectPython` 列为 gap（现为 `python-baked`）。
- `packages/tests/faijs/fcstd/` 与 `packages/fixtures/data/fcstd/` 已移除；
  `api/edge-ref.ts` 中一处过时的文档引用已改指新位置。
