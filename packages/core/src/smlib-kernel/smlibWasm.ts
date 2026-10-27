/**
 * smlib-kernel/smlibWasm — smlib（usd-brep SM_API）standalone wasm 装载
 *
 * 与 brepkit-kernel/brepkitWasm 同构的注入点，但装载形态不同：
 * - brepkit-wasm 是 wasm-bindgen 产物（JS glue + .d.ts，`new BrepKernel()`）；
 * - smlib 是 emscripten **standalone** 产物（`smlib_standalone.wasm`，无 JS glue）：
 *   导出 `memory` / `__indirect_function_table` / `malloc` / `free` + 191 个
 *   mangled `SmApi*` 函数；imports 是 `env` 的 EH 辅助（`invoke_*` / `__cxa_*` /
 *   `__syscall_dup3` / `emscripten_notify_memory_growth`）+ `wasi_snapshot_preview1`
 *   的 fd/clock 函数——建模路径不碰文件系统（wasi 全 stub），
 *   **`invoke_*` 必须真实转发**（见 createSmlibImports 的 GOTCHA，探针实证）。
 *
 * 装载策略（与 brepkit 一致）：
 * - 宿主可调用 setSmlibWasmInitFn(fn) 注入自定义初始化函数
 *   （微信 WXWebAssembly.instantiate 路径，见 wasm-probe/wechat/smlib-loader.js）；
 * - 未注入时，node 环境默认读取 vendored `vendor/smlib-wasm/smlib_standalone.wasm`
 *   → `WebAssembly.instantiate`（stub imports 由模块 imports 清单动态生成）；
 * - 两边都没有 → 抛带上下文的错误（报错好于掩盖，禁止静默回退）。
 */

/** smlib 内核实例形态：原始导出表 + 内存 + 片段查找（具体 API 适配在 smlibKernel.ts）。 */
export interface SmlibKernel {
  /** 线性内存（wasm 导出 memory；ALLOW_MEMORY_GROWTH 下 buffer 可能被替换，读时动态取）。 */
  memory: WebAssembly.Memory
  /** 全部 wasm 导出（mangled 名，如 `_Z17SmApiBooleanUnionP6SmBrepS0_RS0_`）。 */
  exports: Record<string, (...args: number[]) => number>
  /** 按导出名片段找函数（唯一命中）；未命中抛带上下文的错误。 */
  find(fragment: string): (...args: number[]) => number
  /** 进程级默认 SmContext（惰性创建；对齐 AGENTS.md：启动时先建 context，勿并发惰性创建）。 */
  getOrCreateContext(): number
  /** wasm 堆分配（emscripten malloc，size 字节，返回对齐指针；0 表示失败）。 */
  malloc(size: number): number
  /** 释放 wasm 堆指针。 */
  free(ptr: number): void
}

type SmlibInitFn = () => Promise<SmlibKernel>

// 2026-10-26 跨实例共享（随 brepkitWasm 同款设计）：customInitFn / initPromise
// 挂在 globalThis 上，CDN 外部化多实例 / 小程序 Worker 副实例共享同一内核状态，
// 句柄互通。

const SMLIB_KERNEL_KEY = '__FAICAD_FAIJS_SMLIB_KERNEL__'
const SMLIB_KERNEL_STATE_VERSION = 1

interface SmlibKernelSharedState {
  stateVersion: number
  customInitFn: SmlibInitFn | null
  initPromise: Promise<SmlibKernel> | null
}

/** 获取 smlib 内核共享状态（单例）。 */
function getSmlibKernelSharedState(): SmlibKernelSharedState {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[SMLIB_KERNEL_KEY] as SmlibKernelSharedState | undefined
  if (existing) {
    if (existing.stateVersion !== SMLIB_KERNEL_STATE_VERSION) {
      throw new Error(
        `[faijs] smlib kernel state version mismatch: loaded=${existing.stateVersion}, expected=${SMLIB_KERNEL_STATE_VERSION}`,
      )
    }
    return existing
  }
  const created: SmlibKernelSharedState = {
    stateVersion: SMLIB_KERNEL_STATE_VERSION,
    customInitFn: null,
    initPromise: null,
  }
  g[SMLIB_KERNEL_KEY] = created
  return created
}

/**
 * 注入自定义 smlib wasm 初始化函数（宿主装配期调用一次）。写入共享挂点——
 * 任意 faijs 实例（含 CDN 外部化实例 / 小程序 Worker 副实例）都优先使用。
 * @param fn - the initialization function to use, or null to clear
 */
export function setSmlibWasmInitFn(fn: (() => Promise<SmlibKernel>) | null): void {
  const s = getSmlibKernelSharedState()
  s.customInitFn = fn
  // 挂点变化后丢弃进行中的初始化（下一次 init 用新挂点重来）。
  s.initPromise = null
}

/**
 * 初始化并返回 smlib 内核单例（幂等：多次调用共享同一次初始化）。
 * @returns Promise 解析为 SmlibKernel。
 */
