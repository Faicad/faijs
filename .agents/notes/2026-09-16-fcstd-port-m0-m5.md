# Agent Note: FCStd → faijs 单向移植落地 M0–M6

> 日期：2026-09-16
> 状态：M0–M6 已实施（M6.1 边锚点 + Fillet/Chamfer 接线已落地；M6.3 外部几何仅解锁 wireframe 边投影，全量外部几何未解锁）
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

- M6.2 表达式降级（`expressions.ts`）与 M6.1 边锚点均已落地；M6.3 外部几何仍为「wireframe 边投影已解锁、全量外部几何未解锁」。
- R7 待拍板项：revolve 已挂 cad 面；sweep 样本为 0，搁置。
- M2 报告的几何计数 640 vs 计划 786：差值为统计口径（计划含外部几何缓存条目），非数据丢失。

## M6.1 边锚点与 Fillet/Chamfer 接线（2026-09-16 补充）

**问题**：FCStd 的 `PartDesign::Fillet` / `PartDesign::Chamfer` 只用 `Base`（`App::PropertyLinkSub`）给出「前序特征 + `EdgeN` 序号」（样本实测 12 个对象：`<LinkSub value="Pad001" count="2"><Sub value="Edge17"/><Sub value="Edge18"/>…`）。而 faijs 的 `cad.fillet`/`cad.chamfer` 要求 `edges: EdgeTopoRef[]`——沿命名层的设计是「相邻两面的 `{origin, role}` 对」（`topology/naming/types.ts`），**不是序号**。两者之间缺一座桥。

**决策**：新增 `cad.edgeRef(shape, edgeOrdinal)`（`packages/core/src/api/edge-ref.ts`，**同步**查询函数，走 `api/geom.ts` 的 `faceNormal` 同一范式），在内核现场把第 N 条边解析成 `EdgeTopoRef`：

1. `buildEdgeResolutionContext(kernel, shape)` 取现场边表（序号 1 起）；
2. 逐面枚举该面的边、与目标边 `isSame` 者即其邻面（不依赖 `edgeFaceAdjacency` 的过滤后下标对齐）；
3. `findOriginRole(roleTable, faceHashes, faceOrdinal)` 反查每个邻面的 `{origin, role}`；
4. hint 用 `captureEdgeHint`（length/midpoint/axis）。

**序号契约（关键前提）**：`getSubShapes(solid,'edge')` 与 `wireframe()` 同用 `TopExp::MapShapes` + `NCollection_IndexedMap` 枚举（`occt-kernel/topologyExt.ts:620` 已记档），而 `wireframe().edgeGroups[k]` 已实测等于 FreeCAD `Edge(k+1)`（`fcstd/external-geo.test.ts`）。故「faijs 第 N 条边 == FreeCAD `EdgeN`」，序号可直接透传。

**翻译规则**（`feature-translate.ts`）：Fillet → `cad.fillet(base, {edges:[cad.edgeRef(base,N)…], radius})`；Chamfer 按 `ChamferType` 枚举（`FeatureChamfer.cpp:55`：0 "Equal distance"/1 "Two distances"/2 "Distance and Angle"，属性缺失即默认 0）分派 `equal`/`twoDistances`/`distanceAngle`。`Angle` 落盘为**度**（`Chamfer::floatAngle = {0.0, 180.0}`）。降级为显式 baked 的情形：`UseAllEdges=true`、非 `EdgeN` 子元素、缺依赖、尺寸 ≤ 0、Angle 落在 `cad.chamfer` 的 (0,90) 之外。

**IR/代码生成**：`EdgeTopoRef` 必须针对**运行时**的 Base 实体解析（role 对只有运行期命名层知道），无法在翻译期烘焙成字面量。为此给 `CadCall` 增加 `JsExpr` 标记（`jsExpr()`/`isJsExpr()`），`codegen.ts` 的 `renderValue` 对含标记的值逐元素原样输出，其余值仍走 `JSON.stringify`（既有产物字节不变）。

## 备选方案（未采用）

