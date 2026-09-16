# Agent Note: FCStd → faijs 单向移植落地 M0–M6

> 日期：2026-09-16
> 状态：M0–M6 已实施（M6.1 特征级选边消费方待 R7 拍板后接入）
> 计划文档：`docs/plans/2026-09-15-fcstd-to-faijs-port-plan.md`

## 决策记录

1. **planegcs 依赖安装方式**：npmmirror 镜像无该包 tarball（404），且 `npm install -w` 会把 workspace 内部包当注册表依赖导致 E404。最终以官方 registry tarball 手动解包进 `node_modules/`。**遗留**：`packages/core/package.json` 已声明 `@salusoft89/planegcs`/`fflate`/`@xmldom/xmldom`，但 lockfile 链路需在正常 npm 环境（node ≥ 22 自带 npm 10）下重跑 `npm install` 收录；`check-ghost-deps` 守卫通过（声明齐全）。
2. **DistanceX/Y → planegcs `difference` 映射**：语义经实测标定为 `param2 - param1 = difference`（与直觉相反）；FCStd 的 DistanceX/DistanceY 值本身带符号，直接对齐。
3. **草图轮廓接线边界（M5 现状）**：`.fai.js` 脚本面尚无草图声明语法（属 M6 的 cad 面接线），因此 L0 草图的轮廓只落 `mapping.json` 的 `sketch.gcs` 字段（D1 契约），Pad/Pocket 的 profile 在脚本面解析不到实体变量时按 D3 降级 baked 并记 `reason: pad-missing-profile`。**这不是缺陷，是计划内的阶段边界**——M6.3 解锁。
4. **V2 最终实测结果**（56 文件 / 126 草图 / 1,539 约束，M6 后）：L0=122、L1=4（1 unsupported-constraint + 3 delta-exceeds-t1，均按 D3 降级 L1 保留初值）、L2=0。T1=1e-6 标定成立（早期测量 delta p99=3.55e-15）。两轮解析修正贡献显著：GeoUndef(-2000) 占位符误判为外部几何（82→113）、老格式 `<UID/>` 包装未跳过（113→115）、M6.3 外部几何投影解锁（115→122）。
5. **旧格式兼容**：ProgramVersion 0.14–0.17 时代的文件（如 PadTest.fcstd）中 Pad 的 profile 链接属性名是 `Sketch` 而非 `Profile`（`profileLink()` 双读）；`<Geometry>` 子元素前可能存在 `<Construction/>`/`<GeoExtensions/>` 包装，解析时跳过。
6. **生成的 .fai.js 语法**：faijs 是顶层 `let partN = cad.x(...)` 语句流（对照 `packages/tests/faijs/` fixtures），无 `export function main` 包装、无 return；产物已通过 `faijs-cli check`（V7）。

## 代码位置

全部在 `packages/core/src/fcstd/`：`unpack.ts`（M1.1）、`document.ts`（M1.2）、`container.ts`+`build-fai-zip.ts`（M2）、`sketch-parse.ts`（M3.1）、`sketch-solver.ts`+`planegcs-backend.ts`（M3.2–M3.4）、`sketch-verify.ts`（M3.5/D2/D3）、`contour.ts`（M3.6）、`feature-translate.ts`（M4）、`codegen.ts`（M5）。

脚本：`packages/core/scripts/` 下 `scan-fcstd-samples.ts`（M1.3/1.4）、`validate-sketch-solve.ts`（V2）、`fcstd-to-fai-zip.ts`（端到端）、`probe-planegcs.ts`（M0）。

## 遗留 / 后续

- M6：元素引用锚点（M6.1）、表达式降级（M6.2，样本 1,709 个 ExpressionEngine）、外部几何解锁（M6.3）。
- R7 待拍板项（revolve/sweep 挂 cad 面）未动：`PartDesign::Revolution` 等当前按白名单外烘焙。
- M2 报告的几何计数 640 vs 计划 786：差值为统计口径（计划含外部几何缓存条目），非数据丢失。

## 验证与踩坑留档（2026-09-16 补充）

按 AGENTS.md「验证与踩坑留档铁律」，实施过程中的关键验证与 API 坑已固化为三个防回归测试文件（`packages/core/src/fcstd/`，全量 40 测试通过）：

- `api-gotchas.test.ts`：planegcs `difference` 语义反向（param2−param1）、DistanceX/Y 带符号、fflate `zipSync` 字符串值栈溢出（必须 `strToU8`）、求解坐标回读走 `sketch_index.get_primitive` 而非 `get_gcs_params`。
- `format-gotchas.test.ts`：GeoUndef(-2000) 占位符 ≠ 外部几何、`<UID>/<Construction>/<GeoExtensions>` 包装元素、老格式 Pad profile 属性名 `Sketch`、ObjectData 无 type 属性需回查 `<Objects>` 索引。
- `external-geo.test.ts`：wireframe edgeGroups[k] ↔ FreeCAD `Edge(k+1)` 序号契约（IndexedMap 枚举序）、外部边投影到草图局部 z≈0、PointOnObject 求解收敛 L0。**注意**：该文件依赖本地 FreeCAD 样本库（`D:/Faicad/FreeCAD/...`），样本缺失时 `describe.skipIf` 自动跳过，CI 无样本仍绿。

一次性 dbg/repro 脚本已删除；可复用脚本保留 `scan-fcstd-samples.ts`（M1 全量扫描）与 `validate-sketch-solve.ts`（V2 全样本求解验证）。
