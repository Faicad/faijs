/**
 * cad-core API 类型定义 — AI 建模时的提示词素材
 *
 * ⚠️ 此文件由 scripts/gen-api-dts.ts 从 stdlib 函数目录生成，禁止手改。
 * 修改 stdlib 函数签名/目录后运行：npx tsx scripts/gen-api-dts.ts
 */

import type { Shape } from './types'

/**
 * The `cad` object's runtime API surface: every callable available to a
 * `.fai.js` model, grouped by category (creation, transform, boolean, split,
 * drill, extrude, engrave, chamfer, structure, geometry queries, assets).
 */
export interface CadAPI {
  // ── 创建 ──
  box(width: number, depth: number, height: number, options?: { at?: [number, number, number]; centered?: boolean; segments?: number }): Shape
  sphere(params: { radius: number; segments?: number; center?: [number, number, number]; nRad?: number }): Shape
  cylinder(params: { radius: number; height: number; at?: [number, number, number]; centered?: boolean; segments?: number; nRad?: number }): Shape
  cone(params: { radiusBottom: number; radiusTop: number; height: number; at?: [number, number, number]; centered?: boolean; segments?: number; nRad?: number }): Shape
  wedge(params: { width: number; height: number; angle: number; length: number; center?: [number, number, number]; nRad?: number }): Shape
  text(params: { text: string; size: number; depth: number }): Promise<Shape>
  screw(params: { system: string; specIdx: number; thread: string; pitchCustom?: number; length: number; head: string; nRad?: number }): Promise<Shape>
  svgExtrude(params: { svg: string; depth: number; targetLongSide: number }): Promise<Shape>
  sdf(params: { code: string; box?: any; resolution?: number; params?: any }): Promise<Shape>
  load(params: { key?: string; path?: string; url?: string; format?: string }): Promise<Shape>
  import_brep(params: { asset: string }): Promise<Shape>  // usage: cad.import_brep({asset}) — platform BREP asset import (non-solid wire/face/shell allowed, C6)
  import_step(params: { path: string }): Promise<Shape>  // usage: cad.import_step({path}) — platform STEP file import via host resolveFile (OCCT reader; non-solid allowed, C6)

  // ── 变换 ──
  /**
   * @deprecated **`../3d_editor` 消费面**：该 op 为编辑器应用提供（编辑器交互模型：画布显示 / 拖拽 / 时间线语句 / 结构分组），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。
   */
  translate(shape: Shape, params: { offset: [number, number, number] }): Shape
  /**
   * @deprecated **`../3d_editor` 消费面**：该 op 为编辑器应用提供（编辑器交互模型：画布显示 / 拖拽 / 时间线语句 / 结构分组），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。
   */
  rotate_euler(shape: Shape, params: { anglesDeg: [number, number, number]; pivot?: [number, number, number] }): Shape
  /**
   * @deprecated **`../3d_editor` 消费面**：该 op 为编辑器应用提供（编辑器交互模型：画布显示 / 拖拽 / 时间线语句 / 结构分组），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。
   */
  scale(shape: Shape, factor: number, options?: { center?: [number, number, number] }): Shape
  /**
   * @deprecated **`../3d_editor` 消费面**：该 op 为编辑器应用提供（编辑器交互模型：画布显示 / 拖拽 / 时间线语句 / 结构分组），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。
   */
  scale3d(shape: Shape, factor: [number, number, number], options?: { center?: [number, number, number] }): Shape
  place(shape: Shape, params: { position?: [number, number, number]; rotation?: [number, number, number, number] }): Shape  // rigid placement: rotate (quaternion, about local origin) then translate; = FreeCAD Placement T∘R

  // ── 布尔 ──
  union(shape: Shape, shape1: Shape, params?: never): Promise<Shape>  // variadic: union(a, b, ...rest)
  subtract(shape: Shape, shape1: Shape, params?: never): Promise<Shape>
  intersect(shape: Shape, shape1: Shape, params?: never): Promise<Shape>

