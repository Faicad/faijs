/**
 * exec-backend — execution backend seam for DirectExecutor units.
 *
 * Each transformed unit is executed by one of two backends:
 * - VmBackend: wraps unit text into an async IIFE and compiles it with
 *   `new Function` (default; requires a JS VM with dynamic code eval).
 * - InterpBackend: interprets the retained acorn AST directly (no eval /
 *   `new Function` / dynamic import — runs in restricted realms such as
 *   WeChat mini-program or strict CSP web).
 *
 * The backend is chosen statically at construction; there is no runtime
 * fallback (same discipline as the BREP/mesh chain dispatch).
 *
 * This module intentionally imports nothing from direct-executor.ts (the
 * executor imports FROM here) — keeps the package graph acyclic.
 */

/** Acorn AST node (loosely typed; backends treat the AST opaquely). */
export type ASTNode = any

/**
 * 变换后的执行单元（DirectExecutor 管线产出）。
 * `body` 文本仅供 VmBackend；`node` AST 引用仅供 InterpBackend。
 */
export interface TransformedUnit {
  lineNo: number
  /** 变换后的可执行语句文本（嵌入 async wrapper 的 body；VmBackend 专用） */
  body: string
  /** 本单元写入的 ctx 键 */
  writes: string[]
  /** 本单元引用的变量名（append 前缀校验；来自实参裸标识符） */
  refs: string[]
  callee?: string
  /** 是否为控制流块单元（T1：for/if/while/do/switch/裸块等） */
  isBlock?: boolean
  /** 单元结束行号（闭区间；transformTopNode 统一填充） */
  endLine: number
  /** 顶层语句 AST 引用（InterpBackend 专用；VmBackend 忽略） */
  node?: ASTNode
}

/** 结构化命名空间视图（DirectExecutor `Namespaces` 的宽松投影，避免模块环）。 */
export interface ExecNamespaces {
  readonly cad: unknown
  readonly [binding: string]: unknown
}

/** 执行宿主：后端执行一个单元所需的全部运行期状态。 */
export interface ExecHost {
  /** 持久变量容器（变量读写唯一持久层） */
  ctx: Record<string, unknown>
  /** 命名空间绑定（cad + registerLib 注册库） */
  namespaces: ExecNamespaces
  /** 几何值判定（裸调用原地写回双条件守卫，P25 §3.7 规则 2） */
  isGeom: (v: unknown) => boolean
}

/**
 * 执行后端：执行一个变换后的单元。
 * 锚点（setCurrentStmt）与 keep-sink 由 DirectExecutor 在调用前设置，后端不负责。
 */
export interface ExecBackend {
  runUnit(unit: TransformedUnit, host: ExecHost): Promise<void>
}

/** 执行后端选择（静态选定，无运行时回退）。 */
export type ExecBackendChoice = 'vm' | 'interpreter'
