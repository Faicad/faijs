# faijs 单位系统设计（2026-09-28）

**状态：用户已裁定全部待定项（§0.2 / §0.3），无阻塞项，可按 §6 的阶段顺序实施。**

**实测基线**：本文档所有 `file:line`、路径与机制断言均于 2026-09-28 对当前工作区源码（`C:/my/Faicad/faijs`）与下游 `C:/my/Faicad/3d_editor` 逐条实测核对；凡标「实测」者均为本轮跑过命令得到的结论。`docs/plans/` 不受 `npm run doc-sync` 的链接/换行/typecheck 门禁约束。

---

## 0. 用户要求

### 0.1 用户原话（第一轮）

> 「faijs 目前把长度单位定死为 mm，这只是早期为了方便实现而定的，而现在 faijs 必须要能支持单位的设置。faijs 处理的是 3d 模型，单位当然是模型的重要参数之一。」

> 「方案须参考 Onshape FeatureScript 标准库的单位系统（`C:\git\new\onshape\onshape-std-library-mirror`），**不做半吊子**。」

> 「你是否区分了ts库层面与faijs脚本代码层面，对单位的处理。ts层面是可以有类型的，ValueWithUnits、UnitSpec是合理的。但是js语言层面是不带类型的。在脚本层面，能否优化"n * unit 中缀乘法"的实现。在类型系统看来，它是ValueWithUnits，在运行时系统看来，它只是一个裸数字。比如mm=1, meter=1000, 3*m就是3000。这样是否能够简化系统实现？根本不需要什么运算符重载。」
> 「问题是所谓的ts的类型，在执行的时候，也是先扔掉的。」

> 「为什么你不能放开思路呢？我既要求运行时可以丢弃量纲，还需要编译时可以校验量纲。而这个校验甚至不需要类型系统。脚本里 3*meter + 1*degree，不需要复杂的分析也知道这是错误的写法。不许分析也知道裸数字3是不合法的。必须是数字带量纲。而量纲是预定义的数字。就是这么简单的规则。」

### 0.2 用户原话（第二轮裁定，2026-09-28）

> 「1. 角度基准取「度」；
> 2. 几何 API 参数 是否要ValueWithUnits 化，你负责判断。我要求是faijs脚本层面不需要这套类型系统，如果有ValueWithUnits 化，也只是库层面的ts语言有这套单位的类型系统。
> 3. formatCodeLine/codeToArgs的序列化改造，应当允许传递当前cad系统设置的单位。比如原单位mm，用户设置的系统单位inch，那么要自动换算，用户看到的尺寸是换算后的。且用户可以随时切换单位。」

### 0.3 裁定的落点

| 裁定 | 落点 | 结论 |
|---|---|---|
| 1. 角度基准 = **度** | §4 D1.1 | 与现行契约 R-5、现有 op 入参一致；`degree = 1`、`radian = 180/π` |
| 2. 几何 API 参数是否 `ValueWithUnits` 化 | §4 D4 | **不做**（op/几何入参一律裸 number）；`ValueWithUnits` 只活在 TS 库面（I/O、容差、单位运算、工程元数据） |
| 3. 序列化携带**系统显示单位** | §4 D10 + §5.3 + §6 P7 | `formatCodeLine` 增单位上下文参数，自动换算；文本是投影、基准值是真源；切换幂等 |

### 0.4 已定基线（第一轮，沿用）

1. **内部基准单位 = 毫米（mm）**：occt/topology/阈值常量现有注释已按 mm，保留现状，把 mm 从"隐式注释"提升为"显式基准"。
2. **完整量纲系统**：`UnitSpec` 通用量纲机制（任意 `dimension^exponent` 组合），而非只做 Length。
3. **单位系统独立立项**（本文档），3MF/STL 导入作为本系统**第一个消费者**，在本文档内直接定义，不引用其它方案文档。
4. **3d_editor 场景可设单位**（mm/inch/米），生成的 faijs 脚本带上单位字面量 `n * unit`。关键洞察：**TS 类型运行时擦除，脚本层面单位常量就是裸数字（相对基准 mm 的缩放系数），`10 * inch` 就是普通乘法 = 254，不需要运算符重载。** 量纲校验靠脚本解析后的简单 AST 检查，不需要类型系统。

---

## 1. 参考：Onshape FeatureScript 的单位方案（核心机制）

Onshape 的单位不是"裸数字 + 旁边贴标签"，而是**内建在值类型里的量纲系统**：

1. **值携带单位**：`ValueWithUnits = { value: number, unit: UnitSpec }`，单位天生属于值（`units.fs:75-104`）。
2. **统一基准 + 派生单位是常量**：`millimeter = 0.001 * meter`、`inch = 2.54 * centimeter`，任何 `ValueWithUnits.value` 永远存基准数值，`unit` 只记量纲（量纲常量 `units.fs:107-121`；派生单位常量 `:149` meter、`:157` millimeter、`:161` inch、`:239` degree）。
3. **量纲检查内建**：加法 precondition `lhs.unit == rhs.unit`（`units.fs:558-559`），`3*meter + 3*degree` 报错；`isLength` 是 `:434` 的 predicate、`isAngle` 是 `:461`；比较运算符 `<` 同样带前提（`:531-536`）。
4. **几何 API 参数强制带单位**：`cube(sideLength is ValueWithUnits)` + precondition `isLength(...)`；裸 number 从不被当作有单位的长度（`primitives.fs:29-34, units.fs:811-815`）。
5. **容差/边界带单位**：`NONNEGATIVE_LENGTH_BOUNDS` 按单位给不同默认/上下限，底层统一折算（`valueBounds.fs:266-300`）。
6. **只在内核边界剥离单位**：`stripUnits`（进 builtin 前剥到裸 float）、显示时 `length / inch`（`units.fs:1013-1062`）。
7. **角度也是量纲**：`sin` 收 angle 返回 number；反三角返回 angle（`units.fs:811-815, 854-857`）。

> **⚠️ 基准不同：只借鉴机制，禁止照抄 Onshape 的常量数值。**
> Onshape 的基准是 **meter / radian / kilogram / kelvin**（`units.fs:107` `LENGTH_UNITS = { meter: 1 }`、`:109` `ANGLE_UNITS = { radian: 1 }`、`:111` `MASS_UNITS = { kilogram: 1 }`、`:113` `TEMPERATURE_UNITS = { kelvin: 1 }`），它的 `ValueWithUnits.value` 一律以米/弧度存（故 `:239` 是 `degree = 0.0174532925199432957692 * radian`）。
> faijs 的基准是 **mm / degree / gram / kelvin**（D1；角度取度为用户裁定）。所以把 `millimeter = 0.001 * meter` 原样搬进 faijs 会差 **1000 倍**，把 `degree = PI/180 * radian` 搬进来会差约 **57.3 倍**。本文档 D3 给出的 faijs 常量是**唯一正确数值**，以它为准。

faijs 无法照搬语言级运算符重载，但结构完全对应：

| Onshape | faijs |
|---|---|
| FeatureScript API 层（`ValueWithUnits`） | faijs **TS 库面**单位标量类型（方法式运算，见 D3/D4） |
| `stripUnits`（进 C++ builtin） | 进 manifold-3d / occt-wasm 前取基准裸 number；跨面边界一律裸 number（D4） |
| builtin 裸 float 内核 | manifold / occt wasm（裸 float，隐含基准单位） |
| `units.fs` 常量 + `valueBounds.fs` | `units.ts` 单位常量 + 容差常量（D6） |
| FeatureScript 源码里 `3 * inch` | faijs 脚本里 `3 * inch`——但 faijs 的 `inch` 是**裸数字常量**，量纲只靠名字 + 静态校验（D7/D8） |

参考实现目录：`C:\git\new\onshape\onshape-std-library-mirror`。

---

## 2. 现状盘点（逐条实测于 2026-09-28）

### 2.1 契约注释层面写死「毫米 / 度」

| 位置（已核对） | 实测内容 |
|---|---|
| `packages/core/src/mesh/types.ts:7` | 坐标系：右手系 +Z 向上、**毫米、角度用度** |
| `docs/api-contract.md:90` / `docs/api-contract.zh.md:90` | R-5：millimeters (mm), +Z up, **angles in degrees** |
| `packages/sketch/src/canonical.ts:9` | lengths in mm, angles in degrees |
| `packages/core/src/topology/naming/roles.ts:28` | 语义命名器按 faijs 单位/轴向契约（mm、+Z 向上） |
| `packages/core/src/occt-kernel/topologyExt.ts:45-46` | Topology data stays in mm — viewer called with scale:1 |
| `packages/fcstd/src/container.ts:29-30`、`container-read.ts:154` | manifest `units: 'mm'` 字面量（两处） |

### 2.2 运行时阈值/容差按 mm 量级硬编码（真正依赖 mm 的隐患）

| 位置（已核对） | 实测内容 | 语义 |
|---|---|---|
| `packages/core/src/topology/naming/score.ts:36` | `const CENTROID_DIST_SQ_MAX = 100`（用在 `:121`） | **mm²** 距离平方门限（= 10mm 半径²） |
| `packages/core/src/occt-kernel/topologyExt.ts:42` | `{xmin:-100, …, xmax:100}` | 兜底 bbox ±100 **mm** |
| `packages/core/src/occt-kernel/occtKernel.ts:526,532` | `tolerance = 0.01`（JSDoc：sewing tolerance in mm） | 缝合容差 0.01**mm** |
| `packages/core/src/brep/engine/types.ts:72-74` | `linearDeflection?: number`，注释「最大弦偏差（mm），默认 0.1」；同接口 `angularDeflection` 默认 0.5（**弧度**，注释写明） | 三角化精度 |
| `packages/core/src/occt-kernel/occtKernel.ts:219` | `const ld = options.linearDeflection ?? 0.1`（`:241` 相对模式 `ld * diag`） | 同上 |
| `packages/core/src/brep/handle-bridge.ts:69-71, 124` | MeshHandleOptions「linear deflection (mm), default 0.1」 | 同上 |

同一 `0.1` 默认值还散落在 `brep/primitives-brep.ts:74`、`brep/brep-ops.ts:58`、`brep/brep-topology.ts:99`、`brepkit-kernel/brepkitKernel.ts:700`、`api/brep-mirror/joinery-brep.ts:230`。

### 2.3 本地换算表（"单一真源"要收敛的对象）