  // ── 分割 ──
  /**
   * @deprecated **`../3d_editor` 消费面**：`fai_` 前缀 op 为编辑器应用提供，不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。
   */
  fai_split(shape: Shape, params: { normal?: [number, number, number]; offset?: number; cutMode?: string; inPlaneAngleDeg?: number; side?: string }): Promise<{ front: Shape; back: Shape; wedge?: Shape | null }>

  // ── 钻孔 ──
  /**
   * @deprecated **`../3d_editor` 消费面**：`fai_` 前缀 op 为编辑器应用提供，不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。
   */
  fai_drill(shape: Shape, params: { diameter: number; depth?: number; holeType?: string; direction?: string; tolerance?: number; position?: any; faceNormal?: any; screwSystem?: string; screwSpecIdx?: number; screwThread?: string; screwHead?: string }): Promise<Shape>

  // ── 拉伸 ──
  extrude(shape: Shape, params: { length?: number; normal?: [number, number, number]; mode?: string; upTo?: any; baseFeature?: Shape; offset?: number }): Promise<Shape>
  /**
   * @deprecated **`../3d_editor` 消费面**：`fai_` 前缀 op 为编辑器应用提供，不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。
   */
  fai_extrude(shape: Shape, params: { length: number; mode?: string; normal?: [number, number, number]; originOffset?: number; space?: string }): Promise<Shape>

  // ── 雕刻 ──
  engrave(shape: Shape, params: { text?: string; depth?: number; textSize?: number; svg?: any; svgSize?: number; mode?: string; faceCenter?: any; faceNormal?: any }): Promise<Shape>
  knurl(shape: Shape, params: { knurlTextureHeight?: number; knurlScaleU?: number; knurlScaleV?: number; knurlInvertDisplacement?: boolean; knurlRefineLength?: number; knurlMappingMode?: number; faceCenter?: any; faceNormal?: any }): Promise<Shape>

  // ── 倒角 ──
  chamfer(shape: Shape, params: { edges: any[]; type?: string; width?: number; width1?: number; width2?: number; angle?: number }): Promise<Shape>

  // ── 结构（不消费成员） ──
  /**
   * @deprecated **`../3d_editor` 消费面**：该 op 为编辑器应用提供（编辑器交互模型：画布显示 / 拖拽 / 时间线语句 / 结构分组），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。
   */
  group(params: { name?: string; members?: readonly Shape[] }): Shape  // members are kept via function-body exec.keep (visible); group does not consume them
  compound(params: { members?: Shape[]; name?: string }): Shape  // platform geometric compound (OCCT TopoDS_Compound handle); merges member meshes / makeCompound — NOT the editor group
  /**
   * @deprecated **`../3d_editor` 消费面**：该 op 为编辑器应用提供（编辑器交互模型：画布显示 / 拖拽 / 时间线语句 / 结构分组），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。
   */
  assembly(params: { name?: string; members?: readonly Shape[]; constraints?: any[] }): Shape  // members are kept via function-body exec.keep (visible); assembly does not consume them
  /**
   * @deprecated **`../3d_editor` 消费面**：该 op 为编辑器应用提供（编辑器交互模型：画布显示 / 拖拽 / 时间线语句 / 结构分组），不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。
   */
  copy(shape: Shape, params?: never): Shape  // input is kept via function-body exec.keep (visible); copy does not consume it

  // ── 几何查询 ──
  faceNormal(shape: Shape, params?: never): [number, number, number]  // usage: cad.faceNormal(of, anchor?, faceOrdinal?)
  bboxCenter(shape: Shape, params?: never): [number, number, number]
  bboxMin(shape: Shape, params?: never): [number, number, number]
  bboxMax(shape: Shape, params?: never): [number, number, number]

  // ── 资产 ──
  asset(params?: never): Promise<string>  // usage: cad.asset(key) inside args (nested call)

