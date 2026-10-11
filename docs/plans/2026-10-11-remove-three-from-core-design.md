# 去除 core 对 three.js 的依赖 — 重构设计文档

- 日期：2026-10-11
- 状态：设计稿（待评审）
- 影响范围：`packages/core`（@faicad/faijs）、`packages/faijs-extra`（@faicad/faijs-extra）；下游联动 `3d_editor/packages/weapp`
- 关联事故：3d_editor weapp 2026-09-24 worker/页面 three 162/184 混用（已由解析规则修复钉死）

---

## 0. 需求原文（逐字，最原始内容）

> 你去分析../faijs项目，它的core是否依赖three.js，能否取消这个依赖。取消以后，本项目的worker里是否就可以没有three.js?

> 好，你先在 faijs 项目里写一份详细的重构设计文档

---

## 1. 背景与动机

### 1.1 现状

`@faicad/faijs`（core）把 three 声明为 peerDependency：

```json
"peerDependencies": {
  "occt-wasm": "^5.6.0",
  "three": "^0.162.0 || ^0.184.0"
}
```

`@faicad/faijs-extra` 亦然。下游 weapp 小程序的 worker bundle（`workers/faijs.js`，esbuild 单文件打包 core + extra/editor-ops）因此被迫内嵌一份 three r162：

- 磁盘约 490 KB / 上报约 806 KB（weapp `audit.mjs` 实测数据）
- weapp 主包 2 MB 上限中 wasm.br 已占 1.34 MB，three 是包体红线的直接推手之一
- worker 与建模页两份 bundle 各内联一份 three，2026-09-24 曾因两侧解析规则不对称发生 162/184 混用（端侧 WebGL1 锁死 162，184 无法建上下文）。现已用双侧解析规则 + audit 交叉断言钉死，但**这类风险只会被钉住，不会被消灭**。

### 1.2 动机（为什么做）

1. **包体**：worker bundle 减重约 490 KB（磁盘），weapp 分包预算大幅缓解
2. **消灭整类风险**：跨宿主 three 版本一致性守卫（audit 断言 + 双 build 脚本解析规则）可以整体退役——"两份 three"不复存在
3. **依赖纯净**：faijs 自称"CAD 执行引擎"，three 是渲染库；core 的三个外部依赖（occt-wasm / manifold-3d / opentype.js，前两者为 wasm）都有明确的按需加载设计，唯独 three 是无条件 peer——node 环境跑 faijs 单测/CLI 也要装 three
4. **审计合规**：weapp 审计要求消除禁用 token，three 是 bundle 里最大的一块"非几何"代码

### 1.3 非目标（本次不做）

- 不动 3d_editor **页面侧**的 three（viewer3d / picking 的 WebGL 渲染是浏览器端真实职责，three 是渲染底座，与 faijs 无关）
- 不动 faijs-viewer / faijs-draw / faijs-sketch 等渲染/交互类包的 three 依赖（它们本来就该用 three）
- 不改变任何对外 API 的输入输出行为（可复现性契约不变）

---

## 2. 使用面调查（2026-10-11 实测）

### 2.1 依赖分布

| 包 | import three 的文件数 | 其中 `three/examples/**`（非基础链） |
|---|---|---|
| core/src | 23 | 0（已被 `test/three-surface.test.ts` 的 R1 守卫钉死） |
| faijs-extra/src | 9 | 1（`extras/svg-extrude.ts` → `three/examples/jsm/loaders/SVGLoader.js`） |

**调查的权威依据是仓库里已有的两个守卫测试，而不是重新 grep**：

- `packages/core/test/three-surface.test.ts`：钉死 core 可用的 three 符号子集（`THREE_ALLOWED`）、禁止 core 出现 `three/examples/**`（R1）与 `Shape`/`ExtrudeGeometry`/`Path`/`LineCurve`/`SVGLoader`（R3）、钉死 `three` 只能是 peer（M1a）。
- `packages/core/test/three-compat-smoke.test.ts`：用 r162（`three-162` alias）与 r184（`three`）双份安装实测同一子集的行为摘要并对照，已记录一处既知分歧（`ConeGeometry`，r163 起泛化锥/台顶点生成）。

