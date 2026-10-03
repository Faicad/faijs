/**
 * op — the `cad.sketch` script-face op (sketch geometry + constraints → face).
 *
 * This op is provided by the sketch library, not core: a host merges it into
 * the `cad` namespace (see `./namespace`) only when it wants sketch support.
 * The planegcs solver is host-injected (`installSketchSolver`) because the wasm
 * source differs between Node and browser hosts — the library itself never
 * imports `node:*`.
 */
import { defineOp } from '@faicad/faijs/sdk'
import type { Provenance } from '@faicad/faijs/topology/naming'
import type { Shape } from '@faicad/faijs/mesh/types'
import type { SketchConstraint, SketchGeom, SolveOutcome } from './canonical.js'
import { sketchFaces } from './faces.js'
import { expandShapes, type SketchShape } from './shapes.js'
import type { SketchSolver } from './solver.js'

/** The op name `cad.sketch`. */
export const SKETCH_OP_NAME = 'sketch' as const

let solverFactory: (() => Promise<SketchSolver>) | undefined
let diagnosticSink: ((outcome: SolveOutcome) => void) | undefined

/**
 * Install the host's planegcs solver factory.
 *
 * Node hosts pass `createNodePlanegcsSolver` from `@faicad/faijs-sketch/node`;
 * browser hosts pass a factory that resolves the wasm bytes through
 * `HostPorts.assets` and calls `createPlanegcsSolver({ wasmBytes })`.
 *
 * @param factory - async factory returning a `SketchSolver`.
 */
export function installSketchSolver(factory: () => Promise<SketchSolver>): void {
  solverFactory = factory
}

/** Undo {@link installSketchSolver}. */
export function uninstallSketchSolver(): void {
  solverFactory = undefined
}

/**
 * Install a diagnostics sink for non-`solved` outcomes (§5: allow ≠ silent).
 *
 * Hosts bridge this to their `HostPorts.events` sink / UI. Under-, redundant-
 * and conflicting-constraint sketches still produce geometry, but the
 * diagnostic must reach the host.
 *
 * @param sink - receives every non-`solved` solve outcome; `null` clears it.
 */
export function setSketchDiagnosticSink(sink: ((outcome: SolveOutcome) => void) | null): void {
  diagnosticSink = sink ?? undefined
}

/** `cad.sketch` parameters. */
export interface SketchParams {
  /**
   * 语义图元清单（**与 `geoms` 二选一**）：矩形/圆/圆角矩形/椭圆/正多边形/长圆槽/梯形
   * + 画笔图元（线/弧/样条/点）+ `close`。脚本面推荐这一形态——"画矩形"在语句里
   * 就是矩形，而不是 4 条线 + 8 条约束（铺开由库面 `expandShapes` 一处负责）。
   */
  shapes?: SketchShape[]
  /** 展开后的 canonical 几何（**与 `shapes` 二选一**；存量语句继续用这一形态）。 */
  geoms?: SketchGeom[]
  /** Optional — a constraint-free sketch is equivalent to `cad.profile` usage. */
  constraints?: SketchConstraint[]
  /** Product form: `'face'` (default) or `'wire'` (outer wire for sweep spines). */
  as?: 'face' | 'wire'
  /**
   * Named plane (`'XY'` default; e.g. `'XZ'` / `'YZ'`) or an explicit plane
   * frame (A3, 2026-09-28): `{ origin, normal, xAxis? }` — places the solved
   * contours on an arbitrary plane in one step (the sketchOnPlane hand-off;
   * no post-hoc `cad.place` needed).
   */
  plane?: string | { origin: [number, number, number]; normal: [number, number, number]; xAxis?: [number, number, number] }
}

/**
 * Validate `cad.sketch` parameters: **exactly one** of `shapes` / `geoms` must be a
 * non-empty array, `constraints` (when present) an array, `plane` a named plane or
 * an explicit frame.
 *
 * @param params - the raw sketch operation parameters.
 */
