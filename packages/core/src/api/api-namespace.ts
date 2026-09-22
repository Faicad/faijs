/**
 * api-namespace — 把 L3 API 面（api/ 层的 fp操作）装配为 cad 命名空间（统一 ABI，B2 消灭）
 *
 *
 * 库函数签名 = .fai.js 源码形态（无隐式参数）；本文件无任何 per-函数逻辑。
 *
 * 归属（monorepo P5/E-a-1）：本文件随 stdlib 出包，是 faijs 默认标准库
 * （cad 命名空间）的装配点。K5（引擎零函数知识）的准确含义是：parser / compile /
 * runtime 不按函数名分支、不区分函数类别，函数信息统一以 defineOp 元数据（均匀数据）
 * 承载。把 cad 这套库数据内置进引擎，与第三方库走完全相同的 registerLib 路径，
 * 引擎并未对 cad 特判，因此不构成 K5 违反。cad 在 core 的 createRuntime 包装中
 * 被注册为 default 命名空间（见 cad-runtime/createRuntimeWithCad.ts）。
 */

import { box, sphere, cylinder, cone, wedge } from './primitives'
// `../3d_editor` 消费面（**不是废弃项**，措辞于 2026-09-22 校正）：transform 家族
// （translate/rotate_euler/scale/scale3d）为编辑器应用提供（拖拽与时间线语句），
// 不属 faijs 平台面；**变更其 API 形态必须同步更新 `../3d_editor`**。见各 op 的 @deprecated。
import { translate, rotate_euler, scale, scale3d } from './transform'
// `../3d_editor` 消费面（**不是废弃项**）：`fai_` 前缀 op 为编辑器应用提供；
// **变更其 API 形态必须同步更新 `../3d_editor`**。见各 op 的 @deprecated。
import { fai_extrude } from './fai_extrude'
// cad.extrude 是平台手写 op（承载 upTo；长度形态委托 generated/operations 的投影），
// 见 api/extrude.ts 的分层说明——up-to 不落在 fai_extrude。
import { extrude } from './extrude'
import { knurl } from './knurl'
import { sdf } from './sdf'
import { text } from './text'
import { screw } from './screw'
import { svgExtrude } from './svgExtrude'
import { sketch } from './sketch'
import { load } from './load'
import { fai_drill } from './fai_drill'
import { fai_split } from './fai_split'
import { union, subtract, intersect, cut } from './boolean'
import { split } from './split'
import { linearPattern } from './pattern'
import { engrave } from './engrave'
import { chamfer } from './chamfer'
import { fillet } from './fillet'
import { group, assembly } from './compound'
import { copy } from './copy'
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
import { revolve } from './generated/operations'
import { CONTRACT_VERSION } from '../runtime-state'
import type { StdlibNamespace } from '../runtime-state'

/**
 * Assemble stdlib functions into the cad namespace.
 *
 * P23（§4.2 ②，B1 三源一致）：cad 面 = faijs 特有 dual op（下方字面量）+
 * 生成脚本面 op（`scriptFaceOps`——`api/generated/script-face.ts` 按 arg-spec
 * 的 `scriptFace: true` 条目生成，经 `compatOp(projectBrepOp(…))` 包装的
 * brep-only 语句级 op）。`check()` 符号表（`gen-symbol-table.ts`）与
 * `api/index.ts` 导出面同源于同一份清单。
 *
 * @returns the assembled StdlibNamespace ready for runtime injection.
 */
export function createApiNamespace(): StdlibNamespace {
  // D-4 strict assembly check: the cad namespace now exports dual-op functions
  // (defineOp), so registerLib requires a matching contractVersion. Cast is
  // needed because StdlibNamespace is an index-signature type.
  return {
    contractVersion: CONTRACT_VERSION,
    box, sphere, cylinder, cone, wedge,
    text, screw, svgExtrude, sketch, sdf, load,
    // translate/rotate_euler/scale/scale3d（本行）与 fai_drill / fai_extrude（下方）、
    // fai_split / group / assembly / copy（末行）均为 `../3d_editor` 消费面（**不是废弃项**，
    // 措辞于 2026-09-22 校正）：为编辑器应用提供，不属 faijs 平台面；
    // **变更其 API 形态必须同步更新 `../3d_editor`**。
    translate, rotate_euler, scale, scale3d,
    fai_drill, fai_extrude, engrave, chamfer, fillet, knurl,
    union, subtract, intersect,
    extrude, revolve,
    fai_split, group, assembly, copy,
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
  } as unknown as StdlibNamespace
}