| 位置（已核对） | 实测内容 |
|---|---|
| `packages/fcstd/src/expressions.ts:19-28` | `UNIT_TO_MM`：长度 `mm/cm/m/in/ft` 与角度 `deg/rad` **混在同一张表**；`:16` 注释明说「angles keep their own unit」（故 `deg:1, rad:1`） |
| `packages/fai_cq_warehouse/src/measure.ts:12` | `export const INCH = 25.4`（`:150` 使用） |
| `packages/fai_cq_warehouse/src/params.ts:229` | `const factor = unit === 'mm' ? 1 : INCH` |
| `packages/fai_cq_warehouse/src/sprocket.ts:63` | **又独立定义了一份** `const INCH = 25.4`（与 measure.ts 重复，收敛时必须一并处理） |
| `3d_editor/packages/app/src/config/file-formats.ts:388` | `UNIT_TO_MM`（3d_editor 侧，见 §9-C） |

### 2.4 结构性缺口

- `Shape = { positions: Float32Array; indices: Uint32Array }`（`mesh/types.ts:38-41`）**无单位字段**。
- manifold-3d 是纯数值内核，不感知单位。
- `packages/core/src/mesh/io.ts:21-37` 的 `importFile(buffer, format?)` **当前只解析 STL**，其它格式 fallback 到 STL 解析失败即抛错；**没有 3MF/STEP 解析分支**（3MF 解析目前只存在于 3d_editor 侧 `file-formats.ts:406`）。且该实现只解码 buffer 前 2048 字节的原始字节去找 `<model unit="…">`（`file-formats.ts:407-409`），而该 XML 位于 ZIP 内 deflate 压缩的 `3D/3dmodel.model` 条目中 → 对真实 3MF **恒返回 `'millimeter'`**（`:416`）。这条是实现必须上移到 faijs 的直接依据（迁移时别照抄这个扫描法：必须先解 ZIP 条目再读 XML）。
- STL 无单位元数据；STEP 的单位解释下放给 OCCT 内核。
- **查询返回值是裸 number**：`api/measurement/index.ts:44`（`area`）、`:66`（`volume`）、`:77`（`centerOfMass`）；`api/generated/measurement.ts:19/97`（`measureVolumeProps`/`inspectMassProps`）。

### 2.5 脚本执行面与校验面现状（D7/D8 的地基，实测）

| 机制 | 实测事实 |
|---|---|
| 调用入口 | 解释器 `cad-runtime/interp/eval-expr.ts:204 evalCall`，`:246` 直接 `fn.apply(thisArg, args)`——**裸值直通，没有任何运算符拦截层** |
| 执行后端 | **两个**：`VmBackend`（默认；`cad-runtime/exec-backends/vm-backend.ts:17-25`，`new Function('__ctx','__ns','__isGeom', src)`）与 `InterpBackend`（禁动态代码环境） |
| 自由标识符解析 | vm 后端靠 global 作用域；interp 后端 `cad-runtime/interp/env.ts:92-93` **只认 `S4_SAFE_GLOBALS`**，名单在 `lang/security-scanner.ts:145`（Math/Number/…/console）。不在名单且未声明 → `SEC_FREE_IDENT`（`security-scanner.ts:610` 判定，`:614` 抛错） |
| 可遮蔽性 | `InterpEnv.assign`（`env.ts:104-118`）根作用域写入 `ctx`；`lookup` 顺序是 **ctx(`:86`) → ns(`:89`) → globals(`:92`)** ⇒ **ctx 可遮蔽全局名**。现有规则只有 `SEC_NS_ASSIGN`（`security-scanner.ts:649/653`，禁写命名空间），**没有**禁止写全局名 |
| 校验唯一入口 | `extractMetadata`（`lang/metadata-extractor.ts`）；`CadRuntime.check()`（`cad-runtime/runtime.ts:1376-1403`）与 `execute`（`:714`）都经它。错误 stage 联合类型是 `'parse'｜'symbol'｜'reference'｜'keep'｜'security'`（`runtime.ts:73`） |
| 参数校验现状 | 旧的 `args-schema`/`SCHEMAS` **已删除**，现由各 op 自调 `api/assert.ts` 断言助手 |
| L3 脚本面来源 | **生成式**：`api/surface/arg-spec.ts`（唯一人工维护点，字段含 `params`/`schema`/`slotMap`/`scriptFace`/`capabilities`）→ `packages/core/scripts/gen-l3-surface.ts` → `api/generated/*.ts` + `api/generated/script-face-manifest.ts` |
| 手写 op | `packages/faijs-extra/src/ops/{fai_extrude,fai_drill,fai_split,copy,text,svg-extrude}.ts` 直接 `defineOp(...)` |
| 双形态调用 | `api/internal/dual-form-args.ts`（`SlotMap.keys/vec3Keys/shapeArity`，`:210-228`）：`box(10,20,30)` 与 `box({size:[10,20,30]})` 等价 |
| 代码文本原语**在 faijs** | `lang/codegen.ts:137 formatCodeLine`、`lang/code-to-args.ts:109 codeToArgs`、`lang/statement-summary.ts:87 analyzeCode`、`lang/host-arg.ts`（`HostArg` 四种 kind：`var-ref/param-ref/call-ref/expr-ref`，`HOST_REF_KINDS` 是保留字），统一经 `@faicad/faijs/env-agnostic` 暴露 |
| 参数表达式实时校验 | `lang/expr-validate.ts validateExpression`：表达式里每个 Identifier **必须命中 knownNames**，否则 `E_REFERENCE`；节点白名单 `isExprWhitelist`（`metadata-extractor.ts:314-341`）**允许 BinaryExpression** |

### 2.6 实测：单位字面量在当前代码里的真实行为（D7/D8/D10 的直接依据）

用 `npx tsx` 直接跑当前源码（探针脚本已删除，结论固化为 §7 的测试）：

| 表达式 | 实测结果 | 含义 |
|---|---|---|
| `extractMetadata('let p0 = cad.fai_extrude({ length: 10 * mm });')` | **抛 `SEC_FREE_IDENT`（E_SECURITY）** | 单位常量未登记前，脚本里根本写不出 `10 * mm`——"解释器零改动"不成立 |
| 同上（`10 * inch`） | 同上抛错 | 同上 |
| `extractMetadata('…{ length: 10 + 5 }')` | `{length: 15}`，`hasComputedArgs: false` | 纯字面量表达式被静默折叠，且 computed 不置位 |
| `codeToArgs('let p0 = cad.fai_extrude({ length: 10 * inch })')` | **`{ length: 0 }`** | 前置声明 `let inch = 0` 把 `inch` 变成哨兵参数 → 折叠成 **0**；把 `globalThis.inch = 25.4` 注册好也**仍然是 0**（哨兵遮蔽全局） |
| `codeToArgs('…{ length: 10 * mm }')` / `10 * mm + 2 * mm` | 同样 `{ length: 0 }` | 基准单位形态同样归零 |
| `formatCodeLine({ positional: [{length:{kind:'expr-ref',text:'10 * inch',refs:[],params:[]}}], … })` | `let part0 = cad.fai_extrude({ length:(10 * inch) })` | `fmtValue`（`codegen.ts:79`）对 expr-ref 无条件加括号——可用但形态含糊 |
| `fmtNum(1e-7)` | `'0'` | `fmtNum`（`codegen.ts:34-39`）6 位小数截断 → **静默归零**；`String(0.39370078740157477)` 则是精确往返表示 |

结论（D10 的两条硬要求由此而来）：**单位字面量必须在解析侧被显式识别**（既不能被安全规则拒、也不能被哨兵折叠成 0、也不能在回填时丢形态），**单位化数字不得走 `fmtNum`**。

---

## 3. 目标 / 非目标

### 目标

1. 建立**完整量纲系统** `UnitSpec`（任意 `dimension^exponent` 组合）+ 单位标量类型 `ValueWithUnits`（TS 方法式，无运算符重载）。
2. 确立**基准单位表**，把 mm 从隐式约定提升为显式基准；角度基准 = **度**（用户裁定）。
3. 现状硬编码 mm 的阈值/容差（§2.2）改为带单位常量，**逐个保留原语义**。
4. I/O 边界做单位换算，删除重复换算表（§2.3），收敛到 `units.ts` 单一真源。
5. **脚本语法层支持单位字面量** `n * unit`：脚本侧单位常量是裸 number，解释器无需运算符重载；量纲正确性由**静态 AST 校验**保证（新增校验 stage）。
6. **序列化携带系统显示单位**（D10）：宿主把"当前 cad 系统单位"传给 `formatCodeLine`，长度/角度按该单位自动换算后落到脚本字面量；用户可随时切换单位（重投影，几何零漂移）。
7. 3d_editor 生成的脚本带上单位字面量，用户可选 mm/inch/米；脚本编辑器实时校验接受单位常量。

### 非目标

- 不改 manifold-3d / occt-wasm 内核内部（继续裸 float、隐含基准单位）。
- 不实现质量属性/材料成本等**消费方**（只提供量纲类型与常量）。
- **不把 `ValueWithUnits` 做成 op 的运行时参数类型**（D4）。
- **TS 面不做 op 调用的量纲类型校验**（D4 明示：没有类型就没有检查；要做得另建类型化 façade）。
- **faijs 不引入"当前单位"全局状态**（D10）：系统显示单位由宿主持有并显式传入。

---

## 4. 设计决策

### D1 — 基准单位表

| 量纲 | 基准单位 | 理由 |
|---|---|---|
| length | **mm** | 用户裁定：几何/occt/topology 现有基准全按 mm，改动最小 |
| angle | **degree（度）** | 用户 2026-09-28 裁定；与 R-5、现有 op 入参、`sketch/canonical` 契约一致（见 D1.1） |
| mass | gram | 配合 mm 使密度 = g/mm³，贴合 3D 打印场景 |
| temperature | kelvin | 绝对温标规避摄氏/华氏的 ±偏移 |
| time | second | 唯一普遍基准 |
| current | ampere | SI |

长度用 mm 意味复合量纲随之推导：`AREA = mm²`、`VOLUME = mm³`、`FORCE = gram·mm/s² = milli-newton`、`DENSITY = g/mm³`。这不是问题——`UnitSpec` 只承载指数，物理值由 `value`（基准数值）唯一确定。

**落地范围**：P1 必须实现 length 与 angle；mass/temperature/time/current 只落常量与量纲类型（当前无消费方），在 `units.ts` 中标注为保留位。

#### D1.1 角度基准 = 度（已裁定）

**裁定**：角度基准 = **度**。常量定义 `degree = 1`、`radian = 180 / Math.PI ≈ 57.29577951308232`（基准是度，故 1 rad ≈ 57.29…°）。脚本面常量（D7）同值。

