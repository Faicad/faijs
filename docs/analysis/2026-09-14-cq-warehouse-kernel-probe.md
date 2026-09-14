# fai_cq_warehouse 内核能力探测报告（W2 probe）

- 日期：2026-09-14
- 范围：`packages/fai_cq_warehouse` 的 `WarehouseKernel` 声明成员 + §6 退化路径前提
- 结论载体：`src/kernel-conformance.test.ts`（20 用例全绿，CI 可持续回归）
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
   Z 轴旋转是退化输入（probe 首版即踩此坑，已固化为测试用例注释）。

## 对 WarehouseKernel 声明的约束

新增成员必须先加进 `kernel-conformance.test.ts` 的 `PROBED` 清单并配 smoke 用例，
否则 CI 内核契约门禁（方案 §10）不校验它。当前清单：`makeHelixWire`、
`approximatePoints`、`bsplineSurface`、`sew`、`makeSolid`、`revolve`、`thicken`、
`makeNonPlanarFace`、`getSurfaceArea`、`loft`。