这意味着 core 侧此前已被净化过一轮（B 组 `Shape`/`ExtrudeGeometry`/`SVGLoader` 链已迁往 extra）；本设计是这条线的收尾。移除 three 时这两个守卫测试必须一并退役/改造（见 M0），不能只删生产代码。

### 2.2 实际使用的 THREE API 全集（core + extra，按出现次数）

> 说明：下表 `THREE.Shape` / `THREE.ExtrudeGeometry` / `THREE.SVGLoader` 的出现**全部来自 extra**——core 侧被 R3 守卫禁止，只有 `THREE.ShapeUtils` 在 core 内出现。

| API | 次数 | 性质 |
|---|---|---|
| `THREE.Vector3` | 153 | 数学 |
| `THREE.BufferGeometry` | 73 | 数据模型 |
| `THREE.Matrix4` | 70 | 数学 |
| `THREE.BufferAttribute` | 25 | 数据模型 |
| `THREE.Shape` | 14 | 2D 轮廓（仅 extra） |
| `THREE.Quaternion` | 10 | 数学 |
| `THREE.Plane` | 7 | 数学 |
| `THREE.Vector2` | 6 | 数学 |
| `THREE.CylinderGeometry` | 5 | 几何生成 |
| `THREE.Euler` | 4 | 数学 |
| `THREE.Box3` | 4 | 数学 |
| `THREE.Mesh` | 3 | 数据模型 |
| `THREE.ExtrudeGeometry` | 3 | 几何生成（三角化，仅 extra） |
| `THREE.BoxGeometry` / `ConeGeometry` / `SphereGeometry` | 3+2+1 | 几何生成 |
| `THREE.ShapeUtils` | 1 | 三角化 |
| `THREE.Points` | 1 | 数据模型 |
| `THREE.SVGLoader`（three/examples） | 1 | SVG `d` 路径解析（仅 extra） |

### 2.3 使用分类（本设计的关键：三层拆解）

**L0 数学层**（约占用量 70%）：`Vector3` / `Matrix4` / `Quaternion` / `Euler` / `Plane` / `Vector2` / `Box3`。
纯算术与约定（Euler 序、四元数乘法、矩阵 premultiply/multiply 语义）。无渲染、无 GPU。

**L1 网格数据层**（约占 20%）：`BufferGeometry` / `BufferAttribute` / `Mesh` / `Points`。
实际用到的方法面很窄（grep 实测）：`toNonIndexed`、`getIndex`、`getAttribute`、`computeVertexNormals`、`computeBoundingBox`、`boundingBox`、`index`、`attributes`、`attr.array`。
本质就是一个 `{positions, indices, attributes}` 容器 + 少量操作——而 core 对外的网格类型 `Shape`（`packages/core/src/mesh/types.ts`，`isMeshShape` 即以此判定）**已经存在**，three 只在模块内部充当中间容器。

**L2 几何生成层**（约占 10%，难点）：`Shape` / `ShapeUtils.triangulateShape` / `ExtrudeGeometry` / `SVGLoader` / `CylinderGeometry` / `BoxGeometry` / `ConeGeometry` / `SphereGeometry`。
**归属必须分清**（此前草案把归属写错了）：core 侧只出现 `ShapeUtils.triangulateShape`——唯一调用点在 `core/src/boolean/cross-section.ts`；`Shape` / `ExtrudeGeometry` / `SVGLoader` 已被 `three-surface.test.ts` 的 R3 守卫挡在 core 之外，只存在于 `extra` 的 `svg-extrude` / `text-cjk` / `text-geometry`（`engrave.ts` / `decoration-provider.ts` 用的是 L0/L1 的 `BufferGeometry`/`Vector3`/`Quaternion`，不是 L2）。参数化几何（Box/Cylinder/Cone/Sphere）的调用点在 `core/src/mesh/primitives.ts` 与 `core/src/primitives/mesh-primitives.ts`。
其中**真正的算法依赖有三**：`ShapeUtils.triangulateShape`（含孔洞多边形三角化）、`ExtrudeGeometry`（轮廓拉伸+封盖）、`SVGLoader`（解析 SVG `d` 路径，含 arc/bezier 归一）。Box/Cylinder/Cone/Sphere 等参数化几何在 core 里是给 primitive 建默认 mesh 用的，manifold-3d 或自有参数化即可等价生成。

### 2.4 一个重要事实

