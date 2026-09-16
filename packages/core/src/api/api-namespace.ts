/**
 * api-namespace — 把 L3 API 面（api/ 层的 fp操作）装配为 cad 命名空间（统一 ABI，B2 消灭）
 *
 *
 * 库函数签名 = .fai.js 源码形态（无隐式参数）；本文件无任何 per-函数逻辑。
 *
 * 归属（monorepo P5/E-a-1）：本文件随 stdlib 出包。core 不再 import 本文件
 * （引擎零函数知识，K5）；cad 注入由根门面在 createRuntime 包装中完成。
 */

import { box, sphere, cylinder, cone, wedge } from './primitives'
import { translate, rotate_euler, scale, scale3d } from './transform'
import { fai_extrude } from './fai_extrude'
import { knurl } from './knurl'
import { sdf } from './sdf'
import { text } from './text'
import { screw } from './screw'
import { svgExtrude } from './svgExtrude'
import { sketch } from './sketch'
import { load } from './load'
import { fai_drill } from './fai_drill'
import { fai_split } from './fai_split'
import { union, subtract, intersect } from './boolean'
import { engrave } from './engrave'
import { chamfer } from './chamfer'
import { fillet } from './fillet'
import { group, assembly } from './compound'
import { copy } from './copy'
import { faceNormal, bboxCenter, bboxMin, bboxMax } from './geom'
import { jointTrajectory, inverseKinematics, mechanismDOF } from './assembly'
import { asset } from './asset'
import { scriptFaceOps } from './generated/script-face'
import { extrude, revolve } from './generated/operations'
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
    translate, rotate_euler, scale, scale3d,
    fai_drill, fai_extrude, engrave, chamfer, fillet, knurl,
    union, subtract, intersect,
    extrude, revolve,
    fai_split, group, assembly, copy,
    faceNormal, bboxCenter, bboxMin, bboxMax,
    jointTrajectory, inverseKinematics, mechanismDOF,
    asset,
    ...scriptFaceOps,
  } as unknown as StdlibNamespace
}
