# 方案：剥离 vendored brepjs + brepjs-compat 为独立子包

状态：方案（未实施）

> 本方案的每一条现状事实均以 2026-09-24 当前源码实测为准（复核命令随条给出）。
> 事实来源一律是代码与脚本，不引用其它方案文档。

## 0. 用户原话（需求原始记录）

> 分析本项目vendor的brepjs代码，是否能把它从core中剥离，变成一个子包

> 好的，写一份文档剥离brepjs，此外，子包sheetmetal应该是依赖brepjs和brepjs-compat，请分析这部分的依赖。把brepjs-compat和brepjs一起剥离成子包，然后让sheetmetal依赖这个新的子包。

## 0.1 用户裁决（2026-09-24，本方案的既定前提）

1. **新包保留 `@faicad/faijs-brepjs` 命名**，即便它与 U8 品牌守卫
   （`scripts/check-vendored-branding.mjs` A3/A4）冲突；冲突通过**放宽守卫**解决，
   不通过改名规避。放宽方案见 §5.1。
2. **新包是可发布包，随 `@faicad/*` 一起发布到 npm**。由此带来发布顺序、
   CDN importmap / versions、lockstep range 的硬约束，见 §5.2–§5.4。

## 1. 目标

把 `packages/core/src/vendored/brepjs/`（260 个 `.ts`，262 个文件，2.2 MB）与 core 内的
brepjs-compat 兼容面一起剥离为独立子包 `@faicad/faijs-brepjs`，并让
`@faicad/sheetmetal` 改为依赖该新子包，不再经 `@faicad/faijs` 中转。

## 2. 现状依赖分析（实测，2026-09-24）

### 2.1 vendored/brepjs 树本身

实测命令：

```bash
find packages/core/src/vendored -name '*.ts' | wc -l            # 260
find packages/core/src/vendored -type f | wc -l                 # 262
du -sh packages/core/src/vendored                               # 2.2M
grep -rhoP "from '\K[^'.][^']*" --include='*.ts' packages/core/src/vendored/brepjs | sort | uniq -c
```

- **对 core 零反向依赖**：树内没有任何 import 指向 core 的 `api/`、`brep/`、`mesh/`、
  `cad-runtime/` 等目录。`kernel/index.ts` 中的 `@faicad/faijs` 仅出现在注释（D10 说明）。
- **外部依赖仅 2 个真依赖**：`flatbush` 4 处（`2d/blueprints/blueprintOffset.ts`、
  `intersectionSegments.ts`、`lib.ts`、`2d/lib/stitching.ts`）、`opentype.js` 1 处
  （`text/fontRegistry.ts`）。
- **`occt-wasm` 零直接 import**：树内 130+ 处 `occt-wasm` 字样**全部**落在注释、JSDoc
  示例与错误字符串里，其中形似 import 的只有
  `kernel/occtWasm/occtWasmAdapter.ts:16` 与 `:28` 两行 JSDoc 示例
  （`* import { OcctKernel } from 'occt-wasm';`）。运行时依赖确实由 faijs 侧
  `initOcctWasm()` 经 `api/occt-kernel-bridge.ts` 构造 adapter 后
  `registerKernel('occt-wasm', adapter)` → `freezeKernels()` 注入（D10 单实例绑定），
  **原结论成立**。
- **`from 'brepjs/xxx'` 自引用是伪事实（修正）**：树内 7 处 `from 'brepjs/…'`
  全部是 7 个入口文件的 **JSDoc 注释示例行**（`2d.ts:6`、`io.ts:6`、`operations.ts:6`、
  `projection.ts:6`、`sketching.ts:6`、`text.ts:6`、`topology.ts:6`，行首均为 `*`），
  **真实 import 为零**。原方案据此设计的 tsconfig `paths` / vitest alias 方案作废，
  改为 §4.4 处理。
- **树内零测试文件**：`find … -name '*.test.ts'` 计数为 0。相关 parity/surface 测试
  都在 core 侧（如 `brep/engine/measurement-parity.test.ts`）。
- **strict 类型检查全量通过（实测）**：以 core 的 compilerOptions 对
  `src/vendored/brepjs/**/*.ts` 全量 260 文件跑 `tsc --noEmit`，**0 错误**。
  说明此前 core/根 tsconfig 的 `exclude` 是速度/隔离考虑，不是错误规避；
  新包把整树纳入 typecheck 不会引爆错误（§5.5 据此放宽）。

### 2.2 core → vendored 的引用（39 个文件，实测全量清单）

实测：`grep -rl 'vendored/brepjs' --include='*.ts' packages/core/src`（排除 vendored 自身）= 39 个文件。

