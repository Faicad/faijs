# Agent Note：brepkit 非实体句柄支撑（wire/face/compound）

English | [中文](2026-09-26-brepkit-non-solid-handles.md)

## 问题

在 brepkit 引擎上，任何产生非实体几何的 op（wire/profile/sectionByPlane/extrude/revolve/sew/sewAndSolidify/removeHolesFromFace）都崩溃，报 `invalid solid handle: index N out of bounds`。根因：op 层统一调用 `solidToShape()` → `kernel.meshShape(handle)` → brepkit `tessellateSolidGrouped()`，该函数只接受 solid 句柄，传入 wire/face 句柄即抛异常。

## 决策

所有修复集中在适配器层（`packages/core/src/brepkit-kernel/brepkitKernel.ts`）；op 层仅改 `extrude.ts`（brepkit length 路径直连 `kernel.extrude(face, vx,vy,vz)`，与 revolve 一致）。

发现并编码了三个 GOTCHA：

1. **按类型独立的句柄命名空间。** brepkit 的 solid/face/wire/edge 句柄各自从 0 独立计数（实测 edge=wire=face=solid=0 可共存）。裸数字 `N` 类型模糊，跨类型编号会碰撞。
2. **`markSolid(h)` 辅助函数。** 每个产生 solid 的 op（`makeBox/makeSphere/.../extrude/revolveVec/fuse/cut/common/sewAndSolidify/split`，以及 `cloneShape` 的 `copySolid` 回退）都调用 `markSolid(h)`，从 `knownFaces/knownWires/knownEdges/knownCompounds/derivedFaces` 中删除该编号。这样新 solid 若复用了旧 face/wire 的编号，会回退到默认 solid 路径。
3. **`derivedFaces` 与 `knownFaces` 分离。** `getSolidFaces(solid)` 返回全局面索引（0..5, 6..11, ...），与 solid 句柄碰撞。若登记进 `knownFaces`，后续 solid 会被误判为 face 而错误三角化（union 的 bbox 变成 [0,0,0]）。修复：枚举得到的子面放入独立的 `derivedFaces` 集合，仅 `getSubShapes` 的 edge/vertex 钻探咨询，`meshShape`/`getBoundingBox` 绝不咨询。显式创建的 face（`makeFace`/`sectionByPlane`/`addHoles`/`removeHoles`）留在 `knownFaces`。

`meshShape`/`getBoundingBox` 分发：`knownFaces`→`tessellateFace(...).positions`；`knownWires`→`getWireEdges`+逐边 `tessellateEdge`；`knownEdges`→`tessellateEdge`；`knownCompounds`（虚拟句柄 `0x80000000+counter`，因 brepkit `makeCompound` 只接受 solid）→合并子 bbox/mesh；否则走 solid 路径。

## 已考虑的替代方案

- 对非实体句柄返回空 mesh（降级）：拒绝——wire/profile 需要可见几何；brepkit-wasm 的非实体三角化 API（`tessellateFace`/`tessellateEdge`/`getWireEdges`/`getFaceEdges`）存在且可用。
- 给句柄加类型前缀：拒绝——内核期望裸数字；需要改 op 层。

## 后果

- 9 个 op 在 brepkit 上不再崩溃。回归测试 `brepkit-non-solid-fix.test.ts`（10/10）。
- 对拍 `multi-engine-op-parity.test.ts`：brepkit 2.129.15/3.4.18/4.0.32 三版本 mismatches=0。
- **诚实降级**：`revolve` 产生约 2% 的 bbox 差异（三角化角度偏转 vs occt 精确值）——已在 `KNOWN_BREPKIT_GAPS` 中登记原因。op 本身不崩溃且接受 face 输入。
- 既有缺口不变：intersect/chamfer/loft/screw/draft/thicken/knurl/sdf（24 个 error 组合 = 8 op × 3 版本）。
- face 的 `getBoundingBox` 采样 `tessellateFace(...).positions`（GOTCHA：`tessellateFace` 返回 JsMesh 对象而非扁平数组——把整个对象传给 `arr()` 会静默产生空 bbox）。

## D 批扩展（fillet/filletVariable）

C 批的 `getSubShapes` 修复使单独探针中 fillet 通过，但全量对拍序列中仍失败——进一步定位为 `markSolid` 未从 `derivedFaces` 删除句柄。当 box solid 句柄与之前 shape 的 derived face 句柄号碰撞时，`getSubShapes(solid,'edge')` 误走 `getFaceEdges` 分支（仅返回 4 条边而非盒的 12 条），导致 edgeRef 找不到相邻面。

修复：`markSolid` 增加 `derivedFaces.delete(h)`。同时修复虚拟 compound 的 `getSubShapes(c,'solid')`——compound 分支此前只处理 'face' 类型，对 'solid' 返回 []，改为返回 compKids 中属于 solid 的子句柄。

修复后 fillet/filletVariable 在四引擎全部通过，从 `KNOWN_BREPKIT_GAPS` 移除。
