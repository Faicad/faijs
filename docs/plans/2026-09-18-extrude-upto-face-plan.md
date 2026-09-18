# Extrude UpToFace/UpToLast 支持方案（打通 Pad up-to 链路，V6 翻绿）

> 日期：2026-09-18
> 状态：方案（未实施）
> 前置：M9 已落地 `Length`/`TwoLengths`（`feature-translate.ts`），UpToFace/UpToLast 显式烘焙（reason `pad-type-*-unsupported`）

## 1. 用户原始要求（原文引用）

> 但是都是基于occt的，同源的几何内核，而且拉伸不是很常见的吗。为什么faijs不支持后两个参数？难道不能够让faijs支持吗？应该支持啊
>
> 先写方案，把这个链路打通

拆解为三条约束：

| 编号 | 约束 |
|---|---|
| C1 | `cad.extrude` 支持「拉伸到面」（UpToFace）与「拉伸到实体最后一面」（UpToLast） |
| C2 | FCStd 转换器把 `Type=UpToFace/UpToLast` 的 Pad 真正翻译成代码，替换显式烘焙分支 |
| C3 | 验收：PadTest 样本 V6（`verify-geometry.ts`）relErr < 1% 翻绿 |

## 2. 现状盘点（2026-09-18 实测）

### 2.1 内核能力（occt-wasm `dist/index.d.ts`）

- **无 `BRepFeat_MakePrism`**（FreeCAD 实现 up-to 用的是它，WASM 包未暴露）。
- **有等价组合件**：`extrude(shape, dx,dy,dz)`（定长）、`makeBox / makeBoxFromCorners`、`fuse / cut / common`。
- 结论：up-to 语义用「**长拉伸 → 与目标面侧半空间体求交**」组合实现（§4.2），无需动 WASM。

### 2.2 API 面

- `cad.edgeRef`（`api/edge-ref.ts`，M6.1）已落地 `TopoRef` 模式：ordinal → 内核拓扑句柄，BREP-only。`cad.faceRef` 完全对标它。
- `cad.extrude` 是 `compatOp(projectBrepOp(...))`（brep-only，`api/generated/operations.ts:152`），加参数不涉及 mesh 路径（D-A 纪律无冲突）。

### 2.3 转换器与样本

- `feature-translate.ts:399-403`：`ftype !== 'Length' && !== 'TwoLengths'` → bake。Pocket 同构分支也有 UpToFace/UpToFirst。
- PadTest 实测三种形态齐备：

| 对象 | Type | UpToFace 属性 | 语义 |
|---|---|---|---|
| Pad | 0 (Length) | 空 | 已支持 |
| Pad001 | 3 (UpToFace) | `LinkSub obj="DatumPlane" sub="Plane"` | 拉到基准面 |
| Pad002 | 1 (UpToLast) | 空 | 拉到支持体最后一面 |

- 样本集口径：UpToFace/UpToLast/UpToFirst 主要集中在 PartDesignTests/CAM 测试样本，此前全部烘焙。

## 3. 方案总览

分三步：**A. faceRef 锚点** → **B. extrude up-to 模式（内核）** → **C. 转换器接线 + 验收**。依赖严格单向：A→B→C。

## 4. 设计

### 4.1 A：`cad.faceRef(of, faceOrdinal)` —— `api/face-ref.ts`（新）

- 完全对标 `edge-ref.ts`：`FaceTopoRef` 类型、ordinal ≥ 1 校验、`E_TOPO_NOT_FOUND` 错误码、BREP-only 守卫。
- 序数语义与 `edgeRef` 一致：按内核 shape 的 face 枚举顺序（1-based），`getFaces` 查询面。

### 4.2 B：`cad.extrude` 增加 `upTo` 参数 —— 内核 + op 面

参数形态（具名参数新增一项，向后兼容）：

```js
cad.extrude(sketch, { length: 10 })                 // 现有：不变
cad.extrude(sketch, { upTo: cad.faceRef(p0, 3) })   // 新：拉伸到 p0 的第 3 面
cad.extrude(sketch, { upTo: 'last' })               // 新：拉伸到沿线方向遇到的最后一个面（UpToLast）
```

内核实现（`cad` 命名空间 `extrude` 的 brep 实现，新增分支）：

1. **方向向量**：沿用现有 extrude 的轮廓法向 + `Reversed` 符号逻辑。
2. **长试探**：先按「包围盒对角线 × 2」做安全上限 `L`，生成长拉伸体 `P = extrude(profile, dir·L)`。`L` 只是求交的构造辅助，**不进入结果几何**，不属于 bbox 猜长度（M9.4 禁猜的是把 `L` 当终止长度静默输出；这里结果由布尔决定，`L` 过大只影响性能）。
3. **UpToFace（面引用）**：取 `upTo` 面的支撑平面/曲面。对平面：构造覆盖该面另一侧的**半空间盒** `H = makeBoxFromCorners(...)`（由面法向与面包围盒外扩生成），结果 = `common(P, H)`。对非平面（样本集实测暂为 0 个）：显式 `err(E_UP_TO_NON_PLANAR)`，不做近似。
4. **UpToLast（'last'）**：FreeCAD 语义 = 沿方向与支持体（BaseFeature 实体）求交取最后一个穿越点。内核侧实现：`P` 与支持体（`baseFeature` 参数，可选传入；缺省用当前脚本里可判定的支持体——实现时以**显式传参**为准）做 `common`，取交体的**远端端面**为截断面，再 `common(P, 远端侧半空间盒)`。
5. **Offset 参数**：FCStd `Offset` 属性（默认 0）按截断面法向偏移半空间盒；非 0 值先支持平面情形。

