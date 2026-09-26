# Agent Note：brepkit 全局降级——13 个 occt-only op 通过能力路由/静态分派开放

English | [中文](2026-09-26-brepkit-global-degradation.md)

## 问题

clone/intersect 降级到 brepkit 后（2026-09-26），用户要求将同一模式推广到**所有**可降级的 occt-only op：「只要是能够降级使用的，应该全部都要降级使用至至少要支持他呀，有没有历史 withhistory 并不重要。」审计 `arg-spec.ts` 发现 48 处 `engines:['occt']` 声明；排除查询/兼容 op 和 mesh-only op 后，14 个为降级候选。

## 决策

两种可复用降级模式覆盖下方 13 个 op。

### 模式一：clone 模式（能力路由）
适用于实现仅调用 L1 内核方法、无 occt 特有 API 的 op：
- `arg-spec.ts`：`engines:['occt']` → `capabilities:['真实能力名']`
- 通过 `gen-l3-surface.ts` 重新生成 `api/generated/*.ts`
- 适配器 `methods` 仅在真实现存在时声明能力（红线：声明⊆实例，`engine-switch-p3.test.ts` 守卫）
- occt 行为零变化（occt 也有同名能力，能力路由通过后走同一实现）

### 模式二：intersect 模式（静态分派）
适用于有 `*WithHistory` 历史路径、brepkit 只有裸方法的 op：
- 移除 `capabilities` 门控 → 中立 op
- op 实现内按 `engineCapabilitySet(getBackends().config.brepCapabilities).has('xxxWithHistory')` 静态分支：
  - 引擎声明了 `*WithHistory`（occt）→ 历史路径（faceEvolution + roleTable）
  - 否则（brepkit）→ 裸内核方法，**不产 faceEvolution、不传播 roleTable**（如实降级，不伪造恒等映射）
- 无运行时 try-catch 回退（BREP 链静态判定红线）

## 变更（13 个 op 降级）

| op | 模式 | 关键细节 |
|---|---|---|
| ellipsoid | clone | `makeEllipsoid`+`translate`；brepkit bbox Z 查询有精度偏差（体积精确=8π），登记已知缺口 |
| makeBaseBox | clone | `makeRectangle`+`extrude`；适配器补声明两方法（真实现已存在但未接线） |
| rotate | clone + 实现修复 | `rotateBrep` 原硬编码 `getOcctKernel().transform()` → 切到 L1 `getBrepApi().transform()` |
| mirror | clone + 薄 override | `replicate.ts` 手写薄 override 遮蔽生成版；两者同步降级 |
| applyMatrix | clone | `transform`+`generalTransform`；两适配器补声明 |
| healSolid | clone | `healSolid` 已声明 |
| chamfer | intersect | 静态分派：occt→`chamferWithHistory`，brepkit→裸 `kernel.chamfer` |
| convexHull | clone | `hullFromPoints`（→`kernel.convexHull`）；适配器补声明 + 守卫白名单更新 |
| section | clone | `sectionByPlane`+`makeCompound`；移除 `getOcctKernel().IsNull` 耦合；语义差异：occt=edge/wire，brepkit=face |
| drill | clone | `makeCylinder`+`located`+`getBoundingBox`+`cut` |
| pocket | clone | `getSubShapes`+`surfaceCenterOfMass`+`uvBounds`+`surfaceNormal`+`makeFace`+`translate`+`extrude`+`cut` |
| boss | clone | 同 pocket 但 `extrude(+normal)`+`fuse` |
| mirrorJoin | 手写重写 | 原直调 OCCT-only `mirrorWithHistory`；改为 L1 `kernel.mirror`+`kernel.fuse`；roleTable 由质心聚类重建 |

## 不可降级（1 个 op）

- **split**：`splitBrep` 直调 `getOcctKernel().split(h, tools[])` 处理任意 tool 形状。brepkit L1 只有 `splitByPlane`（单平面→2 实体）。保持 `engines:['occt']`，reason 在 arg-spec 中如实登记。

## 备选方案

- **让 14 个候选保持 `engines:['occt']`**——被用户要求否决：「只要是能够降级使用的，应该全部都要降级使用至至少要支持他呀，有没有历史 withhistory 并不重要。」
- **运行时 try-catch 回退到裸内核方法**——否决：BREP 链必须在执行前静态判定（红线）；运行时回退会把坏链藏到执行期才暴露。

## 适配器能力声明补全

brepkit `methods` 新增：`makeRectangle`、`extrude`、`transform`、`generalTransform`、`hullFromPoints`、`sectionByPlane`、`makeCompound`、`located`、`getSubShapes`（均为 `brepkitKernel.ts` 中已存在的真实现，此前未声明）。

occt `methods` 同步补声明：`transform`、`generalTransform`、`sectionByPlane`、`makeCompound`、`located`、`getSubShapes`（此前 `engines:[occt]` 绕过了门控，改为能力路由后必须声明）。

`BrepMethodKind` 联合类型补全新方法名。

## 后果

- 13 个 op 现在在 occt + brepkit 2.129.15/3.4.18/4.0.32 上通过（bbox 在 1% 内或登记为已知几何差异）。
- occt 零回退：所有 op 在 occt 上行为不变（门控从 engines 切到 capabilities，occt 声明了全部所需方法）。
- brepkit 上 chamfer/mirrorJoin/intersect 的输出无面演化（如实降级）；在这些输出上做下游 selection/命名会报 `nameless shape`——与 occt 上 clone 的行为一致。
- 三个 brepkit 版本行为完全一致——所有问题都在 faijs 适配器层，而非 wasm 内核。

## 验证

- `multi-engine-op-parity.test.ts`：180 parity 组合 + 21 error 组合，mismatches=0。
- 新增回归测试：`brepkit-batchA-fix.test.ts`（1 用例/6 op）、`brepkit-batchB-fix.test.ts`（8 用例）、`brepkit-batchC-fix.test.ts`（6 用例）。
- 守卫：`engine-switch-p3`（10）、`arg-spec-capabilities`（5）、`evolution-declaration`（4）全部通过。
- 既有：`brepkitKernel.test.ts`（75）、`brepkit-clone-fix`（2）、`brepkit-intersect-fix`（4）、`brepkit-non-solid-fix`（10）全部通过。
