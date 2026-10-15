# Agent Note：textToSolid 保孔洞——addHolesInFace + makeCompound 组合字形

[English](2026-10-13-text-solid-holes-compound.md) | 中文

Status: implemented

## Problem

`textToSolid`（`packages/core/src/brep/text/text-to-solid.ts`）把每个闭合轮廓独立挤出成体后逐个 fuse：

- **正确性**：带孔字形（`o`、`A`、`O`）由外轮廓 + 内孔轮廓组成；外轮廓体 ∪ 内孔体 = **实心**字形，孔被填实。BREP 路径与 mesh 路径不一致——mesh 路径用 evenodd 语义分类轮廓并保留孔洞。
- **性能**：fuse 次数 = 轮廓数。`Hello` ≈ 8-12 个轮廓 ⇒ 7-11 次 OCCT 布尔融合；node 探针里单条 `cad.text('Hello', 20, 5)` 约 3.5 秒（真机微信小程序 worker 约 10 秒）。

## Decision

重写 `textToSolid` 的装配：

1. 新增 `textBlueprintsDetailed`：返回每个轮廓的 wire **加采样点集**（线段端点、二次/三次曲线按 `CURVE_SAMPLES`=8 采样），供轮廓分类；`textBlueprints` 保持 `BrepHandle[]` 签名（现有调用方/测试不变）。
2. 用共享 `classifyNested`（`primitives/svg/svg-path.ts`，与 svg-to-solid 同一个 evenodd 引擎）分类轮廓：外轮廓 + 其孔。
3. 每组：`makeFace(outer)` → `addHolesInFace(face, holes)` → `extrude` ⇒ 空心体（孔正确）。
4. 组间用 `makeCompound` 组合——字形水平排布互不重叠，compound 语义正确且零布尔成本（单组时原样返回 solid）。

## Consequences

- `Hello` 探针：**3561 ms → 97 ms**（约 36 倍）；`你好`（降级为 `??`）：**1504 ms → 44 ms**。真机 10 秒级延迟降至亚秒。
- `o`/`A`/`O` 空心（体积 = (外轮廓面积 − 孔面积) × depth，测试钉住）；`Hello` 返回 5 个 solid 的 COMPOUND；`i` 是 2 成员的 COMPOUND（点 + 杆），与 mesh 路径一致。
- `svgToSolid` 仍逐个 fuse 其 solid（同类慢问题）；本次不在范围——留给后续清理。
- 新公开导出 `textBlueprintsDetailed` 已被测试引用（API 覆盖门禁满足）。

## Verification

- `packages/core/test/brep/text/text-to-solid.test.ts`：14 个测试全绿——`o`/`A`/`O` 空心体积、`Hello`(5)/`i`(2) 的 COMPOUND 成员数、`AB` 兼容、既有 y-flip/STEP/有效性用例。
- `packages/faijs-extra/test` + core svg/text 套件：150 通过，1 个预存失败在 `entry-boundary.test.ts`（「does reach the three/examples SVG loader」）——faijs-extra 源码已无任何 `three/examples` import；与本次改动无关。
- faijs 根 `tsc --noEmit` 绿；家族版本 0.33.2 → 0.33.3（`set-version`、`check-lockstep` OK），`npm run pack` 8/8 tgz；3d_editor `update-faijs` 校验 OK，weapp worker 重建（1362.8 KB raw / 362.5 KB br），探针 exit 0，audit/check:free/test:sim 全绿。

## Follow-up（2026-10-13 下午）：brepkit compound 变换修复（真机只剩单字符回归）

用户实测真机：`Hello` 建模后只剩最后一个 `o`，换词消失的字母各不相同。用户点破根因排查方向：「faijs 测试用的是 occt？你应该在 faijs 侧也测试 brepkit2 引擎呀」——回归只在 occt 上全绿，真机/weapp worker 实际跑 **brepkit2** 内核。

### 复现（brepkit 单测，转正式防回归）

新增 `packages/core/test/brep/text/text-brepkit-repro.test.ts`（`describe.skipIf(!brepkitAvailable)`，基建同 `brepkitKernel.test.ts`；`setupTestFont()` 引擎无关可复用）。textBrep 同款链路 `textToSolid('Hello') → getBoundingBox → translate 居中 → getSubShapes + meshShape`：

