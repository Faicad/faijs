# BREP 内核内存对象管理：联合分析与重新架构方案（smlib / occt / brepkit）

- **状态**：方案（待评估）
- **日期**：2026-10-29
- **影响面**：faijs `smlib-kernel` / `brep/engine` 契约 / `cad-runtime` 生命周期；usd-brep wasm 构建配置；3d_editor weapp worker 装配与 reset 路径
- **关联文档**：`docs/plans/2026-10-27-smlib-handle-leak-plan.md`（GB 级泄漏与方案 0–E 评估）、`docs/plans/2026-10-26-smlib-brep-engine-plan.md`（smlib 接入）、3d_editor `docs/plans/2026-10-27-weapp-smlib-engine-switch-plan.md`（weapp 切换）
- **本文档目的**：回答三个问题——① smlib 接入 faijs 后内存与句柄到底怎么管的；② 之前几版方案为何都不行、真正的结构性问题在哪；③ 如何重新架构，使三个内核的内存对象管理统一、可防泄漏、可防闪退、可实施、可测试。并给出"随机闪退"的复现与验证策略。


---

## 1. 用户要求（原话保留）

本轮（2026-10-29）：

> 联合分析三个项目usd-brep，faijs，3d_editor。自从3d_editor的packages/weapp小程序端几何内核从brepkit切换为usd-brep里的smlib以后，加载测试代码如C:\my\Faicad\3d_editor\docs\examples\pikachu-1.fai.js时，随机闪退，会在不同语句执行时闪退。请全面分析目前smlib接入faijs后，如果管理内存和句柄，如何彻底解决这个问题。之前到底尝试了几版方案，为何都不行，到底是哪里的问题？而且你需要能够复现我说的随机闪退的bug，彻底修复它。

> 请先一份完整的分析和重新架构设计方案，到底在faijs里如何管理smlib/occt/brepkit等不同内核的内存对象，如何防止内存泄露和闪退，如何实施，如何测试。保证方案的完整性。

历史约束（2026-10-27 泄漏事件，原话保留，仍然有效）：

> 还有这个项目目目前也有其他人在处理，你不要动别人代码就行了，比如说你不要轻易地做全仓的全亮的一些变更，这样可能会无意覆盖别人代码

验收口径（用户原话）：**必须先复现随机闪退，再修复；修复后彻底解决**（3d_editor AGENTS.md 同款戒律：先写测试复现，不准先写修复代码）。

---

## 2. 三项目分工与问题边界

| 项目 | 角色 | 与本问题的关系 |
|---|---|---|
| usd-brep | smlib（SM_API）C++ 内核 + emscripten standalone wasm 构建（`wasm-probe/`） | wasm 产物（initial 128MB / max 4GB）、EH imports 形态、内核释放原语（`SmApiDeleteBrepEx` 为 P1 桥补齐）都出自这里 |
| faijs | `.fai.js` 解释执行 + 三内核适配（occt / brepkit / smlib）+ CadRuntime | **问题真源**：smlib 适配器的句柄登记表、生命周期契约、轮末清扫都在这里 |
| 3d_editor | 宿主（weapp worker 常驻、流式预览、LOD 精化、导出） | 闪退现场；worker 装配、reset 不 dispose、指令交错（execute/preview/retessellate/export/reset）放大了 faijs 侧缺陷 |

边界结论：闪退发生在 3d_editor 真机，但机制问题在 faijs 的内存/句柄管理层；usd-brep 提供构建配置与内核行为确认。本方案以 faijs 为主战场，usd-brep 与 3d_editor 各列一个配合阶段。

---

## 3. 现状分析：smlib 接入 faijs 后内存与句柄是怎么管的

### 3.1 三个内核的内存模型（客观差异，架构必须尊重）

| 维度 | occt（opencascade.js） | brepkit（wasm-bindgen） | smlib（emscripten standalone） |
|---|---|---|---|
| 句柄形态 | embind 对象指针（ShapeHandle） | **按类型分命名空间的裸 u32**（同一 solid=0/face=0/edge=0 并存，内核无类型判别式） | **wasm 堆裸指针** `SmBrep*`/`SmFace*`/`SmEdge*`（同为 u32，互不可辨） |
| 对象回收 | 显式 `release` 真删（op-内纪律维持） | **内核侧 GC**（JS 侧无需删） | **GC-less**：无人删就永不回收（每次 `makeBox` ≈ 50KB 永久泄漏） |
| 借用关系 | face/edge 独立句柄 | face/edge 独立句柄 | face/edge 是 Brep-owned 借用指针，**owner 死则悬垂** |
| 类型判别 | embind 自带 | 无（适配器在句柄高位编 kind tag，brepkitKernel.ts L56-86） | 无（适配器用**登记表命中**当判别，smlibKernel.ts L74-98） |

关键事实：L1 契约 `BrepEngineApi` 的生命周期注释假设"GC 型引擎 release 为 no-op"（primitives.ts L41），这是按 occt/brepkit 写的；smlib 是 GC-less 内核，**该契约对它缺失"谁负责回收"的语义**——这是全部历史方案反复碰壁的契约层根因。

### 3.2 当前 smlib 适配器的管理机制（现状代码事实）

全部位于 `packages/core/src/smlib-kernel/smlibKernel.ts`：

