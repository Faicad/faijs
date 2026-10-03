/**
 * shapes — `cad.sketch` 的**语义图元面**（脚本面）。
 *
 * 一条规则：**形状语义只在这里实现一次**。
 * - `expandShapes`：语义图元 → canonical 几何 + 形状自带约束（正向，求解前）；
 * - `shapeFromGeoms`：编辑后的派生几何 → 形状参数（反向，交互拖拽写回用）。
 *
 * 宿主（3d_editor 等）只负责鼠标/吸附/命中这类交互，**禁止再自持一份展开逻辑**：
 * 草稿以 shapes 为真源，派生几何一律由本模块算出来。
 *
 * ── 单位 ──────────────────────────────────────────────────────────────────
 * 长度 mm；**所有角度一律弧度**（与 `canonical.ts` 同一条约定：arc 的 `a0/a1`、
 * `ellipse.angle`、`polygon.angle`、`trapezoid.a1/a2`、约束里的 `angle.value`）。
 * CadQuery 的度制在 `faijs-cadquery` 边界换算，不进入本层。
 *
 * ── tag 规则（唯一一条，两边共用）─────────────────────────────────────────
 * - 画笔图元（line / arc / bspline / point）的 tag **就是它自己那个 geom** 的 tag；
 * - 罐头形状（rect / roundedRect / circle / ellipse / polygon / slot / trapezoid）的
 *   tag 是**形状名**，派生 geom 的 tag 为 `<形状名>.0`、`<形状名>.1`……下标顺序固定
 *   （见各形状的展开注释，UI 与测试都依赖这个顺序）；
 * - 形状没给 tag 时自动分配 `g<N>`（只占一个编号，派生 geom 仍是 `g<N>.k`）。
 *   N 取所有既有 `g<N>`（含 `.k` 形式）的最大值 +1，**不复用已删除的编号**——
 *   复用会让"删了 g2 再画一个"拿到同一个名字，而旧约束可能还引用着它。
 *
 * ── 模式（mode）────────────────────────────────────────────────────────────
 * - `'a'`（缺省）：并入轮廓；
 * - `'s'`：该形状的轮廓**应作为内环（孔）**。孔的身份由轮廓包含关系决定
 *   （core `organiseBlueprints` + `addHolesInFace`），本层只记下"哪些 geom 声明了
 *   内环语义"，供 op 侧校验（`subtractRanges`）；
 * - `'c'`：构造几何（= `construction: true`），参与求解但不进轮廓；
 * - `'i'` / `'r'`：第一版**不支持**，显式报 `E_SKETCHC_UNSUPPORTED_MODE`——
 *   面级布尔/按 tag 替换属第二版，绝不做静默降级。
 */
import type { Ref, SketchConstraint, SketchGeom } from './canonical.js'

/** 平面内二维点（草图局部坐标，mm）。 */
export type Pt2 = [number, number]

/** 形状区域语义（CadQuery 的 a/s/i/c/r）。 */
export type SketchMode = 'a' | 's' | 'i' | 'c' | 'r'

/** 形状展开/写回失败。`code` 前缀在 message 里，宿主按既有习惯用正则匹配。 */
export class SketchShapeError extends Error {
  constructor(
    /** `E_SKETCHC_*` 错误码。 */
    readonly code: string,
    detail: string,
  ) {
    super(`${code}: ${detail}`)
    this.name = 'SketchShapeError'
  }
}

/** 所有形状共有字段。 */
export interface ShapeBase {
  /** 形状名；罐头形状的派生 geom tag 为 `<tag>.k`。缺省时自动分配 `g<N>`。 */
  tag?: string
  /** 区域语义；缺省 `'a'`。 */
  mode?: SketchMode
  /** 构造几何（等价 `mode:'c'`）：参与求解、但不进轮廓。 */
  construction?: boolean
}

/**
 * 语义图元。罐头形状的 `cx`/`cy` 缺省 0（形状中心），`angle` 是**弧度**。
 *
 * axis 对齐的四个罐头（rect / roundedRect / slot / trapezoid）刻意**没有 angle**：
 * 它们靠 `horizontal`/`vertical` 形状约束保持轴对齐，给个 angle 会让约束与初值互斗
 * （求解器把形状转回去）。要摆角度就把草图放在带朝向的平面上。
 */
export type SketchShape =
  | (ShapeBase & { kind: 'rect'; w: number; d: number; cx?: number; cy?: number })
  | (ShapeBase & { kind: 'roundedRect'; w: number; d: number; r: number; cx?: number; cy?: number })
  | (ShapeBase & { kind: 'circle'; r: number; cx?: number; cy?: number })
  | (ShapeBase & { kind: 'ellipse'; rx: number; ry: number; cx?: number; cy?: number; angle?: number })
  | (ShapeBase & { kind: 'polygon'; n: number; r: number; cx?: number; cy?: number; angle?: number })
  | (ShapeBase & { kind: 'slot'; w: number; d: number; cx?: number; cy?: number })
  | (ShapeBase & { kind: 'trapezoid'; w: number; h: number; a1: number; a2?: number; cx?: number; cy?: number })
  | (ShapeBase & { kind: 'line'; from: Pt2; to: Pt2 })
  | (ShapeBase & { kind: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number; ccw?: boolean })
  | (ShapeBase & { kind: 'bspline'; pts: Pt2[]; degree?: number })
  | (ShapeBase & { kind: 'point'; x: number; y: number })
  | { kind: 'close'; ref?: string }

/** 画笔图元的 kind（可串成链、可被 `close` 闭合）。 */
const PEN_KINDS = ['line', 'arc', 'bspline'] as const

/** 形状展开后的一份记录（宿主用它把派生 geom 映射回形状）。 */
export interface ShapeSpan {
  /** 输入 `shapes` 里的下标。 */
  index: number
  /** 形状 kind（`close` 也在内）。 */
  kind: SketchShape['kind']
  /** 形状名（自动分配时是本层生成的 `g<N>`）。 */
  tag: string
  /** 该形状产出的第一个 geom 在 `geoms` 里的下标。 */
  start: number
  /** 产出的 geom 条数（`close` 已是闭环时是 0）。 */
  count: number
}

/** `expandShapes` 的产物。 */
export interface ExpandedShapes {
  /** 展开后的 canonical 几何。 */
  geoms: SketchGeom[]
  /** **形状自带**的约束（不含调用方自己写的约束）。 */
  constraints: SketchConstraint[]
  /** 每个输入形状一段（与 `shapes` 同序同长）。 */
  spans: ShapeSpan[]
  /** geom 下标 → 产出它的形状下标（与 `spans` 的 `index` 对齐）。 */
  owners: number[]
  /** 声明了内环（`mode:'s'`）语义的形状所产出的 geom 区间，供 op 校验。 */
  subtractRanges: Array<{ index: number; start: number; count: number }>
  /** 展开之后下一个可用的 `g<N>` 编号（供宿主给新形状命名）。 */
  nextTag: number
}

