# faijs (brepkit engine skill) — .fai.js Scripting API Skill

> **Purpose**: This skill file tells AI agents what APIs are available when writing `.fai.js` scripts for 3D CAD modeling with the faijs engine.

## What is faijs?

faijs is a CAD execution engine: a JavaScript-based language (`.fai.js`) for parametric 3D modeling with dual BREP (OCCT) and mesh (manifold) geometry backends. Scripts use a `cad.*` namespace for platform operations, and can `import` additional libraries for domain-specific capabilities (sheet metal, gears, fasteners, etc.).

## Script Structure

A `.fai.js` file is valid JavaScript with specific conventions:
- **Variable names must be descriptive and meaningful** (e.g., `bottom_leg`, `gear_hub`, `mounting_plate`). The `part0`, `part1`, ... pattern is only a UI-layer auto-generation convention — AI agents writing scripts must choose names that reflect the part's role in the design.
- The `cad` namespace is the default library, always available.
- Additional libraries are imported via `import * as <binding> from '<specifier>'`.
- **Units must be explicitly provided** using unit literal expressions. +Z is up. See the Unit System section below.

```js
// A simple .fai.js script — note explicit unit literals
let base_plate = cad.box(100 * MM, 80 * MM, 10 * MM)
let shaft = cad.cylinder(5 * MM, 40 * MM)
let assembled = cad.union(base_plate, shaft)
```

## Key Concepts

### Dual-Channel Execution
Every op supports the **mesh** path (default, manifold-3d). Some also support the **BREP** path (OCCT, exact geometry). Whether BREP is available is determined by **static rules** before execution — there is no runtime fallback. When a BREP-unsupported op is encountered, the chain switches to mesh for that operation onward.

### Result System
APIs use a `Result<T>` type (`ok`/`err`/`isErr`). In `.fai.js` scripts, statement boundaries automatically unwrap results — an `err` becomes a statement failure. Third-party library functions return `Result` natively; the boundary unwraps at the statement level.

### Topology References
Topology parameters (`fillet.edges`, `chamfer.edges`, `shell.openFaces`, `draft.faces`, `defeature.faces`, `extrude.upTo`, ...) are referenced by **portable topology identity** — `EdgeTopoRef` / `FaceTopoRef` — each recording the statement it was born from (`origin`) and its role within that statement (`role`), so the reference stays valid across parametric changes and across kernels.

**In generated scripts, topology parameters take the TopoRef literal the UI picker emits** (`{ kind:'edge'|'face', origin, role, hint }`). Pass it through unchanged; never hand-write `origin`/`role` values — they are assigned by the naming layer at runtime.

**⚠️ Never use ordinal references in generated scripts** — the `cad.edgeRef` / `cad.faceRef` query bridges or bare numbers. Ordinals are the kernel's enumeration order and drift across kernels and features (the same box enumerates edge[0] = length 5 under occt but length 20 under brepkit). `edgeRef` / `faceRef` are **query bridges only**, for FCStd import porting and mesh-chain parts that have no role layer; mesh-chain bare ordinals (`openFaces: [4]`) are likewise current-kernel-only.

### Selector Strings (precision chain)

When a script must pick topology without a UI-picked literal, use **CadQuery selector strings** on the BREP (precision) chain. The following ops accept them (as the top-level value or as array elements, in place of TopoRef literals):

| Op | Parameter accepting a selector string |
|---|---|
| `fillet` / `chamfer` | `edges` (edge selector) |
| `filletVariable` | `edge` (single edge; multi-match fails) |
| `shell` | `openFaces` (face selector) |
| `draft` / `defeature` | `faces` (face selector) |
| `extrude` | `upTo` (face selector, resolved on `baseFeature`; single face) |
| `sketchOnFace` / `sketchOnSurface` / `punchHole` | `face` (face selector on the target solid) |

Selector syntax follows CadQuery (compatible subset): `">Z"` = the face/edge at the Z extreme, `"<Z"` = Z minimum, `"|Z"` = parallel to Z (face normal / edge tangent), `"#Z"` = perpendicular to Z, `"+Z"`/`"-Z"` = facing +Z/-Z, `"%LINE"` = by type, `">Z,|X"`-style set expressions. Selectors are evaluated against the current kernel at runtime, so they are **portable across kernels** (unlike ordinals). A selector matching nothing, or matching more than one entity for a single-entity parameter, fails loudly — never silently picks one.

Selector strings are **precision-chain only**: the mesh chain has no role layer, so mesh solids must keep using 1-based ordinals (current-kernel-only, see above).

### Unit System
- **+Z is up.**
- **Units must be explicitly provided** using unit literal expressions. The following uppercase constants are available as read-only globals in `.fai.js` scripts:

| Constant | Value (base-unit scale) | Dimension |
|----------|------------------------|-----------|
| `MM` | 1 | length (base unit) |
| `CM` | 10 | length |
| `METER` | 1000 | length |
| `MICRON` | 0.001 | length |
| `INCH` | 25.4 | length |
| `FOOT` | 304.8 | length |
| `YARD` | 914.4 | length |
| `DEGREE` | 1 | angle (base unit) |
| `RADIAN` | 180/π | angle |
| `GRAM` | 1 | mass (base unit) |
| `KILOGRAM` | 1000 | mass |
| `SECOND` | 1 | time (base unit) |

- **Usage**: Multiply a number by a unit constant, e.g., `10 * MM`, `2 * INCH`, `45 * DEGREE`. The expression evaluates to a plain number in the base unit (mm for length, degree for angle).
- **Bare numbers on dimensioned parameters are rejected** by the dimension checker (`E_DIM_BARE_NUMBER`). You must always write `10 * MM`, not just `10`.
- Compound expressions are supported: `10 * MM + 2 * MM` evaluates to `12`.
- Unit constants are reserved — you cannot shadow them with `let INCH = ...` or use them as parameter names.

---

> **Engine-specific skill doc — auto-generated** by `scripts/gen-skill-docs.ts` (do not edit by hand; regenerate via `npm run gen:skill-docs`).
>
> This doc lists the APIs available when the runtime BREP engine is **brepkit**.
> It contains the **78 engine-neutral (common) ops** plus the **0 brepkit-only ops** (currently none).
> OCCT-only ops (73: alignTo, approximatePoints, autoHeal, boolean, circleArc, classifyPointOnFace, commonCells, complexExtrude, containsPoint, curveDegreeElevate, curveIsPeriodic, curveKnotInsert, curveKnotRemove, distanceBetween, draft, draftPrism, edge, ellipseArc, ellipseEdge, exportBrep, faceOnSurface, fixSelfIntersection, fuse, halfSpace, heal, helix, import_brep, inertia, inspectMassProps, interpolateWithTangents, isCompSolid, isCompound, isEdge, isEqual, isFace, isShell, isVertex, isWire, iterShapes, liftCurve2d, linearCenterOfMass, locate, loftAdvanced, makeSolid, nonPlanarFace, offset, offset2d, outerWire, pipe, projectPointOnEdge, projectPointOnFace, punchHole, reverseShape, reverseSurfaceU, roof, screw, simplify, sketchOnSurface, solidFromFaces, split, subShapeCount, surface, sweepAdvanced, tangentArc, thicken, thread, toMultiviewPNG, toMultiviewSVG, toPNG, toSVG, twistExtrude, uvFromPoint, vertexPosition) are **excluded** from the brepkit doc;
> brepkit-only ops (0: none) are excluded from the OCCT doc.


---

## 创建

### `box(...)`
创建长方体（brepjs 契约，§4.1 A 决策）。

**Parameters**:
- `params.width`: X 方向边长（mm）。type:number required:true
- `params.depth`: Y 方向边长（mm）。type:number required:true
- `params.height`: Z 方向边长（mm）。type:number required:true
- `params.at`: 中心点（CENTER 语义，优先于 centered）。type:[x,y,z] 可选
- `params.centered`: 无 at 时是否居中到原点（type:boolean 默认 false，角点在原点）。
- `params.segments`: 细分度（影响三角化）。type:number 默认 64（= brepjs standard 等效，P0 §5.0/§5.1）

**Schema**: `width: number`, `depth: number`, `height: number`, `at: vec3?`, `centered: boolean?`, `segments: number?`

**Returns**: Shape 长方体几何，可作为后续 op 的输入。

 **Sync**.

**Examples**:
```js
const part0 = cad.box(10 * MM, 20 * MM, 30 * MM)
const part1 = cad.box(30 * MM, 20 * MM, 10 * MM, { at: [1, 2, 3], segments: 64 })
```
```js
位置原生（§4.1/§6.2）：`box(width, depth, height)` 与 `box(10 * MM, 20 * MM, 30 * MM, { at: [1, 2, 3] })`
有量纲位必须写单位字面量（基准单位亦然，`10` 裸数字被 D8 R2 拒）。
归一到同一对象（D11 位置→对象 + 尾参 options 合并）。旧 `{ size }` 对象形态已废弃（裁决 3），
传入会抛 `E_ARGS_FORM`（错误提示 ≠ 兼容，§4.1）。
```

### `sphere(...)`
创建球体。

**Parameters**:
- `params.radius`: 半径（mm）。type:number required:true
- `params.segments`: 细分度（影响面数）。type:number 默认 64（= brepjs standard 等效，P0 §5.0/§5.1）
- `params.center`: 球心位置（at 的同义别名）。type:[x,y,z] 默认 [0,0,0]（原点）。
- `params.at`: 球心位置（center 的同义别名，brepjs 契约；裁决 4 双形态合法）。

**Schema**: `radius: number`, `segments: number?`, `center: vec3?`, `at: vec3?`

**Returns**: Shape 球体几何，可作为后续 op 的输入。

 **Sync**.

**Examples**:
```js
const r = cad.sphere({ radius: 10 })
const r = cad.sphere(10, { at: [0, 0, 10], segments: 64 })
const r = cad.sphere({ radius: 10, segments: 64, center: [0,0,10] })
```

### `cylinder(...)`
创建圆柱体（brepjs 契约，§4.3 A 决策）。 锚点：`at` 是**底面轴心**（BASE 语义，默认 [0,0,0]，底面在原点、+Z 延伸）；`centered:true` 指底面落到 −h/2（无 at 时居中到原点；与 `at` 同给时以 `at` 为中心）。

**Parameters**:
- `params.radius`: 底面半径（mm）。type:number required:true
- `params.height`: 高度（mm），沿 +Z 轴。type:number required:true
- `params.at`: 底面中心（BASE 语义）。type:[x,y,z] 可选
- `params.centered`: 是否居中（底面 −h/2；与 at 同给时以 at 为中心）。type:boolean 默认 false
- `params.segments`: 细分度（影响三角化）。type:number 默认 64（= brepjs standard 等效，P0 §5.0/§5.1）

**Schema**: `radius: number`, `height: number`, `at: vec3?`, `centered: boolean?`, `segments: number?`

**Returns**: Shape 圆柱体几何，可作为后续 op 的输入。

 **Sync**.

**Examples**:
```js
const c = cad.cylinder(5, 40)
const c = cad.cylinder(5, 40, { at: [0, 0, 20], segments: 64 })
```
```js
位置原生（§4.1/§6.2）：`cylinder(5, 40)` 与 `cylinder(5, 40, { at: [0, 0, 20] })`
归一到同一对象（D11 位置→装箱 + 尾参 options 合并）。旧 `{ center }` 对象形态已废弃
（裁决 3），传入会抛 `E_ARGS_FORM`（错误提示 ≠ 兼容，§4.3）。
```

### `cone(...)`
创建圆锥体（brepjs 契约，§4.1 P 决策）。radiusTop 等于 radiusBottom 时即圆柱，0 为尖锥。 锚点：`at` 是**底面轴心**（BASE 语义，默认 [0,0,0]，底面在原点、+Z 延伸）；`centered:true` 指底面落到 −h/2（无 at 时居中到原点；与 `at` 同给时以 `at` 为中心）。

**Parameters**:
- `params.radiusBottom`: 底半径（mm）。type:number required:true
- `params.radiusTop`: 顶半径（mm），0 为尖锥，非负，等于 radiusBottom 得圆柱。type:number required:true
- `params.height`: 高度（mm），沿 +Z 轴。type:number required:true
- `params.at`: 底面轴心（BASE 语义）。type:[x,y,z] 可选
- `params.centered`: 是否居中（底面 −h/2；与 at 同给时以 at 为中心）。type:boolean 默认 false
- `params.segments`: 细分度（影响三角化）。type:number 默认 64（= brepjs standard 等效，P0 §5.0/§5.1）

**Schema**: `radiusBottom: number`, `radiusTop: number`, `height: number`, `at: vec3?`, `centered: boolean?`, `segments: number?`

**Returns**: Shape 圆锥体几何，可作为后续 op 的输入。

 **Sync**.

**Examples**:
```js
const c = cad.cone(10, 4, 30)
const c = cad.cone(10, 0, 30, { at: [0, 0, 20], segments: 64 })
位置原生（§4.1/§6.2）：`cone(10, 4, 30)` 与 `cone(10, 4, 30, { at: [0, 0, 20] })`
归一到同一对象（D11 位置→装箱 + 尾参 options 合并）。旧 `{ center }`/`{ size }` 对象形态
已废弃（裁决 3），传入会抛 E_ARGS_FORM（错误提示 ≠ 兼容）。
```

### `wedge(...)`
创建楔形体。唯一契约是 width/height/angle/length（width/height/angle 为正数，length 沿切割方向）， 旧文档的 size 形态已废弃，传 { size } 会抛错。

**Parameters**:
- `params.width`: 底面宽度（mm）。type:number required:true
- `params.height`: 高度（mm）。type:number required:true
- `params.angle`: 楔形角度（度）。type:number required:true
- `params.length`: 沿切割方向的长度（mm）。type:number required:true

**Returns**: Shape 楔形体几何，可作为后续 op 的输入。

 **Sync**.

**Examples**:
```js
const w = cad.wedge({ width: 30, height: 20, angle: 45, length: 10 })
```

### `profile(...)`
从 2D 轮廓构造平面（creator，无输入）。仅 BREP 可用。

**Parameters**:
- `params.contours`: 有序 2D 轮廓（线段/圆弧；外环 + 孔），或已绘制轮廓（单个 Blueprint 或其数组）。type:ProfileLoop[]|Blueprint|Blueprint[] required:true
- `params.as`: 产物形态：'face'（默认）构面；'wire' 只交外环 wire（1D 曲线）。type:'face'|'wire' required:false

**Returns**: Shape 平面几何（mesh 三角化 + BREP 句柄）；`as:'wire'` 时返回 1D 曲线（kind:'curve'）。

 **Sync**.

**Examples**:
```js
const f = cad.profile({ contours: [{ segments: [{ kind:'line', x1:0,y1:0,x2:10,y2:0 }, ...] }] })
const w = cad.profile({ contours: [{ segments: [{ kind:'line', x1:0,y1:0,x2:10,y2:0 }, ...] }], as: 'wire' })
```

### `sketchOnPlane(...)`
`cad.sketchOnPlane`: place 2D contours on a plane and construct a Shape.

**Parameters**:
- `params.contours`: ordered 2D contours (same shape as `cad.profile`: segment loops, or a drawn `Blueprint`).type:any required:true
- `params.plane`: named plane (`'XY'` / `'XZ'`…) or `{ origin, normal, xAxis }`.type:any required:true
- `params.as`: `'face'` (default) or `'wire'` (outer loop only).type:string required:false

**Returns**: Shape on the target plane (face, or a wire curve when `as:'wire'`).

 **Sync**.

### `sketchOnFace(...)`
`cad.sketchOnFace`: place 2D contours on a **planar** face of a solid and construct a Shape. Engine-neutral (no `engines` declaration): works on the OCCT BREP engine, the brepkit BREP engine, and the brepkit mesh backend. **网格链**（`meshEngines: ['brepkit']`，方案 2026-10-01 §4 Phase 3）：`on` 是网格实体 时，轮廓按面自己的**平面框**铺放（原点 = 面包围盒中心、法向 = 面法向），产物是一张 网格链面，可直接交给 `cad.extrude` 拉伸。该分支只接受平面面、只接受默认 `scaleMode`（`'bounds'`/`'native'` 相对 UV 域定义，网格链上没有 UV 域）、只接受 `as:'face'`、且只接受单个轮廓岛——每一条越界都以 `E_MESH_SOLID_UNSUPPORTED` 说明原因。

**Parameters**:
- `params.contours`: ordered 2D closed contours (same shape as `cad.profile`).type:any[] required:true
- `params.on`: the target solid on which the face lives.type:Shape required:true
- `params.face`: the host face: FaceTopoRef（UI 拾取产物字面量）| 面选择器字符串（如 ">Z"，在 on 上解析，多面命中抛错）| 1 起序号（仅网格链/当前内核快照，禁止用于生成脚本）。type:any required:true
- `params.scaleMode`: UV mapping: 'original' (identity) | 'bounds'/'native' (affine-fit; OCCT planar only).type:string required:false
- `params.as`: `'face'` (default) or `'wire'` (outer loop only).type:string required:false

**Returns**: Shape on the target face (face, or a wire curve when `as:'wire'`).

 **Sync**.

### `wire(...)`
从点列构造 1D 曲线（折线 / 闭合轮廓 / 平滑样条）。

