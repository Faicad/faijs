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
  /** Phase 5（D11）：平台 op 的平台身份（中立 op 缺省）。 */
  engines?: readonly string[]
  /** P26 (unit-system D8)：参数量纲声明（参数名 → DimName）。 */
  paramDims?: Record<string, string>
  /** P26 (unit-system D8)：返回值量纲。 */
  retDim?: string
}

/** Cad script-face op manifest (B1: single source for cad namespace, check() symbol table). */
export const SCRIPT_FACE_OPS: readonly ScriptFaceOp[] = [
  { name: 'torus', module: 'topology' },
  { name: 'fuse', module: 'topology', engines: ["occt"] },
  { name: 'inspectMassProps', module: 'measurement', engines: ["occt"] },
  { name: 'area', module: 'measurement' },
  { name: 'length', module: 'measurement' },
  { name: 'volume', module: 'measurement' },
  { name: 'centerOfMass', module: 'measurement' },
  { name: 'viewCamera', module: 'view' },
  { name: 'projectView', module: 'view' },
  { name: 'projectSheet', module: 'view' },
  { name: 'complexExtrude', module: 'operations', engines: ["occt"] },
  { name: 'twistExtrude', module: 'operations', engines: ["occt"] },
  { name: 'linearPattern', module: 'operations', engines: ["occt"] },
  { name: 'circularPattern', module: 'operations', engines: ["occt"] },
  { name: 'gridPattern', module: 'operations', engines: ["occt"] },
  { name: 'roof', module: 'operations' },
  { name: 'drill', module: 'operations' },
  { name: 'pocket', module: 'operations' },
  { name: 'boss', module: 'operations' },
  { name: 'mirrorJoin', module: 'operations' },
  { name: 'rectangularPattern', module: 'operations', engines: ["occt"] },
  { name: 'thread', module: 'operations', engines: ["occt"] },
  { name: 'convexHull', module: 'operations' },
  { name: 'makeBaseBox', module: 'sketching' },
  { name: 'ellipsoid', module: 'topology' },
  { name: 'rotate', module: 'topology' },
  { name: 'mirror', module: 'topology' },
  { name: 'clone', module: 'topology' },
  { name: 'applyMatrix', module: 'topology' },
  { name: 'locate', module: 'topology' },
  { name: 'split', module: 'topology', engines: ["occt"] },
  { name: 'offset', module: 'topology', engines: ["occt"] },
  { name: 'heal', module: 'topology', engines: ["occt"] },
  { name: 'simplify', module: 'topology', engines: ["occt"] },
  { name: 'isValid', module: 'topology' },
  { name: 'isSameShape', module: 'topology' },
  { name: 'autoHeal', module: 'topology', engines: ["occt"] },
  { name: 'fixShape', module: 'topology' },
  { name: 'healSolid', module: 'topology' },
  { name: 'fixSelfIntersection', module: 'topology', engines: ["occt"] },
]