1. **六张 module-level 表**（模块级单例，非 kernel 实例成员）：`solidHandles: Set<number>`（L66，唯一需要真释放的 SmBrep*）、`faceHandles`/`edgeHandles: Set<number>`（L85-86，借用指针，只进不出）、`wireHandles: Map`（L242，合成句柄 0x2_00000000+）、`vertexHandles: Map`（L247，0x3_00000000+）、`compoundHandles: Map`（L258，虚拟容器 0x4_00000000+），另 `triCacheByMemory: WeakMap<Memory, Map<number, TriMesh>>`（L121，containsPoint 的三角化缓存）。
2. **类型判别 = 查表命中**：把 `SmFace*` 喂 `SmApiBrepBoundingBox(SmBrep*)` 是 C++ 类型混淆——2026-10-28 抽壳 `openFaces:"|Z"` 崩溃实证：1 面触发 wasm "memory access out of bounds" trap，其余返回倒置/退化/1e20 垃圾（L74-84 注释）。登记表是防混淆的唯一屏障。
3. **生命周期四方法现状**：`release` = no-op（L658，历史教训：真删会误删 solidCache 仍持有的 box2 → 1001）；`disposeHandle` = 受控真删（L666，查表、清 triCache、`SmApiDeleteBrepEx`）；`releaseAllExcept(keep)` = 轮末清扫（L675，方案 E，keep 传播 compound→kids）；`dispose` = 全删（L705）。
4. **runtime 侧清扫**：`sweepGcLessTransients`（runtime.ts L1021-1032）在 execute/append/update 三入口的轮末调用，keep = `solidCache` 全部句柄 + `meshSolidRegistry` 句柄；`disposeSolidHandle`（L2503）在覆盖旧值/缓存失效/dispose 时单点真删；`brep-chain.ts` L153 缓存替换时走 `disposeHandle`。
5. **布尔副本化**：`booleanOp`（L616-654）先 `SmApiBrepCopy`×2（原地消耗式内核，保用户句柄契约），`result !== pa` 时把被消耗的 pa 移出登记表防双释放；失败分支只释放 pa（pb 归属内核，"失败语义不明"——见缺陷 D7）。
6. **hash**：`subShapeHashOf = ptr % BREP_HASH_BOUND`（L177）——以**裸指针**为拓扑 hash 源（红线：meshShape faceGroups 与 subShapeHashes 同源）。
7. **DataView 纪律**：`memOf(k)` 每次新建视图（L180）；`booleanOp`/`meshShape` 已修"跨内核调用重取视图 + `.slice()` 拷出"（7a9c051）；但 `primitiveArgs` 模式（L225-233，**调用前捕获 dv、内核调用后读出参**）仍遍布图元构造（makeBox/makeCylinder/makeSphere…）。
8. **装载/EH**（smlibWasm.ts）：standalone wasm 无 JS glue；`invoke_*` 真实转发到 `__indirect_function_table`（catch wasm exception → 恢复栈 → `setThrew(1,0)` → 按返回类型给默认值，L211-237）；**`__cxa_*` 全部 stub 为 `throw new Error('unexpected C++ exception path')`**（L239-245）；wasi 全 stub。weapp 端 imports 清单由 3d_editor build.mjs 构建期烘焙（`WEAPP_SMLIB_IMPORTS`），与 wasm 产物**无哈希绑定校验**。
9. **3d_editor weapp 宿主**（platform/faijs.worker.ts + weapp/worker/index.ts）：worker 常驻单 runtime（interpreter 后端、eager 三角化、LOD L0）；指令集 execute/preview/retessellate/export/reset 交错；**`resetRuntime` 只置 null 重建，不调用旧 `runtime.dispose()`**（faijs.worker.ts L357-362）；主线程持有上轮 `brepSolids` 句柄发 export 指令（worker 侧 `exportStepFilePerSolid` 直用 `entry.solid`）。

### 3.3 历史方案回顾：一共尝试了几版、为何都不行

出处：`docs/plans/2026-10-27-smlib-handle-leak-plan.md`（实测记录），共 **6 版**（0/A/B/C/D/E）：

| 方案 | 内容 | 结局 | 为什么不行（本质） |
|---|---|---|---|
| 0 现状 | `release` no-op | GB 级泄漏（30 轮 execute +698MB ≈ 24MB/轮；真机 GB 级 → OOM 闪退） | GC-less 内核无人回收 |
| A 纯引用计数 | `release` 真删（计数归零删） | 实测 6 用例 1001 失败，**回滚** | faijs 有**几十处** `release()` 调用点（boolean/compoundFns/joinery/primitive/pattern/hull…），它们此前全部依赖"release 是 no-op"才无害——大量释放的是**借用/输入句柄**（并不拥有）。真删 = 误删风暴。**本质：所有权语义从未被定义，几十处调用点各自"以为"的语义不一致** |
| B 受控释放 | 新增 `disposeHandle`，仅 runtime 持有者释放点真删 | 回归 64 文件 828 项全绿，但 30 轮仍 +698MB，**不足以根治** | 只覆盖 solidCache 每轮被覆盖的 ~5 个输出句柄；**op 内中间体**（union 的 copy、内核内部对象）没有任何释放路径。**本质：释放点挂在"持有者"上，覆盖不到"创建即抛弃"的中间体** |
| C 每轮全量清空 | execute 前 `kernel.dispose()` 全删重建 | 未实施 | 上轮返回给上层的句柄悬垂（宿主跨轮持有 brepSolids/export/undo）；增量 append/update 不能清。**本质：把"哪些该活"当成全局开关，与"跨轮存续者存在"的事实冲突** |
| D A 的补全版 | 引用计数 + 逐文件修正几十处 release 所有权 | 未实施 | 改动面 = 几十个 op 文件 × 所有权语义审计，与"别大改、别撞别人代码"的用户约束直接冲突。**本质：方向正确但实施风险不可控——没有机器可判的判据，纯人工审计几十处** |
| E 轮末释放非终端 | `releaseAllExcept(keep)`，keep = solidCache + meshSolidRegistry | **已实施**（2026-10-27/28，含 DataView 修 + tessellate 桥 27MB/轮内核泄漏修 45217b35） | 回归全绿 + 30 轮 <2MB 验收转绿。**但它只是"治住了泄漏"，没有治住"删除引入的新问题"**——见 §3.4 D2/D3/D4/D6：真删除一旦发生，所有以裸指针为键的表/缓存/hash 都成了悬垂污染源。**这正是当前"随机闪退"高发的机制层** |

一句话总结历史：**方案 0–E 全部在"什么时候调 delete"这一个维度上打转；从未解决"删除之后，所有以裸指针为身份的系统如何随之失效"这个维度。** smlib 与 occt/brepkit 的本质差异不是"没有 GC"，而是"裸指针即身份"——删除 + 指针复用 = 身份盗用。这是结构性问题，不是补丁能覆盖的。

