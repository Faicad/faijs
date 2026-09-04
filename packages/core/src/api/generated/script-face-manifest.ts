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
  /** defineOp/compatOp 的 consumes 声明（缺省 'all'）。 */
  consumes: 'all' | 'none'
}

/** Cad script-face op manifest (B1: single source for cad namespace, check() symbol table). */
export const SCRIPT_FACE_OPS: readonly ScriptFaceOp[] = [
  { name: 'torus', module: 'topology', consumes: 'none' },
  { name: 'fuse', module: 'topology', consumes: 'all' },
  { name: 'linearPattern', module: 'operations', consumes: 'all' },
  { name: 'circularPattern', module: 'operations', consumes: 'all' },
  { name: 'gridPattern', module: 'operations', consumes: 'all' },
  { name: 'drill', module: 'operations', consumes: 'all' },
  { name: 'pocket', module: 'operations', consumes: 'all' },
  { name: 'boss', module: 'operations', consumes: 'all' },
  { name: 'mirrorJoin', module: 'operations', consumes: 'all' },
  { name: 'rectangularPattern', module: 'operations', consumes: 'all' },
  { name: 'convexHull', module: 'operations', consumes: 'all' },
  { name: 'makeBaseBox', module: 'sketching', consumes: 'none' },
  { name: 'ellipsoid', module: 'topology', consumes: 'none' },
  { name: 'rotate', module: 'topology', consumes: 'all' },
  { name: 'mirror', module: 'topology', consumes: 'all' },
  { name: 'clone', module: 'topology', consumes: 'all' },
  { name: 'applyMatrix', module: 'topology', consumes: 'all' },
  { name: 'transformCopy', module: 'topology', consumes: 'all' },
  { name: 'locate', module: 'topology', consumes: 'all' },
  { name: 'cut', module: 'topology', consumes: 'all' },
  { name: 'split', module: 'topology', consumes: 'all' },
  { name: 'offset', module: 'topology', consumes: 'all' },
  { name: 'heal', module: 'topology', consumes: 'all' },
  { name: 'simplify', module: 'topology', consumes: 'all' },
  { name: 'autoHeal', module: 'topology', consumes: 'all' },
  { name: 'fixShape', module: 'topology', consumes: 'all' },
  { name: 'healSolid', module: 'topology', consumes: 'all' },
]
