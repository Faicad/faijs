# fcstd-port 全量重跑与草图/求解保真后续开发计划（2026-10-03）

- Status: 实施中（全量重跑已完成；求解/空草图差异待开发）
- 引擎基线: faijs `0.29.1`（`@faicad/faijs-freecad` cli）
- 语料: `C:/git/F-cad/FreeCAD-library` 3,191 `.FCStd`（排除备份）
- 转换工程: `C:/my/Faicad/fcstd-port`
- 批量入口: `tools/rerun-convert.mjs`（本次新增）
- 渲染验证: `C:/my/Faicad/3d_viewer_electron`（`loadFormat(buf,'fai')` 真实加载路径）

## 0. 用户原话（2026-10-03）

> 我怀疑是这些fai.zip文件的问题。你根据C:\git\F-cad\FreeCAD-library的原始数据，重新跑一遍转换，然后看能否查看。选一个测试一下。……faijs本身就提供转换的命令，你只需要跑一个命令，这么简单的事情。

> 给我完全更新 fcstd-port 项目，把所有的fai.zip包全量重跑。

> 你不应该写agent notes, 给我写开发计划文档

## 1. 已完成：全量重跑

fcstd-port `FreeCAD-library/` 下 git 跟踪的 **1006 个** `.fai.zip` 全量重转（新增缺失的 2185 个源不在本次范围，用户只要求重跑现有包）。

### 1.1 旧文件的根因（确认用户怀疑）

旧容器是**上一次转换器**的产品：其 sketch 调用为 `cad.sketch({ contours: [...] })`，与新契约（`cad.sketch({ geoms, constraints, plane })`）不符，运行时抛 `E_SKETCHC_NO_GEOMS`。全量重跑后该项消除。

### 1.2 重跑结果

| 指标 | 数量 | 说明 |
|---|---|---|
| 目标 | 1006 | FreeCAD-library/ 下所有现有 `.fai.zip` |
| 成功 | 1004 | `ok:true`，产出新契约 sketch 调用 |
| 失败 | 2 | 均因 `Part::Sweep` → `sweep-transition-unsupported:transformed`（容器仍有效，Sweep 段归为 bake） |

失败明细：`Generic objects/key-ring-18_9-mm`、`Mechanical Parts/Enclosures/PF15/PF15_dock`。

### 1.3 批量驱动

`tools/rerun-convert.mjs`：把相对路径映射回源 `.FCStd`，逐文件隔离子进程调 `@faicad/faijs-freecad` 0.29.1 CLI 重转覆盖。支持并发 / 断点续跑 / `--force`；失败落 `reports/`。

## 2. 遗留问题定位（全局清单）

「能打开」解决之后，渲染抽查暴露三个更底层差异（**两个待开发，一个已消除**）：

| 现象 | 涉及文件 | 根因 | 状态 |
|---|---|---|---|
| `E_SKETCHC_NO_GEOMS` | 旧容器（全体） | 旧 `contours` 契约不匹配 | **已消除**（重转解决） |
| `E_SKETCHC_CONFLICTING` | `Windows/Casement/ThreePartRight` | FreeCAD 草图冗余约束被转换，planegcs 判冲突 | 待开发 |
| `E_SKETCHC_NO_GEOMS` | 纯 bake 体（`key-ring`） | 无可转 sketch 时仍发空 `cad.sketch({ })` | 待开发 |

### 2.1 问题 A：`E_SKETCHC_CONFLICTING`（约束投影矛盾）

FreeCAD 草图里对同一组几何同时叠了 `horizontal` + `coincident` + `distanceY=350` 约束；`distanceY` 与「两端均为水平/重合」冲突。FreeCAD 容忍这种冗余，planegcs 判定冲突。
- 转换侧 precheck（sketch L0 ok:true）与运行时再解不一致 —— 属求解保真差异。
- 已确认转换器输出的 `p_Height / p_Width / p_HeightTop` 常量有正常值，非常量缺失。

### 2.2 问题 B：`E_SKETCHC_NO_GEOMS`（纯 bake 体空草图）

- 当 body 完全依赖被 bake 的操作（如 `Part::Sweep`）时，转换器仍发一个空 geoms 的 `cad.sketch({ })`（`main.fai.js` 仅几百字节），运行时抛 `E_SKETCHC_NO_GEOMS`。
- 应在无可转换几何时省略该 op，而不是发一个空 sketch。

## 3. 后续开发计划（按优先级）

### A 组：问题 A（约束冲突投影）

- 取点复现 `ThreePartRight.fai.zip`：比对 FreeCAD 源 `Casement/ThreePartRight.FCStd` 每条约束与转换输出的 `constraints` 数组。
- 定位转换器约束映射层（codegen sketch 分支）：判断是 projection 冗余导致求解器语义不符，还是源文件本身约束自相矛盾。
- 目标：重转后该 sketch 能去重/自洽，运行时不再冲突。
- 单测：在 `packages/faijs-freecad` 取 `ThreePartRight` 用例，断言运行时 sketch 求解不抛 `E_SKETCHC_CONFLICTING`。

### B 组：问题 B（空草图）

- 修 codegen：当 sketch 无可转换几何时，不产生 `cad.sketch({ })`，改用其它表示（bake 已带 BREP asset）。
- 单测：`key-ring` 用例（纯 bake 体）运行不再抛 `E_SKETCHC_NO_GEOMS`。

### C 组：验证与收口

- 全量重跑产物收进 fcstd-port（提交 1006 个 `M` 的 `.fai.zip`）。
- 扩展 `3d_viewer_electron` 的 fcstd-port 探针测试：加 bake 体与 Casement 样本，验证 electron 真实加载全部通过。
- `--force` 全量重转一遍，确认 0 gap 结果稳定。

### D 组：流程纪律

- 一类一修、一测一提交；严禁 `--no-verify`；stderr 零容忍；长任务串行；跑完改完再回到本计划勾销状态。

## 4. 留存

- `tools/rerun-convert.mjs`：可重复批量入口，`--force` 全量重转。
- `reports/rerun-summary*.json`：每次的统计与失败明细。
- 探针测试保留可渲染样本 + 注释说明两个差异的来源，测试按渲染失败显式暴露尚未修复项。