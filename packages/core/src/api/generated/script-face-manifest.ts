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
}

/** Cad script-face op manifest (B1: single source for cad namespace, check() symbol table). */
export const SCRIPT_FACE_OPS: readonly ScriptFaceOp[] = [
  { name: 'torus', module: 'topology' },
  { name: 'fuse', module: 'topology', engines: ["occt"] },
  { name: 'inspectInterference', module: 'measurement', engines: ["occt"] },
  { name: 'inspectAllInterferences', module: 'measurement', engines: ["occt"] },
  { name: 'inspectCurvature', module: 'measurement', engines: ["occt"] },
  { name: 'inspectCurvatureAtMid', module: 'measurement', engines: ["occt"] },
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
  { name: 'drill', module: 'operations', engines: ["occt"] },
  { name: 'pocket', module: 'operations', engines: ["occt"] },
  { name: 'boss', module: 'operations', engines: ["occt"] },
  { name: 'mirrorJoin', module: 'operations', engines: ["occt"] },
  { name: 'rectangularPattern', module: 'operations', engines: ["occt"] },
  { name: 'thread', module: 'operations', engines: ["occt"] },
  { name: 'convexHull', module: 'operations', engines: ["occt"] },
  { name: 'getShapeKind', module: 'core' },
  { name: 'makeBaseBox', module: 'sketching', engines: ["occt"] },
  { name: 'ellipsoid', module: 'topology', engines: ["occt"] },
  { name: 'rotate', module: 'topology', engines: ["occt"] },
  { name: 'mirror', module: 'topology', engines: ["occt"] },
  { name: 'clone', module: 'topology', engines: ["occt"] },
  { name: 'applyMatrix', module: 'topology', engines: ["occt"] },
  { name: 'locate', module: 'topology' },
  { name: 'split', module: 'topology', engines: ["occt"] },
  { name: 'offset', module: 'topology', engines: ["occt"] },
  { name: 'heal', module: 'topology', engines: ["occt"] },
  { name: 'simplify', module: 'topology', engines: ["occt"] },
  { name: 'isValid', module: 'topology' },
  { name: 'isEmpty', module: 'topology' },
  { name: 'isEqualShape', module: 'topology' },
  { name: 'isSameShape', module: 'topology' },
  { name: 'autoHeal', module: 'topology', engines: ["occt"] },
  { name: 'fixShape', module: 'topology' },
  { name: 'healSolid', module: 'topology', engines: ["occt"] },
  { name: 'fixSelfIntersection', module: 'topology', engines: ["occt"] },
]