three 的 `ShapeUtils.triangulateShape` 内部就是调用 **earcut**（three 源码内嵌的是 earcut 2.2.x 的快照，MIT 协议，无其它依赖）。因此 L2 的三角化可以直接改为**直接依赖 earcut**，算法同源，一致性风险天然最低。但要注意"同源"不等于"逐位一致"：npm 上的 earcut 3.x 是重写版，与 three r162 内嵌的 2.2.x 快照未必输出相同，必须按 §5 R6 做一次结果对照，不一致则锁 earcut@2.2.x。

---

## 3. 设计方案

### 3.1 总体思路

在 core 内新建两个**零依赖**（earcut 除外）内聚模块，替换 three 的三层角色：

```
packages/core/src/geom/          ← 已有自有几何类型（Vec3 等）
packages/core/src/math3d/        ← 新增：L0 数学层（three r162 算法子集移植）
packages/core/src/mesh/meshdata/ ← 新增：L1 网格容器 + 操作，且承载 L2 几何生成
```

`meshdata/` 不只放 L1 容器，还承载 §3.4 的 L2 生成函数（`extrudeShape` / `parametric`），这三层共同构成"去 three"的替换面；若评审倾向按层分目录（如 L2 另立 `core/src/mesh/generators/`），以评审结论为准。命名遵循 core 现有风格；模块命名以评审为准（`math3d`/`meshdata` 只是占位）。

### 3.2 L0：math3d 移植子集

**范围**（按 2.2 的实际使用面裁剪，不是搬整个 three math）：

| three 类型 | 替代 | 关键语义（必须逐位一致） |
|---|---|---|
| `Vector3` | `math3d/Vec3Ops`（类或纯函数集） | addVectors / cross / dot / normalize / applyMatrix4 / applyQuaternion / distanceTo 等 |
| `Matrix4` | `math3d/Mat4` | makeRotationFromEuler / makeTranslation / makeScale / premultiply / multiply / compose；**列主序存储与乘法顺序** |
| `Quaternion` | `math3d/Quat` | setFromEuler（'XYZ' 等 six-order，**公式逐行照搬 three**）/ multiply / slerp（若有用到） |
| `Euler` | 直接收 `(x,y,z,order)` 元组，不需要类 | order 字符串语义与 three 一致 |
| `Plane` | `math3d/PlaneOps` | setFromNormalAndCoplanarPoint / distanceToPoint / intersectLine |
| `Box3` / `Vector2` | 轻量自有结构 | min/max 语义 |

**实现策略：从 three r162 源码逐行移植，不做"重新发明"。**

理由：这些算法（四元数 setFromEuler 的分支公式、Matrix4 的 makeRotationFromEuler）是数学事实，自己写一遍只会引入偏差。许可证上必须写准：**three 是 MIT 许可，本项目的许可线是 Apache-2.0——两者兼容但并非同协议**；MIT 允许再分发与改作他用，条件是保留版权与许可声明，因此移植文件头部必须保留 three 的 MIT 归属声明（不能只写"移植自 three"）。移植时保留 three 源码的函数结构便于 diff 对照。

**逐位一致性测试（本重构的生命线，先于任何替换代码建立）**：

- 新建 `packages/core/test/math3d/three-parity.test.ts`（**测试与被测源码目录分离**，与仓库"各包 `test/` 与 `src/` 平级"的约定一致；不要放进 `src/math3d/`）
- 测试机器上同时安装 `three-162`（core devDependencies 已有 alias：`"three-162": "npm:three@^0.162.0"`）
- 对每个移植函数：随机输入（含边界：0 向量、单位四元数、退化平面）→ three 实现与新实现各跑一遍 → **断言输出逐位相等**（不设 epsilon）。随机输入必须走**固定种子的 PRNG**，不得用 `Math.random`（否则测试不可复现，与本项目"确定性"硬约束冲突）
- 该测试文件在 three 依赖最终移除后**继续保留**（three-162 留在 parity 测试专用 devDependency），作为永久回归锚点

### 3.3 L1：meshdata 容器

**类型**（收敛到既有对外类型，不另造平行结构）：

