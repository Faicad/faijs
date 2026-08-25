/**
 * internal-stdlib-adapter — 把现有 dispatcher case 包装为 cad 命名空间函数（VM 执行方案 Phase 1）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §1.4
 *
 * 此层是临时的（Phase 2 删除）：把 `src/ops/*` 的每个 executeXxx(ctx) 包装成
 * `(inputs..., args, exec) => Promise<Shape>` 形态的函数对象，作为 `cad` 注入
 * ModuleExecutor。它让 VM 执行先行落地，但引擎仍通过 OpContext 触达 op 实现。
 *
 * 关键点：
 * - 直接调用 executeXxx（而非 dispatcher.executeStatement）——编译产物已把
 *   $param/$geom/$asset 翻译为 JS 表达式，args 是已解析值，不能再走 resolveArgs。
 * - OpContext 从 exec.currentStmt（ModuleExecutor 在调用 fn 前设置）+ 位置参数构建。
 * - split 返回 { front, back }（executeSplit 已把双输出写入 outputCache）。
 * - group/assembly 返回空 Shape（Phase 1 结构型语句，装配 pass 走旧路径）。
 * - $geom 查询函数（faceCenter 等）末参 exec，内部复用 resolveGeomRef 解析链。
 */

import type { Shape, Vec3 } from '../mesh/types'
import type { GeomRef } from '../lang/types'
import type { PartName } from '../identity'
import type { OpContext } from '../ops/types'
import { executePrimitive } from '../ops/primitives'
import { executeTransform } from '../ops/transform'
import { executeDrill } from '../ops/drill'
import { executeSplit } from '../ops/split'
import { executeExtrude } from '../ops/extrude'
import { executeBoolean } from '../ops/boolean'
import { executeEngrave } from '../ops/engrave'
import { executeText } from '../ops/text'
import { executeScrew } from '../ops/screw'
import { executeSvgExtrude } from '../ops/svgExtrude'
import { executeKnurl } from '../ops/knurl'
import { executeLoad } from '../ops/load'
import { executeSdf } from '../ops/sdf'
import { resolveGeomRef } from '../ops/geom-ref'
import type { ExecContextImpl, StdlibNamespace } from './exec-context'

// ── 空 Shape（group/assembly 结构型语句的 Phase 1 产物） ──

function emptyShape(): Shape {
  return { positions: new Float32Array(0), indices: new Uint32Array(0) }
}

// ── OpContext 构建 ──

/**
 * 用 exec.currentStmt + 位置参数构建 OpContext 并调用 op 实现。
 *
 * args 是编译产物已解析的值（$param/$geom/$asset 已翻译），直接作为 ctx.args。
 */
async function runOp(
  op: string,
  inputs: Shape[],
  args: Record<string, unknown>,
  exec: ExecContextImpl,
  impl: (ctx: OpContext) => Promise<Shape>,
): Promise<Shape> {
  const stmt = exec.currentStmt
  if (!stmt) throw new Error(`[internal-stdlib] ${op}: no current statement`)
  const ctx: OpContext = {
    stmt,
    inputGeometries: inputs,
    outputCache: exec.outputCache,
    args,
    params: exec.params,
    brepChain: exec.brepChain,
    ports: exec.ports,
    mode: exec.mode,
  }
  return impl(ctx)
}

// ── 参数守卫：把未知参数收口为 Record<string, unknown> ──

function asArgs(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>
}

// ── $geom 查询函数 ──

/**
 * geom 查询：`cad.<feature>(of, anchor?, ordinal?, exec)`。
 * 末参 exec；内部复用 resolveGeomRef（faceOrdinal+BREP 优先 → anchor 反查 → 报错）。
 */
function geomQuery(feature: GeomRef['$geom']['feature'], rest: unknown[]): Vec3 {
  const exec = rest.pop() as ExecContextImpl
  const of = rest[0] as Shape
  const anchor = rest[1] as Vec3 | undefined
  const faceOrdinal = rest[2] as number | undefined
  const name = exec.shapeToName.get(of)
  const ref: GeomRef = {
    $geom: {
      of: (name ?? '') as PartName,
      feature,
      anchor: anchor ? { point: anchor } : undefined,
      faceOrdinal,
    },
  }
  return resolveGeomRef(
    ref,
    () => of,
    name ? (id) => exec.brepChain.solidCache.get(id) : undefined,
    exec.brepChain.kernel ?? undefined,
  )
}

// ── $asset 查询函数 ──