// ────────────────────────────────────────────────────────────────────────────
// tag 分配
// ────────────────────────────────────────────────────────────────────────────

const TAG_RE = /^g(\d+)(?:\.\d+)?$/

/** 从一组 tag 里取出 `g<N>` 的最大编号（不认识的名字返回 0）。 */
function maxTagNumber(tags: Iterable<string | undefined>): number {
  let max = 0
  for (const tag of tags) {
    const m = TAG_RE.exec(tag ?? '')
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

/**
 * 给一个新形状分配名字：`g<N>`，N = 既有最大编号 + 1（不复用已删除的编号）。
 *
 * @param shapes - 当前草稿里的全部形状（含 auto 分配过的名字）。
 * @returns 未被占用的 `g<N>`。
 */
export function nextShapeTag(shapes: readonly SketchShape[]): string {
  const used = new Set<string>()
  for (const s of shapes) {
    if ('tag' in s && s.tag !== undefined) used.add(s.tag)
  }
  let next = maxTagNumber(used) + 1
  while (used.has(`g${next}`)) next++
  return `g${next}`
}

/** 罐头形状的派生 geom tag：`<形状名>.<下标>`。 */
function derivedTag(shapeTag: string, index: number): string {
  return `${shapeTag}.${index}`
}

// ────────────────────────────────────────────────────────────────────────────
// 形状轮廓数学（罐头形状的唯一实现；faijs-cadquery 也调这里，不许再抄一份）
// ────────────────────────────────────────────────────────────────────────────

/** 把局部坐标点平移到形状中心。 */
function place(p: Pt2, cx: number, cy: number): Pt2 {
  return [p[0] + cx, p[1] + cy]
}

/**
 * 矩形的四个角点（局部 + 中心平移后），顺序 `bottom-left → bottom-right →
 * top-right → top-left`（与 3d_editor 既有矩形命令的边顺序一致）。
 *
 * @param w - 宽（沿 +X）。
 * @param d - 高（沿 +Y）。
 * @param cx - 中心 x（缺省 0）。
 * @param cy - 中心 y（缺省 0）。
 * @returns 四个角点。
 */
export function rectCorners(w: number, d: number, cx = 0, cy = 0): [Pt2, Pt2, Pt2, Pt2] {
  return [
    place([-w / 2, -d / 2], cx, cy),
    place([w / 2, -d / 2], cx, cy),
    place([w / 2, d / 2], cx, cy),
    place([-w / 2, d / 2], cx, cy),
  ]
}

/**
 * 正多边形顶点。**第一个顶点在 `angle` 方向**，随后逆时针均匀分布。
 *
 * 宿主约定由调用方给：`expandShapes` 用 (angle, ccw=true)；CadQuery 的
 * `regularPolygon` 是"首顶点在 +Y、顺时针"，它自己传 `(π/2, false)`——
 * 公式只在这里写一次，约定由调用方显式声明。
 *
 * @param r - 外接圆半径。
 * @param n - 边数（≥3）。
 * @param angle - 首顶点极角（弧度）。
 * @param ccw - 是否逆时针排列（缺省 true）。
 * @returns n 个顶点（不重复首点）。
 */
export function regularPolygonVertices(r: number, n: number, angle = 0, ccw = true): Pt2[] {
  const out: Pt2[] = []
  const dir = ccw ? 1 : -1
  for (let i = 0; i < n; i++) {
    const a = angle + (dir * i * 2 * Math.PI) / n
    out.push([r * Math.cos(a), r * Math.sin(a)])
  }
  return out
}

/**
 * 长圆槽（stadium）：两条直边在 `y = ±d/2` 上、沿 X 跨 `w`，两端各一个半径
 * `d/2` 的半圆，圆心在 `(±w/2, 0)`。**总长 = w + d，总高 = d**（CadQuery
 * `Sketch.slot(w, h)` 的语义，`d` 即它的 `h`）。
 *
 * @param w - 直边长度（两圆心距）。
 * @param d - 槽宽（= 端部半圆直径）。
 * @param cx - 中心 x。
 * @param cy - 中心 y。
 * @returns 两条直边（左→右 的底边、右→左 的顶边）与两个半圆（圆心、半径、起止角）。
 */
export function slotOutline(
  w: number,
  d: number,
  cx = 0,
  cy = 0,
): {
  bottom: [Pt2, Pt2]
  top: [Pt2, Pt2]
  rightArc: { c: Pt2; r: number; a0: number; a1: number }
  leftArc: { c: Pt2; r: number; a0: number; a1: number }
} {
  const r = d / 2
  return {
    bottom: [place([-w / 2, -r], cx, cy), place([w / 2, -r], cx, cy)],
    top: [place([w / 2, r], cx, cy), place([-w / 2, r], cx, cy)],
    // 右端：-90° → 90°（逆时针，经过 +X 侧的最远点 (w/2 + r, 0)）
    rightArc: { c: place([w / 2, 0], cx, cy), r, a0: -Math.PI / 2, a1: Math.PI / 2 },
    // 左端：90° → 270°（逆时针，经过 -X 侧）
    leftArc: { c: place([-w / 2, 0], cx, cy), r, a0: Math.PI / 2, a1: (3 * Math.PI) / 2 },
  }
}

/**
 * 梯形四角（底边在下、居中）：底宽 `w`、高 `h`，左右底角 `a1`/`a2`（**弧度**）。
 *
 * 与 CadQuery `Sketch.trapezoid(w, h, a1, a2)` 同几何（它在边界把度换成弧度）：
 * 顶点按 `bottom-left → bottom-right → top-right → top-left` 排列（逆时针）。
 *
 * @param w - 底宽。
 * @param h - 高。
 * @param a1 - 左下底角（弧度）。
 * @param a2 - 右下底角（弧度）。
 * @param cx - 中心 x。
 * @param cy - 中心 y。
 * @returns 四个角点。
 */
export function trapezoidCorners(
  w: number,
  h: number,
  a1: number,
  a2: number,
  cx = 0,
  cy = 0,
): [Pt2, Pt2, Pt2, Pt2] {
  const t1 = h / Math.tan(a1)
  const t2 = h / Math.tan(a2)
  return [
    place([-w / 2, -h / 2], cx, cy),
    place([w / 2, -h / 2], cx, cy),
    place([w / 2 - t2, h / 2], cx, cy),
    place([-w / 2 + t1, h / 2], cx, cy),
  ]
}

// ────────────────────────────────────────────────────────────────────────────
// 参数校验
// ────────────────────────────────────────────────────────────────────────────

function badParam(detail: string): never {
  throw new SketchShapeError('E_SKETCHC_SHAPE_BAD_PARAM', detail)
}

function positive(value: number, what: string): number {
  if (!Number.isFinite(value) || value <= 0) badParam(`${what} must be a positive number, got ${value}`)
  return value
}

/**
 * 形状是否声明了"区域语义"（能当孔）。单条 line/arc/bspline/point 不构成区域：
 * 它们的孔身份（如果有）由闭合链的轮廓包含关系决定，不由形状本身声明。
 */
function regionSemantics(shape: SketchShape): boolean {
  return shape.kind !== 'line' && shape.kind !== 'arc' && shape.kind !== 'bspline'
    && shape.kind !== 'point' && shape.kind !== 'close'
}

/** 校验 mode/construction 组合，返回该形状是否为构造几何。 */
function resolveFlags(shape: SketchShape): { construction: boolean; mode: SketchMode } {
  const mode = ('mode' in shape ? shape.mode : undefined) ?? 'a'
  if (mode === 'i' || mode === 'r') {
    throw new SketchShapeError(
      'E_SKETCHC_UNSUPPORTED_MODE',
      `mode "${mode}" on ${shape.kind} is not supported in this version (add/subtract/construction only)`,
    )
  }
  if (mode === 's' && !regionSemantics(shape)) {
    throw new SketchShapeError(
      'E_SKETCHC_SHAPE_MODE_NOT_APPLICABLE',
      `${shape.kind} is a single edge, not a region — "subtract" cannot apply ` +
        '(a closed pen chain becomes a hole by contour containment instead)',
    )
  }
  const construction = ('construction' in shape && shape.construction === true) || mode === 'c'
  return { construction, mode }
}

// ────────────────────────────────────────────────────────────────────────────
// 展开：语义图元 → canonical 几何 + 形状自带约束
// ────────────────────────────────────────────────────────────────────────────

/** 展开一个罐头形状的几何与约束（tag 已分配；`construction` 已打上）。 */
interface ShapeExpansion {
  geoms: SketchGeom[]
  constraints: SketchConstraint[]
}

function line(a: Pt2, b: Pt2, tag: string, construction: boolean | undefined): SketchGeom {
  return {
    tag, kind: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1],
    ...(construction ? { construction: true } : {}),
  }
}

/** 闭合多边形（若干 line 首尾相接）→ n 条线 + n 个角重合 + (n-1) 条等长。 */
function closedPolylineGeoms(
  corners: Pt2[],
  tags: string[],
  construction: boolean | undefined,
): ShapeExpansion {
  const geoms = corners.map((p, i) => line(p, corners[(i + 1) % corners.length]!, tags[i]!, construction))
  const constraints: SketchConstraint[] = corners.map((_, i) => ({
    kind: 'coincident',
    a: { tag: tags[i]!, at: 'end' },
    b: { tag: tags[(i + 1) % corners.length]!, at: 'start' },
  }))
  for (let i = 1; i < corners.length; i++) {
    constraints.push({ kind: 'equal', a: { tag: tags[0]! }, b: { tag: tags[i]! } })
  }
  return { geoms, constraints }
}

/**
 * 展开一个形状。
 *
 * @param shape - 语义图元。
 * @param tags - 该形状可用的 tag（罐头形状多个、画笔图元一个）。
 * @param construction - 是否打构造标记（由 `resolveFlags` 统一裁定）。
 * @returns 几何与形状自带约束。
 */
function expandOne(shape: SketchShape, tags: string[], construction: boolean | undefined): ShapeExpansion {
  const cxOf = (s: { cx?: number }): number => s.cx ?? 0
  const cyOf = (s: { cy?: number }): number => s.cy ?? 0

  switch (shape.kind) {
    case 'rect': {
      positive(shape.w, 'rect.w')
      positive(shape.d, 'rect.d')
      const c = rectCorners(shape.w, shape.d, cxOf(shape), cyOf(shape))
      const { geoms, constraints } = closedPolylineGeoms(c, tags, construction)
      // 形状约束按 3d_editor 既有矩形命令的**同一顺序**：底/顶水平、右/左垂直。
      constraints.splice(4, 4,
        { kind: 'horizontal', of: { tag: tags[0]! } }, // 底
        { kind: 'horizontal', of: { tag: tags[2]! } }, // 顶
        { kind: 'vertical', of: { tag: tags[1]! } },   // 右
        { kind: 'vertical', of: { tag: tags[3]! } },   // 左
      )
      return { geoms, constraints }
    }
    case 'roundedRect': {
      positive(shape.w, 'roundedRect.w')
      positive(shape.d, 'roundedRect.d')
      positive(shape.r, 'roundedRect.r')
      if (shape.r * 2 > Math.min(shape.w, shape.d)) {
        badParam(`roundedRect.r=${shape.r} does not fit in ${shape.w}x${shape.d}`)
      }
      const cx = cxOf(shape)
      const cy = cyOf(shape)
      const { w, d, r } = shape
      const hw = w / 2
      const hd = d / 2
      // 顺序：底边、右下弧、右边、右上弧、顶边、左上弧、左边、左下弧。
      const geoms: SketchGeom[] = [
        line(place([-hw + r, -hd], cx, cy), place([hw - r, -hd], cx, cy), tags[0]!, construction),
        {
          tag: tags[1]!, kind: 'arc', cx: cx + hw - r, cy: cy - hd + r, r,
          a0: -Math.PI / 2, a1: 0, ccw: true, ...(construction ? { construction: true } : {}),
        },
        line(place([hw, -hd + r], cx, cy), place([hw, hd - r], cx, cy), tags[2]!, construction),
        {
          tag: tags[3]!, kind: 'arc', cx: cx + hw - r, cy: cy + hd - r, r,
          a0: 0, a1: Math.PI / 2, ccw: true, ...(construction ? { construction: true } : {}),
        },
        line(place([hw - r, hd], cx, cy), place([-hw + r, hd], cx, cy), tags[4]!, construction),
        {
          tag: tags[5]!, kind: 'arc', cx: cx - hw + r, cy: cy + hd - r, r,
          a0: Math.PI / 2, a1: Math.PI, ccw: true, ...(construction ? { construction: true } : {}),
        },
        line(place([-hw, hd - r], cx, cy), place([-hw, -hd + r], cx, cy), tags[6]!, construction),
        {
          tag: tags[7]!, kind: 'arc', cx: cx - hw + r, cy: cy - hd + r, r,
          a0: Math.PI, a1: (3 * Math.PI) / 2, ccw: true, ...(construction ? { construction: true } : {}),
        },
      ]
      const constraints: SketchConstraint[] = []
      for (let i = 0; i < geoms.length; i++) {
        constraints.push({
          kind: 'coincident',
          a: { tag: tags[i]!, at: 'end' },
          b: { tag: tags[(i + 1) % geoms.length]!, at: 'start' },
        })
      }
      constraints.push({ kind: 'horizontal', of: { tag: tags[0]! } })
      constraints.push({ kind: 'horizontal', of: { tag: tags[4]! } })
      constraints.push({ kind: 'vertical', of: { tag: tags[2]! } })
      constraints.push({ kind: 'vertical', of: { tag: tags[6]! } })
      // 圆角半径：同 slot 的缺口说明——弧上的 radius 约束当前不生效（后端无 arc_rules），
      // 圆角半径靠形状参数（初值）+ UI 写回把守。
      for (const t of [tags[1]!, tags[3]!, tags[5]!, tags[7]!]) {
        constraints.push({ kind: 'radius', of: { tag: t }, value: r })
      }
      return { geoms, constraints }
    }
    case 'circle': {
      positive(shape.r, 'circle.r')
      return {
        geoms: [{
          tag: tags[0]!, kind: 'circle', cx: cxOf(shape), cy: cyOf(shape), r: shape.r,
          ...(construction ? { construction: true } : {}),
        }],
        constraints: [],
      }
    }
    case 'ellipse': {
      positive(shape.rx, 'ellipse.rx')
      positive(shape.ry, 'ellipse.ry')
      const angle = shape.angle ?? 0
      return {
        geoms: [{
          tag: tags[0]!, kind: 'ellipse', cx: cxOf(shape), cy: cyOf(shape),
          rx: shape.rx, ry: shape.ry, ...(angle !== 0 ? { angle } : {}),
          ...(construction ? { construction: true } : {}),
        }],
        constraints: [],
      }
    }
    case 'polygon': {
      if (!Number.isInteger(shape.n) || shape.n < 3) badParam(`polygon.n must be an integer ≥ 3, got ${shape.n}`)
      positive(shape.r, 'polygon.r')
      const cx = cxOf(shape)
      const cy = cyOf(shape)
      const verts = regularPolygonVertices(shape.r, shape.n, shape.angle ?? 0)
        .map((p) => place(p, cx, cy))
      return closedPolylineGeoms(verts, tags, construction)
    }
    case 'slot': {
      positive(shape.w, 'slot.w')
      positive(shape.d, 'slot.d')
      const o = slotOutline(shape.w, shape.d, cxOf(shape), cyOf(shape))
      const geoms: SketchGeom[] = [
        line(o.bottom[0], o.bottom[1], tags[0]!, construction),
        {
          tag: tags[1]!, kind: 'arc', cx: o.rightArc.c[0], cy: o.rightArc.c[1], r: o.rightArc.r,
          a0: o.rightArc.a0, a1: o.rightArc.a1, ccw: true, ...(construction ? { construction: true } : {}),
        },
        line(o.top[0], o.top[1], tags[2]!, construction),
        {
          tag: tags[3]!, kind: 'arc', cx: o.leftArc.c[0], cy: o.leftArc.c[1], r: o.leftArc.r,
          a0: o.leftArc.a0, a1: o.leftArc.a1, ccw: true, ...(construction ? { construction: true } : {}),
        },
      ]
      const constraints: SketchConstraint[] = []
      for (let i = 0; i < 4; i++) {
        constraints.push({
          kind: 'coincident',
          a: { tag: tags[i]!, at: 'end' },
          b: { tag: tags[(i + 1) % 4]!, at: 'start' },
        })
      }
      constraints.push({ kind: 'horizontal', of: { tag: tags[0]! } })
      constraints.push({ kind: 'horizontal', of: { tag: tags[2]! } })
      // ⚠️ 缺口（2026-10-03 实测）：**圆弧上的 `radius` 约束在 faijs 的 planegcs 后端
      // 里当前无效**——后端没 push `arc_rules`，弧的 radius/角度是只写参数，而回读
      // 半径是按 |start − centre| 算的（见 planegcs-backend.ts 的 GOTCHA、
      // shapes-solve.test.ts 的"缺口登记"）。这两条照样发出：后端一补 arc_rules 就
      // 立刻生效；在此之前 slot 的端半径由**形状参数（初值）+ UI 写回**把守——求解
      // 不会主动破坏它，但别的约束把它推歪时也拉不回来（唯一实测过的修法会让
      // slot + 调用方约束被 GCS 误判成 conflicting，所以先不修）。
      constraints.push({ kind: 'radius', of: { tag: tags[1]! }, value: shape.d / 2 })
      constraints.push({ kind: 'radius', of: { tag: tags[3]! }, value: shape.d / 2 })
      return { geoms, constraints }
    }
    case 'trapezoid': {
      positive(shape.w, 'trapezoid.w')
      positive(shape.h, 'trapezoid.h')
      const a2 = shape.a2 ?? shape.a1
      for (const [name, a] of [['a1', shape.a1], ['a2', a2]] as const) {
        if (!Number.isFinite(a) || a <= 0 || a >= Math.PI) {
          badParam(`trapezoid.${name} must be in (0, π) radians, got ${a}`)
        }
      }
      const c = trapezoidCorners(shape.w, shape.h, shape.a1, a2, cxOf(shape), cyOf(shape))
      const geoms = c.map((p, i) => line(p, c[(i + 1) % 4]!, tags[i]!, construction))
      const constraints: SketchConstraint[] = []
      for (let i = 0; i < 4; i++) {
        constraints.push({
          kind: 'coincident',
          a: { tag: tags[i]!, at: 'end' },
          b: { tag: tags[(i + 1) % 4]!, at: 'start' },
        })
      }
      constraints.push({ kind: 'horizontal', of: { tag: tags[0]! } })
      // 两个底角：planegcs 的 l2l_angle_pppp 值是 **dir(b) − dir(a) 的有向差**
      // （实测，见 shapes-solve.test.ts 的探针；不是"两线夹角取锐角"），所以每个角
      // 都要用 `at` 把两条线的方向挑出来，值正好等于内角：
      //   左下角 a1：底边正向(+X) → 左腰向上（几何按 tl→bl 存，取 at:'end' 反向）
      //   右下角 a2：右腰向上（几何按 br→tr 存，正向即是向上）→ 底边反向(−X)
      constraints.push({ kind: 'angle', a: { tag: tags[0]!, at: 'start' }, b: { tag: tags[3]!, at: 'end' }, value: shape.a1 })
      constraints.push({ kind: 'angle', a: { tag: tags[1]!, at: 'start' }, b: { tag: tags[0]!, at: 'end' }, value: a2 })
      return { geoms, constraints }
    }
    case 'line':
      return {
        geoms: [line(shape.from, shape.to, tags[0]!, construction)],
        constraints: [],
      }
    case 'arc': {
      positive(shape.r, 'arc.r')
      return {
        geoms: [{
          tag: tags[0]!, kind: 'arc', cx: shape.cx, cy: shape.cy, r: shape.r,
          a0: shape.a0, a1: shape.a1, ...(shape.ccw !== undefined ? { ccw: shape.ccw } : {}),
          ...(construction ? { construction: true } : {}),
        }],
        constraints: [],
      }
    }
    case 'bspline': {
      if (shape.pts.length < 2) badParam(`bspline needs at least 2 poles, got ${shape.pts.length}`)
      const degree = shape.degree ?? Math.min(3, shape.pts.length - 1)
      if (!Number.isInteger(degree) || degree < 1 || degree >= shape.pts.length) {
        badParam(`bspline.degree must be an integer in 1..${shape.pts.length - 1}, got ${shape.degree}`)
      }
      return {
        geoms: [{
          tag: tags[0]!, kind: 'bspline',
          poles: shape.pts.map(([x, y]) => ({ x, y })),
          knots: clampedUniformKnots(shape.pts.length, degree),
          degree,
          ...(construction ? { construction: true } : {}),
        }],
        constraints: [],
      }
    }
    case 'point':
      return {
        geoms: [{
          tag: tags[0]!, kind: 'point', x: shape.x, y: shape.y,
          ...(construction ? { construction: true } : {}),
        }],
        constraints: [],
      }
    case 'close':
      // close 由 expandShapes 单独处理（它需要链上其它形状的几何）。
      throw new SketchShapeError('E_SKETCHC_CLOSE_NO_CHAIN', 'close is handled by expandShapes, not expandOne')
  }
}

/**
 * 钳位均匀节点向量：两端各重复 `degree+1` 次（clamped），内部节点均匀。
 *
 * `pts` 是**控制点**（不是插值点）——canonical 的 bspline 存的就是 poles/knots/degree，
 * 本层负责把一个"可手写的点列"变成合法的样条载荷。
 *
 * @param poleCount - 控制点个数。
 * @param degree - 次数。
 * @returns 长度 `poleCount + degree + 1` 的节点向量。
 */
export function clampedUniformKnots(poleCount: number, degree: number): number[] {
  const inner = poleCount - degree - 1
  const knots: number[] = []
  for (let i = 0; i <= degree; i++) knots.push(0)
  for (let i = 1; i <= inner; i++) knots.push(i / (inner + 1))
  for (let i = 0; i <= degree; i++) knots.push(1)
  return knots
}

/** 某形状会产出多少条 geom（罐头形状固定、画笔图元 1）。 */
function geomCountOfShape(shape: SketchShape): number {
  switch (shape.kind) {
    case 'rect': return 4
    case 'roundedRect': return 8
    case 'polygon': return shape.n
    case 'slot': return 4
    case 'trapezoid': return 4
    case 'close': return 0
    default: return 1
  }
}

/** 链上的起点（画笔形状的“入口”点）。 */
function penStart(geom: SketchGeom): Pt2 | undefined {
  switch (geom.kind) {
    case 'line': return [geom.x1, geom.y1]
    case 'arc': return [geom.cx + geom.r * Math.cos(geom.a0), geom.cy + geom.r * Math.sin(geom.a0)]
    case 'bspline': {
      const p = geom.poles[0]
      return p ? [p.x, p.y] : undefined
    }
    default: return undefined
  }
}

/** 链上的终点（画笔形状的“出口”点）。 */
function penEnd(geom: SketchGeom): Pt2 | undefined {
  switch (geom.kind) {
    case 'line': return [geom.x2, geom.y2]
    case 'arc': return [geom.cx + geom.r * Math.cos(geom.a1), geom.cy + geom.r * Math.sin(geom.a1)]
    case 'bspline': {
      const p = geom.poles[geom.poles.length - 1]
      return p ? [p.x, p.y] : undefined
    }
    default: return undefined
  }
}

/** `close` 判定"已经闭合"的容差（mm，与 contour.ts 的 JOIN_TOL 同量级）。 */
const CLOSE_TOL = 1e-7

/**
 * 展开语义图元清单。
 *
 * 正向规则见文件头。`close` 会把它前面那一段**连续的画笔形状**（line/arc/bspline）
 * 收口：链尾到链首补一条直线；链首尾本来就重合（≤1e-7）时不补。链不存在、
 * 或 `ref` 指向的不是链上的画笔形状，都显式报错。
 *
 * @param shapes - 语义图元清单（顺序即链序）。
 * @returns 展开结果（几何、形状自带约束、tag 映射、内环区间、下一个可用编号）。
 * @throws SketchShapeError 参数非法 / 模式不支持 / close 无链。
 */
export function expandShapes(shapes: readonly SketchShape[]): ExpandedShapes {
  // Pass A：把显式命名的 tag 全部登记，并算出自动编号的起点（与形状顺序无关，
  // 否则「后面的 g100」会让前面的自动编号撞车）。
  const usedTags = new Set<string>()
  for (const s of shapes) {
    const tag = 'tag' in s ? s.tag : undefined
    if (tag === undefined) continue
    usedTags.add(tag)
    if (s.kind === 'close') continue
    for (let i = 0; i < geomCountOfShape(s); i++) usedTags.add(derivedTag(tag, i))
  }
  let nextNumber = maxTagNumber(usedTags) + 1
  const allocNumber = (): string => {
    while (usedTags.has(`g${nextNumber}`)) nextNumber++
    const tag = `g${nextNumber}`
    usedTags.add(tag)
    return tag
  }

  const geoms: SketchGeom[] = []
  const constraints: SketchConstraint[] = []
  const spans: ShapeSpan[] = []
  const owners: number[] = []
  const subtractRanges: ExpandedShapes['subtractRanges'] = []
  /** 画笔形状在 `spans` 里的下标（链式 close 用）。 */
  const penSpans: number[] = []
  /** 每个 span 产出的几何（close 复核链首尾用）。 */
  const spanGeoms: SketchGeom[][] = []

  for (let index = 0; index < shapes.length; index++) {
    const shape = shapes[index]!
    const start = geoms.length

    if (shape.kind !== 'close') {
      const { mode, construction } = resolveFlags(shape)
      const explicitTag = 'tag' in shape ? shape.tag : undefined
      const shapeTag = explicitTag ?? allocNumber()
      const count = geomCountOfShape(shape)
      const tags: string[] =
        shape.kind === 'line' || shape.kind === 'arc' || shape.kind === 'bspline' || shape.kind === 'point'
          ? [shapeTag]
          : Array.from({ length: count }, (_, i) => derivedTag(shapeTag, i))
      for (const t of tags) usedTags.add(t)
      const expanded = expandOne(shape, tags, construction ? true : undefined)
      for (const g of expanded.geoms) {
        geoms.push(g)
        owners.push(index)
      }
      constraints.push(...expanded.constraints)
      spans.push({ index, kind: shape.kind, tag: shapeTag, start, count: expanded.geoms.length })
      spanGeoms.push(expanded.geoms)
      if ((PEN_KINDS as readonly string[]).includes(shape.kind)) penSpans.push(index)
      if (mode === 's') {
        subtractRanges.push({ index, start, count: expanded.geoms.length })
      }
      continue
    }

    // ── close：把链收口 ──
    // 链 = **紧邻 close 之前**的一段连续画笔形状（line/arc/bspline）；`ref` 只决定
    // **收口目标点**（缺省 = 链首起点），不改变链本身——与"闭合到该 tag 起点"一致。
    // 链与 close 之间隔着非画笔形状（罐头形状/点）即视为无链：让"哪条链被闭合"
    // 由语句顺序唯一决定，而不是靠猜。
    let targetSpan = -1
    if (shape.ref !== undefined) {
      const at = spans.findIndex((s) => s.tag === shape.ref)
      const refKind = at >= 0 ? spans[at]!.kind : undefined
      if (refKind === undefined || !(PEN_KINDS as readonly string[]).includes(refKind)) {
        throw new SketchShapeError(
          'E_SKETCHC_CLOSE_BAD_REF',
          `close.ref "${shape.ref}" does not name a pen shape (line/arc/bspline) in this sketch`,
        )
      }
      targetSpan = at
    }
    const lastPenSpan = penSpans[penSpans.length - 1]
    if (lastPenSpan === undefined || lastPenSpan !== index - 1) {
      throw new SketchShapeError(
        'E_SKETCHC_CLOSE_NO_CHAIN',
        'close must directly follow the pen chain it closes (line/arc/bspline)，' +
          '或先用 ref 指明要闭合到哪个形状',
      )
    }
    const chainMemberSpans: number[] = []
    for (let i = penSpans.length - 1; i >= 0; i--) {
      const spanIndex = penSpans[i]!
      const prev = chainMemberSpans[0]
      if (prev === undefined || spanIndex === prev - 1) chainMemberSpans.unshift(spanIndex)
      else break
    }
    if (chainMemberSpans.length === 0) {
      throw new SketchShapeError(
        'E_SKETCHC_CLOSE_NO_CHAIN',
        'close found no pen chain to close (画一条线/弧之后再闭合，或去掉这条 close)',
      )
    }
    if (targetSpan < 0) {
      targetSpan = chainMemberSpans[0]!
    } else if (!chainMemberSpans.includes(targetSpan)) {
      throw new SketchShapeError(
        'E_SKETCHC_CLOSE_BAD_REF',
        `close.ref "${shape.ref}" is not part of the pen chain immediately before this close`,
      )
    }

    const lastGeooms = spanGeoms[chainMemberSpans[chainMemberSpans.length - 1]!]!
    const lastGeom = lastGeooms[lastGeooms.length - 1]!
    const targetGeoms = spanGeoms[targetSpan]!
    const from = penEnd(lastGeom)
    const to = penStart(targetGeoms[0]!)
    if (from === undefined || to === undefined) {
      throw new SketchShapeError(
        'E_SKETCHC_CLOSE_NO_CHAIN',
        `close cannot read the chain ends (${lastGeom.kind} → ${targetGeoms[0]!.kind})`,
      )
    }
    let emitted = 0
    let emittedTag = ''
    if (Math.hypot(from[0] - to[0], from[1] - to[1]) > CLOSE_TOL) {
      emittedTag = allocNumber()
      geoms.push(line(from, to, emittedTag, undefined))
      owners.push(index)
      emitted = 1
    }
    spans.push({ index, kind: 'close', tag: emittedTag, start, count: emitted })
    spanGeoms.push([])
  }

  // nextTag = 第一个仍然空闲的编号（自动分配可能已经吃掉若干编号）。
  let freeNumber = nextNumber
  while (usedTags.has(`g${freeNumber}`)) freeNumber++
  return { geoms, constraints, spans, owners, subtractRanges, nextTag: freeNumber }
}

// ────────────────────────────────────────────────────────────────────────────
// 反向：拖拽手柄 → 形状参数（交互写回）
// ────────────────────────────────────────────────────────────────────────────

/** 手柄语义（渲染与拖拽共用同一份定义，宿主不许再算一套）。 */
export type ShapeHandleKind = 'corner' | 'edge' | 'center' | 'radius' | 'start' | 'end' | 'mid' | 'vertex'

/** 一个可拖拽手柄：位置 + 语义（拖它意味着改什么）。 */
export interface ShapeHandle {
  point: Pt2
  kind: ShapeHandleKind
}

/** 这个形状/手柄在本版本拖不动 → 显式报错（宁可拖不动，也不静默变形）。 */
function editUnsupported(shape: SketchShape, what: string): never {
  throw new SketchShapeError(
    'E_SKETCHC_SHAPE_EDIT_UNSUPPORTED',
    `${shape.kind}: ${what} is not editable in this version`,
  )
}

/** 形状中心（无中心的形状取原点）。 */
function shapeCenter(shape: SketchShape): Pt2 {
  const cx = 'cx' in shape ? (shape.cx ?? 0) : 0
  const cy = 'cy' in shape ? (shape.cy ?? 0) : 0
  return [cx, cy]
}

/** 两点中点。 */
function midpoint(a: Pt2, b: Pt2): Pt2 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

/** 把点按中心平移。 */
function translatePoint(p: Pt2, from: Pt2, to: Pt2): Pt2 {
  return [p[0] + (to[0] - from[0]), p[1] + (to[1] - from[1])]
}

/**
 * 圆弧的有符号扫掠（与 `canonical.ts` 的约定一致：方向由 `ccw` 决定，缺省按 `a1 > a0`
 * 推断；`a0 === a1` 视为整圆）。宿主 `sketch-draft.ts#arcSpan` 与 core
 * `geometry2d/adapt.ts` 用的是同一条规则——中点手柄要落在弧上，必须与它们同解。
 */
function arcSweep(a0: number, a1: number, ccw: boolean | undefined): number {
  const dir = ccw ?? a1 - a0 > 0
  let sweep = dir ? a1 - a0 : a0 - a1
  while (sweep <= 0) sweep += Math.PI * 2
  while (sweep > Math.PI * 2) sweep -= Math.PI * 2
  return dir ? sweep : -sweep
}

/** 圆弧中点手柄的角度。 */
function arcMidAngle(a0: number, a1: number, ccw: boolean | undefined): number {
  return a0 + arcSweep(a0, a1, ccw) / 2
}

/**
 * 圆弧的三个关键点（三点弧构造的唯一实现：`start → mid → end`，`mid` 一定在弧上）。
 *
 * 消费方：`shapeHandles` 的弧手柄；faijs-cadquery 的 `slot()` 与 `arc(c,r,a,da)`
 * 重载（OCCT `makeArcEdge` / CadQuery 都是三点弧签名）。反向遍历同一条弧只需交换
 * `start` / `end`（`mid` 不变——同一段弧反向走，半程点是同一个点）。
 *
 * @param c - 圆心。
 * @param r - 半径。
 * @param a0 - 起始角（弧度）。
 * @param a1 - 终止角（弧度）。
 * @param ccw - 方向（缺省按 `a1 > a0` 推）。
 * @returns 三点（草图局部坐标）。
 */
export function arcPoints(
  c: Pt2,
  r: number,
  a0: number,
  a1: number,
  ccw?: boolean,
): { start: Pt2; mid: Pt2; end: Pt2 } {
  const at = (a: number): Pt2 => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]
  return { start: at(a0), mid: at(arcMidAngle(a0, a1, ccw)), end: at(a1) }
}

