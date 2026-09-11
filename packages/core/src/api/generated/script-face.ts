/**
 * generated/script-face.ts — 生成文件，禁手改。
 * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 的
 * `scriptFace: true` 条目生成（P23 §4.2 ②：cad 脚本面 = faijs 特有 dual op + 本清单）。
 * 单一来源（B1）：api-namespace / api/index / gen-symbol-table 都从这里取，
 * 不允许手写第二份清单。
 */

import { torus, fuse, ellipsoid, rotate, mirror, clone, applyMatrix, transformCopy, locate, cut, split, offset, heal, simplify, autoHeal, fixShape, healSolid } from './topology'
export { torus, fuse, ellipsoid, rotate, mirror, clone, applyMatrix, transformCopy, locate, cut, split, offset, heal, simplify, autoHeal, fixShape, healSolid } from './topology'
import { viewCamera, projectView, projectSheet } from './view'
export { viewCamera, projectView, projectSheet } from './view'
import { linearPattern, circularPattern, gridPattern, drill, pocket, boss, mirrorJoin, rectangularPattern, convexHull } from './operations'
export { linearPattern, circularPattern, gridPattern, drill, pocket, boss, mirrorJoin, rectangularPattern, convexHull } from './operations'
import { makeBaseBox } from './sketching'
export { makeBaseBox } from './sketching'

/** cad 脚本面新增 op 的命名空间对象（api-namespace 展开进 cad）。 */
export const scriptFaceOps = {
  torus,
  fuse,
  viewCamera,
  projectView,
  projectSheet,
  linearPattern,
  circularPattern,
  gridPattern,
  drill,
  pocket,
  boss,
  mirrorJoin,
  rectangularPattern,
  convexHull,
  makeBaseBox,
  ellipsoid,
  rotate,
  mirror,
  clone,
  applyMatrix,
  transformCopy,
  locate,
  cut,
  split,
  offset,
  heal,
  simplify,
  autoHeal,
  fixShape,
  healSolid,
} as const
