/**
 * api-namespace — 把 L3 API 面（api/ 层的 fp操作）装配为 cad 命名空间（统一 ABI，B2 消灭）
 *
 *
 * 库函数签名 = .fai.js 源码形态（无隐式参数）；本文件无任何 per-函数逻辑。
 *
 * 归属（monorepo P5/E-a-1）：本文件随 core 出包，是 faijs 默认库函数
 * （cad 命名空间）的装配点。K5（引擎零函数知识）的准确含义是：parser / compile /
 * runtime 不按函数名分支、不区分函数类别，函数信息统一以 defineOp 元数据（均匀数据）
 * 承载。把 cad 这套库数据内置进引擎，与第三方库走完全相同的 registerLib 路径，
 * 引擎并未对 cad 特判，因此不构成 K5 违反。cad 在 core 的 createRuntime 包装中
 * 被注册为 default 命名空间（见 cad-runtime/createRuntimeWithCad.ts）。
 *
 * D1（2026-09-23 扩展库拆分）：本命名空间只装配**平台面**。编辑器专属 op
 * （`fai_*` / `group` / `assembly` / `copy` / `load`）与两个非基础 three 链的创建 op
 * （`text` / `svgExtrude`）已迁到 `@faicad/faijs-extra`，由宿主经
 * `mergeEditorNamespace()` 合并后注册——键名与拆分前完全一致，存量 `.fai.js` 零迁移。
 * 四个 transform op（translate/rotate_euler/scale/scale3d）按 D1 选项 C 留在此处：
 * `translate` 是通用几何变换，且是小程序端唯一在用的 transform op。
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
import { punchHole } from './punch-hole'
import { wire } from './wire'
import { helix } from './helix'
import { surface } from './surface'
import { offset2d } from './offset2d'
import { solidFromFaces } from './solid-from-faces'
import { halfSpace } from './half-space'
import { exportStl } from './export-stl'
import { exportBrep } from './export-brep'
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
import { union, subtract, intersect, cut } from './boolean'
import { split } from './split'
import { sweep } from './sweep'
import { loft } from './loft'
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

/**
 * Assemble api functions into the cad namespace.
 *
 * P23（§4.2 ②，B1 三源一致）：cad 面 = faijs 特有 dual op（下方字面量）+
 * 生成脚本面 op（`scriptFaceOps`——`api/generated/script-face.ts` 按 arg-spec
 * 的 `scriptFace: true` 条目生成，`defineOp({ brep: __own_* })` 直连的
 * brep-only 语句级 op）。`check()` 符号表（`gen-symbol-table.ts`）与
 * `api/index.ts` 导出面同源于同一份清单。
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
    screw, profile, sketchOnPlane, sketchOnFace, punchHole, wire, helix, sdf,
    // D1 选项 C：四个 transform op 全留核心（translate 小程序端在用，同族不拆散）。
    translate, rotate_euler, scale, scale3d,
    engrave, chamfer, fillet, knurl,
    // Phase 5：按面/边选的特征族 + 修复薄包装（shell/draft 中立；thicken 平台 occt）。
    shell, draft, thicken, filletVariable, splitByPlane, sectionByPlane,
    defeature, reverseShape, unifySameDomain, sew, sewAndSolidify, removeHolesFromFace,
    union, subtract, intersect,
    extrude, revolve,
    // Phase 4：手写扫掠 / 放样（平台 op engines:['occt']；截面接受 face → 取外环）。
    // arg-spec 里 sweep 保留 brep-op（引擎记录）/ loft 为 skip，两者均不投脚本面，
    // 所以这里不是 override 而是唯一实现（同 extrude / revolve 口径）。
    sweep, loft,
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
    ...scriptFaceOps,
    // Phase 3: override generated cut (compatOp, no roleTable propagation) with
    // handwritten cut from boolean.ts (does roleTable propagation via booleanBrep).
    cut,
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
  } as unknown as LibNamespace
}
