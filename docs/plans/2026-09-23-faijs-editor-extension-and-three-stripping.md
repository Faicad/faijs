# faijs 扩展库拆分与 three.js 依赖治理开发计划

状态：**方案（未实施）**

---

## 一、需求原文（逐字）

> 我有两个需求：1. 3d_editor需要的非通用的op独立到一个库中，从core中剥离（所有fai_开头的op，以及svg挤出、3D文字等）。2. faijs的核心库要剥离对three.js的依赖, 或者只用兼容的api。

前序要求（同一需求的上一轮表述，逐字）：

> 这样，你去看代码，我记得有要求fai_开头的，还有其他一些op，是单独给3d_editor项目使用的，这个先独立为一个扩展库。你先写这份方案。

> （第一版方案评审后）但是明显不够，svg、文字处理的op是什么？

剥离 three 的动机（逐字）：

> 分析本项目对three.js的依赖，由于我需要把它用到类似微信小程序等环境，最好让faijs不依赖three库，请分析剥离three的可能性

本轮补充的约束（逐字，是本计划中 three 治理部分的唯一依据）：

> 你要分析3d_editor的小程序端，它似乎没有用到manifold，但是用到了低版本的three.js。如果你剥离three.js却用上了manifold，似乎没起到效果。我主要的目的是让faijs兼容web和小程序端。现在它们的three版本冲突了。要么剥离，要么和3d_editor一样，添加版本校验，只准faijs依赖基础的three.js的api。

> 而且，小程序必须有three.js，你不要搞错了。

---

## 二、现状实测（本次调研的代码事实）

本章全部结论来自本轮对 `packages/core/src`、`C:\my\Faicad\3d_editor\packages\weapp` 及其**已构建产物**的实读与扫描。

### 2.1 一个必须先厘清的事实：仓库里有**两个** `cad`

混淆这两者是本次改造最大的命名陷阱：

| 名字 | 定义位置 | 是什么 | 谁在用 |
|---|---|---|---|
| **`cad`（mesh 命名空间）** | `packages/core/src/mesh/index.ts` 的 `export const cad = {...}` | **L1 mesh 执行层的实现聚合**：`box/sphere/cylinder/…/translate/rotate_euler/fai_drill/fai_split/load/bboxCenter/boundingBox/…`。是**实现**，不是 op | core 内部 `api/*.ts` 全部 `import { cad } from '../mesh'` 调它；`index.ts` / `browser.ts` 也把它导出（D 类预览 API） |
| **`cad`（脚本面命名空间）** | `packages/core/src/api/api-namespace.ts` 的 `createApiNamespace()` | **L3 API 面**：`defineOp` 产物 + 生成脚本面 op 的对象表，由 `createRuntime` 经 `registerLib('cad', …, { default: true })` 注入（见 `cad-runtime/createRuntimeWithCad.ts:26`） | `.fai.js` 脚本里的 `cad.fai_drill(...)`；3d_editor 生成的代码文本 |

**结论**：迁 op = 改 **第二个**；治理 three = 主要改 **第一个**（以及它下面的 `mesh/*`、`primitives/*`、`boolean/*`）。

### 2.2 three 在 core 的真实分布

扫描口径：`packages/core/src` 下命中 `from 'three'` / `from 'three/examples/...'` 的文件共 **34 个**：

- **24 个生产运行时依赖**（真正会把 three 打进产物的）
- **1 个纯类型**（`primitives/brep-primitives.ts:24` 的 `import type * as THREE`）
- **8 个测试**
- **1 个注释误报**（`brep/handle-bridge.ts:6`）

按**用途**分三类：

**C1 纯数学类** — 只用 `Vector2/Vector3/Matrix4/Quaternion/Euler/Plane/Box3`：

`api/brep-mirror/joinery-brep.ts`、`api/extrude.ts`、`boolean/extrude-helpers.ts`、`brep/brep-ops.ts`、`mesh/knurl/textureLoader.ts`、`mesh/query.ts`、`mesh/transform.ts`

**C2 容器类** — 把 `BufferGeometry/BufferAttribute` 当 mesh 数据容器用（无渲染、无生成器）：

`boolean/deriveNormals.ts`、`boolean/geo-convert.ts`、`mesh/knurl/subdivision.ts`

**C3 几何生成类** — 调 three 的**造网格算法**：

- `primitives/svg-extrude.ts`：`SVGLoader`（`three/examples/jsm/loaders/SVGLoader.js`）+ `Shape` + `ExtrudeGeometry`
- `primitives/text-geometry.ts`：`Shape` + `ExtrudeGeometry`
- `primitives/text/cjk.ts`：`Shape` + `ExtrudeGeometry`（`createMixedTextGeometry`）
- `primitives/mesh-primitives.ts`：`BoxGeometry`/`SphereGeometry`/`CylinderGeometry`/`ConeGeometry` + `applyMatrix4`
- `mesh/primitives.ts`：同上（经 `makePrimitiveGeo`）
- `mesh/drill-hole/DrillHoleCore.ts`：`CylinderGeometry(r,r,h,32)` + `Mesh` + `Quaternion.setFromUnitVectors`
- `boolean/cross-section.ts:316`：`THREE.ShapeUtils.triangulateShape`