| 位置 | 文件数 | 说明 |
|---|---|---|
| `api/generated/*` | 13 | 生成面。import 说明符合计 **459 条**（`topology.ts` 129、`core.ts` 116、`operations.ts` 77、`kernel.ts` 38、`measurement.ts` 27、`gear.ts` 14、`2d.ts` 12、`io.ts` 12、`ns.ts` 9、`query.ts` 8、`projection.ts` 7、`sketching.ts` 5、`text.ts` 5）。形态均为相对路径 `'../../vendored/brepjs/xxx.js'` |
| `api/generated/brepjs/index.ts` | 1 | 生成面的 brepjs 子目录入口 |
| **`api/assembly/*`** | **10** | **原方案遗漏**：`entities.ts`、`joints.ts`、`lower.ts`、`pose.ts`、`preview.ts`、`solve.ts`、`solvers/global-solver.test.ts`、`pose.test.ts`、`preview.test.ts`、`solve.test.ts` |
| `api/brepjs-compat/index.ts` | 1 | 手写兼容面，43 条 vendored import |
| `api/internal/*` | 3 | `l3-bridge.ts`、`profile-wire.ts`、`result-unwrap.ts`（**原方案误记为 ~10**） |
| `api/occt-kernel-bridge.ts` | 1 | D10 唯一绑定点：注册 adapter、冻结 registry |
| **`api/loft.ts`、`api/replicate.ts`、`api/revolve.ts`、`api/sweep.ts`、`api/thicken.ts`、`api/result.ts`、`api/view/view-camera.ts`、`api/view/view-projection.ts`** | **8** | **原方案遗漏** |
| `occt-kernel/occt-primitives.ts` | 1 | import `OcctWasmAdapter`（反向接缝，见 §4.3） |
| `brep/engine/measurement-parity.test.ts` | 1 | 测试 |

另有 7 个 codegen 脚本引用 vendored 路径（实测 `grep -c vendored` 计数）：
`gen-l3-surface.ts`(19)、`gen-vendored-classify.ts`(16)、`gen-vendored-surface.ts`(15)、
`gen-surface-emit.ts`(9)、`gen-capability-map.ts`(7)、`gen-surface-check.ts`(6)、
`gen-upstream-surface.ts`(1)。其中只有前 4 个用 `VENDORED_ROOT` 常量，
`gen-l3-surface.ts` 用的是 `VENDORED_ROOT_REL = '../../vendored/brepjs/'`（相对
`api/generated/` 的 emit 路径常量），改线时必须连 emit 出的相对路径一起改。

### 2.3 sheetmetal 的依赖（实测）

实测：`grep -rhoP "from '\K@faicad/faijs[^']*" --include='*.ts' packages/sheetmetal/src`

| 说明符 | 处数 |
|---|---|
| `@faicad/faijs/brepjs-compat` | 47 |
| `@faicad/faijs/occt-kernel/occtKernel` | 1 |
| `@faicad/faijs/brep/engine/adapters/occt` | 1 |
| `@faicad/faijs/api/occt-kernel-bridge` | 1 |

- **零深引 vendored 树**（`@faicad/faijs/vendored/brepjs/*` 不存在）✓ 原结论成立。
- 后 3 条是内核装配入口（test-setup 装配用），**保持从 `@faicad/faijs` 导入**（§4.5）。
  这决定了 sheetmetal **不可能 100% 脱离 faijs**，`@faicad/faijs` peer 必须保留。
- `packages/sheetmetal/vitest.config.ts` 注释中"compat.ts 是唯一桥接点"已过时，
  实际入口是 `@faicad/faijs/brepjs-compat`。
- 实测 `packages/{tests,fixtures,demo,faijs-extra,fcstd,cq-compat*}` 对
  `brepjs-compat` / `vendored` 的使用**全部为 0**——改线范围只有 core 与 sheetmetal。

### 2.4 brepjs-compat 的依赖尾部（本次剥离的真正难点）

`api/brepjs-compat/index.ts`（534 行）实测构成：

```
api/brepjs-compat/index.ts
├── api/internal/compat-projection.ts   ← runtime-state / occt-kernel-bridge
├── api/internal/dual-form-args.ts      ← shape（isShape）
├── 43 条 vendored import（§2.2）
└── 31 处语义 wrap（见下）
```

**wrap 数量修正**：原方案写"12 处 wrap 调用点"，实测为 **31 处**：

- `box` —— 手写的 dual-form + `assertKernelBound('box')` 重载实现（含
  `BoxDimensions` 接口与 `E_ARGS_FORM` 报错）；
- `wrapDual` 3 处：`cone`、`torus`、`ellipsoid`；
- `wrapGuarded` 26 处：`fuse`、`cut`、`extrude`、`revolve`、`loft`、`intersect`、
  `fillet`、`chamfer`、`makeCompound`、`makeVertex`、`applyMatrix`、`simplify`、
  `makeCircle`、`makeEllipseEdge`、`makeLine`、`assembleWire`、`makeFace`、
  `addHolesInFace`、`makeThreePointArc`、`makeTangentArc`、`makeBSplineInterpolation`、
  `curveTangentAt`、`curvePointAt`、`makeExternalGear`、`makeInternalGear`、
  `makePlanetaryGear`、`thread`；
