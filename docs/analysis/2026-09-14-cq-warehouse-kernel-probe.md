# fai_cq_warehouse 内核能力探测报告（W2 probe）

- 日期：2026-09-14
- 范围：`packages/fai_cq_warehouse` 的 `WarehouseKernel` 声明成员 + §6 退化路径前提
- 结论载体：`src/kernel-conformance.test.ts`（正向契约：成员在不在、签名对不对）+ `src/kernel-pitfalls.test.ts`（反向认知：行为是否反直觉）+ `src/primitives.test.ts`（封装契约）；原始数字复现台 `scripts/kernel-pitfalls-probe.ts`（`npm -w @faicad/fai-cq-warehouse run probe:pitfalls`）
- 下游影响：W3（thread）路线裁决、W4/W6 构造路径

## 探测方法

两级断言（方案 §5.5.2 第 ③ 层）：

1. **存在性**：`typeof Reflect.get(k, name) === 'function'`——名字拼错/内核升级改名立即红。
2. **契约 smoke**：每个方法真调一次，验返回形态（句柄非空、bbox 数值、volume/area 闭式值比对）。

内核来源：host 注入（`configureBackends({ kernel: { brep: initOcctWasm() } })`），见 `src/test-setup.ts`。

## 逐项结论

| 内核成员 | 结论 | smoke 证据 |
|---|---|---|
| `makeHelixWire` | ✅ 可用 | 螺旋线 bbox：直径 2r、高 = height，闭式核对 |
| `approximatePoints` | ✅ 可用 | 点列 → 曲线句柄非空、bbox 数值 |
| `bsplineSurface` | ✅ 可用 | 3×3 点阵 → 面面积 > 0 |
| `sew` / `makeSolid` | ✅ 可用（形态验证） | 面 → shell 链路签名正确 |
| `revolve` | ✅ 可用，**语义与 cq 不同（见下）** | 环体体积 = 2π²·R·r² 闭式核对 |
| `thicken` | ✅ 可用 | 4×2 面 +1 厚 → 体积 8 |
| `makeNonPlanarFace` | ✅ 可用 | 三角 wire → face 句柄 |
| `getSurfaceArea` / `getBoundingBox` / `getVolume` | ✅ 可用 | 矩形面 = 8 |
| `loft(wires, isSolid, ruled)` | ✅ 可用 | ruled=true 直壁体 = 4×2×1 |

## 关键发现（影响后续周目）

1. **`revolve(wire)` 内核直接闭合成实体**——与 cq「wire 旋转得旋转面」语义不同，
   体积即实体体积（环体 2π²·R·r² 实测吻合）。`primitives.ts` 的 `revolveProfile`
   据此直接吃 wire，不再先 `makeFace`。
2. **`loft` 存在且 ruled=true 可用**——按方案 §6，`makeRuledSurface` 若缺失，
   thread `simple=False` 走 `loft(ruled)` 退化路径成立；W3 可按「先 simple=True
   全绿、再攻 simple=False」推进，不存在"判不可做"的风险。
3. **轮廓平面约束**：revolve 轮廓必须在含轴平面（如 XZ）——XY 圆盘绕过圆心的
   Z 轴旋转是退化输入（probe 首版即踩此坑，已固化为测试用例注释）。实测该退化输入
   体积 = 0（`kernel-pitfalls.test.ts` 陷阱 5）。
4. **`makeWire` 逐边语义**：喂边**乱序**时「接不上当前开口端」的边被**静默丢弃且不抛错**
   （正方形 4 边顺序喂 → 4；`[A,C,B,D]` → 3）。与 cq-compat phase2 记录的「4→3」同源
   （那边用 `reorderForWireAssembly` 兜住）。注意触发条件是「接不上开口端」，**不是**
   「一律丢」——完全悬空的边反而被保留（`kernel-pitfalls.test.ts` 陷阱 1）。
5. **sew 闭壳 `makeSolid` 朝向不可保证**：6 张平面 face 缝成单壳后 makeSolid 实测体积
   **−8**（朝内），必须 `reverseShape` 翻正（`kernel-pitfalls.test.ts` 陷阱 2）。
6. **`getVolume`(GProps) 对螺旋 B 样条面求积混叠**：occt-wasm 侧 raw/raw 实测
   GProps 49.961599 vs 三角化 43.680666（差 14.379%），与 A 侧 Python/OCCT 同源；
   端部为平面（square）则不混叠（差 0.013%）→ 体积真值以三角化为准
   （`kernel-pitfalls.test.ts` 陷阱 3）。
7. **近重合 B 样条体 `cut` 单向失败**：整体平移 1e-5 后 `a−b` = 44.48 而 `b−a` = 0
   （几何上两者都应为 ~0）——布尔差**不对称**（`kernel-pitfalls.test.ts` 陷阱 4）。
8. **零长边在 `makeLineEdge` 就抛错**：闭合点列的退化末边抛 `construction failed`
   （非 makeFace 的 `No geometry`）——`closeLoop` 去重的理由（陷阱 6）。

## 订正（旧注释未复现，已在代码/文档中改为实测结论）

- **「sew 在 1e-6 下完全不缝合（shells=0）」未复现**：平面壳与线程实体面集实测在
  `1e-6..1e-2` 均缝成单壳、`makeSolid` 可消费。故 `solidFromFaces` 默认 1e-3 的理由
  改为「与上游 `make_shell` 对齐 + 给 B 样条端帽留余量」，不再引用该旧说法。
  证据：`kernel-pitfalls.test.ts` 陷阱 2/7。
- **`closeLoop` 的报错点订正**：旧注释写「makeFace 报 `BRepAdaptor_Curve::No geometry`」，
  实测抛错在其上游的 `makeLineEdge`（`construction failed`）。

## 对 WarehouseKernel 声明的约束

新增成员必须先加进 `kernel-conformance.test.ts` 的 `PROBED` 清单并配 smoke 用例，
否则 CI 内核契约门禁（方案 §10）不校验它。当前清单：`makeHelixWire`、
`approximatePoints`、`bsplineSurface`、`sew`、`makeSolid`、`revolve`、`thicken`、
`makeNonPlanarFace`、`getSurfaceArea`、`loft`、`reverseShape`、`tessellate`。

若某成员的行为**反直觉**（返回值/朝向/容差与直觉不符），除 smoke 用例（正向契约）外，
还须在 `kernel-pitfalls.test.ts` 补一条「错误认知 → 实测真相」守卫——只写注释不算数，
注释会被后人当噪音删掉。原始数字统一进 `scripts/kernel-pitfalls-probe.ts` 以便复跑重采样。