**C1+C2 混合**：`api/fai_drill.ts`、`boolean/cross-section.ts`、`mesh/engrave.ts`、`mesh/fai_drill.ts`、`mesh/fai_split.ts`、`mesh/knurl/KnurlGenerator.ts`、`mesh/knurl/displacement.ts`、`mesh/primitives.ts`、`primitives/screw/screw.ts`、`primitives/mesh-primitives.ts`

### 2.3 3d_editor 真实的消费形态（决定了拆分的可行边界）

1. **161 个文件**引用 `@faicad/faijs*`；其中 **19 个文件**生成形如 `cad.fai_drill(part0, {…})` / `cad.translate(…)` / `cad.group(…)` / `cad.load(…)` 的**代码文本**。
2. **op 是以「生成的脚本文本」被消费的，不是以 JS 函数被 import 的**。`packages/app/src/engine/components/drill-hole/__tests__/LiveDrillPreview.test.tsx:59` 注释写明：「历史 stdlib 直接调用已被 worker 预览取代（LiveDrillPreview 不再 import fai_drill）」。全仓扫描**没有**任何文件 `import { fai_drill }` / `import { engrave }` from faijs。
3. 3d_editor 侧有**符号白名单锁**：`packages/app/src/engine/__tests__/contract-entry.test.ts`，把 `@faicad/faijs/browser` 的导入符号分成 A/B/C/D/E 五类白名单，非白名单即红；同时禁止从根入口 `@faicad/faijs` 导入。
4. 3d_editor 直接从 `@faicad/faijs/browser` 导入的**预览辅助函数**（D 类）才是 three 的重度消费者：`svgToExtrudedGeometry`、`parseSvgShapes`、`createTextGeometry`、`createMixedTextGeometry`、`getOpentypeFont`、`containsCjk`、`loadSystemCjkFont`、`isCjkChar`、`makeScrew`、`makePrimitiveGeo`、`mergeBufferGeometries`、`deriveNormals`、`computeSection`、`buildExtrudedProfile`、`makeWorldPlane`、knurl 系列、`buildSelectorRuntime*`、`reconstructSolidFromMesh`。

**由此得到的拆分边界**：把 op 实现搬出 core **不会**破坏 3d_editor 的调用形态——只要这些 op 仍以 `cad.*` 键名注册进运行时。真正的破坏点只有公共签名的归属与 D 类预览函数的换包。

### 2.4 小程序端实证（three 版本冲突的完整证据链）

三个落点全部实测（`C:\my\Faicad\3d_editor\packages\weapp\miniprogram`，产物为 2026-09-23 14:55 构建）：

| 落点 | 位置 | 体积 | three 版本 | 证据 |
|---|---|---|---|---|
| 主包 | `pages/entry/` + `wasm/brepkit_wasm_bg.wasm.br` + `app.js` | 21K + **1.34M** + 1K | 无 three | 主包被 brepkit wasm 占死（2MB 上限，仅剩约 0.66M） |
| 建模页分包 | `pkg-model/pages/model/index.js` | **580K** | **0.162** | 产物内 `"162"` ×2 |
| worker 分包 | `workers/faijs.js` | **1.1M** | **0.184** | 产物内 `"184"` ×2 + `Three.js` ×2 |

**结论一：同一个小程序包里存在两份 three**——`pkg-model` 分包一份 0.162，`workers` 分包一份 0.184（`app.json` 中 `workers.isSubpackage: true`，两者互不共享）。

**结论二：小程序页面侧必须有 three，且版本被硬件锁死。** `packages/weapp/scripts/build-pages.mjs` 的裸依赖白名单注释给出了唯一理由（逐字引用）：

> `three` —— 端侧渲染底座。**必须是 0.162**：端侧 canvas 只有 WebGL1（S0 实测），three 从 r163 起只建 webgl2。本包 package.json 锁 `^0.162.0`（不会跨到 0.163）

→ **小程序不可能升到 0.184**；web 端（`packages/app`）是 `^0.184.0`。两个宿主的 three 版本将**长期分裂**，因此 faijs 不能对 three 有版本主张（详见 §4.4 M1）。

**结论三：worker 里 three 的实际用量。** 实测 `workers/faijs.js` 保留符号（构建为 `keepNames: true`）：