core 对外网格类型是 `packages/core/src/mesh/types.ts` 的 `Shape`（`isMeshShape(v): v is Shape` 鸭子判定，只看 `positions`/`indices` 两个字段），而不是草案里写的"`MeshShape`"——`MeshShape` 只是概念称呼，落地时必须用真实类型名 `Shape`。`Shape` 现状字段远多于 `{positions, indices}`，已含 `appearance` / `materialGroups` / `vertexColors` / `meta` / `transform` / `faceRanges`；本次**不改动这些既有字段**，只在需要时新增可选 `normals`：

```ts
// packages/core/src/mesh/types.ts 的 Shape（现状字段略；仅演示与 L1 的关系）
interface Shape {
  positions: Float32Array
  indices: Uint32Array
  // …appearance / materialGroups / vertexColors / meta / transform / faceRanges（现状，本次不动）
  normals?: Float32Array    // L1 新增（computeVertexNormals 语义，见下）
}
```

新增 `normals` 对 `isMeshShape` 判定无影响（守卫只看 `positions`/`indices`），但若该字段要随产物过 worker 序列化 / `structuredClone`，必须同步纳入序列化字段白名单——这一点与既有 `appearance`/`meta`/`transform` 的处理方式一致。

**操作面**（按 2.3 实测方法面，逐项替换，**统一为纯函数集**，不给对外 `Shape` 挂方法）：

| three 用法 | 替代 |
|---|---|
| `geometry.toNonIndexed()` | `meshdata.toNonIndexed(shape)` |
| `geometry.getIndex()/getAttribute('position')` | 直接读字段 |
| `geometry.computeVertexNormals()` | `meshdata.computeVertexNormals(shape)`——**注意**：core 已有"折边法线走 crease-normals"的架构红线（`boolean/creased-normals.ts`；`computeVertexNormals` 在共享顶点几何上会磨圆棱边，web/weapp 均已禁用），此处实现仅为语义补齐，必须带"折边退化"警告与测试 |
| `geometry.computeBoundingBox()/boundingBox` | `meshdata.boundingBox(shape)` |
| `BufferAttribute` | 直接 `Float32Array`，不再需要包装类 |
| `THREE.Mesh` / `THREE.Points` | 仅是 `{geometry}` 容器用法，直接用 `Shape` |

**不引入** three 的 attribute 互转（Uint16/Uint32 index 选择等）——core 内部统一 Uint32Array。

### 3.4 L2：几何生成层

| three 用法 | 替代 | 一致性 |
|---|---|---|
| `ShapeUtils.triangulateShape` | 直接依赖 **earcut**（three 内嵌的 2.2.x 快照与 earcut 同源；3.x 为重写版） | 同源，需按 §5 R6 结果对照 |
| `ExtrudeGeometry`（extra 的 `svg-extrude` / `text-geometry` / `text-cjk`） | `meshdata.extrudeShape(contours, depth, opts)`：底/顶封盖用 earcut，侧壁连接 quad 拆 tri。**壁序/法线朝向需与 three 的 ExtrudeGeometry 对照** | 对照测试（基准版本见下） |
| `BoxGeometry` / `CylinderGeometry` / `ConeGeometry` / `SphereGeometry` | 调用点在 core 的 `mesh/primitives.ts` 与 `primitives/mesh-primitives.ts`，**这些正是"用 three 生成"的点，必须全部改为 `meshdata/parametric.ts` 的自有实现**（封闭公式）。注意：不存在"已走 manifold/brep 链所以不用改"的调用点——凡 2.2 统计到的 three 参数化几何调用点都要替换 | 逐位对照测试（基准版本见下） |
| `SVGLoader`（`three/examples`，extra 的 `svg-extrude`） | **本设计此前完全遗漏的一项**。`SVGLoader` 负责解析 SVG `d` 路径（含 arc/bezier 归一为 `Shape`）。替代方案二选一：(a) 移植 `SVGLoader` 的路径解析为自有 `svgPathToContours()`（保留 MIT 声明）；(b) 仅覆盖 core/extra 实际用到的 SVG 子集自行解析 | 移植对照测试；方案选择见 §7 |
| `THREE.Shape`（2D 轮廓，含孔洞/多子路径） | 自有 `Contour {outer: Vec2[], holes: Vec2[][]}` 及其集合形态（`ExtrudeGeometry` 接受 `Shape[]`，多子路径不能塌成单个 `Contour`，需以 `Contour[]` 表达） | 数据搬运，无算法 |