- `[repro] raw members = 5`（makeCompound 正确）→ `[repro] after translate members = 1`（translate 后成员丢失，复现）。

### 根因（两层）

1. **直接原因**：brepkit 适配器 `translate/transform/scale/located/locate` 族走 `cloneAndTransform(shape, matrix, kindOf(shape))` → `cloneShape` → `copySolid(compound)` + `transformSolid(...)`——brepkit 的 copySolid/transformSolid **只吃 solid 句柄**，compound 被当作单一 solid 处理，成员静默丢失（只剩 1 个）。
2. **更深一层**：brepkit 句柄按**类型分命名空间**（文件内 356 行 GOTCHA），compound 命名空间与 solid 命名空间**重号**——实测成员 `[0..4]` 的 compound 内核句柄 = 0，与成员 solid 0 同号。`knownCompounds` 若以**内核句柄**为 key，查询同号的另一 solid 时会把 solid 误判成 compound（反过来，`translate(compound)` 时 `copySolid(0)` 复制的其实是成员 solid 0）。3MF/importStep 多实体同样存在该歧义，只是此前查询路径侥幸未触发。

### 修复（结构性，非打补丁）

`brepkitKernel.ts`：

1. 新增 `compoundOf(kids)` 助手（makeCompound 适配器与 cloneAndTransform 的 compound 分支共用一份分发）：**一律返回虚拟句柄**（`0x20000000+`，避开类型标签 bit26..28 与内核形状句柄空间）；全 solid 成员才调 `kernel.makeCompound`，真内核句柄登记进 `kernelCompoundHandles`（虚拟→真映射，仅 exportStep 等 IO 使用）；face/wire/edge 混合成员不触达内核。
2. `cloneAndTransform` 增加 compound 分支：`knownCompounds.get(shape)` 命中时**逐成员**深拷贝 + 仿射变换，再 `compoundOf` 重组（子成员类型靠 knownFaces/knownWires 集合兜底分发，故递归传默认 kind）。
3. `exportStep` 对虚拟 compound 映射回真内核句柄（内核不认虚拟句柄）。
4. `importStep` 多实体改走 `compoundOf`（同一重号歧义，一并收敛）。

### 验证

- brepkit 复现测试：`'Hello'` translate 后 5 成员 ✓、`'o'` 空心体积判据 ✓（2/2）；occt 14 用例不受影响（16/16 全绿）。
- brepkit 全量回归：106 通过 / 4 失败——**4 个失败（drill 盲孔 isValid、fillet isValid、importStl 两例）经 `git checkout` HEAD 版本复跑**确认**同样失败（pre-existing）**，与本次改动无关；恢复改动后 106 通过一致。
- faijs 根 `tsc --noEmit` 绿；家族版本 0.33.3 → 0.33.4（`set-version`、`check-lockstep` OK），`npm run pack` 8/8 tgz；3d_editor `update-faijs`（4 包 stale → `--fix-stale`）verify OK，weapp worker 重建（1362.9 KB raw / 362.5 KB br）。
- 探针新增 Hello mesh 完整性检查（X 包围盒判据，旧 bug 只剩单字符宽）：**triangles=8584、xwidth=45.1mm**（5 字符完整）；text 英文 633ms / 中文 973ms（亚秒级）。
- 3d_editor `npx vitest run packages/weapp/src packages/platform/src`：65 文件 976 测试全绿；audit（主包 1.55MB / 分包 1.01MB）、check:free、test:sim 全绿。

### 遗留

- faijs 预存失败 `entry-boundary.test.ts`（three/examples 断言过时）仍红，与本次无关（pack 重建 dist 后仍红可证）。
- brepkit 全量 4 个 pre-existing 失败（drill/fillet/importStl isValid 判据）未在本任务范围处理，需另行排查。

## Alternatives considered

- **保持逐个 fuse 轮廓**：拒绝——正确性问题（fuse 填实孔洞）加性能问题（每次 text 调用 7-11 次 OCCT 布尔，「Hello」约 3.5 秒）。
- **用 svgToSolid 的 evenodd 方案**：拒绝——svgToSolid 仍逐个 fuse solid（同类慢问题）；分类→挤出→compound 的方案对字形互不重叠的 text 场景严格更优。
- **只修 occt 路径、推迟 brepkit**：拒绝——真机（微信小程序 worker）跑 brepkit，只修 occt 会让生产路径保持损坏。