### 3.4 现存缺陷全局清单（先全局、后单点）

> 按用户铁律：先给全局清单（哪些点可能挂死/出错、各自条件），再谈单点。标注：〔机制=必然缺陷〕〔条件=触发前提〕〔后果=闪退/泄漏/错误数据〕。

| # | 缺陷 | 位置 | 机制/条件 | 后果 |
|---|---|---|---|---|
| D1 | **生命周期契约错位**：`release` 对 GC 型 = no-op、对 GC-less = no-op（历史妥协），"谁负责回收"无定义 | primitives.ts L41 + smlibKernel.ts L658 | smlib 接入即成立 | 泄漏（已由 E 缓解）+ 所有权无判据（D5 的根） |
| D2 | **借用句柄表永不清理**：`faceHandles`/`edgeHandles` 只进不出；owner brep 被删后表项悬垂 | smlibKernel.ts L85-98 | 任何真删（disposeHandle/清扫/布尔消耗）+ malloc 地址复用 → 新对象命中旧表项 → **solid 被当 face 分派**（或反向） | wasm OOB trap / 垃圾数据 → **随机闪退**（哪条语句命中复用地址不确定）〔机制〕 |
| D3 | **triCache 清理不对称**：`disposeHandle` 清（L672）、`releaseAllExcept` **不清**（L699-703 只删 solidHandles + 调内核删） | smlibKernel.ts | 每次轮末清扫即触发 | 指针复用后 containsPoint 命中旧网格 → 错误分类 → 下游错误几何/选择错乱〔机制〕 |
| D4 | **拓扑 hash 以裸指针为源**：`ptr % BREP_HASH_BOUND`（L177），meshShape faceGroups 与 subShapeHashes 同源红线一起被污染 | smlibKernel.ts L177 | 真删 + malloc 复用 → 旧 hash 与新对象碰撞 | 拓扑/命名缓存跨轮污染 → 面选择/演化映射错乱 → 后续内核调用喂错句柄（连锁到 D2 的崩溃形态）〔机制〕 |
| D5 | **keep 白名单完备性无判据**：keep = solidCache + meshSolidRegistry（runtime.ts L1024-1026），"brepSolids/topology/statementCache 引用同一批句柄"是**注释断言非机器验证**；宿主侧（weapp 主线程 brepSolids、undo、导出）持有关系分散在 3d_editor | runtime.ts L1021 | 任何新的句柄持有者出现（新指令、新缓存、宿主新功能）且未进 keep | 误删存活对象 → use-after-free → `SM_ERR 1001` / trap〔条件〕 |
| D6 | **module-level 状态跨实例/跨 runtime 共享**：六张表是模块单例，不随 kernel/runtime 实例走 | smlibKernel.ts L66-258 | 同进程两个 runtime（web 双开、weapp reset 重建、测试并行）共享表：A 的轮末清扫会删 B 的 solidCache 句柄 | 跨 runtime use-after-free〔条件〕 |
| D7 | **内核侧确认项未闭环**：布尔失败分支 `pb` "归属内核"不释放（L635-638 注释自认"失败语义不明"）；内核失败路径是否 delete pb、`SmApiDeleteBrepEx` 对已悬垂指针的行为、malloc 失败路径（emscripten 默认 `ABORTING_MALLOC=1` → abort）| smlibKernel.ts + usd-brep | 失败路径 / 内存增长失败触发 | 失败即泄漏（pb）或失败即 abort 闪退〔条件〕 |
| D8 | **DataView 跨内核调用使用未清零**：`primitiveArgs` 模式（调用前捕获 dv、调用后读出参）遍布图元构造 | smlibKernel.ts L225+ 及同型散点 | 内核调用内触发 `memory.grow`：V8 = detach → TypeError（确定性报错）；iOS JSC = 可能**不抛错而读旧 buffer**（brepkit 时代同型真机 bug：3d_editor `000c0aa38` "glue memory views refresh by buffer identity — JSCore"） | node 报错 / 真机**静默垃圾句柄** → 下游随机崩〔条件〕 |
| D9 | **EH stub 把内核异常路径变成必崩**：`__cxa_*` stub = `throw new Error(...)`（smlibWasm.ts L239-245）；`invoke_*` 吞 wasm exception 转 `setThrew` 的语义与 `-fwasm-exceptions` 构建是否匹配未实证 | smlibWasm.ts L207-249 | 内核内部任何 C++ catch/throw 路径（退化几何、容差边缘、分配失败 bad_alloc）被走到 | 从 import 里 throw JS 错误穿过 wasm 栈 → 未捕获 → worker 整体崩溃 = **闪退**。哪些输入触发内核异常 = 表面随机〔条件〕 |
| D10 | **weapp imports 清单与 wasm 产物无绑定校验**：`WEAPP_SMLIB_IMPORTS` 构建期烘焙，换 wasm 不换清单（或反之）无机器拦截 | 3d_editor build.mjs / worker/index.ts | 产物与清单失配（历史上 wasm 已刷新过 3 次：c6b5e6a4/45217b35/7a9c051） | 实例化失败或缺 import → boot 崩〔条件〕 |
| D11 | **weapp reset 不 dispose 旧 runtime**：`resetRuntime` 置 null 重建（faijs.worker.ts L357-362），旧 runtime 的 solidCache 句柄滞留 module-level 表，靠下一轮清扫"意外收尸" | 3d_editor platform/faijs.worker.ts | reset 后到下一次 execute 之间，旧句柄可被 export/retessellate 指令引用 | 悬垂访问；且依赖 D6 的共享表才"恰好"被清〔条件〕 |
| D12 | **wasm 内存策略缺位**：initial 128MB / max 4GB / 无上限策略 / 无压力上报（2026-09-18 设计文档登记的"wasm memory 上限策略实测"至今未落地；泄漏 plan §6 并行待办同样未落地）| usd-brep 构建 + faijs 装载 | iOS 微信 worker 内存预算有限；pikachu-1 显式 segments:64 绕过 LOD（L0 失效）→ 单轮峰值高 | 增长失败 → emscripten abort → **闪退，且崩在哪条语句取决于之前涨了多少 = 表面随机**〔条件〕 |

