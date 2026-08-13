# brep/mesh 双链路代码执行引擎实现分析

> **性质**：现状分析文档（`docs/analysis/`），不是开发计划。描述当前代码的真实实现，附 file:line 引用。
> **关联**：契约文档 [`docs/code-engine-api-contract.md`](../code-engine-api-contract.md)；演进计划 [`docs/plans/2026-08-10-baked-execution-engine-design.md`](../plans/2026-08-10-baked-execution-engine-design.md)。

---

## 1. 总体架构

执行引擎分三层，双链路的分叉点在最底层 `replay-validator.ts:206` 的 `executeStatement`：

```
入口层    executeScript() / ScriptEngine.commitAndRecord / record* / editStatement
             │
编排层    ScriptEngine（replayPart 全量重放 · plan 依赖分析 · statementCache 增量缓存）
             │
执行核心  executeStatement(stmt, inputs, outputCache, params, creationMode, brepChain)
             │                    ← 双链路分叉点
        ┌────┴─────┐
  cad-core mesh  │  cad-core brep
  (manifold-3d)  │  (occt-wasm OCCT 实体)
        └────┬─────┘
    Shape (positions+indices) → commitGeometry → VersionStore / SceneMutator.createPart
```

关键文件：

| 文件 | 职责 |
|------|------|
| `src/renderer/engine/script-engine/ScriptEngine.ts` | 编排：record*/replayPart/plan/editStatement/commitAndRecord |
| `src/renderer/engine/script-engine/replay-validator.ts` | 执行核心：逐 op 分发 + GeomRef 求值 + contentKey |
| `src/renderer/engine/cad-core/index.ts` | cad 统一 API 门面（mesh + brep 两份实现并排暴露） |
| `src/renderer/engine/cad-core/brep-ops.ts` | BREP 链状态 + OCCT 特征运算 |
| `src/renderer/engine/script-engine/executeScript.ts` | 代码加载入口（D-3/C-5） |
| `src/renderer/engine/script-engine/scene-mutator.ts` | 模型构成（R-2 唯一建零件入口） |

模式开关是 `engine-store.ts:22` 的 `primitiveCreationMode: 'mesh' | 'brep'`（persisted，可热切换，`HotkeyManager.tsx:26` 有快捷键）。

**渲染层不分链**——两条链的最终输出都是 `Shape` 三角网格，走同一个 VersionStore / GeometryBindingLayer。

---

## 2. mesh 链路（默认路径）

- **执行**：`replay-validator.ts` 各 case 直接调 `cad.*`（`cad-core/index.ts:30-96`）——box/sphere 等基本体在 `cad-core/primitives.ts` 本地生成；布尔/钻孔/分割/拉伸/雕刻走 manifold-3d（csg-worker 内 mesh-CSG，异步）。
- **变换是烘焙的**：`translate/rotate/scale` 直接改写顶点（`cad.translate/rotate/scale`，cad-core/transform.ts），不保留位姿层。
- **显示 = 精确数据**：输出直接 `commitGeometry` 进 VersionStore，GeometryBindingLayer 绑定到 mesh.geometry。

---

## 3. brep 链路（OCCT 精确实体链）

关键在 `cad-core/brep-ops.ts` 的 **`BrepChainState`**（:594-603）：一次重放共享一个 OCCT kernel 实例 + `solidCache: statementId → ShapeHandle`（OCCT 实体句柄）。执行流程（`replay-validator.ts:215-218`）：

1. `replayPart`（ScriptEngine.ts:948）在 brep 模式下 `await initBrepChainState()` 创建链
2. 逐语句执行：每个 op 先尝试从 `solidCache` 取上游 solid，在 **OCCT 实体空间** 做运算（`fuse/cut/common/transform/section/extrude`），结果存回 `solidCache`，再 `solidToShape`（brep-ops.ts:31-47，linearDeflection 0.1 / angularDeflection ~12°）三角化回 `Shape` 供显示
3. **op 的 BREP 能力分三档**（brep-ops.ts:666-687）：

| 档位 | op | 行为 |
|---|---|---|
| BREP-native | box/sphere/cylinder/cone/wedge/translate/rotate/scale/boolean | 全走 OCCT |
| BREP-conditional | drill（仅 simple 孔）、split（仅 plane 切割）、extrude（截面构建可能失败） | 参数组合满足 `isDrillBrepCapable` / `isSplitBrepCapable` 才走 OCCT |
| mesh-only | engrave/load/knurl/text/screw/svgExtrude | 遇到即**链断裂** |