- `rotate` —— 手写的 upstream 对齐 wrap（把位置四参形式包成 `{ at, axis }` 选项形式）。

其余为**纯 re-export**（`sphere`、`cylinder`、查询族、测量族、Sketcher/FaceSketcher、
draw*、`ok/err/isOk/isErr/unwrap/unwrapOr/map/andThen`、vec*、plane*、
`kernelError`/`validationError`、常量、全部类型，以及 ⑤ 段的 raw 直出面：
`line`/`wire`/`wireLoop`/`face`/`polygon`/`outerWire`/`getSurfaceType`/
`pointOnSurface`/`normalAt`/`faceCenter`/`sharedEdges`/`curveStartPoint`/
`curveEndPoint`/`translate`/`isSolid`/`isPlanarWire`/`isValid`）。

尾部继续深入 core（同原方案）：

- `runtime-state.ts` → 仅 type-only import `identity`；
- `shape.ts` → `runtime-state` / `identity` / `mesh/types`（类型）/ `topology/naming/lineage`；
- `topology/naming/lineage.ts` → `brep/face-evolution` → `occt-kernel/occtKernel` + brep engine；
- `occt-kernel-bridge.ts` → `occt-kernel/occtKernel`、`brep/engine/registry`、vendored kernel。

即：**brepjs-compat 不是 vendored 树上的薄皮，它长在 faijs 的运行时状态机与 BREP
引擎注册体系上**。整体搬家会连带搬 runtime-state / shape / lineage / 引擎注册，
等于把 core 一分为二——代价与风险都不可接受。**原结论成立。**

## 3. 剥离方案

### 3.1 包形态

新建 workspace 包 `packages/brepjs`，包名 `@faicad/faijs-brepjs`（命名裁决见 §0.1）：

- **内容物 A**：现 `packages/core/src/vendored/brepjs/` 整树（含 `NOTICE`、`README.md`、
  `ambient.d.ts`），原样迁入 `packages/brepjs/src/`（目录内部相对结构与 import 全部不变）。
- **内容物 B**：无。compat 门面**不迁入**（§4.1）。
- **新包不新建任何符号实现**：新包 `"."` 出口 = vendored `index.ts` 原样，全部符号
  保持"一份实现、多处投影"（§4.6）。

**依赖方向裁定**：`@faicad/faijs-brepjs` **不依赖 core**；core 依赖新包。
因此新包内不能出现 `runtime-state` / brep engine 的运行时 import，也不做内核断言
（§4.7）。

### 3.2 新包 package.json（修正版）

```jsonc
{
  "name": "@faicad/faijs-brepjs",
  "version": "0.16.2",            // 随本次 bump 后的版本线，见 §6.7
  "license": "Apache-2.0",        // vendored 部分随迁；core LICENSE 的 Apache-2.0 条目移除
  "type": "module",
  "sideEffects": false,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "NOTICE", "LICENSE"],
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    // 关键：vendored 树沿用 `.js` 后缀说明符约定（core compat 门面注释明确"the `.js`
    // specifiers are the repo convention"）。若只声明 "./*" 且 types 用 "./dist/*.d.ts"，
    // 说明符 `topology/primitiveFns.js` 会因 `*` 吞掉 `.js` 而解析成
    // `./dist/topology/primitiveFns.js.d.ts`（不存在）。"./*.js" 的 `*` 只捕获
    // `topology/primitiveFns`，types → `./dist/topology/primitiveFns.d.ts`，正确。
    // Node 取最具体匹配，"./*.js" 优先于 "./*"。
    "./*.js": { "types": "./dist/*.d.ts", "default": "./dist/*.js" },
    "./*": { "types": "./dist/*.d.ts", "default": "./dist/*.js" }
  },
  "dependencies": { "flatbush": "^4.6.2", "opentype.js": "^1.3.4" },
  "peerDependencies": { "occt-wasm": "^3.8.4" },  // DI 形态：零直接 import，仅为类型
  "devDependencies": { "typescript": "*", "vitest": "*" },
  "scripts": {
    // 与 core/sheetmetal 同构：tsc 输出后必须跑 fix-import-extensions，
    // 否则 bundler 模式产出的无后缀相对 import 在 Node ESM 下不可用。
    "build": "tsc -p tsconfig.build.json && node ../../scripts/fix-import-extensions.mjs dist",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint src"
  }
}
```

配套：