**对照基准必须明确（此前草案遗漏）**：faijs 同时支持 three r162（weapp，WebGL1 锁版）与 r184（web）。`three-compat-smoke.test.ts` 已实测出 r162 与 r184 的 `ConeGeometry` 输出不同（r163 起泛化锥/台顶点生成）。因此"与 three 逐位一致"必须写明**以哪一版为基准**，且已知分歧需像 `KNOWN_DIVERGENCES` 那样显式登记，不能默认两版都对得上。

**opentype.js 文字链**（`cjk-font.ts` / `text-cjk.ts`）：opentype 输出的已经是轮廓路径点，当前只是经 `THREE.Shape` 中转后交给 ExtrudeGeometry——替换后路径变短：opentype → `Contour` → `extrudeShape`。

### 3.5 peerDependency 变更

```jsonc
// core/package.json 最终态
"dependencies": {
  "@xmldom/xmldom": "^0.9.8",
  "acorn": "^8.18.0",
  "earcut": "^3.0.0",        // 新增：唯一新依赖，~8KB（版本见 §5 R6 / §7）
  "fflate": "^0.8.3",
  "manifold-3d": "^3.5.1",
  "opentype.js": "^1.3.4"
},
"peerDependencies": {
  "occt-wasm": "^5.6.0"      // three 移除
},
"devDependencies": {
  "three-162": "npm:three@^0.162.0"  // 保留：仅供 parity 测试
  // 同时移除生产用的 "three": "^0.184.0" 与 "@types/three"（见下）
}
```

**devDependencies 收口需要一并交代**（此前草案只列了 `three-162`）：现状 core 的 devDependencies 除 `three-162` 外还有 `"three": "^0.184.0"` 与 `"@types/three": "^0.184.1"`——前者是 `three-surface.test.ts` / `three-compat-smoke.test.ts` 的 r184 侧对照物。这两个守卫测试退役后，`three`(r184) 与 `@types/three` 也随之删除；若 parity 测试仍需类型，必须明确类型来源（`three-162` alias 的 d.ts 来自 r162 自身，与 `@types/three@0.184` 不匹配，不能混用）。

faijs-extra 同步移除 three peer（其 `@faicad/faijs` peer 保留）。extra 替换后的 `extrudeShape` / `svgPathToContours` **复用 core 提供的能力**（经 `@faicad/faijs/mesh/...` 或对应子路径导入），extra 自身**不新增 earcut 依赖**，避免同一算法两处实现。faijs-viewer / faijs-draw / faijs-sketch 等渲染/交互包的 three 依赖**不变**。

---

## 4. 分阶段实施计划

> 每阶段独立可验证、可停；全程遵守"先测试后替换"。版本线变更（若需要）一律走 `set-version.mjs` 流程（本设计移除 peer 依赖不改变包版本号，见 M4）。

### M0：parity 测试链先行（无生产代码改动）

0. **处置既有守卫、补齐文件清单**：`test/three-surface.test.ts`（three 符号白名单 + peer 断言）与 `test/three-compat-smoke.test.ts`（r162/r184 行为对照）是本设计的既有前置。M0 必须给出二者的退役/改造方案（`three-surface` 的 M1a"three 必须是 peer"断言会在 M4 必然失败；`three-compat-smoke` 依赖 r184 侧 `three`，会在 M4 删依赖后失败），并据此产出一份完整的"待替换文件清单"（§2.1 目前只有文件数，M3 需要清单）
1. 建立 `test/math3d/three-parity.test.ts`（**放 `test/`，不放 `src/`**）：对第 3.2 节全表逐函数，用**固定种子的随机输入** + 边界输入，断言 three r162 与"参考快照"（先以 three 自身作为被测对象跑通 harness）逐位相等
2. 建立 L2 对照 harness：用 three r162 的 `ExtrudeGeometry`/`ShapeUtils`/参数化几何/`SVGLoader`，对代表性输入（矩形含孔、圆弧轮廓、文本轮廓样本、含 arc/bezier 的 SVG）固化**golden 输出快照**（顶点数组逐位）；同时明确"以 r162 还是 r184 为对照基准"，并登记已知分歧
3. 验收：parity 测试在 CI 全绿；golden 快照入库（`packages/core/test/math3d/__fixtures__/`，与测试同目录）

### M1：math3d 移植（L0）