export function initSmlibWasm(): Promise<SmlibKernel> {
  const s = getSmlibKernelSharedState()
  if (s.initPromise) return s.initPromise
  s.initPromise = (async (): Promise<SmlibKernel> => {
    if (s.customInitFn) return await s.customInitFn()
    // node 环境（单测 / CLI）：vendored standalone wasm 默认装载路径
    if (typeof process !== 'undefined' && process.versions?.node) {
      return await loadNodeDefault()
    }
    throw new Error('initSmlibWasm: no init function set and not in Node environment. Call setSmlibWasmInitFn() first.')
  })()
  return s.initPromise
}

/** 是否已初始化完成（测试诊断用）。
 * @returns true 表示 wasm 已装载完成。 */
export function isSmlibInitialized(): boolean {
  return getSmlibKernelSharedState().initPromise !== null
}

/**
 * 丢弃当前初始化结果（测试收尾 / 内核释放后调用）。
 * customInitFn 不受影响（宿主注入的装载路径仍在）。
 */
export function resetSmlibWasm(): void {
  getSmlibKernelSharedState().initPromise = null
}

// ── Node 默认装载 ──

async function loadNodeDefault(): Promise<SmlibKernel> {
  const [{ readFileSync }, { fileURLToPath }] = await Promise.all([
    import('node:fs'),
    import('node:url'),
  ])
  // src/smlib-kernel/smlibWasm.ts → ../../vendor/... = packages/core/vendor/...
  // （编译后 dist/smlib-kernel/smlibWasm.js 同层结构，路径不变）。
  const wasmUrl = new URL('../../vendor/smlib-wasm/smlib_standalone.wasm', import.meta.url)
  const bytes = readFileSync(fileURLToPath(wasmUrl))
  const module = new WebAssembly.Module(bytes)
  // GOTCHA（2026-10-26 探针实证，Node 22.23 + emscripten -fwasm-exceptions standalone）：
  // invoke_* imports 是 call_indirect 的 EH 包装，SmApi* 内部**必触发**（虚函数/vtable 调用），
  // 简单 stub（返回 0）会吞掉转发：被调函数从不执行 → 构造 this=0 → 全链路返回 0。
  // 正确实现必须真实转发到 __indirect_function_table，并处理 setThrew 异常标志。
  // 但 table 是**导出**（instantiate 之后才可得）——用闭包延迟绑定：instantiate 前
  // 注入的 invoke 闭包引用 `instanceRef`，wasm 实际执行时（instantiate 后）再取导出。
  let instanceRef: WebAssembly.Instance | null = null
  const r = (await WebAssembly.instantiate(module, createSmlibImports(module, () => instanceRef))) as
    | WebAssembly.Instance
    | { module: WebAssembly.Module; instance: WebAssembly.Instance }
  // GOTCHA: Node ≥22 对「已编译 Module」的 instantiate 直接返回 Instance（无包装）；
  // 旧行为返回 { module, instance }。两种形态都要接（探针实证，Node 22.23）。
  const instance = 'instance' in r ? r.instance : r
  instanceRef = instance
  return buildSmlibKernel(instance)
}

/**
 * 按模块 imports 清单动态生成 imports：`env` 的 EH 辅助（invoke_* 真实转发、
 * __cxa_* 暴露语义）+ `wasi_snapshot_preview1` 的 fd/clock 函数。
 * 建模路径不触发文件系统调用；wasi stub 保证 instantiate 阶段不缺导入。
 * @param getInstance - 延迟取回已实例化的 Instance（invoke 转发需要其导出的 table/stack/setThrew）。
 */
function createSmlibImports(
  module: WebAssembly.Module,
  getInstance: () => WebAssembly.Instance | null,
): WebAssembly.Imports {
  const importNames = WebAssembly.Module.imports(module).map(({ module: m, name }) => ({ module: m, name }))
  return createSmlibImportsByName(importNames, getInstance)
}

/**
 * 按「模块名 + 符号名」清单生成 imports（微信 WXWebAssembly 形态专用）。
 *
 * 微信端没有 `WebAssembly.Module` 句柄可枚举 imports（WXWebAssembly.instantiate
 * 只收代码包路径 + imports），因此清单由构建期（3d_editor build.mjs）用 node 提取
 * wasm 的 imports 名并烘焙进 worker bundle；运行时本函数按清单生成完整 env/wasi。
 * 逻辑与 createSmlibImports 完全同源（同一转发/stub 实现），仅枚举来源不同。
 *
 * @param importNames - `[{ module: 'env'|'wasi_snapshot_preview1', name }]` 构建期清单
 * @param getInstance - 延迟取回已实例化的 Instance（invoke 转发需要其导出的 table/stack/setThrew）
 * @returns 完整 env/wasi imports 对象（交给 wasm 实例化）
 */
export function createSmlibImportsByName(
  importNames: ReadonlyArray<{ module: string; name: string }>,
  getInstance: () => WebAssembly.Instance | null,
): WebAssembly.Imports {
  const env: Record<string, unknown> = {}
  const wasi: Record<string, unknown> = {}
  for (const { module, name } of importNames) {
    if (module === 'env') env[name] = makeEnvImport(name, getInstance)
    else if (module === 'wasi_snapshot_preview1') wasi[name] = makeWasiStub(name)
  }
  return { env, wasi_snapshot_preview1: wasi } as unknown as WebAssembly.Imports
}