4. **链断裂机制**：mesh-only op 或 OCCT 运算抛错 → `breakBrepChain`（brep-ops.ts:656）置 `brepActive=false` + 记录 `breakReason`；该语句及后续全部回退 mesh 路径（try/catch 内 fallthrough）。重放结束后若链断裂，`ScriptEngine.replayPart` 触发 `CustomEvent('brep-chain-broken')` 通知 UI toast。
5. **终端 solid 保留**：重放结束若链未断，最后语句的 solid 存入 `ScriptEngine._brepSolidCache`（ScriptEngine.ts:935），中间句柄经 `releaseBrepChainState(brepChain, keepIds)`（brep-ops.ts:634）释放——STEP 导出时查到缓存即原生导出 brep，否则 faceted 导出（exporters/index.ts:689-706, 801-842）。

### 3.1 各 op 的 BREP 实现

| op | 实现 | 要点 |
|----|------|------|
| 基本体 | `primitiveToCadSolid`（engine/primitives/primitiveToCad） | OCCT 构造精确 solid |
| translate/rotate/scale | `translateBrep/rotateBrep/scaleBrep`（brep-ops.ts:70-129） | kernel.translate / kernel.transform（THREE Matrix4 → OCCT 3x4 row-major，brep-ops.ts:572-580） |
| boolean | `fuseBrep/cutBrep/commonBrep`（:141-179） | 多输入循环归约，中间结果 release |
| drill | `drillBrep`（:213-291） | makeCylinder + transform 到孔位方向 → cut；通孔高度 = bboxMax+2 |
| split | `splitBrep`（:329-393） | 半空间盒子 common → front，cut → back；仅 plane 模式 |
| extrude | `extrudeBrep`（:425-563） | 平面分割 → section 边 → makeWire/makeFace → extrude → 三段 fuse |

---

## 4. 双链协同方式

- **单份实现、模式分叉**：`executeStatement` 的每个 case 内部都是 `if (canUseBrep && ...) { brep } else { mesh }`，两份几何实现一一对应（契约 R-1）。
- **UI 无感**：UI 只看到 Shape；brep 模式在 `commitAndRecord`（ScriptEngine.ts:846-851）与 `createPrimitivePart`（:699-707）后 fire-and-forget 触发 `replayPart` 后台更新 `_brepSolidCache`，不阻塞交互。
- **增量重算分链处理**：`editStatement` 在 mesh 模式下走 `plan()` 增量重算（statementCache 按 `statementKey = hash(op + args + inputs 的 contentKey)` 命中复用，ScriptEngine.ts:330-355）；**brep 模式放弃增量、退化为整链重放**（ScriptEngine.ts:1111-1141）——因为 statementCache 只存 mesh 不存 OCCT 句柄，续链成本高于整链重放。

---

## 5. 数据落盘与模型构成

- 提交：`commitGeometry`（engine/version-store/GeometryCommit.ts）→ VersionStore，versionPointer +1；undo O(1) 改指针。
- 建零件：`SceneMutator.createPart`（scene-mutator.ts:139-205）——Shape → BufferGeometry → STL buffer → FileBlobStore → LoadedFileModel/SceneTreeNode → addLoadedFile → 材质 override（`nameOverride/appearanceOverride` 支持代码路径透传 PartScript.meta）。
- 代码入口：`executeScript`（executeScript.ts:164）——parse → validateScriptArgs → 逐语句执行 → SceneMutator.createPart + commitGeometry → 写 script store；undo 粒度 statement/block 按 undoBudget(20) 自动退化。

---

## 6. 已知缺口与演进方向

### 6.1 契约列出的缺口

`docs/code-engine-api-contract.md` §12（A/B/C/D/E 组）：录制不保真（cone 参数名、extrude 方向、split 参数）、重放不全（import 无 case、knurl/sdf 无重放路径、跨 part 解析）、SceneMutator 接口未全实现、文本入口（parser/codegen/桥接命令）、测试往返保真。

### 6.2 结构性问题（烘焙执行引擎计划）

`docs/plans/2026-08-10-baked-execution-engine-design.md` 指出：transform 语句在 replay 中 **pass-through 不烘焙**（replay-validator.ts:280-296），事后 fold 累加为 `partTransforms` 位姿层（transform-session.ts:205-248，ModelGroup 渲染时应用）——形成"几何 vs 位姿"双态持久状态，并连锁产生 fold 欧拉相加（旋转顺序错）、pivot 丢失、第二份装配数学、复制粘贴等衍生问题。

演进方向：**操作即几何**——每条语句都在已烘焙的上游几何上执行，位姿降级为渲染层瞬态（gizmo 拖拽预览），执行顺序统一用全局 seq 而非 per-part 数组。BREP 链路径天然符合该模型（transform 已烘焙 solid）。

---

## 7. 附注

装配约束中的 `fixedFace` 字段（`FaceConstraint.fixedFace`）走的是装配烘焙路径：导入时解析 assembly marker → `computeAssemblyDelta`（assemble-store）→ `recordTransform` 写 rotate/translate 语句 → `recomputePart` 烘焙进几何（executeScript.ts:444-557），与双链执行本身是正交的两条路径。
