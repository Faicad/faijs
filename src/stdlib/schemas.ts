/**
 * stdlib schemas — 全部官方 op 的参数 schema（聚合表）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §2.2
 *
 * SCHEMAS 从 src/lang/args-schema.ts 迁出到 stdlib（L1），lang 层只保留
 * 校验框架（对给定 schema 表校验的纯函数）。CadRuntime.check() 注入本表。
 *
 * 后续（Phase 2.2 完善）：每 op 文件导出自己的 schema，本文件聚合。
 */

import type { OpSchema } from '../lang/args-schema'

/** op 目录的 args schema（聚合表） */
export const SCHEMAS: Record<string, OpSchema> = {
  // 创建类
  box: {
    op: 'box',
    fields: [
      { name: 'size', type: 'numberOrVec3', required: true },
      { name: 'center', type: 'vec3', required: false },
      { name: 'nRad', type: 'number', required: false },
    ],
  },
  sphere: {
    op: 'sphere',
    fields: [
      { name: 'radius', type: 'number', required: true },
      { name: 'segments', type: 'number', required: false },
      { name: 'center', type: 'vec3', required: false },
      { name: 'nRad', type: 'number', required: false },
    ],
  },
  cylinder: {
    op: 'cylinder',
    fields: [
      { name: 'radius', type: 'number', required: true },
      { name: 'height', type: 'number', required: true },
      { name: 'segments', type: 'number', required: false },
      { name: 'center', type: 'vec3', required: false },
      { name: 'nRad', type: 'number', required: false },
    ],
  },
  cone: {
    op: 'cone',
    fields: [
      { name: 'radiusBottom', type: 'number', required: true },
      { name: 'radiusTop', type: 'number', required: true },
      { name: 'height', type: 'number', required: true },
      { name: 'segments', type: 'number', required: false },
      { name: 'center', type: 'vec3', required: false },
      { name: 'nRad', type: 'number', required: false },
    ],
  },
  wedge: {
    op: 'wedge',
    fields: [
      { name: 'width', type: 'number', required: true },
      { name: 'height', type: 'number', required: true },
      { name: 'angle', type: 'number', required: true },
      { name: 'length', type: 'number', required: true },
      { name: 'center', type: 'vec3', required: false },
      { name: 'nRad', type: 'number', required: false },
    ],
  },
  text: {
    op: 'text',
    fields: [
      { name: 'text', type: 'string', required: true },
      { name: 'size', type: 'number', required: true },
      { name: 'depth', type: 'number', required: true },
    ],
  },
  screw: {
    op: 'screw',
    fields: [
      { name: 'system', type: 'string', required: true },
      { name: 'specIdx', type: 'number', required: true },
      { name: 'thread', type: 'string', required: true },
      { name: 'pitchCustom', type: 'number', required: false },
      { name: 'length', type: 'number', required: true },
      { name: 'head', type: 'string', required: true },
      { name: 'nRad', type: 'number', required: false },
    ],
  },
  svgExtrude: {
    op: 'svgExtrude',
    fields: [
      { name: 'svg', type: 'any', required: true },
      { name: 'depth', type: 'number', required: true },
      { name: 'targetLongSide', type: 'number', required: true },
    ],
  },
  load: {
    op: 'load',
    fields: [
      { name: 'key', type: 'string', required: false },
      { name: 'path', type: 'string', required: false },
      { name: 'url', type: 'string', required: false },
      { name: 'format', type: 'string', required: false },
    ],
  },

  // 变换类
  translate: {
    op: 'translate',
    fields: [{ name: 'offset', type: 'vec3', required: true }],
    minInputs: 1,
  },
  rotate: {
    op: 'rotate',
    fields: [
      { name: 'anglesDeg', type: 'vec3', required: true },
      { name: 'pivot', type: 'vec3', required: false },
    ],
    minInputs: 1,
  },
  scale: {
    op: 'scale',
    fields: [{ name: 'factor', type: 'any', required: true }],
    minInputs: 1,
  },

  // 特征类
  drill: {
    op: 'drill',
    fields: [
      { name: 'diameter', type: 'number', required: true },
      { name: 'depth', type: 'number', required: false },
      { name: 'holeType', type: 'string', required: false },
      { name: 'direction', type: 'string', required: false },
      { name: 'tolerance', type: 'number', required: false },
      { name: 'position', type: 'any', required: false },
      { name: 'faceNormal', type: 'any', required: false },
      { name: 'screwSystem', type: 'string', required: false },
      { name: 'screwSpecIdx', type: 'number', required: false },
      { name: 'screwThread', type: 'string', required: false },
      { name: 'screwHead', type: 'string', required: false },
    ],
    minInputs: 1,
  },
  extrude: {
    op: 'extrude',
    fields: [
      { name: 'length', type: 'number', required: true },
      { name: 'mode', type: 'string', required: false },
      { name: 'normal', type: 'vec3', required: false },
      { name: 'originOffset', type: 'number', required: false },
      { name: 'space', type: 'string', required: false },
    ],
    minInputs: 1,
  },
  split: {
    op: 'split',
    fields: [
      { name: 'cutMode', type: 'string', required: false },
      { name: 'normal', type: 'vec3', required: false },
      { name: 'offset', type: 'number', required: false },
      { name: 'inPlaneAngleDeg', type: 'number', required: false },
      { name: 'side', type: 'string', required: false },
      { name: 'grooveDepth', type: 'number', required: false },
      { name: 'grooveWidth', type: 'number', required: false },
      { name: 'grooveDepthTolerance', type: 'number', required: false },
      { name: 'grooveWidthTolerance', type: 'number', required: false },
      { name: 'grooveFlapsAngle', type: 'number', required: false },
      { name: 'dowelDiameter', type: 'number', required: false },
      { name: 'dowelDiameterTolerance', type: 'number', required: false },
      { name: 'dowelHeight', type: 'number', required: false },
      { name: 'dowelHeightTolerance', type: 'number', required: false },
      { name: 'tenonSideLength', type: 'number', required: false },
      { name: 'tenonSideLengthTolerance', type: 'number', required: false },
      { name: 'tenonHeight', type: 'number', required: false },
      { name: 'tenonHeightTolerance', type: 'number', required: false },
      { name: 'bbCenter', type: 'vec3', required: false },
      { name: 'bboxSize', type: 'vec3', required: false },
      { name: 'selectedSections', type: 'any', required: false },
      { name: 'applyExplode', type: 'boolean', required: false },
      { name: 'frontPartName', type: 'PartName', required: false },
      { name: 'backPartName', type: 'PartName', required: false },
    ],
    minInputs: 1,
  },
  boolean: {
    op: 'boolean',
    fields: [
      { name: 'operation', type: 'string', required: true },
      { name: 'sourcePartNames', type: 'any', required: false },
    ],
    minInputs: 1,
  },
  engrave: {
    op: 'engrave',
    fields: [
      { name: 'text', type: 'string', required: false },
      { name: 'depth', type: 'number', required: false },
      { name: 'textSize', type: 'number', required: false },
      { name: 'svg', type: 'any', required: false },
      { name: 'svgSize', type: 'number', required: false },
      { name: 'mode', type: 'string', required: false },
      { name: 'faceCenter', type: 'any', required: false },
      { name: 'faceNormal', type: 'any', required: false },
    ],
    minInputs: 1,
  },
  knurl: {
    op: 'knurl',
    fields: [
      { name: 'knurlTextureHeight', type: 'number', required: false },
      { name: 'knurlScaleU', type: 'number', required: false },
      { name: 'knurlScaleV', type: 'number', required: false },
      { name: 'knurlInvertDisplacement', type: 'boolean', required: false },
      { name: 'knurlRefineLength', type: 'number', required: false },
      { name: 'knurlMappingMode', type: 'number', required: false },
      { name: 'faceCenter', type: 'any', required: false },
      { name: 'faceNormal', type: 'any', required: false },
    ],
    minInputs: 1,
  },
  sdf: {
    op: 'sdf',
    fields: [
      { name: 'code', type: 'string', required: true },
      { name: 'box', type: 'any', required: false },
      { name: 'resolution', type: 'number', required: false },
      { name: 'params', type: 'any', required: false },
    ],
  },

  // ── 结构型语句 ──
  // group/assembly/add_constraint/do_assemble
  // 这些 op 不产出几何，但需要 schema 校验其参数结构。
  group: {
    op: 'group',
    fields: [
      { name: 'name', type: 'string', required: false },
      { name: 'members', type: 'any', required: false },
    ],
  },
  assembly: {
    op: 'assembly',
    fields: [
      { name: 'name', type: 'string', required: false },
      { name: 'members', type: 'any', required: false },
      { name: 'constraints', type: 'any', required: false },
    ],
  },
  add_constraint: {
    op: 'add_constraint',
    void: true,
    fields: [
      { name: 'type', type: 'string', required: false },
      { name: 'fixedPartName', type: 'PartName', required: false },
      { name: 'movingPartName', type: 'PartName', required: false },
      { name: 'fixedFace', type: 'any', required: false },
      { name: 'movingFace', type: 'any', required: false },
    ],
  },
  do_assemble: {
    op: 'do_assemble',
    void: true,
    fields: [],
  },
}