**与现行契约一致**：`docs/api-contract.md:90` R-5（angles in degrees）、`mesh/types.ts:7`、`sketch/src/canonical.ts:9`；现有角度 op 入参也是度（`api/transform.ts:226-230` JSDoc「欧拉角（度，XYZ 顺序）」、`slotMap: { keys: ['anglesDeg'] }` 于 `:245`）。

**实施时必须守住的三条**：

1. **不做全量收敛**：`mesh/transform.ts:42-46` 等处的 `* Math.PI / 180`（度 → 弧度，进 manifold 内核前的换算）**保留原样**，它是内核边界换算，不是重复真源。
2. **不得双重换算**（本项唯一实质风险）：任何"脚本值 → op 入参"的路径上不得再乘/除 180/π。实测 `3d_editor/packages/app/src/engine/features/fai_split.ts:45-52` 内部已有 `rx * Math.PI/180`，单位系统上线后其入参语义**仍是度**，该处不动；`codeToArgs` 读回时也不得再换算。
3. **`angularDeflection` 默认 0.5 是弧度**（`brep/engine/types.ts:74-76` 注释），属内核三角化参数，不进脚本面单位体系（D6 硬约束 2）。

**角度入参清单（P1 交付物，测试锁死）**：`anglesDeg`（`api/transform.ts:245`）、`pressureAngleDeg`、`inPlaneAngleDeg`、`capAngle`、以及各手写 op 中的角度字段——逐项确认"入参 = 度"，并用测试断言 `45 * degree` 到 op 的实际数值为 45。

### D2 — `UnitSpec`：通用量纲，非枚举

拒绝"枚举单位（`LengthUnit = 'mm'|'inch'`）"——那是把显示单位当量纲，无法表达复合量纲与维度校验。采用 Onshape 的 `UnitSpec`：

```ts
type BaseDimension = 'length' | 'angle' | 'mass' | 'temperature' | 'time' | 'current'
/** 量纲 = 基准维度 → 指数（稀疏：未出现的维度指数为 0）。实现用冻结的普通对象。 */
export type UnitSpec = Readonly<Partial<Record<BaseDimension, number>>>

const LENGTH: UnitSpec = { length: 1 }
const AREA:   UnitSpec = { length: 2 }
const FORCE:  UnitSpec = { mass: 1, length: 1, time: -2 }
```

量纲相等 = 各项指数逐一相等（`unitEquals`）。维度校验发生在 `add`/`sub`/比较之前。

### D3 — `ValueWithUnits`：方法式单位值（TS 无重载）

```ts
export class ValueWithUnits {
  readonly value: number       // 永远以基准单位表（mm/度/gram/...）存
  readonly spec: UnitSpec
  add(rhs: ValueWithUnits): ValueWithUnits       // spec 不等 → throw
  sub(rhs: ValueWithUnits): ValueWithUnits
  neg(): ValueWithUnits
  mul(n: number): ValueWithUnits
  div(n: number): ValueWithUnits                 // 除以纯数
  divBy(rhs: ValueWithUnits): number             // 比值（要求 spec 相等）→ 纯数
  pow(n: number): ValueWithUnits                 // precondition：各项指数 × n 均为整数
  as(unit: ValueWithUnits): number               // 提取为指定单位的数值；量纲须与 unit 一致
  eqZero(eps?: ValueWithUnits): boolean          // eps 量纲须与 this 一致；缺省按基准量级
}
```

常量（`units.ts`，类比 `units.fs:145-169`，基准 = mm / 度）——**两个投影，同一真源**：

```ts
// 基准 = mm / 度（与 Onshape 的 meter / radian 不同，数值不得照抄 units.fs；见 §1 警告）
// ① 类型化常量（ValueWithUnits）：量纲安全运算、容差常量（D6）用
const mm     = new ValueWithUnits(1, LENGTH)
const centimeter = new ValueWithUnits(10, LENGTH)
const meter  = new ValueWithUnits(1000, LENGTH)                  // 1 m = 1000 mm
const micron = new ValueWithUnits(0.001, LENGTH)                 // 3MF 枚举之一
const inch   = new ValueWithUnits(25.4, LENGTH)                  // 1 in = 25.4 mm
const foot   = new ValueWithUnits(304.8, LENGTH)
const yard   = new ValueWithUnits(914.4, LENGTH)
const degree = new ValueWithUnits(1, ANGLE)                      // 基准
const radian = new ValueWithUnits(180 / Math.PI, ANGLE)

// ② 纯数常量（number）：TS 库面写几何调用用（D4），等价于脚本面裸常量
const MM = 1, CM = 10, M = 1000, MICRON = 0.001, INCH = 25.4, FOOT = 304.8, YARD = 914.4
const DEGREE = 1, RADIAN = 180 / Math.PI
```

关键不变量：**任何 `ValueWithUnits.value` 永远是基准单位数值**。`inch.mul(2).value` 是 `50.8`（mm），量纲是 `LENGTH`。不存在"这个值记得自己是英寸"——换算只在构造（`* inch` / `inch.mul`）与提取（`.as(mm)` / 纯数常量）两个边界发生。这直接否定了"给 Shape 贴源单位标签"的做法。

**接口要点**：`div` 不返回联合类型（联合返回对调用方不可用），拆成 `div(n: number): ValueWithUnits` 与 `divBy(rhs: ValueWithUnits): number`。

### D4 — 几何 API 参数是裸 number；`ValueWithUnits` 只活在 TS 库面（裁定 2）

**裁定（用户 2026-09-28 授权本方案判定）：不做 op/几何 API 参数的 `ValueWithUnits` 化。**

1. **几何入参边界一律裸 `number`（基准单位：mm / 度）**。适用于 op（`defineOp` / `compatOp`）、L3 库函数、`Sketcher`/`Blueprint` DSL——**全部**。
2. **不加参数联合类型、不做兼容重载、不在 op 入口做 `isLength` 运行时断言**。
3. **脚本面（`.fai.js`）不带任何单位类型**：单位常量是裸 number，量纲只存在于名字里；量纲安全由 D8 的静态校验给。
4. **TS 库面提供单位类型系统**，但用途穷举为四处：① **I/O 边界**（D5/D10：`importFile` 的 `opts.unit`、3MF 解析内部）② **容差/阈值常量**（D6）③ **库面单位运算与显式剥离**（`inch.mul(10).as(mm)`）④ **宿主工程元数据**（3d_editor `sourceUnit`、导出反算）。

**理由**：解释器只有一层入口（`evalCall` 直接 `fn.apply`，见 §2.5），同一份 op 实现同时服务脚本面与 TS 面。参数类型一旦带 `ValueWithUnits`，裸 number 就从"越界"变成"类型许可"，而脚本面又永远只能传裸值——**类型系统恰好在它唯一该拦的位置失效**，等于装饰。运行时也无从强制（`ValueWithUnits` 在 JS 里只是个对象）。

**被否决的四种做法（第三方不要实现）**：

| ✗ 做法 | 否决理由 |
|---|---|
| op 参数类型改成 `number \| ValueWithUnits` | 裸 number 变类型许可 → 类型检查失效（上面理由）；且引入运行时分支 |
| 为 TS 面单开一套 `ValueWithUnits` op 签名（双签名/双入口） | 与"符号一份实现多处投影、同库不准两份"冲突；两面许可集不一致 |
| op 入口 `isLength(...)` 运行时断言 | 运行时是 JS 裸值，断言只对 TS 面有效、对脚本面无效；量纲不匹配的加减运行时根本看不见 |
| 给 `Shape` 贴单位标签 | 见 D3 基准不变量 |

**TS 库面写几何调用的唯一姿势**（纯数常量，零新机制）：

```ts
import { INCH, MM } from '@faicad/faijs/units'
const L = 10 * INCH                     // 254（基准 mm），类型就是 number
cad.box({ size: [L, 20 * MM, 30 * MM] })
```

需要量纲安全时用类型化常量并**显式剥离**：`inch.mul(10).as(mm)`。

**TS 面量纲安全是显式非目标**：不校验 op 调用的量纲。将来若要做，只能是"另建一层类型化 façade"（独立的类型化包裹层），**不是**在现有 op 签名上打补丁。

### D5 — I/O 边界换算（单位进出的唯一位置）

| 格式 | 单位元数据 | 处理 |
|---|---|---|
| STL | 无 | `importFile(buffer, 'stl', { unit })` 显式声明；**缺省 mm**，不做启发式猜测 |
| 3MF | `<model unit>`（合法枚举 **micron / millimeter / centimeter / inch / foot / meter**，实测于 3d_editor `file-formats.ts:412`；缺省 millimeter） | 由 faijs 侧 3MF 解析读取 `unit` → 坐标 `× UNIT_SCALE[unit]` 得 mm 基准；取到枚举外的未知值 → **抛错**（不静默回退 millimeter）。故 §5.1 的 `UnitName` 必须含这六个键 |
| FCStd | `UNIT_TO_MM`（`fcstd/src/expressions.ts:19-28`） | 收敛到本系统 `units.ts` 常量。**注意**：该表现混长度与角度且以 `deg:1/rad:1` 表示"角度保留自身单位"（`:16` 注释），收敛时**角度必须走独立分支**，不得直接套用长度换算（否则 `10 deg` 会从 10 变成 0.1745） |
| STEP/BREP | STEP `SI_UNIT` + OCCT 内核 | faijs 不换算，继续交内核解释 |
| cq-warehouse | `INCH = 25.4`（`measure.ts:12`、`params.ts:229`、**`sprocket.ts:63`**） | 三处收敛到 `inch` 常量（`sprocket.ts` 的重复定义必须一并删除） |

所有换算收敛到 `units.ts` 一处常量。

**3MF 解析的归属边界（并行工作，2026-09-28 实测存在）**：`3d_editor` 侧同日另有一份方案（`3d_editor/docs/plans/2026-09-28-zip-lib-unify-and-threemf-in-faijs-design.md`），其目标是把 3MF 几何解析归还 faijs（`cad.load({ format: '3mf' })` 产出真实几何），并让两仓库的 ZIP 实现收敛到同一个 npm 包（3MF 本身就是 ZIP/OPC 容器）。**本方案不引用该文档的内容、不以其为设计依据**（它的现状断言同样要按代码核）；只声明一条边界：**faijs 侧 3MF 解析只允许一份实现**——本文 P3 的 `parse3mf` 与它必须是同一份代码。两份文档若对同一函数描述不一致，**以代码为准并同步两处**。

