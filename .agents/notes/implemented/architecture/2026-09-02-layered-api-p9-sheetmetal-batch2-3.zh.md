# Agent Note: 分层 API 移植 — P9 钣金库第二/三批（author/unfold 全功能面 + 全量测试套件）

Status: implemented

[English](2026-09-02-layered-api-p9-sheetmetal-batch2-3.md) | 中文

## Problem

P8 落地了第一批（纯 2D/数据层）及其精度门，但钣金移植到此为止：真正经 compat shim 消费图像 op（`fuse`/`cut`/`extrude` 等）的 3D 建模面（`authorFns`、`contourFlangeFns`、`reliefFns`、`formFns`、`hemFns`、`jogFns`、…）尚未移植，包内也只有 6 个测试而非方案的 227。P9 是剩余主体：第二批（3D 特征建模）+ 第三批（`facade`/`foreignUnfoldFns`），外加上游全量测试套件作为可执行证明。

## 决策

1. **第二/三批源码移植——与上游逻辑完全一致。** 15 个文件（`api`/`authorFns`/`contourFlangeFns`/`cutoutFns`/`facade`/`foldFns`/`foreignUnfoldFns`/`formFns`/`hemFns`/`jogFns`/`loftedFlangeFns`/`miterFns`/`reliefFns`/`tabFns`/`validateFns`）只改 import 来源行（`from 'brepjs'` → `from './compat.js'`）。对照锁定的上游 commit 做「去注释后的纯逻辑 diff」：每个文件**非 import 逻辑差异为零**（行数不同的地方全是纯 JSDoc 增行）。
2. **`compat.ts` 补全为 §7.3 全 API 面**（40 运行时函数 + 8 类型，已机械断言齐备）：3D op（`box`/`cylinder`/`sphere`/`face`/`extrude`/`translate`/`rotate`/`fuse`/`cut`/`intersect`）、曲面/度量查询（`getFaces`/`getBounds`/`getSurfaceType`/`normalAt`/`pointOnSurface`/`faceCenter`/`sharedEdges`）、`isValid`/`isPlanarWire`、以及 7 个 `vec*` 纯函数，均从 vendored L1/L2 重导出。`fuse`/`cut`/`intersect`/`box`/`cylinder` 在 compat 处包装以满足 vendored 的 `ValidSolid`/`SweepOptions` 品牌（上游公开面对该处未标注类型）；行为与 vendored op 一致。
3. **`rotate` 签名对齐（D12）：** vendored 树是四参数位置形态（P5 锁定的 commit），上游 brepjs 18 则接受 `{ at, axis }` 选项对象；compat 把位置形态包装成选项对象签名，移植调用方零改动。
4. **core 导出 `./vendored/*` 子路径。** 第二/三批使 compat 成为唯一跨包进入 vendored 树的导入点；发布的 core 包现在把 `@faicad/faijs-core/vendored/*.js` 映射到 `dist/vendored/*`，`@faicad/sheetmetal` 因此能对着真实包而非源码别名做构建。`test-setup.ts`（D10 内核装配）排除出 dist——它只属于测试 harness。
5. **233 个测试的可执行证明。** 上游 22 个测试文件全部移植（只做 import 重写：`../../../tests/setup.js` → `./test-setup.js`、`../src/x.js` → `./x.js`、`'brepjs'` → `'./compat.js'`），加上既有的 `reference.test.ts`。全量在 src 下全绿（233 测试），含 `fold`/`dxf`/`nest` 往返、`foreignUnfold` oracle 测试（13 个——**保留**，API 面已足够完备）、`normalizeSolid` compound 语义经 auth→unfold→fold 全路径实测（§7.5 ③）、以及面积不变量测试（`toBeCloseTo(., 6)`）。

## Alternatives considered

- **compound 只在唯一实体时拆包，否则保留原始形态。** 标准做法。备选——一律 `getSolids()[0]`——会静默丢掉多体情形，故 `internal.ts` 的单/多体守卫保留。
- **本阶段把 3D op 走 L3 `cad.*` 命名空间。** 否决：vendored L2 的值必须是 brepjs 形态的内核句柄（钣金 3D `solid` 在测试里是 brepjs `Solid`，供 `measureVolume`/`isValid`/`getBounds` 使用），而 `cad.*` 返回 faijs `Shape` 包装；compat shim 才是正确桥接，L5 库保持与 faijs 对象模型无关（D12）。
- **`tsconfig.build.json` 继续用 `paths` 而非 `./vendored/*` 导出。** 否决：`paths: {}` 让构建与源码别名隔离（正确），故真实包解析走 core 的 exports map——补子路径是最小且长效的修法。
- **把 `test-setup.ts` 留在 dist。** 否决：它是强依赖内核加载的 D10 测试 harness；发进 dist 会把内核耦合文件泄漏进本应零内核的 L5 库（§9）。排除。

## Consequences

- `@faicad/sheetmetal` 现已基于 L3 compat 桥实现上游全功能领域面：26 个源码模块，除 `compat.ts`（唯一桥接点，§9 白名单）外 `kernel`/`getBackends`/`getSlot` 零引用。
- 本地门禁全绿：sheetmetal `typecheck`/`lint`/`build`；全 workspace 测试（core 927、mech-lib 23、sheet 233、集成 1279 全过）；`check-ghost-deps`（540 文件）；`check-workspaces-order`（6 workspace）；`check-layer-boundaries`（237 文件）；`api-surface-snapshot`（10 子路径）；vendored 严格 `tsc`；根 `tsc`；madge 无环。
- 测试数超过方案 227 目标（此处 233）：差异仅测试文件行数随上游版本变化，并非覆盖缺口。
- **P9 的可执行证明就是移植来的套件本身：** 方案的旗舰主张——"faijs/L3 侧 + compat 足以支撑真实工业领域库"——现已端到端演示，而非估算。