/**
 * api-namespace — the complete cad namespace (platform + sketch + extra).
 *
 * Assembles the full `cad` namespace: platform ops + sketch op + editor ops.
 * This namespace is registered by `createRuntime` as the `cad` default library;
 * `cad` is a reserved binding name — hosts cannot override it.
 *
 * 2026-10-13 merge: sketch and faijs-extra were absorbed into core. Their ops
 * are now listed explicitly in the return literal below (not merged by the
 * host). The `cad` binding is reserved (see runtime.ts reserved-binding guard).
 *
 * K5 (引擎零函数知识) compliance: parser/compile/runtime does not branch on
 * function names — all op metadata is carried by defineOp (uniform data).
 * Builtin cad data going through registerLib with the same path as third-party
 * libs does not violate K5.
 *
 * IMPORTANT: gen-symbol-table.ts only discovers ShorthandPropertyAssignment
 * and PropertyAssignment in this literal — it does NOT discover SpreadAssignment.
 * Never use `...spread` for ops that must appear in the symbol table.
 */

import { box, sphere, cylinder, cone, wedge } from './primitives'
import { translate, rotate_euler, scale, scale3d } from './transform'
// cad.extrude 是平台手写 op（承载 upTo；长度形态委托 generated/operations 的投影），
// 见 api/extrude.ts 的分层说明——up-to 不落在 fai_extrude（后者已随扩展库迁出）。
import { extrude } from './extrude'
import { knurl } from './knurl'
import { sdf } from './sdf'
import { screw } from './screw'
import { profile } from './profile'
import { sketchOnPlane } from './sketch-on-plane'
import { sketchOnFace } from './sketch-on-face'
import { sketchOnSurface } from './sketch-on-surface'
import { punchHole } from './punch-hole'
import { wire } from './wire'
import { helix } from './helix'
import { surface } from './surface'
import { offset2d } from './offset2d'
import { solidFromFaces } from './solid-from-faces'
import { halfSpace } from './half-space'
import { exportStl } from './export-stl'
import { exportBrep } from './export-brep'
// 2026-10-08（方案 §2.6 / DEC-3）：脚本面 step / 3mf 出口。两者都是薄壳：宿主门
// （引擎通道无门禁——库面按当前引擎分派，见 export-step.ts）之后把入参转成 ExportEntry[]，
// 序列化一律交库面 exportModelSync（单一真源），故与库面逐字节同源。只进脚本面
// （本字面量 + check() 符号表），**不平铺 api/index.ts**（§2.7 / DEC-6）。
import { exportStep } from './export-step'
import { export3mf } from './export-3mf'
// S4（occt-wasm op 接入）：类型判定谓词族（平台 op engines:['occt']，普通函数形态）。
// 直调 occt 原生 isEdge/isFace/isShell/isVertex/isWire/isCompound/isCompSolid/isEqual
// （不在 L1 契约，方案 §3.4.6 校正注）；布尔返回，走 export-brep 同口径。
import {
  isEdge, isFace, isShell, isVertex, isWire, isCompound, isCompSolid, isEqual,
} from './shape-type'
// S4（occt-wasm op 接入）：视图与导出族（平台 op engines:['occt']，普通函数形态）。
// 直调 occt 原生 toSVG/toMultiviewSVG/toPNG/toMultiviewPNG（不在 L1 契约，方案 §3.4.7 校正注）；
// 字符串/Uint8Array 返回，走 export-brep / shape-type 同口径。
import { toSVG, toMultiviewSVG, toPNG, toMultiviewPNG } from './view-export'
// S4（occt-wasm op 接入）：曲线与草图构造族（平台 op engines:['occt']，方案 §3.4.1）。
// 直调 occt 原生 makeEdge/makeCircleArc/makeEllipseEdge/makeEllipseArc/makeTangentArc/
// approximatePoints/interpolatePointsWithTangents/curveDegreeElevate/curveKnotInsert/
// curveKnotRemove/curveIsPeriodic（不在 L1 契约）；curveIsPeriodic 布尔返回，普通函数。
import {
  edge, circleArc, ellipseEdge, ellipseArc, tangentArc,
  approximatePoints, interpolateWithTangents,
  curveDegreeElevate, curveKnotInsert, curveKnotRemove, curveIsPeriodic,
} from './curve-sketch'
// S4（occt-wasm op 接入）：曲面与面构造族（平台 op engines:['occt']，方案 §3.4.2）。
// 直调 occt 原生 makeFaceOnSurface/makeNonPlanarFace/makeSolid/reverseSurfaceU/outerWire
// （不在 L1 契约；bsplineSurface 已由 S3 的 surface op 覆盖）。
import { faceOnSurface, nonPlanarFace, makeSolid, reverseSurfaceU, outerWire } from './surface-face'
// S4（occt-wasm op 接入）：实体与偏置族剩余（平台 op engines:['occt']，方案 §3.4.4）。
// 直调 occt 原生 draftPrism/pipe（不在 L1 契约；offsetWire2D/buildSolidFromFaces/
// halfSpace 已由 S3 落地）。
import { draftPrism, pipe } from './solid-offset'
// S4（occt-wasm op 接入）：测量与查询族（平台 op engines:['occt']，方案 §3.4.6）。
// 13 个原生方法不在 L1 契约：containsPoint/distanceBetween/getInertia/
// getLinearCenterOfMass/projectPointOnEdge/projectPointOnFace/classifyPointOnFace/
// uvFromPoint/vertexPosition/subShapeCount/iterShapes 返回非 Shape，
// 走 export-brep / shape-type 同口径的普通函数；liftCurve2d / commonCells
// 返回 Shape，走 defineOp。
import {
  containsPoint, distanceBetween, inertia, linearCenterOfMass,
  projectPointOnEdge, projectPointOnFace, classifyPointOnFace,
  uvFromPoint, vertexPosition, subShapeCount, iterShapes,
  liftCurve2d, commonCells,
} from './measure-query'
// S4（occt-wasm op 接入）：通用布尔族（平台 op engines:['occt']，方案 §3.4.5）——
// 原生 booleanOp：带 glue/fuzzy/simplify 选项的通用形态，不在 L1 契约。
import { boolean as booleanWithOptions } from './boolean-op'
// S4（occt-wasm op 接入）：包围盒对齐族（平台 op engines:['occt']，方案 §3.4.9）——
// 原生 alignX/alignY/alignZ 三轴并为一个脚本符号 alignTo。
import { alignTo } from './align'
import { union, subtract, intersect, cut, fuse } from './boolean'
import { split } from './split'
import { sweep } from './sweep'
import { sweepAdvanced } from './sweep-advanced'
import { loft } from './loft'
import { loftAdvanced } from './loft-advanced'
import { linearPattern } from './pattern'
import { circularPattern, gridPattern, rectangularPattern, mirrorJoin, mirror, clone } from './replicate'
import { engrave } from './engrave'
import { chamfer } from './chamfer'
import { fillet } from './fillet'
import { shell } from './shell'
import { draft } from './draft'
import { thicken } from './thicken'
import { defeature, reverseShape, unifySameDomain, sew, sewAndSolidify, removeHolesFromFace } from './feature-repair'
import { filletVariable } from './fillet-variable'
import { splitByPlane } from './split-by-plane'
import { sectionByPlane } from './section-by-plane'
import { faceNormal, bboxCenter, bboxMin, bboxMax } from './geom'
import { edgeRef } from './edge-ref'
import { faceRef } from './face-ref'
import { jointTrajectory, inverseKinematics, mechanismDOF } from './assembly'
import { asset } from './asset'
import { import_brep } from './import-brep'
import { import_step } from './import-step'
import { compound as geometricCompound } from './compound-geom'
import { place } from './place'
import { scriptFaceOps } from './generated/script-face'
import { revolve } from './revolve'
import { CONTRACT_VERSION } from '../runtime-state'
import type { LibNamespace } from '../runtime-state'
// Merged sketch + extra ops (2026-10-13): sketch and faijs-extra were absorbed
// into core. These ops are now part of the cad namespace directly, not
// assembled by the host. Do NOT use spread — list each op explicitly so
// gen-symbol-table can discover them (it ignores SpreadAssignment).
import { sketch } from '../sketch/op'
import { fai_drill } from '../extra/ops/fai_drill'
import { fai_extrude } from '../extra/ops/fai_extrude'
import { fai_split } from '../extra/ops/fai_split'
import { group, assembly } from '../extra/ops/compound'
import { copy } from '../extra/ops/copy'
import { load } from '../extra/ops/load'
import { text } from '../extra/ops/text'
import { svgExtrude } from '../extra/ops/svg-extrude'
import { useMeshChain } from './use-mesh-chain'

