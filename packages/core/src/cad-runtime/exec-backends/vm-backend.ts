/**
 * vm-backend — default execution backend.
 *
 * Wraps the transformed unit text into an async IIFE and compiles it with
 * `new Function` against the shared ctx/namespaces. This file is the ONLY
 * place in core where `new Function` is permitted (guard script, §6.4 of the
 * no-eval backend design); SDF compilation is the other sanctioned site.
 */
import type { ExecBackend, ExecHost, TransformedUnit } from '../exec-backend'

/**
 * VM execution backend: compiles the transformed unit text with `new Function`
 * against the shared ctx/namespaces. The default backend for unrestricted
 * realms; do NOT use in environments that forbid dynamic code generation
 * (WeChat mini-program / strict CSP) — choose the interpreter backend there.
 */
export class VmBackend implements ExecBackend {
  async runUnit(unit: TransformedUnit, host: ExecHost): Promise<void> {
    const src = `return (async () => {\n${unit.body}\n})()`
    // P25 §3.7 规则 2：第三参数 '__isGeom'（几何值守卫）——裸调用原地写回的
    // 双条件运行时判定（返回值/原值都是几何才写回）。
    const fn = new Function('__ctx', '__ns', '__isGeom', src)
    await fn(host.ctx, host.namespaces, host.isGeom)
  }
}