### 3.5 "随机闪退"根因候选与证据链排序

用户症状：真机加载 pikachu-1.fai.js，**随机**闪退，**不同语句**处闪退。

| 排序 | 假说 | 依据 | 预测的复现特征 | 证伪/证实探针 |
|---|---|---|---|---|
| H1（最高） | **D2+D3+D4 连锁：真删除后裸指针身份系统污染 → 类型混淆/悬垂访问 → wasm trap** | 机制必然成立（不需要设备特殊行为）；方案 E 引入"常态化真删除"正是切换后新出现的东西（brepkit 时代内核 GC，无 JS 侧删除，无此问题——**症状随切换出现的时间线吻合**）；"哪条语句命中复用地址"由分配历史决定 = 表面随机 | 第二轮 execute 起（AI 迭代/重跑/参数编辑后）高发；同脚本同轮次可复现；node 同 wasm 同逻辑**应当能复现**（分配序列确定） | P1 复现 harness（§7.1）：跑"execute→清扫→再 execute"循环，断言无 trap + dead 访问计数=0；当前代码预期红 |
| H2 | **D12：iOS worker 内存预算击穿（grow 失败 abort / 系统杀进程）** | 128MB 初始 + 单轮峰值（64 段球 eager 三角化 + 全部中间体活到轮末才清扫）+ iOS 预算；崩点=增长失败的那条语句=随内存曲线移动 = 表面随机 | 单轮长脚本后段崩；重复加载更易崩；node 永远不崩（4GB 可用） | 真机内存曲线日志（每语句上报 `memory.buffer.byteLength`）；node 侧模拟增长上限（限制 max memory 重跑） |
| H3 | **D9：内核 C++ 异常路径经 EH stub 变必崩** | `__cxa_*` stub 直接 throw；哪些输入触发内核内部异常在用户多变的脚本里 = 表面随机 | 输入相关的确定性（同一脚本 node 也崩）；伴随内核错误场景（退化几何/布尔失败） | EH 探针（§7.1-4）：node 构造已知触发内核异常的输入，观察是错误码还是 JS throw/trap |
| H4 | **D8：iOS JSC grow 后旧视图不 detach（brepkit 同型先例）** | `000c0aa38` 先例证明该平台行为存在；primitiveArgs 模式未清零 | 仅真机/仅 JSC；同脚本 node 全绿 | 真机 characterizeWasm 扩展（grow 后旧 DataView 是否 detach）；或等 D8 清零后观察闪退是否消失 |
| H5 | 主线程渲染域（three.js/iOS WebGL/流式帧洪峰） | 闪退也可能是主进程而非 worker | 主线程日志先行终止；worker 日志完整 | 真机日志二分（worker 存活标记心跳帧） |

判断框架（为什么 node e2e 绿而真机炸）：同一 wasm + 同一脚本在 node 是**确定性**的；真机差异只有三类——**内存上限**（H2）、**JS 引擎/WXWebAssembly 行为**（H4）、**使用模式**（多轮迭代、指令交错 → H1 的触发面）。所以复现策略必须同时覆盖"机制复现"（node，把随机转确定性）与"环境复现"（真机日志）。

---

## 4. 重新架构设计

### 4.1 设计目标与不变量

1. **G1 身份不变量**：一个 BrepHandle 在其生命周期内唯一标识一个内核对象；对象被释放后，该句柄**永远**不再指到任何新对象（含 malloc 复用场景）。
2. **G2 判型不变量**：任何句柄在任何时刻都能被判定类型与存活状态；对已释放句柄的任何内核调用 = **确定性显式错误**（`E_HANDLE_DEAD`），不是类型混淆、不是 trap。
3. **G3 所有权不变量**：每个内核对象创建时其所有权类别即确定（owned / transient / borrowed），释放责任唯一；"轮末清扫"的 keep 集合由**创建时打标**推导，不再由"事后收集持有者"推导。
4. **G4 缓存一致不变量**：所有以句柄为键的缓存（三角化、mesh、拓扑 hash、演化表），在句柄释放时**由同一释放路径级联失效**，不允许任何旁路删除。
5. **G5 实例隔离不变量**：内核适配器状态随 kernel 实例走，禁止 module-level 可变单例；两个 runtime 共存时互不可见对方对象。
6. **G6 失败即错误不变量**：内核 malloc 失败、布尔失败、异常路径——一律以错误码/异常**返回给调用方**，禁止 abort/trap/静默吞（usd-brep 构建配合）。
7. **G7 契约统一不变量**：occt / brepkit / smlib 在 L1 生命周期契约下语义一致（详见 4.3 契约 v2），差异全部消化在适配器内。

### 4.2 核心设计：SmlibHandleRegistry（句柄间接化）

**把"裸 wasm 指针"从句柄身份里拿掉。** JS 侧 BrepHandle 不再是 `SmBrep*`，而是 registry 槽位号；槽位持有指针。

```ts
// 结构示意（faijs: packages/core/src/smlib-kernel/handleRegistry.ts，新建）
type SlotKind = 'solid' | 'face' | 'edge' | 'wire' | 'vertex' | 'compound'
interface Slot {
  state: 'live' | 'dead'
  kind: SlotKind
  ptr: number            // solid/face/edge: wasm 指针；wire/vertex/compound: 无
  owner: number | null   // face/edge → 所属 solid 槽位；级联失效的依据
  kids?: number[]        // compound → 子槽位
  coords?: BrepVec3      // vertex 数据
  curves?: number[]      // wire 曲线槽位
  epoch: number          // 槽位复用代数（诊断/断言用）
}
class SmlibHandleRegistry {
  private slots: (Slot | null)[] = []   // 槽位数组 + free-list
  private freeList: number[] = []
  alloc(kind, ptr, owner?): BrepHandle  // 句柄 = (slotIndex + 1) << 3 | kindTag
  resolve(h: BrepHandle): Slot          // dead/越界/非本 registry → throw E_HANDLE_DEAD
  release(h: BrepHandle): void          // solid: 级联失效 owned face/edge + 清缓存 + SmApiDeleteBrepEx
  releaseExcept(keep: ReadonlySet<BrepHandle>): void
  assertAllDead(): void                 // 测试用：free-list 一致性
}
```