错误码：`E_UP_TO_NON_PLANAR`（非平面目标面）、`E_UP_TO_NO_INTERSECTION`（方向上不相交）。

### 4.3 C：转换器接线 —— `feature-translate.ts`

1. Pad 分支：`ftype === 'UpToFace'` → 读 `UpToFace` LinkSub：
   - 目标是 **DatumPlane/基准面**（PadTest 形态）：基准面是无限平面，等价于「到该平面的定长拉伸」——转换器直接按平面方程算 `Length = 面距轮廓平面的有向距离`，产 `cad.extrude({ length })`，并在 mapping 记 `reason: 'uptoface-via-datum-plane-distance'`（语义保真，零烘焙）。此路径**无需 faceRef**，最省。
   - 目标是**实体的面**：产 `cad.extrude(profile, { upTo: cad.faceRef(targetVar, n) })`，面序号由该目标对象的 `.brp` 资产经内核 face 枚举标定（探针实测，落测试）。
2. `ftype === 'UpToLast'` → `cad.extrude(profile, { upTo: 'last', baseFeature: baseVar })`。
3. `ftype === 'UpToFirst'` → 交体的**近端**面截断（与 last 对称），同一批实现。
4. Pocket 的 UpToFace/UpToFirst 同批接线（凹切方向相反，半空间盒取另一侧）。
5. 烘焙分支保留为兜底（如 `E_UP_TO_NO_INTERSECTION` 转换期预检不通过 → bake + reason），**转换期预检失败必须显式记 reason，禁止静默**。

### 4.4 兼容与纪律

- `cad.extrude` 新参数向后兼容（旧调用零改动）；`api.d.ts` 为生成文件，改 schema 后必须重跑 `gen-api-dts.ts`。
- 产物仍 brep-only（D-A）；无 mesh 实现属预期，`E_MESH_UNSUPPORTED` 语义不变。
- 每步先写失败测试再改代码（实施纪律）；GOTCHA 留档（如 LinkSub 空值、面序数标定）。

## 5. 分阶段计划

| 阶段 | 内容 | 完成定义（DoD） |
|---|---|---|
| A | `cad.faceRef` + `getFaces` 序数标定探针 | 单测：faceRef→fillet/extrude 引用同一面；探针脚本留档 |
| B | 内核 up-to 组合实现 + `extrude` 参数面 | 单测：平面 UpToFace/UpToLast/UpToFirst/Offset 四用例；非平面显式报错用例 |
| C1 | 转换器：UpToFace→基准面距离路径（PadTest Pad001） | PadTest 转换产物含该 Pad 的 extrude 语句，check 零错误 |
| C2 | 转换器：实体面引用路径 + UpToLast/UpToFirst + Pocket 同批 | 白名单样本 UpTo 类 zero-bake；e2e golden 基线更新 |
| D | V6 验收 | `verify-geometry.ts` PadTest relErr < 1% + bboxDiag delta < 0.5（V6 门槛）；fcstd 单测全绿；e2e 全绿 |

验证命令（复现）：

```powershell
npx tsx packages/core/scripts/fcstd-to-fai-zip.ts D:/Faicad/FreeCAD/data/tests/PadTest.fcstd out-padtest.fai.zip
# 解出 model/main.fai.js 后：
npx tsx packages/core/scripts/faijs-cli.ts run out-padtest-main.fai.js --mode brep --out out-padtest.step
npx tsx packages/core/scripts/verify-geometry.ts D:/Faicad/FreeCAD/data/tests/PadTest.fcstd out-padtest.step
```

## 6. 风险登记

| 编号 | 风险 | 对策 |
|---|---|---|
| R-A | 面序数（faceOrdinal）在 .brp 资产序与运行时 shape 序之间不一致 | 阶段 C2 用内核对同一 .brp 枚举标定，测试钉住；禁止跨内核假设 |
| R-B | 半空间盒构造退化（面法向非轴对齐） | makeBoxFromCorners 由面包围盒 + 法向外扩构造，不依赖轴对齐；单测含斜面用例 |
| R-C | UpToLast 的 baseFeature 判定歧义 | 显式传参（转换器已知 Body 内 BaseFeature 链），不做隐式推断 |
| R-D | 白名单外的 Pocket Type 变体（ThroughAll 已烘焙） | 本方案不动 ThroughAll 口径 |
| R-E | 基准面距离路径与 faceRef 路径语义重叠 | 优先基准面距离路径（更稳），实体面路径仅在其不可用时启用 |

## 7. 待定项（需用户拍板）

1. 阶段顺序按 A→B→C1→C2→D 串行执行是否可以（建议：可以，C1 先独立翻掉 PadTest 的 Pad001）。
2. `upTo: 'last'` 的字符串字面量形态 vs `upToLast: true` 布尔形态——方案倾向字符串字面量（与 faceRef 同参数位，语义集中）。
