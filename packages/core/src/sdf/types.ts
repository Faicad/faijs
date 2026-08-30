/** SDF 建模功能的核心类型与 @param 注释解析器 */

/** 包围盒（与 manifold-3d 的 Box 一致） */
export interface SdfBox {
  min: [number, number, number]
  max: [number, number, number]
}

/** 用户可调节的参数定义（从 // @param 注释中解析） */
export interface SdfParamDef {
  name: string
  /** 显示标签，不指定时用 name 代替 */
  label?: string
  /** 参数类型：'number'（浮点数，默认）| 'int'（整数） */
  type?: 'number' | 'int'
  default: number
}

/** SDF 模型元信息，挂载在 LoadedFileModel.sdfMeta 上 */
export interface SdfMeta {
  code: string
  params: Record<string, number>
  paramDefs: SdfParamDef[]
  edgeLength: number
  level: number
  tolerance: number
  bounds: SdfBox
  /** 模型显示名称（来源于模板名或自定义） */
  modelName: string
}

/** 模板分类 */
export type SdfTemplateCategory = 'primitive' | 'periodic' | 'blend' | 'fractal' | 'utility'

/** SDF 模板定义 */
export interface SdfTemplate {
  id: string
  name: string
  category: SdfTemplateCategory
  description: string
  code: string
  defaultBounds: SdfBox
}

/** Worker 输入 */
export interface SdfWorkerInput {
  id: string
  code: string
  params: Record<string, number>
  bounds: [number, number, number, number, number, number] // [xmin,ymin,zmin,xmax,ymax,zmax]
  edgeLength: number
  level: number
  tolerance: number // <0 表示用 manifold 默认
}

/** Worker 输出（与 CSG Worker 的 ManifoldMeshData 一致） */
export interface SdfWorkerResult {
  type: 'result'
  id: string
  positions: Float32Array
  indices: Uint32Array
}

/** Worker error message reporting a failed SDF job. */
export interface SdfWorkerError {
  type: 'error'
  id: string
  message: string
}

/** Worker 进度消息 */
export interface SdfWorkerProgress {
  type: 'progress'
  id: string
  /** 阶段标识：'compile' | 'levelset' | 'extract' | 'done' */
  phase: string
  /** 可读的进度描述 */
  message: string
  /** 累计耗时（毫秒） */
  elapsedMs: number
}

/** Union of all messages a Worker can send for an SDF job. */
export type SdfWorkerMessage = SdfWorkerResult | SdfWorkerError | SdfWorkerProgress

// ── @param 注释解析器 ──────────────────────────────────────────

/**
 * 从 SDF 代码中解析所有 // @param 注释。
 *
 * 格式：// @param <name> <default> [label] [type]
 *
 * - label 省略时用 name 代替
 * - type 省略时默认为 number（支持：number | int）
 *
 * 示例：
 *   // @param radius 10 半径          // label=半径,  type=number
 *   // @param radius 10               // label=radius, type=number
 *   // @param maxIter 20 迭代次数 int  // label=迭代次数, type=int
 *   // @param count 8 int             // label=count,  type=int
 *
 * @param code - the SDF source code to parse.
 * @returns the parsed parameter definitions.
 */
export function parseParamDefs(code: string): SdfParamDef[] {
  const defs: SdfParamDef[] = []
  const lines = code.split('\n')
  const re = /^\s*\/\/\s*@param\s+(.+)$/
  for (const line of lines) {
    const m = line.match(re)
    if (!m) continue
    const tokens = m[1].trim().split(/\s+/)
    if (tokens.length < 2) continue
    const name = tokens[0]
    const defaultVal = Number(tokens[1])
    if (Number.isNaN(defaultVal)) continue
    const rest = tokens.slice(2)
    let label: string | undefined
    let type: SdfParamDef['type'] | undefined
    if (rest.length === 0) {
      // @param name default — label=name, type=number
      label = name
    } else if (rest.length === 1) {
      const t = rest[0]
      if (t === 'number' || t === 'int') {
        // @param name default type — label=name, type=t
        type = t
        label = name
      } else {
        // @param name default label — label=t, type=number
        label = t
      }
    } else {
      // @param name default label type — label=rest[0], type=rest[1]
      label = rest[0]
      if (rest[1] === 'number' || rest[1] === 'int') {
        type = rest[1]
      }
    }
    const def: SdfParamDef = { name, label, type, default: defaultVal }
    defs.push(def)
  }
  return defs
}

/**
 * 根据参数定义生成默认参数值表。
 *
 * @param defs - the parsed parameter definitions.
 * @returns a map of parameter name → default value.
 */
export function defaultParamValues(defs: SdfParamDef[]): Record<string, number> {
  const vals: Record<string, number> = {}
  for (const d of defs) {
    vals[d.name] = d.default as number
  }
  return vals
}

/**
 * 将包围盒转为 worker 输入所需的 6 元组。
 *
 * @param box - the bounding box to convert.
 * @returns the box as [xmin, ymin, zmin, xmax, ymax, zmax].
 */
export function boxToTuple(box: SdfBox): [number, number, number, number, number, number] {
  return [box.min[0], box.min[1], box.min[2], box.max[0], box.max[1], box.max[2]]
}

/**
 * 将 6 元组转为包围盒。
 *
 * @param t - the [xmin, ymin, zmin, xmax, ymax, zmax] tuple.
 * @returns the equivalent bounding box.
 */
export function tupleToBox(t: [number, number, number, number, number, number]): SdfBox {
  return { min: [t[0], t[1], t[2]], max: [t[3], t[4], t[5]] }
}