关键决策与理由：

- **句柄编码**：`(slotIndex + 1) << 3 | kindTag`。`slotIndex+1` 避开 0；kindTag 复用 smlib 现有三段高位 tag（wire 0x2_/vertex 0x3_/compound 0x4_）的既有事实形态——**BrepHandle 仍是 number，L1 契约类型零变化**，occt/brepkit 不受影响。SMLIB 句柄空间仍与 face/edge 借用指针分离，`smlib` 现有"0 是合法句柄"的导出判定语义（weapp export 已有 GOTCHA 注释）在 registry 下自然成立（0 保留为 null）。
- **G1 如何成立**：槽位从 free-list 复用，但**句柄含 epoch 检查**——复用槽位时 epoch+1，`resolve` 校验 epoch？不需要：句柄编码里只有 slotIndex，旧句柄在新 epoch 下 resolve 到的 Slot 是 live 的**新对象**——这违反 G1？不违反：G1 要求"释放后的句柄不再指新对象"。两个方案：(a) 句柄编码带 epoch 低位（`slotIndex << 6 | kindTag<<3 | epoch&7`——碰撞概率 1/8，不可接受）；(b) **死句柄登记**：`released: Map<slotIndex, epoch>`，resolve 时 epoch 不匹配 → `E_HANDLE_DEAD`；epoch 相同概率 = 2^53 槽位复用周期，实际为零。采用 (b)：`resolve` = 查槽位 → state==='live' 且 `deadEpochs.get(idx) < slot.epoch`。简化实现：槽位不物理复用直到 epoch 追平？过度设计——(b) 一个 Map 足够，且只在 release 时写入。
- **G2 如何成立**：`resolve` 是所有内核调用的唯一入口（适配器内所有 `k.find('SmApi*')(ptr, ...)` 的 ptr 一律来自 `resolve(h).ptr`）；dead → 显式 throw，带句柄/kind/epoch 上下文。类型混淆在**入口处**终结，不再依赖"查表命中"。
- **G4 如何成立**：释放只有 `registry.release` 一条路径（内部完成：级联失效 owner 的 face/edge、清 triCache、清 wire/vertex/compound 子表、调 `SmApiDeleteBrepEx`）。`disposeHandle`/`releaseAllExcept`/`dispose` 全部改为 registry 的薄包装——**三条释放路径归一**，triCache 不对称（D3）、借用表不清理（D2）在结构上消失。
- **拓扑 hash 改源**：`subShapeHashes` 与 meshShape faceGroups 的 hash 源从 `ptr % BREP_HASH_BOUND` 改为 `slotIndex % BREP_HASH_BOUND`（同源红线保持：两路径都走 registry 的同一 slot）。指针复用不再产生 hash 碰撞（D4 消失）。跨轮拓扑稳定性语义不变：同一对象跨轮 slot 不变（不被清扫则槽位不动）；被重算的对象本来就该拿新 hash（与 occt 重建对象拿新 hash 同语义）。
- **G5 如何成立**：registry 实例挂在 `createSmlibPrimitives()` 闭包内（随 kernel 实例），六张 module-level 表全部迁入并删除（D6 消失）。`triCacheByMemory` 的 WeakMap 键控保留（跨实例隔离），内层键从 ptr 改 slot 句柄。
- **改动面控制**（用户约束"别大改、别撞别人代码"）：registry 是 `smlib-kernel/` 内部实现细节，L1 契约方法签名零变化；op 层（api/）、runtime 层零改动（除了 4.3 的契约 v2 标记点与 4.5 的构建配置）。occt-kernel / brepkit-kernel 一行不动。

### 4.3 生命周期契约 v2（`BrepEngineApi` 修订）

把"创建时打标"作为 G3 的实现，契约面修订为：

```ts
export interface BrepEngineApi {
  // ── 生命周期（v2）──
  /** 放弃引用（GC 型引擎转发内核语义；GC-less 引擎 = 无操作，见 disposeHandle/releaseAllExcept）。 */
  release(shape: BrepHandle): void
  /** 受控真释放：调用方声明"该句柄不再被任何持有者引用"。dead/未登记句柄 → 显式 E_HANDLE_DEAD（防双释放与悬垂删除）。 */
  disposeHandle?(shape: BrepHandle): void
  /** 轮末批量清扫：keep 之外的 owned 对象全部释放。GC 型引擎不实现。 */
  releaseAllExcept?(keep: ReadonlySet<number>): void
  dispose(shape?: BrepHandle): void
  // v2 新增（全部可选，缺省行为 = 现状，occt/brepkit 不需要实现）：
  /** 声明句柄为"跨轮存续"（owned-by-runtime）。未声明的登记对象在轮末清扫中释放。
   *  返回撤销令牌（runtime 覆盖旧值时 revoke）。keep 白名单收集模式废弃。 */
  retainForRound?(shape: BrepHandle): object
  revokeRetain?(token: object): void
}
```