- 数学 + 容器：`Vector3` `Vector2` `Matrix4` `Matrix3` `Quaternion` `Euler` `Plane` `Box3` `Sphere` `BufferGeometry` `BufferAttribute` `Float32BufferAttribute` `ShapeUtils` `Shape` `Path` `LineCurve`
- 几何生成：`ExtrudeGeometry`、`SVGLoader`
- **零命中**：`ShaderChunk`、`WebGLRenderer`（worker 是纯计算环境，不含渲染层）

**结论四：小程序端没有 manifold、没有 occt。** `scripts/build.mjs` 把 `occt-wasm`、`manifold-3d`、`opentype.js`、`@salusoft89/planegcs`、`brepkit-wasm` 全部 alias 成空 stub，并额外 stub 了 `text-geometry`、`engrave`、`@faicad/faijs/browser` umbrella 与 OCCT 引擎适配器。小程序端的实际执行栈是 **brepkit（wasm BREP 引擎）+ interpreter 后端**。

> occt 的静态引入源头在 **faijs core**（`cad-runtime/runtime.ts:26`、`brep/brep-chain.ts:18` 静态 import `ensureOcctDefaultEngine`），不在小程序端；小程序是靠构建期 stub 把它剔掉的，产物里只剩 7 处 `occt-wasm` / `occtWasm` 字样（brepjs 注册表错误文案，不构成加载）。

**结论五：worker 拿到 0.184 的直接原因不是 faijs 声明了版本，而是构建侧没有做解析定向。** `build-pages.mjs` 用 `import.meta.resolve` + 裸依赖白名单把 `three` 显式指向 `packages/weapp/node_modules/three`；而 **`build.mjs`（worker）没有对应的 alias**，于是 `three` 从 faijs 所在目录向上解析到了根 `node_modules/three`（0.184）。

### 2.5 已有护栏与先例（新工作必须复用，不另起炉灶）

| 先例 | 位置 | 可复用点 |
|---|---|---|
| SDK 零 heavy 依赖守卫 | `sdk.test.ts:22-49` | **照抄这个模式**：读 `dist/*.js`，正则抽静态 `import/export-from` 说明符并断言。本次的「core 入口 three 说明符合规」守卫是它的推广 |
| 宿主入口边界守卫 | `entry-boundary.test.ts` | weapp 入口导出面白名单 + `env-agnostic.ts` 依赖图断言 |
| 三源一致守卫 | `lang/op-set-consistency.test.ts` | 符号表 ≡ `createApiNamespace()` 键集 ⊆ `api/index.ts` 导出面 |
| 编辑器 op 借用计数 | `fcstd/editor-op-boundary.test.ts` | `EDITOR_OWNED` 清单（load/translate/rotate_euler/scale/scale3d/group/assembly/copy） |
| **零依赖自研先例** | `mesh/creased-normals.ts`、`mesh/rigid-transform.ts`、`fcstd/quat-euler.ts` | 已把 three 的 `toCreasedNormals` 完整移植为纯数组数学（`creased-normals.ts` 文件头写明了理由：three helper 会把整个 three 拖进消费者）；另有自写矩阵/四元数，测试用 three 对拍 |

**这三条先例说明：本项目的既定做法就是「用得到的 three 算法搬到 core 自持，测试用 three 对拍」**，本计划沿用同一范式。

### 2.6 端侧能力边界

`packages/weapp/src/ui/tools.ts` 实测：端侧**可跑**的工具是 `box/sphere/cylinder/cone/translate`；`rotate_euler/scale/scale3d` 与 `text/screw/svg-extrude/engrave/knurl/fai_drill/fai_extrude/fai_split` 都在 `END_SIDE_UNSUPPORTED_TOOLS`（`:153-170`）里。

→ **`translate` 是唯一被小程序端依赖的 transform op**（决策点 D1）。

---

## 三、目标与非目标

### 3.1 目标

1. **G1**：把 3d_editor 专属的 op 与预览辅助函数从 `@faicad/faijs`（core）迁出到独立包 `@faicad/faijs-extra`；core 主入口不再承载它们。
2. **G2（核心）**：**faijs 兼容 web 与小程序端**——core 不再对 three 的版本作主张，且只用「基础 API 子集」；小程序 worker 与页面解析到**同一份**宿主 three。
3. **G3**：把 three 中**非基础**的部分（`three/examples/**` addons、SVG 挤出与文字几何生成链）移出 core，小程序不加载。
4. **G4**：`.fai.js` 脚本面零破坏——`cad.fai_drill(...)` 等调用形态、参数、返回语义全部不变。

### 3.2 非目标

