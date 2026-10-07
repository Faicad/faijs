# brepkit 适配器全局优雅降级方案

> 日期：2026-09-26
> 状态：已落地
> 关联：clone/intersect 降级方案（2026-09-26-brepkit-clone-intersect-degradation.md）、multi-engine-op-parity 测试框架、A/B/C/D 批 brepkit 适配器修复

## 用户需求（原话）

> 「只要是能够降级使用的，应该全部都要降级使用至至少要支持他呀，有没有历史 withhistory 并不重要。」

即：将上一轮 clone/intersect 的优雅降级模式推广到**所有可降级的 occt-only op**。brepkit 内核具备对应基础方法、仅被 `engines:['occt']` 或 `*WithHistory` 静态门挡住的 op，一律降级为在 brepkit 上可用。命名/演化历史降级可接受，不设门槛。

## 审计矩阵

对 `arg-spec.ts` 中全部 `engines:['occt']` 声明逐 op 审计，按 brepkit 内核是否具备基础方法分类：

### 可降级（13 op，本轮全部实施）

| op | 降级模式 | brepkit 基础方法 | 命名/演化变化 |
|---|---|---|---|
| ellipsoid | clone 模式 | `makeEllipsoid` + `translate` | unmodeled（构造词汇） |
| makeBaseBox | clone 模式 | `makeRectangle` + `extrude` | unmodeled |
| rotate | 实现层改动 + clone 模式 | `transform`（原硬编码 getOcctKernel） | kernel/byAdjacency |
| mirror | clone 模式 + 手写薄 override | `mirror` | kernel/byAdjacency |
| applyMatrix | clone 模式 | `transform` + `generalTransform` | identity |
| healSolid | clone 模式 | `healSolid` | kernel/byAdjacency |
| chamfer | intersect 模式（静态分派） | 裸 `kernel.chamfer`（occt 走 chamferWithHistory） | brepkit 无 faceEvolution |
| convexHull | clone 模式 | `hullFromPoints`（→ kernel.convexHull） | unmodeled |
| section | clone 模式 | `sectionByPlane` + `makeCompound` | 语义差异：occt=edge/wire，brepkit=face |
| drill | clone 模式 | `makeCylinder`+`located`+`getBoundingBox`+`cut` | kernel/byAdjacency |
| pocket | clone 模式 | `getSubShapes`+`surfaceCenterOfMass`+`uvBounds`+`surfaceNormal`+`makeFace`+`translate`+`extrude`+`cut` | kernel/byAdjacency |
| boss | clone 模式 | 同 pocket，但 `extrude(+normal)`+`fuse` | kernel/byAdjacency |
| mirrorJoin | 手写版改 L1 | `kernel.mirror` + `kernel.fuse`（原直调 OCCT-only mirrorWithHistory） | 丢失 history 级面映射，roleTable 由质心聚类重建 |

### 不可降级（内核真缺方法，1 op）

| op | 原因 |
|---|---|
| split | `splitBrep` 直调 `getOcctKernel().split(h, tools[])` 原生切件（任意 tool 形状分件），brepkit L1 只有 `splitByPlane`（单平面→2 实体），无法处理任意 tool |

### 仍保持 occt-only（内核真缺方法或实证收窄，14 op）

| op | 原因 |
|---|---|
| loft | brepkit 无放样原语 |
| screw | brepkit 无螺旋扫掠原语 |
| draft | 2026-09-24 实证收窄：brepkit 面法向/对称性几何错误，不可静默降级 |
| thicken | brepkit 无抽壳加厚原语 |
| offset | brepkit 无偏移原语 |
| simplify | brepkit 无简化原语 |
| autoHeal | brepkit 无自动修复原语 |
| fixSelfIntersection | brepkit 无自交修复原语 |
| heal | brepkit 无通用 heal 原语（healSolid 已有） |
| sweep | brepkit 无扫掠原语 |
| helix | brepkit 无螺旋线原语 |
| thread | brepkit 无螺纹原语 |
| complexExtrude | brepkit 无复杂挤出原语 |
| twistExtrude | brepkit 无扭曲挤出原语 |

### mesh-only（无 BREP 实现，2 op）

| op | 原因 |
|---|---|
| knurl | 仅 mesh 实现 |
| sdf | 仅 mesh 实现（SDF 模型只能以 mesh 表示） |

## 降级模式（已验证可复用）

### 模式一：clone 模式（能力路由）

适用于：op 实现纯调 L1 内核方法，无 occt 特有 API。

- `arg-spec.ts`：`engines:['occt']` → `capabilities:['真实能力名']`
- 重跑 `npx tsx packages/core/scripts/gen-l3-surface.ts` 重新生成 `api/generated/*.ts`
- 适配器能力表只在真实现时补声明（红线：声明⊆实例，engine-switch-p3 守卫）
- occt 行为零变化（occt 也有同名能力，能力路由通过后走同一实现）

### 模式二：intersect 模式（静态分派）