**注意 `opts.unit` 与系统显示单位（D10）是两个不同概念**：前者是"这份文件里的数字是什么单位"（输入单位），后者是"界面上按什么单位显示/生成"（显示单位）。不得混用同一配置项。

### D6 — 阈值/容差常量单位化（逐个保留语义）

`§2.2` 的裸值**不是一类东西**，不能用同一个常量替换。按实测语义分别定义：

```ts
// tolerance.ts（或并入 units.ts）
export const ZERO_LENGTH               = 1e-9 * mm   // 零判据（量级门槛，独立于 OCCT 容差）
export const SEWING_TOLERANCE          = 0.01 * mm   // occtKernel.ts:532 meshesToStep 缝合容差
export const DEFAULT_LINEAR_DEFLECTION = 0.1 * mm    // 三角化弦偏差默认值（§2.2 表 6 处）
export const CENTROID_DIST_SQ_MAX_MM2  = 100         // score.ts:36 的 mm² 门限（平方量级，见下）
export const OCTREE_BBOX_FALLBACK      = 100 * mm    // topologyExt.ts:42 兜底 bbox
```

两条硬约束：

1. **`CENTROID_DIST_SQ_MAX` 是 mm²（平方量级）**，不能写成 `(10 * mm)^2`——`^` 在 TS/JS 里对 `ValueWithUnits` 不成立，对裸 number 又会丢掉量纲。平方/开方量级常量直接以**基准单位的幂次值**给出并注释清楚（或经 `pow` 算出后取 `.as`）。
2. **`angularDeflection` 默认 0.5 是弧度**（`brep/engine/types.ts:74-76` 注释已写明），与长度容差不同量纲，本次**不并入长度常量**。

消费处 `.as(mm)` 后作为裸 float 进内核；语义可读、不再藏 mm 假设。

### D7 — 脚本面单位常量

**常量表**（脚本运行时的裸 number，值 = 相对基准的缩放系数）：

```js
mm = 1;  cm = 10;  meter = 1000;  micron = 0.001;  inch = 25.4;  foot = 304.8;  yard = 914.4
degree = 1;  radian = 180 / Math.PI          // D1.1 角度基准 = 度
gram = 1;  kilogram = 1000;  second = 1;  /* 保留位：kelvin / ampere */
```

**"登记"= 三件事，缺一不可**（"不需要运算符重载"成立，但并非"解释器零改动"——§2.6 实测 `10 * mm` 今天直接抛 `SEC_FREE_IDENT`）：

1. `lang/security-scanner.ts:145` 的 `S4_SAFE_GLOBALS` 加入全部单位常量名——判定在 `:610`（`S4_SAFE_GLOBALS.has(name)`），否则脚本里的 `inch`/`mm` 被判 `SEC_FREE_IDENT` 拒绝（`:614`），interp 后端 `env.ts:92-93` 也解析不到。
2. 在 `globalThis` 上注册这些常量（vm 后端与 interp 后端共用；interp 从 `globalThis[name]` 取值，`env.ts:93`）。
3. 把单位常量名并进 `UiMetadata.names` / `knownNames`——否则 3d_editor 参数表达式实时校验（`lang/expr-validate.ts`，Identifier 必须命中 knownNames）会把 `10 * inch` 判成 `E_REFERENCE`；解析侧 `collectExprIdentifiers`（`metadata-extractor.ts:362-383`）也会对未知标识符抛 `E_REFERENCE`。

**只读保护（必须实现，否则是正确性漏洞）**：`InterpEnv.assign` 根作用域写 `ctx`（`env.ts:104-118`），而 `lookup` 顺序是 ctx → ns → globals——**脚本写 `inch = 999` 会污染 ctx 并永久遮蔽基准常量**。现无任何规则阻止（只有 `SEC_NS_ASSIGN` 管命名空间，`security-scanner.ts:649`）。对策：在 `security-scanner.ts` 新增规则 `SEC_RESERVED_ASSIGN`，拒绝把保留单位名作为**赋值目标**或**声明名**（`let/const/var/参数/函数名`）；规则位于 `assertSecure`（`:863`）内，故 metadata 通道（`metadata-extractor.ts:1021`）与执行通道（`direct-executor.ts:757`、`module-registry.ts:216`）**同时生效**，两个执行后端行为一致。

**语法**：

```js
cad.fai_extrude({ length: 10 * inch })
cad.box({ size: [20 * mm, 30 * mm, 40 * mm] })
cad.rotate_euler(part0, { angles: 45 * degree })     // 参数名见 D9
```

**基准单位也写单位字面量**：`10 * mm` 是规范形态，裸 `10` 不合法（用户原话：「不许分析也知道裸数字3是不合法的。必须是数字带量纲。」）——这是 D8 R2 与 D10 序列化规则的共同来源，也是 P6 存量迁移的原因。

### D8 — 静态量纲校验（新增 `dimension` 校验 stage）

**插入点（实测）**：现有校验唯一入口是 `extractMetadata`，`CadRuntime.check()`（`runtime.ts:1376-1403`）与 `execute()`（`:714`）都经它。校验实现为 `extractMetadata` 内部的一个 pass，并**扩展 `runtime.ts:73` 的 stage 联合类型，新增 `'dimension'`**。这样 CLI `check`（`node-host/cli.ts:227`）与 UI 元数据通道同时生效。

**判定输入必须是 AST 节点，必须在折叠之前**：`parseValueExpr`（`metadata-extractor.ts:492`）先折叠（`:508-513`）、折叠失败才走 expr-ref（`:515-526`）；而 §2.6 实测 `10 * mm` 在 `codeToArgs` 路径会被折叠成 `0`——折叠值里**不含任何量纲信息**。故 `checkDim(node, declaredDim, ctx)` 在 `parseValueExpr` 入口对每个 arg 节点先跑（与 `parseValueExpr` 共用同一份 dims 声明），结果不依赖折叠。

**声明来源（两条路都要）**：

| op 来源 | 声明位置 |
|---|---|
| 生成式脚本面 op（box/fuse/rotate_euler…） | `api/surface/arg-spec.ts` 的 `ArgSpecEntry` 新增 `paramDims?: Record<string, DimName>` / `retDim?: DimName`；由 `packages/core/scripts/gen-l3-surface.ts` 透传进 `defineOp` 与 `script-face-manifest.ts` |
| 手写 op（`packages/faijs-extra/src/ops/*.ts`、core 内手写 `defineOp`） | `defineOp` 的声明对象新增 `paramDims`；`DualOpMeta`（`define-op.ts:151-166`）新增同名字段 |

**两种调用形态都要覆盖**：对象形态按 key 取声明；位置形态按 `slotMap.keys`/`vec3Keys`/`shapeArity`（`api/internal/dual-form-args.ts:210-228`）映射到同一份声明。即 `box(10, 20, 30)` 与 `box({size:[10,20,30]})` 必须**判罚一致**。vec3/数组参数逐元素校验。

**校验器怎么拿到声明（分层关键）**：`lang/` 不得依赖 op 注册表。实测 `extractMetadata` 的选项类型 `ExtractMetadataOptions`（`metadata-extractor.ts:985-998`）现有 `defaultNs`/`looseVars`/`looseLocalCalls`/`namespaces`/`security`/`nsNames`，**新增 `opDims?: Record<string, { paramDims?: Record<string, DimName>; retDim?: DimName }>`**（键 = 脚本面 callee 名，含命名空间内成员名），由调用方注入：

| 调用方 | dims 来源 |
|---|---|
| `CadRuntime.check()` / `execute()`（`runtime.ts:1376` / `:714`） | 运行时汇总已注册 op：op meta 挂在函数对象的 `DUAL_OP_META`（`define-op.ts:169`）上；建议在 `define-op.ts` 新增导出访问器 `dualOpMetaOf(fn)`（现只有内部读取点 `:455`）供 runtime 使用，再拼成 `opDims` 传入 |
| CLI `check`（`node-host/cli.ts:227`） | 同上（经 runtime）或直接读 `api/generated/script-face-manifest.ts` |
| `codeToArgs`（`code-to-args.ts:118` 内部调 `extractMetadata`） | 同一份 `opDims` 必须透传，否则单行回填路径完全不校验 |

**未传 `opDims` = 完全不校验**（等价于所有参数无量纲，即"静默失效"）。因此必须有一条**端到端**测试锁住接线（`check()` 对受管 op 的裸长度必须真的报错），不能只单测 `checkDim`。

**豁免规则**：**未声明 `paramDims` 的参数 = 无量纲，不受任何限制**。这条必须有，因为实测存在大量无量纲数值参数（3d_editor `knurl` 的 `knurlScaleU/V`、`knurlMappingMode`；`primitive` 的通用 number 透传含 `segments`/`center` 等）。

**判定规则（AST 模式匹配 + 常量查表，不做类型推导）**：

| 编号 | 规则 |
|---|---|
| R1 | 有量纲位的实参，其表达式必须能静态判定为「带该量纲」 |
| R2 | **裸数字字面量**直接传给有量纲位 → `E_DIM_BARE_NUMBER`。**基准单位形式也必须有单位**（`10 * mm` 合法、`10` 不合法） |
| R3 | `+`/`-`/比较运算两侧可判定量纲时必须一致 → 否则 `E_DIM_MISMATCH`（如 `3 * meter + 1 * degree`） |
| R4 | 量纲传播：`number * unitConst` → 取该常量量纲；`lengthValue * number` / `lengthValue / number` → 保持；`len / len` → 无量纲；`len * len` → 指数相加 |
| R5 | **无法静态判定**的表达式（变量引用、**未声明 `retDim` 的**函数调用结果、下标访问）→ **放行**（不阻塞）：其来源可能在 TS 面已有量纲。这是"宁可漏判不可误判"的取舍，与 D4「几何入参是裸 number」一致。**判定顺序：先查 `retDim`，命中即按 R4 传播并参与 R1/R3 判定；未命中才放行** |
| R6 | 单位常量名不在 `UNIT_SCALE` 表中（拼错/未注册）→ `E_DIM_UNKNOWN_UNIT`（安全规则已先挡 `SEC_FREE_IDENT`，此处是兜底） |

**返回值量纲**：查询类 op 的返回值（`cad.volume` → length³、`cad.area` → length²、`cad.length` → length、`cad.centerOfMass` → length）由同一机制的 `retDim` 声明，使 `cad.volume(p) / cad.area(p)` 这类表达式可被 R4 推导校验（**`retDim` 命中优先于 R5 放行**，否则"声明了却不生效"）。