/**
 * 形状的可拖拽手柄清单（下标即 `dragShapeHandle` / `handleForGeomControl` 的 handle 参数）。
 *
 * 布局（顺序固定，测试与宿主都依赖）：
 * - `rect`：`[角0, 角1, 角2, 角3, 边0中, 边1中, 边2中, 边3中, 中心]`（角顺序同展开：左下起逆时针）
 * - `circle`：`[中心, 半径]`；`ellipse`：`[中心, rx, ry]`；`polygon`：`[中心, 顶点0..n-1]`
 * - `line`：`[起点, 终点, 中点]`；`arc`：`[圆心, 起点, 终点, 中点]`；`point`：`[点]`
 * - `bspline`：`[控制点0..n-1]`
 * - `slot` / `roundedRect` / `trapezoid`：**只有中心**（v1 支持整体平移）
 *
 * @param shape - 语义图元。
 * @returns 手柄清单（可能为空，如 `close`）。
 */
export function shapeHandles(shape: SketchShape): ShapeHandle[] {
  const [c, y] = shapeCenter(shape)
  switch (shape.kind) {
    case 'rect': {
      const corners = rectCorners(shape.w, shape.d, c, y)
      return [
        ...corners.map((point): ShapeHandle => ({ point, kind: 'corner' })),
        ...corners.map((p, i): ShapeHandle => ({ point: midpoint(p, corners[(i + 1) % 4]!), kind: 'edge' })),
        { point: [c, y], kind: 'center' },
      ]
    }
    case 'circle':
      return [
        { point: [c, y], kind: 'center' },
        { point: [c + shape.r, y], kind: 'radius' },
      ]
    case 'ellipse':
      return [
        { point: [c, y], kind: 'center' },
        { point: [c + shape.rx, y], kind: 'radius' },
        { point: [c, y + shape.ry], kind: 'radius' },
      ]
    case 'polygon': {
      const verts = regularPolygonVertices(shape.r, shape.n, shape.angle ?? 0).map((p) => place(p, c, y))
      return [
        { point: [c, y], kind: 'center' },
        ...verts.map((point): ShapeHandle => ({ point, kind: 'vertex' })),
      ]
    }
    case 'slot':
    case 'roundedRect':
    case 'trapezoid':
      return [{ point: [c, y], kind: 'center' }]
    case 'line':
      return [
        { point: shape.from, kind: 'start' },
        { point: shape.to, kind: 'end' },
        { point: midpoint(shape.from, shape.to), kind: 'mid' },
      ]
    case 'arc': {
      const { mid, start, end } = arcPoints([shape.cx, shape.cy], shape.r, shape.a0, shape.a1, shape.ccw)
      return [
        { point: [shape.cx, shape.cy], kind: 'center' },
        { point: start, kind: 'start' },
        { point: end, kind: 'end' },
        { point: mid, kind: 'mid' },
      ]
    }
    case 'bspline':
      return shape.pts.map((pt): ShapeHandle => ({ point: [pt[0], pt[1]], kind: 'vertex' }))
    case 'point':
      return [{ point: [shape.x, shape.y], kind: 'start' }]
    case 'close':
      return []
  }
}

