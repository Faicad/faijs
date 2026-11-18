/**
 * pmi-layer — 工程图 PMI 图层（faijs 默认实现）
 *
 * 把 `Shape.pmi` 里的标注渲染成一张**独立 SVG 图层**，叠在 `projectView` /
 * `projectSheet` 的线稿之上。宿主不需要写任何排版代码。
 *
 * 为什么是「图层」而不是散落的元素：
 * SVG 没有 z-index，**文档顺序即堆叠顺序**。图层 = 具名 `<g>`。本项目按
 * Inkscape / Illustrator 的事实标准写 `inkscape:groupmode="layer"` +
 * `inkscape:label`，在矢量软件里就是真图层（可单独显示/隐藏/锁定）；同时给
 * `data-layer="pmi"`，宿主用 CSS/JS 也能一键开关。每个图元还带 `data-pmi`
 * 语义标记（dim-line / dim-text / gdt-frame / datum-box / leader / global-note …），
 * 为后续「宿主接管单个标注位置」留出定位锚。
 *
 * 坐标系（关键约束，实测固化）：
 * HLR `projectEdges` 输出的 2D 坐标恒等于 `(dot(p - camera.position, xAxis),
 * dot(p - camera.position, yAxis))`——本项目 `camera.position` 恒为原点
 * （`view-camera.ts`），故退化为 `(dot(p, xAxis), dot(p, yAxis))`。标注锚点用同一
 * 式子投影，才能与线稿严格对齐。改动本式前先跑
 * `test/api/view/view-pmi-layer.test.ts` 的坐标一致性用例。
 *
 * 尺寸基准（为什么字号不写死 px）：
 * 视图坐标系 = **模型单位（mm）**，不是像素——`viewBox` 宽度就是零件实际宽度。
 * 因此所有版面尺寸（字号、线宽、间距）都按零件包围盒对角线推导，缺省
 * `fontSize = 对角线 × 0.025`。这样 6mm 的零件和 600mm 的零件出图观感一致。
 * 显式传 `fontSize` 时按**模型单位**理解（与 viewBox 同一空间）。
 *
 * 标注锚点从哪来：
 * `TopoRef` 自带 `hint` 几何快照（FaceHint.center/normal/axis、EdgeHint.midpoint、
 * VertexHint.position）。运行时**优先**现场解析（`resolveFaceGeometry`，行快照优先，
 * 避开 brepkit 的 center 退化），解析失败按既定契约「降级到 hint」而不是抛错
 * —— PMI 引用本来就允许失效（与 `pmi/methods.ts#carryPmi` 的注释同一口径）。
 *
 * 自动摆放规则（v1，全部相对「零件线稿包围盒」计算）：
 * - **只有一条基准：距零件轮廓的深度（depth）。** 每侧（上/下/左/右）一条单调外推
 *   的游标，量的就是 depth；所有绘制（尺寸线、引线端点、框体近边、全局块顶边）
 *   都按同一个 depth 落位，band 推进也按真实占用量。曾经尺寸线按"从锚点出发的
 *   位移"推进（`max(needX, needY, band)`），与引线类的 depth 混用两个基准，结果
 *   同一条带里装了两个不同基准的东西 → 实测 front 视图 `dim-text` 与螺纹孔
 *   `note-text` 只差 0.7，小于字号 1.52。锚点→depth 的换算是
 *   `offsetForDepth()`（支撑函数 `supportAlong()` 解决斜方向越界）。
 * - 尺寸：沿「背离零件中心」的垂直方向外移到 `depth`，文字再外推一个字高；
 * - 直径/半径：从投影圆心向外引出线到 `depth` 处，文字在引线末端；
 * - 形位公差：特征控制框贴到零件**外侧**（按锚点方位分上/下/左/右），引线指向锚点；
 * - 基准：方框 + 实心三角，三角尖落在锚点；
 * - 表面粗糙度：√ 符号 + 参数；
 * - 有目标的注释 / 螺纹孔：引线 + 肩线 + 文字；
 * - **无目标的注释（「技术要求」一类）→ 右下角整块**，右对齐、自上而下堆叠。
 *   `projectSheet` 会把这类条目从各视图里摘掉、在图纸右下角只画一次
 *   （`buildGlobalPmiBlock` 两处共用，见 view-sheet.ts）。
 * - **多视图图纸里每条标注也只画一次**：`projectSheet` 先用 `assignPmiToViews()`
 *   给每条标注挑一个"最能看清它那个特征"的视图（正对程度 / 轴向对齐 / 投影张开度
 *   打分，背面强扣分），各视图图层再用 `PmiLayerOptions.only` 只画自己负责的几条。
 *   单视图没有跨视图可挑，行为不变。
 *
 * 已知简化（v1 明确不做，不假装精确）：
 * - 角度尺寸画成「双引线标注」，不画圆弧（真实圆弧要求两线交点 + 象限裁定）；
 * - 可见性只对**平面**按「面法向 · 视向」判定朝向；曲面没有单一法向，一律视为
 *   可见；两者都**不做遮挡判定**（遮挡需把标注目标的投影折线与 HLR 结果做几何
 *   匹配，代价与收益不匹配）；
 * - 文字一律水平，不做旋转对齐；
 * - 背面标注默认跳过（`showHiddenTargets: true` 强制渲染）；
 * - 视图归属只看**朝向 / 轴向 / 投影缩短**，不做遮挡判定：被别的特征挡住的要素，
 *   只要面的朝向对得上，仍可能被选中当它的归属视图。
 * - 摆放是**一维带式**的（每侧一条单调外推的游标），不是 2D 碰撞求解。因此
 *   文字/框体不会互相压住，但**引线可能擦过同侧已摆好的框体**（例如 top 视图里
 *   螺纹孔的长引线会穿过右侧的基准框与特征控制框）。真做 2D 避让需要切向槽位
 *   分配 + 折线绕过，v1 不做。
 */

import type { Shape } from '../../mesh/types'
import type { Camera } from './cameraFns'
import type { AxisHint, TopoRef } from '../../topology/naming/types'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type {
  PmiDatum,
  PmiDimension,
  PmiGdt,
  PmiGdtType,
  PmiItem,
  PmiLocalNote,
  PmiSurfaceFinish,
  PmiThreadHole,
} from '../pmi/types'
import { formatThreadHole } from '../pmi/text'
import { generalNoteLines } from '../pmi/general-note'
import { pmiOf } from '../pmi/registry'
import { getBrepApi } from '../../brep/handle-bridge'
import { resolveTopoRef } from '../../topology/naming'
import { buildShapeResolutionContext, resolveFaceGeometry } from '../topo-resolve'

// ── 公共类型 ──

