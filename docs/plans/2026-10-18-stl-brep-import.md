# STL 导入走 BREP 路径的设计变更（2026-10-18）

- 产出：glm5.3-flash + AtomCode
- 状态：已落地（代码于 v0.35.6 / 28c2811 落地；本文档 2026-10-18 补记设计变更全貌与后续方案）

## 1. 用户原话（逐字）

> 这个可能确实是一个重大的变更，原因是3d_editor项目需要能够对stl文件进行类似倒角之类的操作，所以把它转换为了brep。那么我们的测试代码要更新。如果导入stl，不一定就是mesh路径。也许会对stl文件进行预先的判断，比如三角形大于1万个的不转换，三角形小于1万个的转换为brep（按三角形转换这个功能还没有实现）。这是一个重大的变更，你需要查看文档，测试代码等，反应这次设计变更。

## 2. 变更内容（已落地部分）

自 v0.35.6（28c2811）起，`load` op 的静态分派把 STL 归入 **BREP 路径**（此前 STL 恒走 mesh 路径）。动机：3d_editor 需要对导入的 STL 做圆角/倒角/钻孔/分割——mesh 链的网格实体边没有邻接面 lineage，这些特征在 mesh 路径上不可能实现；brepkit 内核自带 `importStl`（STL → 真 BREP 实体），occt 侧经 `reconstructSolidFromMesh`（importStl → fixShape → healSolid → unify）等价重建。

- 双引擎一致：brepkit 走 `importStl → meshBackend.ops.weld → unify`；occt 走 `parseStl → reconstructSolidFromMesh`。按内核静态分派，无运行时回退。
- STL 导入的 Shape 带 BREP 身份，参与拓扑命名（与其它 BREP part 相同），契约见 docs/api-contract.md §11.1 的 D6 条款（STL 不在 mesh 链上；mesh 链仅剩 3MF）。
- `opts.unit` 折算在转换前生效，STL 单位启发式（guessStlUnit）语义不变。
- 回归测试：`packages/tests/faijs/mixed/mixed.test.ts`（M1/M2/M5 期望 brep）、`stl-brep-path.brepkit/occt.test.ts`。

## 3. 后续方案（未实施）：三角形数量阈值预判

用户提出的候选设计：导入 STL 时做预先判断——三角形数大于 1 万的不转换（保持 mesh），小于 1 万的转换为 BREP。按三角形数量阈值转换的功能**尚未实现**；当前实现是**所有 STL 导入一律转 BREP**。

实现时的注意点（届时以正式方案文档为准）：

1. 阈值判定发生在 `load` 静态分派处（解析 STL 头得到三角形数即可判定，无需先转换），静态规则、非运行时回退——符合 BREP/mesh 路径判定红线。
2. 超阈值的 STL 保持 mesh 链（3MF 同款语义：无邻接面 lineage、`E_TOPO_MESH_UNSUPPORTED`），编辑器特征对其如实报错，不静默降级。
3. 阈值本身（1 万）与超阈值行为需要用户确认后才实施。