/** 拖动矩形的角：对角不动、这一角跟手（轴对齐，靠 H/V 形状约束维持）。 */
function dragRectCorner(shape: Extract<SketchShape, { kind: 'rect' }>, handle: number, to: Pt2): SketchShape {
  const [c, y] = shapeCenter(shape)
  const opposite = rectCorners(shape.w, shape.d, c, y)[(handle + 2) % 4]!
  const w = Math.abs(to[0] - opposite[0])
  const d = Math.abs(to[1] - opposite[1])
  if (w <= 0 || d <= 0) badParam(`rect drag collapsed the rectangle (w=${w}, d=${d})`)
  return { ...shape, w, d, cx: (to[0] + opposite[0]) / 2, cy: (to[1] + opposite[1]) / 2 }
}

/** 拖动矩形的边：那条边跟手、对边不动。 */
function dragRectEdge(shape: Extract<SketchShape, { kind: 'rect' }>, edge: number, to: Pt2): SketchShape {
  const [c, y] = shapeCenter(shape)
  switch (edge) {
    case 0: { // 底边（y = cy - d/2）
      const top = y + shape.d / 2
      const d = top - to[1]
      if (d <= 0) badParam(`rect bottom edge drag collapsed the height (d=${d})`)
      return { ...shape, d, cx: c, cy: (top + to[1]) / 2 }
    }
    case 2: { // 顶边
      const bottom = y - shape.d / 2
      const d = to[1] - bottom
      if (d <= 0) badParam(`rect top edge drag collapsed the height (d=${d})`)
      return { ...shape, d, cx: c, cy: (bottom + to[1]) / 2 }
    }
    case 1: { // 右边（x = cx + w/2）
      const left = c - shape.w / 2
      const w = to[0] - left
      if (w <= 0) badParam(`rect right edge drag collapsed the width (w=${w})`)
      return { ...shape, w, cx: (left + to[0]) / 2, cy: y }
    }
    default: { // 左边
      const right = c + shape.w / 2
      const w = right - to[0]
      if (w <= 0) badParam(`rect left edge drag collapsed the width (w=${w})`)
      return { ...shape, w, cx: (right + to[0]) / 2, cy: y }
    }
  }
}