- **不追求 core 零 three**。`three` 的数学 / 容器 / 主包生成器（`Vector*`/`Matrix*`/`Quaternion`/`Euler`/`Plane`/`Box3`/`BufferGeometry`/`*Geometry`）在 0.162–0.184 之间稳定，是 core 的合法依赖；要剥离的是**版本主张**与**非基础 API**，不是 three 本身。
- **不用 manifold 替代 three 的几何生成**。小程序端 `manifold-3d` 被构建期 stub 掉（§2.4 结论四），替代过去在小程序端是空转；且 manifold 是 wasm，主包已被 brepkit wasm 1.34M 占死，塞不进第二个 wasm。
- 不改 op 的语义、参数、role 词汇表。
- 不动 `vendored/brepjs/*` 移植树、不动 `packages/demo`。
- 不做 `screw` / `knurl` 的归属变更（决策点 D2，默认留 core）。

---

## 四、总体设计

### 4.1 包划分

新增 `packages/faijs-extra`（包名 `@faicad/faijs-extra`），与既有第三方库（`cq-compat`、`sheetmetal` 等）同构：靠 core 公开的**子路径**消费能力，不 deep-import core 源码。

core `package.json` 的 exports 已覆盖本次所需全部子路径，**无需新增导出**：`./sdk`、`./shape`、`./runtime-state`、`./identity`、`./mesh`、`./mesh/*`、`./brep/*`、`./boolean/*`、`./primitives/*`、`./topology/*`、`./topology/naming`、`./api/*`、`./cad-runtime/*`。

```
packages/faijs-extra/
  package.json
  src/
    index.ts                    # 主入口
    browser.ts                  # 浏览器入口（与 core browser 同构）
    ops/
      fai_drill.ts              # ← core api/fai_drill.ts
      fai_extrude.ts            # ← core api/fai_extrude.ts
      fai_split.ts              # ← core api/fai_split.ts
      transform.ts              # ← core api/transform.ts（视 D1 结论）
      compound.ts               # ← core api/compound.ts 的 group/assembly
      copy.ts                   # ← core api/copy.ts
      load.ts                   # ← core api/load.ts
      text.ts                   # ← core api/text.ts
      svg-extrude.ts            # ← core api/svgExtrude.ts
    mesh/
      fai_drill.ts              # ← core mesh/fai_drill.ts
      fai_split.ts              # ← core mesh/fai_split.ts
      drill-hole/DrillHoleCore.ts  # ← core mesh/drill-hole/DrillHoleCore.ts
    extras/
      svg-extrude.ts            # ← core primitives/svg-extrude.ts
      text-geometry.ts          # ← core primitives/text-geometry.ts
      text-cjk.ts               # ← core primitives/text/cjk.ts 的几何部分
    namespace.ts                # createEditorNamespace()
  (测试随包迁出)
```

依赖声明：

```jsonc
{
  "name": "@faicad/faijs-extra",
  "dependencies": { "opentype.js": "^1.3.4" },
  "peerDependencies": {
    "@faicad/faijs": "^0.16.0",
    "three": "^0.162.0 || ^0.184.0"
  }
}
```

扩展库**可以**用非基础 three API（`SVGLoader` / `ExtrudeGeometry`）——它不在小程序链路上；`three` 同样放 peer，由宿主注入。

### 4.2 迁出清单

**A 组：编辑器专属 op（7 个）**

| op | core 现有实现 | 迁出内容 |
|---|---|---|
| `fai_drill` | `api/fai_drill.ts`、`mesh/fai_drill.ts`、`mesh/drill-hole/DrillHoleCore.ts` | 全部（DrillHoleCore 实测只被 `mesh/fai_drill.ts` 用） |
| `fai_extrude` | `api/fai_extrude.ts`、`mesh/fai_extrude.ts` | 全部 |
| `fai_split` | `api/fai_split.ts`、`mesh/fai_split.ts` | 全部 |
| `group` / `assembly` | `api/compound.ts` | op 定义；`api/assembly/*`（solve/validate/joints/solvers）**留 core**（`jointTrajectory` / `inverseKinematics` / `mechanismDOF` / `solvePreview` 在用） |
| `copy` | `api/copy.ts` | 全部 |
| `load` | `api/load.ts` | 全部（`mesh/io.ts` 的 `importFile` 留 core） |

判定依据：共同点是「实现里带**画布/宿主概念**」——`load` 读应用侧 `FileRef`、`group/assembly` 是场景树结构声明、`copy` 语义含「源与副本各显示一份」、`fai_*` 是编辑器工具链落库形态。它们不是通用 CAD 操作。

**B 组：svg 挤出 / 3D 文字**

- op 层：`cad.text`、`cad.svgExtrude`
- 预览辅助函数：`svgToExtrudedGeometry`、`parseSvgShapes`、`extrudeShapes`、`createTextGeometry`、`getOpentypeFont`、`opentypePathToGeometry`、`createMixedTextGeometry`

同时**必须拆分 `primitives/text/cjk.ts`**：它文件级 `import * as THREE`（`createMixedTextGeometry` 与字体判断同处一个文件），而 `api/text.ts:14` 只 import 它的 `containsCjk` / `loadSystemCjkFont` —— 结果是 `cad.text` 这个 BREP 路径的 op 被 `cjk.ts` 静态拖进了 three。拆分：