1. 逐行移植 three r162 对应源码到 `math3d/`；每个文件头部保留 three 的 MIT 版权/许可声明，并注明 three 源文件与版本、移植日期
2. parity 测试切换被测对象：three 实现 vs math3d 实现，逐位相等
3. **不替换任何调用点**（纯新增模块）
4. 验收：parity 全绿；`npx vitest run` 存量测试全绿；`tsc --noEmit` 通过

### M2：meshdata 容器（L1）

1. 按 3.3 节落地**纯函数集**（toNonIndexed / computeVertexNormals / boundingBox 等，作用于对外类型 `Shape`），配套单测；若新增 `normals` 字段，同步纳入 worker 序列化白名单
2. 对 `toNonIndexed`、`boundingBox` 用 three BufferGeometry 同输入对照（并入 parity 测试）
3. 验收：同 M1

### M3：调用点替换（core 23 文件 → extra 9 文件，机械替换）

1. 按 M0 产出的文件清单逐文件替换：`import * as THREE from 'three'` 与具名导入（如 `import { BufferGeometry, BufferAttribute } from 'three'`）→ `math3d`/`meshdata` 具名导入；`new THREE.Vector3(...)` → 对应构造/函数
2. **每替换一个文件**：跑该文件对应的既有单测（core 测试直接消费 src，免打包）+ 受影响的下游测试
3. L2 文件单独一批（core 的 `cross-section`；extra 的 `svg-extrude` / `text-geometry` / `text-cjk`），替换后跑 M0 的 golden 快照对照。注意 core 的 `engrave` / `decoration-provider` 属 L0/L1，不在此批
4. 验收：`grep -rn "from 'three" packages/core/src packages/faijs-extra/src` 为零（**用 `from 'three` 而非 `from 'three'`，以覆盖 `three/examples/**` 子路径导入**）；`npm run test`（monorepo 全量单测）全绿；几何结果 golden 快照全绿

### M4：依赖收口

1. core + extra 的 `package.json`：three 移出 peerDependencies（`three-162` 保留在 devDependencies 供 parity）；同时删除 core 生产用的 `three`(r184) 与 `@types/three`
2. 处置 M0 定案的既有守卫测试（`three-surface` / `three-compat-smoke` 退役或改造），否则 M1a"three 必须为 peer"断言会失败
3. dist 重新构建，确认 dist 中无 three（新增 ci 检查：`grep -rn "from 'three" packages/core/dist packages/faijs-extra/dist` 必须为空——**两个包的 dist 都要查，且用 `from 'three` 覆盖子路径**——把"修好了"钉成闸门）
4. 版本线：移除 peer 依赖**本身不改变任何包版本号**；若同一 PR 另有版本升级，才走 `set-version.mjs` + `check-lockstep.mjs`。`check-dist-sync.mjs` 是 build 后的符号表漂移守卫，与版本号无关，不属于 `set-version` 流程
5. 验收：core 的 node 环境安装后**无需** three(r184) 即可跑全部单测（删 node_modules 里 `three` 后 `npx vitest run` 全绿；parity 用 `three-162` alias 目录，允许保留），且 M0 第 0 步定案的守卫测试退役/改造已执行

### M5：下游跟进（3d_editor weapp）

1. `packages/weapp/scripts/build.mjs`：删除 three 解析规则（handler 1b）
2. `audit.mjs`：three 版本交叉断言改为**单侧**——仅校验 pages bundle 内嵌 r162（worker 侧断言与"两份一致"断言删除）
3. 确认 worker bundle 体积下降（audit 输出对比，预期 -490 KB 左右）
4. 按 weapp 的 CI 分层流程逐层验证（lint → typecheck → vitest → build:worker → audit → test:sim）

---