**Parameters**:
- `points`: 有序点列 [[x,y,z], ...]，至少 2 点。type:Vec3[] required:true
- `options.closed`: 闭合轮廓（首尾相连）。type:boolean required:false
- `options.smooth`: 平滑曲线（B-样条穿过全部点，默认折线）。type:boolean required:false
- `options.degree`: smooth 时的样条次数（默认 3）。type:number required:false

**Returns**: Shape 1D 曲线（kind:'curve'，无三角载荷；显示经 wireframe）。

 **Sync**.

**Examples**:
```js
const w = cad.wire([[0,0,0],[10,0,0],[10,10,0]], { closed: true })
```

### `sdf(...)`
用 SDF（符号距离场）函数生成网格体（mesh-only）。

**Parameters**:
- `params.code`: SDF 函数源码（`sdf(x,y,z)` 定义或标题模板调用，如 'return sphere(10) - sphere(5, [10,0,0])'）。type:string required:true
- `params.box`: 采样包围盒。type:[[minX,minY,minZ],[maxX,maxY,maxZ]] 默认 [[-10,-10,-10],[10,10,10]]
- `params.resolution`: 网格单元边长（越小越精细）。type:number 默认 1.0
- `params.params`: 参数数值表（SDF 里引用的变量值）。type:object

**Returns**: Shape SDF 生成的网格体，生成独立零件。

 **Async**.

**Examples**:
```js
const s = await cad.sdf({ code: 'return sphere(10) - sphere(5, [10,0,0])', box: [[-20,-20,-20],[30,20,20]], resolution: 1 })
```

---

## Other

### `extrude(...)`
extrude — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。 extrude(face: Shape, height: number|Vec3) → Shape｜extrude(face: Shape, params: { length? | upTo, normal?, mode?, baseFeature?, offset? }) → Shape 桥接：defineOp({ brep: __own_extrudeBrep })——core 直连 occt 引擎（§5.4）， D11 归一在自有实现内部完成（api/brep-operations/）。

 **Sync**.

### `jointTrajectory(...)`
Sample a straight-line path in joint space from `from` to `to` over `steps` segments, yielding `steps + 1` samples (inclusive of both endpoints). Each sample carries the interpolated per-DOF values (clamped to range) and the forward-kinematics poses of every node. Joints absent from `from`/`to` hold their stored value at both ends.

**Parameters**:
- `assembly`: AssemblyNode — The assembly to pose at each sample.
- `from`: Readonly<Record<string, number | readonly number[]>> — Starting joint values keyed by child node name.
- `to`: Readonly<Record<string, number | readonly number[]>> — Ending joint values keyed by child node name.
- `steps`: number — Number of path segments (samples are `steps + 1`).

**Returns**: The trajectory samples with interpolated values and poses.

 **Sync**.

### `inverseKinematics(...)`
Solve for the joint values that place `endEffector` (offset by `tip`) at `target`, by damped-least-squares descent on a numerical Jacobian. Joint ranges are honored: every iterate is clamped to each DOF's `[min, max]`. Returns the solved per-DOF values keyed by child node (ready to pass to `forwardKinematics`), whether it converged, the iteration count, and the final residual norm. An end-effector with no driving joints, or an unreachable target, returns `converged: false` with the best configuration found.

**Parameters**:
- `assembly`: AssemblyNode — The assembly containing the kinematic chain.
- `endEffector`: string — Name of the end-effector node.
- `target`: IKTarget — Target world pose for the end-effector.
- `options`: IKOptions — Optional solver settings (iterations, tolerance, damping, seed, tip).

**Returns**: The solved joint values and convergence diagnostics.

 **Sync**.

### `mechanismDOF(...)`
Open-chain mobility — the number of independent degrees of freedom, summing each joint's DOF count (revolute/prismatic 1, cylindrical 2, planar/spherical 3). For a serial chain this equals the total DOF. (Closed-loop Grübler/Kutzbach analysis is future work.)

**Parameters**:
- `assembly`: AssemblyNode — The assembly to analyze.

**Returns**: Total number of independent degrees of freedom.

 **Sync**.

### `import_step(...)`
GOTCHA（2026-09-30）：与 import_brep 同——必须经 defineOp 包装进入 cad 命名空间， 不能是裸 async 函数。part 键 roleTable（outputTablesByPart）只在 define-op.ts 包装层的 brep 分支登记；裸 async 函数产物没有 part 键表，下游 place/edgeRef 报 "input shape has no role table (nameless shape)"。

 **Sync**.

---

## 变换

### `translate(...)`
平移几何体。

**Parameters**:
- `input`: 目标几何。type:Shape required:true
- `params.offset`: 平移向量（mm）。type:[x,y,z] required:true

**Returns**: Shape 平移后的几何，装配的相对位置靠成员的变换语句表达。

 **Sync**.

**Examples**:
```js
const p1 = cad.translate(part0, { offset: [10, 0, 0] })
```

### `rotate_euler(...)`
绕轴旋转几何体。angles 为欧拉角（度，XYZ 顺序）。

**Parameters**:
- `input`: 目标几何。type:Shape required:true
- `params.angles`: 欧拉角（度，XYZ 顺序）。type:[x,y,z] required:true
- `params.pivot`: 旋转中心。type:[x,y,z] 默认 原点

**Returns**: Shape 旋转后的几何。

 **Sync**.

**Examples**:
```js
const p2 = cad.rotate_euler(part0, { angles: [0, 0, 45] })
const p3 = cad.rotate_euler(part0, { angles: [0, 0, 45], pivot: [0,0,0] })
```

### `scale(...)`
等比缩放几何体（brepjs 契约，§4.6 裁决 2）。factor 只收 number；不动点默认 原点（与旧 `scale(shape, factor, { center? })` 一致），`center` 可选。

**Parameters**:
- `input`: 目标几何。type:Shape required:true
- `params.factor`: 等比缩放系数（> 0）。type:number required:true
- `params.center`: 缩放不动点（p 保持不动）。type:[x,y,z] 默认 [0,0,0]（原点）

**Schema**: `factor: number`, `center: vec3?`

**Returns**: Shape 缩放后的几何。

 **Sync**.

**Examples**:
```js
const p4 = cad.scale(part0, 2)
const p5 = cad.scale(part0, { factor: 2, center: [10, 0, 0] })
```

### `scale3d(...)`
非等比缩放几何体（faijs 语义，§1.4.4 裁决 2）。factor 定死 vec3 — 等比缩放请用 `scale(p, s)`，`scale3d(p, [x,y,z])` 才可非等比。`center` 为不动点（默认原点）。

**Parameters**:
- `input`: 目标几何。type:Shape required:true
- `params.factor`: 三轴缩放系数（均 > 0）。type:[x,y,z] required:true
- `params.center`: 缩放不动点。type:[x,y,z] 默认 [0,0,0]（原点）

**Schema**: `factor: vec3`, `center: vec3?`

**Returns**: Shape 缩放后的几何。

 **Sync**.

**Examples**:
```js
const p4 = cad.scale3d(part0, { factor: [2, 1, 1] })
const p5 = cad.scale3d(part0, [2, 1, 1], { center: [10, 0, 0] })
```

### `place(...)`
刚性放置几何体：旋转（四元数，绕局部原点）后平移。两者皆可缺省 = 恒等。

**Parameters**:
- `input`: 目标几何。type:Shape required:true
- `params.rotation`: 旋转四元数 [x,y,z,w]（Hamilton，绕局部原点）。type:[number,number,number,number]
- `params.position`: 平移向量 [x,y,z]（mm）。type:[number,number,number]

**Schema**: `position: vec3?`, `rotation: quat?`

**Returns**: Shape 放置后的几何（持 OCCT 句柄，可继续变换/导出）。

 **Sync**.

**Examples**:
```js
const p = cad.place(part0, { rotation: [0, 0, Math.sin(Math.PI/4), Math.cos(Math.PI/4)], position: [10, 0, 0] })
```

---

## 特征

### `engrave(...)`
在几何表面雕刻文字或 SVG（文字分支与 logo 分支都可用）。

**Parameters**:
- `input`: 目标几何。type:Shape required:true
- `params.mode`: 雕刻方式：concave 凹陷（减法）/ convex 凸出（加法）。type:'concave' | 'convex' 默认 'concave'
- `params.depth`: 深度 / 凸出高度（mm）。type:number 默认 0
- `params.text`: 文字内容（与 svg 二选一）。type:string
- `params.textSize`: 字号（mm）。type:number 默认 10
- `params.svg`: SVG 资产引用（与 text 二选一；经 cad.asset 解析）。type:string
- `params.svgSize`: SVG 长边目标尺寸。type:number
- `params.faceCenter`: 面位置（绝对坐标）。type:[x,y,z] 默认 [0,0,0]
- `params.faceNormal`: 面法向。type:[x,y,z] 默认 [0,0,1]

**Returns**: Shape 雕刻后的几何。

 **Async**.

**Examples**:
```js
const p = await cad.engrave(part0, { mode: 'concave', depth: 2, text: 'Hello', textSize: 10, faceCenter: [0, 0, 0], faceNormal: [0, 0, -1] })
```

### `chamfer(...)`
在几何体上倒角（等距 / 双距 / 距角）。 （`twoDistances` 需要 role 可解析的邻面，近似拓扑没有 role）。 `width1` 沿 faces[0] 侧、`width2` 沿 faces[1] 侧（BREP 路径）。

**Parameters**:
- `input`: 目标几何。type:Shape required:true
- `params.edges`: 参与倒角的边：CadQuery 边选择器字符串（如 "|Z"，AI 生成）或相邻两面的 role 线路（EdgeTopoRef[]，UI 拾取产物）。type:EdgeTopoRef[]|string required:true
- `params.type`: 倒角类型（equal | twoDistances | distanceAngle）。type:string required:true
- `params.width`: type=equal: 倒角宽度（mm）。type:number 默认 1
- `params.width1`: type=twoDistances: 沿 faces[0] 侧距离（mm）。type:number
- `params.width2`: type=twoDistances: 沿 faces[1] 侧距离（mm）。type:number
- `params.angle`: type=distanceAngle: 与参考面夹角（度，(0,90)）。type:number

**Returns**: Shape 倒角后的几何。

 **Async**.

**Examples**:
```js
const p = await cad.chamfer(part0, { edges: [{ kind:'edge', faces:[{ origin:'box', role:'box:top' }, { origin:'box', role:'box:front' }], hint:{ kind:'edge' } }], type:'equal', width:1 })
// AI 生成可写 CadQuery 边选择器字符串
const p2 = await cad.chamfer(part0, { edges: "|Z", type:'equal', width:1 })
const q = await cad.chamfer(meshPart, { edges: [3], type:'equal', width:1 })
```

### `fillet(...)`
在几何体上做圆角（等半径）。 两条路径都以 `meshEngines: ['brepkit']` 之外的事实为界：BREP 输入走 `filletWithHistory`（带面演化与 roleTable 传播）；**网格实体**输入走网格后端 （近似拓扑无 role，边按几何或序号解析，无面演化）。非 BREP 的**裸网格**输入仍抛 `E_MESH_SOLID_UNSUPPORTED`——裸网格没有近似拓扑，没有边可选。 后续特征仍可按 role 选面/选边；网格实体路径没有 role 层，边只能按几何或 序号（近似拓扑 `edges` 数组下标 + 1）指认。

**Parameters**:
- `input`: 目标几何。type:Shape required:true
- `params.edges`: 参与圆角的边：CadQuery 边选择器字符串（如 "|Z"，AI 生成）或相邻两面的 role 线路（EdgeTopoRef[]，UI 拾取产物）；网格链上也可用 1 起序号。type:EdgeTopoRef[]|string required:true
- `params.radius`: 圆角半径（mm，>0）。type:number required:true

**Returns**: Shape 圆角后的几何。

 **Async**.

**Examples**:
```js
const p = await cad.fillet(part0, { edges: [{ kind:'edge', faces:[{ origin:'box', role:'box:top' }, { origin:'box', role:'box:front' }], hint:{ kind:'edge' } }], radius:2 })
// AI 生成可写 CadQuery 边选择器字符串（"|Z" 切线平行 Z 的边）
const p2 = await cad.fillet(part0, { edges: "|Z", radius: 2 })
const q = await cad.fillet(meshPart, { edges: [3], radius: 1 })
```

### `knurl(...)`
施加滚花（顶点位移，非布尔）。mesh-only。

**Parameters**:
- `input`: 目标几何。type:Shape required:true
- `params.knurlTextureHeight`: 纹路高度（mm）。type:number 默认 0.5
- `params.knurlScaleU`: 纹路 U 向频率。type:number 默认 0.15
- `params.knurlScaleV`: 纹路 V 向频率。type:number 默认 0.15
- `params.knurlInvertDisplacement`: 反向位移。type:boolean 默认 false
- `params.knurlRefineLength`: 细分长度（mm）。type:number 默认 1.0
- `params.knurlMappingMode`: UV 映射模式。type:number 默认 5
- `params.faceCenter`: 面锚点中心。type:[x,y,z] 默认 bboxCenter
- `params.faceNormal`: 面法向。type:[x,y,z] 默认 [0,0,1]

**Returns**: Shape 滚花后的几何。

 **Async**.

**Examples**:
```js
const p = await cad.knurl(part0, { knurlTextureHeight: 0.5, knurlScaleU: 0.15, knurlScaleV: 0.15, knurlInvertDisplacement: false, knurlRefineLength: 1.0, knurlMappingMode: 5 })
```

### `shell(...)`
抽壳：移除指定面并把余下面偏置成等厚薄壁。 精度链按 role 线路选面（TopoRef 字面量或 CadQuery 面选择器字符串）； **禁止 `cad.faceRef` 序号**——序号跨内核不可移植。网格链没有 role 层， 序号是唯一无歧义的指认方式（仅当前内核快照），选择器字符串只服务精度链。

**Parameters**:
- `input`: 目标几何。type:Shape required:true
- `params.openFaces`: 要移除的面：面选择器字符串（如 ">Z"，AI 生成）或 FaceTopoRef[]（UI 拾取产物字面量；禁止 cad.faceRef 序号；网格链可用 1 起序号）。type:ShellFaceSelector[]|string required:true
- `params.thickness`: 壁厚（mm，>0）。type:number required:true
- `params.tolerance`: 容差（mm）。type:number required:false

**Returns**: Shape 抽壳后的薄壁体。

 **Async**.

**Examples**:
```js
// openFaces 取 UI 拾取产物的 FaceTopoRef 字面量（origin/role 由命名层分配，不手写）；
// ❌ 不要用 cad.faceRef 序号——跨内核不可移植
const sh = await cad.shell(part0, { openFaces: pickedFaces, thickness: 2 })
// AI 生成可写 CadQuery 面选择器字符串（"|Z" 法向平行 Z 的面、"top" 命名视图）
const sh2 = await cad.shell(part0, { openFaces: "|Z", thickness: 2 })
// 网格链（3MF mesh-solid）：无 role 层，序号是唯一无歧义指认（仅当前内核快照）
const sm = await cad.shell(meshPart, { openFaces: [4], thickness: 2 })
```

### `filletVariable(...)`
变半径圆角：对单条边施加从起点到终点的线性变半径圆角。 结果等价。旧版的 per-edge 回调变半径（variableFillet）不上脚本面。 仅 BREP 可用。

**Parameters**:
- `input`: 目标几何。type:Shape required:true
- `edge`: 目标边：EdgeTopoRef（同 cad.fillet 的 edges 条目，UI 拾取产物）或 CadQuery 边选择器字符串（如 "|Z"，AI 生成；多边命中抛错）。type:EdgeTopoRef|string required:true
- `r1`: 起点半径（mm，>0）。type:number required:true
- `r2`: 终点半径（mm，>0）。type:number required:true

**Returns**: Shape 变半径圆角后的几何。

 **Async**.

**Examples**:
```js
const v = await cad.filletVariable(part0, partEdges[0], 1, 4)
// AI 生成可写 CadQuery 边选择器字符串
const v2 = await cad.filletVariable(part0, "|Z", 1, 4)
```

### `splitByPlane(...)`
沿无限平面把实体切成两半，返回法向正/负两半（具名产物）。 `{ positive, negative }`（不是数组）；法向正侧 = positive。

**Parameters**:
- `input`: 目标实体。type:Shape required:true
- `params.point`: 平面上一点 [x,y,z]（mm）。type:Vec3 required:true
- `params.normal`: 平面法向 [x,y,z]。type:Vec3 required:true

**Returns**: 具名产物 positive/negative。

 **Async**.

**Examples**:
```js
const { positive, negative } = await cad.splitByPlane(part0, { point: [0,0,5], normal: [0,0,1] })
```

### `sectionByPlane(...)`
求实体与无限平面的精确截面线（1D 曲线，可继续建模/导出 STEP）。 全部交线收拢为一个 compound）；平面不与体相交时显式报错。

**Parameters**:
- `input`: 目标实体。type:Shape required:true
- `params.point`: 平面上一点 [x,y,z]（mm）。type:Vec3 required:true
- `params.normal`: 平面法向 [x,y,z]。type:Vec3 required:true

**Returns**: Shape 1D 截面曲线。

 **Async**.

**Examples**:
```js
const sec = await cad.sectionByPlane(part0, { point: [0,0,5], normal: [0,0,1] })
```

### `union(...)`
布尔并集：合并所有输入几何（≥2 个输入）。

**Parameters**:
- `shapes`: 参与运算的几何（变量引用，≥2 个）。type:Shape[] required:true