- 留 core（新建零 three 模块 `primitives/text/cjk-font.ts`）：`isCjkChar`、`containsCjk`、`loadSystemCjkFont`
- 迁扩展库：`createMixedTextGeometry`

**C 组：留 core（不迁）**

平台面 op（基本体、布尔、chamfer/fillet/knurl/engrave/extrude/revolve/split/pattern/place/import_brep/import_step/compound/sketch/sdf/asset/faceRef/edgeRef/jointTrajectory/…）、`api/assembly/*` 求解器、`mesh/query.ts`、`mesh/io.ts`、`mesh/transform.ts`（视 D1）、`primitives/screw/screw-db.ts`。

### 4.3 `cad.*` 调用形态不变的装配机制

现状：`createRuntimeWithCad.ts:24-31` → `createRuntimeCore(...)` + `rt.registerLib('cad', createApiNamespace(), { default: true, packageName: '@faicad/faijs' })`。op 是**均匀库数据**（`defineOp` 元数据），引擎不按名特判。

方案：core 的 `createApiNamespace()` 只返回**平台面**；扩展库导出 `createEditorNamespace()`（同构对象表，键名与现状完全一致）；由**宿主**合并后注册：

```ts
// 3d_editor worker / electron 装配点
import { createRuntime } from '@faicad/faijs/browser'
import { createEditorNamespace } from '@faicad/faijs-extra/browser'

const rt = createRuntime(ports, mode)
rt.registerLib('cad', { ...createApiNamespace(), ...createEditorNamespace() }, { default: true })
```

**必须同步处理的三处随动**：

1. **符号表**（`lang/symbol-table.generated.ts`，由 `scripts/gen-symbol-table.ts` 从 `api-namespace.ts` 的返回对象字面量静态生成）。实测 `SYMBOL_TABLE` 只被 `lang/op-set-consistency.test.ts` 与 `fcstd/editor-op-boundary.test.ts` 消费，**运行时 `check()` 并不做 callee 存在性校验**，因此迁出不会让 `cad.fai_drill` 的 check 失败。但扩展库 op 若希望被静态符号表覆盖，需提供 `EDITOR_OPS` 名字清单并由宿主装配时注入符号表扩展入口——**这是新增能力，单列一个阶段**。
2. **`api/index.ts` / `index.ts` / `browser.ts`**：删除 A/B 组全部导出与装配注释。
3. **`mesh/index.ts` 的 `cad` 对象**：删除已迁出键。扩展库需要这些 mesh 实现时经 `@faicad/faijs/mesh/*` 子路径取。

### 4.4 three 依赖治理：三条措施（M1 / M2 / M3）

这是本计划解决「兼容 web 与小程序」的核心，也是需求 2 的落地形态。

#### M1 — core 放弃版本主张，构建侧定向解析

**M1a**：`packages/core/package.json` 把 `three` 从 `dependencies` 移到 `peerDependencies`，范围 `^0.162.0 || ^0.184.0`；`devDependencies` 保留 `three` 与 `@types/three`（测试与类型用）。同文件里 `occt-wasm` 已经在 `peerDependencies`——正确形态的先例就在旁边。

**M1b（见效最快，不依赖 core 发版）**：`packages/weapp/scripts/build.mjs` 补一条 `three` 的解析定向，指向 `packages/weapp/node_modules/three`，与 `build-pages.mjs` 的裸依赖白名单同口径。

> M1b 是消除「包内两份 three」的**直接动作**：M1a 只去掉版本主张，若不改构建侧，esbuild 仍会从 faijs 所在目录向上解析到根 `node_modules/three`（0.184）（§2.4 结论五）。

#### M2 — 基础 API 白名单守卫

新增守卫测试，扫 `packages/core/src` 的 three import 语句，按下列判据断言：

- **R1（硬禁）**：禁止 `three/examples/**`（addons）。理由：addons 不在 three 的版本兼容承诺内，且是独立文件、体积不可控。`SVGLoader` 是 core 唯一的 addons 依赖，随 B 组迁出后清零。
- **R2（白名单）**：主包内只允许以下符号集——
  - 数学：`Vector2` `Vector3` `Matrix3` `Matrix4` `Quaternion` `Euler` `Plane` `Box3` `Sphere`
  - 容器：`BufferGeometry` `BufferAttribute` `Float32BufferAttribute`
  - 主包生成器与工具：`BoxGeometry` `SphereGeometry` `CylinderGeometry` `ConeGeometry` `ExtrudeGeometry`（仅随 B 组链使用，迁出后不再出现于 core）`ShapeUtils` `Shape` `Path` `LineCurve` `Line3` `Ray` `Triangle`
- **R3**：白名单外符号即测试失败，出路只有两条——**迁出 core**（进扩展库）或**自研替代**（照 `mesh/creased-normals.ts` 的先例，测试用 three 对拍）。

