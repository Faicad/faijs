/**
 * preview-exec — 预览（dry-run）执行上下文
 *
 * 设计文档：docs/plans/2026-08-26-phase2-followup-plan.md §5 T8
 *
 * 供宿主「预览/干跑」直接调用 stdlib 库函数（drill/engrave/...）时使用的最小 ExecContext：
 * - mode 固定为 'mesh'：resolvePath 静态判定走 mesh 路径（预览输入是 mesh Shape，非 BREP solid）。
 * - getSolid/setSolid 只读写恒等槽（identity slot），不写 ctx/output/params。
 * - 不持有持久 solidCache / statementCache，不产生任何副作用。
 *
 * 与正常执行（CadRuntime.createExecContext）的区别：预览 exec 是纯几何计算，
 * 结果与最终 commit 用同一 op（stdlib 库函数），保证「预览 == 执行结果」。
 */

import type { ExecContext } from './exec-context'
import type { BrepChainState } from '../brep/brep-chain'
import type { HostPorts } from './ports'
import type { Shape } from '../mesh/types'
import type { ShapeHandle } from 'occt-wasm'
import { getSlot, ensureSlot } from '../stdlib/shape'

/** 预览 exec：在 ExecContext 之上附带 brepChain/ports（stdlib 经 `as ExecContextImpl` 访问）。 */
export interface PreviewExec extends ExecContext {
  readonly brepChain: BrepChainState
  readonly ports: HostPorts
}

/** 空事件接收器（预览无宿主事件通知需求）。 */
function noopEventSink(): { emit: () => void } {
  return { emit: () => {} }
}

/**
 * 创建预览执行上下文。
 *
 * @param ports 可选 HostPorts（csg/sdf/fonts/assets 透传；events 缺省为 no-op）。
 * @returns PreviewExec — mode='mesh'、occt=null、只读写恒等槽的最小 ExecContext。
 */
export function createPreviewExec(ports?: Partial<HostPorts>): PreviewExec {
  const fullPorts: HostPorts = { ...ports, events: ports?.events ?? noopEventSink() as HostPorts['events'] }
  const brepChain: BrepChainState = {
    solidCache: new Map(),
    kernel: null,
    faceEvolutionCache: new Map(),
    meshShapeCache: new Map(),
  }

  return {
    mode: 'mesh',
    kernels: {
      occt: null,
      csg: fullPorts.csg,
      sdf: fullPorts.sdf,
    },
    getSolid: (shape: Shape): ShapeHandle | undefined => getSlot(shape)?.solid,
    setSolid: (shape: Shape, solid: ShapeHandle): void => {
      ensureSlot(shape).solid = solid
    },
    getFaceEvolution: (shape: Shape) => getSlot(shape)?.faceEvolution,
    setFaceEvolution: (shape: Shape, evo: Map<number, number[]>): void => {
      ensureSlot(shape).faceEvolution = evo
    },
    dependentsOf: () => [],
    touch: () => {},
    fonts: fullPorts.fonts,
    texture: fullPorts.texture,
    assets: fullPorts.assets,
    events: fullPorts.events,
    brepChain,
    ports: fullPorts,
  }
}
