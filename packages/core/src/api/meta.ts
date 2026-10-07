/**
 * api/meta — faijs 零件名称/描述/料号 与 整体文件元数据 权威类型与 Shape 方法
 *
 * 定位（与 api/appearance.ts 同款方法模式）：
 * - 名称/描述设置**不是 op**（不进 defineOp/api-namespace/args-schema），是 Shape
 *   实例方法（`box1.setName('…')`，复用 `asm1.solve()` 的成员调用语句形态）。
 * - `ShapeMeta`（零件级）与 `FileMeta`（整体级）引擎无关、JSON 可序列化；
 *   `Shape.meta` 随 Shape 走 mesh/brep 双链路，编辑器/查看器只读字段。
 * - 本文件零依赖（不 import THREE / occt / store）；唯一 import 是 mesh/types
 *   的 `Shape` 类型（type-only），mesh/types 亦只 type-import 本文件的类型，
 *   两者为类型环、无运行时环（值依赖单向：shape.ts → api/meta.ts）。
 *
 * 命名约定（camelCase，faijs 全 TS/JS 生态）：
 * - 零件级：`name` / `description` / `partNumber` / `metadata`（键值）。
 * - 方法：`setName` / `setDescription` / `setPartNumber` / `setMetaField` /
 *   `setMeta` / `getMeta`。字段名与 3MF/STEP 规范一致（不用 note）。
 *   空串 = 清除：`setName('')` 删除 name（与「undefined 不覆盖」互补，用户可
 *   显式去掉继承来的名称）。
 */

import type { Shape } from '../mesh/types'

// ── 类型 ──

/** 零件级说明性元数据 —— 引擎无关、JSON 可序列化、随 Shape 走双链路。 */
export interface ShapeMeta {
  /** 零件名：3MF `<object name>` / STEP `PRODUCT().name`。 */
  name?: string
  /** 描述：STEP `PRODUCT.description`；3MF 写 `faijs:description` metadatagroup。 */
  description?: string
  /** 料号：3MF `<object partnumber>`；STEP `PRODUCT_IDENTIFICATION` 或 UDA。 */
  partNumber?: string
  /**
   * 自定义键值：3MF `<object><metadatagroup>`（vendor 前缀）；STEP UDA。
   * 键为规范/厂商原始名（3MF 含命名空间前缀）；faijs 不解释值语义，
   * 读入保留、写出回写。
   */
  metadata?: Record<string, string>
}

/**
 * 整体/文档级说明性元数据 —— 导入结果 / 导出选项，不挂 Shape。
 *
 * 不叫 `ModelMeta`：CAD 直觉里 "model" 偏单个零件（那是 `ShapeMeta` 的活）；
 * 本类型承载整个交换文件（3MF `<model>` / STEP P21 header）的元数据，故用
 * `FileMeta`。
 */
export interface FileMeta {
  title?: string // 3MF Title / STEP FILE_NAME.name
  description?: string      // 3MF Description / STEP FILE_DESCRIPTION.description
  designer?: string         // 3MF Designer / STEP FILE_NAME.originator
  author?: string           // STEP FILE_NAME.author（3MF 无对应；跨格式不互转）
  organization?: string     // STEP FILE_NAME.organization（3MF 无对应）
  copyright?: string        // 3MF Copyright（STEP 无标准位置）
  licenseTerms?: string     // 3MF LicenseTerms（STEP 无标准位置）
  rating?: string           // 3MF Rating（STEP 无标准位置）
  creationDate?: string     // 3MF CreationDate / STEP FILE_NAME.timestamp
  modificationDate?: string // 3MF ModificationDate（STEP 无标准位置）
  application?: string      // 3MF Application / STEP FILE_NAME.preprocessor
  /** 未知/厂商自定义 metadata 兜底（3MF model 级带前缀名；STEP header 其余字段）。 */
  metadata?: Record<string, string>
}

