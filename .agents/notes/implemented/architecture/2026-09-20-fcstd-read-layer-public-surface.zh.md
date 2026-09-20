# Agent Note: FCStd 读层公开化；语料画像迁出 faijs

Status: implemented

[English](2026-09-20-fcstd-read-layer-public-surface.md) | 中文

## Problem

本项目的铁律是：faijs 只承载**通用**的 FCStd → `.fai.zip` 能力，库语料的分析归移植项目 `D:/Faicad/fcstd-port`。到 2026-09-20 这条规则被违反了两遍。

- `packages/core/scripts/profile-fcstd-library.ts`（commit 50a30e6）与 `packages/core/scripts/scan-fcstd-library.ts`（次日由未看过 fcstd-port 的 agent 新增）是同一件全库画像的两份实现，外加一份 785KB 的 `fcstd-library-profile.json` 产物。
- 两份实现的数字互相矛盾。前者报 **XLink = 0**，后者报 **11 文件 145 处**。直接用 XML 核验后定论：库内 **1,159 个 `<XLink>` 元素分布在 15 个文件，且 `file` 属性全为空**——两个数都不对，而方案里的 H9（「跨文档引用必须实现」）正是建立在错的那个上。
- 与此同时 fcstd-port 根本没法读 FCStd：`tsconfig.build.json` 排除了 `src/fcstd`，`package.json` 也没有 FCStd 子路径，于是唯一的画像办法就是跨仓库 import faijs 源码——这正是重复实现的成因。

## Decision

从 faijs 删除库分析代码，并把读层做成正式公开 API，使消费方不必再伸手进 faijs 内部。

- 删除 `profile-fcstd-library.ts`、`scan-fcstd-library.ts`、`probe-one.mjs`（硬编码 FreeCAD-library 路径）与两份画像产物。
- 新增 `packages/core/src/fcstd/index.ts` 与 `@faicad/faijs/fcstd` 子路径，**只导出读的一半**：`unpackFcstd`、`memberText`、`parseDocumentXml`、`parseSketchObject`、`parseGeometryList`、`parseConstraintList`、`parseExpressionEngine`、`CONSTRAINT_NAMES` 及其类型。
- 从 `tsconfig.build.json` 的 exclude 中移除 `"src/fcstd"`。一次只读探测（把 fcstd 重新纳入的 `tsc -p` + `--noEmit`）显示 **0 错误**——该排除只是 WIP 发布范围，不是类型问题。
- 重生成 `scripts/api-surface-snapshot.json`（现 11 个子路径，`./fcstd` → `memberText`、`parseDocumentXml`、`unpackFcstd`）。
- 唯一保留的画像脚本归 fcstd-port：`lib/profile.mjs`，消费已安装 tgz 的 `@faicad/faijs/fcstd`，产物 `reports/library-profile.{json,md}`。

## Alternatives considered

- **在 fcstd-port 里写独立画像脚本（自带 ZIP + 正则扫描）。** 否决：那等于重新实现 `document.ts` 已经编码的 `<ObjectData>` / `<Objects>` 的 name→type 拆分与包装元素布局，而「两份 XML 读者」正是 XLink 数字分叉的成因。
- **画像脚本留在 faijs，fcstd-port 用相对路径 import。** 否决：跨仓库源码引用，且发布方案要求消费方走 tgz。
- **直接删掉重复实现、暂不做替代，等转换入口发布。** 否决：全库画像是方案里一切排期的输入，失去重生成能力会让 §3/§10 悬空。

## Consequences

- 数字**有意**变化，方案已同步：表达式改按**绑定条数**计（17,166 条，其中非常量 16,277 条 = 94.8%），而非「携带 engine 的对象数」（旧的 38,015 / 43% 把空 engine 也算进去了）；XLink 为 1,159 处 / 15 文件 / **跨文档 0**，故 H9 降级为非阻塞，`App::Link*`（149 个对象，文档内链接语义）移入 P2 排序。
- 消费方无需安装求解器即可画像/检查 FCStd：读层只依赖 `fflate` 与 `@xmldom/xmldom`。
- **转换**入口当时不可导出：`convert.ts` 拉 `@salusoft89/planegcs`（当时是 devDependency），`external-geo.ts` 拉 occt 内核。**2026-09-20 已解** —— `planegcs` 现为 `dependencies`，`./fcstd-convert` 与 `faijs-fcstd-convert` 均已发布；详见 Agent Note `2026-09-20-script-ownership-and-fcstd-convert-surface`。
- `@faicad/faijs/fcstd` 是新的公开子路径：此后读层的任何改动都是 API 变更，且改导出面后必须先建 dist 再重生成快照。