export function assertSketchParams(params: Record<string, unknown>): void {
  const hasShapes = params.shapes !== undefined
  const hasGeoms = params.geoms !== undefined
  if (hasShapes && hasGeoms) {
    throw new Error(
      'E_SKETCHC_BOTH_ENTRIES: sketch takes either `shapes` (semantic primitives) or `geoms` (expanded geometry), not both',
    )
  }
  const entry = hasShapes ? params.shapes : params.geoms
  if (!Array.isArray(entry) || entry.length === 0) {
    throw new Error('E_SKETCHC_NO_GEOMS: sketch requires at least one geometry')
  }
  if (params.constraints !== undefined && !Array.isArray(params.constraints)) {
    throw new Error('E_SKETCHC_BAD_CONSTRAINTS: constraints must be an array')
  }
  if (params.plane !== undefined && typeof params.plane !== 'string' &&
      (typeof params.plane !== 'object' || params.plane === null ||
        !Array.isArray((params.plane as { origin?: unknown }).origin) ||
        !Array.isArray((params.plane as { normal?: unknown }).normal))) {
    throw new Error('E_SKETCHC_BAD_PLANE: plane must be a named plane string or an explicit frame { origin, normal, xAxis? }')
  }
}

async function resolveSolver(): Promise<SketchSolver> {
  if (!solverFactory) {
    throw new Error('E_SKETCHC_NO_SOLVER: no sketch solver installed (call installSketchSolver)')
  }
  return solverFactory()
}

/**
 * Sketch (semantic shapes / geometry + constraints) → solve → face / outer wire.
 *
 * 两条入口（二选一）：
 * - `shapes`：语义图元（矩形/圆/……/画笔图元/close）→ 库面 `expandShapes` 展开成
 *   canonical 几何 + 形状自带约束，再与调用方给的 `constraints` 合并求解；
 * - `geoms`：直接给展开后的 canonical 几何（存量语句形态）。
 *
 * Permanently brep-only (D5, 2026-09-27): the mesh path reports
 * `E_MESH_UNSUPPORTED`. Sketch APIs never get a mesh path — industry
 * precedent (CadQuery, FreeCAD) solves sketches onto exact BREP edges.
 *
 * @group 创建
 * @inputs 0
 * @async true
 * @qual ok
 * @name sketch
 * @returns Shape 平面几何（求解后构面）；`as:'wire'` 时返回外环 1D 曲线。
 * @param params.shapes - 语义图元清单（与 geoms 二选一）。type:SketchShape[] required:false
 * @param params.geoms - 展开后的草图几何（线段/圆/圆弧，与 shapes 二选一）。type:SketchGeom[] required:false
 * @param params.constraints - 草图约束（可空；追加在形状自带约束之后）。type:SketchConstraint[] required:false
 * @param params.as - 产物形态：'face'（默认）构面；'wire' 只交外环 wire。type:'face'|'wire' required:false
 * @param params.plane - 放置目标命名平面（默认 'XY'；如 'XZ' / 'YZ'）。type:string required:false
 * @example
 * const plate = cad.sketch({
 *   plane: 'XY',
 *   shapes: [
 *     { kind: 'rect', w: 100, d: 60, tag: 'g0' },
 *     { kind: 'circle', r: 10, cx: 30, cy: 20, tag: 'hole', mode: 's' },
 *   ],
 *   constraints: [{ kind: 'length', of: { tag: 'g0.0' }, value: 100 }],
 * })
 * @example
 * const f = cad.sketch({
 *   geoms: [{ tag:'bottom', kind:'line', x1:0, y1:0, x2:80, y2:3 }],
 *   constraints: [{ kind:'horizontal', of: { tag:'bottom' } }, { kind:'length', of: { tag:'bottom' }, value: 80 }],
 * })
 */
export const sketch = defineOp({
  name: SKETCH_OP_NAME,
  capabilities: ['directEdit'],
  async brep(params: Record<string, unknown>): Promise<Shape> {
    assertSketchParams(params)
    const solver = await resolveSolver()
    const p = params as unknown as SketchParams
    const expansion = p.shapes ? expandShapes(p.shapes) : undefined
    const geoms = expansion ? expansion.geoms : p.geoms!
    const constraints = [...(expansion ? expansion.constraints : []), ...(p.constraints ?? [])]
    return sketchFaces(geoms, constraints, {
      solver,
      as: p.as,
      plane: p.plane,
      expectHoles: (expansion?.subtractRanges.length ?? 0) > 0,
      onDiagnostic: (outcome) => {
        if (outcome.status !== 'solved') diagnosticSink?.(outcome)
      },
    })
  },
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [] } } as Provenance,
})