- 新包 `tsconfig.json` 复制 core 的 compilerOptions（`moduleResolution: bundler`、
  `strict`、lib 含 DOM），`include: ["src/**/*.ts"]`，**不设 vendored exclude**
  （§2.1 实测 260 文件零错误）。
- 新包 `tsconfig.build.json` 同 core 形态（`noEmit: false`、`outDir: dist`、
  `rootDir: src`、`declaration`、`paths: {}`）。
- 新包 `LICENSE` = Apache-2.0 全文；`NOTICE` = 现 `packages/core/NOTICE` 的 brepjs 段落
  + 现 `packages/core/src/vendored/brepjs/NOTICE` 合并。
- **core 侧依赖**（注意 range 形态）：
  - `dependencies` 增加 `"@faicad/faijs-brepjs": "^0.16.0"`。
    **修正**：原方案写死 `"0.16.1"`，会被 `check-dep-lockstep.mjs` 判失败——该守卫要求
    registry range 必须**恰好等于** `^<目标 major.minor>.0`（目标 0.16.x → 只能 `^0.16.0`）。
  - **移除 `flatbush`**：实测 core 非 vendored 部分零 flatbush 引用
    （`grep -rn "from 'flatbush'" packages/core/src` 排除 vendored 后无命中），
    它只为 vendored 存在。
  - **保留 `opentype.js`**：core 的 `brep/text/fontRegistry.ts`、
    `brep/text/text-to-solid.ts`、`primitives/text/cjk-font.ts` 仍在用。
- **workspaces 顺序**：`packages/brepjs` 必须排在 `packages/core` **之前**
  （`check-workspaces-order.mjs` 断言：A 声明依赖 B ⇒ A 的 index > B 的 index；
  该守卫同时检查 dependencies/devDependencies/peerDependencies）。

### 3.3 core 侧改线

1. `api/generated/*` 13 个生成文件（459 条说明符）：`'../../vendored/brepjs/...'` →
   `'@faicad/faijs-brepjs/...'`，并重跑 7 个 codegen 脚本
   （`VENDORED_ROOT` 改指 `packages/brepjs/src`；`gen-l3-surface.ts` 的
   `VENDORED_ROOT_REL` 改为 emit 出的包说明符前缀）。
2. `api/assembly/*`（11）、`api/internal/*`（3）、`api/occt-kernel-bridge.ts`、
   `api/{loft,replicate,result,revolve,sweep,thicken}.ts`、
   `api/view/{view-camera,view-projection}.ts`、`occt-kernel/occt-primitives.ts`、
   `brep/engine/measurement-parity.test.ts`：同上机械替换。
3. `api/brepjs-compat/index.ts`：43 条 vendored 相对 import 改为
   `'@faicad/faijs-brepjs/...'`；**31 处 wrap 与 `BoxDimensions` 原样保留**。
   对外 `@faicad/faijs/api/brepjs-compat` 与 `@faicad/faijs/brepjs-compat`
   两个子路径**原样保留**（CDN `+esm` 契约不变）。
4. 根门面 `src/index.ts` / `api/index.ts` 的 `brepjsCompat` 命名空间导出不变。
5. tsconfig：
   - core `tsconfig.json` 的 `exclude` 移除 `"src/vendored"`；
   - **根 `tsconfig.json` 的 `exclude` 也要移除 `"packages/core/src/vendored"`**
     （原方案遗漏），并决定新包是否被根 `include: ["packages/*/src/**/*.ts"]` 纳入
     ——见 §5.5 裁定；
   - core / 根 tsconfig 的 `paths` 增加
     `"@faicad/faijs-brepjs": ["../brepjs/src/index.ts"]`、
     `"@faicad/faijs-brepjs/*": ["../brepjs/src/*"]`。
   - 注意：`tsconfig.build.json` 的 `paths: {}` 会清空映射，**build 阶段靠
     node_modules symlink + 新包 `dist/*.d.ts` 解析**，故新包必须先构建（§3.5）。
6. LICENSE/NOTICE：Apache-2.0 归属条目从 `packages/core/LICENSE`（第 27–29 行）与
   `packages/core/NOTICE`（第 4–11 行）迁至新包。

### 3.4 sheetmetal 改线（按符号清点结果修订）

**不新建 `@faicad/faijs-brepjs/compat` 子入口**（§4.6）。改线形态：

1. 47 处 import 中 **46 处**整体改线：说明符由
   `'@faicad/faijs/brepjs-compat'` 改为 `'@faicad/faijs-brepjs'`；
2. **1 处拆成两行**：`src/foreignUnfold.test.ts:3` 是唯一同时含 `box`、`fuse` 的
   import 语句（实测），改写为
   ```ts
   import { cylinder, sphere, translate, getFaces, getSurfaceType } from '@faicad/faijs-brepjs'
   import { box, fuse } from '@faicad/faijs/brepjs-compat'   // wrap 面，保留（§4.2）
   ```
   由于 `box`/`fuse` 只出现在**测试文件**里，sheetmetal 的产品代码可 100% 走新包；
