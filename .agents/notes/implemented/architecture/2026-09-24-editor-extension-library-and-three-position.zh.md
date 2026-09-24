# Agent Note: 编辑器扩展库拆分与 three.js 的版本立场

Status: implemented

[English](2026-09-24-editor-extension-library-and-three-position.md) | 中文

## Problem

两条需求同时到达：

1. 只有姊妹项目 `3d_editor` 用到的 op 必须离开 core：所有 `fai_` 前缀 op，以及 SVG 挤出与 3D 文字创建器。
2. faijs 必须同时跑在 web 宿主与小程序宿主上，而两者的 `three` 版本永久分裂——小程序页面锁 r162（端侧 canvas 只有 WebGL1，three 自 r162 之后不再创建 WebGL1 渲染器），web 宿主跟随 r184。

两条需求交汇于同一点：版本分裂无法靠升级任一侧消除，因此引擎必须放弃版本立场。这意味着把 `three` 声明为 peer **范围**、把自己限制在该范围上稳定的 API 子集内，并把 three 的非基础部分——`three/examples/**` addons 与 `Shape`/`ExtrudeGeometry` 链——整体移出 core。

改动前的实测：同一次小程序构建里存在两份 three（页面的 r162 与 worker 的 r184），原因是 faijs `dist/` 内所有 `three` import 都向上解析到了 web 宿主提升的那份 r184。core 的 addon 依赖有两个（`SVGLoader` 与 `STLLoader`），而不是设计草稿里假设的一个。

## Decision

**编辑器 op 由独立包承载。** `@faicad/faijs-extra` 承载编辑器专属组（`fai_drill`、`fai_extrude`、`fai_split`、`group`、`assembly`、`copy`、`load`）与创建器组（`text`、`svgExtrude`），以及预览辅助函数（`svgToExtrudedGeometry`、`parseSvgShapes`、`extrudeShapes`、`createTextGeometry`、`getOpentypeFont`、`opentypePathToGeometry`、`createMixedTextGeometry`）。core 的 `createApiNamespace()` 只返回平台面；由宿主合并两者。

op 名字、签名与语义不变，因此只要宿主合并命名空间，存量 `.fai.js` 脚本继续可用——拆分改变的是 import 来源，从不改脚本文本。

**扩展库分成两个入口。** `@faicad/faijs-extra/editor-ops` 只承载编辑器专属组，且永不触达 `three/examples`；根入口再加上 SVG / 3D 文字创建器。小程序 worker 挂载前者：它必须能重放含 `cad.group` / `cad.copy` / `cad.load` 的 web 端脚本，但不得打包 SVG loader 与 `Shape`/`ExtrudeGeometry` 链。该边界由构建产物断言，不靠假设。

**transform 家族留在 core。** `translate`、`rotate_euler`、`scale`、`scale3d` 仍是平台 op。`translate` 是通用几何变换，且是端侧唯一执行的 transform op；拆散该家族会让端侧失去它。

**core 保留 `engrave` op，装饰几何由宿主提供。** `cad.engrave` 是平台 op，但其 mesh 路径需要文字/SVG 几何。core 经 `setEngraveDecorationProvider` 向宿主索取该几何——与 `setFontLoader`、`setKnurlTextureLoader` 同一种能力注入形态。BREP 路径不受影响：它直接用 OCCT 构造装饰实体，不需要 provider。

**three 变为 peer，addons 离开 core。** `three` 从 `dependencies` 移到 `peerDependencies`，范围为 `^0.162.0 || ^0.184.0`，并保留为 devDependency 以便构建与测试。core 用自己的 STL 解析替换 `three/examples/jsm/loaders/STLLoader.js`（`mesh/stl-loader.ts`），`SVGLoader` 随创建器组离开。白名单守卫钉住 core 可触碰的 three 符号；双版本 smoke 测试对两份已安装副本跑同一份白名单 API，并逐项数值比对。

**宿主必须定向 three 的解析。** 仅仅去掉版本主张并不够：小程序 worker 的构建没有 `three` 解析规则，faijs 的 import 仍落在 web 宿主提升的那份副本上。worker 构建现在从自身包解析 `three`，与 pages 构建早已采用的口径一致。