**Schema**: `shapes: Shape*`

**Returns**: Shape 所有输入的并集。函数名即操作，输入全是变量引用，可用 `cad.union(a, b, c)` 多输入。

 **Async**.

**Examples**:
```js
const a = await cad.union(part0, part1)
```

### `subtract(...)`
布尔差集：第一个为主体，减去其余输入。

**Parameters**:
- `shapes`: 参与运算的几何（变量引用，第一个为主体）。type:Shape[] required:true

**Returns**: Shape part0 减 part1 的差集（第一个为主体）。

 **Async**.

**Examples**:
```js
const b = await cad.subtract(part0, part1)
```

### `intersect(...)`
布尔交集：所有输入的重叠部分。

**Parameters**:
- `shapes`: 参与运算的几何（变量引用）。type:Shape[] required:true

**Returns**: Shape 所有输入的交集。

 **Async**.

**Examples**:
```js
const c = await cad.intersect(part0, part1)
```

### `revolve(...)`
旋转成形：把平面轮廓绕轴旋转（兼容生成投影签名）。

**Parameters**:
- `face`: 平面轮廓。type:Shape required:true
- `options`: 旋转轴/点/角度（透传 compat 语义）。type:RevolveOptions

**Returns**: Shape 旋转体（带链根 roleTable：bottom/top/wall:i）。

 **Async**.

**Examples**:
```js
const p1 = await cad.revolve(part0, { axis: [0, 0, 1], at: [0, 0, 0], angle: 6.283185307179586 })
```

### `sweep(...)`
扫掠：截面沿脊柱路径生成扫掠体。 `sweep(face, NURBS path)`，路径由适配器从脊柱 wire 拟合）。截面接受 wire 或面（面取其外环）；脊柱必须为 wire。选项集 = 两内核交集 = **空** —— 需要 transition / auxSpine / support / law / orientation 等 occt 独有控制面 时用 `cad.sweepAdvanced`。

**Parameters**:
- `profile`: 截面几何（wire 或面；面取其外环）。type:Shape required:true
- `spine`: 脊柱路径（wire）。type:Shape required:true

**Returns**: Shape 扫掠体。

 **Async**.

**Examples**:
```js
const path = cad.wire([[0, 0, 0], [0, 0, 50]])
const section = cad.profile({ contours: [{ segments: [
{ kind: 'line', x1: -4, y1: -4, x2: 4, y2: -4 },
{ kind: 'line', x1: 4, y1: -4, x2: 4, y2: 4 },
{ kind: 'line', x1: 4, y1: 4, x2: -4, y2: 4 },
{ kind: 'line', x1: -4, y1: 4, x2: -4, y2: -4 },
] }] })
const body = await cad.sweep(section, path)
```

### `loft(...)`
放样：按给定顺序在截面之间蒙皮生成体。 brepkit `loft` / `loftSmooth` / `loftWithOptions`）。截面可为 wire 或面 （面取其外环），至少 2 个；`endPoint` 可做终点退化到点的蒙皮。选项集 = 两内核交集 = `{ ruled, endPoint }` —— `startPoint` 与 `tolerance` 只有 occt 有，用 `cad.loftAdvanced`。brepkit 链要求各截面顶点数一致。

**Parameters**:
- `sections`: 有序截面集合（wire 或面；面取其外环）。type:Shape[] required:true
- `opts`: 放样配置（ruled / endPoint）。type:LoftOptions required:false

**Returns**: Shape 放样体。

 **Async**.

**Examples**:
```js
const bottom = cad.profile({ contours: [{ segments: [
{ kind: 'line', x1: -5, y1: -5, x2: 5, y2: -5 },
{ kind: 'line', x1: 5, y1: -5, x2: 5, y2: 5 },
{ kind: 'line', x1: 5, y1: 5, x2: -5, y2: 5 },
{ kind: 'line', x1: -5, y1: 5, x2: -5, y2: -5 },
] }] })
const top = cad.translate(cad.profile({ contours: [{ segments: [
{ kind: 'line', x1: -3, y1: -3, x2: 3, y2: -3 },
{ kind: 'line', x1: 3, y1: -3, x2: 3, y2: 3 },
{ kind: 'line', x1: 3, y1: 3, x2: -3, y2: 3 },
{ kind: 'line', x1: -3, y1: 3, x2: -3, y2: -3 },
] }] }), [0, 0, 20])
const body = await cad.loft([bottom, top])
```

### `cut(...)`
Boolean cut (subtract): remove `tool` from `base`. Same semantics as {@link subtract} but with the brepjs-compatible `(base, tool, options?)` signature. Overrides the generated projection (compatOp) to do roleTable propagation (Phase 3: L2 requires wall:<i> to survive cut).

**Parameters**:
- `base`: the target shape. type:Shape required:true
- `tool`: the shape to subtract. type:Shape required:true

**Returns**: Shape base minus tool.

 **Async**.

**Examples**:
```js
const b = await cad.cut(part0, part1)
```

---

## 修复

### `defeature(...)`
移除特征面（孔/凸台等），恢复基础形状。

**Parameters**:
- `input`: 目标几何。type:Shape required:true
- `faces`: 要移除的面：面选择器字符串（如 "|Z"，AI 生成）或 FaceTopoRef[]（UI 拾取产物字面量；禁止 cad.faceRef 序号）。type:FaceTopoRef[]|string required:true

**Returns**: Shape 移除特征后的几何。

 **Async**.

**Examples**:
```js
// faces 取 UI 拾取产物的 FaceTopoRef 字面量；❌ 禁止 cad.faceRef 序号（跨内核不可移植）
const base = await cad.defeature(part0, pickedFaces)
// AI 生成可写 CadQuery 面选择器字符串
const base2 = await cad.defeature(part0, "|Z")
```

### `unifySameDomain(...)`
合并同域面/边（去除被分割成多片的冗余细分）。

**Parameters**:
- `input`: 目标几何。type:Shape required:true

**Returns**: Shape 合并后的几何。

 **Async**.

**Examples**:
```js
const merged = await cad.unifySameDomain(part0)
```

### `sew(...)`
缝合：把一组面/壳沿公共边缝成一张壳。

**Parameters**:
- `shapes`: 面/壳集合。type:Shape[] required:true
- `params.tolerance`: 缝合容差（mm）。type:number required:false

**Returns**: Shape 缝合后的壳。

 **Async**.

**Examples**:
```js
const shellShape = await cad.sew([f1, f2, f3], { tolerance: 1e-5 })
```

### `sewAndSolidify(...)`
缝合并固化为实体：缝合后若闭合则生成 solid。

**Parameters**:
- `shapes`: 面/壳集合。type:Shape[] required:true
- `params.tolerance`: 缝合容差（mm）。type:number required:false

**Returns**: Shape 缝合固化后的实体。

 **Async**.

**Examples**:
```js
const solid = await cad.sewAndSolidify([f1, f2, f3, f4, f5, f6])
```

### `removeHolesFromFace(...)`
移除面（或实体某面）上的孔。 （L1 形参是面句柄；借入输入 Shape 的 BREP 槽位句柄）。

**Parameters**:
- `face`: 含孔的面几何。type:Shape required:true

**Returns**: Shape 去孔后的面。

 **Async**.

**Examples**:
```js
const plain = await cad.removeHolesFromFace(faceWithHoles)
```

---

## 导出

### `exportStl(...)`
导出 STL（二进制 / ASCII 双形态）。 不走原生二次三角化，产物与显示 mesh 逐三角形一致。空 mesh（如 `cad.halfSpace` 产的无界体）显式报 E_EXPORT_STL_EMPTY，不返回空文件。 返回值是**纯数据**（二进制 `Uint8Array` 或 ASCII 文本），由宿主写入文件。 **宿主门**：仅 `'node'` 宿主可执行；browser / weapp / 未声明宿主报 E_HOST_UNSUPPORTED（门在读取载荷之前），浏览器与小程序里导出走宿主入口。

**Parameters**:
- `shape`: Shape — 目标几何（brep 或 mesh 链路的 Shape）。type:Shape required:true
- `options`: ExportStlOptions

**Returns**: Uint8Array 二进制 STL 字节；`options.ascii === true` 时返回 ASCII 文本 string。

 **Sync**.

**Examples**:
```js
const bytes = cad.exportStl(part0)
const text = cad.exportStl(part0, { ascii: true, name: 'bracket' })
```

### `exportStep(...)`
导出 STEP 文本（与 `cad.import_step` 成对的导出侧）。 故同一入参下脚本面文本与库面**逐字节一致**（同一真源，不另起写出通道）。 返回**纯文本**（ISO-10303-21），由宿主写入 `.step` / `.stp` 文件——内核不 import fs。`unit` 只声明单位，坐标换算与声明由库面成对完成（缺省 mm）。 入参可为单件 Shape 或装配 compound（`cad.assembly` / `cad.group` 产物）， compound 逐成员导出并带上成员名与 `memberColors`；空装配显式报 E_EXPORT_STEP_EMPTY，不落空文件。 **宿主门**：仅 `'node'`（browser / weapp / 未声明报 E_HOST_UNSUPPORTED）。 引擎通道无门禁：库面按当前引擎分派——brepkit → 内核原生通道（unit/fileMeta 不生效），occt → XCAF 装配通道。

**Parameters**:
- `shape`: Shape | CompoundShape — 目标几何（单件 Shape 或装配 compound）。type:Shape|CompoundShape required:true
- `options`: ExportStepOptions

**Returns**: string STEP（ISO-10303-21）文本。

 **Sync**.

**Examples**:
```js
const text = cad.exportStep(part0)
const asm = cad.exportStep(asm1, { unit: 'inch' })
```

### `export3mf(...)`
导出 3MF（ZIP 容器字节）。 故同一入参下脚本面字节与库面**逐字节一致**（同一真源）。返回 **ZIP 字节** （`Uint8Array`），由宿主写入 `.3mf` 文件——内核不 import fs。`unit` 只声明单位 （写 `<model unit>`），坐标随之换算，两者同源（缺省 mm）。 入参可为单件 Shape 或装配 compound；compound 逐成员导出并带上成员名与 `memberColors`（basematerials）。条目**只交 mesh**：无 mesh 的条目会被写出器 静默跳过、产出「ZIP 合法但对象为空」的假成功，故三角数为 0 的成员视为不可导出， 全体不可导出时显式报 E_EXPORT_3MF_EMPTY。 **宿主门**：仅 `'node'` 宿主可执行；browser / weapp / 未声明宿主报 E_HOST_UNSUPPORTED（门在读取载荷之前）。无引擎门——写出器是纯 XML + ZIP， 与引擎身份无关。

**Parameters**:
- `shape`: Shape | CompoundShape — 目标几何（单件 Shape 或装配 compound）。type:Shape|CompoundShape required:true
- `options`: Export3mfOptions

**Returns**: Uint8Array 3MF（ZIP）字节。

 **Sync**.

**Examples**:
```js
const bytes = cad.export3mf(part0)
const asmBytes = cad.export3mf(asm1)
```

---

## 查询

### `faceNormal(...)`
查询面上某点（锚点）的法向。

**Parameters**:
- `of`: Shape — 目标几何（编译产物 ctx.<var> 引用）。type:Shape required:true
- `anchor`: Vec3 — 锚点（几何反查兜底）。type:[x,y,z]
- `ordinal`: number — 面序号（BREP 拓扑引用优先）。type:number

**Returns**: Vec3 面上锚点处的法向 [x,y,z]。

 **Sync**.

**Examples**:
```js
const n = cad.faceNormal(part0, [0, 0, 5])
```

### `bboxCenter(...)`
查询几何包围盒中心。

**Parameters**:
- `of`: Shape — 目标几何。type:Shape required:true

**Returns**: Vec3 包围盒中心 [x,y,z]。交互式可编辑（参数量引用）。

 **Sync**.

**Examples**:
```js
const c = cad.bboxCenter(part0)
```

### `bboxMin(...)`
查询几何包围盒最小角点。

**Parameters**:
- `of`: Shape — 目标几何。type:Shape required:true

**Returns**: Vec3 包围盒最小角点 [x,y,z]。

 **Sync**.

**Examples**:
```js
const mn = cad.bboxMin(part0)
```

### `bboxMax(...)`
查询几何包围盒最大角点。

**Parameters**:
- `of`: Shape — 目标几何。type:Shape required:true

**Returns**: Vec3 包围盒最大角点 [x,y,z]。

 **Sync**.

**Examples**:
```js
const mx = cad.bboxMax(part0)
```

### `edgeRef(...)`
查询几何体第 N 条边的 `EdgeTopoRef`（1 起），供按 role 线路选边（`cad.fillet` / `cad.chamfer` 的 `edges` 等）使用。**查询用途，不用于脚本生成**——序号是内核 枚举序，跨内核/跨特征会漂移；本 API 仅供 FCStd 移植桥与网格链等无 role 层场景使用。 定不了案（无 BREP / 序号越界 / 邻面不足两面 / 邻面无 role 血统）抛 `TopoRefError`。

**Parameters**:
- `of`: Shape — 目标几何（BREP 实体所在的 Shape）。type:Shape required:true
- `edgeOrdinal`: number — 边序号（1 起；等于 FreeCAD 的 `EdgeN`）。type:number required:true

**Returns**: EdgeTopoRef 该边的拓扑引用（相邻两面 role 对 + length/midpoint hint）。

 **Sync**.

### `faceRef(...)`
查询几何体第 N 张面的 `FaceTopoRef`（1 起），供按 role 线路选面（`cad.extrude` 的 `upTo` 等）使用。**查询用途，不用于脚本生成**——序号是内核枚举序，跨内核/跨特征 会漂移；本 API 仅供 FCStd 移植桥与网格链等无 role 层场景使用。 定不了案（无 BREP / 序号越界 / 面无 role 血统）抛 `TopoRefError`。

**Parameters**:
- `of`: Shape — 目标几何（BREP 实体所在的 Shape）。type:Shape required:true
- `faceOrdinal`: number — 面序号（1 起；等于 FreeCAD 的 `FaceN`）。type:number required:true

**Returns**: FaceTopoRef 该面的拓扑引用（origin/role 血统 + 几何 hint）。

 **Sync**.

### `asset(...)`
查询资产 key 内容为 UTF-8 字符串（SVG 等文本资产）。嵌套调用，供 text/svg 类 op 作资产引用。

**Parameters**:
- `key`: string — 资产 key。type:string required:true

**Returns**: Promise<string> 资产内容字符串（UTF-8 解码）。`cad.asset('cfg')` 返回 SVG 等文本资产，可作 svgExtrude/engrave 的 svg 参数。

 **Async**.

**Examples**:
```js
const svg = await cad.asset('logo_cfg')
```

---

## 结构

### `compound(...)`
`cad.compound({ members, name? })` → 几何复合体 Shape（持 OCCT 句柄）。

**Parameters**:
- `params`: { members?: Array<Shape | CompoundShape>; name?: string }

**Returns**: Shape 几何复合体（brep 路径持句柄，可变换/可导出）。

 **Sync**.

**Examples**:
```js
const c = cad.compound({ members: [part0, part1] })
```

---

## Generated Script-Face Ops

These ops are generated from the L3 surface specification and merged into the `cad` namespace.

---

## Sketch

The `cad.sketch` op is provided by the `@faicad/faijs-sketch` library, merged into the `cad` namespace.

### `sketch(...)`
Sketch (semantic shapes / geometry + constraints) → solve → face / outer wire. 两条入口（二选一）： - `shapes`：语义图元（矩形/圆/……/画笔图元/close）→ 库面 `expandShapes` 展开成 canonical 几何 + 形状自带约束，再与调用方给的 `constraints` 合并求解； - `geoms`：直接给展开后的 canonical 几何（存量语句形态）。 Permanently brep-only (D5, 2026-09-27): the mesh path reports `E_MESH_UNSUPPORTED`. Sketch APIs never get a mesh path — industry precedent (CadQuery, FreeCAD) solves sketches onto exact BREP edges.

**Parameters**:
- `params.shapes`: 语义图元清单（与 geoms 二选一）。type:SketchShape[] required:false
- `params.geoms`: 展开后的草图几何（线段/圆/圆弧，与 shapes 二选一）。type:SketchGeom[] required:false
- `params.constraints`: 草图约束（可空；追加在形状自带约束之后）。type:SketchConstraint[] required:false
- `params.as`: 产物形态：'face'（默认）构面；'wire' 只交外环 wire。type:'face'|'wire' required:false
- `params.plane`: 放置目标命名平面（默认 'XY'；如 'XZ' / 'YZ'）。type:string required:false

**Returns**: Shape 平面几何（求解后构面）；`as:'wire'` 时返回外环 1D 曲线。

 **Async**.

**Examples**:
```js
const plate = cad.sketch({
plane: 'XY',
shapes: [
{ kind: 'rect', w: 100, d: 60, tag: 'g0' },
{ kind: 'circle', r: 10, cx: 30, cy: 20, tag: 'hole', mode: 's' },
],
constraints: [{ kind: 'length', of: { tag: 'g0.0' }, value: 100 }],
})
```
```js
const f = cad.sketch({
geoms: [{ tag:'bottom', kind:'line', x1:0, y1:0, x2:80, y2:3 }],
constraints: [{ kind:'horizontal', of: { tag:'bottom' } }, { kind:'length', of: { tag:'bottom' }, value: 80 }],
})
```