3. `packages/sheetmetal/package.json`：`peerDependencies` 增加
   `"@faicad/faijs-brepjs": "^0.16.0"`；**保留** `@faicad/faijs` peer
   （内核装配 3 处 + `box`/`fuse` 仍需它）；
4. `packages/sheetmetal/vitest.config.ts`：alias 增加
   `{ find: '@faicad/faijs-brepjs', replacement: resolve(__dirname, '../brepjs/src') }`；
   过时注释（"compat.ts 是唯一桥接点"）同步更新。
   Vite/rollup alias 的 `find` 为字符串时按 `importee === find || importee.startsWith(find + '/')`
   匹配，故 `@faicad/faijs-brepjs` **不会**被 `@faicad/faijs` 吞并，顺序无要求。
5. `packages/sheetmetal/tsconfig.json` 的 `paths` 增加
   `"@faicad/faijs-brepjs": ["../brepjs/src/index.ts"]`、
   `"@faicad/faijs-brepjs/*": ["../brepjs/src/*"]`。
   注意 `tsconfig.build.json` 会清空 `paths`，build 阶段同样依赖新包 `dist`（§3.5）。

### 3.5 构建顺序（原方案遗漏，硬约束）

根 `npm run build` 实测只跑 `npm run build -w @faicad/faijs`，CI `scripts/ci.ps1`
第 3 步同样是 `npm run build`——**不会自动遍历 workspaces**（原方案"build 顺序自动按
workspaces 拓扑"的说法不成立）。由于 `tsconfig.build.json` 清空了 `paths`，
core / sheetmetal 的 build 只能靠新包已产出的 `dist/*.d.ts` 解析类型。因此：

```
npm run build -w @faicad/faijs-brepjs   # 必须最先
npm run build -w @faicad/faijs
npm run build -w @faicad/sheetmetal
```

根 `package.json` 的 `build` 脚本改为按序串联三条；`scripts/ci.ps1` 与
`ci.sh` 的 build 步骤同步。

## 4. 关键设计裁定

### 4.1 为什么 brepjs-compat 不整体搬

见 §2.4：其依赖闭包含 runtime-state（脚本执行状态机）、shape（faijs Shape 登记表）、
lineage → face-evolution → occt-kernel（wasm 引擎）。整体搬家 = 拆分 core 的运行时，
违背"vendored 树零反向依赖"这一可剥离前提。故采用 §3.1 的分层：
**vendored 纯面进新包，语义 wrap 留 core**。

### 4.2 sheetmetal 符号清点（原方案列为"实施第一步"，此处已实测完成）

实测：`grep -rhoP "import\s+(type\s+)?\{[^}]*\}\s*from\s*'@faicad/faijs/brepjs-compat'"`
在 `packages/sheetmetal/src` 上去重后的符号全集：

- **值符号 23 个**：`box`、`cylinder`、`curveEndPoint`、`curveStartPoint`、`err`、
  `fuse`、`getBounds`、`getEdges`、`getFaces`、`getSolids`、`getSurfaceType`、`isErr`、
  `isOk`、`isSolid`、`isValid`、`measureVolume`、`ok`、`outerWire`、`polygon`、`sphere`、
  `translate`、`unwrap`、`validationError`
- **类型符号 8 个**：`Bounds3D`、`BrepError`、`Edge`、`Face`、`Result`、`Solid`、`Wire`、`Vec3`

逐符号对照 §2.4 的 wrap 清单：

| 类别 | 符号 | 归属 |
|---|---|---|
| **命中 wrap，必须留 faijs** | `box`（dual-form + 内核断言）、`fuse`（`wrapGuarded` 内核断言） | `@faicad/faijs/brepjs-compat` |
| 纯 re-export，可切新包 | 其余 21 个值符号 + 8 个类型（合计 29 个） | `@faicad/faijs-brepjs` |

覆盖面已核对：上述 31 个符号在 vendored `index.ts` 出口面上**全部存在**
（逐符号 `grep -c` 命中）。

**结论**：sheetmetal 从"47 处全部改线"修正为 **46 处整体改线 + 1 处拆分**（§3.4）。
`box`/`fuse` 若改走新包，会丢掉 `assertKernelBound` 的 fail-fast 语义——
违反"BREP 路径执行抛异常 = 设计缺陷，必须直接报错暴露"这条红线。

出现位置实测：`box` 与 `fuse` 在 sheetmetal 内**只出现在
`src/foreignUnfold.test.ts` 这一个测试文件的同一条 import 语句里**，
产品代码零使用。

