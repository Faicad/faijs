/**
 * mesh API 类型定义 — AI 建模时的提示词素材
 *
 * ⚠️ 此文件由 scripts/gen-api-dts.ts 从 args-schema 自动生成，禁止手改。
 * 修改 args-schema.ts 后运行：npx tsx scripts/gen-api-dts.ts
 */

import type { Shape } from './types'

export interface CadAPI {
  // ── 创建 ──
  box(params: { size: number | [number, number, number]; center?: [number, number, number]; nRad?: number }): Shape
  sphere(params: { radius: number; segments?: number; center?: [number, number, number]; nRad?: number }): Shape
  cylinder(params: { radius: number; height: number; segments?: number; center?: [number, number, number]; nRad?: number }): Shape
  cone(params: { radiusBottom: number; radiusTop: number; height: number; segments?: number; center?: [number, number, number]; nRad?: number }): Shape
  wedge(params: { width: number; height: number; angle: number; length: number; center?: [number, number, number]; nRad?: number }): Shape
  text(params: { text: string; size: number; depth: number }): Promise<Shape>
  screw(params: { system: string; specIdx: number; thread: string; pitchCustom?: number; length: number; head: string; nRad?: number }): Promise<Shape>
  svgExtrude(params: { svg: any; depth: number; targetLongSide: number }): Promise<Shape>
  sdf(params: { code: string; box?: any; resolution?: number; params?: any }): Promise<Shape>

  // ── 变换 ──
  translate(shape: Shape, params: { offset: [number, number, number] }): Shape
  rotate(shape: Shape, params: { anglesDeg: [number, number, number]; pivot?: [number, number, number] }): Shape
  scale(shape: Shape, params: { factor: any }): Shape

  // ── 布尔 ──
  union(a: Shape, b: Shape, ...rest: Shape[]): Promise<Shape>
  subtract(a: Shape, b: Shape): Promise<Shape>
  intersect(a: Shape, b: Shape): Promise<Shape>

  // ── 分割 ──
  split(shape: Shape, params: { normal?: [number, number, number]; offset?: number; cutMode?: string; inPlaneAngleDeg?: number; side?: string }): Promise<{ front: Shape; back: Shape; wedge?: Shape | null }>
  dovetailSplit(shape: Shape, params: {
    plane: { normal: [number, number, number]; offset: number }
    planeCenter: [number, number, number]
    widthDir: [number, number, number]
    bboxWidthOnWidthDir: number
    groove: { depth: number; depthTolerance: number; width: number; widthTolerance: number; flapsAngle: number }
  }): Promise<{ front: Shape; back: Shape; wedge: Shape | null }>
  dowelSplit(shape: Shape, params: {
    plane: { normal: [number, number, number]; offset: number }
    planeCenter: [number, number, number]
    widthDir: [number, number, number]
    dowel: { diameter: number; diameterTolerance: number; height: number; heightTolerance: number }
    selectedSections?: number[] | null
  }): Promise<{ front: Shape; back: Shape; wedge: Shape | null }>
  tenonSplit(shape: Shape, params: {
    plane: { normal: [number, number, number]; offset: number }
    planeCenter: [number, number, number]
    widthDir: [number, number, number]
    tenon: { sideLength: number; sideLengthTolerance: number; height: number; heightTolerance: number }
    selectedSections?: number[] | null
  }): Promise<{ front: Shape; back: Shape; wedge: Shape | null }>

  // ── 钻孔 ──
  drill(shape: Shape, params: { diameter: number; depth?: number; holeType?: string; direction?: string; tolerance?: number; position?: any; faceNormal?: any; screwSystem?: string; screwSpecIdx?: number; screwThread?: string; screwHead?: string }): Promise<Shape>

  // ── 拉伸 ──
  extrude(shape: Shape, params: { length: number; mode?: string; normal?: [number, number, number]; originOffset?: number; space?: string }): Promise<Shape>

  // ── 雕刻 ──
  engrave(shape: Shape, params: { text?: string; depth?: number; textSize?: number; svg?: any; svgSize?: number; mode?: string; faceCenter?: any; faceNormal?: any }): Promise<Shape>
  knurl(shape: Shape, params: { knurlTextureHeight?: number; knurlScaleU?: number; knurlScaleV?: number; knurlInvertDisplacement?: boolean; knurlRefineLength?: number; knurlMappingMode?: number; faceCenter?: any; faceNormal?: any }): Promise<Shape>

  // ── 查询 ──
  boundingBox(shape: Shape): { min: [number, number, number]; max: [number, number, number] }
  bboxCenter(shape: Shape): [number, number, number]
  volume(shape: Shape): number
  faceAt(shape: Shape, anchor: { point: [number, number, number]; normal?: [number, number, number] }): {
    center: [number, number, number]
    normal: [number, number, number]
    area: number
  } | null

  // ── IO ──
  load(params: { key?: string; path?: string; url?: string; format?: string }): Promise<Shape>
}

// ── GeomRef helpers ──

/** 面心引用：重算时自动跟随面位置 */
export function faceCenter(of: string, anchor?: [number, number, number]): { $geom: { of: string; feature: 'faceCenter'; anchor?: { point: [number, number, number] } } }

/** 面法向引用：重算时自动跟随面法向 */
export function faceNormal(of: string, anchor?: [number, number, number]): { $geom: { of: string; feature: 'faceNormal'; anchor?: { point: [number, number, number] } } }

/** 资产引用：SVG/XML 等大段文本由 AssetResolver 按 key 解析 */
export function asset(key: string): { $asset: string }