/**
 * 拖动形状的某个手柄，返回**新的形状参数**（拖拽写回的唯一入口）。
 *
 * 语义：形状保持自己的形状语义——拖矩形的角，得到"对角不动、这一角跟手"的矩形；
 * 拖矩形某条边，得到"那条边移动"的矩形；拖中心，整体平移。宿主不需要任何形状数学。
 *
 * @param shape - 原形状。
 * @param handle - `shapeHandles(shape)` 的下标。
 * @param to - 目标点（草图局部坐标，已含吸附结果）。
 * @returns 写回后的形状。
 * @throws SketchShapeError 手柄越界 / 该形状不支持这种拖拽 / 拖成退化几何。
 */
export function dragShapeHandle(shape: SketchShape, handle: number, to: Pt2): SketchShape {
  const handles = shapeHandles(shape)
  const h = handles[handle]
  if (!h) {
    throw new SketchShapeError(
      'E_SKETCHC_SHAPE_EDIT_MISMATCH',
      `handle ${handle} out of range for ${shape.kind} (${handles.length} handles)`,
    )
  }
  const center = shapeCenter(shape)
  switch (shape.kind) {
    case 'rect': {
      if (h.kind === 'center') {
        return { ...shape, cx: to[0], cy: to[1] }
      }
      if (h.kind === 'corner') return dragRectCorner(shape, handle, to)
      return dragRectEdge(shape, handle - 4, to)
    }
    case 'circle': {
      if (h.kind === 'center') return { ...shape, cx: to[0], cy: to[1] }
      const r = Math.hypot(to[0] - center[0], to[1] - center[1])
      if (!(r > 0)) badParam('circle drag collapsed the radius to 0')
      return { ...shape, r }
    }
    case 'ellipse': {
      if (h.kind === 'center') return { ...shape, cx: to[0], cy: to[1] }
      if (handle === 1) {
        const rx = Math.abs(to[0] - center[0])
        if (!(rx > 0)) badParam('ellipse drag collapsed rx to 0')
        return { ...shape, rx }
      }
      const ry = Math.abs(to[1] - center[1])
      if (!(ry > 0)) badParam('ellipse drag collapsed ry to 0')
      return { ...shape, ry }
    }
    case 'polygon': {
      if (h.kind === 'center') return { ...shape, cx: to[0], cy: to[1] }
      const r = Math.hypot(to[0] - center[0], to[1] - center[1])
      if (!(r > 0)) badParam('polygon drag collapsed the circumradius to 0')
      const k = handle - 1
      let angle = Math.atan2(to[1] - center[1], to[0] - center[0]) - (k * 2 * Math.PI) / shape.n
      while (angle <= -Math.PI) angle += Math.PI * 2
      while (angle > Math.PI) angle -= Math.PI * 2
      return { ...shape, r, angle }
    }
    case 'slot':
    case 'roundedRect':
    case 'trapezoid':
      if (h.kind === 'center') return { ...shape, cx: to[0], cy: to[1] }
      return editUnsupported(shape, `${h.kind} handle`)
    case 'line': {
      if (h.kind === 'start') return { ...shape, from: [to[0], to[1]] }
      if (h.kind === 'end') return { ...shape, to: [to[0], to[1]] }
      // 中点 = 整体平移（保持长度与方向）。
      return { ...shape, from: translatePoint(shape.from, h.point, to), to: translatePoint(shape.to, h.point, to) }
    }
    case 'arc': {
      if (h.kind === 'center') return { ...shape, cx: to[0], cy: to[1] }
      const r = Math.hypot(to[0] - shape.cx, to[1] - shape.cy)
      if (!(r > 0)) badParam('arc drag collapsed the radius to 0')
      if (h.kind === 'mid') return { ...shape, r }
      const angle = Math.atan2(to[1] - shape.cy, to[0] - shape.cx)
      return h.kind === 'start' ? { ...shape, r, a0: angle } : { ...shape, r, a1: angle }
    }
    case 'bspline': {
      const pts = shape.pts.map((p, i) => (i === handle ? ([to[0], to[1]] as Pt2) : p))
      return { ...shape, pts }
    }
    case 'point':
      return { ...shape, x: to[0], y: to[1] }
    case 'close':
      return editUnsupported(shape, 'handle')
  }
}