- **改 `EdgeTopoRef` 让 `faces` 可空（纯几何锚点）**：需要在核心类型、`captureTopoRef`、`resolve-edge`、fillet/chamfer 校验四处扩散改动，且把「几何-only 引用」提升为一等公民；本次以不触碰核心引用体系的方式达同一目的。
- **翻译期从 Base 的 `.brp` 计算边几何 hint 并烘焙进 `.fai.js`**：仍需 `faces`（翻译期无法预知运行期 role），且把翻译管线变成 async + 依赖 occt-wasm 内核。
- **让 `cad.fillet`/`cad.chamfer` 直接接受序号参数**：改动 op 的公开参数契约，把序号语义塞进平台 op；改为独立查询函数更可复用（UI 也可用）。
- **沿用几何 hint 兜底（`edgeHintScore`）而不解析 role 对**：`resolve-edge.ts` 的纯 hint 路径只在 `faceEdgeAdjacency` 缺失（mesh）时启用，BREP 现场不适用。

## 验证

- `packages/core/src/fcstd/feature-translate.test.ts`：Fillet/Chamfer 翻译 + 9 类降级分支。
- `packages/core/src/fcstd/codegen.test.ts`：`JsExpr` 渲染为 `cad.edgeRef(part0, 17)` 且不含 `"__jsExpr"`；无标记的数组参数保持字节不变。
- `packages/tests/faijs/edge-ref/edge-ref.test.ts`（真实 OCCT）：20³ 中心盒任一棱 `chamfer(equal, width=1)` 面数 6→7、削去体积 10；`fillet(radius=2)` 削去 `(1−π/4)·r²·L`；两棱倒角面数 8；序号越界与非法序号 → `failedAt.code === 'E_TOPO_NOT_FOUND'`。
- **未验证项**：`EdgeN` 与 faijs 边枚举在**真实 FCStd 翻译产物**上的逐边对应尚未端到端核对（需要跑通完整 FCStd → `.fai.zip` → 执行链路），列为 V6 几何保真的后续核对项。

## 验证与踩坑留档（2026-09-16 补充）

按 AGENTS.md「验证与踩坑留档铁律」，实施过程中的关键验证与 API 坑已固化为三个防回归测试文件（`packages/core/src/fcstd/`，全量 40 测试通过）：

- `api-gotchas.test.ts`：planegcs `difference` 语义反向（param2−param1）、DistanceX/Y 带符号、fflate `zipSync` 字符串值栈溢出（必须 `strToU8`）、求解坐标回读走 `sketch_index.get_primitive` 而非 `get_gcs_params`。
- `format-gotchas.test.ts`：GeoUndef(-2000) 占位符 ≠ 外部几何、`<UID>/<Construction>/<GeoExtensions>` 包装元素、老格式 Pad profile 属性名 `Sketch`、ObjectData 无 type 属性需回查 `<Objects>` 索引。
- `external-geo.test.ts`：wireframe edgeGroups[k] ↔ FreeCAD `Edge(k+1)` 序号契约（IndexedMap 枚举序）、外部边投影到草图局部 z≈0、PointOnObject 求解收敛 L0。**注意**：该文件依赖本地 FreeCAD 样本库（`D:/Faicad/FreeCAD/...`），样本缺失时 `describe.skipIf` 自动跳过，CI 无样本仍绿。
- `packages/tests/faijs/edge-ref/edge-ref.test.ts`：`cad.edgeRef` 序号 → `EdgeTopoRef` → fillet/chamfer 端到端（真实 OCCT，体积/面数数值断言 + 越界报错）。

另有一条**新踩坑**（2026-09-16 M6.1）：命名层解析失败把错误码放在 `TopoRefError.code` 字段、message 只写 prose，故 `.fai.js` 侧断言必须读 `ExecutionResult.failedAt.code`，用 message 正则匹配 `E_TOPO_*` 会失败（`runtime.ts` 的 `directFailedAtOrThrow` 显式把 code 提到 `.code`）。

一次性 dbg/repro 脚本已删除；可复用脚本保留 `scan-fcstd-samples.ts`（M1 全量扫描）与 `validate-sketch-solve.ts`（V2 全样本求解验证）。