**错误码**（挂 `stage: 'dimension'`，随 `CheckResult.errors` 结构化返回，UI 可直接展示）：

| 错误码 | 含义 |
|---|---|
| `E_DIM_BARE_NUMBER` | 有量纲位收到裸数字字面量 |
| `E_DIM_MISMATCH` | 可判定量纲的两侧量纲不一致 |
| `E_DIM_UNKNOWN_UNIT` | 单位常量名不在表中 |
| `SEC_RESERVED_ASSIGN`（security stage） | 单位保留名被赋值/声明 |

### D9 — 参数命名：值自带单位后，名字不再内嵌单位（breaking）

"值自带单位"作为唯一真源后，参数名再内嵌单位就是双重记账。脚本面/TS 面参数名一律去单位后缀：

| 现名 | 新名 | 位置（实测） |
|---|---|---|
| `anglesDeg` | `angles` | `api/transform.ts:226-245`、`mesh/types.ts:191`、`mesh/api.d.ts:36`（生成文件）、`api/generated/*` |
| `depth_mm` | `depth` | 3d_editor `engrave.ts:32`（faijs op 侧本身已是 `depth`） |
| `pressureAngleDeg` | `pressureAngle` | `packages/fai_cq_gears`、`packages/sketch` |
| `inPlaneAngleDeg` | `inPlaneAngle` | 3d_editor `features/fai_split.ts:56` |

**这是 breaking change**（faijs 未上线，不做兼容重载），实施时必须同步：`slotMap` / `schema` / `arg-spec.ts` / 手写 `defineOp` 文档注释 / **重跑 `npx tsx packages/core/scripts/gen-api-dts.ts` 生成 `mesh/api.d.ts`（该文件禁止手改，见 AGENTS.md）** / `npm run doc-sync` 的 `check-ops-api-inventory` / 3d_editor 的 `features/*.ts` 与 `scene-kernel` 的 `statement-builders`。

### D10 — 序列化携带系统显示单位（裁定 3，新增）

#### D10.1 概念

- **系统显示单位（system display unit）**：`UnitContext = { length: UnitName; angle: UnitName }`，缺省 `BASE_UNITS = { length: 'mm', angle: 'degree' }`。由**宿主持有**（3d_editor 工程设置）。
- **faijs 不持有全局单位状态**：`UnitContext` 只能作为显式参数传入序列化入口。禁止模块级"当前单位"单例（会跨工程/跨测试串味）。
- **系统单位不影响几何**：`Shape` 坐标恒为 mm 基准、角度恒为度基准。它只影响三件事：① 界面显示值 ② 生成脚本的字面量形态 ③ 导出反算。

#### D10.2 三条硬不变量

1. **基准值是真源，文本是投影**：单位切换 = 用宿主自己的**基准值**重新投影文本。**禁止**文本级乘除实现（对已带单位的字面量再乘 25.4 会重复换算）。
2. **切换幂等**：`mm → inch → mm` 后文本必须与初始逐字节一致；`n` 次切换与 1 次切换结果相同。
3. **几何零漂移**：文本往返的数值误差 ≤ 1e-12 相对量级（远小于 `ZERO_LENGTH = 1e-9 mm`）。

#### D10.3 `formatCodeLine` 新签名

```ts
export interface UnitSerializeOptions {
  /** 系统显示单位；缺省 = 基准（mm / degree） */
  units?: UnitContext
  /** 参数量纲声明（宿主从 op 的 paramDims + slotMap / script-face-manifest 取） */
  dims?: { positional?: (DimName | null)[]; byKey?: Record<string, DimName> }
}
export function formatCodeLine(input: FormatCodeLineInput, opts?: UnitSerializeOptions): string
```

行为（逐条可实现、可测试）：

1. **`opts` 缺省时，输出与现状逐字节相同**（不追加任何单位字面量）——存量调用方与测试零影响。
2. 传了 `dims`：命中量纲的参数值（含 vec3/数组**逐元素**）输出为 `n * <单位常量名>`；`n = fromBase(base, unitName, dim)`，`unitName = unitFor(dim, units)`。
3. **基准单位同样写单位字面量**（`{ length: 10 * mm }`，不写裸 `10`）——D8 R2 的直接要求。故脚本里 mm 值与 inch 值可共存：**混合单位脚本合法**（单位随值携带）。
4. 未声明量纲的参数永远原样输出（无量纲）。
5. **单位字面量的数字必须用 JS 最短往返表示**（`String(n)`，如 `0.39370078740157477`），**禁止用 `fmtNum`**（`codegen.ts:34-39`，实测 `fmtNum(1e-7) === '0'` 会静默归零）。无量纲数仍走 `fmtNum`（存量行为不变）。
6. 字面量形态：`{ kind: 'expr-ref', text: '10 * inch', refs: [], params: [] }`——复用第 4 种 kind，**不扩 kind 集**（`HOST_REF_KINDS` 契约不变）。`HostExprRef` 增加可选 `bare?: boolean`（`true` → 不加括号）：`fmtValue`（`codegen.ts:79`）现对 expr-ref 无条件加括号（实测 `{ length:(10 * inch) }`），合法但含糊，机器生成的单位字面量应走 `bare`。

#### D10.4 `codeToArgs` 反解析（必须修真缺陷）

现状（§2.6 实测）：`codeToArgs('…{ length: 10 * inch }')` → `{ length: 0 }`。三处必修：

| 落点 | 修法 |
|---|---|
| `code-to-args.ts:43-53 extractIdentifiers` | 把单位常量名从**前置声明**（`let <id> = 0`）中排除——单位名不是待解变量 |
| `metadata-extractor.ts:200-204`（`tryFoldConstExpr` 的 Identifier 分支） | 识别单位常量 → 返回 `UNIT_SCALE[name]`；同时置新标记 `usedUnit = true` |
| `metadata-extractor.ts:511`（`computed` 判定） | 改为 `usedParam \|\| usedUnit` → 宿主对含单位字面量的行走**只读降级**，绝不允许把折叠值写回源码（否则 `10 * inch` 会被写成 `254`，在 inch 场景下变成 254 in） |
| `metadata-extractor.ts:362-383 collectExprIdentifiers` | 单位常量登记进符号表的"已声明常量"集合，归入 `refs` 而非抛 `E_REFERENCE` |

修好后：`codeToArgs('…{ length: 10 * inch }')` → `{ length: 254 }`（基准 mm）；宿主显示 `fromBase(254, 'inch', 'length') === 10`。**必须有 `!== 0` 的防回归断言**。

#### D10.5 宿主（3d_editor）侧约定

- 面板数值 = `fromBase(基准值, units[dim], dim)`；面板输入 → `toBase(输入值, units[dim], dim)`。
- 单位切换：**只重投影宿主自己生成的行**（用宿主基准参数模型）；用户手写的行不改写（混合单位合法）。切换后必须重新 `check()`。
- 导出：`sourceUnit` 元数据（"这份文件本来是英寸"）保留，导出反算用 `fromBase`。

---

## 5. 对外 API 契约

### 5.1 `@faicad/faijs/units`（新增 exports 条目）

`packages/core/package.json` 的 `exports` 新增 `"./units"`（与既有条目同格式：`types` + `default` 指向 `./dist/units.*`）。同批必须处理：

- `packages/core/src/units.ts` 落在 `tsconfig.build.json` 的 include 范围（`src/**`，无需额外改动）。
- `packages/core/src/units.test.ts`（与源码同目录，符合仓库测试分布约定）。
- `scripts/check-ghost-deps.mjs`：`units.ts` 若引入新依赖必须声明在 `packages/core/package.json`。
- `scripts/check-dep-lockstep.mjs`：本包版本号变化时 `@faicad/*` 下游 range 必须同步。
- **`scripts/api-surface-snapshot.mjs`（CI 5/9 实际会跑）**：该脚本内**硬编码**了一份可整体 import 的 `SUBPATHS` 数组（18 项），新增子路径 **必须**把 `'./units'` 加进该数组，否则新子路径不进导出面快照（静默不覆盖）；改完 `npm run build` 后重跑脚本刷新 `scripts/api-surface-snapshot.json`（该文件入库，会进 git diff 供 review）。
- **`npx madge --circular packages/core/src packages/faijs-extra/src`（CI 5/9）**：D10 引入的 `lang/codegen.ts → units.ts` 依赖必须无环（`units.ts` 不得反向 import `lang/` 或任何注册表）。
- **`node scripts/check-platform-imports.mjs`（CI 5/9）**：`units.ts` 是中立模块，**不得 import `occt-kernel/*` / `brepkit-kernel/*`**（否则拖入 wasm 链、小程序 bundle 404）。
- `npm run doc-sync` 全量门禁（含 `verify-export-jsdoc`：新增导出必须补 JSDoc）。

```ts
export type BaseDimension = 'length' | 'angle' | 'mass' | 'temperature' | 'time' | 'current'
export type DimName = BaseDimension
/** 单位名。`micron/mm/cm/m/inch/foot/meter` 六个键是 3MF `<model unit>` 的合法枚举（D5），必须全部在表内 */
export type UnitName =
  | 'mm' | 'cm' | 'm' | 'micron' | 'inch' | 'foot' | 'yard'
  | 'degree' | 'radian' | 'gram' | 'kilogram' | 'second'
export type UnitSpec = Readonly<Partial<Record<BaseDimension, number>>>

export class ValueWithUnits { /* 见 D3 */ }

/** 量纲常量 */
export const LENGTH: UnitSpec, AREA: UnitSpec, VOLUME: UnitSpec, ANGLE: UnitSpec, MASS: UnitSpec, TIME: UnitSpec

/** ① 类型化常量（ValueWithUnits） */
export const mm, centimeter, meter, micron, inch, foot, yard: ValueWithUnits
export const degree, radian: ValueWithUnits
export const gram, kilogram, second: ValueWithUnits

/** ② 纯数常量（number）= 相对基准的缩放系数；TS 库面写几何调用用（D4） */
export const MM: number, CM: number, M: number, MICRON: number, INCH: number, FOOT: number, YARD: number
export const DEGREE: number, RADIAN: number

/** 单一真源表（脚本常量、序列化、静态校验共用） */
export const UNIT_SCALE: Readonly<Record<UnitName, number>>   // 名 → 基准缩放系数
export const UNIT_DIM: Readonly<Record<UnitName, DimName>>     // 名 → 量纲名
export const UNIT_DIMS: Readonly<Record<UnitName, UnitSpec>>   // 派生：名 → UnitSpec

/** 系统显示单位 */
export interface UnitContext { length: UnitName; angle: UnitName }
export const BASE_UNITS: UnitContext                            // { length: 'mm', angle: 'degree' }

export function unitEquals(a: UnitSpec, b: UnitSpec): boolean
export function isLength(v: ValueWithUnits): boolean
export function isAngle(v: ValueWithUnits): boolean
export function specOfDim(dim: DimName): UnitSpec
export function unitFor(dim: DimName, ctx?: UnitContext): UnitName   // ctx 缺省 → 基准单位
export function unitScale(name: UnitName): number                    // = UNIT_SCALE[name]
export function toBase(n: number, unitName: UnitName, dim: DimName): number
export function fromBase(base: number, unitName: UnitName, dim: DimName): number
```