- **keep 推导倒转**（D5 的解）：现状是"事后收集所有持有者的句柄"（漏一个 = 悬垂）；v2 是"创建即 transient，显式 retain 才跨轮"（漏 retain = 该对象被清扫，若仍有引用 → 立刻 `E_HANDLE_DEAD` **显式报错可定位**，而非静默 use-after-free 随机崩）。错误从"随机闪退"降格为"确定性异常 + 栈顶可定位"。`sweepGcLessTransients` 改为：`kernel.releaseAllExcept(retainedSet)`，`retainedSet` 由 runtime 维护（`retainForRound` 的登记表：solidCache 写入时 retain、覆盖/删除时 revoke）。
- **release 语义保持现状**（引用放弃，不删）：方案 A 的"几十处调用点语义未审计"问题不重新打开——那些调用点在 v2 下语义是"放弃引用"，registry 不据此删除。所有权审计（方案 D）不再是对防泄漏的前置必要条件。
- **occt**：`release` 本就真删（op 内纪律自洽），v2 无需 retain/releaseAllExcept。**brepkit**：内核 GC，全可选。三内核契约统一性由"可选方法 + 缺省回退"保持，`AssertSatisfiesBrepEngineApi` 编译期断言继续生效。
- **宿主跨轮持有**（D5/D11 的 3d_editor 侧）：weapp 主线程 brepSolids 持有的句柄，worker 侧来源是 solidCache（已 retain）——契约不变；但 `reset` 指令必须在重建前调用旧 `runtime.dispose()`（§6 P3），dispose 语义 = 全部释放 + registry 整体作废（epoch 全部失效，之后任何旧句柄 = E_HANDLE_DEAD 而非悬垂）。

### 4.4 内存视图纪律（DataView）

1. 适配器内新增唯一封装 `callOut<T>(k, size, write, invoke, read): T`：malloc → write → `invoke()` → **重取 DataView** → read → free（try/finally）。所有"带出参的内核调用"一律走它；`primitiveArgs` 的"调用前捕获 dv"模式（D8）全部消灭。
2. 大块读取（meshShape/wireframe）维持现状纪律：**每次内核调用后重取 DataView** + `.slice()` 拷出后再 free 桥缓冲（7a9c051 已修，加回归锚固）。
3. 静态守卫：`scripts/check-smlib-dataview.mjs`（grep 级即可）——`smlib-kernel/*.ts` 中禁止"`= memOf(` 捕获的变量出现在其后的 `k.find(...)(...)` 调用行之后仍被读"的模式，白名单显式登记（callOut 内部豁免）。CI 门禁。
4. iOS JSC 风险（H4）在 1/2 落地后**结构性消除**（不再存在跨调用视图），真机 characterizeWasm 探针保留为验证手段。

### 4.5 wasm 内存与失败策略（usd-brep 构建配合）

1. **INITIAL_MEMORY 128MB → 64MB**：weapp worker 启动即占 128MB 本身是 iOS 闪退叠加因素（泄漏 plan §6 已登记）；node 探针显示 64 起步对 pikachu-1 峰值充足（30 轮 <2MB 增长的同一探针可复验）。
2. **`-s ABORTING_MALLOC=0`**：malloc 失败返回 0 而非 abort（G6）。内核侧配套确认（usd-brep）：`SmApi*` 的 new 失败路径返回 `SM_ERR_MEMORY`（若现状会抛 bad_alloc → 走 EH 路径 → 与 4.6 联动处理）；`SmApiDeleteBrepEx(0)` 幂等。
3. **内存压力上报**：faijs 侧 `SmlibKernel.onMemoryPressure` 钩子（`memory.buffer.byteLength` 超阈值 384MB 时触发一次）；weapp worker 转发为协议帧，主线程上报日志并提示（不自动 reset——策略留给宿主，faijs 只给事实）。
4. **上限**：`--max-memory=768MB`（构建期）。超过 = malloc 失败 = 错误码（2），不再赌设备预算。上限值在真机验收后可调，机制不变。

### 4.6 EH / 装载保真（D9/D10）

1. **EH 模式实证**（usd-brep 配合）：确认 `smlib_standalone.wasm` 的实际 EH 构建模式（`-fwasm-exceptions` vs legacy `-s DISABLE_EXCEPTION_CATCHING` 组合），以 emscripten 为**同一 flags** 生成的 JS glue 为对照基准，逐符号核对 faijs `makeEnvImport` 的转发语义（invoke 的 catch/转发/setThrew、`__cxa_*` 是否应真实实现而非 throw）。结论落为 `docs/analysis/` 文档 + 探针测试。
2. **`__cxa_*` stub 修正**：按 1 的实证结果实现最小保真集（至少 `__cxa_throw/__cxa_begin_catch/__cxa_end_catch/__cxa_allocate_exception` 的正确行为），禁止"必崩 stub"进入内核错误路径。
3. **异常注入探针**（faijs 测试）：构造已知触发内核异常的输入（布尔退化、bad_alloc 模拟——构造性确认后固化），断言"错误码返回，进程存活"。
4. **imports 清单哈希绑定**（3d_editor build.mjs）：烘焙 `WEAPP_SMLIB_IMPORTS` 时同时烘焙 wasm SHA256 前 8 字节，worker boot 时校验 vendored wasm 哈希一致（D10 机器拦截）。

### 4.7 与历史方案的关系（收口）

| 历史方案 | 在新架构中的归宿 |
|---|---|
| A/D（所有权审计） | 不再是防泄漏前置项（retain 倒转后，漏标 = 显式错误而非误删）；作为长期代码质量项保留 backlog |
| B（disposeHandle） | 保留，实现改 registry 薄包装，dead 访问 = 显式错误 |
| C（全量重建） | 废弃（reset 指令走 `dispose()` 语义达成同等效果且无悬垂——epoch 全失效） |
| E（releaseAllExcept） | 保留为 registry 的批量释放原语；keep 来源从事后收集改为 retain 登记 |

---

## 5. 实施计划

> 纪律：每阶段先写测试（复现/验收）再动代码；faijs CI 绿后才 `set-version` + `pack`，3d_editor 走 `npm run update-faijs`；3d_editor 侧改动仅限 weapp/platform 配合点，不触碰他人功能代码。

### P0：止血与机制复现（faijs only，先行独立发版）

