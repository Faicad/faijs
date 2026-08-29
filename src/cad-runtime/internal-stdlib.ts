/**
 * internal-stdlib — 把 stdlib 库函数装配为 cad 命名空间（统一 ABI，B2 消灭）
 *
 * 设计文档：docs/plans/2026-08-27-faijs-language-normalization-design.md §4.5-3
 * 实施文档：docs/plans/2026-08-27-faijs-language-normalization-implementation.md §5.2
 *
 * 库函数签名 = .faijs 源码形态（无隐式参数）；本文件无任何 per-函数逻辑
 */

import { box, sphere, cylinder, cone, wedge } from '../stdlib/primitives'
import { translate, rotate, scale } from '../stdlib/transform'
import { extrude } from '../stdlib/extrude'
import { knurl } from '../stdlib/knurl'
import { sdf } from '../stdlib/sdf'
import { text } from '../stdlib/text'
import { screw } from '../stdlib/screw'
import { svgExtrude } from '../stdlib/svgExtrude'
import { load } from '../stdlib/load'
import { drill } from '../stdlib/drill'
import { split } from '../stdlib/split'
import { union, subtract, intersect } from '../stdlib/boolean'
import { engrave } from '../stdlib/engrave'
import { group, assembly } from '../stdlib/compound'
import { copy } from '../stdlib/copy'
import { faceCenter, faceNormal, bboxCenter, bboxMin, bboxMax } from '../stdlib/geom'
import { asset } from '../stdlib/asset'
import type { StdlibNamespace } from '../runtime-state'
import type { Namespaces } from './module-executor'

/** Assemble stdlib functions into the cad namespace. */
export function createInternalStdlib(): StdlibNamespace {
  return {
    box, sphere, cylinder, cone, wedge,
    text, screw, svgExtrude, sdf, load,
    translate, rotate, scale,
    drill, extrude, engrave, knurl,
    union, subtract, intersect,
    split, group, assembly, copy,
    faceCenter, faceNormal, bboxCenter, bboxMin, bboxMax,
    asset,
  }
}

/** 装配命名空间集合（标准库 cad + 宿主注册的库）。 */
export function createNamespaces(
  libs?: Record<string, StdlibNamespace>,
): Namespaces {
  return { ...(libs ?? {}), cad: createInternalStdlib() }
}
