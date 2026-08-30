/**
 * cad-core API 类型定义 — AI 建模时的提示词素材
 *
 * ⚠️ 此文件由 scripts/gen-api-dts.ts 从 stdlib 函数目录生成，禁止手改。
 * 修改 stdlib 函数签名/目录后运行：npx tsx scripts/gen-api-dts.ts
 */

import type { Shape } from './types'

/**
 * The `cad` object's runtime API surface: every callable available to a
 * `.faijs` model, grouped by category (creation, transform, boolean, split,
 * drill, extrude, engrave, structure, geometry queries, assets).
 */
export interface CadAPI {
  // ── 创建 ──
  box(params: { size: number | [number, number, number]; center?: [number, number, number]; nRad?: number }): Shape
  sphere(params: { radius: number; segments?: number; center?: [number, number, number]; nRad?: number }): Shape
  cylinder(params: { radius: number; height: number; segments?: number; center?: [number, number, number]; nRad?: number }): Shape
  cone(params: { radiusBottom: number; radiusTop: number; height: number; segments?: number; center?: [number, number, number]; nRad?: number }): Shape
  wedge(params: { width: number; height: number; angle: number; length: number; center?: [number, number, number]; nRad?: number }): Shape
  text(params: { text: string; size: number; depth: number }): Promise<Shape>
  screw(params: { system: string; specIdx: number; thread: string; pitchCustom?: number; length: number; head: string; nRad?: number }): Promise<Shape>
  svgExtrude(params: { svg: string; depth: number; targetLongSide: number }): Promise<Shape>
  sdf(params: { code: string; box?: any; resolution?: number; params?: any }): Promise<Shape>
  load(params: { key?: string; path?: string; url?: string; format?: string }): Promise<Shape>

  // ── 变换 ──
  translate(shape: Shape, params: { offset: [number, number, number] }): Shape
  rotate(shape: Shape, params: { anglesDeg: [number, number, number]; pivot?: [number, number, number] }): Shape
  scale(shape: Shape, params: { factor: number | [number, number, number] }): Shape

  // ── 布尔 ──
  union(shape: Shape, shape1: Shape, params?: never): Promise<Shape>  // variadic: union(a, b, ...rest)
  subtract(shape: Shape, shape1: Shape, params?: never): Promise<Shape>
  intersect(shape: Shape, shape1: Shape, params?: never): Promise<Shape>

  // ── 分割 ──
  split(shape: Shape, params: { normal?: [number, number, number]; offset?: number; cutMode?: string; inPlaneAngleDeg?: number; side?: string }): Promise<{ front: Shape; back: Shape; wedge?: Shape | null }>

  // ── 钻孔 ──
  drill(shape: Shape, params: { diameter: number; depth?: number; holeType?: string; direction?: string; tolerance?: number; position?: any; faceNormal?: any; screwSystem?: string; screwSpecIdx?: number; screwThread?: string; screwHead?: string }): Promise<Shape>

  // ── 拉伸 ──
  extrude(shape: Shape, params: { length: number; mode?: string; normal?: [number, number, number]; originOffset?: number; space?: string }): Promise<Shape>

  // ── 雕刻 ──
  engrave(shape: Shape, params: { text?: string; depth?: number; textSize?: number; svg?: any; svgSize?: number; mode?: string; faceCenter?: any; faceNormal?: any }): Promise<Shape>
  knurl(shape: Shape, params: { knurlTextureHeight?: number; knurlScaleU?: number; knurlScaleV?: number; knurlInvertDisplacement?: boolean; knurlRefineLength?: number; knurlMappingMode?: number; faceCenter?: any; faceNormal?: any }): Promise<Shape>

  // ── 结构（不消费成员） ──
  group(params: { name?: string; members?: readonly Shape[] }): Shape  // members are kept via function-body exec.keep (visible); group does not consume them
  assembly(params: { name?: string; members?: readonly Shape[]; constraints?: any[] }): Shape  // members are kept via function-body exec.keep (visible); assembly does not consume them
  copy(shape: Shape, params?: never): Shape  // input is kept via function-body exec.keep (visible); copy does not consume it

  // ── 几何查询 ──
  faceCenter(shape: Shape, params?: never): [number, number, number]  // usage: cad.faceCenter(of, anchor?, faceOrdinal?)
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
