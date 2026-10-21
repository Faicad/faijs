# weapp 打印件模型走 mesh 链：完成度调研 + 免新增 wasm 的可行性（2026-10-22）

## 结论（TL;DR）

1. **用户的判断正确**：人脸这类"最终只能三角化 3D 打印"的模型，跑 BRep 布尔（brepkit NURBS BOP，~3s/cut，face 全链 34s）没有意义。
2. **关键发现**：已打包进小程序的 brepkit wasm 里有一个**真正的三角形 CSG `meshBoolean`**（`brepkernel_meshBoolean`，输入/输出都是三角网格），faijs **从未调用它**。实测 2k 三角的球：`meshBoolean` fuse=109ms / cut=95ms；而 faijs 网格实体链现在用的 `fuse/cut`（面驱动 BOP）同规模要 1171/839ms，BRep cut 要 ~3s。**同一份 wasm，~30x 差距，零新增体积**。
3. mesh 链完成度：变换/布尔/圆角/倒角/拉伸/草图/阵列全部有 brepkit 网格实体实现；**唯一缺口是脚本基本体（sphere/box/cylinder/cone）没有网格实体构造器**（mesh 实现是 manifold 网格数据，端侧没注册 manifold → 不可用）。
4. **不用 wasm（纯 JS）**：目前不成立——faijs 没有纯 JS CSG；manifold 是 wasm、brepkit 是 wasm。但 **"不新增 wasm"完全成立**：全部走已打包的 brepkit `meshBoolean`，变换甚至可以在 JS 侧做（纯矩阵，0 wasm）。

## 一、现状：faijs 的双轨分派与端侧装配

- 分派（`cad-runtime/backend-dispatch.ts` `decidePath`）：mode='auto' 时，输入全在 BREP 链（有 OCCT/brepkit solid 句柄）→ brep 路径；否则 mesh。链身份每 part 静态确定（`attachBrep`/`attachMeshSolid`/`attachMeshFace` 互斥，无运行时回退）。
- 脚本建模（`cad.sphere` 起）首 op 无输入 → `allInputsOnBrepChain([])` 为真 → **brep 路径**，之后全链 BRep。
- 只有 STL/3MF 导入（`load` 的 mesh 路径）产出网格实体（`importMesh→weld→unify` 规范化 + 近似拓扑）。
- **weapp worker（faijs.worker.ts）只注册 brepkit**：`ensureBrepkitDefaultEngine`（BREP）+ `ensureBrepkitMeshBackend`（网格实体）。manifold 未注册 → 所有 `meshEngines` 缺省（`['manifold']`）的 op（基本体的 mesh 实现）在端侧**直接不可用**。

## 二、mesh 链完成度盘点（以人脸模型操作集为准）

| 操作 | 人脸模型用到 | mesh 链现状（brepkit 网格实体） | 备注 |
|---|---|---|---|
| sphere / box / cylinder / cone | sphere×8 | ❌ **缺口**：mesh 实现返回 ManifoldMeshData（manifold），端侧不可用 | 需补网格实体构造器（JS 三角化 + normalize） |
| scale3d / scale / translate / rotate_euler | scale3d | ✅ `transformMeshSolid`（`hasMeshSolid` 时走内核变换） | 也可在 JS 侧对三角数据做（纯矩阵） |
| subtract / union / cut / intersect | subtract×3 + union | ✅ `booleanMeshSolid` → `kernel[op]` | **慢**：面驱动 BOP（探针 2k 面 0.8-1.2s） |
| fillet / chamfer / shell | — | ✅ `meshEngines:['brepkit']` | 导入件的圆角/倒角已生产使用 |
| extrude / sketch-on-face / pattern / replicate | — | ✅ | — |
| 拓扑（面/边/顶点选择） | 打印件可不要 | ✅ `buildMeshSolidTopology`：近似拓扑 faceRuns 直接索引显示三角（与 BREP 同构） | 3D 打印场景够用 |
| STL 导出 | 打印必须 | ✅ brepkit exportStl | — |

结论：**链的"中段"（变换/布尔/圆角/拓扑/导出）全部就绪，只缺"起点"（基本体构造器）**。

## 三、关键实测（test/perf/mesh-boolean-speed-probe.test.ts）

探针直接走裸 brepkit kernel（与端侧同一 wasm / 同一批原语）：