## 5. 风险清单

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | 数学约定偏差（Euler 序、四元数分支、矩阵乘法序）导致**静默**几何错误 | 高 | M0 parity 测试先建；逐位断言而非 epsilon；M3 逐文件替换逐文件跑测 |
| R2 | `ExtrudeGeometry` 移植遗漏细节（bevel、阶梯、孔洞壁序），以及**此前遗漏的 `SVGLoader` 路径解析**（arc/bezier 归一、多子路径） | 高 | golden 快照覆盖代表输入；bevel 若 extra 实际未用到（需在 M0 确认调用点参数），在 `extrudeShape` 显式**不支持**并抛错——报错好于掩盖；`SVGLoader` 替代方案（移植 vs 自解析）在 §7 定案后列出覆盖的 SVG 子集清单 |
| R3 | BufferGeometry 隐式行为被依赖（如 index 的 16/32 位选择、`toNonIndexed` 的 attribute 全量拷贝） | 中 | 2.3 已实测方法面窄；替换时逐项核对 3.3 表，未列入的 three 方法出现即视为新需求，补入设计而非顺手实现 |
| R4 | three 在 dist 里被动态引用（字符串拼接 require 等），静态 grep 漏检；或 `three/examples/**` 子路径因 grep 模式写成 `from 'three'` 而漏检 | 中 | M3/M4 统一用 `grep -rn "from 'three"`（不带闭引号）覆盖子路径；M4 的 dist 检查用 esbuild bundle 验证兜底：weapp build:worker（external 策略下）或 node smoke 直接暴露 unresolved bare import |
| R5 | 下游其它包（demo / tests / 3d_editor web 端）import core 内部路径触达 three | 低 | core 对外只暴露 dist 入口与 src alias；M3 后用 `grep -rn "from 'three"` 全仓验证 |
| R6 | earcut 与 three 内嵌版本漂移 | 低 | three r162 内嵌 earcut 2.2.x；直接依赖 earcut 3.x 需做一次三角化结果对照（M0 golden 覆盖），不一致则锁 earcut@2.2.x |
| R7 | 对照基准未定：r162 与 r184 已存在行为分歧（`ConeGeometry`，详见 `three-compat-smoke.test.ts` 的 `KNOWN_DIVERGENCES`），"逐位一致"目标可能对两版无法同时成立 | 中 | M0 明确以哪一版为基准；已知分歧显式登记（延续 `KNOWN_DIVERGENCES` 的做法），不默认两版都对得上 |
| R8 | 既有守卫测试（`three-surface.test.ts` / `three-compat-smoke.test.ts`）的退役/改造被漏做，导致 M4 后 CI 失败或"没 three 也能跑"的验收失真 | 中 | M0 先定案退役/改造方案，M4 执行；`three-surface` 的 M1a"three 必须是 peer"断言是必然冲突点 |

---

## 6. 设计边界（哪些不动、什么不变）

前两项是"不动的 three 使用点"，第三项不是同类条目，而是"不变的行为契约"——草案把三者并列成"不迁移的三点"属分类错位，此处分开。

**不动的 three 使用点**：

1. **web 端 3d_editor 的 three**：渲染层，与本重构无关
2. **faijs-viewer / faijs-draw / faijs-sketch 的 three**：交互/渲染包，three 就是它们的正当依赖

**不变的行为契约**：

3. **可复现性契约的语义**：重构前后"brep 链与 mesh 链对同一输入产出逐位相同的 mesh"这一契约不变——本次替换的只是产生该结果的内部数学实现，golden 快照是它的执法者

---

## 7. 待评审问题

1. `math3d`/`meshdata` 的模块命名与落点（`core/src/math3d/` vs 并入现有 `core/src/geom/`；L2 生成函数是放 `meshdata/` 下还是另立目录）——倾向前者，与 geom 的"类型"职责分离
2. `extrudeShape` 是否需要支持 bevel（取决于 M0 调查 **extra** 调用点是否传 bevel 参数；若全仓未用，设计为不支持+抛错）
3. earcut 版本选择（3.x 需 M0 对照；不一致则锁 2.2.x）
4. parity 测试对 `three-162` devDependency 的长期保留是否接受（否则 parity 测试退化为纯 golden 快照，失去双向对照）
5. `SVGLoader` 替代方案的取舍：移植 `SVGLoader` 的路径解析（保真度高、代码量大）vs 自行解析 core/extra 实际用到的 SVG 子集（小、但需明列支持范围）
6. 对照基准版本：以 r162 还是 r184 作为"逐位一致"的基准，以及已知分歧（如 `ConeGeometry`）如何登记
7. 既有守卫测试 `three-surface.test.ts` / `three-compat-smoke.test.ts` 的退役 vs 改造（改造方向：保留 `THREE_ALLOWED` 语义、删除 peer 断言、golden 快照改为本设计产物）