/** Shape 元数据方法签名（运行时由 attachMetaMethods 挂载；纯数据判定不受影响）。 */
export interface ShapeMetaMethods {
  /** 合并 meta：`{...cur, ...spec}`，spec 中 undefined 字段保留旧值。 */
  setMeta(spec: ShapeMeta): this
  /** 便捷：等价 setMeta({ name })（空串视为清除）。 */
  setName(name: string): this
  /** 便捷：等价 setMeta({ description })（空串视为清除）。 */
  setDescription(description: string): this
  /** 便捷：等价 setMeta({ partNumber }）。 */
  setPartNumber(partNumber: string): this
  /** 便捷：等价 setMeta({ metadata: {...cur.metadata, ...kv} })；值为空串的键删除。 */
  setMetaField(key: string, value: string): this
  /** 读取当前 meta（可能 undefined）。 */
  getMeta(): Readonly<ShapeMeta> | undefined
}

// ── 合并 ──

/**
 * 合并零件级元数据：spec 中 undefined 字段不覆盖旧值；空串覆盖为清除。
 * @param cur 当前 meta（可为 undefined）
 * @param spec 待合并字段（undefined 字段跳过；'' 显式清除）
 * @returns 合并后的 meta（新对象；cur 为 undefined 时仅含 spec 非空字段）
 */
export function mergeMeta(cur: ShapeMeta | undefined, spec: ShapeMeta): ShapeMeta {
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(spec)) {
    if (v === undefined) continue
    if (k === 'metadata' && v && typeof v === 'object') {
      // 键值子合并：保留旧 metadata 的未覆盖键。
      const base: Record<string, string> = { ...((cur?.metadata as Record<string, string> | undefined) ?? {}) }
      for (const [kk, vv] of Object.entries(v as Record<string, string>)) {
        if (vv === '') delete base[kk] // 空串清除该键
        else base[kk] = vv
      }
      clean[k] = base
      continue
    }
    if (v === '') clean[k] = undefined as unknown as string // 空串清除顶层字段
    else clean[k] = v
  }
  const merged = { ...(cur ?? {}), ...clean } as ShapeMeta
  // 清理合并后为 undefined 的顶层键（空串清除写入 undefined）。
  for (const k of Object.keys(merged)) {
    if ((merged as Record<string, unknown>)[k] === undefined) delete (merged as Record<string, unknown>)[k]
  }
  return merged
}

// ── Shape 方法挂载 ──

/**
 * 给 Shape 实例挂载元数据方法（幂等：已有 setMeta 则跳过）。
 *
 * 所有产物构造点（solid/curve → fromBrep/fromMeshSolid/fromBrepCurve）统一
 * 调用本函数，保证 mesh/brep 双支路产物都可用 `box1.setName(...)`。
 * 方法**不序列化**（JSON 丢弃函数）；`meta` 字段随产物跨打印，编辑器/
 * 查看器只读字段即可，不依赖方法。
 * @param shape 产物 Shape 实例（solid/curve 产物）
 * @returns 挂载后的 shape（类型提升为 `Shape & ShapeMetaMethods`；同一实例原地挂载）
 */
export function attachMetaMethods(shape: Shape): Shape & ShapeMetaMethods {
  const s = shape as Shape & ShapeMetaMethods
  if (typeof s.setMeta === 'function') return s
  s.setMeta = function setMeta(this: Shape & ShapeMetaMethods, spec: ShapeMeta) {
    this.meta = mergeMeta(this.meta, spec)
    return this
  }
  s.setName = function setName(this: Shape & ShapeMetaMethods, name: string) {
    this.meta = mergeMeta(this.meta, { name })
    return this
  }
  s.setDescription = function setDescription(this: Shape & ShapeMetaMethods, description: string) {
    this.meta = mergeMeta(this.meta, { description })
    return this
  }
  s.setPartNumber = function setPartNumber(this: Shape & ShapeMetaMethods, partNumber: string) {
    this.meta = mergeMeta(this.meta, { partNumber })
    return this
  }
  s.setMetaField = function setMetaField(this: Shape & ShapeMetaMethods, key: string, value: string) {
    this.meta = mergeMeta(this.meta, { metadata: { [key]: value } })
    return this
  }
  s.getMeta = function getMeta(this: Shape) {
    return this.meta
  }
  return s
}