`R1` 与既有先例同构：`mesh/creased-normals.ts` 之所以自研 `toCreasedNormals`，理由正是「three 的 helper 在 `examples/jsm` 里，会把整个 three 拖进任何消费者」。

#### M3 — 跨端版本校验

- **M3a（faijs 侧）**：白名单符号 smoke 测试，在 `three@0.162` 与 `three@0.184` 两个版本下各跑一遍（vitest alias 切版本，或 CI 双 job），断言行为一致。这是「只准依赖基础 API」的可执行证明。
- **M3b（3d_editor 侧）**：新增守卫，断言 `workers/faijs.js` 与 `pkg-model/pages/model/index.js` 解析出的 three 版本**同源**。实测可用产物内的 REVISION 字面量比对（`build-pages.mjs` 已用同类手法做裸依赖自检）。

#### 与需求 2 的关系（明确取舍）

需求 2 原文是「core 要剥离对 three.js 的依赖」。本计划的执行形态是：

- **剥离的是版本主张与非基础 API**（M1 + M2 + M3）——这是解决跨端冲突的充分条件；
- **不剥离基础 API**（数学 / 容器 / 主包生成器）——它们在 0.162–0.184 之间稳定，剥离它们需要用 manifold 或自研三角化替代，而 manifold 在小程序端是空转（§3.2），收益为负；
- **白名单外的几何生成链**（SVG 挤出、3D 文字）随需求 1 一并迁出（§4.2 B 组），小程序不加载——两个需求在此合流。

### 4.5 保留的可选改造（不阻塞跨端目标）

若后续仍要压缩 worker 体积，可独立评估（不在本计划的验收链上）：

| 类别 | 可选做法 |
|---|---|
| C1 数学 | 收编 `mesh/rigid-transform.ts` / `fcstd/quat-euler.ts` 为 `mathkit/`，替换 C1 文件（测试用 three 对拍） |
| C2 容器 | 引入内部纯数据容器 `{ positions, indices, normals? }`，同步改公共签名（会波及 3d_editor 调用侧，需决策点 D5） |
| C3 基本体 | 自研三角化（box=12 三角、UV 球、圆台侧面+端盖）替换 `*Geometry`；`ShapeUtils.triangulateShape` 需移植约 100 行耳切算法 |

---

## 五、阶段计划

每个阶段独立可验收、可回退；前一阶段的守卫测试是后一阶段的准入条件。

### P0 — 度量与守卫先行（不改动任何行为）

1. 新增 `packages/core/src/three-surface.test.ts`：仿 `sdk.test.ts:22-49`，读 `dist/index.js` / `dist/browser.js` / `dist/weapp.js`，抽取静态 import 说明符，断言：① 不含 `three/examples/**`；② 主包符号 ⊆ M2 白名单；③ 当前含 three 的文件清单 == 基线快照（先把现状钉住）。
2. 新增 M3b 守卫（3d_editor 侧）：比对 worker 与页面产物的 three 版本字面量，当前断言为「不一致」并输出实测值，作为 M1 的验收基线。
3. **验收**：`npm run build -w @faicad/faijs` 后新测试通过并输出基线清单。

### P1 — three 治理（M1 + M2 + M3，最高优先级，改动面最小）

1. **M1a**：core `package.json` 把 `three` 移到 `peerDependencies`（`^0.162.0 || ^0.184.0`），`devDependencies` 保留。
2. **M1b**：`packages/weapp/scripts/build.mjs` 补 `three` 解析定向（对齐 `build-pages.mjs`）。
3. **M2**：落地白名单守卫测试（R1/R2/R3），并按 R3 处置当前越界项——`SVGLoader` 走 P3 迁出，其余越界项在本阶段列清单归档。
4. **M3a**：白名单符号双版本 smoke（0.162 / 0.184）。
5. **验收**：M3b 守卫翻绿（worker 与页面 three 同源）；`workers/faijs.js` 体积下降；core 与 3d_editor 测试全绿。

### P2 — 建扩展库并迁出 B 组（svg / 文字）

1. 建 `packages/faijs-extra`，先落 B 组（风险最低、收益最大）：`primitives/svg-extrude.ts`、`primitives/text-geometry.ts`、`createMixedTextGeometry`。
2. 拆分 `primitives/text/cjk.ts` → `primitives/text/cjk-font.ts`（零 three，留 core）+ 几何部分（迁出）。
3. core `index.ts` / `browser.ts` 摘除 `svgToExtrudedGeometry` / `parseSvgShapes` / `createTextGeometry` / `opentypePathToGeometry` / `createMixedTextGeometry` / `SvgExtrudeOptions` / `CjkFontResult` 导出。
4. **验收**：`dist/browser.js` 静态闭包不再含 `SVGLoader`；P0 的 addons 断言（R1）由「基线允许」翻为硬绿；扩展库单测通过。

