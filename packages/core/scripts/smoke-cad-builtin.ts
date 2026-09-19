/**
 * Smoke test — D1（2026-09-19）：验证 createRuntime 自带 cad 默认命名空间。
 * 经 tsx 运行（不类型检查），规避 fcstd WIP 的 tsc 类型错误（与本次 D1/D2-A 无关）。
 */
import { createRuntime } from '../src/cad-runtime/createRuntimeWithCad'
import { createRuntime as createRuntimeCore } from '../src/cad-runtime/runtime'

const ports: any = {
  csg: {},
  sdf: {},
  fonts: {},
  assets: {},
  events: { emit() {} },
}

// 1) 包装版：应自带 cad
const rt = createRuntime(ports)
const libs = (rt as any).libs as Record<string, unknown>
const cad = libs['cad'] as Record<string, unknown> | undefined

console.log('[D1] defaultNs =', rt.defaultNs)
console.log('[D1] cad registered =', !!cad)
console.log('[D1] cad.box typeof =', typeof cad?.['box'])
console.log('[D1] cad.union typeof =', typeof cad?.['union'])
console.log('[D1] cad.contractVersion =', (cad as any)?.contractVersion)

// 2) 纯引擎版（不带 cad）：确认「不带 cad 的纯引擎」路径仍可用，证明 D1 是可选项而非强制
const rtCore = createRuntimeCore(ports)
const libsCore = (rtCore as any).libs as Record<string, unknown>
console.log('[D1-core] cad registered =', !!libsCore['cad'], '(expected false)')
console.log('[D1-core] defaultNs =', rtCore.defaultNs)

const ok =
  rt.defaultNs === 'cad' &&
  !!cad &&
  typeof cad['box'] === 'function' &&
  typeof cad['union'] === 'function' &&
  !libsCore['cad']

console.log(ok ? '\nSMOKE PASS: D1 confirmed (cad built-in; pure-engine variant still cad-free).' : '\nSMOKE FAIL')
process.exit(ok ? 0 : 1)