**实施时仍需做的等价性核对**：新包 `index.ts` 的同名符号与 compat 门面⑤段
"raw 直出面"是否为同一实现（尤其 `polygon`、`outerWire`、`getSurfaceType`、
`translate`、`isSolid`、`isValid`）。核对手段：改线后跑
`npm run typecheck -w @faicad/sheetmetal` + sheetmetal 全量测试；
若签名不等价，tsc 会直接报错。

### 4.3 `occt-kernel → vendored` 反向 import 的处理

`occt-kernel/occt-primitives.ts` import 新包的 `OcctWasmAdapter`——允许（core→新包
方向合法），不改桥接架构；D10 单实例绑定（`api/occt-kernel-bridge.ts` 注入 + 冻结）
原样保留，仅注册的 adapter 类来源变为新包子路径。

### 4.4 `brepjs/xxx` 说明符（原 §4.4 作废重写）

树内 7 处 `from 'brepjs/xxx'` **全部是 JSDoc 注释示例**，不参与模块解析，
因此**不需要**任何 tsconfig `paths` / vitest alias 支持，也不存在
"tsc 与 vitest 双体系解析差异"的风险（原次风险条目删除）。

但注释示例是公开用法说明，剥包后 `brepjs/2d` 这类写法对消费方不再成立。
处理：迁入时把这 7 行注释示例改为 `@faicad/faijs-brepjs/2d` 等实际子路径，
并在新包 `README.md` 中统一说明子路径约定。

### 4.5 sheetmetal 的测试装配入口

`@faicad/faijs/occt-kernel/occtKernel`、`@faicad/faijs/brep/engine/adapters/occt`、
`@faicad/faijs/api/occt-kernel-bridge` 这 3 处**保持从 `@faicad/faijs` 导入**——
内核注册是 core 的职责，新包只是被注入方。

### 4.6 新包不提供 `compat` 子入口（原 §4.2 设想，此处否定）

原方案设想新包提供 `@faicad/faijs-brepjs/compat` 作为"vendored 面的直出 re-export"。
该设想被否定，理由：

1. 它与 core 的 `api/brepjs-compat/index.ts` 是**同一批符号的第二份投影**，
   违反"符号一份实现、多处投影，同库不准两份"的约定；
2. 两个 compat 面并存会让下游在"哪个面有内核断言"上产生歧义；
3. §4.2 实测表明 sheetmetal 只需 31 个符号且全部在新包 `"."` 面上可得，
   新建入口没有实际收益。

改为：新包只提供 `"."`（vendored `index.ts` 原样）与 `"./*"`（子模块）两类出口；
语义 wrap 面**唯一**存在于 `@faicad/faijs/brepjs-compat`。

### 4.7 内核断言边界与语义泄漏（新增裁定）

新包 `"."` 与 `"./*"` 会把 vendored 的建模 op 裸形态（如
`topology/primitiveFns#box`）暴露给任何消费方，即提供了一条
**绕过 `assertKernelBound` 的捷径**。这不能被消除——vendored 树本身就是这么组织的，
且新包按 §3.1 禁止依赖 core，无法自带断言。

裁定：

- 新包 `index.ts` 顶部加显式警告注释：本包导出的是 vendored 原语面，
  **不做内核绑定断言**；建模 op 的消费方应经 `@faicad/faijs/brepjs-compat`。
- core 的 `api/brepjs-compat` 仍是唯一的"带断言"消费面，其 31 处 wrap 不迁。
- sheetmetal 的 `box` / `fuse` 按 §4.2 保留在 faijs 侧。

## 5. 工程守卫同步清单

原方案只列了 5 项。实测全量守卫脚本目录后，完整的受影响清单如下。

### 5.1 `scripts/check-vendored-branding.mjs`（U8 品牌守卫）——必须放宽

按 §0.1 裁决保留包名，因此必须改这个脚本（原方案完全遗漏）。四条断言的影响：

| 断言 | 现状判定 | 剥离后 | 处理 |
|---|---|---|---|
| A1 字符串字面量零 brepjs | roots 硬编码 `packages/core/src/vendored/brepjs` + `packages/core/src/api/brepjs-compat` + `packages/core/dist` | vendored 根目录不存在 → `walk()` 静默返回空 → **A1 静默失效** | roots 改为 `packages/brepjs/src` + `packages/core/src/api/brepjs-compat` + `packages/brepjs/dist` + `packages/core/dist` |
| A2 core exports 键 | 走 `BRAND_WHITELIST` | 无新增 brepjs 键 | 不改 |
| **A3** `packages/*/package.json` 的 name/deps/peerDeps | `probe.filter(s => s.includes('brepjs'))`，**不过 BRAND_WHITELIST** | 新包 `name`、core 与 sheetmetal 的依赖键全部命中 → **失败** | 新增 `BRAND_PACKAGE_WHITELIST = ['@faicad/faijs-brepjs']`，在 A3 的 `probe` 过滤中放行 |
| **A4** `packages/{core,sheetmetal,tests,fixtures,demo}/src/**` import 说明符 | `spec.includes('brepjs')` 且非相对、非品牌白名单 → 失败 | core 的 `@faicad/faijs-brepjs/...`、sheetmetal 的 `@faicad/faijs-brepjs` 全部命中 → **失败** | `isBrandWhitelisted()` 增加 `s.startsWith('@faicad/faijs-brepjs')` 判定（现有的 `s === w` / `endsWith('/'+w)` 两种形态都匹配不到带子路径的说明符） |