/** 2D 包围盒（视图坐标系 = 模型单位，与线稿同一空间）。 */
export interface PmiExtent2 {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** PMI 图层选项（全部可缺省）。 */
export interface PmiLayerOptions {
  /**
   * 字号（**模型单位**，与 viewBox 同一空间）。缺省 = 零件包围盒对角线 × 0.025，
   * 随零件尺寸自动缩放。
   */
  fontSize?: number
  /** 线条/文字颜色。缺省 '#000'。 */
  color?: string
  /** 图层名（`inkscape:label` + `data-layer`）。缺省 'PMI'。 */
  layerName?: string
  /**
   * 是否渲染被判定为背面的标注。缺省 false（工程图惯例：背面要素的标注不出现在
   * 当前视图）。
   */
  showHiddenTargets?: boolean
  /** 是否渲染右下角全局注释块（无目标的 note）。缺省 true。 */
  globalNotes?: boolean
  /** 引线/尺寸线与零件轮廓的最小间距（模型单位）。缺省 = fontSize × 1.4。 */
  gap?: number
  /**
   * 字体族（写进图层的 `font-family`）。缺省 'sans-serif'。
   * 形位公差符号（⏥ ⌭ ⌯ …）依赖字体覆盖，出图环境缺字形时给一个带符号的字体。
   */
  fontFamily?: string
  /**
   * 只渲染指定下标的条目（下标对应 `pmiOf(shape).items` 的顺序）。缺省 = 全部。
   *
   * 唯一的生产者/消费者是 `projectSheet` 的**视图归属**（`assignPmiToViews`）：一张
   * 多视图图纸里，同一条标注只该出现一次，所以每个视图图层都带一份"我负责哪几条"
   * 的清单。单视图（`projectView`）不需要传。
   */
  only?: ReadonlySet<number>
}

/** 图层构建结果。 */
export interface PmiLayerResult {
  /** 完整 `<g>` 标记；无任何可渲染标注时为空串。 */
  markup: string
  /** 已渲染的标注数。 */
  count: number
  /** 无法定位（引用失效且无 hint）或几何退化而跳过的标注数。 */
  skipped: number
  /** 图层内容的 2D 包围盒（未渲染任何元素时 undefined）。 */
  extent?: PmiExtent2
}

// ── 配置与常量 ──

interface PmiCfg {
  fontSize: number
  color: string
  fontFamily: string
  layerName: string
  showHiddenTargets: boolean
  globalNotes: boolean
  stroke: number
  gap: number
}

/**
 * 解析配置。字号/线宽/间距全部按零件尺度推导——视图坐标是模型单位，
 * 写死 px 会让大零件上的字小到看不见、小零件上的字大到盖住图。
 */
function resolveCfg(o: PmiLayerOptions, part: PmiExtent2): PmiCfg {
  const w = part.maxX - part.minX
  const h = part.maxY - part.minY
  const diag = Math.max(Math.hypot(w, h), 1e-6)
  const fontSize = o.fontSize ?? diag * 0.025
  return {
    fontSize,
    color: o.color ?? '#000',
    fontFamily: o.fontFamily ?? 'sans-serif',
    layerName: o.layerName ?? 'PMI',
    showHiddenTargets: o.showHiddenTargets === true,
    globalNotes: o.globalNotes !== false,
    stroke: Math.max(fontSize * 0.07, diag * 1e-4),
    gap: o.gap ?? fontSize * 1.4,
  }
}

/** ISO 1101 / ASME Y14.5 特征符号（与 FreeCAD 的 Unicode 编码惯例一致）。 */
const GDT_SYMBOL: Record<PmiGdtType, string> = {
  straightness: '⏤',
  flatness: '⏥',
  circularity: '○',
  cylindricity: '⌭',
  parallelism: '∥',
  perpendicularity: '⊥',
  angularity: '∠',
  position: '⌖',
  concentricity: '◎',
  symmetry: '⌯',
  circularRunout: '↗',
  totalRunout: '⇗',
  profileLine: '⌒',
  profileSurface: '⌓',
}

const MATERIAL_SUFFIX: Record<string, string> = { MMC: 'Ⓜ', LMC: 'Ⓛ', RFS: '' }

type Pt = readonly [number, number]

/** 只读 3D 向量（同时接受 mesh 的可变 Vec3 与 geom-types 的 readonly Vec3）。 */
type V3 = readonly [number, number, number]

// ── 数值与文本 ──

function f2(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}

/** 数值呈现：去浮点尾巴（3 位足够表达微米级公差）。 */
function fmtNum(v: number): string {
  return String(Math.round(v * 1000) / 1000)
}

/** CJK / 全角字符按 1em，其余按 0.56em（无字体度量时的通行近似）。 */
function charW(ch: string, size: number): number {
  const cp = ch.codePointAt(0) ?? 0
  if (cp > 0x2e80) return size
  if (ch === 'Φ' || ch === '⌖' || ch === '⏥' || ch === '⌭' || ch === '⌯') return size * 0.8
  return size * 0.56
}

function textW(s: string, size: number): number {
  let w = 0
  for (const ch of s) w += charW(ch, size)
  return w
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string)
}

// ── 2D/3D 小工具 ──

