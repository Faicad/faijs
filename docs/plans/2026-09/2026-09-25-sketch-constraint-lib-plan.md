# 方案：草图约束独立库包（faijs 脚本面）

状态：方案（未实施）

## 1. 用户原话（需求原始记录）

> 草图约束不是是一核心的功能，他应该也一样是做一个可选的纸包，然后其他人的脚本里如果引用的这个纸包这个库硬泡以后以后它可以就可以用这个纸包里的草图约束求解的功能那那么如何设计这个API就是在脚脚里如何定义草图约束，然后如何设计一份方案，而且这个包到时候可案可以提供给现在的FC IT D来使用，就增加一个阶层次

需求解读（保持原意）：

1. 草图约束**不是 core 的功能**，应做成一个**可选的库包**（用户口中的"纸包"即 lib 包，参照 faijs-extra / cq-compat 等既有形态）。
2. 用户的脚本里 **import 这个库以后**，就可以使用库里的草图约束求解功能。
3. 需要设计两件事：**脚本内如何定义草图约束的 API** + **这个包的设计方案**。
4. 该包要能反向提供给现在的 **FC FTD（即 faijs-fcstd，FCStd 端口层）** 使用，形成一个分层：fcstd 从"自带求解器"变成"依赖该库的消费者"。

## 2. 现状盘点

### 2.1 求解能力已存在，但收在 fcstd 端口层

`@faicad/faijs-fcstd/src/` 内已有完整管线：

| 环节 | 文件 | 内容 |
|---|---|---|
| 几何/约束 schema | `sketch-parse.ts` | `SketchGeom`（point/line/circle/arc/ellipse/bspline）、`SketchCon`，FreeCAD `ConstraintType` 枚举整数（1=Coincident … 18=Diameter），geoId 约定（≥0 自有；-1 HAxis；-2 VAxis；≤-3 外部） |
| 求解器接口 | `sketch-solver.ts` | `SketchSolver` 接口（D5：只依赖接口、WASM 实现可换）；`SUPPORTED_CONSTRAINT_TYPES` P0 集 14 种；存量坐标作初值（D2） |
| WASM 后端 | `planegcs-backend.ts` | `@salusoft89/planegcs` 1.2.0；物化隐式固定框架（RtPnt + H/V 轴）；外部 geoId 不可解析则丢弃记录；InternalAlignment/Block/Weight 三类 drop-and-record |

关键结论：**求解内核无需新写**，工作是重新分层 + 设计脚本面 API。

### 2.2 fcstd 耦合点（下沉边界）

- `convert.ts` 是唯一生产消费者：`createPlanegcsSolver()` 在转换流程里对每个 sketch 跑求解。
- 其余引用全部是测试（`sketch-solver.test.ts`、`api-gotchas.test.ts`）。
- `sketch-parse.ts` 里 FCStd XML 解析部分留在 fcstd；**几何/约束的数据类型**（`SketchGeom`/`SketchCon`/`ConstraintType`）应随接口下沉。

### 2.3 参照形态：faijs-extra

`@faicad/faijs-extra`（0.16.2）即"可选能力包"的既有范式：独立 npm 包、`peerDependencies: @faicad/faijs`、脚本内 `import * as X from '包名'` 后即可用（见 `packages/tests/faijs/compat-e2e/_support/gear-lib-demo/` 的 e2e 范式）。新包完全照此办理。

## 3. 包设计：`@faicad/faijs-sketch`

### 3.1 包定位

- 名称：`@faicad/faijs-sketch`（暂定，与 faijs-extra 命名风格一致）。
- 性质：可选库包，**不进 core**；`peerDependencies: { "@faicad/faijs": "^0.16.0" }`，`dependencies: { "@salusoft89/planegcs": "1.2.0" }`。
- 双端可用：planegcs 是 WASM，Node 走 `createRequire` 解析 wasm 路径（现有 `planegcsWasmPath()` 直接搬），浏览器侧 wasm 文件经 HostPorts assets 注入（参照 occt-wasm 的 `wasmAssets()` 路子），注入接口在包内以 HostPorts 风格定义、由宿主实现。
- 分层目标：本包落地后，`faijs-fcstd` 改为依赖本包（增加一层：fcstd = 解析层消费者；本包 = 求解能力提供者），删除包内自带的 `planegcs-backend.ts` / `sketch-solver.ts`（schema 类型随之下沉，XML 解析留在 fcstd）。