放宽必须同步更新脚本头注释里的"P10 基线锁定"说明与豁免登记，说明新增豁免的
范围仅限 `@faicad/faijs-brepjs` 这一个包名前缀，不扩散到其它 brepjs 字样。

### 5.2 `scripts/check-layer-boundaries.mjs`（R5 反向断言失效风险）

- `VENDORED_ROOT = resolve(process.env.BOUNDARY_SRC_DIR ?? 'packages/core/src/vendored/brepjs')`
  → 改为 `packages/brepjs/src`（或保留 env 覆盖并在 CI 里传）。
- U9/D10 路径断言（`vendored/brepjs/csg/`、`vendored/brepjs/ns/csg.ts`、
  `vendored/brepjs/quick.ts` 不存在）跟着改基路径。
- **R5 反向断言会静默失效**：它的识别条件是 `imp.includes('vendored')`。
  改线后 core 侧 39 个文件的 import 变成 `@faicad/faijs-brepjs/...`，不含
  `vendored` 段 → 该断言不再检查任何东西，且**不报错**。
  处理：把识别条件改为 `imp.includes('vendored') || imp.startsWith('@faicad/faijs-brepjs')`，
  并重新登记桥接点白名单（现为 `api/`、`brep/engine/adapters/`——39 个文件里
  `api/**` 占绝大多数，`occt-kernel/occt-primitives.ts` 属 §4.3 的合法反向接缝，
  需确认是否要新增白名单条目）。

### 5.3 `scripts/gen-importmap.mjs` + `cdn/`（可发布包带来的约束）

新包是可发布包（§0.1），会被 `gen-importmap.mjs` 自动纳入（它扫描全部可发布
`@faicad/*`，只排除 fixtures/tests/demo）。因此：

- 重跑 `node scripts/gen-importmap.mjs`，产出会新增：
  - `cdn/importmap.json`：`"@faicad/faijs-brepjs": "https://cdn.jsdelivr.net/npm/@faicad/faijs-brepjs/+esm"`
  - `cdn/versions.json`：`"@faicad/faijs-brepjs": "<版本>"`
  - `cdn/lib-meta.json`：按需条目
- **CDN 场景的硬约束**：sheetmetal 现在从 `@faicad/faijs/brepjs-compat` 导入，
  faijs 已在 importmap 里；改线后 sheetmetal 会 import `@faicad/faijs-brepjs`，
  **若 importmap 缺条目，浏览器裸 specifier 直接解析失败**。
  故 importmap 更新与 sheetmetal 改线必须在同一提交内完成。

### 5.4 `scripts/publish-all.ps1`（发布顺序硬编码）

该文件第 74–85 行是**手写**的拓扑顺序列表，`@faicad/faijs`（core）排第一。
必须把 `@faicad/faijs-brepjs` 插到 `@faicad/faijs` **之前**，否则发布时
`@faicad/faijs` 的 registry 依赖 `@faicad/faijs-brepjs@^0.16.0` 解析不到，
正是 `check-dep-lockstep.mjs` 要防的那类 CDN 断图事故。文件头注释的
拓扑顺序说明同步更新。

### 5.5 根 `tsconfig.json` 与 `eslint.config.mjs`

- 根 `tsconfig.json` 的 `exclude` 含 `"packages/core/src/vendored"`，剥离后失效。
  **裁定**：新包纳入根 typecheck（`include: ["packages/*/src/**/*.ts"]` 天然覆盖）。
  依据 §2.1 实测——260 文件 strict 检查 0 错误，不会引爆。
  同时移除该失效 exclude 条目。
- `eslint.config.mjs` 第 6 行 `ignores` 含 `packages/core/src/vendored/**`：
  改为 `packages/brepjs/src/**`（保持 vendored 树不进 lint 的既定口径）。
- 根 `npm run lint` 只跑 `packages/core/src packages/faijs-extra/src`，
  新包不受影响；新包自带 `lint` 脚本（见 §3.2），是否纳入根 lint 按现有口径
  （只 lint core 与 faijs-extra）**暂不纳入**。

### 5.6 既有守卫（原方案已列，补充细节）

- `check-ghost-deps.mjs`：新包的 flatbush/opentype.js 必须声明在自身 package.json
  （§3.2 已含）；core 侧移除 flatbush 后不得再有引用（§3.2 已实测为零）。