| 路径 | 2k tri | 8k tri | 32k tri | 说明 |
|---|---|---|---|---|
| 网格实体链 `fuse`（现状） | 1171ms | 14652ms | — | 面驱动 BOP，超线性 |
| 网格实体链 `cut`（现状） | 839ms | 13015ms | — | 同上 |
| **`meshBoolean` fuse（未用）** | **109ms** | 626ms | 3671ms | 三角形 CSG |
| **`meshBoolean` cut（未用）** | **95ms** | 644ms | 3659ms | 同上 |
| BRep `cut`（现状，face bench） | ~3000ms | — | — | 34s 全链的 ~82% |

- 规范化（importMesh→weld→unify）2k 球 ~55ms、结果 meshShape ~30-40ms（一次三角化同时喂显示与拓扑，规则 1）。
- `meshBoolean` 结果可直接作下一布尔输入（输入就是三角数组）——链式布尔**中间无需规范化**，只在收尾 normalize 一次。
- 参照：人脸模型 8 球 + 8 布尔，若全走 `meshBoolean`：布尔 ~0.8s + 收尾 ~0.1s + 脚本 ~2s ≈ **桌面 3s 内**（真机按 ~3x 估 ~10s，远低于现状 30s/100s）。

## 四、设计：打印件模型的 mesh 链（faijs 侧）

1. **暴露 `meshBoolean`**：brepkit 适配器把裸 `kernel.meshBoolean` 包成 mesh 后端能力（当前 `BrepEngineApi` 无此入口；仅在 raw wasm 上）。
2. **`booleanMeshSolid` 换引擎**：链上布尔从 `kernel[op](a,b)` 改为「取两侧三角 → `meshBoolean` → importMesh→weld→unify → 新网格实体」；中间步直接透传三角数组（不做规范化，省 2×~55ms/步）；收尾一步规范化 + 一次 meshShape 同时产显示 mesh 与近似拓扑。
3. **基本体网格实体构造器**：sphere/box/cylinder/cone/ellipsoid 的 mesh 实现改为 JS 三角化（纯数学，毫米制、Z-up，与 brepkit angular 2π/32 同族细分）→ `backend.normalize` → 网格实体；`meshEngines:['brepkit']`。这样 mode='mesh' 下脚本模型可从基本体起链。
4. **宿主选择**：weapp 侧按工程类型（如"打印件"工程）让 worker 以 `mode='mesh'` 建 runtime——已有 BRep 工程不受影响（每工程一个 runtime 配置）。端侧布尔/圆角等 op 全部已声明 `['brepkit']`，mode='mesh' 无 engine 门禁障碍。

## 五、验证与风险

- **正确性**：与 BRep 几何逐项对比（顶点/体积/STL 导出）；brepkit 上游 mesh_boolean 自带测试（`bindings/booleans.rs` wasm 测试 + `crates/operations/boolean/tests.rs`），且内核 `fuse/cut` 自身有 `mesh_boolean_fallback`（失败降级同源实现，说明几何语义与 BOP 对齐过）。
- **红线**：显示 mesh == 拓扑 mesh（一次 meshShape 同源，近似拓扑 faceRuns 索引同批三角，规则 1 天然满足）；链门禁/静态判定不变（网格实体 = 网格链输入，不冒充 BREP）。
- **性能上限**：`meshBoolean` 仍超线性（4x 三角 → ~6x 时间），32k 三角 3.7s —— 对高细分模型仍是瓶颈；先按 2π/32（2k）级别使用，必要时与 deflection 旋钮联动。
- **范围**：仅"打印件"工程切 mesh 链；BRep 工程（CNC/图纸）行为不变。

## 六、与现有优化的关系

- **延迟三角化（defer）**：mesh 链本就不做 NURBS 三角化（三角数据即实体），defer 自然无感；收尾一次 meshShape 仍受 deflection 控制。
- **执行后即写缓存（b64e0611）**：mesh 链结果就是三角数据 → 缓存存的就是最终几何，Mode A 重开零执行、零再三角化（比 BRep 链缓存更彻底）。
- 落地顺序建议：①②（暴露 + booleanMeshSolid 换引擎）→ 探针对比几何 → ③（基本体构造器）→ 端侧模式开关 + 真机验证。
