# Agent Note：外部 `VertexN` 链接与按源序编号的外部 geoId

Status: implemented

[English](2026-09-28-external-vertex-links.md) | 中文

## 问题

同一通道上的两个缺陷——把草图的 `ExternalGeometry` 链接投影成求解器可用的固定外部几何。

**1. 只解析了 `Edge<N>` 链接。** `resolveExternalGeometry`
（`packages/fcstd/src/external-geo.ts`）匹配 `sub.startsWith('Edge')`，
其余一律判为 `unsupported sub-element`。FreeCAD 还会链接外部**顶点**：
`door-keeper.FCStd` Sketch002 → `Sketch001.Vertex1`、
`CrankShaft.FCStd` Sketch003 → `Pad002.Vertex12`、
`Fountain.FCStd` Sketch007 → `Revolution005.Vertex19`。只要有一条这样的链接，
整张草图就以 `L2 / external-geometry-unresolved` 失败，并向下游级联成
`pad-missing-profile` / `groove-profile-baked-upstream` / `fillet-missing-base`。
前 904 个语料文件里有 16 个带这一类。

**2. 求解器 geoId 由过滤后下标推导。** `convert.ts` 在*解析成功*的子集上算
`geoId: -3 - i`（`usable.map((l, i) => …)`）。FreeCAD 的槽位由 SOURCE 链接表
固定为 `-3 - linkIndex`，且前序链接解析失败时该槽位依然保留，于是任何失败都会
让后续链接整体前移一格。前移后的引用指向不存在的外部 geoId，后端的
`unresolvableExternal` 检查就把这些约束丢掉——**静默**丢弃，任何地方都没有失败记录。

两者都是「几何静默错误」而非崩溃：草图仍然「求解成功」，只是不是 FreeCAD 的几何。

## 决策

`VertexN` 与 `EdgeN` 走同一条解析路径，并把 SOURCE 链接下标一路带到调用方，
而不是在过滤后的位置上重算。

- `ExternalLink` 新增 `linkIndex`——文档写明它是该链接在草图 `ExternalGeometry`
  表中的下标，`-3 - linkIndex` 必须用它。
- `VertexN` 用 `getSubShapes(shape, 'vertex')[ord - 1]` + `vertexPosition` 读取，
  投影成**单点**折线。序号从 1 起，与已验证过的 `Edge13 → edgeGroups[12]` 约定一致。
- `convert.ts` 接受 `polyline.length >= 1`（顶点同样是可用的固定目标），
  并映射 `geoId: -3 - l.linkIndex`。

后端只改一处：`pt()` 原先仅通过 `externalLines`（2 点边）解析外部引用。而图元循环
本来就把每个采样点钉成 `P(geoId, i + 1)`——这正是 `{geoId, pos}` 引用所指向的
对象——所以修法是改查「每个 geoId 的点数」而不是线表。一条规则同时覆盖 2 点边、
`VertexN` 单点与多点采样。

源 `.brp` 存的是**文档坐标系**下的形状坐标，不是源对象局部坐标，因此草图自身的
逆 Placement 就是全部变换。实测验证（`door-keeper.FCStd`）：`Sketch001` 的
Placement 为 `(0, 110, 0)`，其 `.brp` 顶点就在 `y = 110`。再复合源对象的
Placement 是错的。

## 后果

- 该类已消除，且修复自带验证：只有重解能复现 FreeCAD 存储坐标时 `classifySketch`
  才给 `L0`——顶点序号错或 geoId 错位都过不了。
  - `door-keeper.FCStd` → `ok: true, gaps: []`，3/3 草图 `L0`
    （此前 `ok: false`，唯一缺口就是 `external-geometry-unresolved`）。
  - `CrankShaft.FCStd` → `ok: true, gaps: []`，6/6 `L0`。
  - `Fountain.FCStd` → 10/10 草图 `L0`（原为 9 L0 + 1 L2）；剩余缺口是
    `fillet-non-edge-sub`，属另一类。
  - `FCBL_table_parametric.FCStd` → 2/2 `L0`；剩余缺口是 `shape-asset-broken`。
- `CrankShaft.FCStd` 现在会在 **stdout** 打印 planegcs 的
  `Redundant solving: 1 redundants` 诊断。这是正确后果——外部顶点约束现在真的
  喂给了求解器——且 stdout 不是 stderr，测试的零容忍规则不受影响。批量驱动
  取最后一行非空 stdout，该诊断不会顶掉 JSON 行。
- 有意未实现：投影出的顶点只是钉住一个点，canonical 模型没有对应的约束种类；
  这只影响转换期的保真预检与运行时求解——产出的 `cad.sketch` 仍从同一批投影
  约束重新求解。

## 值得记住的探针发现

搭回归夹具时，一次求解一直返回 `Failed`，而第一版解释（「约束到固定点就无法移动它」）
事后证明是错的。实测矩阵：

- `Coincident(自由线端点) ↔ 外部 EDGE 端点`，从 (10,25) 移动到 (10,20)：
  **收敛**。所以「移动到固定外部点」本身是可行的。
- 同样的调用，若线**起点恰在 `(0,0)`**：**失败**；换成固定的*非外部*点、换成根点引用、
  甚至在手工搭的 `GcsWrapper` 上都同样失败——所以与外部几何毫无关系。
- 在原点处的**完全约束**矩形收敛；把同一条线的系统平移到 `(1,1)` 也收敛。

判读：一个欠约束的自由点恰好落在隐式根点 `(0,0)` 上时，planegcs 的
Levenberg-Marquardt 会返回 `Failed`（该位形下 Jacobian 降秩）。这是小型欠约束系统的
数值退化，因此回归夹具起点取 `(5,5)`，原因写在测试注释里。有意**不**把它写成断言——
那等于把一个求解器怪癖固化下来，而 planegcs 升级后可能就修好了。

## 文件

- `packages/fcstd/src/external-geo.ts` —— `ExternalLink.linkIndex`、
  shape / wireframe / vertex 三级缓存、`VertexN` 分支、文档坐标系说明。
- `packages/fcstd/src/convert.ts` —— `>= 1` 折线过滤与
  `geoId: -3 - l.linkIndex`。
- `packages/sketch/src/planegcs-backend.ts` —— 约束上下文新增
  `externalPointCount`，以及 `pt()` 的外部几何分支。
- `packages/fcstd/src/external-geo.test.ts` —— 合成档案测试：`VertexN` 解析为
  单点、序号从 1 起、前序链接失败时 `linkIndex` 仍按 SOURCE 序、越界序号进台账。
- `packages/fcstd/src/sketch-solver.test.ts` —— 对外部顶点的 `Coincident`
  确实把几何移动过去。
- `packages/fcstd/src/external-vertex-e2e.test.ts` —— 依赖语料的端到端
  （兄弟目录 FreeCAD 检出不存在时跳过）。

## 考虑过的替代方案

- **把 `VertexN` 当作诚实缺口拒掉。** 否决：内核已暴露
  `getSubShapes(shape, 'vertex')` 与 `vertexPosition`，信息可得；拒绝只会把
  可修的缺口推给下游。
- **把源对象 Placement 与草图 Placement 复合。** 由实测否决而非论证：`.brp`
  坐标里已含该变换（见上），复合会重复施加。
- **保留 `geoId: -3 - i`，把失败链接从表中去掉。** 否决：这会让对齐取决于
  「哪些链接恰好解析成功」，即修好一条无关链接就会改变文档行为。