- `check-dep-lockstep.mjs`：core→新包、sheetmetal→新包的 range 必须为 `^0.16.0`
  （§3.2 修正点）。注意该守卫把新包计入 `publishable`（非 private），
  两条依赖都会被测。
- `check-workspaces-order.mjs`：`packages/brepjs` 插入 `packages/core` 之前（§3.2）。
- `npx madge --circular packages/*/src`：包图新增节点，确认无环
  （预期：brepjs ← core ← faijs-extra/tests/demo；brepjs ← sheetmetal）。
- `packages/demo/vite.config.ts`：`alias` 需加
  `{ find: '@faicad/faijs-brepjs', replacement: resolve(__dirname, '../brepjs/src') }`
  （现有 alias 只有 faijs-extra / faijs / sheetmetal）。
- 新包 `vitest.config.ts`：按 core 形态新建（include `src/**/*.test.ts`，
  testTimeout 300000）。vendored 树内零测试文件，故新包测试初始为空，
  后续由 core 侧 parity/surface 测试迁入（§7）。

## 6. 实施顺序

1. 建 `packages/brepjs`：迁移 vendored 整树 + NOTICE/README/ambient.d.ts +
   tsconfig ×2 + vitest + package.json（§3.2）+ LICENSE（Apache-2.0 全文）。
2. **先跑通新包自身**：`npm run typecheck -w @faicad/faijs-brepjs`（预期 0 错误，§2.1）
   → `npm run build -w @faicad/faijs-brepjs`（确认 `dist/` 与 `.d.ts` 产出）。
3. core 改线：7 个 codegen 脚本（`VENDORED_ROOT` / `VENDORED_ROOT_REL`）+ 生成面重跑
   + 39 个文件的机械替换 + compat 门面保留 31 处 wrap（§3.3）。
4. sheetmetal 改线：45 处改线 + `box`/`fuse` 保留（§3.4）。
5. 守卫与配置同步（§5，含 U8 放宽、R5 识别条件、importmap、publish-all、
   根 tsconfig/eslint、demo alias）。
6. 构建顺序修正（§3.5）+ 版本号 bump（§6.7）。
7. 验证：`npm run typecheck` → 单包测试（core / brepjs / sheetmetal / tests）→
   只重跑失败用例 → 最后才允许 CI（遵循 AGENTS.md 测试纪律）。

### 6.7 版本号

当前版本线 0.16.1。按 patch 位递增：**所有 bump 到 0.16.2 的包与新包同版本**，
新包 `version` 为 `0.16.2`（**修正**：原方案 §3.2 写 0.16.1、§6.7 又要求递增，
两者矛盾）。跨包 range 统一 `^0.16.0`（lockstep 守卫的唯一合法形态）。

## 7. 风险与回滚

- **最大风险**：`api/generated/*` 与 7 个 codegen 脚本的路径耦合——用"重跑全部
  7 个生成脚本 + diff 为空"作为完成判据。注意 `gen-l3-surface.ts` 的
  `VENDORED_ROOT_REL` 是 emit 用的相对路径常量，漏改会产出错误说明符。
- **次风险（新增）**：U8 守卫放宽是**架构决策的变更**（P10 基线）。放宽必须限定
  在 `@faicad/faijs-brepjs` 这一个包名前缀，不得扩散；脚本头注释需写明豁免登记。
- **次风险（新增）**：R5 反向断言在改线后会静默失效（§5.2）。必须在同一次改动里
  修复识别条件，否则层边界守卫对 39 个文件的约束会无声消失。
- **次风险（新增）**：构建顺序。`tsconfig.build.json` 清空 `paths`，新包未构建时
  core/sheetmetal 的 build 直接失败（§3.5）。
- **已排除的风险**：原方案担心的"`brepjs` 自引用别名在 tsc/vitest 双体系下解析差异"
  不存在（§4.4，7 处均为注释）；"vendored 树 typecheck 引爆错误"不存在
  （§2.1，260 文件 0 错误）。
- 公开契约 `@faicad/faijs/api/brepjs-compat` 与 `@faicad/faijs/brepjs-compat`
  不变，消费方零影响；回滚 = revert 单一提交（迁移与改线同一 PR 提交）。

## 8. 明确不做

- 不改 vendored 树内任何实现代码（纯移动 + package 化）。
- 不动 D10 单实例绑定与 R5 分层守卫语义（只修识别条件，不改规则）。
- 不改 `.fai.js` 脚本面、cad 命名空间、mesh 链路。
- 不顺手做 vendored 升级（上游 commit 8685273a 锁定保持不变）。
- 本方案不执行 npm 发布；但发布顺序（§5.4）与 CDN importmap（§5.3）必须在本 PR 内
  改好，否则发布即断图。
