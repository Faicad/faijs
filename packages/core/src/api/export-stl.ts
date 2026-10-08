/**
 * api exportStl — STL 导出（中立 op：纯数据序列化，无内核调用）
 *
 * 中立性的判据（方案 §4.4 决策树）：实现**不触达任何引擎** —— 它只读 faijs Shape
 * 自带的三角载荷（`positions` / `indices`），不 import `occt-kernel/*` 或
 * `brepkit-kernel/*`。mesh 链路与 brep 链路的 Shape 都带该载荷（brep 侧由
 * `solidToShape` 即时三角化填好），故两条链路同一份实现，无引擎分支。
 *
 * 为什么不是平台 op：occt-wasm 有原生 `exportStl`，但本仓的 BREP 三角化统一走
 * L1 `meshShape`（`brep/brep-ops.ts` 的 `solidToShape`）——Shape 上的载荷就是当前
 * 用户看到的 mesh（规则 1）。走原生 `exportStl` 会**二次三角化**，产出与显示/拓扑
 * 不一致的第二份 mesh。这里复用现有唯一序列化器
 * `brep/export/stl.ts#buildStlBufferFromMesh`（宿主导出链同一真值来源）。
 *
 * 与既有能力的分工（方案 §4.5 去重表）：`import_brep` / `import_step` 是**导入**侧；
 * 本 op 是导出侧，与宿主 `exportModel('stl')` 同一序列化器，脚本面因此首次拿到
 * 「导入 ↔ 导出」成对能力。
 *
 * **宿主门**：本 op 只在 `'node'` 宿主开放。`.fai.js` 可由 AI 生成任意代码、属
 * 不受信输入，导出把「往哪写、写几份、写什么」的决定权交给脚本文本；浏览器 /
 * 小程序里要导出模型必须由宿主入口触发（按钮或库面字节通道）。门禁写在函数体
 * 第一行（`assertHostFor`），因此脚本面与库面直连同一函数都被同一门禁覆盖，
 * 且门在读取 Shape 载荷之前。见 `cad-runtime/ports.ts#HostEnv`。
 */

import type { Shape } from '../mesh/types'
import { buildStlBufferFromMesh, bakeMatrix12ToPositions } from '../brep/export/stl'
import { transformToMatrix12 } from '../brep/export/export-model'
import { assertHostFor } from './internal/l3-bridge'

/** `cad.exportStl` 选项。 */
export interface ExportStlOptions {
  /**
   * `true` → 返回 **ASCII** STL 文本；缺省/`false` → 返回 **binary** STL 字节
   * （`Uint8Array`，84 + 50×三角形数 字节）。
   */
  ascii?: boolean
  /** 实体名（ASCII 形态的 `solid <name>` / binary 形态的 80 字节头；缺省 'Faicad STL'）。 */
  name?: string
}

/** 校验输入 Shape 带可用的三角载荷。 */
function meshOf(shape: Shape): { positions: Float32Array; indices: Uint32Array } {
  const positions = shape?.positions
  const indices = shape?.indices
  if (!positions || !indices) {
    throw new Error('E_EXPORT_STL_NO_MESH: exportStl requires a shape carrying mesh payload')
  }
  if (indices.length === 0) {
    throw new Error('E_EXPORT_STL_EMPTY: shape has no triangles to export')
  }
  return { positions, indices }
}

/** 单位化叉积法向（退化三角形给 0 向量，与二进制形态同一规则）。 */
function facetNormal(
  positions: Float32Array,
  ia: number,
  ib: number,
  ic: number,
): [number, number, number] {
  const ax = positions[ia * 3]!
  const ay = positions[ia * 3 + 1]!
  const az = positions[ia * 3 + 2]!
  const ux = positions[ib * 3]! - ax
  const uy = positions[ib * 3 + 1]! - ay
  const uz = positions[ib * 3 + 2]! - az
  const vx = positions[ic * 3]! - ax
  const vy = positions[ic * 3 + 1]! - ay
  const vz = positions[ic * 3 + 2]! - az
  let nx = uy * vz - uz * vy
  let ny = uz * vx - ux * vz
  let nz = ux * vy - uy * vx
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
  if (len > 0) {
    nx /= len
    ny /= len
    nz /= len
  }
  return [nx, ny, nz]
}

/** ASCII STL 文本（与二进制形态同一批三角形、同一法向规则；坐标以 mm 写出）。 */
function asciiStl(
  positions: Float32Array,
  indices: Uint32Array,
  name: string,
  transform?: number[],
): string {
  const pos = transform ? bakeMatrix12ToPositions(positions, transform) : positions
  const out: string[] = [`solid ${name}`]
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i]!
    const ib = indices[i + 1]!
    const ic = indices[i + 2]!
    const [nx, ny, nz] = facetNormal(pos, ia, ib, ic)
    out.push(`  facet normal ${nx} ${ny} ${nz}`, '    outer loop')
    for (const v of [ia, ib, ic]) {
      out.push(
        `      vertex ${pos[v * 3]!} ${pos[v * 3 + 1]!} ${pos[v * 3 + 2]!}`,
      )
    }
    out.push('    endloop', '  endfacet')
  }
  out.push(`endsolid ${name}`)
  return out.join('\n')
}

/**
 * 导出 STL（二进制 / ASCII 双形态）。
 * @group 导出
 * @inputs 1
 * @async false
 * @qual ok
 * @name exportStl
 * @note 中立 op：只序列化 Shape 自带的三角载荷（brep 与 mesh 链路同一份实现），
 *       不走原生二次三角化，产物与显示 mesh 逐三角形一致。空 mesh（如
 *       `cad.halfSpace` 产的无界体）显式报 E_EXPORT_STL_EMPTY，不返回空文件。
 *       返回值是**纯数据**（二进制 `Uint8Array` 或 ASCII 文本），由宿主写入文件。
 *       **宿主门**：仅 `'node'` 宿主可执行；browser / weapp / 未声明宿主报
 *       E_HOST_UNSUPPORTED（门在读取载荷之前），浏览器与小程序里导出走宿主入口。
 * @returns Uint8Array 二进制 STL 字节；`options.ascii === true` 时返回 ASCII 文本 string。
 * @param shape - 目标几何（brep 或 mesh 链路的 Shape）。type:Shape required:true
 * @param options.ascii - true = ASCII STL 文本，缺省 = 二进制。type:boolean
 * @param options.name - 实体名（缺省 'Faicad STL'）。type:string
 * @example
 * const bytes = cad.exportStl(part0)
 * const text = cad.exportStl(part0, { ascii: true, name: 'bracket' })
 */
export function exportStl(shape: Shape, options?: ExportStlOptions): Uint8Array | string {
  // 宿主门在实现体最前：非 node 宿主（browser / weapp / 未声明）一律先报
  // E_HOST_UNSUPPORTED，不读取 Shape 载荷、不产任何字节。
  assertHostFor('exportStl', ['node'])
  const { positions, indices } = meshOf(shape)
  const name = options?.name ?? 'Faicad STL'
  // 顶点烘焙（方案 §2.1 / §5 步骤 5）：Shape.transform 写回的位姿在此烘焙进每个顶点。
  // 坐标仍一律以 mm 写出（与宿主 exportModel('stl') 的 unit 语义一致，单位换算在宿主侧完成）。
  const tf = shape.transform ? transformToMatrix12(shape.transform) : null
  if (options?.ascii === true) return asciiStl(positions, indices, name, tf ?? undefined)
  return new Uint8Array(buildStlBufferFromMesh(positions, indices, name, tf ?? undefined))
}