---

## Editor Extension Ops

These ops are provided by `@faicad/faijs-extra` and merged into the `cad` namespace.

### Editor Ops

### `fai_drill(...)`
在几何体上钻孔（CSG 减除）。depth=0 为通孔，>0 为盲孔。

**Parameters**:
- `input`: 目标几何。type:Shape required:true
- `params.diameter`: 孔径（mm）。type:number required:true
- `params.depth`: 孔深（mm）；0 = 通孔，> 0 = 盲孔。type:number 默认 0
- `params.holeType`: 孔类型：simple 简单孔 / screw 螺丝孔。type:'simple' | 'screw' 默认 'simple'
- `params.direction`: 钻孔轴向（normal 表示沿面法向）。type:'normal' | 'x' | 'y' | 'z' 默认 'normal'
- `params.position`: 孔心位置。type:[x,y,z] 默认 原点
- `params.face`: 面引用（§6.2 新形态：`FaceTopoRef`，执行期按输入 Shape 解析派生法向；优先于 `faceNormal`）。type:FaceTopoRef
- `params.faceNormal`: 面法向（决定朝向；历史兜底，§6.2 起宿主不再写，改由 `face` 解析）。type:[x,y,z] 默认 [0,0,1]
- `params.tolerance`: 公差（mm）。type:number 默认 0.3
- `params.screwSystem`: 螺丝孔制式（holeType='screw' 时用）。type:'metric' | 'imperial' 默认 'metric'
- `params.screwSpecIdx`: 螺丝规格索引（holeType='screw' 时用；4 → M5）。type:number 默认 4
- `params.screwThread`: 螺丝螺纹类型。type:'coarse' | 'fine' | 'custom' 默认 'coarse'
- `params.screwHead`: 螺丝头型。type:'hex' | 'chc' | 'none' 默认 'none'

**Returns**: Shape 钻孔后的几何。

 **Async**.

**Examples**:
```js
const p = await cad.fai_drill(part0, { diameter: 5 })
const p = await cad.fai_drill(part0, { diameter: 5, depth: 3 })
const p = await cad.fai_drill(part0, { diameter: 5.2, depth: 8, holeType: 'screw', screwSystem: 'metric', screwSpecIdx: 4, screwThread: 'coarse', screwHead: 'none' })
```

### `fai_extrude(...)`
沿法向拉伸几何。

**Parameters**:
- `input`: 目标几何。type:Shape required:true
- `params.length`: 总拉伸量（mm）。type:number required:true
- `params.mode`: 拉伸方向：centered 双向各一半 / forward 正向 / backward 反向。type:'centered' | 'forward' | 'backward' 默认 'centered'
- `params.normal`: 拉伸方向法向。type:[x,y,z] 默认 当前面法向 [0,0,1]
- `params.planeDistance`: 切面在法向上的偏移。type:number 默认 0
- `params.space`: 坐标空间声明。type:'local' | 'world'

**Returns**: Shape 拉伸后的几何。

 **Async**.

**Examples**:
```js
const p = await cad.fai_extrude(part0, { length: 10 })
const p = await cad.fai_extrude(part0, { length: 10, mode: 'forward' })
const p = await cad.fai_extrude(part0, { length: 10, normal: [0,0,1], planeDistance: 2 })
```

### `fai_split(...)`
分割几何，返回具名对象 { front, back } 两个独立零件。

**Parameters**:
- `input`: 目标几何。type:Shape required:true
- `params.cutMode`: 切割模式。type:'plane' | 'dovetail' | 'dowel' | 'tenon' | 'straight-tenon' | 'straight' 默认 'plane'
- `params.normal`: 切割面法向。type:[x,y,z] 默认 [0,0,1]
- `params.offset`: 切割面沿法向偏移（过 bbCenter）。type:number 默认 0
- `params.inPlaneAngle`: 切割面面内旋转角（度）。type:number 默认 0
- `params.bbCenter`: 包围盒中心（缺省自动推导）。type:[x,y,z] 默认 自动
- `params.bboxSize`: 包围盒尺寸（缺省自动推导）。type:[x,y,z] 默认 自动
- `params.applyExplode`: 是否将两侧沿法向分离位移（bbox 对角线 2% + 榫卯深度一半）。type:boolean 默认 true
- `params.grooveDepth`: 燕尾槽深（cutMode='dovetail'）。type:number
- `params.grooveWidth`: 燕尾槽宽（cutMode='dovetail'）。type:number
- `params.grooveDepthTolerance`: 燕尾槽深公差。type:number
- `params.grooveWidthTolerance`: 燕尾槽宽公差。type:number
- `params.grooveFlapsAngle`: 燕尾槽翼角（度）。type:number
- `params.dowelDiameter`: 定位销直径（cutMode='dowel'）。type:number
- `params.dowelDiameterTolerance`: 定位销直径公差。type:number
- `params.dowelHeight`: 定位销高度。type:number
- `params.dowelHeightTolerance`: 定位销高度公差。type:number
- `params.tenonSideLength`: 直榫边长（cutMode='tenon'/'straight-tenon'）。type:number
- `params.tenonSideLengthTolerance`: 直榫边长公差。type:number
- `params.tenonHeight`: 直榫高度。type:number
- `params.tenonHeightTolerance`: 直榫高度公差。type:number
- `params.selectedSections`: 参与榫卯的截面下标。type:number[]

**Returns**: { front: Shape; back: Shape } 必须用解构 `const { front: partA, back: partB } = await cad.fai_split(...)` 取出两个零件。

 **Async**.

**Examples**:
```js
const { front: part1, back: part2 } = await cad.fai_split(part0, { normal: [0, 0, 1], offset: 5, cutMode: 'dovetail', grooveDepth: 3, grooveWidth: 5 })
```

### `copy(...)`
深拷贝几何为独立新对象（源不变，源与副本都显示）。

**Parameters**:
- `input`: 源几何。type:Shape required:true

**Returns**: Shape 源几何的深拷贝。copy 不消费其源（画布显示 box 和副本两份），改副本不影响源。

 **Sync**.

**Examples**:
```js
const part1 = cad.copy(part0)
```

### SVG / 3D Text Creators

### `text(...)`
生成文字零件（文字轮廓挤出，X/Z 居中、Y 底部对齐原点）。

**Parameters**:
- `maybeParams`: 兼容形态的补充参数（正常不传）。type:Record<string, unknown> required:false
- `inputOrParams.text`: 要生成的文字。type:string required:true
- `inputOrParams.size`: 字号（mm）。type:number required:true
- `inputOrParams.depth`: 挤出深度（mm）。type:number required:true
- `inputOrParams.font`: 字体。type:string 默认 默认字体

**Returns**: Shape 文字几何，生成独立零件。

 **Async**.

**Examples**:
```js
const t = await cad.text({ text: 'Hello', size: 20, depth: 5 })
```

### `svgExtrude(...)`
从二维 SVG 轮廓挤出零件（拓扑操作）。

**Parameters**:
- `params.svg`: SVG 内容：资产 key（推荐）或整份 SVG 文本（兼容）。type:string required:true
- `params.depth`: 挤出深度（mm）。type:number required:true
- `params.targetLongSide`: 长边目标尺寸（mm）。type:number 默认 20

**Returns**: Shape SVG 挤出几何，生成独立零件。

 **Async**.

**Examples**:
```js
const s = await cad.svgExtrude({ svg: 'logo.svg', depth: 5, targetLongSide: 20 })
```

---

## Shape Instance Methods

Shape instances returned by `cad.*` ops carry instance methods for appearance and metadata control. These are **not** `cad.*` ops — they are called directly on shape variables (e.g., `box1.setColor(...)`).

### Appearance Methods (Color / Material / Opacity)

#### `setAppearance(spec: PbrAppearance): this`
合并外观：`{...cur, ...spec}`，spec 中 undefined 字段保留旧值。

#### `setColor(color: PbrColor): this`
便捷：等价 setAppearance({ color })；#rrggbbaa / [r,g,b,a] 的 alpha 归一为 opacity。

#### `setMaterial(spec: MaterialSpec): this`
便捷：等价 setAppearance(spec)。

#### `setOpacity(opacity: number): this`
便捷：透明度权威字段（0–1）。

#### `getAppearance(): Readonly<PbrAppearance> | undefined`
读取当前外观（可能 undefined）。

#### `setFaceColor(faces: number[], color: PbrColor): this`
面级设色：把 faceIds 指定的面（面序号契约见 `Shape.faceRanges`，参数化 primitives 才有）写入 `materialGroups`。无面结构（布尔/组合/导入产物）抛 `E_FACE_UNAVAILABLE`；面序号越界抛 `E_FACE_INDEX`。

#### `setFaceMaterial(faces: number[], spec: MaterialSpec): this`
面级材质：等价 setFaceColor 的 material 版本。

### Metadata Methods (Name / Description / Part Number)

#### `setMeta(spec: ShapeMeta): this`
合并 meta：`{...cur, ...spec}`，spec 中 undefined 字段保留旧值。

#### `setName(name: string): this`
便捷：等价 setMeta({ name })（空串视为清除）。

#### `setDescription(description: string): this`
便捷：等价 setMeta({ description })（空串视为清除）。

