# Agent Note: 脚本归属——faijs 只留能力 + 测试，转换面公开

Status: implemented

[English](2026-09-20-script-ownership-and-fcstd-convert-surface.md) | 中文

## Problem

「faijs 承载通用 FCStd 能力，语料分析归 `D:/Faicad/fcstd-port`」这条规则，此前只被应用到画像脚本上，其余照旧：`packages/core/scripts/` 的 26 个文件里，17 个是语料报表或一次性内核探针，没有一个能被 CI 触达。

由此暴露出三个实打实的缺陷：

- **同一条转换管线有两份实现。** `fcstd-to-fai-zip.ts`（M5.4 期的 dev CLI）与 `fcstd-convert-cli.ts`（`src/fcstd/convert.ts` 的薄包装）跑同样的阶段，但在关键处不一致：dev 脚本没有 C4 终检（对含非 Python baked 对象的文档照样写出容器）、没有退出码契约。而 e2e 黄金测试恰恰钉在这个 dev 脚本上——**CI 验证的不是要发布的管线**。
- **一条已发布契约零测试覆盖。** `smoke-cad-builtin.ts` 用 `console.log` + `process.exit` 断言 D1（`createRuntime` 自带 `cad` 默认命名空间，纯引擎版不带）。D1 正是「宿主不必再注入 cad」的依据，而 `tsx` 脚本守不住它。
- **转换面无法发布。** `convert.ts:114` 调用 `createPlanegcsSolver()`，而 `@salusoft89/planegcs` 在 `devDependencies` 里 → `./fcstd-convert` 对消费方不可安装（曾记为批量转换方案的 B0 阻塞项）。

## Decision

**规则。** `packages/core/scripts/` 下**能在 CI 跑**的工具必须落成 `*.test.ts`；**不能跑**的（需要磁盘上的语料，或需要人工给输入文件）归语料所属项目，离开本仓库。语料画像永远只有一份实现。

**迁入 `fcstd-port/tools/`**（12 个工具，import 改走公开子路径 `@faicad/faijs/fcstd`、`/fcstd-convert`、`/occt-kernel/*`、`/brep/*`、`/api/*`、`/node`）：`coverage-report`、`validate-sketch-solve`、`locate-l1-sketches`、`calibrate-t1`、`probe-m13-types`、`probe-offset2d-feasibility`、`probe-padtest-brp-bbox`、`probe-padtest-brp-volumes`、`probe-pad002-chain`、`probe-pad002-upto`、`probe-step-volume`、`verify-geometry`；第 13 个 `scan-fcstd-samples` 则直接删除——`fcstd-port/lib/profile.mjs` 已经报了它的每一个数字（对象类型、草图、几何、约束、失败数、非零退出码），而且口径更准：解析几何/约束列表，而不是读 XML 的 `count` 属性。

**faijs 侧删除：**

| 删除 | 依据 |
|---|---|
| `scan-fcstd-samples.ts` | 与 `lib/profile.mjs` 重复（见上） |
| `probe-upto-circle.ts` | 唯一用例（圆形草图 `upTo` 斜平面）已被 `src/api/extrude-upto.test.ts` 锁住，常量逐字相同 |
| `smoke-cad-builtin.ts` | 由真正的测试取代——`src/cad-runtime/createRuntimeWithCad.test.ts` |
| `fcstd-to-fai-zip.ts`、`fcstd-convert-cli.ts` | 一条管线一份实现：两者统一为 `src/fcstd/cli.ts` |

**转换面公开。** `@salusoft89/planegcs` 由 `devDependencies` 提为 `dependencies`；`./fcstd-convert` 导出管线（`convertFcstdFile`、`SKETCH_T1`、`ALLOWED_DISPOSITIONS`）以及语料工具需要的求解器与分类器（`createPlanegcsSolver`、`planegcsWasmPath`、`classifySketch`、`maxPointDistance`、`resolveExternalGeometry`、`isWhitelisted`）；`bin.faijs-fcstd-convert` → `dist/fcstd/cli.js`。`package.json` 去掉 `fcstd:scan` / `fcstd:validate`；`fcstd:convert` 改为 `tsx src/fcstd/cli.ts`。