| 项 | 内容 | 文件 |
|---|---|---|
| P0-1 | 复现 harness（§7.1 全套，**先写**，预期红） | `test/smlib-kernel/smlib-crash-repro.test.ts`（新） |
| P0-2 | D3：`releaseAllExcept` 释放时级联清 triCache | `smlibKernel.ts` |
| P0-3 | D2 最小版：`getSubShapes` 登记借用句柄时记 owner；`disposeHandle`/`releaseAllExcept`/`dispose` 释放 solid 时把 owner 命中的 face/edge 表项清出 | `smlibKernel.ts` |
| P0-4 | D8 最小版：图元构造的 captured-dv 模式改"调用后重取"（`primitiveArgs` 族） | `smlibKernel.ts` |
| P0-5 | P0-2/3/4 各配防回归测试（GOTCHA 留档） | `test/smlib-kernel/` |
| 验收 | harness 由红转绿（或明确记录哪些子探针仍红 → 归入 P1）；64 文件 828 项 + engine-switch + split-by-plane + 拓扑/命名链全绿；`smlib-handle-reclaim` 保持绿 | |

### P1：HandleRegistry + 契约 v2（faijs，核心重构）

| 项 | 内容 | 文件 |
|---|---|---|
| P1-1 | `SmlibHandleRegistry`（§4.2 全量：slot/epoch/级联/释放归一） | `smlib-kernel/handleRegistry.ts`（新） |
| P1-2 | 适配器迁移：六张 module-level 表删除，全部句柄路径走 `resolve`；hash 改 slot 源 | `smlibKernel.ts`（大改，集中本文件） |
| P1-3 | 契约 v2：`retainForRound/revokeRetain` 入 `BrepEngineApi`；runtime 的 keep 收集改 retain 登记（solidCache 写入/覆盖/删除三点） | `primitives.ts` / `runtime.ts`（sweepGcLessTransients 与 setSolidAndTess/releasePartCaches/dispose 四点） |
| P1-4 | DataView 守卫脚本 + callOut 封装收口（§4.4） | `smlib-kernel/` + `scripts/check-smlib-dataview.mjs`（新，CI） |
| P1-5 | registry 单元测试全套（slot 生命周期/级联失效/epoch 防复用/双实例隔离/hash 稳定性） | `test/smlib-kernel/handle-registry.test.ts`（新） |
| 验收 | P0 harness 全绿；reclaim 30 轮 <2MB 保持；**200 轮 <5MB** 新门禁；exec-backend-diff 全绿；双 runtime 互踩测试绿；lint/typecheck/全量单测绿 | |

### P2：内核与构建配合（usd-brep + faijs）

| 项 | 内容 | 位置 |
|---|---|---|
| P2-1 | INITIAL_MEMORY 64MB / ABORTING_MALLOC=0 / max-memory 768MB，重编 standalone wasm | usd-brep `wasm-probe` 构建脚本 |
| P2-2 | 内核确认项闭环（D7）：布尔失败 pb 归属、DeleteBrepEx(0) 幂等、new 失败错误码路径 | usd-brep（探针 + 必要修补） |
| P2-3 | EH 实证与 stub 修正（§4.6-1/2/3） | usd-brep 确认 + faijs `smlibWasm.ts` |
| P2-4 | onMemoryPressure 钩子 | faijs `smlibWasm.ts` / `smlibKernel.ts` |
| P2-5 | wasm SHA 同步：faijs vendor + 3d_editor vendor + 生产 SHA 记录（沿用 7a9c051 的三方同步流程） | 三仓 |
| 验收 | node 全量回归 ×新 wasm；异常注入探针绿；内存压力钩子单测 | |

### P3：宿主配合（3d_editor weapp/platform）

| 项 | 内容 | 文件 |
|---|---|---|
| P3-1 | `resetRuntime` 先 `runtime.dispose()` 再重建（D11） | `platform/src/weapp/faijs.worker.ts`（reset 路径，非他人功能代码） |
| P3-2 | imports-wasm SHA 绑定校验（§4.6-4） | `scripts/build.mjs` + `worker/index.ts` |
| P3-3 | 内存曲线日志：每语句帧附 `memory.buffer.byteLength`（H2 复现取证）；worker 心跳帧（H5 二分） | platform 协议帧扩展 |
| P3-4 | 真机验收流程执行（§7.4） | — |
| 验收 | loopback pikachu e2e + worker-sim 全绿；真机 50 轮迭代无闪退（§7.4） | |

依赖顺序：P0 →（P1 ∥ P2 前半）→ P2 后半（wasm 定稿）→ P1 收尾对新 wasm 回归 → P3。P0 可独立发小版本先止血。

---

## 6. 测试与复现策略（用户核心要求：必须能复现随机闪退）

### 6.1 复现 harness（P0-1，node，把"随机"转"确定性"）

同 wasm + 同脚本在 node 是确定性的，所以复现策略 = **复现闪退的机制**（每条缺陷一个探针），而不是赌表象随机性：

1. **多轮复用探针（H1 主探针）**：`execute(pikachu-1 全文)` → 触发轮末清扫 → 再 `execute`（第二轮）→ 断言：无 trap、无 `SM_ERR 1001`、对第一轮返回的每个句柄调 `isValid`/`getBoundingBox` 要么正常要么**确定性报错**（现状预期：随机 trap / 垃圾 bbox → 红）。变体：第二轮换脚本（cat.fai.js）打乱分配序列 ×10 种顺序——覆盖"复用地址命中"的组合面。
2. **指针复用直击探针**：小对象循环 create→dispose→create 同尺寸（强制 malloc 复用），断言：新句柄 ≠ 旧句柄（registry 后成立；现状红）、旧句柄访问显式报错（现状 = 命中旧 faceHandles 表项 → 类型混淆，红）、`subShapeHashes` 新旧不碰撞（现状红）。
3. **grow 边界探针（D8/H4 机制）**：循环 `makeBox` 直至 `memory.grow` 发生（探针实证第 ~2599 次），中途穿插全部图元构造 op，断言无 TypeError/detach（现状预期红——primitiveArgs 模式在 grow 点必抛）。
4. **EH 注入探针（H3）**：构造内核异常路径输入（退化布尔——构造性确认后固化 fixture），断言返回错误码而非 JS throw/trap（现状按 stub 行为预期红）。
5. **双 runtime 探针（D6）**：两 runtime 共享 kernel，A sweep 后断言 B 的 solidCache 句柄全部存活（现状预期红）。
6. **retessellate/export 交错探针（D5/D11 使用模式）**：execute→retessellate→export→update 循环（weapp 真实指令序列），断言全程无 dead 访问、无 trap。