### P3 — 迁出 A 组 op（fai_* + group/assembly/copy/load）

1. 迁 `api/fai_drill.ts` / `api/fai_extrude.ts` / `api/fai_split.ts` / `api/copy.ts` / `api/load.ts` / `api/compound.ts` 的 `group`/`assembly`，连同 `mesh/fai_drill.ts` / `mesh/fai_split.ts` / `mesh/fai_extrude.ts` / `mesh/drill-hole/DrillHoleCore.ts`。
2. import 源改为 core 子路径（`@faicad/faijs/sdk`、`/shape`、`/runtime-state`、`/brep/*`、`/boolean/csg-backend`、`/mesh/query`、`/mesh/io`、`/api/assembly/*`、`/topology/naming/*`）。
3. core 摘除：`api/index.ts`、`api/api-namespace.ts`（A 组键）、`index.ts`、`browser.ts`、`mesh/index.ts`（`cad` 对象的对应键）。
4. 更新 `fcstd/editor-op-boundary.test.ts` 的 `EDITOR_OWNED` 清单指向。
5. 新增 `createApiNamespace(extra?)` 与 `createEditorNamespace()`，加**成员完整性守卫**：`cad` 键集 == 平台面清单 ∪ `EDITOR_OPS`。
6. **验收**：`op-set-consistency` 三源一致仍绿；`npm run test --workspaces` 全绿。

### P4 — 3d_editor 侧同步（逐项）

1. `packages/app/src/engine/**` 与 `packages/platform/**` 中从 `@faicad/faijs/browser` 导入的 B 组符号改为 `@faicad/faijs-extra/browser`。
2. worker / electron 装配点增加扩展 namespace 合并（§4.3）。
3. 更新 `packages/app/src/engine/__tests__/contract-entry.test.ts` 白名单：移除已迁出符号，新增扩展库入口白名单锁。
4. `packages/weapp/scripts/build.mjs` 的 `weapp-text-stub` / `weapp-engrave-stub` 按迁移结论复核是否可删。
5. **验收**：3d_editor `npm run test:unit` + `npm run lint` 通过；fai_drill / svg / 文字相关交互可用。

### P5 — 符号表扩展机制

1. 扩展库提供 `EDITOR_OPS` 名字清单；core 新增符号表扩展注册入口。
2. 宿主装配时注入，使扩展库 op 也进入静态符号表。
3. **验收**：`cad.fai_drill` 在符号表中可查；`editor-op-boundary` 断言仍绿。

### P6 — 收尾

1. core `package.json`：`opentype.js` 随 B 组迁出后从 dependencies 移除（需先确认 `brep/text/text-to-solid.ts` 是否也用它）。
2. `packages/core/src/index.ts` / `browser.ts` 删除已迁出的 D 类预览导出。
3. 新建/更新 Agent Note；`docs/ops-api-inventory.md`、`api/api-namespace.ts` 注释同步。
4. `entry-boundary.test.ts` 登记新包入口约束。
5. **验收**：`pwsh -NoProfile scripts/ci.ps1` 全绿；`node scripts/check-ghost-deps.mjs` 通过。

---

## 六、公共 API 变更清单（3d_editor 必须同步）

| 变更 | 性质 | 3d_editor 侧动作 |
|---|---|---|
| A/B 组 op 从 `@faicad/faijs` 迁到 `@faicad/faijs-extra` | import 来源变，**语义不变** | 装配点合并 namespace；无需改脚本 |
| svg/文字预览辅助函数换包 | import 来源变 | 改 import |
| core 的 `three` 变 peer | 依赖性质变 | 3d_editor 已直接声明 three，无需新增；小程序侧按 M1b 定向 |
| C2 容器纯数据化（仅当 D5 决定做） | **签名变** | 调用侧加薄包装 |

---

## 七、守卫矩阵（每个阶段都要加，不留裸改造）

| 守卫 | 位置 | 断言 |
|---|---|---|
| **three addons 零依赖** | 新增（仿 `sdk.test.ts`） | `dist/**` 静态 import 说明符不含 `three/examples/**` |
| **three 基础 API 白名单** | 新增 | 主包符号 ⊆ M2 白名单；越界即红 |
| **跨端 three 同源** | 新增（3d_editor 侧） | worker 产物与页面产物 three 版本字面量一致 |
| **双版本 smoke** | 新增（faijs 侧） | 白名单符号在 0.162 / 0.184 下行为一致 |
| cad 成员完整性 | 新增 | `cad` 键集 == 平台面清单 ∪ `EDITOR_OPS` |
| core 不含消费面符号 | 新增 | core 主入口导出面不含 `fai_` 前缀符号、不含 A/B 组符号 |
| 扩展库零 core 深路径 | 新增 | 只 import core 的 exports 子路径 |
| 幽灵依赖 | 既有 `scripts/check-ghost-deps.mjs` | 每个 import 都声明在自身 package.json |
| 三源一致 | 既有 `lang/op-set-consistency.test.ts` | 平台面符号表 ≡ cad 平台面 ⊆ `api/index.ts` |
| 无环 | 既有 `npx madge --circular packages/*/src` | 扩展库单向依赖 core |