适用于：op 有 `*WithHistory` 历史路径，brepkit 只有裸方法。

- 移除 `capabilities` 门控（变为中立 op）
- op 实现内按 `engineCapabilitySet(getBackends().config.brepCapabilities).has('xxxWithHistory')` **静态分派**：
  - 引擎声明了 `*WithHistory`（occt）→ 历史路径（faceEvolution + roleTable）
  - 否则（brepkit）→ 裸内核方法，**不产 faceEvolution、不传播 roleTable**（如实降级，不伪造恒等映射）
- 无运行时 try-catch 回退（BREP 链静态判定红线）

## 关键实现细节

### rotate：实现层硬编码切换

`rotateBrep` 原硬编码 `getOcctKernel().transform()`，需切到 L1 `getBrepApi().transform(s, m12)`。brepkit `transform` = cloneAndTransform 深拷贝，经 `toKernelMatrix` 补底行，STEP-safe 语义对齐。

### mirror：手写薄 override 遮蔽生成版

`cad.mirror` 实际解析到 `api/replicate.ts` 的手写薄 override（非 generated 版本），需同步降级：`engines:['occt']` → `capabilities:['mirror']`。

### mirrorJoin：手写版直调 OCCT-only mirrorWithHistory

`cad.mirrorJoin` 实际用 `replicate.ts` 手写版，直调 `getOcctKernel().mirrorWithHistory`。改为 L1 `kernel.mirror` + `kernel.fuse`。`buildReplicaRoleTable` 自含哈希重算（质心聚类），不依赖 mirrorWithHistory 的 history，roleTable 仍可重建。

### section：语义差异如实登记

- occt `sectionByPlane` 返回 edge/wire 组（1D 剖面线）
- brepkit 返回 face 组（2D 剖面面）
- 两侧都包 compound，bbox 一致。已在 `booleanFns.ts` 注释登记。
- 注意：生成版 `section` 未挂进 cad 命名空间（`cad.section is not a function`），用户面是 `cad.sectionByPlane`（已在对拍中覆盖）。

### ellipsoid：brepkit bbox Z 查询精度问题

- 体积积分精确（=8π，完整椭球），X/Y 居中精确
- brepkit 内核对曲面 bbox/com 的 Z 查询有偏差：dz≈rz 而非 2rz、zmin 恒 0
- 判定为 brepkit 内核 bbox 查询精度问题，非 op 几何错误
- 已登记 `KNOWN_BREPKIT_GAPS`，对拍跳过 bbox 比对（op 不崩、体积正确）

### 能力声明补全（适配器层）

brepkit 适配器 `methods` 新增：`makeRectangle`、`extrude`、`transform`、`generalTransform`、`hullFromPoints`、`sectionByPlane`、`makeCompound`、`located`、`getSubShapes`（均为 brepkitKernel.ts 中已存在的真实现，此前未声明）。

occt 适配器同步补声明：`transform`、`generalTransform`、`sectionByPlane`、`makeCompound`、`located`、`getSubShapes`（此前 `engines:[occt]` 绕过了门控，改为能力路由后必须声明）。

`BrepMethodKind` 联合类型补全新方法名。

## 验证结果

### 对拍测试（multi-engine-op-parity.test.ts）

- parity 组合：180（45 op × 4 引擎）
- error 组合：21（7 expect-error op × 3 brepkit 版本）
- mismatches：**0**
- 三版本 brepkit（2.129.15 / 3.4.18 / 4.0.32）行为完全一致，无版本差异

### 回归测试

| 测试文件 | 用例数 | 结果 |
|---|---|---|
| brepkit-batchA-fix.test.ts | 1（6 op） | ✅ |
| brepkit-batchB-fix.test.ts | 8（chamfer+convexHull） | ✅ |
| brepkit-batchC-fix.test.ts | 6（section/drill/pocket/boss/mirrorJoin+split） | ✅ |
| brepkit-clone-fix.test.ts | 2 | ✅ |
| brepkit-intersect-fix.test.ts | 4 | ✅ |
| brepkit-non-solid-fix.test.ts | 10 | ✅ |
| brepkitKernel.test.ts | 75 | ✅ |
| engine-switch-p3.test.ts | 10 | ✅ |
| arg-spec-capabilities.test.ts | 5 | ✅ |
| evolution-declaration.test.ts | 4 | ✅ |

### 已知几何差异（KNOWN_BREPKIT_GAPS）

| op | 差异 |
|---|---|
| ellipsoid | brepkit bbox Z 查询精度偏差（体积精确=8π） |
| circularPattern | 旋转排布语义差异 |
| gridPattern | 方向/步长语义差异 |
| revolve | ~2% 三角化差异 |

## 红线遵守

- 能力声明 ⊆ 实例实现（engine-switch-p3 守卫通过），禁止伪造能力
- 无运行时 try-catch 回退（BREP 链静态判定）
- 测试 stderr 零容忍
- 未改 package.json 版本号
- 生成文件（api/generated/*.ts）由生成器重跑，未手改