> 留档纪律（faijs AGENTS）：harness 全部落为 `*.test.ts` 常驻仓库；P0 前的"红"用 `it.fails` 显式标注并在 P0/P1 验收时逐条转正，不静默跳过。

### 6.2 回归与稳定性门禁

| 门禁 | 判据 |
|---|---|
| 既有回归 | 64 文件 828 项全绿（重点 engine-switch-*、split-by-plane*、拓扑/命名链、parity） |
| 泄漏 | `smlib-handle-reclaim` 30 轮 <2MB 保持；新增 **200 轮 <5MB**（真机前硬门禁） |
| 稳定性 | harness 6 探针全绿；10 种语句顺序扰动 × 20 轮无 trap |
| 一致性 | exec-backend-diff（Vm vs Interp）全绿——weapp 用的 interpreter 后端必须与 vm 同构 |
| 三端 | 3d_editor `faijs-worker-loopback.pikachu-example.test.ts` + worker-sim 全绿 |

### 6.3 静态守卫（防复发）

1. `check-smlib-dataview.mjs`：跨内核调用的 DataView 使用纪律（§4.4-3）。
2. ESLint/grep 守卫：`smlib-kernel/` 内禁止 module-level `new Set`/`new Map` 可变单例（D6 防复发）。
3. 契约断言：`retainForRound/revokeRetain` 进 `AssertSatisfiesBrepEngineApi` 体系（可选方法，smlib 必须实现）。
4. usd-brep：wasm 构建产物 SHA 记录与 faijs/3d_editor vendor 三方一致性脚本（沿用现有流程，加 CI 步骤）。

### 6.4 真机验收（H2/H4/H5 环境面）

1. 内存曲线：P3-3 日志上线后跑 pikachu-1 ×50 轮（含 AI 迭代式 execute→update 交错），曲线应"锯齿归零"（轮末回落），无单调爬升；闪退若再现，最后存活语句 + 内存水位即定位 H1/H2。
2. 心跳二分：worker 心跳帧连续缺失 = worker 崩（H1/H2/H3）；心跳在、主线程先死 = H5（移交 3d_editor 渲染域）。
3. 验收判据：真机 50 轮零闪退；iOS 与 Android 各一台；`[weapp-exec-timing]` 无异常增长。

---

## 7. 风险与回滚

| 风险 | 缓解 |
|---|---|
| P1 句柄编码改动导致跨层数值依赖（如 weapp export 的 `=== undefined` 判定、hash 持久化到工程文件） | hash 源切换（ptr→slot）影响拓扑 hash 数值——拓扑 hash 仅进程内使用（naming/evolution），不落盘（需在 P1 前机器验证一次：grep 拓扑 hash 的所有消费点）；句柄跨线仅存于单次响应内（brepSolids 随下轮作废），无持久化 |
| registry 引入性能开销（resolve 查表） | 数组索引 O(1)，实测对比（benchmark：pikachu-1 全程耗时回归 ±5%） |
| P2 新 wasm 引入内核行为变化 | 三方 SHA 同步流程 + node 全量回归 + 3d_editor e2e 双层门禁 |
| P1 改动集中在 smlibKernel.ts（他人协作区） | 改动前在该文件头登记协作声明；registry 独立新文件；P0 小步独立发版，P1 一个 PR 可回滚（revert 单 commit） |
| retain 漏标造成新报错面（错误前置暴露） | 这正是设计目标（显式错误取代随机闪退）；上线前 harness 6 探针 + 全量回归把关；报错信息带句柄/kind/语句上下文可定位 |

---

## 8. 待确认问题（实施前需拍板）

1. **H2 的权重**：真机是否已采集到闪退时的内存水位（P3-3 之前是否有 wx 性能面板数据）？若已有"水位不高仍崩"的证据，H1/H3 优先级进一步上调；若水位总是顶满，P2 的 INITIAL_MEMORY/max-memory 应提前到 P0 之后立即做。
2. **usd-brep 协作窗口**：P2 需要内核侧确认/修补（D7、EH 模式、ABORTING_MALLOC），是否有对 usd-brep 的提交窗口；若无，P2 降级为"faijs 侧防御"（压力钩子 + 探针）先行。
3. **200 轮 <5MB 门禁**的阈值确认（泄漏 plan §7-5 遗留问题的延伸）。
4. **拓扑 hash 消费点清点**：P1 前机器清点 subShapeHashes/hashCode 的全部消费方（确认无跨进程持久化依赖），若存在落盘依赖则 hash 切换需带迁移说明。
5. **3d_editor 侧改动授权范围**：P3 四项是否均属"我可以动"的边界（均为 weapp/platform 配合点，不涉他人功能代码——按 2026-10-27 用户约束复核）。

---

## 9. 结论

1. smlib 接入 faijs 后的内存管理现状：module-level 裸指针登记表 + no-op release + 轮末 keep 白名单清扫（方案 E 产物）。它治住了 GB 级泄漏，但**没有治住"真删除 × 裸指针身份"的结构性矛盾**——借用表/缓存/hash 全部以裸指针为键，删除与复用之后必然产生类型混淆与悬垂访问，这是随机闪退的最高概率根因（H1）。
2. 历史共 6 版方案（0/A/B/C/D/E），全部在"何时调 delete"维度打转；A 败于所有权未定义、B 败于覆盖不到中间体、C 败于悬垂、D 败于改动面、E 治漏不治崩。共同盲区：**删除之后的身份失效从未被架构化**。
3. 本方案以 **HandleRegistry 句柄间接化**（slot+epoch+级联失效+释放归一）+ **契约 v2 retain 倒转**（黑名单默认清扫、显式保活）+ **视图/内存/失败/装载四项纪律** 统一三内核内存管理；分 P0–P3 四阶段实施，P0 可独立止血发版。
4. 复现策略：机制复现（6 个确定性探针，node，先红后绿）+ 环境复现（真机内存曲线与心跳二分），满足"必须能复现随机闪退"的验收要求。
