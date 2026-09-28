# Agent Note: 统一 .fai.zip 容器（manifest v3，多模型）

Status: implemented

[English](2026-09-28-unified-fai-zip-container-v3.md) | 中文

## Problem

`.fai.zip` 容器格式此前未充分规范：faijs 转换器输出单入口 manifest
（`format: 1`、`entry: "model/main.fai.js"`），编辑器按文件名猜入口，且各消费方
（编辑器、fcstd-port、第三方）没有共享的读取实现。统一容器设计（编辑器计划
2026-09-27）要求：标准 manifest schema、fcstd 产物每 Body 一个模型、入口只认
manifest、宿主共享同一份读取实现。

## Decision

`@faicad/faijs-fcstd` 现拥有容器读取 API，fcstd 写入侧升级为 manifest v3：

- **Manifest schema**（`packages/fcstd/src/container.ts`）：`format: 3`、
  `units: "mm"`、`models: ContainerModel[]`（id/entry/label?/data?）、可选
  `active`（缺省 `models[0]`）、可选 `source`/`requiresBrep` 保留。`entry`
  字段移除；读到 `format !== 3` 抛错并携带观测值（无历史回退）。
- **写入侧**（`build-fai-zip.ts`、`convert.ts`）：`buildFaiZip` 增加
  `models` 参数；fcstd 转换产物为 `main`（聚合入口）+ 每 Body 一个模型
  （`model/<Body>.fai.js`），与既有 codegen 布局一致。
- **读取 API**（`packages/fcstd/src/container-read.ts`，经 `src/index.ts`
  公开导出）：`readManifest` / `listModels` / `listModules` / `readModule` /
  `readAssetEntries` / `openContainer`。环境无关（仅 fflate `unzipSync` +
  `JSON.parse`，零 `node:*`），web worker 可直接使用。错误一律携带违规值；
  未知 manifest 字段、表外成员（`preview/**`、`export/**`、`cache/**`、
  `mapping.json`、`freecad/**`、自定义条目）一律忽略、绝不报错。id/entry
  重复、entry 不在 `model/` 下、具名 `data` 成员缺失、`active` 不在集合内、
  请求的 model id 不在 `models[]` → 全部抛错。
- **资产 key**（规范 §7）：`files/**` 以 fileId 为 key，`assets/**` 以去扩展
  名 basename 为 key；两命名空间 key 冲突抛错。脚本引用缺失资产在执行期失败
  （宿主把 `assets`/`files` 接入运行时；由 e2e 负向用例验证）。

## Alternatives considered

- 保留 `entry` 只改 `format`——拒绝：无法表达多模型产物，且编辑器的
  打开即重放流程需要按模型取入口。
- 读取 API 放 core（`@faicad/faijs`）而非 fcstd 子包——拒绝：规范（§2.9）
  两者皆可；fcstd 是自然归属（转换已在此），编辑器为转换一致性消费同一包。
- 按文件名猜入口（`endsWith('main.fai.js')`）——拒绝：规范 §5.4 只认
  `active` 或 `models[0]`，绝不按文件名。

## Consequences

- fcstd 产物以多模型容器打开：`main` + 每 Body 一个模型，各自可独立执行
  （由 openContainer e2e 验证：每个模型走 BREP 链并产出 STEP 几何）。
- core 中两处硬编码 fcstd-port 产物的探针（`probe-beds-parts.ts`、
  `probe-a2-beds.ts`）已改用 `openContainer`，手工 fflate 解包移除。
- `@faicad/faijs-fcstd` 0.18.3 → 0.19.0；同分支完成可发布包对
  `@faicad/faijs@^0.19.0` 的 peer 扫描（core 0.19.0 升级遗留的 lockstep 红）。
- 旧 `format: 1` 容器按设计被拒绝；141 个已入库 fcstd-port 产物不在本次
  重生成范围（另一台机器执行）。