  // ── 查询方法（mesh/query） ──
  boundingBox(shape: Shape): { min: [number, number, number]; max: [number, number, number] }
  bboxCenter(shape: Shape): [number, number, number]
  volume(shape: Shape): number
  faceAt(shape: Shape, anchor: { point: [number, number, number]; normal?: [number, number, number] }): {
    center: [number, number, number]
    normal: [number, number, number]
    area: number
  } | null
}

/**
 * Topology identity role vocabulary per op (plan §4.2, Phase 2.10).
 *
 * Generated from each op's `naming` provenance declaration (`DUAL_OP_META`).
 * `vocab` lists the serialized `RoleName` forms the op assigns to faces it
 * **creates**; inherited faces keep their originating op's role. Changing a
 * vocabulary is a breaking change to `.fai.js` scripts (versioned contract).
 */
export interface CadRoleVocab {
  op: string
  kind: 'kernel' | 'construct' | 'identity' | 'replicate' | 'subdivide' | 'unmodeled'
  reason?: string
  vocab: readonly string[]
  note?: string
}

/**
 * Per-op face-role vocabulary, in op order (read-only contract; see `CadRoleVocab`).
 *
 * Generated from `collectRoleVocab()` — mirrors each op's `DUAL_OP_META.naming`
 * declaration. Consumers (AI/UI) use it to interpret `RoleName` faces.
 */