/** 宿主 UI 的「派生几何控制点」语义（与 3d_editor `sketch-draft.ts#ControlPointKind` 对齐）。 */
export type GeomControl = 'start' | 'end' | 'mid' | 'center' | 'radius'

/**
 * 把「派生几何上的某个控制点」翻译成形状手柄下标——宿主不知道任何形状数学，
 * 只做 `tag → 形状 + 形状内几何下标` 的查表。
 *
 * 罐头形状的派生几何顺序与展开一致（见 `expandShapes` 注释）：
 * - `rect` / `roundedRect` 的线：第 k 条线 = 角 k → 角 k+1（`start`/`end`/`mid` 一一对应）；
 * - 其余罐头形状的切线点/圆心等控制点与形状定义参数不是一一对应（拖它意味着改哪个
 *   参数并不唯一），本版本显式报不支持——宁可拖不动，也不静默变形。
 *
 * @param shape - 该几何所属的形状。
 * @param geomIndexInShape - 该几何在形状展开结果里的下标。
 * @param control - 控制点语义。
 * @returns `shapeHandles(shape)` 的下标。
 * @throws SketchShapeError 该组合不支持拖拽。
 */
export function handleForGeomControl(
  shape: SketchShape,
  geomIndexInShape: number,
  control: GeomControl,
): number {
  const corners = (): number => {
    if (control === 'mid') return 4 + geomIndexInShape
    return control === 'start' ? geomIndexInShape : (geomIndexInShape + 1) % 4
  }
  switch (shape.kind) {
    case 'rect':
      return corners()
    case 'roundedRect':
      // 弧的切点/圆心与形状定义参数不是一一对应（拖它意味着改 w/d/r 并不唯一）；
      // 直边虽然有序，但拖动会牵动圆角——v1 只给中心手柄（`shapeHandles`）。
      return editUnsupported(shape, `${control} handle`)
    case 'polygon':
      if (control === 'mid') return editUnsupported(shape, 'mid on an edge')
      return control === 'start' ? 1 + geomIndexInShape : 1 + ((geomIndexInShape + 1) % shape.n)
    case 'line':
      return control === 'start' ? 0 : control === 'end' ? 1 : 2
    case 'arc':
      switch (control) {
        case 'center': return 0
        case 'start': return 1
        case 'end': return 2
        case 'mid': return 3
        default: return editUnsupported(shape, `${control} on an arc`)
      }
    case 'circle':
      return control === 'center' ? 0 : 1
    case 'point':
      return 0
    case 'bspline':
      return editUnsupported(shape, `${control} (bspline 用 shapeHandles 直接取控制点)`)
    case 'ellipse':
    case 'slot':
    case 'trapezoid':
    case 'close':
      return editUnsupported(shape, `${control} handle`)
  }
}

/**
 * 形状的自带约束里引用了哪些 tag（宿主删形状时用来级联清理自己的约束）。
 * @param constraint - 待提取引用的约束。type:SketchConstraint required:true
 * @returns string[] 约束值里出现的全部 tag（可能为空数组）。
 */
export function refsOfConstraint(constraint: SketchConstraint): string[] {
  const out: string[] = []
  for (const value of Object.values(constraint)) {
    const ref = value as Ref | undefined
    if (ref && typeof ref === 'object' && 'tag' in ref && typeof ref.tag === 'string') out.push(ref.tag)
  }
  return out
}