### 3.2 导出面

```
@faicad/faijs-sketch
  ├── solveSketch(geoms, cons, opts?)   // 核心求解（供库作者 / fcstd 消费）
  ├── 类型：SketchGeom / SketchCon / ConstraintKind / SolveOutcome
  └── sketchWithConstraints(...)        // 便捷层：几何+约束 → 求解 → 构面（见 §4.3）
```

依赖方向（保持单向）：

```
faijs-fcstd ──▶ @faicad/faijs-sketch ──▶ @faicad/faijs (Result/Shape 等类型)
                    │
                    ▼
            @salusoft89/planegcs (WASM)
```

## 4. 脚本面 API 设计（核心）

### 4.1 设计原则

1. **约束用字符串名 + 结构化对象**，不用 FreeCAD 枚举整数（脚本可读性优先；枚举整数只作为 fcstd 桥接时的内部表示保留）。
2. **初值即坐标**：几何声明里的坐标就是求解初值（沿用 D2 决策——用户写"大概位置"，约束把它拉精确）。
3. **求解是显式语句**，不做隐式自动求解：脚本可预测、失败可定位（符合"语句边界 unwrap / failedAt"错误契约）。
4. **不支持的约束 = 显式错误**，不静默忽略（运行时回退红线同样适用于约束求解层；drop-and-record 语义仅作为 `solveSketch` 底层选项暴露给 fcstd）。

### 4.2 约束 schema

```ts
/** 引用：第 i 个几何元素的某个点。pos: 1=start 2=end 3=center(圆心)；省略=整个元素 */
type Ref = { geo: number; pos?: 1 | 2 | 3 }
type RefAxis = { axis: 'h' | 'v' }   // 隐式水平/垂直轴（对应 geoId -1/-2）

type SketchConstraint =
  | { kind: 'coincident'; a: Ref; b: Ref }
  | { kind: 'horizontal'; of: number }            // 线段索引
  | { kind: 'vertical'; of: number }
  | { kind: 'parallel'; a: number; b: number }
  | { kind: 'perpendicular'; a: number; b: number }
  | { kind: 'tangent'; a: number; b: number }
  | { kind: 'distance'; a: Ref | RefAxis; b: Ref | RefAxis; value: number }
  | { kind: 'distanceX'; a: Ref | RefAxis; b: Ref | RefAxis; value: number }
  | { kind: 'distanceY'; a: Ref | RefAxis; b: Ref | RefAxis; value: number }
  | { kind: 'angle'; a: number; b: number; value: number }   // 度（项目契约：角度用度）
  | { kind: 'radius'; of: number; value: number }
  | { kind: 'diameter'; of: number; value: number }
  | { kind: 'equal'; a: number; b: number }
  | { kind: 'pointOnObject'; p: Ref; on: number }
  | { kind: 'symmetric'; p1: Ref; p2: Ref; about: number }
```

覆盖 planegcs P0 集全部 14 种；数值单位遵循项目契约（mm / 度）。

### 4.3 脚本用法（目标形态）