错误约定：量纲不匹配的 `add`/`sub`/`as`/`divBy` 直接 throw（携带两个量纲的上下文），不做隐式换算或降级。

**单一真源**：`UNIT_SCALE` + `UNIT_DIM` 是唯一数据源；`UNIT_DIMS`、类型化常量、纯数常量、脚本常量表（D7）、序列化（D10）、静态校验（D8）全部从它派生（投影，允许；复制另一份表，禁止）。

### 5.2 `@faicad/faijs/mesh` 的 `importFile`（修改）

现状是 `mesh/io.ts:21` 的 `importFile(buffer, format?)`（仅 STL）。目标签名：

```ts
export async function importFile(
  buffer: ArrayBuffer,
  format?: string,
  opts?: { unit?: ValueWithUnits },   // STL 等无元数据格式显式声明；缺省 mm
): Promise<Shape>
```

`Shape` 的 `positions`/`indices` 永远以 mm 基准存储，**不新增 `unit` 字段**（见 D3 不变量）。3MF 分支读 `<model unit>` 后在边界换算，其余 op 全链路无需感知单位。

### 5.3 序列化/反解析契约（D10）

```ts
// lang/codegen.ts（L0；依赖方向：codegen.ts → units.ts，units.ts 是零依赖叶子，无环）
export function formatCodeLine(input: FormatCodeLineInput, opts?: UnitSerializeOptions): string
/** 单位字面量的数字格式化：JS 最短往返表示（String(n)），禁止用 fmtNum */
export function fmtUnitNum(n: number): string
/** 基准值 → 单位字面量文本（`10 * inch`）；dim 用于校验单位名合法 */
export function formatUnitLiteral(base: number, dim: DimName, unitName: UnitName): string

// lang/code-to-args.ts
export function codeToArgs(codeLine: string, opts?: { namespaces?: string[] }): CodeToArgsResult
/** 单位字面量文本 → 基准值；非单位字面量返回 null（宿主据此决定是否降级） */
export function parseUnitLiteral(text: string): { base: number; dim: DimName; unitName: UnitName } | null
```

### 5.4 脚本面契约

- 单位常量是**全局只读裸标识符**（`mm`/`inch`/`degree`…），不得被声明或赋值遮蔽（`SEC_RESERVED_ASSIGN`）。
- `10 * inch === 254`（普通 JS 乘法，vm 与 interp 后端行为一致）。
- 有量纲参数拒绝裸数字（**含基准单位裸数字**）；量纲不匹配的加减被拒；判罚与调用形态无关（对象/位置形态一致）。
- 脚本里单位可混用（`10 * mm + 1 * inch` 合法，R3 只要求两侧量纲一致）。

---

## 6. 实施阶段

faijs 版本 **`0.19.0` → `0.20.0`**（实测当前 `packages/core/package.json` 为 `0.19.0`）。严格遵循 faijs 先做再发布 → 3d_editor 升版本的流程，不允许并行。

**P0. 角度基准裁定 —— 已完成**（用户裁定：度，见 D1.1）。P1 起按度实施。

**P1. `packages/core/src/units.ts`（新）+ `packages/core/src/units.test.ts`**
- `UnitSpec`、`ValueWithUnits`、量纲谓词、`UNIT_SCALE`/`UNIT_DIM`/`UNIT_DIMS`、两个投影的常量、`UnitContext`/`toBase`/`fromBase`/`unitFor`。
- `package.json` 补 `"./units"`；补齐 §5.1 的门禁项。

**P2. 阈值/容差单位化（D6）**
- 按 `§2.2` 逐条替换为带语义的常量，消费处 `.as(mm)`。
- 平方量级常量按 D6 硬约束 1 处理。

**P3. I/O 边界收敛（D5）**
- 删除 `fcstd/expressions.ts` 与 `fai_cq_warehouse` 的本地换算表（**含 `sprocket.ts:63` 的重复 `INCH`**），引用 `@faicad/faijs/units`；角度分支独立处理。
- 新增 3MF 解析（含 `<model unit>` → mm 基准），接入 `importFile`；STL 走 `opts.unit`。**必须先解 ZIP 条目再读 `3D/3dmodel.model` 的 XML**——3d_editor 现有的"扫前 2048 字节原始 buffer"做法无效（§2.4 实测）。

**P4. `paramDims`/`retDim` 声明面（D8 的声明面）**
- `ArgSpecEntry` 增 `paramDims`/`retDim`；`gen-l3-surface.ts` 透传进 `defineOp` 与 `script-face-manifest.ts`；`DualOpMeta`（`define-op.ts:151-166`）增字段。
- 手写 op 侧（`packages/faijs-extra/src/ops/*.ts`、core 手写 op）同样补声明。
- `define-op.ts` 新增导出访问器 `dualOpMetaOf(fn)`（现只有内部读取点 `:455`）；`ExtractMetadataOptions`（`metadata-extractor.ts:985`）新增 `opDims`，并在 `CadRuntime.check()/execute()`、CLI `check`、`codeToArgs` **三处**透传（D8「校验器怎么拿到声明」）。
- 重跑 `gen-l3-surface.ts` 与 `gen-api-dts.ts`（若签名有变），跑 `check-ops-api-inventory`。

**P5. 存量脚本迁移（新增，R2 的必然代价）**
- 范围（实测）：仓库内 **393 个 `.fai.js`**（`find packages docs -name "*.fai.js" -not -path "*/node_modules/*"`）+ `docs/ops-api-inventory.md` 等文内示例（双语配对文档改示例须同步 `.zh.md` 与 `.i18n.yaml`，过 `doc-sync`）。
- 取声明：经 `dualOpMetaOf(fn)` 遍历已注册 op（或直接读 `api/generated/script-face-manifest.ts`）得到 `callee → { paramDims, slotMap }`；解析用 `acorn.parse`（与 `metadata-extractor.ts:18` 同款）。
- 做法：把有量纲实参包成 `( <原表达式> ) * mm`；**基于节点 `start`/`end` 做文本插入**，不整行重打印（避免 F1 折叠损失表达式）。
- 语义安全性：裸值 ≡ 基准值（`10` ≡ `10 * mm`），插入不改几何；且**不依赖 `paramDims` 完整性**（漏声明的参数不被包裹，语义仍不变；只是不被校验）。
- 验收（分两截，**顺序不可颠倒**）：① P5 当轮：`npm run test --workspaces` 全绿（语义不变）+ codemod 重跑无 diff（幂等）；② **P6 完成后**：对全部迁移文件跑 `check`，无 `E_DIM_BARE_NUMBER`（该校验 P6 才存在，不得提前作为 P5 的门槛）。codemod 脚本保留在 `scripts/`（可重跑、可审计）。

**P6. 脚本单位常量 + 只读 + 静态量纲校验（D7/D8）**
- `S4_SAFE_GLOBALS` 白名单 + `globalThis` 注册 + `UiMetadata.names` 暴露（三处）。
- 新增 `SEC_RESERVED_ASSIGN` 规则（赋值/声明保留名）。
- `extractMetadata` 内新增 `dimension` pass（挂在 `parseValueExpr` 入口、折叠之前）；`runtime.ts:73` 的 stage 联合加 `'dimension'`；错误码见 D8。
- `opDims` 端到端接线（`check()` 真能报错）+ 位置/对象两形态判罚一致。

**P7. 序列化 / 反解析（D10）**
- `formatCodeLine` 第二参数 `UnitSerializeOptions`；`fmtUnitNum`；`formatUnitLiteral`；`HostExprRef.bare`。
- `codeToArgs` 三处修正（前置声明排除、单位常量折叠、computed 置位）+ `parseUnitLiteral`。
- **归属（实测）**：`formatCodeLine`（`lang/codegen.ts:137`）与 `codeToArgs`（`lang/code-to-args.ts:109`）**都在 faijs**，经 `@faicad/faijs/env-agnostic` 暴露；3d_editor 的 `statement-builders.ts` 只是调用方。序列化/反解析**在 faijs 侧实现**。

**P8. `npm run pack` + 3d_editor 升版本**（见 §9-G 顺序）。

---

## 7. 测试策略与不变量

分层执行，**严禁直接跑 CI 找 bug**（AGENTS.md：跑完一次 CI 后只重跑失败项）：

1. `npx vitest run <单位系统相关单测>`
2. `npx tsc --noEmit`
3. `npm run lint`
4. faijs 全量单测（受影响 op）
5. 全部通过后才 `pwsh -NoProfile scripts/ci.ps1`

**必须落成可重复执行的测试文件**（AGENTS.md「关键验证必须保留为可重复执行的测试代码」）：

