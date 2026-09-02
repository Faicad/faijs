/**
 * api-namespace — 把 L3 API 面（api/ 层的 fp操作）装配为 cad 命名空间（统一 ABI，B2 消灭）
 *
 * 设计文档：docs/plans/2026-08-27-faijs-language-normalization-design.md §4.5-3
 * 实施文档：docs/plans/2026-08-27-faijs-language-normalization-implementation.md §5.2
 *
 * 库函数签名 = .fai.js 源码形态（无隐式参数）；本文件无任何 per-函数逻辑。
 *
 * 归属（monorepo P5/E-a-1）：本文件随 stdlib 出包。core 不再 import 本文件
 * （引擎零函数知识，K5）；cad 注入由根门面在 createRuntime 包装中完成。
 */

import { box, sphere, cylinder, cone, wedge } from './primitives'
import { translate, rotate, scale } from './transform'
import { fai_extrude } from './fai_extrude'
import { knurl } from './knurl'
import { sdf } from './sdf'
import { text } from './text'
import { screw } from './screw'
import { svgExtrude } from './svgExtrude'
import { load } from './load'
import { fai_drill } from './fai_drill'
import { fai_split } from './fai_split'
import { union, subtract, intersect } from './boolean'
import { engrave } from './engrave'
import { chamfer } from './chamfer'
import { fillet } from './fillet'
import { group, assembly } from './compound'
import { copy } from './copy'
import { faceCenter, faceNormal, bboxCenter, bboxMin, bboxMax } from './geom'
import { asset } from './asset'
import { CONTRACT_VERSION } from '../runtime-state'
import type { StdlibNamespace } from '../runtime-state'

/**
 * Assemble stdlib functions into the cad namespace.
 * @returns the assembled StdlibNamespace ready for runtime injection.
 */
export function createApiNamespace(): StdlibNamespace {
  // D-4 strict assembly check: the cad namespace now exports dual-op functions
  // (defineOp), so registerLib requires a matching contractVersion. Cast is
  // needed because StdlibNamespace is an index-signature type.
  return {
    contractVersion: CONTRACT_VERSION,
    box, sphere, cylinder, cone, wedge,
    text, screw, svgExtrude, sdf, load,
    translate, rotate, scale,
    fai_drill, fai_extrude, engrave, chamfer, knurl,
    fillet,
    union, subtract, intersect,
    fai_split, group, assembly, copy,
    faceCenter, faceNormal, bboxCenter, bboxMin, bboxMax,
    asset,
  } as unknown as StdlibNamespace
}