// GOTCHA: TS lib（core 的 target）不含 WebAssembly.Exception（wasm-exceptions 提案类型
// 未进标准 lib.d.ts）。Node ≥22 运行时有；这里通过 any 形态访问，避免改 tsconfig 目标。
// ⚠️ 必须经 globalThis 取（可缺失）：微信小程序 Worker 没有全局 `WebAssembly`（只有
// WXWebAssembly），顶层裸引用 `WebAssembly` 在真机加载模块时当场抛 ReferenceError
// （2026-10-27 真机实测 `Can't find variable: WebAssembly`）。node/浏览器/模拟器有全局，
// 不受影响。
const WebAssemblyWithException = (globalThis as { WebAssembly?: unknown }).WebAssembly as
  | { Exception?: new (...args: unknown[]) => unknown }
  | undefined
function isWasmException(e: unknown): boolean {
  return !!WebAssemblyWithException?.Exception && e instanceof WebAssemblyWithException.Exception
}

/** invoke_<ret><args…>：首字符是返回类型；catch（C++ 异常）时按返回类型给默认值。 */
const INVOKE_RET_DEFAULT: Record<string, number | bigint | undefined> = {
  i: 0,
  d: 0,
  f: 0,
  j: 0n,
  v: undefined,
}

function makeEnvImport(
  name: string,
  getInstance: () => WebAssembly.Instance | null,
): (...args: number[]) => number | bigint | undefined {
  if (name.startsWith('invoke_')) {
    const retType = name.charAt('invoke_'.length)
    return (index: number, ...args: number[]): number | bigint | undefined => {
      const inst = getInstance()
      if (!inst) {
        throw new Error(`[smlib] invoke_${retType} called before instance ready (index=${index})`)
      }
      const ex = inst.exports as unknown as Record<string, unknown>
      const table = ex.__indirect_function_table as WebAssembly.Table
      const getCurrent = ex.emscripten_stack_get_current as (() => number) | undefined
      const stackRestore = ex._emscripten_stack_restore as ((sp: number) => void) | undefined
      const setThrew = ex.setThrew as ((flag: number, error: number) => void) | undefined
      const sp = getCurrent ? getCurrent() : 0
      try {
        return (table.get(index) as (...a: number[]) => number | bigint | undefined)(...args)
      } catch (e) {
        if (isWasmException(e)) {
          // C++ 异常（wasm throw tag）→ 置 emscripten threw 标志，返回类型默认值；
          // wasm 侧读 __THREW__ 走错误分支。这是 emscripten 标准 invoke 语义。
          if (stackRestore) stackRestore(sp)
          if (setThrew) setThrew(1, 0)
          return INVOKE_RET_DEFAULT[retType]
        }
        // 非 C++ 异常（真实 JS 错误 / trap）→ 暴露，不吞。
        throw e
      }
    }
  }
  if (name.startsWith('__cxa_')) {
    // C++ 异常恢复路径（__cxa_begin_catch 等）。建模路径正常不触发；
    // 若 invoke 转发 catch 到异常，wasm 错误分支可能走到这里——抛错暴露而非掩盖。
    return () => {
      throw new Error(`[smlib] unexpected C++ exception path: env.${name}`)
    }
  }
  if (name === 'emscripten_notify_memory_growth') return () => 0
  if (name === '__syscall_dup3') return () => -1
  return () => 0
}

function makeWasiStub(name: string): (...args: number[]) => number {
  if (name === 'proc_exit') {
    return () => {
      throw new Error('[smlib] unexpected proc_exit')
    }
  }
  // fd_write 等建模不碰文件系统；返回 0（成功）即可。如需内核日志可读 iovec。
  return () => 0
}

/**
 * 由已实例化的 wasm Instance 构建 SmlibKernel 外壳（微信端复用：WXWebAssembly
 * instantiate 后把 instance 交给本函数，得到与 node 端同构的内核句柄）。
 * @param instance - 已实例化的 smlib wasm Instance
 * @returns 与 node 端同构的 SmlibKernel 内核句柄
 */
export function buildSmlibKernel(instance: WebAssembly.Instance): SmlibKernel {
  const exports = instance.exports as Record<string, (...args: number[]) => number>
  const memory = exports.memory as unknown as WebAssembly.Memory
  if (!memory) {
    throw new Error('[smlib] wasm did not export memory')
  }
  const find = (fragment: string): ((...args: number[]) => number) => {
    const hit = Object.keys(exports).find((n) => n.includes(fragment))
    if (!hit) {
      throw new Error(`[smlib] missing wasm export fragment: ${fragment} (have ${Object.keys(exports).length} exports)`)
    }
    return exports[hit] as (...args: number[]) => number
  }
  return {
    memory,
    exports,
    find,
    getOrCreateContext: () => find('SmApiGetOrCreateContext')(),
    malloc: (size: number) => exports.malloc(size),
    free: (ptr: number) => {
      exports.free(ptr)
    },
  }
}
