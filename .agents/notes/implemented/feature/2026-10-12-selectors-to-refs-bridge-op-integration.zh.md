# Agent Note：selectors-to-refs 桥 + 选择器字符串 op 接入 + 教学通道封口

Status: implemented

[English](2026-10-12-selectors-to-refs-bridge-op-integration.md) | 中文

## 问题

CadQuery 选择器字符串是 AI 生成脚本挑选拓扑的可移植方式，但此前**零 op 消费它**：
选择器引擎求值出内核句柄，而 fillet/chamfer/shell/draft/defeature/extrude/punchHole/sketch*
解析的是 `EdgeTopoRef`/`FaceTopoRef`（origin+role+hint）。与此同时所有教学通道
（ai-gateway partials、ops-api-inventory、edgeRef/faceRef JSDoc）仍教序号引用
（`cad.edgeRef(part, 1)`）——跨 occt/brepkit 内核漂移的头号坑源。

## 决策

- **桥** `api/selectors-to-refs.ts`：`resolveSelectorToFaceRefs` /
  `resolveSelectorToEdgeRefs` / `resolveSelectorToVertexPts` 把 CadQuery 选择器
  字符串翻译为 内核句柄（经 `resolveStepHandles`）→ `TopoRef`，复用既有
  句柄→TopoRef 反查路径（`captureFaceHint` / `captureEdgeHint` / `findOriginRole` /
  `recoverEdgeFaceRole`）。无名实体（无 role 血统，如网格链实体）抛 `TopoRefError`，
  不静默降级（R1）。选择器子系统与命名/TopoRef 系统保持物理隔离；桥是两者间唯一显式通道。
- **参数输入归一** `expandEdgeSelectorRefs` / `expandFaceSelectorRefs`：接受顶层
  选择器字符串或数组元素字符串与 ref 混排（D2-A）：`edges: "|Z"`、`edges: ["|Z"]`、
  `edges: ["|Z", refA]`。
- **op 接入**（BREP/精度链）：fillet/chamfer（`edges`）、filletVariable（`edge` 单边，
  0/多命中抛错）、shell（`openFaces`）、draft/defeature（`faces`）、extrude（`upTo`，
  在 `baseFeature` 上解析）、sketchOnFace/sketchOnSurface/punchHole（`face`，在目标
  实体上经 `resolveFaceHandle` 解析）。网格链无 role 层：其上出现选择器字符串即显式
  `E_TOPO_MESH_UNSUPPORTED`（网格链继续用 1 起序号——设计定论）。单实体参数多命中
  抛错并给出命中数（R3）。
- **教学通道封口（Q1）**：ops-api-inventory + gen-skill-docs 示例改为 TopoRef
  字面量/选择器字符串；edgeRef/faceRef JSDoc 标注「仅查询用途，不用于脚本生成」；
  SKILL.md 新增「Selector Strings」章节；ai-gateway loader 与 sync-faijs-partials
  守卫拒绝任何含 `cad.edgeRef(` / `cad.faceRef(` 教学的片段（assertNoOrdinalTeaching）。
  `fai_drill` 不动（其 `face` 参数本就是 `FaceTopoRef`，不在范围）。

## 验证

- `selectors-to-refs.test.ts` 6/6 绿（身份一致性：`">Z"` 解析出的 ref == 命名层对
  顶面的 faceRef；无名输入抛错）。
- `feature-family.test.ts` 32/32 绿，含 8 个新 P2 锚点：fillet/chamfer
  `edges:"|Z"`、filletVariable 多命中抛错、draft `faces:">X"` == 某 faceRef 面、
  defeature 无效选择器失败、extrude `upTo:">Z"`（baseFeature 上）拉伸到顶面（体积与
  faceRef 分支一致）、sketchOnFace / punchHole `face:">Z"`。
- core `tsc --noEmit` 零错误。core 全量 vitest：3339 通过 / 5 失败——5 个是
  brepkit-kernel（fillet/drill 体积 + STL fillet 抛错断言）与 sweep 开口线既有问题，
  隔离运行可复现，与本次改动无关。
- ai-gateway partials 同步后 70 测试全绿（含守卫用例）。

## 备选方案

- **删除 cad.edgeRef/cad.faceRef。** 否决：它们是 FCStd 移植与网格链序号的桥，
  合法消费者必须保留（设计原则：Q1 是「封死生成通道」，不是「删 API」）。
- **单实体参数自动取第一个命中。** 否决（R3）：选择器多命中时静默选取比显式失败更糟。

## 影响

- `FaceSelector` 现为 `number | FaceTopoRef | string`；`ExtrudeUpTo` 在
  `'last'/'first'` 之外新增字符串形态（在 `baseFeature` 上解析）。
- 桥文件是后续选择器消费 op 的既定落点。
- weapp 探针在 0.33.2 版本联动（重建 bundle）后补选择器字符串用例，按方案 P4。