**静态符号表接受宿主注册的名字。** 生成表严格等于「core 平台面」；库经 `registerSymbolTableEntries` 注册自己的名字，且不得覆盖平台函数。因此库永远不能悄悄重定义某个键集。

## Alternatives considered

**把 op 留在 core，依赖 tree-shaking。** 否决：addons 既能被静态也能被动态 import 触达，「未使用」的代码照样进包；且小程序构建的 stub 表按文件名匹配，改名会静默失效。只有物理分离才让边界可校验。

**用 `manifold-3d` 取代 three 的几何生成。** 否决：小程序构建把 `manifold-3d` 整体 stub 掉，替代在它本该帮助的宿主上是空转；主包也没有空间再放一份 wasm。

**把 three 的 `STLLoader` vendor 进 core。** 否决：这段移植小到可以直接自持；且像 `creased-normals.ts` 移植 `toCreasedNormals` 那样自持，就不留 addon import 需要守卫。

**把 `engrave` 移到扩展库。** 否决：`engrave` 是 BREP 路径零 three 的平台 op；为了解一个 mesh 路径的依赖而移动它，等于重新定义平台面。注入式装饰 provider 让 op 留在原位、把依赖反向。

**断言 three 版本，而不是断言 API 子集。** 否决：断言只在消费方装错版本之后才失败；把 core 限制在稳定子集里是从根上避免不兼容，双版本 smoke 测试则证明该限制确实成立。

**把编辑器 op 放进 core 的子目录，用私有子路径隐藏。** 否决：隐藏的子路径照样发布、照样能被深路径 import，任何选择它的消费方照样会把 addons 拖进来。需求是 core 不承载它们。

## Consequences

- `@faicad/faijs` 0.16.0 是破坏性版本：编辑器 op 及其预览辅助函数迁到 `@faicad/faijs-extra` 0.1.0，`three` 变为 peer。姊妹仓库中声明 `^0.15.0` peer 的包已对齐到 `^0.16.0`，以保证全新安装可解析。
- 需要编辑器 op 的宿主必须合并命名空间：`createEditorCadNamespace()` 返回平台面与编辑器 op 的并集，`registerEditorSymbols()` 扩展静态分析，`installEditorMeshProviders()` 装上 engrave 装饰 provider。
- core 的测试套件与集成测试套件按宿主的方式装配命名空间，走仅测试用的支撑模块——发布包仍不依赖扩展库，那会构成环。
- 白名单守卫在 core 中硬禁五个名字：`Shape`、`ExtrudeGeometry`、`Path`、`LineCurve`、`SVGLoader`。重新引入它们只有两条路：迁到扩展库，或自持移植并配一份对拍测试。
- `ConeGeometry` 是实测的 r162/r184 差异（r163 改了圆锥三角化）。core 对所有非退化圆台都走 `CylinderGeometry`，因此该差异落在平台路径之外；smoke 测试记录了这项豁免，并在它失效时报错。
- `packages/core/src/mesh/api.d.ts` 已重新生成：平台 `cad` 面不再列出已迁出的 op。
- **顺带清掉的既有红项（一个变更集一份 Note）。** 有四簇失败早于本次改动、却卡住 CI 门禁；每一簇都是「有明示修法的漂移」，因此在本变更集中一并清掉，而不是留着：过期的 `capability-map.json`（已重生成——它此前仍留着 `transformCopy`，而 arg-spec 已标其 skip）；随之过期的两处快照（`engine-switch-p3` 的方法数与接口清单，以及内嵌该 map 的 inventory 生成器——这条耦合已作为 `GOTCHA` 写进生成器）；`bindOcctKernel()` 的调用点（移除文案已给出替代 `injectCurrentBrepEngineAsKernel()`，但它要求先注册引擎，且 **`registerOcctBrepEngine()` 是 async**——漏 `await` 会以「no BREP engine registered」失败）；集成套件的类型漂移（`DualOpOptions.naming` 必填，命名行的 `origin` 是 `StmtId` 且 `origin`/`role` 可空）；以及 D8 层边界守卫——现在承认**两个登记桥接点**：`api/`（内核注入桥）与 `brep/engine/adapters/`（复用 vendored OCCT 适配器组合面的引擎适配器），并对 `*.test.ts` 豁免（parity 测试按设计与移植树对拍，且不进产物）。守卫的宗旨不变：任何触达移植树的代码都必须落在登记桥接点上。