/** `cad.asset(key, exec)`：经 exec.assets 解析为 UTF-8 字符串（SVG 等文本资产）。 */
async function assetQuery(key: string, exec: ExecContextImpl): Promise<string> {
  if (!exec.assets) {
    throw new Error(`[internal-stdlib] asset "${key}" cannot be resolved: exec.assets not available`)
  }
  const result = await exec.assets.resolveByKey(key)
  return new TextDecoder('utf-8').decode(new Uint8Array(result.bytes))
}

// ── 创建 cad 命名空间 ──

/**
 * 创建内部适配命名空间（Phase 1 临时；Phase 2 由 src/stdlib 正式库函数替代）。
 */
export function createInternalStdlib(): StdlibNamespace {
  return {
    // ── 创建（无输入） ──
    box: (args, e) => runOp('box', [], asArgs(args), e as ExecContextImpl, executePrimitive),
    sphere: (args, e) => runOp('sphere', [], asArgs(args), e as ExecContextImpl, executePrimitive),
    cylinder: (args, e) => runOp('cylinder', [], asArgs(args), e as ExecContextImpl, executePrimitive),
    cone: (args, e) => runOp('cone', [], asArgs(args), e as ExecContextImpl, executePrimitive),
    wedge: (args, e) => runOp('wedge', [], asArgs(args), e as ExecContextImpl, executePrimitive),
    text: (args, e) => runOp('text', [], asArgs(args), e as ExecContextImpl, executeText),
    screw: (args, e) => runOp('screw', [], asArgs(args), e as ExecContextImpl, executeScrew),
    svgExtrude: (args, e) => runOp('svgExtrude', [], asArgs(args), e as ExecContextImpl, executeSvgExtrude),
    sdf: (args, e) => runOp('sdf', [], asArgs(args), e as ExecContextImpl, executeSdf),
    load: (args, e) => runOp('load', [], asArgs(args), e as ExecContextImpl, executeLoad),

    // ── 变换（1 输入） ──
    translate: (input, args, e) => runOp('translate', [input as Shape], asArgs(args), e as ExecContextImpl, executeTransform),
    rotate: (input, args, e) => runOp('rotate', [input as Shape], asArgs(args), e as ExecContextImpl, executeTransform),
    scale: (input, args, e) => runOp('scale', [input as Shape], asArgs(args), e as ExecContextImpl, executeTransform),

    // ── 特征（1 输入） ──
    drill: (input, args, e) => runOp('drill', [input as Shape], asArgs(args), e as ExecContextImpl, executeDrill),
    extrude: (input, args, e) => runOp('extrude', [input as Shape], asArgs(args), e as ExecContextImpl, executeExtrude),
    engrave: (input, args, e) => runOp('engrave', [input as Shape], asArgs(args), e as ExecContextImpl, executeEngrave),
    knurl: (input, args, e) => runOp('knurl', [input as Shape], asArgs(args), e as ExecContextImpl, executeKnurl),

    // ── 布尔（多输入，末两参为 args + exec） ──
    boolean: async (...rest: unknown[]) => {
      const exec = rest.pop() as ExecContextImpl
      const args = asArgs(rest.pop())
      const inputs = rest as Shape[]
      return runOp('boolean', inputs, args, exec, executeBoolean)
    },

    // ── split（1 输入，返回 { front, back }） ──
    split: async (input, args, e) => {
      const exec = e as ExecContextImpl
      const stmt = exec.currentStmt
      if (!stmt) throw new Error('[internal-stdlib] split: no current statement')
      const outputs = stmt.outputs ?? []
      const primary = await runOp('split', [input as Shape], asArgs(args), exec, executeSplit)
      const front = outputs[0] ? (exec.outputCache.get(outputs[0]) ?? primary) : primary
      const back = outputs[1] ? (exec.outputCache.get(outputs[1]) ?? primary) : primary
      return { front, back }
    },

    // ── 结构型（Phase 1：空 Shape；装配 pass 走旧路径） ──
    group: (_args, _e) => emptyShape(),
    assembly: (_args, _e) => emptyShape(),

    // ── $geom 查询（末参 exec） ──
    faceCenter: (...rest) => geomQuery('faceCenter', rest),
    faceNormal: (...rest) => geomQuery('faceNormal', rest),
    bboxCenter: (...rest) => geomQuery('bboxCenter', rest),
    bboxMin: (...rest) => geomQuery('bboxMin', rest),
    bboxMax: (...rest) => geomQuery('bboxMax', rest),

    // ── $asset 查询 ──
    asset: (key, e) => assetQuery(key as string, e as ExecContextImpl),
  }
}