function dot3(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function sub3(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function len3(a: V3): number {
  return Math.sqrt(dot3(a, a))
}

function norm3(a: V3): V3 {
  const l = len3(a)
  return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l]
}

/** 3D 点 → 视图 2D 坐标（与 HLR 输出同一坐标系，见文件头）。 */
function projectPoint(p: V3, cam: Camera): Pt {
  const rel = sub3(p, cam.position)
  return [dot3(rel, cam.xAxis), dot3(rel, cam.yAxis)]
}

function norm2(a: Pt): Pt {
  const l = Math.hypot(a[0], a[1])
  return l < 1e-9 ? [0, 0] : [a[0] / l, a[1] / l]
}

// ── 包围盒 ──

function emptyExtent(): PmiExtent2 {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
}

function isExtentEmpty(e: PmiExtent2): boolean {
  return !(e.minX <= e.maxX && e.minY <= e.maxY)
}

function growExtent(e: PmiExtent2, x0: number, y0: number, x1: number, y1: number): void {
  e.minX = Math.min(e.minX, x0)
  e.minY = Math.min(e.minY, y0)
  e.maxX = Math.max(e.maxX, x1)
  e.maxY = Math.max(e.maxY, y1)
}

// ── SVG 输出（带包围盒跟踪）──

class Sink {
  readonly els: string[] = []
  readonly ext: PmiExtent2 = emptyExtent()

  private push(markup: string, x0: number, y0: number, x1: number, y1: number): void {
    this.els.push(markup)
    growExtent(this.ext, x0, y0, x1, y1)
  }

  line(
    a: Pt,
    b: Pt,
    o: { color: string; width: number; dash?: string; arrowStart?: boolean; arrowEnd?: boolean; tag?: string },
  ): void {
    const [x1, y1] = a
    const [x2, y2] = b
    const dash = o.dash === undefined ? '' : ` stroke-dasharray="${o.dash}"`
    const ms = o.arrowStart === true ? ' marker-start="url(#__PMI_ARROW__)"' : ''
    const me = o.arrowEnd === true ? ' marker-end="url(#__PMI_ARROW__)"' : ''
    const tag = o.tag === undefined ? '' : ` data-pmi="${o.tag}"`
    this.push(
      `<line${tag} x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}" stroke="${o.color}" stroke-width="${o.width}"${dash}${ms}${me} />`,
      Math.min(x1, x2),
      Math.min(y1, y2),
      Math.max(x1, x2),
      Math.max(y1, y2),
    )
  }

  text(
    at: Pt,
    s: string,
    o: { size: number; color: string; anchor?: 'start' | 'middle' | 'end'; tag?: string },
  ): void {
    const anchor = o.anchor ?? 'start'
    const w = textW(s, o.size)
    const x0 = anchor === 'middle' ? at[0] - w / 2 : anchor === 'end' ? at[0] - w : at[0]
    const tag = o.tag === undefined ? '' : ` data-pmi="${o.tag}"`
    this.push(
      // stroke="none" 是必需的：宿主根 <svg> 常带 stroke-width="0.6%"（按视口百分比解析），
      // 一旦被文字继承，笔画会被撑成黑块（单个"front"糊成一团）。
      `<text${tag} x="${f2(at[0])}" y="${f2(at[1])}" font-size="${o.size}" fill="${o.color}" stroke="none" text-anchor="${anchor}">${escapeXml(s)}</text>`,
      x0,
      at[1] - o.size * 0.85,
      x0 + w,
      at[1] + o.size * 0.25,
    )
  }

  rect(x: number, y: number, w: number, h: number, o: { color: string; width: number; fill?: string; tag?: string }): void {
    const tag = o.tag === undefined ? '' : ` data-pmi="${o.tag}"`
    this.push(
      `<rect${tag} x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" fill="${o.fill ?? 'none'}" stroke="${o.color}" stroke-width="${o.width}" />`,
      x,
      y,
      x + w,
      y + h,
    )
  }

  polyline(pts: readonly Pt[], o: { color: string; width: number; closed?: boolean; fill?: string; tag?: string }): void {
    if (pts.length === 0) return
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${f2(p[0])} ${f2(p[1])}`).join(' ') + (o.closed === true ? ' Z' : '')
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const tag = o.tag === undefined ? '' : ` data-pmi="${o.tag}"`
    this.push(
      `<path${tag} d="${d}" fill="${o.fill ?? 'none'}" stroke="${o.color}" stroke-width="${o.width}" stroke-linejoin="round" />`,
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    )
  }

  /**
   * 追加一段**外部构造**的标记（包围盒由调用方给出）。
   *
   * 只给「同一份内容要在别处复用」的场景用：全局注释块既可能画在单个视图里
   * （`drawGlobalBlock`），也可能画在整张图纸的右下角（`projectSheet`），两处
   * 必须逐字节一致，所以共用 `buildGlobalPmiBlock` 的产物。
   */
  raw(markup: string, x0: number, y0: number, x1: number, y1: number): void {
    this.push(markup, x0, y0, x1, y1)
  }
}

// ── 锚点解析 ──

interface Anchor {
  /** 视图 2D 坐标。 */
  readonly uv: Pt
  /** 模型 3D 坐标（尺寸值计算用）。 */
  readonly p3: V3
  /** 面 / 生成面外法向（可见性判定）。 */
  readonly normal?: V3
  /** 圆柱面 / 圆边的轴（轴心定位与直径数值）。 */
  readonly axis?: AxisHint
  /** 圆柱面半径（仅现场解析成功时可得）。 */
  readonly radius?: number
  /** 面类型（'plane' / 'cylinder' / …）。只有平面才做背面判定。 */
  readonly surfaceType?: string
  /** 是否朝向相机（见 `visibleFor`）。 */
  readonly visible: boolean
}

/**
 * 面是否朝向相机（**只排除背面**，不把侧立的轮廓面算作背面）。
 *
 * 判据：外法向与视向的夹角。`n·d < 0` 是背面（背离相机）；`n·d ≈ 0` 是侧立
 * （投影成轮廓线，其边可见，标注照常出）；`n·d > 0` 是正面。
 * 实测校准：front 视图 `d = (0,-1,0)`，盒 y=min 面法向 `(0,-1,0)` → `n·d = 1`
 * 正面；y=max 面 → `n·d = -1` 背面；±x 面 → `n·d = 0` 侧立。
 *
 * **曲面（圆柱/球/锥/环）一律按可见处理**：曲面没有单一法向——`FaceHint.normal`
 * 只是某个采样点处的外法向（实测圆柱侧壁取到 `(-1,0,0)`，与顶视图 `d=(0,0,-1)`
 * 点积为 0，换个采样点就会变成 ±z 而误判成背面）。曲面可见性只能靠遮挡判定，
 * 见文件头「已知简化」。
 */
function isFacingCamera(n: V3 | undefined, cam: Camera): boolean {
  if (n === undefined) return true
  return dot3(n, cam.direction) > -1e-3
}

/** 平面才做背面判定；曲面与未知类型按可见处理。 */
function visibleFor(surfaceType: string | undefined, n: V3 | undefined, cam: Camera): boolean {
  if (surfaceType !== 'plane') return true
  return isFacingCamera(n, cam)
}

/** 圆柱面半径：需活句柄（hint 不存半径）。任何一步失败按未知处理。 */
function cylinderRadius(kernel: BrepEngineApi, shape: Shape, ref: TopoRef): number | undefined {
  try {
    const ctx = buildShapeResolutionContext(kernel, shape)
    if (!ctx) return undefined
    const ent = resolveTopoRef(ref, ctx)
    if (ent.handle === undefined) return undefined
    const cyl = kernel.getFaceCylinderData(ent.handle as never)
    return cyl === null ? undefined : cyl.radius
  } catch {
    return undefined
  }
}

/** 面锚点：现场解析优先（行快照，避开 brepkit center 退化），失败降级到 hint。 */
function faceAnchor(
  ref: Extract<TopoRef, { kind: 'face' }>,
  shape: Shape,
  kernel: BrepEngineApi | undefined,
  cam: Camera,
  wantRadius: boolean,
): Anchor | undefined {
  let center: V3 | undefined = ref.hint?.center
  let normal: V3 | undefined = ref.hint?.normal
  let axis: AxisHint | undefined = ref.hint?.axis
  let surfaceType = ref.hint?.surfaceType
  if (kernel !== undefined) {
    try {
      const g = resolveFaceGeometry(kernel, shape, ref)
      center = g.center ?? center
      normal = g.normal ?? normal
      axis = g.axis ?? axis
      surfaceType = g.surfaceType ?? surfaceType
    } catch {
      // 引用失效 → 降级到 hint 快照（不抛错，与 carryPmi 的既有口径一致）
    }
  }
  if (center === undefined || normal === undefined) return undefined
  const radius = wantRadius && surfaceType === 'cylinder' && kernel !== undefined
    ? cylinderRadius(kernel, shape, ref)
    : undefined
  return {
    uv: projectPoint(center, cam),
    p3: center,
    normal,
    axis,
    radius,
    surfaceType,
    visible: visibleFor(surfaceType, normal, cam),
  }
}

/** 边锚点：优先圆边轴心（直径标注的圆心），否则取中点。 */
function edgeAnchor(ref: Extract<TopoRef, { kind: 'edge' }>, cam: Camera): Anchor | undefined {
  const axis = ref.hint?.axis
  const p3 = axis?.origin ?? ref.hint?.midpoint
  if (p3 === undefined) return undefined
  return { uv: projectPoint(p3, cam), p3, axis, visible: true }
}

/** 顶点锚点。 */
function vertexAnchor(ref: Extract<TopoRef, { kind: 'vertex' }>, cam: Camera): Anchor | undefined {
  const p = ref.hint?.position
  if (p === undefined) return undefined
  return { uv: projectPoint(p, cam), p3: p, visible: true }
}

/** 生成面（倒角/圆角过渡面）：边中点 + 两面法向平均。 */
function derivedFaceAnchor(ref: Extract<TopoRef, { kind: 'derived-face' }>, cam: Camera): Anchor | undefined {
  const p = ref.hint?.edgeMidpoint
  if (p === undefined) return undefined
  const n = norm3([
    (ref.hint.normalA[0] + ref.hint.normalB[0]) / 2,
    (ref.hint.normalA[1] + ref.hint.normalB[1]) / 2,
    (ref.hint.normalA[2] + ref.hint.normalB[2]) / 2,
  ])
  // 生成面是桥接面，法向由两面平均得出，按平面口径判定
  return { uv: projectPoint(p, cam), p3: p, normal: n, surfaceType: 'plane', visible: isFacingCamera(n, cam) }
}

function resolveAnchor(
  ref: TopoRef,
  shape: Shape,
  kernel: BrepEngineApi | undefined,
  cam: Camera,
  wantRadius = false,
): Anchor | undefined {
  switch (ref.kind) {
    case 'face':
      return faceAnchor(ref, shape, kernel, cam, wantRadius)
    case 'edge':
      return edgeAnchor(ref, cam)
    case 'vertex':
      return vertexAnchor(ref, cam)
    case 'derived-face':
      return derivedFaceAnchor(ref, cam)
  }
}

// ── 放置辅助 ──

type Side = 'right' | 'left' | 'top' | 'bottom'

function sideOf(dir: Pt): Side {
  if (Math.abs(dir[0]) >= Math.abs(dir[1])) return dir[0] >= 0 ? 'right' : 'left'
  return dir[1] >= 0 ? 'bottom' : 'top'
}

/** 从零件包围盒中心指向锚点的单位向量（锚点在中心时退回 +x）。 */
function outwardOf(at: Pt, part: PmiExtent2): Pt {
  const cx = (part.minX + part.maxX) / 2
  const cy = (part.minY + part.maxY) / 2
  const d = norm2([at[0] - cx, at[1] - cy])
  return d[0] === 0 && d[1] === 0 ? [1, 0] : d
}

/**
 * 侧向游标（band）：每个方位（上/下/左/右）一条从零件轮廓向外推进的带。
 *
 * 为什么需要：尺寸线、引线、特征控制框、全局块都在「零件外」争同一片空间。
 * 各算各的偏移量必然互相压住（实测：`60±0.1` 和 `Ra 3.2` 在同一条线上）。
 * 统一成单调游标后，同侧任意类型的标注都按出现顺序依次外推，不会重叠。
 */
interface Bands {
  right: number
  left: number
  top: number
  bottom: number
}

/** 绘制上下文。 */
interface Ctx {
  readonly sink: Sink
  readonly cfg: PmiCfg
  readonly part: PmiExtent2
  readonly bands: Bands
  readonly cam: Camera
}

/**
 * 当前方位已向外推进到哪里（距零件轮廓的距离）。只读，不推进游标。
 */
function bandStart(ctx: Ctx, side: Side): number {
  return ctx.bands[side]
}

/**
 * 按**实际占用量**推进游标：从 `used`（沿该侧法向已经用掉的深度）继续往外留 gap。
 *
 * 必须传实际占用量而不是"预留厚度"，否则被几何顶大的标注会溢出自己那条带，
 * 后面的标注反而摆在它内侧（实测：`60±0.1` 因跨零件被顶到 7.1，band 只推进
 * 5.6，`Ra 3.2` 于是正好压上去）。
 */
function advanceBand(ctx: Ctx, side: Side, used: number): void {
  ctx.bands[side] = Math.max(ctx.bands[side], used) + ctx.cfg.gap * 0.9
}

/**
 * 引线末端文字沿法向的占用量：左右侧按文字**宽度**（文字横向排开），
 * 上下侧按文字**高度**（引线竖直下来，文字水平铺在末端）。
 */
function textNormalExtent(side: Side, text: string, fs: number): number {
  return side === 'left' || side === 'right' ? fs * 1.2 + textW(text, fs) : fs * 2.7
}

/**
 * 引线类标注选方向：**只走外法向**。
 *
 * 曾经试过"选已占用带最浅的一侧"，实测更糟：锚点在零件内部（孔口、面心）时，
 * 换到垂直方向意味着引线要横穿整个零件、并擦过同侧已有标注的文字（front 视图
 * 螺纹孔引线直接划过 `Ra 3.2`）。同侧深度靠 `advanceBand` 单调外推解决即可。
 */
function pickDir(ctx: Ctx, at: Pt): Pt {
  return outwardOf(at, ctx.part)
}

/**
 * 零件包围盒在单位方向 `dir` 上的支撑值（四个角里沿 `dir` 最远的那个投影）。
 *
 * 单轴方向时它就是 `maxX`（dir=+x）/ `minY`（dir=−y）那一侧边的坐标；斜方向
 * （iso 视图）时取角点，比"逐轴 clamp"准确——逐轴 clamp 会把两个轴都推到边上，
 * 实际越过包围盒 √2 倍。
 */
function supportAlong(part: PmiExtent2, dir: Pt): number {
  const x = dir[0] >= 0 ? part.maxX : part.minX
  const y = dir[1] >= 0 ? part.maxY : part.minY
  return x * dir[0] + y * dir[1]
}

/**
 * 从锚点 `at` 沿 `dir` 走到「距零件轮廓 depth」处所需的偏移量。
 *
 * 这是整个摆放的**唯一基准换算**：band 游标记的是 depth（距轮廓），而绘制要的是
 * 从锚点出发的位移；锚点在零件内部时两者差 `support − along(at)`。混用两个基准
 * 会直接导致标注重叠（实测：front 视图 `dim-text` 与螺纹孔 `note-text` 只差 0.7，
 * 小于字号 1.52——尺寸线按"锚点位移"推进、孔标注按"距轮廓"推进，同一条带里
 * 装了两个不同基准的东西）。
 */
function offsetForDepth(part: PmiExtent2, at: Pt, dir: Pt, depth: number): number {
  return Math.max(0, depth + supportAlong(part, dir) - (at[0] * dir[0] + at[1] * dir[1]))
}

/** 引线终点：从锚点沿 dir 走到距零件轮廓 `depth` 处（depth 与 band 同一基准）。 */
function leaderPoint(ctx: Ctx, at: Pt, dir: Pt, depth: number): Pt {
  const off = offsetForDepth(ctx.part, at, dir, depth)
  return [at[0] + dir[0] * off, at[1] + dir[1] * off]
}

/** 矩形件（特征控制框 / 基准框）的左上角：贴零件外侧，按 band 外推。 */
function placeBoxOutside(
  ctx: Ctx,
  at: Pt,
  w: number,
  h: number,
  dir: Pt,
  dist: number,
): { x: number; y: number } {
  const { part } = ctx
  switch (sideOf(dir)) {
    case 'right':
      return { x: part.maxX + dist, y: at[1] - h / 2 }
    case 'left':
      return { x: part.minX - dist - w, y: at[1] - h / 2 }
    case 'bottom':
      return { x: at[0] - w / 2, y: part.maxY + dist }
    case 'top':
      return { x: at[0] - w / 2, y: part.minY - dist - h }
  }
}

// ── 标注文本 ──

/** 公差后缀：对称 `±0.05`；双向 `+0.021/0`；无公差为空串。 */
function toleranceText(dim: PmiDimension): string {
  const upper = dim.upperTolerance
  const lower = dim.lowerTolerance
  if (upper === undefined && lower === undefined) return ''
  if (dim.symmetric === true && upper !== undefined) return ` ±${fmtNum(upper)}`
  if (upper !== undefined && lower !== undefined) return ` +${fmtNum(upper)}/${fmtNum(lower)}`
  if (upper !== undefined) return ` +${fmtNum(upper)}`
  return ` ${fmtNum(lower as number)}`
}

function dimPrefix(dim: PmiDimension): string {
  if (dim.dimType === 'diameter') return 'Φ'
  if (dim.dimType === 'radius') return 'R'
  return ''
}

/** 角度值（度）。angle3pt 以第二个锚点为顶点。 */
function angleValue(anchors: readonly Anchor[], kind: 'angle' | 'angle3pt'): number | undefined {
  if (kind === 'angle3pt' && anchors.length >= 3) {
    const v = anchors[1]
    const u1 = norm3(sub3(anchors[0].p3, v.p3))
    const u2 = norm3(sub3(anchors[2].p3, v.p3))
    return (Math.acos(Math.max(-1, Math.min(1, dot3(u1, u2)))) * 180) / Math.PI
  }
  const d1 = anchors[0]?.axis?.direction
  const d2 = anchors[1]?.axis?.direction
  if (d1 !== undefined && d2 !== undefined) {
    return (Math.acos(Math.max(-1, Math.min(1, dot3(norm3(d1), norm3(d2))))) * 180) / Math.PI
  }
  return undefined
}

/**
 * 名义值：优先用标注自带的 `nominal`（导入 STEP 的快照 / 用户显式给定），
 * 否则按 `dimType` 从锚点几何量出来（`types.ts` 声明的「运行时重算」口径）。
 */
function dimensionValue(dim: PmiDimension, anchors: readonly Anchor[]): number | undefined {
  if (dim.nominal !== undefined) return dim.nominal
  const p = anchors.map((a) => a.p3)
  switch (dim.dimType) {
    case 'linear':
      return p.length >= 2 ? len3(sub3(p[1], p[0])) : undefined
    case 'linearX':
      return p.length >= 2 ? Math.abs(p[0][0] - p[1][0]) : undefined
    case 'linearY':
      return p.length >= 2 ? Math.abs(p[0][1] - p[1][1]) : undefined
    case 'linearZ':
      return p.length >= 2 ? Math.abs(p[0][2] - p[1][2]) : undefined
    case 'diameter':
      return anchors[0]?.radius === undefined ? undefined : anchors[0].radius * 2
    case 'radius':
      return anchors[0]?.radius
    case 'angle':
    case 'angle3pt':
      return angleValue(anchors, dim.dimType)
  }
}

/** 尺寸完整文本（前缀 + 数值 + 公差；角度加 `°`）。 */
function dimensionLabel(dim: PmiDimension, value: number | undefined): string {
  if (value === undefined) return dim.label ?? dimPrefix(dim) // 值不可得：不伪造数字
  const isAngle = dim.dimType === 'angle' || dim.dimType === 'angle3pt'
  return `${dimPrefix(dim)}${fmtNum(value)}${isAngle ? '°' : ''}${toleranceText(dim)}`
}

/** 形位公差特征控制框的单元格文本。 */
function fcfCells(g: PmiGdt): string[] {
  const modOf = (m: string | null | undefined): string => (m === null || m === undefined ? '' : MATERIAL_SUFFIX[m] ?? '')
  const cells = [GDT_SYMBOL[g.gdtType], `${fmtNum(g.tolerance)}${modOf(g.materialCondition)}`]
  for (const d of g.datums ?? []) cells.push(d)
  for (const seg of g.compositeSegments ?? []) {
    cells.push(`${fmtNum(seg.tolerance)}${modOf(seg.materialCondition)}`)
    for (const d of seg.datums ?? []) cells.push(d)
  }
  return cells
}

// ── 各类型标注的绘制 ──

/** 线性尺寸：尺寸线 + 双箭头 + 延伸线 + 文字。 */
function drawLinearDimension(ctx: Ctx, dim: PmiDimension, a: readonly Anchor[], label: string): boolean {
  if (a.length < 2) return false
  const p1 = a[0].uv
  const p2 = a[1].uv
  const dir = norm2([p2[0] - p1[0], p2[1] - p1[1]])
  if (dir[0] === 0 && dir[1] === 0) return false // 投影重合：无法成图
  const perpBase: Pt = [-dir[1], dir[0]]
  const mid: Pt = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]
  const cx = (ctx.part.minX + ctx.part.maxX) / 2
  const cy = (ctx.part.minY + ctx.part.maxY) / 2
  const sign = perpBase[0] * (mid[0] - cx) + perpBase[1] * (mid[1] - cy) >= 0 ? 1 : -1
  const perp: Pt = [perpBase[0] * sign, perpBase[1] * sign]
  // 摆放基准只有一个：**距零件轮廓的深度**（band 游标量的也是它）。
  // 曾经的写法先算"越过包围盒所需位移 needX/needY"，再取 max(gap, need, band)
  // 作为锚点位移——两个基准混用，推进量也就跟着算错，后来者必然压上去。
  const side = sideOf(perp)
  const depth = Math.max(ctx.cfg.gap, bandStart(ctx, side))
  const push = dim.theoreticalExact === true ? 0 : 1.15
  // 推进量：尺寸线占 depth，文字再往外 push 个字号，留出文字高度
  advanceBand(ctx, side, depth + ctx.cfg.fontSize * (push + 1.2))
  const off = offsetForDepth(ctx.part, mid, perp, depth)
  const o1: Pt = [p1[0] + perp[0] * off, p1[1] + perp[1] * off]
  const o2: Pt = [p2[0] + perp[0] * off, p2[1] + perp[1] * off]
  const ext = ctx.cfg.fontSize * 0.6

  // 延伸线：起点离锚点留一点缝，末端略超出尺寸线（工程图惯例）
  ctx.sink.line(
    [p1[0] + perp[0] * ext * 0.3, p1[1] + perp[1] * ext * 0.3],
    [o1[0] + perp[0] * ext, o1[1] + perp[1] * ext],
    { color: ctx.cfg.color, width: ctx.cfg.stroke, tag: 'dim-ext' },
  )
  ctx.sink.line(
    [p2[0] + perp[0] * ext * 0.3, p2[1] + perp[1] * ext * 0.3],
    [o2[0] + perp[0] * ext, o2[1] + perp[1] * ext],
    { color: ctx.cfg.color, width: ctx.cfg.stroke, tag: 'dim-ext' },
  )
  ctx.sink.line(o1, o2, { color: ctx.cfg.color, width: ctx.cfg.stroke, arrowStart: true, arrowEnd: true, tag: 'dim-line' })

  const tMid: Pt = [(o1[0] + o2[0]) / 2, (o1[1] + o2[1]) / 2]
  const tAt: Pt = [tMid[0] + perp[0] * ctx.cfg.fontSize * push, tMid[1] + perp[1] * ctx.cfg.fontSize * push]
  if (dim.theoreticalExact === true) drawBoxedText(ctx, tAt, label)
  else ctx.sink.text(tAt, label, { size: ctx.cfg.fontSize, color: ctx.cfg.color, anchor: 'middle', tag: 'dim-text' })
  return true
}

/** 理论正确尺寸（框住）。 */
function drawBoxedText(ctx: Ctx, at: Pt, label: string): void {
  const w = textW(label, ctx.cfg.fontSize) + ctx.cfg.fontSize * 0.7
  const h = ctx.cfg.fontSize * 1.5
  ctx.sink.rect(at[0] - w / 2, at[1] - h * 0.78, w, h, { color: ctx.cfg.color, width: ctx.cfg.stroke, tag: 'dim-box' })
  ctx.sink.text(at, label, { size: ctx.cfg.fontSize, color: ctx.cfg.color, anchor: 'middle', tag: 'dim-text' })
}

/** 直径/半径：圆心向外引出线 + 末端文字。 */
function drawRadialDimension(ctx: Ctx, a: readonly Anchor[], label: string): boolean {
  const anchor = a[0]
  if (anchor === undefined) return false
  const fs = ctx.cfg.fontSize
  const dir = pickDir(ctx, anchor.uv)
  const side = sideOf(dir)
  // 引线末端也按"距轮廓 depth"定位：与尺寸线、框体共用同一条带，不同基准就会互压
  const dist = Math.max(ctx.cfg.gap, bandStart(ctx, side))
  advanceBand(ctx, side, dist + textNormalExtent(side, label, fs))
  const end = leaderPoint(ctx, anchor.uv, dir, dist)
  ctx.sink.line(anchor.uv, end, { color: ctx.cfg.color, width: ctx.cfg.stroke, arrowStart: true, tag: 'dim-leader' })
  const right = dir[0] >= 0
  const vertical = Math.abs(dir[0]) < 0.3
  ctx.sink.text([end[0] + (right ? fs * 0.5 : -fs * 0.5), end[1] - (vertical ? fs * 0.4 : 0)], label, {
    size: fs,
    color: ctx.cfg.color,
    anchor: vertical ? 'middle' : right ? 'start' : 'end',
    tag: 'dim-text',
  })
  return true
}

/** 角度：双引线标注（v1 不画圆弧，见文件头）。 */
function drawAngularDimension(ctx: Ctx, a: readonly Anchor[], label: string): boolean {
  if (a.length < 2) return false
  const fs = ctx.cfg.fontSize
  const mid: Pt = [(a[0].uv[0] + a[1].uv[0]) / 2, (a[0].uv[1] + a[1].uv[1]) / 2]
  const dir = pickDir(ctx, mid)
  const side = sideOf(dir)
  const dist = Math.max(ctx.cfg.gap, bandStart(ctx, side))
  advanceBand(ctx, side, dist + textNormalExtent(side, label, fs))
  const at = leaderPoint(ctx, mid, dir, dist)
  ctx.sink.line(a[0].uv, at, { color: ctx.cfg.color, width: ctx.cfg.stroke, arrowStart: true, tag: 'dim-leader' })
  ctx.sink.line(a[1].uv, at, { color: ctx.cfg.color, width: ctx.cfg.stroke, arrowStart: true, tag: 'dim-leader' })
  const right = dir[0] >= 0
  const vertical = Math.abs(dir[0]) < 0.3
  ctx.sink.text([at[0] + (right ? fs * 0.5 : -fs * 0.5), at[1] - fs * 0.3], label, {
    size: fs,
    color: ctx.cfg.color,
    anchor: vertical ? 'middle' : right ? 'start' : 'end',
    tag: 'dim-text',
  })
  return true
}

/** 形位公差：特征控制框贴零件外侧 + 引线指向锚点。 */
function drawGdt(ctx: Ctx, item: PmiGdt, a: readonly Anchor[]): boolean {
  const anchor = a[0]
  if (anchor === undefined) return false
  const fs = ctx.cfg.fontSize
  const cells = fcfCells(item)
  const h = fs * 1.7
  const pad = fs * 0.5
  const widths = cells.map((c) => Math.max(textW(c, fs) + pad * 2, fs * 1.7))
  const totalW = widths.reduce((s, w) => s + w, 0)
  const dir = outwardOf(anchor.uv, ctx.part)
  const side = sideOf(dir)
  // 左右侧框是横向铺开的（占法向的是框**宽**），上下侧占的是框高
  const lateral = side === 'left' || side === 'right'
  const dist = Math.max(ctx.cfg.gap, bandStart(ctx, side))
  const box = placeBoxOutside(ctx, anchor.uv, totalW, h, dir, dist)
  advanceBand(ctx, side, dist + (lateral ? totalW : h))

  // 引线：锚点 → 框的最近边中点
  const leaderTo: Pt = [dir[0] < 0 ? box.x + totalW : box.x, box.y + h / 2]
  ctx.sink.line(anchor.uv, leaderTo, { color: ctx.cfg.color, width: ctx.cfg.stroke, arrowStart: true, tag: 'gdt-leader' })

  let cx = box.x
  for (let i = 0; i < cells.length; i += 1) {
    ctx.sink.rect(cx, box.y, widths[i], h, { color: ctx.cfg.color, width: ctx.cfg.stroke, tag: 'gdt-frame' })
    ctx.sink.text([cx + widths[i] / 2, box.y + h * 0.72], cells[i], {
      size: fs,
      color: ctx.cfg.color,
      anchor: 'middle',
      tag: 'gdt-text',
    })
    cx += widths[i]
  }
  return true
}

/** 基准：方框 + 指向锚点的实心三角。 */
function drawDatum(ctx: Ctx, item: PmiDatum, a: readonly Anchor[]): boolean {
  const anchor = a[0]
  if (anchor === undefined) return false
  const fs = ctx.cfg.fontSize
  const size = fs * 1.6
  const dir = outwardOf(anchor.uv, ctx.part)
  const side = sideOf(dir)
  const dist = Math.max(ctx.cfg.gap, bandStart(ctx, side))
  const box = placeBoxOutside(ctx, anchor.uv, size, size, dir, dist)
  advanceBand(ctx, side, dist + size)
  // 三角底边落在方框靠零件那一侧的中点
  const vertical = Math.abs(dir[1]) > Math.abs(dir[0])
  const base: Pt = vertical
    ? [box.x + size / 2, dir[1] >= 0 ? box.y : box.y + size]
    : [dir[0] >= 0 ? box.x : box.x + size, box.y + size / 2]
  const perp: Pt = vertical ? [size * 0.32, 0] : [0, size * 0.32]
  ctx.sink.polyline(
    [anchor.uv, [base[0] + perp[0], base[1] + perp[1]], [base[0] - perp[0], base[1] - perp[1]]],
    { color: ctx.cfg.color, width: ctx.cfg.stroke, closed: true, fill: ctx.cfg.color, tag: 'datum-triangle' },
  )
  ctx.sink.rect(box.x, box.y, size, size, { color: ctx.cfg.color, width: ctx.cfg.stroke, tag: 'datum-box' })
  ctx.sink.text([box.x + size / 2, box.y + size * 0.74], item.identifier, {
    size: fs,
    color: ctx.cfg.color,
    anchor: 'middle',
    tag: 'datum-text',
  })
  return true
}

/** 表面粗糙度：√ 符号 + 参数文字。 */
function drawSurfaceFinish(ctx: Ctx, item: PmiSurfaceFinish, a: readonly Anchor[]): boolean {
  const anchor = a[0]
  if (anchor === undefined) return false
  const fs = ctx.cfg.fontSize
  const dir = pickDir(ctx, anchor.uv)
  const side = sideOf(dir)
  const dist = Math.max(ctx.cfg.gap, bandStart(ctx, side))
  advanceBand(ctx, side, dist + textNormalExtent(side, `${item.parameter} ${fmtNum(item.value)}`, fs))
  const at = leaderPoint(ctx, anchor.uv, dir, dist)
  ctx.sink.line(anchor.uv, at, { color: ctx.cfg.color, width: ctx.cfg.stroke, arrowStart: true, tag: 'finish-leader' })
  ctx.sink.polyline(
    [
      [at[0], at[1] - fs * 1.3],
      [at[0] + fs * 0.5, at[1] - fs * 0.1],
      [at[0] + fs * 1.4, at[1] - fs * 1.7],
      [at[0] + fs * 2.2, at[1] - fs * 1.7],
    ],
    { color: ctx.cfg.color, width: ctx.cfg.stroke, tag: 'finish-symbol' },
  )
  ctx.sink.text([at[0] + fs * 2.4, at[1] - fs * 1.5], `${item.parameter} ${fmtNum(item.value)}`, {
    size: fs,
    color: ctx.cfg.color,
    anchor: 'start',
    tag: 'finish-text',
  })
  return true
}

/** 引线 → 肩线 → 文字（注释与螺纹孔共用）。 */
function drawLeaderText(ctx: Ctx, from: Pt, tip: Pt, text: string): boolean {
  const fs = ctx.cfg.fontSize
  const vertical = Math.abs(tip[0] - from[0]) < fs * 0.5
  const right = !vertical && tip[0] > from[0]
  ctx.sink.line(from, tip, { color: ctx.cfg.color, width: ctx.cfg.stroke, arrowStart: true, tag: 'leader' })
  const tail: Pt = vertical ? [tip[0], tip[1] + (tip[1] < from[1] ? -fs * 1.2 : fs * 1.2)] : [tip[0] + (right ? fs * 1.2 : -fs * 1.2), tip[1]]
  ctx.sink.line(tip, tail, { color: ctx.cfg.color, width: ctx.cfg.stroke, tag: 'leader' })
  if (vertical) {
    const above = tail[1] < tip[1]
    ctx.sink.text([tail[0], tail[1] + (above ? -fs * 0.3 : fs * 1.1)], text, {
      size: fs,
      color: ctx.cfg.color,
      anchor: 'middle',
      tag: 'note-text',
    })
  } else {
    ctx.sink.text([tail[0] + (right ? fs * 0.3 : -fs * 0.3), tail[1] - fs * 0.25], text, {
      size: fs,
      color: ctx.cfg.color,
      anchor: right ? 'start' : 'end',
      tag: 'note-text',
    })
  }
  return true
}

/** 注释（有目标 / 有世界锚点）：引线 + 肩线 + 文字。 */
function drawNote(ctx: Ctx, item: PmiLocalNote, at0: Pt): boolean {
  const dir = pickDir(ctx, at0)
  const side = sideOf(dir)
  const dist = Math.max(ctx.cfg.gap, bandStart(ctx, side))
  advanceBand(ctx, side, dist + textNormalExtent(side, item.text, ctx.cfg.fontSize))
  return drawLeaderText(ctx, at0, leaderPoint(ctx, at0, dir, dist), item.text)
}

/** 螺纹孔：孔口引线 + 底孔/螺纹一体文本（`formatThreadHole` 是唯一真源）。 */
function drawThreadHole(ctx: Ctx, item: PmiThreadHole): boolean {
  const at0 = projectPoint(item.axis.origin, ctx.cam)
  const text = item.label ?? formatThreadHole(item)
  // 孔口位置是几何事实，不能滑动；但**朝哪边引**可以选，否则必然与同侧已有标注叠线
  const dir = pickDir(ctx, at0)
  const side = sideOf(dir)
  const dist = Math.max(ctx.cfg.gap, bandStart(ctx, side))
  advanceBand(ctx, side, dist + textNormalExtent(side, text, ctx.cfg.fontSize))
  return drawLeaderText(ctx, at0, leaderPoint(ctx, at0, dir, dist), text)
}

/**
 * 右下角全局注释块：右对齐、自上而下堆叠，整体贴在零件线稿包围盒的右下方。
 *
 * 位置规则：右边缘对齐零件右边缘（块比零件宽时改为左边缘对齐零件左边缘，
 * 避免飞出图纸左侧），顶边在零件底边下方 `gap * 1.5` 处。
 */
function drawGlobalBlock(ctx: Ctx, notes: readonly string[]): number {
  const fs = ctx.cfg.fontSize
  const w = Math.max(...notes.map((t) => textW(t, fs)))
  const right = Math.max(ctx.part.maxX, ctx.part.minX + w)
  // 与下方已摆好的标注不重叠：band 的 bottom 游标量的就是「距轮廓深度」
  const top = ctx.part.maxY + Math.max(ctx.bands.bottom, ctx.cfg.gap * 1.5)
  const block = buildGlobalPmiBlock(notes, {
    fontSize: fs,
    color: ctx.cfg.color,
    stroke: ctx.cfg.stroke,
    right,
    top,
  })
  ctx.sink.raw(block.markup, right - block.width, top, right, top + block.height)
  return block.count
}

/** 全局注释块的绘制参数（坐标与调用方同一空间：单视图时是视图坐标，图纸时是图纸坐标）。 */
export interface PmiGlobalBlockOptions {
  /** 字号（模型单位）。 */
  fontSize: number
  /** 文字/线条颜色。缺省 '#000'。 */
  color?: string
  /** 竖线宽度。缺省 = fontSize × 0.07。 */
  stroke?: number
  /** 块**右边缘**的 x（文字右对齐到这条线）。 */
  right: number
  /** 块**顶边**的 y。 */
  top: number
}

/** 全局注释块的渲染结果。 */
export interface PmiGlobalBlockResult {
  /** 逐行 `<text>` + 左侧竖线（不含外层 `<g>`）。 */
  markup: string
  /** 占用宽度（含竖线与内缩）。 */
  width: number
  /** 占用高度。 */
  height: number
  /** 渲染的注释条数。 */
  count: number
}

/**
 * 构造"技术要求"式的全局注释块：右对齐、自上而下堆叠，左侧一条竖线。
 *
 * 单独抽出来的原因是**同一段文字可能要在两个尺度上画**：单视图（`projectView`）
 * 里画在该视图零件的右下方；整张图纸（`projectSheet`）里只画一次、画在图纸右下角。
 * 两处必须逐字节一致，所以这里返回裸元素 + 尺寸，由调用方决定放在哪、放进哪个图层。
 *
 * @param texts - note 文本（无目标的 note 的 `text`）。
 * @param o - 字号/颜色/右对齐线/顶边。
 * @returns 标记 + 占用尺寸（`texts` 为空时返回空标记与 0 尺寸）。
 */
export function buildGlobalPmiBlock(
  texts: readonly string[],
  o: PmiGlobalBlockOptions,
): PmiGlobalBlockResult {
  if (texts.length === 0) return { markup: '', width: 0, height: 0, count: 0 }
  const fs = o.fontSize
  const color = o.color ?? '#000'
  const stroke = o.stroke ?? Math.max(fs * 0.07, 1e-6)
  const lineH = fs * 1.7
  const textWMax = Math.max(...texts.map((t) => textW(t, fs)))
  const height = texts.length * lineH
  const left = o.right - textWMax
  const sink = new Sink()
  for (let i = 0; i < texts.length; i += 1) {
    sink.text([left, o.top + (i + 1) * lineH - fs * 0.4], texts[i], {
      size: fs,
      color,
      anchor: 'start',
      tag: 'global-note',
    })
  }
  // 左侧竖线：技术要求的常见排版
  sink.line([left - fs * 0.7, o.top], [left - fs * 0.7, o.top + height], { color, width: stroke, tag: 'global-rule' })
  return { markup: sink.els.join('\n'), width: textWMax + fs * 0.7, height, count: texts.length }
}

/**
 * 取一个 Shape 上的**通用**注释文本（`generalNote` 的条目行）。
 *
 * 通用注释是「整张图 / 整个零件适用」的要求（ASME Y14.100 §4.26(a)），与视图
 * 无关——三视图里它只该出现一次。`projectSheet` 用本函数把这类条目从各视图
 * 图层里摘出来，统一画到图纸的通用注释区。
 *
 * `localNote` 恒有落点（`target` 或 `anchor`），永远不进这里。
 *
 * @param shape - the annotated part.
 * @returns the general note texts (empty when none).
 */
export function generalNoteTexts(shape: Shape): string[] {
  const items = pmiOf(shape)?.items ?? []
  const lines: string[] = []
  for (const i of items) {
    if (i.kind === 'generalNote') lines.push(...generalNoteLines(i))
  }
  return lines
}

// ── 视图归属（多视图图纸：一条标注只在一个视图里出图）──

/**
 * 单条标注在某个视图里**画不出来**（目标不全、或目标在背面）时的得分。
 *
 * 用有限的负数而不是 `-Infinity`：`-Infinity > -Infinity` 为假，全体不可渲染时
 * argmax 会退化成"没有赢家"，再加兜底分支反而多一条路径；有限值让比较始终是全序
 * 的，同时量级足够大（任何"能画"的视图得分都在 ±50 以内）保证不会胜出。
 */
const UNRENDERABLE = -1e6

/** 背面锚点的扣分：必须压过"正反两面都可见"的几何优势（单锚点最多约 +13）。 */
const BACKSIDE_PENALTY = 1e3

/**
 * 取一条标注的定位锚点（与 `drawItem` 同一套解析）。
 *
 * 三种返回：锚点数组 / `'global'`（无目标的全局注释，不属于任何视图）/ `undefined`
 * （这个视图里定位不了）。
 *
 * 打分和绘制**必须共用同一套锚点解析**，否则会出现"评分说这个视图最好、实际画不出来"
 * 的错配（例如某条尺寸的目标在这一视图里引用失效）。
 */
function itemAnchors(
  item: PmiItem,
  shape: Shape,
  kernel: BrepEngineApi | undefined,
  cam: Camera,
): readonly Anchor[] | 'global' | undefined {
  const anchorOf = (ref: TopoRef, wantRadius = false): readonly Anchor[] | undefined => {
    const a = resolveAnchor(ref, shape, kernel, cam, wantRadius)
    return a === undefined ? undefined : [a]
  }
  switch (item.kind) {
    case 'dimension': {
      const radial = item.dimType === 'diameter' || item.dimType === 'radius'
      const anchors = item.targets
        .map((r) => resolveAnchor(r, shape, kernel, cam, radial))
        .filter((a): a is Anchor => a !== undefined)
      return anchors.length === item.targets.length ? anchors : undefined
    }
    case 'gdt':
      return anchorOf(item.target)
    case 'datum':
      return anchorOf(item.target)
    case 'surfaceFinish':
      return anchorOf(item.target)
    case 'localNote':
      if (item.target !== undefined) return anchorOf(item.target)
      // 裸世界锚点：没有拓扑、也就没有朝向——任何视图都能定位，得分恒为 0
      if (item.anchor !== undefined) {
        return [{ uv: projectPoint(item.anchor, cam), p3: item.anchor, visible: true }]
      }
      // 防御：`localNote` 的构造保证有落点，只有外部脏数据会走到这里
      return 'global'
    case 'generalNote':
      return 'global' // 通用注释恒无落点，图纸注释区画一次
    case 'threadHole': {
      // 孔口是裸世界坐标 + 轴线：轴线本身就能表达"从哪个方向看这个孔最圆"
      const origin = item.axis.origin
      return [{ uv: projectPoint(origin, cam), p3: origin, axis: item.axis, visible: true }]
    }
  }
}

/**
 * 一组锚点在某个视图里的可读性得分（越大越该在这个视图里出图）。
 *
 * 四项之和，量级刻意分开，保证优先级明确：
 * 1. **背面**每锚点 −1000：几何都背对着观察者，标注画出来只能靠猜测放在哪；
 * 2. **正对程度** `n·d`（0..1）× 3：同一张零件两面都能看见时，挑更正的那一视图
 *    （只对平面——曲面的 `normal` 是采样点法向，换个点就变）；
 * 3. **轴向对齐** `|axis·d|`（0..1）× 6：孔/圆柱/圆边越接近"正对着孔看"，
 *    投影越接近真圆（=0 时圆退化成一条线，直径标注根本无从谈起），权重高于平面；
 * 4. **投影张开度** `|Δuv| / |Δp3|`（0..1）× 4（多锚点尺寸）：侧看时尺寸两端会
 *    缩到一起甚至重合，工程图必须挑不缩短的那个视图。
 */
function scoreInView(anchors: readonly Anchor[], cam: Camera): number {
  let s = 0
  for (const a of anchors) {
    if (!a.visible) s -= BACKSIDE_PENALTY
    // 只有平面才谈"正对程度"：曲面的 `normal` 是某个采样点的法向，换个采样点就变
    // （与 `visibleFor` 只对平面做背面判定同一口径）；曲面的朝向由下面的轴向项表达
    if (a.normal !== undefined && (a.surfaceType === undefined || a.surfaceType === 'plane')) {
      s += Math.max(0, dot3(norm3(a.normal), cam.direction)) * 3
    }
    const axisDir = a.axis?.direction
    if (axisDir !== undefined) s += Math.abs(dot3(norm3(axisDir), cam.direction)) * 6
  }
  if (anchors.length >= 2) {
    const len3d = len3(sub3(anchors[1].p3, anchors[0].p3))
    const len2d = Math.hypot(anchors[1].uv[0] - anchors[0].uv[0], anchors[1].uv[1] - anchors[0].uv[1])
    if (len3d > 1e-9) s += (len2d / len3d) * 4
  }
  return s
}

/**
 * 为每条标注挑一个视图：**一条标注在整张图纸里只出现一次**。
 *
 * 返回值与 `pmiOf(shape).items` 一一对应：`out[i]` 是第 i 条的视图下标，`-1` 表示
 * 不属于任何视图（无目标的全局注释，由 `projectSheet` 画在图纸右下角）。
 *
 * 平局按视图**列表顺序**取先者——确定性优先：同一份脚本重跑必须得到同一张图，
 * 所以不做"分数相同就随机/按面积"之类的二次裁定。这同时给了用户一个可控旋钮：
 * 想要某条标注落在主视图，把它在 `views` 里排前面即可。
 *
 * @param shape - the annotated part.
 * @param cams - the sheet's view cameras, in sheet order (`viewCamera(view)` 的结果).
 * @returns per-item view index (`-1` = global note / no view).
 */
export function assignPmiToViews(shape: Shape, cams: readonly Camera[]): number[] {
  const items = pmiOf(shape)?.items ?? []
  const out: number[] = new Array<number>(items.length).fill(-1)
  if (items.length === 0 || cams.length === 0) return out

  let kernel: BrepEngineApi | undefined
  try {
    kernel = getBrepApi()
  } catch {
    kernel = undefined // mesh 链：只用 hint 锚点
  }

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    let bestView = -1
    let bestScore = UNRENDERABLE
    let global = false
    for (let v = 0; v < cams.length; v += 1) {
      const anchors = itemAnchors(item, shape, kernel, cams[v])
      if (anchors === 'global') {
        global = true
        break
      }
      const score = anchors === undefined ? UNRENDERABLE : scoreInView(anchors, cams[v])
      if (score > bestScore) {
        bestScore = score
        bestView = v
      }
    }
    if (global) continue // 保持 -1：全局注释由图纸右下角统一画
    // 所有视图都画不出来：仍归给第一个视图，让它在渲染统计里如实计成 skipped，
    // 而不是从图纸里静默消失（宿主需要看到"这条标注定位失败"）。
    out[i] = bestView === -1 ? 0 : bestView
  }
  return out
}

// ── 主入口 ──

type ItemOutcome = 'rendered' | 'skipped' | 'global'

/**
 * 构建 PMI 图层。
 *
 * @param shape - 携带 `pmi` 字段的产物 Shape。
 * @param cam - 视图相机（必须与生成线稿时用的是同一个）。
 * @param part - 线稿的 2D 包围盒（标注自动摆放的参照系；模型单位）。
 * @param opts - 图层选项。
 * @param uid - 文档内唯一后缀（同一 SVG 内多个图层时用于 id 去重）。
 * @returns 图层标记 + 统计信息。
 */
export function buildPmiLayer(
  shape: Shape,
  cam: Camera,
  part: PmiExtent2,
  opts: PmiLayerOptions = {},
  uid = '0',
): PmiLayerResult {
  // 走注册表聚合（含沿血缘继承的上游标注），不读 `Shape.pmi` 字段——
  // 字段只在"本条语句写过标注"时才有，`fillet` / `translate` 的产物上是空的。
  const pmi = pmiOf(shape)
  const items = pmi?.items ?? []
  if (items.length === 0 || isExtentEmpty(part)) return { markup: '', count: 0, skipped: 0 }

  const cfg = resolveCfg(opts, part)
  const sink = new Sink()
  const ctx: Ctx = { sink, cfg, part, bands: { right: cfg.gap, left: cfg.gap, top: cfg.gap, bottom: cfg.gap }, cam }
  let kernel: BrepEngineApi | undefined
  try {
    kernel = getBrepApi()
  } catch {
    kernel = undefined // mesh 链：只用 hint 锚点
  }

  const globalNotes: string[] = []
  let count = 0
  let skipped = 0
  for (let i = 0; i < items.length; i += 1) {
    // 视图归属过滤：不属于本视图的条目不画、也不计 skipped（它会在别的视图里出图，
    // 算成"跳过"会让统计数字误导宿主）。
    if (opts.only !== undefined && !opts.only.has(i)) continue
    const outcome = drawItem(ctx, items[i], shape, kernel, globalNotes)
    if (outcome === 'rendered') count += 1
    else if (outcome === 'skipped') skipped += 1
  }
  if (cfg.globalNotes && globalNotes.length > 0) count += drawGlobalBlock(ctx, globalNotes)

  if (sink.els.length === 0) return { markup: '', count: 0, skipped }

  const arrowId = `__PMI_ARROW_${uid}__`
  const body = sink.els.join('\n    ').split('__PMI_ARROW__').join(arrowId)
  // id 在文档内必须唯一：多视图（projectSheet）按视图后缀区分；统一钩子是 data-layer
  const groupId = uid === '0' ? 'pmi' : `pmi-${uid}`
  const markup = [
    `<g id="${groupId}" inkscape:groupmode="layer" inkscape:label="${escapeXml(cfg.layerName)}" data-layer="pmi" font-family="${escapeXml(cfg.fontFamily)}">`,
    `  <defs>`,
    `    <marker id="${arrowId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">`,
    `      <path d="M1 1L9 5L1 9" fill="none" stroke="${cfg.color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />`,
    `    </marker>`,
    `  </defs>`,
    `    ${body}`,
    `</g>`,
  ].join('\n')

  return {
    markup,
    count,
    skipped,
    extent: isExtentEmpty(sink.ext) ? undefined : sink.ext,
  }
}

/** 按 kind 分派；返回值决定计数与「进全局块」。 */
function drawItem(
  ctx: Ctx,
  item: PmiItem,
  shape: Shape,
  kernel: BrepEngineApi | undefined,
  globalNotes: string[],
): ItemOutcome {
  const cam = ctx.cam
  const anchorsOf = (refs: readonly TopoRef[], wantRadius: boolean): Anchor[] =>
    refs
      .map((r) => resolveAnchor(r, shape, kernel, cam, wantRadius))
      .filter((a): a is Anchor => a !== undefined)
  const anyHidden = (as: readonly Anchor[]): boolean => !ctx.cfg.showHiddenTargets && as.some((a) => !a.visible)

  switch (item.kind) {
    case 'dimension': {
      const radial = item.dimType === 'diameter' || item.dimType === 'radius'
      const anchors = anchorsOf(item.targets, radial)
      if (anchors.length !== item.targets.length) return 'skipped' // 有目标定不了位 → 整条跳过，不画半截
      if (anyHidden(anchors)) return 'skipped'
      const label = dimensionLabel(item, dimensionValue(item, anchors))
      if (radial) return drawRadialDimension(ctx, anchors, label) ? 'rendered' : 'skipped'
      if (item.dimType === 'angle' || item.dimType === 'angle3pt') {
        return drawAngularDimension(ctx, anchors, label) ? 'rendered' : 'skipped'
      }
      return drawLinearDimension(ctx, item, anchors, label) ? 'rendered' : 'skipped'
    }
    case 'gdt': {
      const a = resolveAnchor(item.target, shape, kernel, cam)
      if (a === undefined || anyHidden([a])) return 'skipped'
      return drawGdt(ctx, item, [a]) ? 'rendered' : 'skipped'
    }
    case 'datum': {
      const a = resolveAnchor(item.target, shape, kernel, cam)
      if (a === undefined || anyHidden([a])) return 'skipped'
      return drawDatum(ctx, item, [a]) ? 'rendered' : 'skipped'
    }
    case 'surfaceFinish': {
      const a = resolveAnchor(item.target, shape, kernel, cam)
      if (a === undefined || anyHidden([a])) return 'skipped'
      return drawSurfaceFinish(ctx, item, [a]) ? 'rendered' : 'skipped'
    }
    case 'localNote': {
      if (item.target !== undefined) {
        const a = resolveAnchor(item.target, shape, kernel, cam)
        if (a !== undefined) {
          if (anyHidden([a])) return 'skipped'
          return drawNote(ctx, item, a.uv) ? 'rendered' : 'skipped'
        }
      }
      if (item.anchor !== undefined) {
        return drawNote(ctx, item, projectPoint(item.anchor, cam)) ? 'rendered' : 'skipped'
      }
      globalNotes.push(item.text) // 防御：外部脏数据（无落点）仍按通用注释处理
      return 'global'
    }
    case 'generalNote': {
      globalNotes.push(...generalNoteLines(item))
      return 'global'
    }
    case 'threadHole': {
      return drawThreadHole(ctx, item) ? 'rendered' : 'skipped'
    }
  }
}
