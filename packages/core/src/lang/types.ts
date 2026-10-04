/**
 * faijs 文本层类型定义 — 保留类型（L0 零依赖）
 *
 * 设计文档：docs/language-design.md §3.1
 *
 * 代码文本是唯一事实源。IR 已删除（T5），本文件只保留宿主消费的
 * 保留类型（ParamDef / TerminalShape / ScriptMetaIR / VarKind）和
 * 基础值类型（Vec3 / JsonValue）。
 *
 * L0 边界：此文件仅依赖 TypeScript 内置类型 + identity（零依赖品牌模块）。
 */

import { type PartName } from '../identity'

// ── 值与引用 ──

/** A 3-component vector. */
export type Vec3 = [number, number, number]

/** A JSON-serializable value, used for parameter literals and wire-shaped args. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue }

// ── 参数表 ──

/**
 * A parameter declaration (`const name = <literal>`), with its value and
 * optional schema metadata.
 */
export interface ParamDef {
  name: string
  type: 'number' | 'vec3' | 'bool' | 'enum'
  value: JsonValue
  default: JsonValue
  min?: number
  max?: number
  options?: string[]
  label?: string
}

// ── Part 脚本 ──

/**
 * Scene-level model metadata (name) carried by a script.
 *
 * 外观不再经 meta 传递（2026-10-05 v2：`appearance` 死特性已删除）——
 * 外观是 Shape 实例方法/字段（`box1.setColor(...)` → `shape.appearance`），
 * 编辑器消费端读执行结果的 `shape.appearance`，而非脚本元数据。
 */
export interface ScriptMetaIR {
  name?: string
}

/** 终端变量类型（keep-syntax 设计 §6：运行时登记，缺省 'shape'）。 */
export type VarKind = 'shape' | 'compound' | 'value'

/** 终端 shape：return 数组/DAG 叶子判定列出的最终输出（设计文档 §2.2 / §4.1） */
export interface TerminalShape {
  /** 终端左值变量名（PartName，如 'part0'）——终端按变量名（outputs）标识，非语句 id */
  id: PartName
  /** 该终端 mesh 的独立 meta（name/appearance） */
  meta?: ScriptMetaIR
  /** 变量类型（'shape' | 'compound' | 'value'），运行时登记，缺省 'shape' */
  kind?: VarKind
  /** 保留但 canvas 不渲染（keep-syntax 设计 §6），缺省 undefined → 可见 */
  hidden?: boolean
}