| 文件 | 内容 |
|---|---|
| `packages/core/src/units.test.ts`（新） | 基准不变量、量纲抛错、复合量纲、`pow`/`divBy`/`eqZero`、`UNIT_SCALE`/`UNIT_DIM`/`UNIT_DIMS` 三表一致、`radian === 180/Math.PI`、`toBase`/`fromBase` 互逆 |
| `packages/core/src/lang/dimension-check.test.ts`（新） | R1–R6 全部规则；**位置形态与对象形态判罚一致**；无量纲参数豁免；`10`（裸）被拒、`10 * mm` 通过 |
| `packages/core/src/lang/security-scanner.test.ts`（追加） | `SEC_RESERVED_ASSIGN`：`inch = 999`、`let mm = 3` 均被拒 |
| `packages/core/src/lang/codegen-units.test.ts`（新） | ① **缺省 opts → 与现状逐字节相同**（回归）② `units={length:'inch'}` → `10 * inch` ③ 基准单位 → `10 * mm` ④ vec3 逐元素 ⑤ 无量纲不追加 ⑥ `fmtUnitNum(1e-7) === '1e-7'`（**防静默归零**） |
| `packages/core/src/lang/code-to-args-units.test.ts`（新） | ① `{length: 10 * inch}` → **254（`!== 0` 断言，`GOTCHA:` 标注旧投影为 0）** ② `10 * mm` → 10 ③ `10 * mm + 2 * mm` → 12 ④ 含单位字面量的行 `hasComputedArgs === true`（宿主只读降级） |
| `packages/core/src/lang/unit-roundtrip.test.ts`（新） | `base → formatCodeLine(units=u) → codeToArgs → base'`，三档单位（mm/inch/meter）相对误差 ≤ 1e-12；**单位切换幂等**（mm→inch→mm 文本恒等） |
| `packages/core/src/cad-runtime/check.test.ts`（追加） | ① `check()` 返回 `stage:'dimension'` ② **端到端接线断言**：`check('let p0 = cad.box({size:[10,20,30]})')` 必须报 `E_DIM_BARE_NUMBER`（证明 `opDims` 真的接到了 `extractMetadata`，不是只单测过 `checkDim`） |
| `packages/core/src/mesh/io.test.ts`（追加） | `importFile(buf,'stl',{unit:inch})` 坐标 ×25.4；3MF 六个合法枚举各测一遍（**含 `micron`**）→ 坐标按对应系数换算；枚举外未知值 **抛错**（不静默回退 millimeter） |
| `packages/faijs-extra/src/ops/*.test.ts`（追加） | 手写 op 的 `paramDims` 声明生效（`fai_extrude` 的 `length` 裸数字被拒） |
| `packages/fcstd/src/expressions.test.ts`（追加） | 收敛到 `units.ts` 后 `evalConstantExpression` 语义不变（含角度分支） |

**必须固化的不变量**：

- **基准不变量**：任何 `ValueWithUnits.value` 都是基准单位数值——用 `inch.mul(2).value === 25.4 * 2` 锁死。
- **量纲不匹配抛错不变量**：`(1*meter).add(1*degree)` throw。
- **单一换算真源不变量**：grep 确认 `fcstd`、`fai_cq_warehouse`（含 `sprocket.ts`）不再有本地 `UNIT_TO_MM`/`INCH` 换算表。
- **脚本常量不可遮蔽不变量**：`inch = 999` 在扫描期即被拒；`10 * inch` 在脚本执行后仍 === 254。
- **静默失败禁止**：有量纲参数收到裸数字必须是**错误**（`E_DIM_BARE_NUMBER`），不得只 warn。
- **序列化零行为变化不变量**：不传 `UnitSerializeOptions` 时 `formatCodeLine` 输出与改造前逐字节相同。
- **往返零漂移不变量**：单位切换幂等 + 往返误差 ≤ 1e-12 相对量级。
- **单位状态无全局不变量**：`units.ts` 与 `codegen.ts` 不得导出任何可变"当前单位"状态（单测断言 `UnitContext` 只能经参数传入）。

---

## 8. 风险

| 风险 | 判据 | 应对 |
|---|---|---|
| **角度双重换算**（裁定为度后的主要残留风险） | 45° 变 0.785°（多除 57.3）或 45 变 2578°（多乘） | D1.1 三条纪律；P1 交付"角度入参清单"；测试断言 `45 * degree` 到 op 的实际数值 = 45；`fai_split.ts:45-52` 的二次换算点列入清单 |
| **存量脚本迁移误包裹**（393 个文件） | 迁移后几何变化 / 测试红 | codemod 语义安全（`x` ≡ `x * mm`）；基于 AST source range 插入避免整行重打印；迁移后全量测试 + 全文件 `check` |
| **静默归零**（`fmtNum(1e-7) === '0'`） | 极小值/切到米后长度变 0 | 单位字面量禁用 `fmtNum`，改用 `fmtUnitNum`（`String(n)`）；专用测试 |
| **`codeToArgs` 把单位字面量折叠成 0** | 回填长度显示 0 / 写回 0 几何 | D10.4 三处修正 + `!== 0` 断言 |
| **单位字面量被写回源码时丢单位** | `10 * inch` → `254`（在 inch 场景变 254 in） | `usedUnit` → `hasComputedArgs = true` → 宿主只读降级；测试断言 |
| S4 白名单放开扩大安全面 | 新增全局名可被脚本覆盖 | 同批实现 `SEC_RESERVED_ASSIGN`；两后端行为一致（规则在 `assertSecure` 内，三处调用点同时生效） |
| `paramDims` 漏声明 → 校验形同虚设 | 有量纲参数未标声明 → 永远放行 | P4 逐 op 清点；`gen-l3-surface.ts` 可加守卫（`scriptFace` op 的已知长度字段必须有声明） |
| `paramDims` 误声明 → 误判 | 无量纲参数被要求带单位（knurl scaleU/V 类） | 默认豁免、只声明确需的；D8 R5 放行规则兜底 |
| 静态校验误报打断用户编辑 | 3d_editor 输入框即时校验弹错 | `UiMetadata.names` 先包含单位常量；错误走 `CheckResult.errors` 结构化返回，不抛异常 |
| 破坏性命名（D9）波及过广 | `tsc` / 生成文件 / 3d_editor 批量报错 | 与 `anglesDeg` 清点同批做；重跑 `gen-api-dts.ts`；禁止手改生成文件 |
| 平方量级常量写法错 | `(10*mm)^2` 编译不过或丢量纲 | D6 硬约束 1 |
| `Shape` 坐标语义漂移 | 某 op 忘记在边界折算 | P3 桥接层统一收口 + 基准不变量单测 |
| 系统显示单位被做成全局状态 | 跨工程串味、测试不确定 | D10.1 明令禁止；§7 不变量单测 |

---

## 9. 与 `3d_editor` 的交接

**实测基线（2026-09-28，路径已按 3d_editor 当前结构核对）**：3d_editor 位于 `C:/my/Faicad/3d_editor`。下表的 feature 文件在 `packages/app/src/engine/features/`（**不在** `packages/scene-kernel/src/features/`）。

### A. 9 个 feature 的 `buildArgs` 改成生成单位字面量

| feature 文件（实测路径） | 实测数值参数 | 改造 |
|---|---|---|
| `.../features/fai_extrude.ts:25-27` | `length: params.extrudeLength` | 序列化 `10 * inch` |
| `.../features/primitive.ts:29-36` | `buildArgs` 是**通用循环**：所有 number/array 原样透传，op 名由调用方给（box/sphere/cylinder/cone/wedge） | 需按 op 分别给 `paramDims`；无量纲项（`segments`/`center` 等）不标 |
| `.../features/engrave.ts:32` | `depth: params.depth_mm` | 序列化 `depth * unit`；字段名去 `_mm`（D9） |
| `.../features/fillet.ts:32` | `radius`（`DEFAULT_FILLET_RADIUS`） | 同上 |
| `.../features/chamfer.ts:29` | 宽度/角度参数 | 同上（角度按 D1.1：度） |
| `.../features/fai_drill.ts:26-33` | `diameter`、`depth` | 同上 |
| `.../features/fai_split.ts:30-56` | **实测为** `offset`（切平面偏移，长度）、`normal`、`inPlaneAngleDeg`（角度）、`tenonSideLength`、`tenonSideLengthTolerance`（**"distance" 不存在**） | 长度项带单位；`normal` 无量纲方向；注意 `:45-52` 内部已有 `* Math.PI/180` 换算，读回时不得二次换算 |
| `.../features/knurl.ts:20-38` | **实测为** `knurlTextureHeight`(0.5)、`knurlScaleU/V`(0.15，**无量纲**)、`knurlInvertDisplacement`(bool)、`knurlRefineLength`(1.0)、`knurlMappingMode`(数值枚举 5)、`faceCenter`/`faceNormal`（**"pitch/diameter" 不存在**） | 仅 `knurlTextureHeight`/`knurlRefineLength`/`faceCenter` 为长度；其余必须保持无量纲 |
| `.../features/transform.ts:40-47` | **实测为** `offset`(vec3 长度)、`anglesDeg`(vec3 角度)、`factor`（**"move" 不存在**） | `offset` 带长度单位；`anglesDeg` → `angles` 带角度单位 |

配套（归属见 §6 P7）：

- **序列化原语在 faijs**：`formatCodeLine`（`packages/core/src/lang/codegen.ts:137`）+ `HostArg`（`lang/host-arg.ts`）。`n * unit` 的产出在 faijs 侧完成，`packages/scene-kernel/src/code/statement-builders.ts:16,168`（实测存在，导入自 `@faicad/faijs/env-agnostic`）作为调用方只需**多传 `{ units, dims }`**（D10.3）。
- **反解析原语也在 faijs**：`codeToArgs`（`packages/core/src/lang/code-to-args.ts:109`）识别单位常量 → 返回基准值 + `hasComputedArgs = true`（D10.4）。
- **label 显示**：`hostArgToDisplay`（`lang/host-arg.ts:264-274`）对 `expr-ref` 直接渲染 `text`，故 `10 * inch` 天然可显示；feature 内部硬编码单位后缀的文案改为按系统单位渲染。

### B. `unitScaleFactors` 桥接整体删除（最大简化收益）

| 位置（实测，路径已核对） | 当前职责 | 改造 |
|---|---|---|
| `packages/app/src/stores/core/engine-store.ts:230`、`:434-449` | `unitScaleFactors` 状态字段与读写 | 删除 |
| `packages/app/src/engine/components/renderers/ModelGroup.tsx:425-486, 714-730` | 按文件单位算 `unitScaleFactors`、`geo.scale.set(...)` | 删除（`cad.load` 返回 mm 基准后无需缩放） |
| `packages/app/src/engine/script-engine/ScriptEngine.ts:1130-1139` | `_computePartTransform` 用 `unitScaleFactors` | 删除缩放逻辑 |
| `packages/app/src/stores/serialization/undo-registrations.ts:110` | 快照字段清单含 `unitScaleFactors` | 一并清理 |

（`…/components/viewport/ModelGroup.tsx` 与 `…/engine/ScriptEngine.ts` 是重构前的旧路径，已失效。）

### C. 导入单位探测收敛

| 函数（实测） | 位置 | 改造 |
|---|---|---|
| `parse3mfUnit` | `packages/app/src/config/file-formats.ts:406` | 删除（3MF `<model unit>` 由 faijs 侧解析并换算到 mm 基准）。**别照抄它**：它只扫前 2048 字节原始 buffer（`:407-409`），对 deflate 压缩的真实 3MF 恒返回 `'millimeter'`（`:416`），等于没有单位探测 |
| `guessStlUnit` | `file-formats.ts:420` | STL 无单位元数据 → faijs `importFile(buf,'stl',{unit})` 显式声明；启发式猜测是否保留待定 |
| `guessGlbUnit` | `file-formats.ts:436` | glb 仅兼容路径，待定 |
| `UNIT_TO_MM` | `file-formats.ts:388` | 删除，换算引用 `@faicad/faijs/units` |