export const CAD_ROLE_VOCAB: readonly CadRoleVocab[] = [
  { op: 'applyMatrix', kind: 'identity' as CadRoleVocab['kind'], vocab: [], note: "1:1，第 i 面 → 第 i 面（零声明）" },
  { op: 'autoHeal', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:autoHeal:<i>'] },
  { op: 'boss', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:boss:<i>'] },
  { op: 'box', kind: 'construct' as CadRoleVocab['kind'], vocab: ['top', 'bottom', 'front', 'back', 'left', 'right'] },
  { op: 'chamfer', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:chamfer:<i>'] },
  { op: 'circularPattern', kind: 'replicate' as CadRoleVocab['kind'], vocab: [], note: "replica[k]/<原 role> 由框架生成（k=0..-1）" },
  { op: 'clone', kind: 'identity' as CadRoleVocab['kind'], vocab: [], note: "1:1，第 i 面 → 第 i 面（零声明）" },
  { op: 'cone', kind: 'construct' as CadRoleVocab['kind'], vocab: ['top', 'bottom', 'lateral'] },
  { op: 'convexHull', kind: 'unmodeled' as CadRoleVocab['kind'], reason: "construct vocabulary pending Phase 3", vocab: [] },
  { op: 'copy', kind: 'identity' as CadRoleVocab['kind'], vocab: [], note: "1:1，第 i 面 → 第 i 面（零声明）" },
  { op: 'cut', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:cut:<i>'] },
  { op: 'cylinder', kind: 'construct' as CadRoleVocab['kind'], vocab: ['top', 'bottom', 'lateral'] },
  { op: 'drill', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:drill:<i>'] },
  { op: 'ellipsoid', kind: 'unmodeled' as CadRoleVocab['kind'], reason: "construct vocabulary pending Phase 3", vocab: [] },
  { op: 'engrave', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:engrave:<i>'] },
  { op: 'extrude', kind: 'construct' as CadRoleVocab['kind'], vocab: ['top', 'bottom', 'wall:0'] },
  { op: 'fai_drill', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:fai_drill:<i>'] },
  { op: 'fai_extrude', kind: 'construct' as CadRoleVocab['kind'], vocab: ['top', 'bottom'] },
  { op: 'fai_split', kind: 'subdivide' as CadRoleVocab['kind'], vocab: [], note: "每输入面 → 若干片：splinter(<原 role>)#j 由框架生成" },
  { op: 'fillet', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:fillet:<i>'] },
  { op: 'fixShape', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:fixShape:<i>'] },
  { op: 'fuse', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:fuse:<i>'] },
  { op: 'gridPattern', kind: 'replicate' as CadRoleVocab['kind'], vocab: [], note: "replica[k]/<原 role> 由框架生成（k=0..-1）" },
  { op: 'heal', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:heal:<i>'] },
  { op: 'healSolid', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:healSolid:<i>'] },
  { op: 'intersect', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:intersect:<i>'] },
  { op: 'knurl', kind: 'unmodeled' as CadRoleVocab['kind'], reason: "knurl is mesh-only, no BREP face identity", vocab: [] },
  { op: 'linearPattern', kind: 'replicate' as CadRoleVocab['kind'], vocab: [], note: "replica[k]/<原 role> 由框架生成（k=0..-1）" },
  { op: 'locate', kind: 'identity' as CadRoleVocab['kind'], vocab: [], note: "1:1，第 i 面 → 第 i 面（零声明）" },
  { op: 'makeBaseBox', kind: 'unmodeled' as CadRoleVocab['kind'], reason: "construct vocabulary pending Phase 3", vocab: [] },
  { op: 'mirror', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:mirror:<i>'] },
  { op: 'mirrorJoin', kind: 'replicate' as CadRoleVocab['kind'], vocab: [], note: "replica[k]/<原 role> 由框架生成（k=0..1）" },
  { op: 'offset', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:offset:<i>'] },
  { op: 'place', kind: 'identity' as CadRoleVocab['kind'], vocab: [], note: "1:1，第 i 面 → 第 i 面（零声明）" },
  { op: 'pocket', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:pocket:<i>'] },
  { op: 'rectangularPattern', kind: 'replicate' as CadRoleVocab['kind'], vocab: [], note: "replica[k]/<原 role> 由框架生成（k=0..-1）" },
  { op: 'revolve', kind: 'construct' as CadRoleVocab['kind'], vocab: ['top', 'bottom', 'wall:0'] },
  { op: 'rotate', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:rotate:<i>'] },
  { op: 'rotate_euler', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:rotate_euler:<i>'] },
  { op: 'scale', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:scale:<i>'] },
  { op: 'scale3d', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:scale3d:<i>'] },
  { op: 'screw', kind: 'construct' as CadRoleVocab['kind'], vocab: [] },
  { op: 'sdf', kind: 'unmodeled' as CadRoleVocab['kind'], reason: "sdf is mesh-only, no BREP face identity", vocab: [] },
  { op: 'simplify', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:simplify:<i>'] },
  { op: 'sketch', kind: 'construct' as CadRoleVocab['kind'], vocab: [] },
  { op: 'sphere', kind: 'unmodeled' as CadRoleVocab['kind'], reason: "sphere face vocabulary pending Phase 3", vocab: [] },
  { op: 'split', kind: 'subdivide' as CadRoleVocab['kind'], vocab: [], note: "每输入面 → 若干片：splinter(<原 role>)#j 由框架生成" },
  { op: 'subtract', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:subtract:<i>'] },
  { op: 'svgExtrude', kind: 'construct' as CadRoleVocab['kind'], vocab: [] },
  { op: 'text', kind: 'construct' as CadRoleVocab['kind'], vocab: [] },
  { op: 'torus', kind: 'unmodeled' as CadRoleVocab['kind'], reason: "construct vocabulary pending Phase 3", vocab: [] },
  { op: 'transformCopy', kind: 'identity' as CadRoleVocab['kind'], vocab: [], note: "1:1，第 i 面 → 第 i 面（零声明）" },
  { op: 'translate', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:translate:<i>'] },
  { op: 'union', kind: 'kernel' as CadRoleVocab['kind'], vocab: ['gen:union:<i>'] },
  { op: 'wedge', kind: 'unmodeled' as CadRoleVocab['kind'], reason: "wedge face vocabulary pending Phase 3", vocab: [] },
]