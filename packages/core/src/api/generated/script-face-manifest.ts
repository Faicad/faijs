/**
 * generated/script-face-manifest.ts — 生成文件，禁手改。
 * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 生成。
 * cad 脚本面新增 op 清单（P23 B1 三源一致：导出面 ≡ cad 面 ≡ check() 符号表）。
 */

/** 一条 cad 脚本面新增 op。 */
export interface ScriptFaceOp {
  /** faijs 面导出名（= brepjs 符号名）。 */
  name: string
  /** 所属分片模块（生成文件名）。 */
  module: string
}

/** Cad script-face op manifest (B1: single source for cad namespace, check() symbol table). */
export const SCRIPT_FACE_OPS: readonly ScriptFaceOp[] = [
  { name: 'torus', module: 'topology' },
  { name: 'fuse', module: 'topology' },
  { name: 'viewCamera', module: 'view' },
  { name: 'projectView', module: 'view' },
  { name: 'projectSheet', module: 'view' },
  { name: 'linearPattern', module: 'operations' },
  { name: 'circularPattern', module: 'operations' },
  { name: 'gridPattern', module: 'operations' },
  { name: 'drill', module: 'operations' },
  { name: 'pocket', module: 'operations' },
  { name: 'boss', module: 'operations' },
  { name: 'mirrorJoin', module: 'operations' },
  { name: 'rectangularPattern', module: 'operations' },
  { name: 'convexHull', module: 'operations' },
  { name: 'makeBaseBox', module: 'sketching' },
  { name: 'ellipsoid', module: 'topology' },
  { name: 'rotate', module: 'topology' },
  { name: 'mirror', module: 'topology' },
  { name: 'clone', module: 'topology' },
  { name: 'applyMatrix', module: 'topology' },
  { name: 'transformCopy', module: 'topology' },
  { name: 'locate', module: 'topology' },
  { name: 'cut', module: 'topology' },
  { name: 'split', module: 'topology' },
  { name: 'offset', module: 'topology' },
  { name: 'heal', module: 'topology' },
  { name: 'simplify', module: 'topology' },
  { name: 'autoHeal', module: 'topology' },
  { name: 'fixShape', module: 'topology' },
  { name: 'healSolid', module: 'topology' },
]
