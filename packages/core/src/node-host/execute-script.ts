/**
 * execute-script — 一等「代码字符串 → 产物」执行 API（计划 B6，2026-10-06）。
 *
 * 动机：
 * 发布 tarball 不含 `scripts/`，此前没有「给 `.fai.js` 源码字符串 → 直接拿到产物」的
 * 公开函数，每个下游各自内联 CLI 包装器，并各自重复踩 Host 装配的三个坑
 * （不 registerOcctBrepEngine → BREP engine API not available；configureBackends 漏
 * brepCapabilities → E_BREP_UNSUPPORTED；把 defineOp 返回的 Promise<Shape> 当 Result 判）。
 * 本函数把装配知识固化在一处（与 cliRun 同一套装配）。
 *
 * 仅 Node.js：经 `@faicad/faijs/node` 导入，不要进浏览器构建（依赖 node-host）。
 */

// The facade-level createRuntime (cad-runtime/createRuntimeWithCad) self-registers
// the built-in cad namespace; the bare cad-runtime/runtime one does not (D1).
import { createRuntime } from '../cad-runtime/createRuntimeWithCad'
import type { ExecutionResult } from '../cad-runtime/runtime'
import type { ExecutionMode, LibLoader } from '../cad-runtime/ports'
import type { TerminalShape } from '../lang/types'
import type { LibNamespace } from '../runtime-state'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { createNodePorts } from './index'
import { withCliLibLoader } from './cli'

/** executeScript 的选项。 */
export interface ExecuteScriptOptions {
  /** 执行模式（缺省 `auto`）。 */
  mode?: ExecutionMode
  /** 第三方库装载器（缺省：`@faicad/*` scoped 包动态 import，与 CLI 相同）。 */
  libLoader?: LibLoader
  /**
   * 额外登记的库命名空间（如 cad 面的 sketch 扩展）。key 为 specifier 短名。
   * `cad` 项以 default 命名空间登记（脚本可免 import 使用）。
   */
  libs?: Record<string, LibNamespace>
}

/** executeScript 的产物。 */
export interface ExecuteScriptResult {
  /** 终端形状（几何产物；失败时为空数组）。 */
  terminals: TerminalShape[]
  /** 确定性警告等诊断信息。 */
  diagnostics: string[]
  /** 失败时的语句定位（与 ExecutionResult.failedAt 一致）；成功为 undefined。 */
  failedAt?: { index: number; callee: string; message: string; lineNo?: number; code?: string }
}

/**
 * 执行一段 `.fai.js` 源码字符串并返回产物。
 *
 * 内部完成完整 Host 装配（node ports + libLoader + OCCT BREP 引擎注册），
 * 调用方无需再自行装配——这正是 B4 三个装配坑的固化出口。
 *
 * @param code `.fai.js` 源码字符串
 * @param opts 可选：执行模式、库装载器、额外库命名空间
 * @returns 终端形状、诊断信息与失败定位（`Promise<ExecuteScriptResult>`）；
 *          执行失败以 `failedAt` 结构化返回，不抛异常。
 */
export async function executeScript(
  code: string,
  opts?: ExecuteScriptOptions,
): Promise<ExecuteScriptResult> {
  // registerOcctBrepEngine is idempotent and itself boots initOcctWasm (same as cliRun).
  await registerOcctBrepEngine()

  const ports = withCliLibLoader(createNodePorts())
  const runtime = createRuntime(ports, opts?.mode ?? 'auto', opts?.libs)

  // cad 经 registerLib 声明 packageName，脚本可 `import * as cad from '@faicad/faijs'`。
  if (opts?.libs?.cad) {
    runtime.registerLib('cad', opts.libs.cad, { default: true, packageName: '@faicad/faijs' })
  }

  const execResult: ExecutionResult = await runtime.execute(code)
  return {
    terminals: execResult.terminals ?? [],
    diagnostics: execResult.infos ?? [],
    failedAt: execResult.failedAt,
  }
}