#### `setPartNumber(partNumber: string): this`
便捷：等价 setMeta({ partNumber }）。

#### `setMetaField(key: string, value: string): this`
便捷：等价 setMeta({ metadata: {...cur.metadata, ...kv} })；值为空串的键删除。

#### `getMeta(): Readonly<ShapeMeta> | undefined`
读取当前 meta（可能 undefined）。

---

## @faicad/sheetmetal — Sheet-Metal CAD Domain

Import in `.fai.js`:
```js
import * as lib from '@faicad/sheetmetal'
```

### Other

#### `getMaterial(name: string): MaterialSpec | undefined`
Look up a material by its name.

**Parameters**:
- `name`: The material name to look up.

**Returns**: The matching material spec, or undefined if not found.

#### `bendAllowance(angleDeg: number, thickness: number, rule: BendRule, onWarning?: (warning: SheetMetalWarning) => void): Result<number>`
Bend allowance — the developed (flat) length of material consumed by a bend, measured along the neutral axis. Resolution precedence (see {@link resolveBendAllowance}): a referenced bend table, then an explicit `rule.allowance` override, then the K-factor formula BA = (π/180)·|angle|·(R + K·T). An optional `onWarning` receives the clamp warning when a table query falls outside its tabulated range.

**Parameters**:
- `angleDeg`: the bend angle in degrees
- `thickness`: the sheet thickness
- `rule`: the bend rule used for the resolution
- `onWarning`: optional callback receiving a clamp warning when a table query falls outside its tabulated range

**Returns**: a `Result<number>` — `ok` with the computed bend allowance on success, or `err` with a `validationError` when the inputs are invalid

#### `developedLength(angleDeg: number, thickness: number, rule: BendRule, onWarning?: (warning: SheetMetalWarning) => void): Result<number>`
Developed length of the bend region when flattened — the neutral-axis arc length that replaces the curved patch in the flat pattern. Identical to the bend allowance (kept distinct in name for the unfold call sites that consume it as a strip width), and routed through the same {@link resolveBendAllowance} resolution (table → explicit allowance → K-factor).

**Parameters**:
- `angleDeg`: the bend angle in degrees
- `thickness`: the sheet thickness
- `rule`: the bend rule used for the resolution
- `onWarning`: optional callback receiving a clamp warning when a table query falls outside its tabulated range

**Returns**: a `Result<number>` — `ok` with the developed length on success, or `err` with a `validationError` when the inputs are invalid

#### `neutralRadius(thickness: number, rule: BendRule): Result<number>`
Neutral-axis radius R + K·T (the radius the developed arc length is measured at).

**Parameters**:
- `thickness`: the sheet thickness
- `rule`: the bend rule providing `innerRadius` and `kFactor`

**Returns**: a `Result<number>` — `ok` with the neutral-axis radius on success, or `err` with a `validationError` when the inputs are invalid

#### `registerBendTable(table: BendTable): Result<BendTable>`
Register (or replace) a bend table under its id, so a {@link BendRule} with a matching `bendTableRef` resolves against it. Returns the registered table.

**Parameters**:
- `table`: the bend table to register.

**Returns**: a {@link Result} carrying the stored (copied) table on success, or a validation error when the id, kind, or any row is invalid.

#### `getBendTable(id: string): BendTable | undefined`
Look up a registered bend table by id (registers the starter tables on first use).

**Parameters**:
- `id`: the bend table id to look up.

**Returns**: the registered {@link BendTable}, or `undefined` when no table is registered under `id`.

#### `resolveBendAllowance(rule: BendRule, angleDeg: number, thickness: number, onWarning?: (warning: SheetMetalWarning) => void): Result<number>`
The single source of truth for a bend's developed (neutral-axis) length. Precedence: 1. `rule.bendTableRef` — look up the table and interpolate it (linear in angle, bilinear across thickness × radius), converting a deduction table to an allowance via {@link allowanceFromDeduction}. Outside the table extents the lookup clamps to the nearest breakpoint and reports a `MIN_RADIUS`-class warning through `onWarning` rather than extrapolating. 2. `rule.allowance` — an explicit per-bend override, returned verbatim. 3. The K-factor formula BA = (π/180)·|angle|·(R + K·T). The returned value is in the same units and sense the rest of the package's `developedLength` consumes (a strip width along the developed pattern).

**Parameters**:
- `rule`: the bend rule driving the lookup (bend table ref, explicit allowance, or K-factor).
- `angleDeg`: the bend angle in degrees.
- `thickness`: the sheet thickness.
- `onWarning`: optional callback invoked with a {@link SheetMetalWarning} when a table lookup clamped to the nearest breakpoint outside the tabulated range.

**Returns**: a {@link Result} carrying the resolved bend allowance on success, or a validation error for an unknown table / non-positive input / failed lookup.

#### `buildFeatureGraph(part: SheetMetalPart): Result<FeatureGraph>`
Build the feature graph for an authored part. Each flange contributes a flat node `flange.id`; bends connect a parent flat to a child flat. A bend whose id matches a flange id (the flange's own fold) is wired parent→flange; any other bend is matched to a flange by id suffix `<flange>::<n>` or defaults to a root-anchored edge so authored parts always produce a connected graph.

**Parameters**:
- `part`: the authored sheet-metal part to graph.

**Returns**: a `Result<FeatureGraph>` — `ok` with `{ nodes, edges }` on success, or `err` with a `validationError` for a non-positive thickness, duplicate flange/bend ids, or bends that resolve to no flange flat.

#### `buildFeatureTree(graph: FeatureGraph, rootId: string): Result<FeatureTree>`
Spanning tree over the feature graph, rooted at the base flat. Tree edges are returned BFS-ordered (every parent appears before its children); edges that would close a cycle (box/closed profiles) become seam cuts with a warning.

**Parameters**:
- `graph`: the feature graph built by {@link buildFeatureGraph}.
- `rootId`: the flat id to root the tree at; defaults to {@link ROOT_FLAT_ID}.

**Returns**: a `Result<FeatureTree>` — `ok` with the BFS-ordered tree bends, seam cuts, flat nodes, and warnings, or `err` with a `validationError` when the root is unknown or some flat is unreachable from the root.

#### `featureTree(part: SheetMetalPart, rootId: string): Result<FeatureTree>`
Convenience: graph + spanning tree in one call.

**Parameters**:
- `part`: the authored sheet-metal part to graph and tree.
- `rootId`: the flat id to root the tree at; defaults to {@link ROOT_FLAT_ID}.

**Returns**: a `Result<FeatureTree>` — `ok` with the feature tree, or the first `err` produced by {@link buildFeatureGraph} or {@link buildFeatureTree}.

#### `unfold(part: SheetMetalPart): Result<UnfoldResult>`
Flatten an authored part into a developed flat pattern + bend report + warnings.

**Parameters**:
- `part`: the authored sheet-metal part to flatten.

**Returns**: a `Result<UnfoldResult>` with the flat pattern, bend report, and any warnings.

#### `unfoldForeignSolid(solid: Solid, opts?: { kFactor?: number | undefined }): Result<UnfoldResult>`
Unfold an ARBITRARY imported sheet-metal solid with no feature tree, by detecting its geometry numerically. The supported class is roughly-uniform- thickness solids whose panels are planar and whose bends are cylindrical: 1. Classify faces by surface type — planar faces are panel faces, cylindrical faces are bend faces. Any other surface type is reported `UNSUPPORTED_FACE`. 2. Pair the two large parallel planar faces of each flat panel (a thickness apart); pair the inner/outer cylindrical faces of each bend and fit its axis + inner radius + swept angle via {@link fitCylinder}. 3. Build a bend graph (flats = nodes; a bend connects the two flats it shares edges with), take a spanning tree from a root flat, and turn any non-tree bend into a seam cut (warned). 4. Walk the tree replacing each cylindrical bend region with a developed strip of length `developedLength(angle, thickness, { innerRadius, kFactor })` (`kFactor` defaults to the {@link DEFAULT_FOREIGN_K} mid-surface), laying each flat out into the plane. Bend direction (up/down) is read from the cylinder centre relative to the parent flat. Non-fatal warnings ride inside the Ok payload; the function fails only when the input is not a recognizable sheet-metal solid at all.

**Parameters**:
- `solid`: the foreign solid to unfold.
- `opts`: optional k-factor override.

**Returns**: the unfold result, or an error.

#### `fitCylinder(face: Face): FittedCylinder | null`
Numerically fit a cylinder to a face. Every normal of a cylinder is perpendicular to the axis, so the axis direction is the common perpendicular of the sampled normals: it is recovered as the sign-aligned average of the cross products of pairs of non-parallel sampled normals (each such cross product lies along ±axis). The axis LINE and RADIUS are then found by projecting the sample points onto the plane ⟂ axis and fitting a circle (algebraic least squares); the radius is the mean distance from the axis line to the points. The angular span is the extent of the projected points about the fitted centre. Returns `null` when the surface does not fit a cylinder within {@link FIT_RESIDUAL_TOL}.

**Parameters**:
- `face`: the B-rep face to fit.

**Returns**: the fitted cylinder, or null if the face is not cylindrical.

#### `fold(input: FlatInput): Promise<Result<SheetMetalPart>>`
Fold a flat pattern (region-tree) up into a 3D part — the inverse of {@link unfold}.

**Parameters**:
- `input`: the flat pattern (region tree) to fold up.

**Returns**: a `Result<SheetMetalPart>` carrying the folded 3D part, or the first error.

#### `foldWithWarnings(input: FlatInput): Promise<Result<FoldResult>>`
{@link fold} that also surfaces the fold warnings alongside the part.

**Parameters**:
- `input`: the flat pattern input to fold.

**Returns**: the fold result with warnings, or an error.

#### `patternToFlatInput(pattern: FlatPattern, opts: PatternToFlatInputOptions): Result<FlatInput>`
Reconstruct a {@link FlatInput} region-tree from the *2D flat-pattern geometry* alone — `pattern.outline` (a closed 2D wire) and `pattern.bendLines` (each a 2D segment + fold angle/direction). Nothing is read from a feature tree or a 3D solid: the regions, sides, offsets, spans and flat lengths are all recovered by reading real 2D coordinates back out of the wire/edges via the public morph geometry readers (`getEdges`, `curveStartPoint`, `curveEndPoint`). This is the non-circular round-trip bridge: feeding `unfold(part).pattern` through here and into {@link fold} exercises unfold's 2D placement, this parser, and the forward fold geometry — a bug in any of them breaks the round-trip. Algorithm (rectilinear families — PR1 develops only axis-aligned rectangles): every bend line is an axis-aligned segment lying on the shared edge between a parent region and a child's developed strip. The developed strip width is `developedLength(angle, thickness, ruleFor(i))` (the supplied rule). BFS outward from the base region (the one anchored at the origin): a bend line on a known region's edge spawns a child region whose far edge is the next outward bend line (a grandchild) or the outline boundary; `length = far-extent − dev`, `span` = bend-line length, `offset`/`side` are the bend line's position on the parent edge.

**Parameters**:
- `pattern`: the flat pattern to convert.
- `opts`: options (thickness, ruleFor, material).

**Returns**: the flat input, or an error.

#### `partToFlatInput(part: SheetMetalPart): Result<FlatInput>`
Convert an authored {@link SheetMetalPart} into the {@link FlatInput} that folds back into it, going strictly through the 2D flat pattern: `unfold(part)` produces the developed wire + bend lines, and {@link patternToFlatInput} recovers the region tree from that 2D geometry. Only the bend *rule* is read off the part (by matching bend id), which a flat pattern legitimately cannot encode; every geometric attribute is parsed from the wire/edges. This makes the round-trip oracle non-circular — a bug in unfold's 2D placement or in the parser breaks it. Seam bends (closed profiles) are left unfolded by `unfold`, so the recovered part is the open spanning-tree shape, not the re-closed box.

**Parameters**:
- `part`: the sheet metal part to recover a flat input from.

**Returns**: the flat input, or an error.

#### `authorPart(spec: AuthorSpec): Promise<Result<SheetMetalPart>>`
Author a sheet-metal part: a base flat plus an arbitrary tree of flanges. Each flange folds off one of the four edges of its parent flat (the base by default, or another flange via `parent`), in the requested direction (up/down), over an optional sub-span of that edge (`offset`/`width`). Returns a {@link SheetMetalPart} carrying the folded 3D solid and the recorded bend feature tree the unfold consumes. All construction stays on the public, OCCT-WASM-safe API.

**Parameters**:
- `spec`: the authoring spec: sheet thickness, base flat dimensions, the flange list, optional material, and optional closing seams.

**Returns**: a `Result<SheetMetalPart>` — `ok` with the folded part on success, or `err` with a `validationError` for an invalid thickness / base / flange / seam specification.

#### `baseEdgeRef(faceIndex: number): EdgeRef`
Stable edge reference for flange attachment. The base flat is `face-0`; every flange face is `face-<n+1>` in authoring order. The leading edge of a flat is `edgeIndex 0`. The reference also carries `parentId`/`side`/`offset`/`extent` so the feature tree and recursive unfold can resolve the exact parent edge a flange folds from without reading topology back out of the B-rep.

**Parameters**:
- `faceIndex`: the face index of the flat: `0` for the base, `n+1` for the flange authored in the `n`-th position.

**Returns**: an {@link EdgeRef} pointing at the flat's leading edge (`edgeIndex 0`).

#### `miterCut(part: SheetMetalPart, plane: MiterPlane): Promise<Result<SheetMetalPart>>`
General miter primitive: cut a sheet-metal part by a plane, removing the material on the `+normal` side. The tool is a half-space block sized to the part's bounding box, so the cut is exact regardless of part extent.

**Parameters**:
- `part`: the sheet metal part to cut.
- `plane`: the miter plane definition.

**Returns**: the updated part with the miter cut applied, or an error.

#### `autoMiterCorner(part: SheetMetalPart, flangeIdA: string, flangeIdB: string, gap: any): Promise<Result<SheetMetalPart>>`
Auto corner-miter between two adjacent flanges. The miter plane bisects the two flanges' fold-up directions at their shared corner and is offset by half the gap, so the cut falls on the flat/flange regions and never crosses a bend patch. The single bisector cut trims both flanges to a clean mitered corner.

**Parameters**:
- `part`: the sheet metal part to miter.
- `flangeIdA`: the first flange ID.
- `flangeIdB`: the second flange ID.
- `gap`: the gap between flanges (default 0).

**Returns**: the updated part with the miter corner applied, or an error.

#### `addBendRelief(part: SheetMetalPart, flangeId: string, spec: ReliefSpec): Promise<Result<SheetMetalPart>>`
Add a bend relief to a flange: a small slot cut into the PARENT flat at each end of the bend line that does not reach the parent edge endpoint (a partial/offset flange). Without it the parent material tears at the corner where the bend terminates mid-edge. Each slot is `width` (≈ thickness) along the parent edge by `depth` (≈ developed length + clearance) into the parent flat, cut from the 3D solid and recorded so {@link unfold} replays the 2D notch. A relief is a recorded feature replayed by unfold — exactly the pattern {@link autoMiterCorner} establishes for corner miters.

**Parameters**:
- `part`: the sheet metal part to cut.
- `flangeId`: the flange (bend) ID to relieve.
- `spec`: the relief specification (default rectangular).

**Returns**: the updated part with the bend relief recorded, or an error.

#### `autoBendReliefs(part: SheetMetalPart, spec: ReliefSpec): Promise<Result<SheetMetalPart>>`
Add a bend relief to every partial-span bend (a flange that does not span its full parent edge). Full-span flanges are skipped — they have no mid-edge bend terminus to relieve. Convenience over calling {@link addBendRelief} per flange.

**Parameters**:
- `part`: the sheet metal part to process.
- `spec`: the relief specification (default rectangular).

**Returns**: the updated part with all needed bend reliefs, or an error.

#### `cornerRelief(part: SheetMetalPart, flangeIdA: string, flangeIdB: string, spec: ReliefSpec): Promise<Result<SheetMetalPart>>`
Corner relief between two adjacent flanges: a notch cut at their shared corner so the two upright flanges clear each other once folded — the alternative to a 45° miter for the same corner {@link autoMiterCorner} handles. The notch is cut from the solid and recorded as a {@link ReliefFeature}; the corner is also recorded in `miters` (gap 0) so the collision check treats the interference as resolved.

**Parameters**:
- `part`: the sheet metal part to cut.
- `flangeIdA`: the first flange ID.
- `flangeIdB`: the second flange ID.
- `spec`: the relief specification (default rectangular).

**Returns**: the updated part with the corner relief recorded, or an error.

#### `addCutout(part: SheetMetalPart, spec: CutoutSpec): Promise<Result<SheetMetalPart>>`
Punch a cutout (hole / slot / polygon) through a named flat region's thickness. The 2D profile is built in the region's LOCAL frame, then placed onto the correct folded face via the region's world {@link FlatFrame} (origin/u/v/n) and extruded through the sheet, so a feature authored at local `(x, y)` lands on the matching face whether the region is the base or a folded flange. The same local profile is mapped through the region's developed {@link Frame2} and recorded as a {@link CutoutFeature}, so {@link unfold} emits the matching loop in the flat pattern and {@link fold} can replay it. Guards a valid, single-bodied solid.

**Parameters**:
- `part`: the sheet metal part to cut.
- `spec`: the cutout specification (kind, region, geometry).

**Returns**: the updated part with the cutout feature recorded, or an error.

#### `addHole(part: SheetMetalPart, region: string, x: number, y: number, diameter: number): Promise<Result<SheetMetalPart>>`
Punch a circular hole of `diameter` centred at region-local `(x, y)`.

**Parameters**:
- `part`: the sheet metal part to cut.
- `region`: the region name to cut into.
- `x`: the region-local x coordinate of the hole centre.
- `y`: the region-local y coordinate of the hole centre.
- `diameter`: the hole diameter.

**Returns**: the updated part with the hole feature recorded, or an error.

#### `addSlot(part: SheetMetalPart, region: string, opts: { x: number; y: number; length: number; width: number; angleDeg?: number; round?: boolean }): Promise<Result<SheetMetalPart>>`
Punch a slot centred at `(x, y)`: `length` along the slot axis by `width` across.

**Parameters**:
- `part`: the sheet metal part to cut.
- `region`: the region name to cut into.
- `opts`: slot geometry (x, y, length, width, angleDeg?, round?).

**Returns**: the updated part with the slot feature recorded, or an error.

#### `addPolygonCutout(part: SheetMetalPart, region: string, points: [number, number][]): Promise<Result<SheetMetalPart>>`
Punch an arbitrary polygon cutout from its region-local `points` (≥ 3).

**Parameters**:
- `part`: the sheet metal part to cut.
- `region`: the region name to cut into.
- `points`: the polygon vertices in region-local coordinates (≥ 3).

**Returns**: the updated part with the polygon cutout feature recorded, or an error.

#### `addTab(part: SheetMetalPart, spec: TabSpec): Promise<Result<SheetMetalPart>>`
Fuse a rectangular tab onto a named flat region's edge — additive material (the counterpart of a cutout). The tab is built as a region-local rectangle just past the chosen `side`, placed onto the correct folded face via the region's world {@link FlatFrame}, extruded through the sheet thickness and fused to the solid. The same local rectangle, mapped through the region's developed {@link Frame2}, is recorded as a {@link TabFeature} so {@link unfold} extends the OUTER outline by the protrusion (tabs add material, so the developed area grows). Guards a valid, single-bodied solid.

**Parameters**:
- `part`: the sheet metal part to attach a tab to.
- `spec`: the tab specification.

**Returns**: the updated part with the tab feature recorded, or an error.

#### `tabAndSlot(part: SheetMetalPart, tab: TabSpec, slot: SlotPlacement): Promise<Result<SheetMetalPart>>`
Self-fixturing tab-and-slot joint: fuse a tab on one region and punch a matching SLOT CUTOUT on the mating region, sized so the tab's cross-section (`width × thickness`) inserts into the slot. The slot is `tab.width + clearance` long by `thickness + clearance` wide, centred at the mating region's local `(x, y)`. The slot is always strictly larger than the tab cross-section, so the joint mates (verified numerically by callers). Clearance defaults to `0.1` mm.

**Parameters**:
- `part`: the sheet metal part to process.
- `tab`: the tab specification.
- `slot`: the slot placement.

**Returns**: the updated part with the tab-and-slot feature recorded, or an error.

#### `addForm(part: SheetMetalPart, spec: FormSpec): Promise<Result<SheetMetalPart>>`
Add a form feature (louver or emboss/dimple) to a named flat region. 3D FIDELITY (simplified, by design — the public CSG-only API makes true forming impractical): - LOUVER: the vent opening (`length × width`) is cut fully through the sheet, and the formed flap is represented as a thin box hinged on one side and tilted up to `height`, fused so it stays connected to the body at the hinge. True forming keeps the flap continuous with the parent and bends it; the cut+tilted-flap representation captures the vent geometry while keeping a single valid solid. - EMBOSS: a short cylinder fused onto the formed face (raised by `height`). DIMPLE: a shallow cylindrical recess cut into the formed face (recessed by `height`, never through). A true spherical/conical form is approximated by the flat-topped round so the result stays a valid single body. FLAT PATTERN (the fabrication-critical representation): the louver emits its footprint as an OPEN three-side cut path (the fabricator cuts three of its four sides — all but the hinge) plus the hinge fold line; the emboss emits its footprint circle as a marker. Forming removes no net material, so the developed outline and area are unchanged. Guards a valid, single-bodied solid.

**Parameters**:
- `part`: the sheet metal part to form.
- `spec`: the form specification.

**Returns**: the updated part with the form feature recorded, or an error.

#### `louver(part: SheetMetalPart, opts: {
    region: string;
    x: number;
    y: number;
    length: number;
    width: number;
    height: number;
    direction?: 'up' | 'down';
  }): Promise<Result<SheetMetalPart>>`
A louver vent on a region; see {@link addForm}.

**Parameters**:
- `part`: the sheet metal part to form.
- `opts`: louver geometry (region, x, y, length, width, height, direction?).

**Returns**: the updated part with the louver feature recorded, or an error.

#### `emboss(part: SheetMetalPart, opts: { region: string; x: number; y: number; diameter: number; height: number; kind: 'dimple' | 'emboss' }): Promise<Result<SheetMetalPart>>`
An emboss (raised) or dimple (recessed) round form on a region; see {@link addForm}.

**Parameters**:
- `part`: the sheet metal part to form.
- `opts`: emboss geometry (region, x, y, diameter, height, direction?).

**Returns**: the updated part with the emboss feature recorded, or an error.

#### `authorContourFlange(part: SheetMetalPart, spec: ContourFlangeSpec): Promise<Result<SheetMetalPart>>`
Author a contour flange: an OPEN 2D profile (alternating line/arc segments) swept along one straight edge of the base flat. Each arc is a cylindrical bend, each line a flat leg; consecutive segments chain frame-to-frame exactly as {@link authorPart} chains flanges, building one connected multi-bend cross-section (a return, a hat, a J). The recorded {@link ContourFlangeFeature} carries each segment's EXACT developed length (lines: `length`; arcs: the canonical {@link developedLength}) so the unfold lays the strip out straight with no error. Construction stays on the public, OCCT-WASM-safe API.

**Parameters**:
- `part`: the sheet-metal part the contour flange is added to (must already carry a solid)
- `spec`: the contour-flange specification: profile segments, side, offset, width and optional bend rule

**Returns**: a `Result<SheetMetalPart>` — `ok` with the part plus the fused solid and the recorded {@link ContourFlangeFeature}, or `err` with a `validationError` on invalid input

#### `authorLoftedFlange(part: SheetMetalPart, spec: LoftedFlangeSpec): Promise<Result<SheetMetalPart>>`
Author a lofted / ruled transition flange between two parallel OPEN profiles. The two profiles are lofted (ruled, straight generators) into a transition surface and thickened to a valid solid; the result is fused onto the part. The developed pattern is produced by TRIANGULATION (the standard transition development): each quad between consecutive vertex pairs is split into two triangles laid flat edge-length-preserving and accumulated into a developed boundary. The triangulated development is EXACT (to tolerance) when the ruled surface is developable — every quad is planar, so the two triangles share their diagonal in 3D and the flat layout preserves all lengths and angles. When a quad is non-planar (twisted ruling) the surface is not developable and the flat layout is an approximation; {@link approximate} is set and the unfold emits a `DEVELOPMENT_APPROXIMATE` warning.

**Parameters**:
- `part`: the sheet metal part to attach a lofted flange to.
- `spec`: the lofted flange specification.

**Returns**: the updated part with the lofted flange feature recorded, or an error.

#### `hem(part: SheetMetalPart, spec: HemSpec): Promise<Result<SheetMetalPart>>`
Author a hem: fold a region edge back ~180°+ onto its parent flat, then run a short return leg. Built on the contour-flange segment chainer — the curl is one or more ≤120° sub-arcs (each a recorded `hem::<id>::<n>` bend) followed by a flat return — so the development is EXACT: Σ curl bend allowances (via the table-aware {@link developedLength}) + the return length, laid out straight past the edge. Four `type`s set the curl/gap geometry (see {@link HemSpec}). Construction stays on the public, OCCT-WASM-safe API; the result is guarded to a valid single solid.

**Parameters**:
- `part`: the sheet metal part to attach a hem to.
- `spec`: the hem specification.

**Returns**: the updated part with the hem feature recorded, or an error.

#### `jog(part: SheetMetalPart, spec: JogSpec): Promise<Result<SheetMetalPart>>`
Author a jog (joggle): two opposite bends (`+θ` then `−θ`) that step a flat by `offsetHeight` perpendicular to its plane, then continue parallel past the step. Built on the contour-flange chainer: a flat position leg, a `+θ` up bend (`jog::<id>::0`), the connecting step run, a `−θ` down bend (`jog::<id>::1`), and a flat run-out leg. The development is EXACT (Σ legs + Σ bend allowances, via the table-aware {@link developedLength}). The connecting step run is `offsetHeight / sin(θ)` so the two bends realize the requested perpendicular step; the result is guarded to a valid single solid. OCCT-WASM-safe construction only.

**Parameters**:
- `part`: the sheet metal part to attach a jog to.
- `spec`: the jog specification.

**Returns**: the updated part with the jog feature recorded, or an error.

#### `flatPatternToDXF(pattern: FlatPattern, options: DxfOptions): Result<string>`
Package-local DXF writer for sheet-metal flat patterns. The core public writer (`blueprintToDXF`) is R12 LINE/POLYLINE-only with no MTEXT, layer color, or INSUNITS, so it cannot carry the annotated multi-layer output required here. Emits a strict AC1015 (R2000) DXF: `INSUNITS=4` (mm), the outline polyline on layer OUTLINE, each bend line on BEND_UP / BEND_DOWN, and an MTEXT angle/direction annotation (e.g. "∠90° U") at each bend-line midpoint. Every table record and entity carries a unique handle and the AcDb subclass markers R13+ readers (AutoCAD AUDIT, ODA/Teigha) require to parse the file cleanly.

**Parameters**:
- `pattern`: the flat pattern to serialize.
- `options`: writer options (e.g. {@link DxfOptions.textHeight}).

**Returns**: `Result<string>` — the complete DXF file text when `ok`.

#### `multiPatternToDXF(placed: PlacedPattern[], options: DxfOptions): Result<string>`
Emit one DXF for any number of placed patterns (the nesting per-sheet writer). Each pattern's outline / bend lines / holes / forms are run through its own {@link Transform2} (translate + rotate onto the sheet) before being written, so the nested file is fabrication-ready. Layers/colors/handle scheme match the single-pattern writer exactly.

**Parameters**:
- `placed`: the patterns to serialize, each with its sheet-placement transform.
- `options`: writer options (e.g. {@link DxfOptions.textHeight}).

**Returns**: `Result<string>` — the complete DXF file text when `ok`.

#### `patternBbox(pattern: FlatPattern): Result<Bbox>`
Axis-aligned bounding box of a pattern's OUTER outline wire, read from the wire vertices (each edge start point) — the same 2D-coordinate read the DXF/SVG writers use. Only the outer outline is packed; holes ride inside it.

**Parameters**:
- `pattern`: the flat pattern whose outer outline is measured.

**Returns**: `Result<Bbox>` - the axis-aligned bounding box of the outer outline, or an error if the outline is empty or degenerate.

#### `wireToPolygon(outline: Wire): Result<Polygon>`
Ordered vertex loop of a closed outline wire — one vertex per edge start point, the same 2D read the DXF writer (`outlinePoints`) and the bbox nester (`patternBbox`) use. The loop is NOT closed (the last vertex is not repeated); edges are taken as `v[i] → v[(i+1) % n]`.

**Parameters**:
- `outline`: the closed outline wire to read into a vertex loop.

**Returns**: a `Result<Polygon>` — `ok` with the ordered vertex loop, or `err` with a `validationError` when the outline is empty or has fewer than 3 vertices.

#### `flatPatternToPolylines(pattern: FlatPattern): FlatPatternPolylines`
Reduce a {@link FlatPattern} to serializable 2D polylines (outline, holes, bend lines) for a developed-pattern overlay. Best-effort: a wire that fails to read is dropped rather than throwing, so a partial pattern still yields what it can. Arc edges are approximated by endpoints, the same assumption {@link wireToPolygon} and the DXF writer make.

**Parameters**:
- `pattern`: the flat pattern to reduce to 2D polylines.

**Returns**: a {@link FlatPatternPolylines} with the outline, holes, bend lines, form cuts, and form hinges as plain 2D vertex loops.

#### `polygonsOverlap(a: Polygon, b: Polygon): boolean`
Do two simple polygons overlap? True iff any edge of `a` intersects any edge of `b`, or one polygon fully contains a vertex of the other. This pair of conditions is exhaustive for simple polygons: a disjoint pair has no crossing edges and no mutually-contained vertex; a touching-but-non-overlapping pair (shared edge/vertex, zero interior overlap) is caught by `segmentsIntersect` and so is reported as overlapping — callers wanting a clearance gap should inflate via {@link polygonsOverlapWithClearance}. Centroid containment is NOT sufficient on its own (a concave part's centroid can lie outside it), so a representative INTERIOR vertex of each polygon is tested for containment in the other — combined with the edge-crossing test this covers the nested-without-crossing case.

**Parameters**:
- `a`: the first polygon.
- `b`: the second polygon.

**Returns**: `true` when the polygons overlap (including edge touch), `false` when they are disjoint.

#### `polygonsOverlapWithClearance(a: Polygon, b: Polygon, clearance: number): boolean`
Overlap test honoring a clearance gap: the two polygons must stay at least `clearance` apart. Implemented by testing raw overlap and, when disjoint, the minimum edge-to-edge distance against the clearance. `clearance <= 0` is the plain {@link polygonsOverlap}.

**Parameters**:
- `a`: the first polygon.
- `b`: the second polygon.
- `clearance`: the minimum required gap between the polygons.

**Returns**: `true` when the polygons overlap or come closer than `clearance`.

#### `segmentsIntersect(p1: Pt2, p2: Pt2, p3: Pt2, p4: Pt2): boolean`
Proper-or-improper segment intersection (`p1p2` vs `p3p4`). Returns true when the segments cross OR touch (collinear overlap or a shared endpoint), so it is conservative for the overlap test — never a false negative.

**Parameters**:
- `p1`: first endpoint of the first segment.
- `p2`: second endpoint of the first segment.
- `p3`: first endpoint of the second segment.
- `p4`: second endpoint of the second segment.

**Returns**: `true` when the two segments cross or touch, `false` otherwise.

#### `pointInPolygon(poly: Polygon, x: number, y: number): boolean`
Ray-cast point-in-polygon: points strictly inside return true; behaviour for a point exactly on the boundary is undefined (the overlap predicate handles edge contact separately via segment-intersection).

**Parameters**:
- `poly`: the polygon to test against.
- `x`: the point's X coordinate.
- `y`: the point's Y coordinate.

**Returns**: `true` when the point is strictly inside the polygon.

#### `transformPolygon(poly: Polygon, dx: number, dy: number, rotationDeg: number): Polygon`
Rotate every vertex (CCW, degrees, about the origin), then translate by (dx, dy).

**Parameters**:
- `poly`: the polygon to transform.
- `dx`: the translation along X applied after rotation.
- `dy`: the translation along Y applied after rotation.
- `rotationDeg`: the counter-clockwise rotation angle in degrees.

**Returns**: a new `Polygon` with every vertex rotated then translated.

#### `polygonBounds(poly: Polygon): [number, number, number, number]`
Axis-aligned bounds of a polygon.

**Parameters**:
- `poly`: the polygon to bound.

**Returns**: the axis-aligned bounding box as `[minX, minY, maxX, maxY]`.

#### `signedArea(poly: Polygon): number`
Signed area (CCW positive) — used to normalise orientation and reject degenerates.

**Parameters**:
- `poly`: the polygon to measure.

**Returns**: the signed area in square units: positive for counter-clockwise vertex order, negative for clockwise.

#### `buildReport(part: SheetMetalPart): Result<BendReport>`
Build the bend-table JSON report directly from an authored part. Walks the same tree layout the unfold consumes so the per-bend values and the total flat size agree with the flat pattern. `allowance` is the consumed neutral-axis arc length (the bend allowance); `flatLength` is the straight flange leg past the bend — distinct values a downstream nesting/cut-list tool needs separately.

**Parameters**:
- `part`: the authored part to build the report from.

**Returns**: the bend-table report, or an error if the part tree or layout cannot be built.

#### `reportFromUnfold(result: UnfoldResult): Result<BendReport>`
Project the report already computed by `unfold` into the standalone `BendReport` shape, defensively re-validating its numeric fields. This keeps the report a pure function of a previously-unfolded result without re-walking the tree.

**Parameters**:
- `result`: the unfold result whose report is projected.

**Returns**: the standalone `BendReport`, or an error if a numeric field is not finite or positive.

#### `reportToJSON(report: BendReport): string`
Serialize a `BendReport` to a stable, pretty-printed JSON string.

**Parameters**:
- `report`: the bend report to serialize.

**Returns**: the pretty-printed JSON string.

#### `validatePart(part: SheetMetalPart): SheetMetalWarning[]`
Manufacturability checks for an authored sheet-metal part. Returns a list of {@link SheetMetalWarning} — these are advisory, never errors: a part with warnings is still produced and exportable. Three checks per plan §6: - `INVALID_SOLID`: the folded solid is missing, fails kernel validity, or has no positive volume. - `COLLISION`: two flanges' axis-aligned bounding boxes overlap once folded — the cheap interference signal for corners that need a miter or relief cut. - `MIN_RADIUS`: a bend's inner radius is below one material thickness (`R < 1×T`), the standard minimum-bend-radius rule of thumb.

**Parameters**:
- `part`: the sheet metal part to validate.

**Returns**: the list of warnings (empty if valid).

#### `author(spec: AuthorSpec): Promise<Result<SheetMetalPart>>`
Author a straight-bend part: a base flat plus folded-up flanges.

**Parameters**:
- `spec`: the part definition: base flat, material thickness, and the flange list to fold up.

**Returns**: a `Result<SheetMetalPart>` carrying the authored part, or the first error encountered.

#### `unfoldSolid(solid: Solid, opts?: { kFactor?: number }): Result<UnfoldResult>`
Unfold an imported sheet-metal solid that has no feature tree, by detecting its geometry (planar panels + cylindrical bends) numerically. `kFactor` defaults to the mid-surface neutral axis (0.5); supply a known material's K-factor to match its development.

**Parameters**:
- `solid`: the imported solid (B-rep) to unfold.
- `opts`: optional overrides; `opts.kFactor` sets the K-factor used for the bend allowance.

**Returns**: a `Result<UnfoldResult>` with the detected flat pattern, report, and any warnings.

#### `miter(part: SheetMetalPart, plane: MiterPlane): Promise<Result<SheetMetalPart>>`
Cut a part by an oriented plane, removing material on the `+normal` side.

**Parameters**:
- `part`: the sheet-metal part to cut.
- `plane`: the oriented cutting plane; material on the plane's `+normal` side is removed.

**Returns**: a `Result<SheetMetalPart>` carrying the mitered part, or the first error.

#### `miterCorner(part: SheetMetalPart, flangeIdA: string, flangeIdB: string, gap: any): Promise<Result<SheetMetalPart>>`
Auto-miter the shared corner of two flanges with an optional gap.

**Parameters**:
- `part`: the sheet-metal part whose corner is to be mitered.
- `flangeIdA`: id of the first flange meeting at the corner.
- `flangeIdB`: id of the second flange meeting at the corner.
- `gap`: optional gap (in millimetres) left between the two mitered edges; defaults to 0.

**Returns**: a `Result<SheetMetalPart>` carrying the mitered part, or the first error.

#### `bendRelief(part: SheetMetalPart, flangeId: string, spec?: ReliefSpec): Promise<Result<SheetMetalPart>>`
Add a bend relief slot at each mid-edge end of a partial flange's bend line.

**Parameters**:
- `part`: the sheet-metal part to modify.
- `flangeId`: id of the partial flange whose bend-line ends get the relief.
- `spec`: optional relief specification overriding the defaults.

**Returns**: a `Result<SheetMetalPart>` carrying the part with the relief added, or the first error.

#### `autoReliefs(part: SheetMetalPart, spec?: ReliefSpec): Promise<Result<SheetMetalPart>>`
Add a bend relief to every partial-span bend in the part.

**Parameters**:
- `part`: the sheet-metal part to modify.
- `spec`: optional relief specification applied to every partial bend.

**Returns**: a `Result<SheetMetalPart>` carrying the part with all reliefs added, or the first error.

#### `relieveCorner(part: SheetMetalPart, flangeIdA: string, flangeIdB: string, spec?: ReliefSpec): Promise<Result<SheetMetalPart>>`
Cut a corner relief notch at the shared corner of two adjacent flanges.

**Parameters**:
- `part`: the sheet-metal part to modify.
- `flangeIdA`: id of the first flange forming the corner.
- `flangeIdB`: id of the second flange forming the corner.
- `spec`: optional relief specification overriding the defaults.

**Returns**: a `Result<SheetMetalPart>` carrying the part with the corner relief added, or the first error.

#### `toDXF(pattern: FlatPattern, options?: DxfOptions): Result<string>`
Emit an annotated multi-layer DXF string for a flat pattern.

**Parameters**:
- `pattern`: the flat pattern to serialize.
- `options`: optional DXF output options (layers, precision, units).

**Returns**: a `Result<string>` carrying the DXF text, or the first error.

#### `report(part: SheetMetalPart): Result<BendReport>`
Build a bend report by walking the part's feature tree.

**Parameters**:
- `part`: the sheet-metal part to report on.

**Returns**: a `Result<BendReport>` carrying the computed bend report, or the first error.

#### `reportFrom(result: UnfoldResult): Result<BendReport>`
Project the report already computed by {@link unfold} without re-walking the tree.

**Parameters**:
- `result`: the unfold result whose bend report is to be projected.

**Returns**: a `Result<BendReport>` carrying the projected bend report, or the first error.

#### `reportJSON(report: BendReport): string`
Serialize a bend report to stable pretty-printed JSON.

**Parameters**:
- `report`: the bend report to serialize.

**Returns**: the stable pretty-printed JSON string.

#### `validate(part: SheetMetalPart): SheetMetalWarning[]`
Manufacturability checks — advisory warnings, never errors.

**Parameters**:
- `part`: the sheet-metal part to check.

**Returns**: the list of manufacturability warnings (empty when the part is clean).

#### `allowance(angleDeg: number, thickness: number, rule: BendRule, onWarning?: (warning: SheetMetalWarning) => void): Result<number>`
Bend allowance `BA = (π/180)·|angle|·(R + K·T)` for a single bend.

**Parameters**:
- `angleDeg`: the bend angle in degrees.
- `thickness`: the material thickness, in the same units as the rule radii.
- `rule`: the bend rule (K-factor, inner radius, or a bend-table reference) to apply.
- `onWarning`: optional callback invoked for non-fatal warnings during the computation.

**Returns**: a `Result<number>` carrying the bend allowance, or the first error.

#### `developed(angleDeg: number, thickness: number, rule: BendRule, onWarning?: (warning: SheetMetalWarning) => void): Result<number>`
Neutral-axis developed length of a bend region (numerically equal to the allowance).

**Parameters**:
- `angleDeg`: the bend angle in degrees.
- `thickness`: the material thickness, in the same units as the rule radii.
- `rule`: the bend rule (K-factor, inner radius, or a bend-table reference) to apply.
- `onWarning`: optional callback invoked for non-fatal warnings during the computation.

**Returns**: a `Result<number>` carrying the developed length, or the first error.

#### `addBendTable(table: BendTable): Result<BendTable>`
Register (or replace) a shop bend table so rules can reference it by id.

**Parameters**:
- `table`: the bend table to register.

**Returns**: a `Result<BendTable>` carrying the registered table, or the first error.

#### `bendTable(id: string): BendTable | undefined`
Look up a registered bend table by id (starter tables included).

**Parameters**:
- `id`: the bend table id to look up.

**Returns**: the matching `BendTable`, or `undefined` when no such table is registered.

#### `resolveAllowance(rule: BendRule, angleDeg: number, thickness: number, onWarning?: (warning: SheetMetalWarning) => void): Result<number>`
Resolve a bend's developed allowance through the single resolution point: a referenced bend table, then an explicit `rule.allowance`, then the K-factor formula. This is what {@link developed} delegates to.

**Parameters**:
- `rule`: the bend rule (bend-table reference, explicit allowance, or K-factor) to resolve.
- `angleDeg`: the bend angle in degrees.
- `thickness`: the material thickness, in the same units as the rule radii.
- `onWarning`: optional callback invoked for non-fatal warnings during the computation.

**Returns**: a `Result<number>` carrying the resolved allowance, or the first error.

#### `contourFlange(part: SheetMetalPart, spec: ContourFlangeSpec): Promise<Result<SheetMetalPart>>`
Author a contour flange: an open line/arc profile swept along a base edge into a multi-bend cross-section. The development is exact (Σ segment developed lengths).

**Parameters**:
- `part`: the sheet-metal part the flange is added to.
- `spec`: contour flange definition: profile, base edge, and bend parameters.

**Returns**: a `Result<SheetMetalPart>` carrying the part with the contour flange added, or the first error.

#### `loftedFlange(part: SheetMetalPart, spec: LoftedFlangeSpec): Promise<Result<SheetMetalPart>>`
Author a lofted / ruled transition flange between two parallel open profiles. The development is by triangulation — exact for a developable transition, an approximation (with a `DEVELOPMENT_APPROXIMATE` unfold warning) otherwise.

**Parameters**:
- `part`: the sheet-metal part the flange is added to.
- `spec`: lofted flange definition: the two open profiles and their alignment.

**Returns**: a `Result<SheetMetalPart>` carrying the part with the lofted flange added, or the first error.

#### `nest(patterns: FlatPattern[], options: NestOptions): Result<NestResult>`
Nest developed flat patterns onto stock sheets to reduce waste. The default `strategy: "bbox"` packs each part as its outline bounding box (fast, no interlocking). `strategy: "nfp"` is true-shape / no-fit-polygon nesting: the actual outline polygons are packed so concave (L-shaped) parts interlock for higher utilization. The NFP packer is a HEURISTIC (bottom-left-fill) — not provably optimal — but never overlaps parts and never drops a part silently.

**Parameters**:
- `patterns`: the flat patterns to place onto stock sheets.
- `options`: nesting configuration: stock sheet size, strategy, and spacing.

**Returns**: a `Result<NestResult>` carrying the placed sheets and part transforms, or the first error.

#### `nestToDXF(result: NestResult, patterns: FlatPattern[], sheetIndex: number, options?: DxfOptions): Result<string>`
Emit one fabrication-ready DXF for a single nested sheet (all parts placed).

**Parameters**:
- `result`: the nesting result containing the sheet to render.
- `patterns`: the original flat patterns referenced by `result`.
- `sheetIndex`: index of the nested sheet to emit.
- `options`: optional DXF output options (layers, precision, units).

**Returns**: a `Result<string>` carrying the DXF text, or the first error.

#### `solidOf(part: SheetMetalPart): Result<Solid>`
Extract the lone 3D solid of an authored part as its own `Result` terminal. `author`/`fold`/`hem` return the data model `SheetMetalPart`; its `.solid` field is the authored BREP solid. `.fai.js` statements cannot read nested member expressions (`p1.solid`), so this explicit terminal is the sanctioned way to pull the geometry out of a part.

**Parameters**:
- `part`: the sheet-metal part carrying the authored solid.

**Returns**: `Ok` with the part's surface, or `Err` (`NO_SOLID`) when the part has no authored solid yet (e.g. it was only built by `flatPattern`).

#### `sheetMetal(base: BaseFlatSpec, thickness: number): SheetMetalBuilder`
Start a fluent sheet-metal chain from a base flat (`length × width`).

**Parameters**:
- `base`: the base flat definition (length × width).
- `thickness`: the sheet material thickness in millimetres.

**Returns**: a `SheetMetalBuilder` ready for authoring steps like `flange`/`seam`/`material`.

#### `fromPart(part: SheetMetalPart): SheetMetalPartHandle`
Re-enter the fluent chain from an already-authored part.

**Parameters**:
- `part`: an authored sheet-metal part to operate on.

**Returns**: a `SheetMetalPartHandle` wrapping the part.

#### `foldFlat(input: FlatInput): Promise<SheetMetalPartHandle>`
Fold a flat pattern up into a part and re-enter the fluent chain.

**Parameters**:
- `input`: the flat pattern (region tree) to fold up.

**Returns**: a `SheetMetalPartHandle` carrying the folded part.

#### `fromSolid(solid: Solid, opts?: { kFactor?: number }): ForeignSolidHandle`
Detect and unfold an imported foreign sheet-metal solid (no feature tree).

**Parameters**:
- `solid`: the imported solid (B-rep) to unfold.
- `opts`: optional overrides; `opts.kFactor` sets the K-factor used for the bend allowance.

**Returns**: a `ForeignSolidHandle` for detecting and unfolding the solid.

**Notes**:
- Functions from @faicad/sheetmetal return `Promise<Result<T>>`. In `.fai.js` scripts, `err` is unwrapped at the statement boundary.
- `BrepHandle` results are automatically adopted into faijs `Shape` at the library boundary.

---

## @faicad/faijs-gears — Gear Generation Library

Import in `.fai.js`:
```js
import * as lib from '@faicad/faijs-gears'
```

### Other

#### `spurGear(params: SpurGearParams, options: BuildSpurGearOptions): Promise<Result<BrepHandle, string>>`
SpurGear（直齿圆柱齿轮）。

**Parameters**:
- `params`: 齿轮参数（逐字沿用 Python `SpurGear.__init__`）
- `options`: 构建选项（齿面策略 / 特征字段）

**Returns**: `Result<BrepHandle>`——solid 句柄，失败转 `err`

#### `herringboneGear(params: SpurGearParams, options: BuildSpurGearOptions): Promise<Result<BrepHandle, string>>`
HerringboneGear（人字齿圆柱齿轮）。

**Parameters**:
- `params`: 齿轮参数（逐字沿用 Python `HerringboneGear.__init__`）
- `options`: 构建选项（齿面策略 / 特征字段）

**Returns**: `Result<BrepHandle>`——solid 句柄，失败转 `err`

#### `ringGear(params: RingGearParams, options: BuildRingGearOptions): Promise<Result<BrepHandle, string>>`
RingGear（内齿圈）。

**Parameters**:
- `params`: 齿轮参数（逐字沿用 Python `RingGear.__init__`）
- `options`: 构建选项（齿面策略 / 特征字段）

**Returns**: `Result<BrepHandle>`——solid 句柄，失败转 `err`

#### `herringboneRingGear(params: RingGearParams, options: BuildRingGearOptions): Promise<Result<BrepHandle, string>>`
HerringboneRingGear（人字内齿圈）。

**Parameters**:
- `params`: 齿轮参数（逐字沿用 Python `HerringboneRingGear.__init__`）
- `options`: 构建选项（齿面策略 / 特征字段）

**Returns**: `Result<BrepHandle>`——solid 句柄，失败转 `err`

#### `crossedHelicalGear(params: CrossedHelicalGearParams, options: BuildSpurGearOptions): Promise<Result<BrepHandle, string>>`
CrossedHelicalGear（交错轴斜齿轮，单体）。

**Parameters**:
- `params`: 齿轮参数（逐字沿用 Python `CrossedHelicalGear.__init__`）
- `options`: 构建选项（齿面策略 / 特征字段）

**Returns**: `Result<BrepHandle>`——solid 句柄，失败转 `err`

#### `hyperbolicGear(params: HyperbolicGearParams, options: BuildSpurGearOptions): Promise<Result<BrepHandle, string>>`
HyperbolicGear（双曲面齿轮，单体）。

**Parameters**:
- `params`: 齿轮参数（逐字沿用 Python `HyperbolicGear.__init__`）
- `options`: 构建选项（齿面策略 / 特征字段）

**Returns**: `Result<BrepHandle>`——solid 句柄，失败转 `err`

#### `bevelGear(params: BevelGearParams, options: BuildBevelGearOptions): Promise<Result<BrepHandle, string>>`
BevelGear（锥齿轮，单体）。

**Parameters**:
- `params`: 齿轮参数（逐字沿用 Python `BevelGear.__init__`）
- `options`: 构建选项（齿面策略 / bore_d / trim）

**Returns**: `Result<BrepHandle>`——solid 句柄，失败转 `err`

#### `bevelGearPair(params: BevelGearPairParams, options: BuildBevelGearPairOptions): Promise<Result<BevelGearPairOutput, string>>`
BevelGearPair（锥齿轮副，装配体）。

**Parameters**:
- `params`: 齿轮副参数（逐字沿用 Python `BevelGearPair.__init__`）
- `options`: 构建选项（齿面策略 / bore_d / trim）

**Returns**: `Result<BevelGearPairOutput>`——具名记录，失败转 `err`

#### `rackGear(params: RackGearParams, options: BuildRackGearOptions): Promise<Result<BrepHandle, string>>`
RackGear（齿条）。

**Parameters**:
- `params`: 齿条参数（逐字沿用 Python `RackGear.__init__`）
- `options`: 构建选项（齿面策略）

**Returns**: `Result<BrepHandle>`——solid 句柄，失败转 `err`

#### `herringboneRackGear(params: RackGearParams, options: BuildRackGearOptions): Promise<Result<BrepHandle, string>>`
HerringboneRackGear（人字齿条）。

**Parameters**:
- `params`: 齿条参数（逐字沿用 Python `HerringboneRackGear.__init__`）
- `options`: 构建选项（齿面策略；内部强制 `herringbone: true`）

**Returns**: `Result<BrepHandle>`——solid 句柄，失败转 `err`

#### `worm(params: WormParams, options: BuildWormOptions): Promise<Result<BrepHandle, string>>`
Worm（蜗杆）。

**Parameters**:
- `params`: 蜗杆参数（逐字沿用 Python `Worm.__init__`）
- `options`: 构建选项（策略默认 grid-approx / 缝合与组线容差 / boreD）

**Returns**: `Result<BrepHandle>`——solid 句柄，失败转 `err`

#### `crossedGearPair(params: CrossedGearPairParams, options: BuildCrossedGearPairOptions): Promise<Result<CrossedGearPairOutput, string>>`
CrossedGearPair（交错轴斜齿轮副，装配体）。

**Parameters**:
- `params`: 齿轮副参数（逐字沿用 Python `CrossedGearPair.__init__`）
- `options`: 构建选项（齿面策略 / 特征字段）

**Returns**: `Result<CrossedGearPairOutput>`——具名记录，失败转 `err`

#### `hyperbolicGearPair(params: HyperbolicGearPairParams, options: BuildCrossedGearPairOptions): Promise<Result<CrossedGearPairOutput, string>>`
HyperbolicGearPair（双曲面齿轮副，装配体）。

**Parameters**:
- `params`: 齿轮副参数（逐字沿用 Python `HyperbolicGearPair.__init__`）
- `options`: 构建选项（齿面策略 / 特征字段）

**Returns**: `Result<CrossedGearPairOutput>`——具名记录，失败转 `err`

#### `planetaryGearset(params: PlanetaryGearsetParams, options: BuildPlanetaryGearsetOptions): Promise<Result<PlanetaryGearsetOutput, string>>`
PlanetaryGearset（行星轮系，装配体）。

**Parameters**:
- `params`: 轮系参数（逐字沿用 Python `PlanetaryGearset.__init__`）
- `options`: 构建选项（齿面策略 / 特征字段）

**Returns**: `Result<PlanetaryGearsetOutput>`——具名记录，失败转 `err`

#### `herringbonePlanetaryGearset(params: PlanetaryGearsetParams, options: BuildPlanetaryGearsetOptions): Promise<Result<PlanetaryGearsetOutput, string>>`
HerringbonePlanetaryGearset（人字行星轮系，装配体）。

**Parameters**:
- `params`: 轮系参数（逐字沿用 Python `HerringbonePlanetaryGearset.__init__`）
- `options`: 构建选项（齿面策略 / 特征字段）

**Returns**: `Result<PlanetaryGearsetOutput>`——具名记录，失败转 `err`

**Notes**:
- Functions from @faicad/faijs-gears return `Promise<Result<T>>`. In `.fai.js` scripts, `err` is unwrapped at the statement boundary.
- `BrepHandle` results are automatically adopted into faijs `Shape` at the library boundary.

---

## @faicad/faijs-fasteners — Fastener Generation Library

Import in `.fai.js`:
```js
import * as lib from '@faicad/faijs-fasteners'
```

### Other

#### `isolateFastenerType(targetFastener: string, fastenerData: ParamTable): ParamTable`
fastener.py:144 `isolate_fastener_type` — split `type:dim`, filter by type, drop empty cells.

**Parameters**:
- `targetFastener`: 目标紧固件类型（`type:dim` 的 `type` 段）。
- `fastenerData`: 原始参数表（键为 `type:dim`）。

**Returns**: 只含目标类型、且维度名已剥离 `type:` 前缀的参数表（空行被丢弃）。

#### `typesOf(data: ParamTable): string[]`
fastener.py:484 `types()` — the set of `type:dim` prefixes of the table's first row.

**Parameters**:
- `data`: 原始参数表。

**Returns**: 首行出现过的类型前缀（去重，保持出现顺序）；空表返回 `[]`。

#### `sizesOf(fastenerType: string, data: ParamTable): string[]`
fastener.py:489 `sizes()` — sizes that have a non-empty row for the given type.

**Parameters**:
- `fastenerType`: 目标紧固件类型。
- `data`: 原始参数表。

**Returns**: 该类型下存在非空行的尺寸列表。

#### `nutTypes(): string[]`
Nut.types() — 螺母类型列表。

**Returns**: HexNut 表中出现的螺母类型（去重）。

#### `nutSizes(fastenerType: string): string[]`
Nut.sizes(fastener_type) — 指定类型的螺母尺寸列表。

**Parameters**:
- `fastenerType`: 螺母类型。

**Returns**: 该类型下的尺寸列表。

#### `screwTypes(className: ScrewClassName): string[]`
Screw.types() — 指定螺钉类别的类型列表。

**Parameters**:
- `className`: 螺钉类名（`SCREW_TABLES` 的键）。

**Returns**: 该表首行出现的类型（去重）。

#### `screwSizes(className: ScrewClassName, fastenerType: string): string[]`
Screw.sizes(fastener_type) — 指定螺钉类别下的尺寸列表。

**Parameters**:
- `className`: 螺钉类名。
- `fastenerType`: 螺钉类型。

**Returns**: 该类型下的尺寸列表。

#### `bearingTypes(className: BearingClassName): string[]`
Bearing.types() — 指定轴承类别的类型列表。

**Parameters**:
- `className`: 轴承类名（`BEARING_TABLES` 的键）。

**Returns**: 该表首行出现的类型（去重）。

#### `bearingSizes(className: BearingClassName, bearingType: string): string[]`
Bearing.sizes(bearing_type) — 指定轴承类别下的尺寸列表。

**Parameters**:
- `className`: 轴承类名。
- `bearingType`: 轴承类型。

**Returns**: 该类型下的尺寸列表。

#### `washerTypes(className: WasherClassName): string[]`
Washer.types() — 指定垫圈类别的类型列表。

**Parameters**:
- `className`: 垫圈类名（`WASHER_TABLES` 的键）。

**Returns**: 该表首行出现的类型（去重）。

#### `washerSizes(className: WasherClassName, fastenerType: string): string[]`
Washer.sizes(fastener_type) — 指定垫圈类别下的尺寸列表。

**Parameters**:
- `className`: 垫圈类名。
- `fastenerType`: 垫圈类型。

**Returns**: 该类型下的尺寸列表。

#### `clearanceHoleDiameters(size: string): Record<string, number>`
Nut.clearance_hole_diameters — size → {Close/Normal/Loose → mm}。

**Parameters**:
- `size`: 螺纹规格（如 `M3`）。

**Returns**: 各配合等级的间隙孔直径（mm）；无该规格数据时抛错。

#### `tapHoleDiameters(size: string): Record<string, number>`
Nut.tap_hole_diameters — size → {Soft/Hard → mm}。

**Parameters**:
- `size`: 螺纹规格（如 `M3`）。

**Returns**: 软/硬材料的攻丝底孔直径（mm）；无该规格数据时抛错。

#### `selectBySize(size: string): Record<string, string[]>`
fastener.py:346 `select_by_size_fn` — size → {class: [type, …]}。 Python 侧遍历 `__subclasses__`；TS 侧显式枚举（与 §2.7 实测清单一致）。

**Parameters**:
- `size`: 目标规格。

**Returns**: 该规格下 `{类名 → [类型, …]}`；无匹配类时不出现该键。

#### `metricStrToFloat(measure: string): number | string`
thread.py `metric_str_to_float` — metric values eval raw (mm). Non-eval-able cells are returned as-is (mirrors upstream returning the string). The empty string is passed through: upstream never evaluates it because `isolate_fastener_type` (fastener.py:148) drops empty cells first; gen-data evaluates every cell, so '' must be preserved, not fed to the evaluator.

**Parameters**:
- `measure`: 单元格原文（公制，mm）。

**Returns**: 求值后的 mm 数值；不可求值或空串时原样返回字符串。

#### `imperialStrToFloat(measure: string): number | string`
thread.py `imperial_str_to_float` — spaces become `+` (`"1 1/2"` → `1+1/2`), result converted to mm (×25.4). Non-eval-able cells are returned as-is. Empty string passes through (see metricStrToFloat).

**Parameters**:
- `measure`: 单元格原文（英制，含 `1 1/2` 这类分数写法）。

**Returns**: 换算为 mm 的数值；不可求值或空串时原样返回字符串。

#### `evalArithmetic(expr: string): number`
Restricted recursive-descent evaluator: `+ - * / ( )` over number literals.

**Parameters**:
- `expr`: 算术表达式（调用方须先过 {@link isSafe}）。

**Returns**: 求值结果。

#### `evaluateCell(value: string, isMetric: boolean): number | string`
Unified per-cell evaluation used by the parameter tables (fastener.py `evaluate_parameter_dict`): `is_metric` is decided per row by the first character of the row key (`M…` → metric).

**Parameters**:
- `value`: 单元格原文。
- `isMetric`: 该行是否为公制（由行键首字符判定）。

**Returns**: 求值结果；不可求值时原样返回字符串。

#### `buildThread(spec: ThreadSpec): ThreadResult`
Helical thread（`Thread` 基类）。`simple=true` 时只算参数、返回 `handle: null` （对齐上游把 `wrapped` 置空的语义）。

**Parameters**:
- `spec`: `Thread.__init__` 的入参（snake_case，逐字沿用上游）。

**Returns**: 派生尺寸 + 实体句柄（`simple=true` 时 `handle` 为 null）。

#### `isoThreadDimensions(p: Pick<IsoThreadParams, 'major_diameter' | 'pitch' | 'external'>): {
  threadAngle: number
  hParameter: number
  minRadius: number
  apexRadius: number
  apexWidth: number
  rootRadius: number
  rootWidth: number
}`
`IsoThread` 的派生尺寸（对应上游 `thread_angle` / `h_parameter` / `min_radius`）。

**Parameters**:
- `p`: 大径 / 螺距 / 内外螺纹三要素。

**Returns**: 锥角、h 参数、最小半径，以及内外螺纹各自的口顶/齿根半径与宽度。

#### `isoThread(p: IsoThreadParams): ThreadResult`
ISO 60° 螺纹（`IsoThread`）。默认 `end_finishes=("fade","square")`。

**Parameters**:
- `p`: 入参（同 {@link IsoThreadParams}）。

**Returns**: 螺纹实体与派生尺寸。

#### `acmeThreadSizes(): string[]`
`AcmeThread.sizes()`（thread.py:691）。

**Returns**: 全部 ACME 英寸规格（`ACME_PITCH` 的键，按上游插入序）。

#### `acmeThreadParseSize(size: string): [number, number]`
`AcmeThread.parse_size`（thread.py:696）→ (diameter mm, pitch mm)。

**Parameters**:
- `size`: 英寸规格字符串，如 `"1/2"`、`"1 1/4"`。

**Returns**: `[直径 mm, 螺距 mm]`。

#### `acmeThread(p: TrapezoidalParams): ThreadResult`
ACME 29° 梯形螺纹（`AcmeThread`）。默认 `end_finishes=("fade","fade")`。

**Parameters**:
- `p`: 入参（同 {@link TrapezoidalParams}）。

**Returns**: 螺纹实体与派生尺寸。

#### `metricTrapezoidalThreadSizes(): string[]`
`MetricTrapezoidalThread.sizes()`（thread.py:779）。

**Returns**: ISO 2904 公制规格表的副本（调用方改动不影响内部表）。

#### `metricTrapezoidalThreadParseSize(size: string): [number, number]`
`MetricTrapezoidalThread.parse_size`（thread.py:784）→ (diameter mm, pitch mm)。

**Parameters**:
- `size`: 公制规格字符串，形如 `"20x4"`。

**Returns**: `[直径 mm, 螺距 mm]`。

#### `metricTrapezoidalThread(p: TrapezoidalParams): ThreadResult`
ISO 2904 公制 30° 梯形螺纹（`MetricTrapezoidalThread`）。

**Parameters**:
- `p`: 入参（同 {@link TrapezoidalParams}）。

**Returns**: 螺纹实体与派生尺寸。

#### `plasticBottleThreadDimensions(p: PlasticBottleThreadParams): {
  style: string
  diameter: number
  finish: number
  tpi: number
  apexRadius: number
  rootRadius: number
  apexWidth: number
  apexOffset: number
  pitch: number
  length: number
  threadAngles: [number, number]
  rootWidth: number
}`
`PlasticBottleThread` 的派生尺寸（覆盖上游全部属性）。

**Parameters**:
- `p`: 入参（规格串 + 内外螺纹 + 过挤补偿）。

**Returns**: 上游实例的全部派生属性（半径 / 宽度 / 螺距 / 长度 / 两段牙侧角）。

#### `plasticBottleThread(p: PlasticBottleThreadParams): ThreadResult`
ASTM D2911 塑料瓶口螺纹（`PlasticBottleThread`），端部恒为 ("fade","fade")。

**Parameters**:
- `p`: 入参（规格串 + 内外螺纹 + 过挤补偿）。

**Returns**: 螺纹实体与派生尺寸。

#### `buildNut(className: NutClassName, hooks: StandardNutHooks, p: NutParams): NutResult`
`Nut.__init__` + `make_nut`（fastener.py:520 / :581）的共享实现（标准族）。

**Parameters**:
- `className`: 螺母类名（决定参数表与输出标签）。
- `hooks`: 该类的轮廓 / plan / 法兰钩子。
- `p`: 入参（`size` / `fastener_type` / `hand` / `simple`）。

**Returns**: 螺母实体与上游同名派生量。

#### `hexNut(p: NutParams): NutResult`
`HexNut`（fastener.py:1105）——iso4032 / iso4033 / iso4035。

**Parameters**:
- `p`: 入参（`size` 如 `M6-1`；`fastener_type` 如 `iso4032`）。

**Returns**: 螺母实体与派生量。

#### `hexNutWithFlange(p: NutParams): NutResult`
`HexNutWithFlange`（fastener.py:1123）——din1665，带法兰分支。

**Parameters**:
- `p`: 入参（`fastener_type` 固定 `din1665`）。

**Returns**: 螺母实体与派生量。

#### `unchamferedHexagonNut(p: NutParams): NutResult`
`UnchamferedHexagonNut`（fastener.py:1176）——iso4036，无倒角。

**Parameters**:
- `p`: 入参（`fastener_type` 固定 `iso4036`）。

**Returns**: 螺母实体与派生量。

#### `squareNut(p: NutParams): NutResult`
`SquareNut`（fastener.py:1200）——din557，四方。

**Parameters**:
- `p`: 入参（`fastener_type` 固定 `din557`）。

**Returns**: 螺母实体与派生量。

#### `domedCapNut(p: NutParams): NutResult`
`DomedCapNut`（fastener.py:674）——din1587，球顶。

**Parameters**:
- `p`: 入参（`fastener_type` 固定 `din1587`）。

**Returns**: 螺母实体与派生量。

#### `bradTeeNut(p: NutParams): NutResult`
`BradTeeNut.custom_make`（fastener.py:734）—— 大法兰盘 + `brad_num` 个沉头螺钉孔。 上游步骤：`make_nut()` → `faces(">Z").workplane()` → `polarArray(bcd/2, 0, 360, brad_num)` → `clearanceHole(fastener=CounterSunkScrew(brad_size, 2c, "iso10642"))`。 本包把 `clearanceHole` 走 {@link holes.fastenerHoleCutter}（W9·P1-b 正式实现， 原 `recess.ts` 的 W4 临时切割器已删除；沉头轮廓仍用 `tempCounterSunkCountersinkProfile`）。解析验证（`scripts/probe-bradtee-decomposition.py` 出 A 侧中间量；B 侧 STEP 等价由 `src/nut.test.ts` 锁定）： - `make_nut()` = 3585.465923（与前剖面/plan 模型解析值一致）； - 每孔切除 65.4292（截锥 ∪ 杆部 ∪ 钻尖 在法兰板内的并集），3 孔共 196.290； - 终值 = 3389.175287，与 A 侧 manifest 逐位一致。 ⚠️ **不调上游的 `.clean()`**（OCCT `ShapeUpgrade_UnifySameDomain`）——只合同域面、 不改体积；内核无该封装（cq-compat parity 欠账）。见 `src/recess.ts` 文件头。

**Parameters**:
- `p`: 入参（`size` / `fastener_type`=`Hilitchi`）。

**Returns**: 螺母实体与派生量。

#### `heatSetNut(p: NutParams): NutResult`
`HeatSetNut`（fastener.py:791）—— McMaster-Carr / Hilitchi 热熔铜螺母。 ⚠️ **W4 未实现（显式抛错）**。上游 `make_nut`（fastener.py:947）不走向轮廓旋转， 而是 `Face.makeNSidedSurface` 造 knurl 面 + `Shell.makeShell` + `Solid.makeSolid`。 本内核无 `makeNSidedSurface`；probe（`scripts/kernel-nut-probe.ts` 段 4）实测 `makeNonPlanarFace(4 边扭面 wire)` 退化为 **3 边面**（面积 2.749170），几何不等价 ——不构成可接受的替代。详见 W4 分析文档。

**Parameters**:
- `p`: 入参（`size` 形如 `M3-0.5-Standard`）。

**Returns**: 永不返回（抛错）。

#### `polarArrayLocations(radius: number, startAngleDeg: number, endAngleDeg: number, count: number): Array<[number, number]>`
`cq.Workplane.polarArray(radius, startAngle, endAngle, count)`（cadquery `cq.py`）—— **只取位置，不建几何**（本包不需要平台的 `polarArray` parity）。 cq 的角度分布为 `startAngle + (endAngle − startAngle)·i/count`（`i = 0..count−1`）， 即 `endAngle` 是**排他**上界：`(0, 360, 3)` → 0°/120°/240°。

**Parameters**:
- `radius`: 阵列半径（mm）。
- `startAngleDeg`: 起始角（度）。
- `endAngleDeg`: 结束角（度，排他）。
- `count`: 个数。

**Returns**: `[x, y]` 位置列（z=0）。

#### `screwProfilePoints(className: ScrewClassName, p: ScrewParams): Pt[]`
头型轮廓的**顶点序列**（首段起点 + 各段终点，含 `fillet2D` 切点）——对应 A 侧 `head_profile` 的边端点。逐位对照的回归锁通道（见 `src/screw.test.ts`）， 也是 W9·P1-b 复用沉孔轮廓的入口。

**Parameters**:
- `className`: 12 类之一。
- `p`: 入参（只需 `size` / `fastener_type` 等，`length` 不参与轮廓）。

**Returns**: XZ 顶点列（局部 x→半径、y→轴向）；`SetScrew` 无头型时返回 `[]`。

#### `buildScrew(className: ScrewClassName, p: ScrewParams): ScrewResult`
`Screw.__init__`（`fastener.py:176`）的 B 侧复刻：解析 + 装配 + 派生量。

**Parameters**:
- `className`: 12 类之一（决定参数表与钩子集）。
- `p`: 入参。

**Returns**: 螺钉实体与上游同名派生量。

#### `plainWasher(p: WasherParams): WasherResult`
`PlainWasher`（fastener.py:2302）——iso7089 / iso7091 / iso7093 / iso7094。

**Parameters**:
- `p`: 入参（`size` 如 `M6`；`fastener_type` 如 `iso7089`）。

**Returns**: 垫圈实体与派生量。

#### `chamferedWasher(p: WasherParams): WasherResult`
`ChamferedWasher`（fastener.py:2317）——iso7090。

**Parameters**:
- `p`: 入参（`size` 如 `M6`；`fastener_type` 固定 `iso7090`）。

**Returns**: 垫圈实体与派生量。

#### `cheeseHeadWasher(p: WasherParams): WasherResult`
`CheeseHeadWasher`（fastener.py:2343）——iso7092。

**Parameters**:
- `p`: 入参（`size` 如 `M6`；`fastener_type` 固定 `iso7092`）。

**Returns**: 垫圈实体与派生量。

#### `buildBearing(className: BearingClassName, p: BearingParams): BearingResult`
构造一个轴承（5 类统一入口）。

**Parameters**:
- `className`: 轴承类名。
- `p`: 构造入参（size / bearing_type）。

**Returns**: 轴承实体与上游派生量。

#### `buildSprocket(p: SprocketParams): SprocketResult`
构造一个链轮（上游 `Sprocket` 的唯一几何入口）。

**Parameters**:
- `p`: 构造入参。

**Returns**: 链轮实体与上游派生量。

#### `sprocketPitchRadius(numTeeth: number, chainPitch: number): number`
上游 `Sprocket.sprocket_pitch_radius`（sprocket.py:223）： p = √(cp² / (2·(1 − cos(2π/N))))。

**Parameters**:
- `numTeeth`: 齿数 N。
- `chainPitch`: 链条节距 cp（mm）。

**Returns**: 分度圆半径（mm）。

#### `sprocketCircumference(numTeeth: number, chainPitch: number): number`
上游 `Sprocket.sprocket_circumference`（sprocket.py:236）。

**Parameters**:
- `numTeeth`: 齿数 N。
- `chainPitch`: 链条节距 cp（mm）。

**Returns**: 分度圆周长（mm）。

#### `fastenerHoleCutter(p: FastenerHoleCutterParams): BrepHandle`
组装孔切割器实体（沉头 ∪ 杆部 ∪ 钻尖）。

**Parameters**:
- `p`: 切割器参数（countersinkProfile 沉头轮廓、holeRadius 孔径、depth 深、可选 threadDiameter/threadPitch/hand/simple）。

**Returns**: 切割器句柄，调用方平移到孔位后自行 cut。

#### `internalThreadSolid(p: {
  threadDiameter: number
  threadPitch: number
  length: number
  hand?: Hand
}): BrepHandle`
内螺纹体（threadedHole 用）—— 上游 `_fastenerHole` 里它是**切割后 union 回 零件**的（extensions.py:998–1005），**不是**切割器的一部分；置于孔底 `bore_direction * depth`，长 `depth − head_offset`。

**Parameters**:
- `p`: 螺纹参数：threadDiameter 公称径、threadPitch 螺距、length 长、可选 hand 旋向。

**Returns**: 内螺纹实体句柄（BrepHandle）。

#### `clearanceHole(p: ClearanceHoleParams): BrepHandle`
clearanceHole —— 间隙孔（`extensions.py:1080` 起的 `_clearanceHole`）。 HeatSetNut 不可用（上游同样拒绝，提示改用 insertHole）。

**Parameters**:
- `p`: 间隙孔参数（part 目标件、size 螺纹规格、locations 孔位、可选 fit/depth/countersinkProfile/counterSunk/threadDiameter）。

**Returns**: 打孔后的零件实体。

#### `tapHole(p: TapHoleParams): BrepHandle`
tapHole —— 攻丝底孔（直孔，无螺纹；上游 `_tapHole` → `_fastenerHole(hand=None)`）。

**Parameters**:
- `p`: 攻丝孔参数（part、size、locations、可选 material/fit/depth/countersinkProfile/counterSunk）。

**Returns**: 打孔后的零件实体。

#### `threadedHole(p: ThreadedHoleParams): BrepHandle`
threadedHole —— 螺纹孔：间隙孔切割后再与内螺纹 IsoThread 求并（上游 `_threadedHole` → `_fastenerHole(hand≠None)`，`simple=False` 才有螺纹体）。

**Parameters**:
- `p`: 螺纹孔参数（part、size、locations、pitch、可选 hand/simple/fit/depth/countersinkProfile/counterSunk）。

**Returns**: 打孔并含内螺纹的零件实体。

#### `insertHole(p: InsertHoleParams): BrepHandle`
insertHole —— HeatSetNut 专用直孔（上游拒绝其它紧固件类型）。 注：W4 起 `HeatSetNut` 本体因内核缺 `makeNSidedSurface` 显式抛错；本函数 只依赖间隙孔径表，可用。

**Parameters**:
- `p`: 直孔参数（part、size、locations、可选 fit/depth）。

**Returns**: 打孔后的零件实体。

#### `pressFitHole(p: PressFitHoleParams): BrepHandle`
pressFitHole —— 轴承压入孔（上游拒绝非 Bearing；外圈间隙孔径表）。 Bearing 的孔径表在 bearing 参数行（`clearance_hole_diameters`），此处按 size 查。

**Parameters**:
- `p`: 压入孔参数（part、size、locations、可选 fit/depth）。

**Returns**: 打孔后的零件实体。

#### `fastenerHole(p: FastenerHoleParams): BrepHandle`
fastenerHole —— 通用入口（语义对齐 `_fastenerHole` 本体）：调用方直接给 孔径/沉头/螺纹参数，不必经过各具名封装；逐孔位切割。

**Parameters**:
- `p`: 通用孔参数（FastenerHoleCutterParams + part + locations）。

**Returns**: 打孔后的零件实体。

#### `pushFastenerLocations(locations: HoleLocation[]): HoleLocation[]`
pushFastenerLocations —— 记录孔位（上游为 Assembly 收集紧固件用； 函数式形态下直接返回入参孔位副本，供调用方装配用）。

**Parameters**:
- `locations`: 孔位列表。

**Returns**: 孔位副本（HoleLocation[]）。

#### `buildChain(p: ChainParams): ChainResult`
构建滚子链（上游 `Chain` 构造函数全流程的函数式形态）。

**Parameters**:
- `p`: 链参数（逐字沿用 Python，mm）。

**Returns**: 逐件装配与派生量。

#### `makeLink(p: {
  chainPitch: number
  linkPlateThickness: number
  inner: boolean
  rollerLength: number
  rollerDiameter: number
}): BrepHandle`
单节链（chain.py `make_link` 的函数式移植）。

**Parameters**:
- `p`: 链节参数：chainPitch 节距、linkPlateThickness 板厚、inner 内/外节、rollerLength 滚子长、rollerDiameter 滚子径。

**Returns**: 链节实体，中心在两滚子连线中点、x 轴沿链方向。

#### `placeSprocket(solid: BrepHandle, rotationDeg: number, loc: [number, number]): BrepHandle`
供链轮初始转角旋转（`assemble_chain_transmission` 的 B 侧等价）。

**Parameters**:
- `solid`: 待旋转的链轮实体。
- `rotationDeg`: 绕 +Z 旋转角度（度）。
- `loc`: 链轮平面位置 [x, y]。

**Returns**: 旋转并平移后的链轮实体。

**Notes**:
- Functions from @faicad/faijs-fasteners return `Promise<Result<T>>`. In `.fai.js` scripts, `err` is unwrapped at the statement boundary.
- `BrepHandle` results are automatically adopted into faijs `Shape` at the library boundary.
