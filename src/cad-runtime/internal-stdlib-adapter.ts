/**
 * internal-stdlib-adapter — 把 stdlib 库函数暴露为 cad 命名空间（VM 执行方案 Phase 2.1）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §1.4
 *
 * 此层是临时的（Phase 2.5 删除）：把 `src/stdlib/*` 的库函数按编译产物的调用形态
 * 转发为 cad 命名空间函数。编译产物调用形态：
 * - 创建类 `cad.<op>(args, exec)`；1 输入类 `cad.<op>(input, args, exec)`；
 * - boolean 多输入 `cad.boolean(input1, input2, args, exec)`；split 返回 { front, back }。
 *
 * 统一用 parseCall 弹 exec + args + inputs，对编译产物的任意输入数量健壮
 * （手工构造的 PartScript 可能给创建类 op 传多余输入，库函数忽略多余 inputGeometries）。
 *
 * mesh-only op（sdf/knurl）在 auto 模式发 part-brep-lost 事件（与旧 runtime 一致）；
 * brep 模式的不支持错误由库函数内部 resolvePath 抛出（BrepUnsupportedError → failedAt）。
 */

import type { Shape, Vec3 } from '../mesh/types'
import type { GeomRef } from '../lang/types'
import type { PartName } from '../identity'
import { asPartName } from '../identity'
import { resolveGeomRef } from '../ops/geom-ref'
import { box, sphere, cylinder, cone, wedge } from '../stdlib/primitives'
import { translate, rotate, scale } from '../stdlib/transform'
import { extrude } from '../stdlib/extrude'
import { knurl } from '../stdlib/knurl'
import { sdf } from '../stdlib/sdf'
import { text } from '../stdlib/text'
import { screw } from '../stdlib/screw'
import { svgExtrude } from '../stdlib/svgExtrude'
import { load } from '../stdlib/load'
import { drill } from '../stdlib/drill'
import { split } from '../stdlib/split'
import { boolean as booleanOp } from '../stdlib/boolean'
import { engrave } from '../stdlib/engrave'
import type { ExecContextImpl, StdlibNamespace } from './exec-context'

// ── 空 Shape（group/assembly 结构型语句的 Phase 2.1 产物；Phase 2.4 迁 compound） ──

function emptyShape(): Shape {
  return { positions: new Float32Array(0), indices: new Uint32Array(0) }
}

/** 解析编译产物调用：末参 exec，倒数第二参 args，其余为 inputs。 */
function parseCall(rest: unknown[]): { exec: ExecContextImpl; args: Record<string, unknown>; inputs: Shape[] } {
  const exec = rest.pop() as ExecContextImpl
  const args = (rest.pop() ?? {}) as Record<string, unknown>
  const inputs = rest as Shape[]
  return { exec, args, inputs }
}

/** auto 模式 mesh-only op：发 part-brep-lost 事件。 */
function emitBrepLost(exec: ExecContextImpl, op: string): void {
  const stmt = exec.currentStmt
  exec.ports.events.emit('part-brep-lost', {
    partName: asPartName(stmt?.id ?? ''),
    op,
    reason: 'mesh-only op output',
  })
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
 * 创建内部适配命名空间（Phase 2.1：转发 stdlib 库函数；Phase 2.5 由正式 stdlib 子路径替代）。
 */
export function createInternalStdlib(): StdlibNamespace {
  return {
    // ── 创建（无输入） ──
    box: (...rest) => { const { exec, args } = parseCall(rest); return box(args, exec) },
    sphere: (...rest) => { const { exec, args } = parseCall(rest); return sphere(args, exec) },
    cylinder: (...rest) => { const { exec, args } = parseCall(rest); return cylinder(args, exec) },
    cone: (...rest) => { const { exec, args } = parseCall(rest); return cone(args, exec) },
    wedge: (...rest) => { const { exec, args } = parseCall(rest); return wedge(args, exec) },
    text: (...rest) => { const { exec, args } = parseCall(rest); return text(args, exec) },
    screw: (...rest) => { const { exec, args } = parseCall(rest); return screw(args, exec) },
    svgExtrude: (...rest) => { const { exec, args } = parseCall(rest); return svgExtrude(args, exec) },
    sdf: (...rest) => {
      const { exec, args } = parseCall(rest)
      if (exec.mode === 'auto') emitBrepLost(exec, 'sdf')
      return sdf(args, exec)
    },
    load: (...rest) => { const { exec, args } = parseCall(rest); return load(args, exec) },

    // ── 变换（1 输入） ──
    translate: (...rest) => { const { exec, args, inputs } = parseCall(rest); return translate(inputs[0], args, exec) },
    rotate: (...rest) => { const { exec, args, inputs } = parseCall(rest); return rotate(inputs[0], args, exec) },
    scale: (...rest) => { const { exec, args, inputs } = parseCall(rest); return scale(inputs[0], args, exec) },

    // ── 特征（1 输入） ──
    drill: (...rest) => { const { exec, args, inputs } = parseCall(rest); return drill(inputs[0], args, exec) },
    extrude: (...rest) => { const { exec, args, inputs } = parseCall(rest); return extrude(inputs[0], args, exec) },
    engrave: (...rest) => { const { exec, args, inputs } = parseCall(rest); return engrave(inputs[0], args, exec) },
    knurl: (...rest) => {
      const { exec, args, inputs } = parseCall(rest)
      if (exec.mode === 'auto') emitBrepLost(exec, 'knurl')
      return knurl(inputs[0], args, exec)
    },

    // ── 布尔（多输入，末两参为 args + exec） ──
    boolean: (...rest) => booleanOp(...rest),

    // ── split（1 输入，返回 { front, back }） ──
    split: (...rest) => { const { exec, args, inputs } = parseCall(rest); return split(inputs[0], args, exec) },

    // ── 结构型（Phase 2.1：空 Shape；装配 pass 走旧路径） ──
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