---

## 八、决策点（需拍板后方可进入对应阶段）

**D1 — transform 家族（`translate` / `rotate_euler` / `scale` / `scale3d`）归属**

- 现状：`api/transform.ts`；`fcstd/editor-op-boundary.test.ts` 把它们列为 `EDITOR_OWNED`；但小程序端 `packages/weapp/src/ui/tools.ts` 实测**只有 `translate` 可跑且在用**。
- 选项 A（推荐）：`translate` **留 core**（通用几何变换 + 小程序端在用），`rotate_euler` / `scale` / `scale3d` 随扩展库。
- 选项 B：四个全部随扩展库 → 小程序端失去 `translate`。
- 选项 C：四个全部留 core → 需改写 `editor-op-boundary.test.ts` 的 `EDITOR_OWNED`。

**D2 — `screw` / `knurl` 归属**

- 二者都是 three 使用者（`primitives/screw/screw.ts`、`mesh/knurl/*`）。
- 推荐：**留 core**。它们是通用 CAD 特征（螺纹、滚花），不是编辑器交互模型专属；且所用 API 都在白名单内，peer 化后不构成跨端风险。

**D3 — `cad.text` / `cad.svgExtrude` 两个 op 是否随 B 组迁出**

- 用户原话点名「svg挤出、3D文字」。
- 实测：这两个 op 的 **BREP 路径**（`brep/svg/svg-to-solid.ts`、`brep/text/text-to-solid.ts`）零 three，但 **mesh 路径**经 `import { cad } from '../mesh'` → `primitives/svg-extrude.ts` / `createTextGeometry` **是 three 的**（`api/text.ts:9`、`api/svgExtrude.ts:10`）。
- 推荐：**op 随 B 组迁出**，一次性清掉 `SVGLoader` 这个唯一的 addons 依赖。

**D4 — 扩展库包命名**

- 推荐 `@faicad/faijs-extra`；core 包名已是 `@faicad/faijs`。

**D5 — C1/C2/C3 的可选改造（§4.5）是否启动**

- 不启动（推荐）：M1+M2+M3 已解决跨端冲突，worker 体积的主要收益来自 B 组迁出。
- 启动：额外获得 core 零 three，代价是公共签名变更波及 3d_editor 与 `packages/tests`，且需自研耳切三角化。

---

## 九、风险

1. **`mesh/index.ts` 的 `cad` 对象是 core 内部的事实标准实现入口**，扩展库若整体 import `@faicad/faijs/mesh`，会把 core 的 three 一并带回——扩展库本来就有 three，可接受，但必须保证**扩展库不是 core 白名单的回漏通道**（守卫：core 侧白名单达标后，`@faicad/faijs/mesh` 自身也达标）。
2. **M1b 是 3d_editor 侧改动**，与 core 发版解耦；若只做 M1a 不做 M1b，跨端冲突不会消失（§2.4 结论五）。两者必须成对验收。
3. **符号表是静态生成的**（`scripts/gen-symbol-table.ts` 解析 `api-namespace.ts` 字面量）。扩展库 op 若不进符号表，依赖「callee 存在性」的静态检查会漏——由 P5 补齐。
4. **161 个 3d_editor 文件引用 faijs**，白名单锁 `contract-entry.test.ts` 是硬门禁；P4 必须逐项同步。
5. **`opentype.js` 是 B 组文字解析的运行时依赖**，迁出前需确认 `brep/text/text-to-solid.ts` 是否也用它（若用，core 仍需保留）。
6. **白名单外符号的处置需要逐项决策**：P1 阶段会产出完整越界清单，每项须选定「迁出」或「自研替代」后再动工。

---

## 十、版本与发布

- `@faicad/faijs` **0.16.0**：A/B 组导出迁出；`three` 由 `dependencies` 改为 `peerDependencies`（breaking：消费面 op 换包 + 预览辅助函数换包）。
- `@faicad/faijs-extra` **0.1.0**：首版，peer `@faicad/faijs ^0.16.0`、`three ^0.162.0 || ^0.184.0`。
- 发布顺序：先发 core 0.16.0，再发 editor 0.1.0；3d_editor 的 `package.json` 同步新增 `@faicad/faijs-extra` 依赖并重打 tgz 验证。
- **M1b 可先于发版单独落地**（纯 3d_editor 构建脚本改动），建议优先实施。
- `.fai.js` 存量场景**零迁移**（G4）。