**e2e 改指。** `fcstd-e2e.test.ts` 改为驱动已发布的 CLI 并断言其退出码契约。基线是**跑出来**的，不是改数字改出来的：

- PadTest → exit 0，`{translated:6, pythonBaked:0, preservedOnly:7, baked:0}`，草图 3/3 为 L0。`preserved-only` 由 3 变 7，是因为 C4 终检把结构性/基准面的 `baked` 改名——对象集合与几何都没变。
- Crank / ProjectTest → exit 2、显式 gap 列表、**不产出容器**（16 条 gap：`Part::Feature`、`Part::Part2DObjectPython`；1 条：`App::InventorObject`）。旧黄金断言的是「C4 契约禁止产出」的那个容器里的计数。

## Alternatives considered

- **探针留在 faijs，挂个 `dev:*` 脚本命名空间。** 否决：17 个 CI 永不执行的脚本，按定义就是无人维护——依赖语料的那批，语料路径一变就烂；而且已经有两个烂在自己的 API 上了（`probe-pad002-chain.ts` 读 `res.outputs['part9']`，`CliRunResult` 早已没有该字段）。
- **`planegcs` 改 `optionalDependency`，CLI 缺失时给清晰报错。** 否决：约束求解对转换不是可选项——`convert.ts` 在任何轮廓抽取之前先求解每个草图，缺 solver 等于「完全不转换」，而不是降级模式。硬 `dependencies` 才是诚实的声明（约 1MB wasm+js，无传递依赖）。
- **把求解器整体搬进 fcstd-port。** 否决：L0/L1/L2 判定与 T1 容差属于转换契约，拆到两个仓库会产生分类逻辑的第二份实现。
- **把语料工具改成 faijs 里「语料缺失即跳过」的测试。** 对扫描/报表类否决：它们输出的是分布报表而非断言（供方案排期用），而一个 skip 的测试会掩盖「语料路径属于另一个项目的数据」这一事实。引擎侧该有的语料门测试已经有了（`convert.test.ts`、`placement-corpus.test.ts`、`fcstd-e2e.test.ts`、`fcstd-g9-contour.test.ts`、`external-geo.test.ts`）。

## Consequences

- faijs `packages/core/scripts/` 只剩 9 个文件：`faijs-cli.ts` + 8 个 `gen-*.ts` 代码生成器（导出面/op 一致性门禁接线于此）。其余要么是测试，要么在 fcstd-port。
- **`./fcstd-convert` 仅限 Node。** `planegcs-backend.ts` 经 `createRequire(import.meta.url)` 从 `node_modules` 定位求解器 wasm，`external-geo.ts` 还要 occt 内核（仍是 peerDependency）。主入口不引用它，故浏览器打包不受影响——但浏览器侧转换需要另一套 WASM 投递方式。
- 公开面净增 1 个子路径（快照 12 个）与 9 个此前内部的运行时导出。`isWhitelisted` 也在其中：它定义翻译范围，语料覆盖率报表必须与被转换器实际执行的范围同源。
- **验证证据**（均于 2026-09-20 实测）：`tsc -p tsconfig.build.json` exit 0；`api-surface-snapshot.mjs` 12/12 子路径可导入；`check-ghost-deps` / `check-layer-boundaries` / `check-workspaces-order` 全过（`@salusoft89/planegcs` 现在是显式依赖，幽灵依赖守卫是「按构造满足」而非豁免）；`createRuntimeWithCad.test.ts` 2/2；`src/fcstd` 121/121；`fcstd-e2e.test.ts` 2/2（真语料）。消费侧：`npm pack` → 在 `fcstd-port` 安装 tgz → `planegcs` 随包落地、`node_modules/.bin/faijs-fcstd-convert` 跑 PadTest 得 exit 0 且容器写出；对 12 个迁入工具 `tsc --noEmit` 针对已发布面 0 错误。
