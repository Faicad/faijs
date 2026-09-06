/**
 * preview-exec — 预览（dry-run）执行上下文
 *
 *
 * 供宿主「预览/干跑」直接调用 stdlib 库函数（drill/engrave/...）时使用的兼容上下文：
 * - mode 固定为 'mesh'：dispatchPath 静态判定走 mesh 路径（预览输入是 mesh Shape，非 BREP solid）。
 * - getSolid/setSolid 只读写恒等槽（identity slot），不写 ctx/output/params。
 * - 不持有持久 solidCache / statementCache，不产生任何副作用。
 *
 * 与正常执行（CadRuntime 主执行路径）的区别：预览 exec 是纯几何计算，
 * 结果与最终 commit 用同一 op（stdlib 库函数），保证「预览 == 执行结果」。
 */

import type { BrepChainState } from '../brep/brep-chain'
import type { HostPorts } from './ports'
import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import { getSlot, ensureSlot } from '../shape'

/**
 * 预览 exec：宿主直调 stdlib 的兼容上下文。
 * P5 起 stdlib 已不收 exec（库函数签名 = 源码形态），字段仅作兼容保留。
 */
export interface PreviewExec {
  readonly mode: 'mesh'
  readonly brepChain: BrepChainState
  readonly ports: HostPorts
  readonly kernels: { brep: null; csg?: HostPorts['csg']; sdf?: HostPorts['sdf'] }
  readonly getSolid: (shape: Shape) => BrepHandle | undefined
  readonly setSolid: (shape: Shape, solid: BrepHandle) => void
  readonly getFaceEvolution: (shape: Shape) => Map<number, number[]> | undefined
  readonly setFaceEvolution: (shape: Shape, evo: Map<number, number[]>) => void
  readonly dependentsOf: () => Shape[]
  readonly touch: () => void
  readonly keep: () => void
  readonly keepHidden: () => void
  readonly fonts: HostPorts['fonts']
  readonly texture: HostPorts['texture']
  readonly assets: HostPorts['assets']
  readonly events: HostPorts['events']
}

/** 空事件接收器（预览无宿主事件通知需求）。 */
function noopEventSink(): { emit: () => void } {
  return { emit: () => {} }
}

/**
 * 创建预览执行上下文。
 *
 * @param ports 可选 HostPorts（csg/sdf/fonts/assets 透传；events 缺省为 no-op）。
 * @returns PreviewExec — mode='mesh'、occt=null、只读写恒等槽的兼容上下文。
 */
export function createPreviewExec(ports?: Partial<HostPorts>): PreviewExec {
  const fullPorts: HostPorts = { ...ports, events: ports?.events ?? noopEventSink() as HostPorts['events'] }
  const brepChain: BrepChainState = {
    solidCache: new Map(),
    kernel: null,
    faceEvolutionCache: new Map(),
    roleTableCache: new Map(),
    meshShapeCache: new Map(),
  }

  return {
    mode: 'mesh',
    kernels: {
      brep: null,
      csg: fullPorts.csg,
      sdf: fullPorts.sdf,
    },
    getSolid: (shape: Shape): BrepHandle | undefined => getSlot(shape)?.solid as BrepHandle | undefined,
    setSolid: (shape: Shape, solid: BrepHandle): void => {
      ensureSlot(shape).solid = solid
    },
    getFaceEvolution: (shape: Shape) => getSlot(shape)?.faceEvolution,
    setFaceEvolution: (shape: Shape, evo: Map<number, number[]>): void => {
      ensureSlot(shape).faceEvolution = evo
    },
    dependentsOf: () => [],
    touch: () => {},
    // 预览无 internalKeep 登记（函数体 keep 声明在预览场景无消费方）
    keep: () => {},
    keepHidden: () => {},
    fonts: fullPorts.fonts,
    texture: fullPorts.texture,
    assets: fullPorts.assets,
    events: fullPorts.events,
    brepChain,
    ports: fullPorts,
  }
}