/**
 * Assemble api functions into the cad namespace.
 *
 * P23（§4.2 ②，B1）：cad 面 = faijs 特有 dual op（下方字面量）+
 * 生成脚本面 op（`scriptFaceOps`——`api/generated/script-face.ts` 按 arg-spec
 * 的 `scriptFace: true` 条目生成，`defineOp({ brep: __own_* })` 直连的
 * brep-only 语句级 op）。`check()` 符号表（`gen-symbol-table.ts`）取自同一份清单。
 * 2026-10-08（§2.7 / DEC-6、DEC-7）：本命名空间**不再**要求被 `api/index.ts`
 * 平铺——库面只保留有库作者消费者的名字，其余脚本 op 只走 `cad.*` 与子路径。
 *
 * @returns the assembled LibNamespace ready for runtime injection.
 */
export function createApiNamespace(): LibNamespace {
  // D-4 strict assembly check: the cad namespace now exports dual-op functions
  // (defineOp), so registerLib requires a matching contractVersion. Cast is
  // needed because LibNamespace is an index-signature type.
  return {
    contractVersion: CONTRACT_VERSION,
    box, sphere, cylinder, cone, wedge,
    screw, profile, sketchOnPlane, sketchOnFace, sketchOnSurface, punchHole, wire, helix, sdf,
    // D1 选项 C：四个 transform op 全留核心（translate 小程序端在用，同族不拆散）。
    translate, rotate_euler, scale, scale3d,
    engrave, chamfer, fillet, knurl,
    // Phase 5：按面/边选的特征族 + 修复薄包装（shell/draft 中立；thicken 平台 occt）。
    shell, draft, thicken, filletVariable, splitByPlane, sectionByPlane,
    defeature, reverseShape, unifySameDomain, sew, sewAndSolidify, removeHolesFromFace,
    union, subtract, intersect,
    extrude, revolve,
    // Phase 4：手写扫掠 / 放样。**基础 op 两内核都支持**（进 L1 中立名
    // BrepEngineApi#sweep / #loft）；只有 occt 能做的完整控制面拆成独立平台 op
    // （engines:['occt']）：sweepAdvanced（transition/auxSpine/support/law/…）、
    // loftAdvanced（startPoint/tolerance）。
    // arg-spec 里 sweep 保留 brep-op（引擎记录）/ loft 为 skip，两者均不投脚本面，
    // 所以这里不是 override 而是唯一实现（同 extrude / revolve 口径）。
    sweep, sweepAdvanced, loft, loftAdvanced,
    // S3（occt-wasm op 接入）：控制点阵 → B 样条面（平台 op engines:['occt']）。
    surface,
    // S3（occt-wasm op 接入）：2D 轮廓偏置（平台 op engines:['occt']，原生 offsetWire2D）。
    offset2d,
    // S3（occt-wasm op 接入）：面集一次成型为实体（平台 op engines:['occt']，原生 buildSolidFromFaces）。
    solidFromFaces,
    // S3（occt-wasm op 接入）：无限半空间实体（平台 op engines:['occt']，原生 halfSpace；
    // 无界布尔工具的来源，产物 mesh 为空——单独渲染无意义，只作 cut/common/split 的工具位）。
    halfSpace,
    // S3（occt-wasm op 接入）：导出族。exportStl 中立（只序列化 Shape 自带三角载荷，
    // 无内核调用）；exportBrep 平台（原生 toBREP，L1 只有 fromBREP 导入侧）。
    exportStl,
    exportBrep,
    // 方案 §2.6：step（occt 必需——装配层级走 XCAF）/ 3mf（引擎中立，纯 XML + ZIP）。
    exportStep,
    export3mf,
    // S4（occt-wasm op 接入）：类型判定谓词族（平台 op engines:['occt']，布尔返回）。
    isEdge, isFace, isShell, isVertex, isWire, isCompound, isCompSolid, isEqual,
    // S4（occt-wasm op 接入）：视图与导出族（平台 op engines:['occt']，字符串/Uint8Array 返回）。
    toSVG, toMultiviewSVG, toPNG, toMultiviewPNG,
    // S4（occt-wasm op 接入）：曲线与草图构造族（平台 op engines:['occt']，方案 §3.4.1）。
    edge, circleArc, ellipseEdge, ellipseArc, tangentArc,
    approximatePoints, interpolateWithTangents,
    curveDegreeElevate, curveKnotInsert, curveKnotRemove, curveIsPeriodic,
    // S4（occt-wasm op 接入）：曲面与面构造族（平台 op engines:['occt']，方案 §3.4.2）。
    faceOnSurface, nonPlanarFace, makeSolid, reverseSurfaceU, outerWire,
    // S4（occt-wasm op 接入）：实体与偏置族剩余（平台 op engines:['occt']，方案 §3.4.4）。
    draftPrism, pipe,
    // S4（occt-wasm op 接入）：测量与查询族（平台 op engines:['occt']，方案 §3.4.6）。
    containsPoint, distanceBetween, inertia, linearCenterOfMass,
    projectPointOnEdge, projectPointOnFace, classifyPointOnFace,
    uvFromPoint, vertexPosition, subShapeCount, iterShapes,
    liftCurve2d, commonCells,
    // S4（occt-wasm op 接入）：通用布尔族 booleanOp（方案 §3.4.5）+ 包围盒对齐族
    // alignX/Y/Z → alignTo（方案 §3.4.9），平台 op engines:['occt']。
    boolean: booleanWithOptions,
    alignTo,
    faceNormal, bboxCenter, bboxMin, bboxMax,
    edgeRef,
    faceRef,
    jointTrajectory, inverseKinematics, mechanismDOF,
    asset,
    // 平台几何 op（H11，方案 §4）：FCStd 迁移自此不再借用编辑器 op
    // （group/translate/rotate_euler）；这几个与 ../3d_editor 无关系。
    import_brep,
    import_step,
    compound: geometricCompound,
    place,
    // Merged sketch + extra ops (2026-10-13): these 10 ops were previously
    // assembled by the host via merge*Namespace + register*Symbols.
    // They are now part of the built-in cad namespace directly.
    sketch,
    fai_drill,
    fai_extrude,
    fai_split,
    group,
    assembly,
    copy,
    load,
    text,
    svgExtrude,
    ...scriptFaceOps,
    // 兼容别名（brepjs 名字）：与手写实现同一函数对象，不是第二份实现。
    //   cut  = subtract（曾以手写 override 覆盖生成的 compatOp；2026-10-22 改为别名）
    //   fuse = union   （曾是 generated/topology.ts 的二元裸 kernel.fuse；arg-spec 已转 skip）
    // spread 在 scriptFaceOps 之后，确保这两个名字指向手写实现。
    cut,
    fuse,
    // Phase 3: override generated split / linearPattern (compatOp, no roleTable
    // propagation) with handwritten versions that build replica[k] / splinter(#j)
    // role tables (L3 / L4 抗重放词汇). Spread after scriptFaceOps so they win.
    split,
    linearPattern,
    // 覆盖生成版：4 个多副本 pattern 提拔手写（keep + replica[*] 角色表）；
    // 2 个单副本（mirror/clone）加 keep 薄 override。transformCopy 不再是脚本面
    // op（arg-spec skip：ComposedTransform 在 .fai.js 不可构造），仅保留 TS 库导出。
    // Spread after scriptFaceOps so they win.
    circularPattern,
    gridPattern,
    rectangularPattern,
    mirrorJoin,
    mirror,
    clone,
    // 脚本级执行链偏好（2026-10-22）：普通库函数，非 defineOp——无几何输入/产物，
    // 语句值 undefined。gen-symbol-table 按本清单收录（lang/symbol-table 注释）。
    useMeshChain,
  } as unknown as LibNamespace
}