```js
// .fai.js —— import 库后即可用
import * as skc from 'faijs-sketch'

// 1) 声明几何（坐标=初值，允许不精确）
const geoms = [
  { kind: 'line', x1: 0, y1: 0, x2: 80, y2: 3 },    // 想要水平、长 80
  { kind: 'line', x1: 80, y1: 3, x2: 83, y2: 50 },  // 想要垂直
  { kind: 'line', x1: 83, y1: 50, x2: 0, y2: 50 },
]

// 2) 声明约束
const cons = [
  { kind: 'horizontal', of: 0 },
  { kind: 'vertical', of: 1 },
  { kind: 'coincident', a: { geo: 0, pos: 2 }, b: { geo: 1, pos: 1 } },
  { kind: 'coincident', a: { geo: 1, pos: 2 }, b: { geo: 2, pos: 1 } },
  { kind: 'distance', a: { geo: 0, pos: 1 }, b: { geo: 0, pos: 2 }, value: 80 },
]

// 3) 求解 + 构面（一条语句完成，产物 = cad.sketch 同款 Shape，可直接 extrude）
let sk = skc.sketchWithConstraints(geoms, cons)
let part0 = cad.extrude(sk, [0, 0, 10])
```

### 4.4 便捷层语义：`sketchWithConstraints`

1. 参数 schema 自校验（沿用 `assertSketchParams` 风格，错误码 `E_SKETCHC_*`）。
2. 调 `solveSketch`：初值 = 声明坐标 → planegcs 求解。
3. 不收敛（conflicting / redundant / failed / unsupported-constraint）→ 显式 `err`，`message` 带问题约束索引与原因；脚本面语句边界 unwrap 后落入 `failedAt`，无静默回退。
4. 收敛 → 解后几何转 `SketchLoop`（line/arc 段），复用 core `cad.sketch` 的 `makeLineEdge/makeArcEdge → makeWire → makeFace` 链路构面（外环/孔判定沿用 shoelace 面积规则）。
5. **几何类型首版范围**：line + circle + arc（构面链路已支持）；ellipse/bspline 的 schema 预留（类型定义带上），首版遇 `E_SKETCHC_UNSUPPORTED_GEOM` 显式报错，待构面链路扩展后放开。

### 4.5 底层 `solveSketch`（供 fcstd 消费）

保持现 `SketchSolver` 接口形状不变（`SolveOutcome` 含 converged / reason / problemConstraints / droppedConstraints），fcstd 的 `convert.ts` 只改一行 import 来源；`external`（外部固定几何，负 geoId）参数原样保留——这是 fcstd 外部投影几何（M6.3）的通道。

## 5. 实施步骤

1. 新建 `packages/sketch`（`@faicad/faijs-sketch`），从 fcstd 搬入 `sketch-parse.ts` 的类型部分、`sketch-solver.ts`、`planegcs-backend.ts`；schema 层加字符串 kind 映射（`ConstraintKind ↔ FreeCAD 枚举整数`，单点转换函数）。
2. 实现 `sketchWithConstraints`：求解 → `SketchLoop` 转换 → 委托 core `cad.sketch` 内核构面。
3. 测试：planegcs GOTCHA 测试（difference 语义、get_primitive 读回）随包迁移；新增脚本面 e2e（仿 gear-lib-demo 范式，`import * as skc from 'faijs-sketch'`）覆盖水平/距离驱动/不收敛报错三类用例；stderr 零容忍照常。
4. fcstd 切换：`convert.ts` 改为 `import { createPlanegcsSolver } from '@faicad/faijs-sketch'`，删除包内 `planegcs-backend.ts` / `sketch-solver.ts`，跑 fcstd 全量测试回归。
5. 收尾：workspaces 顺序 / ghost-deps / dep-lockstep / madge 四守卫 + `npm run build`；版本号按 patch 递增规则更新；发布节奏按 npm 发布计划并入。

## 6. 风险与决策点

| 项 | 说明 | 倾向 |
|---|---|---|
| 包名 | `@faicad/faijs-sketch` 还是并入 faijs-extra | 独立包（用户明确"可选的包"；extra 是编辑器扩展，职责不同） |
| 隐式求解 | 是否允许 `cad.sketch` 遇到带约束输入时自动求解 | 不做，保持显式语句 |
| ellipse/bspline | 首版是否支持 | 预留 schema、显式报错，二期放开 |
| 浏览器 wasm 注入 | HostPorts assets 接口形态 | 参照 occt-wasm `wasmAssets()` 既有模式 |