### D. 导出反算

`packages/app/src/engine/exporters/index.ts:46` 的 `sourceUnitToScaleFactor` 保留（导出时按 `sourceUnit` 反算），内部换算表收敛到 `@faicad/faijs/units`（用 `fromBase`）。

### E. `sourceUnit` 元数据保留

`sourceUnit` 作为文件元数据（"这个文件本来是英寸"）保留在快照/工程序列化里，供 UI 显示与导出反算用。**几何层不再承担单位标签**（Shape 不加 unit 字段，见 D3 不变量）。注意与"系统显示单位"（D10.1）区分：`sourceUnit` 是文件来源单位，系统单位是界面显示单位，两者独立。

### F. 系统显示单位设置器（新增，裁定 3 的宿主侧）

- 场景设置/工程设置里加单位选择（mm/inch/米），存入**工程元数据**（不进 faijs，D10.1）。
- 各 panel 长度/角度输入框旁显示当前系统单位；读取 = `fromBase`，写入 = `toBase`。
- 生成脚本时把 `{ units, dims }` 传给 `formatCodeLine`（`dims` 来自 script-face-manifest / op 声明），基准单位也写单位字面量（`10 * mm`）。
- **切换单位 = 用宿主基准值重投影宿主生成的行**（幂等，D10.2）；手写行不改写；切换后重新 `check()`。
- label 显示按系统单位渲染（`拉伸 10 in` 而非硬编码 `拉伸 10mm`）。

### G. 实施顺序（3d_editor 侧，faijs P1–P8 完成后）

1. 升级 faijs 依赖版本（`package.json`），过 `check-dep-lockstep`。
2. **B（删 `unitScaleFactors` 桥接）**——先做，验证 `cad.load` 返回 mm 基准。
3. **A（9 个 feature + D9 改名）+ 反解析读回（`{units,dims}` 传参）**——按 feature 分批。
4. **C（导入单位探测收敛）+ D（导出反算收敛）**。
5. **F（系统单位设置器 + 面板换算 + 切换重投影）**。
6. **E（`sourceUnit` 元数据保留）**——确认序列化不变。

---

## 10. 附：本轮复核的实测修正（事实勘误）

2026-09-28 实测核对后修正的**过期事实/机制断言**，供审阅对照（只列事实修正，不含设计取舍）：

| 类别 | 修正 |
|---|---|
| 版本号 | 原写 `0.20.0 → 0.21.0`，实测 `packages/core/package.json` 为 **0.19.0** |
| 内部矛盾 | 原有"几何 API 参数 `ValueWithUnits` 化"（目标 3 / P2）与 D4「几何入参保持裸 number」冲突 → 用户已裁定由本方案判定，统一到 D4（不做 ValueWithUnits 化） |
| 角度基准 | 原为"待裁定（度/弧度）"，用户裁定为**度** → D1.1 改写为已裁定 + 三条实施纪律（不做全量收敛、不得双重换算、角度入参清单） |
| 序列化归属 | 原把序列化/反解析放在 3d_editor 侧且未提单位上下文；现明确在 faijs 侧实现，并新增 D10（`UnitContext` + 换算 + 幂等 + 精度规则） |
| 机制断言 | "解释器零改动"不准确：需改 `S4_SAFE_GLOBALS`、`globalThis` 注册、`UiMetadata.names` 三处（不需要的是运算符重载）；§2.6 实测 `10 * mm` 今天直接抛 `SEC_FREE_IDENT` |
| **新发现（缺陷级）** | `codeToArgs` 对 `10 * inch` / `10 * mm` **返回 0**（前置声明把单位名变成哨兵参数）；注册 `globalThis` 也不改变 → D10.4 三处修正 + `!== 0` 断言 |
| **新发现（缺陷级）** | `fmtNum(1e-7) === '0'`（6 位小数截断静默归零）→ 单位字面量改用 `fmtUnitNum`（`String(n)` 最短往返） |
| **新发现** | `fmtValue` 对 `expr-ref` 无条件加括号（实测 `{ length:(10 * inch) }`）→ `HostExprRef` 增可选 `bare` |
| **新发现** | `hasComputedArgs` 对纯字面量表达式（`10 + 5`）为 `false` → 单位字面量必须置 `usedUnit` 使宿主只读降级，否则折叠值会被写回源码 |
| 声明三表 | 原只有 `UNIT_SCALE` + `UNIT_DIMS`，缺"单位名 → 量纲名"映射（校验器无法比较声明 dim 与字面量 dim）→ 补 `UNIT_DIM` 为单一真源，`UNIT_DIMS` 改为派生 |
| 校验落点 | 未写实现位置；实测 `args-schema` 已删除，唯一入口是 `extractMetadata`，stage 联合在 `runtime.ts:73`；且**必须在 AST 折叠之前**（折叠值无量纲信息） |
| 声明落点 | 原只写"`defineOp` meta 加 `paramDims`"；实测 L3 脚本面是 `arg-spec.ts` → `gen-l3-surface.ts` **生成**的，须两路都加 |
| 调用形态 | 原漏位置形态 `box(10,20,30)`（`dual-form-args.ts`），只看对象形态会漏判 |
| 返回值量纲 | 原完全未提 `volume`/`area`/`length`/`centerOfMass` 等查询返回 → 新增 `retDim` |
| 存量迁移 | 原未提 R2（裸数字非法）导致 **393 个 `.fai.js`** 需一次性迁移 → 新增 P5（AST codemod + 验收） |
| 换算表清单 | 原漏 `fai_cq_warehouse/src/sprocket.ts:63` 的重复 `INCH` |
| fcstd 收敛 | 原未提 `expressions.ts:16` 的"角度保留自身单位"语义（`deg:1/rad:1`），直接收敛会改语义 |
| 容差常量 | 原用 `ZERO_LENGTH` 替代"0.01/0.1 之类"是错对应：0.01mm 是 OCCT 缝合容差、0.1mm 是三角弦偏差 → 改为逐条定义；并指出 `angularDeflection` 默认 0.5 是**弧度** |
| 类型定义 | 原 D2 用 `ReadonlyMap`、API 节用 `Readonly<Record<string, number>>`，两处矛盾且后者丢键约束 → 统一 |
| API 缺陷 | 原 `div(): ValueWithUnits \| number` 联合返回不可用 → 拆 `div` / `divBy` |
| 悬空引用 | "zlib/3MF 那份 plan"、"`three-mf.ts`"、"与 zlib plan 的 parse3mf 协同"——本仓库内均不存在（3MF 解析现状只在 3d_editor `file-formats.ts:406`）→ 已删除，改为本文档内联定义。（复核时下游 `3d_editor` 出现了同日的新 zip/3MF 方案，已按「代码事实 + 归属边界」处理并明确**不作为依据引用**） |
| **3MF 单位枚举缺项** | `UnitName` / `UNIT_SCALE` 原漏 **`micron`**；3MF `<model unit>` 的合法枚举是 micron/millimeter/centimeter/inch/foot/meter（实测 `file-formats.ts:412`）→ 已补 `micron`（`MICRON = 0.001`）并注明这六个键必须在表内 |
| **3MF 归属** | 原只写"3MF 解析新增在 faijs"，未声明与下游同项工作的边界 → 已加：**faijs 侧 3MF 解析只允许一份实现**，两份文档冲突以代码为准 |
| 3MF 现状 | 原 §2.4/§9-C 只说"3MF 解析存在于 3d_editor 侧" → 实测该实现只扫前 2048 字节原始 buffer（`:407-409`），对 deflate 压缩的真实 3MF **恒返回 `'millimeter'`**（`:416`）；迁移时不得照抄该扫描法 |
| 3d_editor 路径 | `ModelGroup.tsx` → `packages/app/src/engine/components/renderers/`；`ScriptEngine.ts` → `packages/app/src/engine/script-engine/`；features → `packages/app/src/engine/features/` |
| 3d_editor 参数名 | `knurl` 无 pitch/diameter；`fai_split` 无 distance（是 `offset`/`inPlaneAngleDeg`）；`transform` 无 move（是 `offset`/`anglesDeg`）；`primitive.buildArgs` 是通用 number 透传 |
| 缺项 | 原未写 exports/门禁/生成文件重跑清单（`gen-api-dts.ts`、`gen-l3-surface.ts`、`check-ops-api-inventory`、ghost-deps、lockstep） |
| 缺项 | 原未写可重复执行的测试文件清单与错误码 |
| 缺项 | 原未写**校验器如何取得 `paramDims`**：`lang/` 不得依赖 op 注册表 → 已补 `ExtractMetadataOptions.opDims` + 三处透传（`CadRuntime.check/execute`、CLI `check`、`codeToArgs`）+ 端到端接线测试；不接线 = 校验静默失效 |
| **Onshape 基准** | 原 §1 未写 Onshape 的基准是 **meter / radian / kilogram / kelvin**（`units.fs:107-121`），而 faijs 是 mm / degree / gram / kelvin → 已补 §1 警告：照抄 `millimeter = 0.001 * meter` 差 1000 倍、`degree = PI/180 * radian` 差 57.3 倍（`units.fs:239`） |
| Onshape 引用 | 原 `units.fs:107-169` 笼统且 `+` 前提无行号 → 改为精确：量纲常量 `:107-121`、派生常量 `:149/:157/:161/:239`、`+` 前提 `:558-559`、`isLength:434`、`isAngle:461`、`<` 前提 `:531-536` |
| 规则歧义 | 原 R5「函数调用结果一律放行」与「`retDim` 可推导」冲突 → 已明确判定顺序：`retDim` 命中优先于 R5 放行 |
| **门禁漏项** | 原 §5.1/§6 未列 CI 5/9 实际会跑的三条守卫：`api-surface-snapshot.mjs`（新增子路径必须加进脚本内硬编码的 `SUBPATHS`，否则导出面快照静默不覆盖）、`madge --circular`（D10 新依赖不得成环）、`check-platform-imports.mjs`（`units.ts` 须为中立模块） |
| 阶段顺序 | 原 P5 把「跑 `check` 无 `E_DIM_BARE_NUMBER`」当迁移当轮门槛，但该校验 P6 才存在 → 拆成两截验收（P5 当轮只验语义不变 + codemod 幂等；P6 完成后补跑全文件 check） |
