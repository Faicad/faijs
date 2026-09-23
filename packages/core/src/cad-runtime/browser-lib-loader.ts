/**
 * browser-lib-loader — 浏览器通用 `LibLoader` 工厂（D3-Browser，§9.4）
 *
 * 与 node 侧 `cliPortsLibLoader`（`node-host/cli.ts`）对称：都实现 `LibLoader`
 * 契约（`loadLib` / `listLibs` / `options.autoLiftFor`），差别只在装载通道——
 * node 用 `import(pkg)` 从 `node_modules` 解析，浏览器用**动态 `import()`** 取 CDN。
 *
 * 两条通路（Q8 定稿的 a/b 混合，共用同一 `CDN_BASE`）：
 * - **方案 a（importmap）**：不提供 `versions` 时，用**已解析的包名**做裸 specifier
 *   动态 `import(pkg)`，由页面 `<script type="importmap">` 的 scope
 *   （`"@faicad/": "CDN_BASE/*@faicad/"`）在后端按依赖图取版。零版本表，dev / playground 用。
 * - **方案 b（精确 pin）**：提供 `versions`（`versions.json`）时拼
 *   `` `${cdnBase}${pkg}@${version}/+esm` `` 直链，版本精确 pin 到已发布版本，保证
 *   可复现与缓存命中；release 产物用。
 *
 * 别名归一：脚本 specifier 常是短名（demo 的 `.fai.js` 写 `gear-lib-demo` /
 * `sheetmetal`），而 CDN 上是 npm 全名（`@faicad/gear-lib-demo`）。`aliases` 把
 * specifier 映到包名后再装载，与 node 侧 `CLI_SHORT_NAMES` 归一同一职责。
 *
 * `autoLiftFor` 是**同步**回调（`runtime.ts` 在装载后立即取值），所以逐库
 * `faijs.autoLift` 必须**预先**可用：主机从构建期产物 `lib-meta.json`
 * （`scripts/gen-importmap.mjs` 生成）经 `meta` 传入；也可调 `prefetchMeta()`
 * 在网络可达时抓各库 `package.json` 预热（失败静默回落推断式）。
 *
 * 本工厂**不**被 `createBrowserPorts` 默认装配——demo 走源码 alias 的 HMR 路径
 * 必须保持零网络；CDN 装载仅服务「从 npm 消费已发布包」的场景，由主机显式注入。
 */

import type { LibLoader } from './ports'
import type { StdlibNamespace } from '../runtime-state'

/** 默认 CDN base（Q8 定稿：jsDelivr npm 镜像；ESM 取 `+esm`）。 */
export const DEFAULT_CDN_BASE = 'https://cdn.jsdelivr.net/npm/'

/** 逐库元数据（与 `lib-meta.json` 键形一致）。 */
export interface BrowserLibMeta {
  /** `package.json` 的 `faijs.autoLift` 外置字段（D3-autoLift）。 */
  autoLift?: boolean
}

/** `createBrowserLibLoader` 的选项。 */
export interface CreateBrowserLibLoaderOptions {
  /** CDN base，须以 `/` 结尾（缺省 `DEFAULT_CDN_BASE`）。 */
  cdnBase?: string
  /** 方案 b：精确 pin 的 `packageName → version`（`versions.json`）；提供即走直链。 */
  versions?: Record<string, string>
  /** 别名表：脚本 import specifier → npm 包名（如 `gear-lib-demo` → `@faicad/gear-lib-demo`）。 */
  aliases?: Record<string, string>
  /** 允许装载的 **npm 包名**白名单；缺省不限制（生产建议显式给）。 */
  libs?: string[]
  /** 逐库元数据（`lib-meta.json`），喂 `options.autoLiftFor`。 */
  meta?: Record<string, BrowserLibMeta>
  /** 全局 autoLift 缺省（喂 `options.autoLift`）；缺省交由 runtime 推断式决定。 */
  autoLift?: boolean
  /** 强制方案 a（即使提供了 `versions` 也用裸 specifier，依赖 importmap）。 */
  forceImportMap?: boolean
  /** 注入的动态 import 实现（测试用）；缺省为原生动态 `import()`。 */
  importModule?: (url: string) => Promise<unknown>
  /** 注入的 fetch（`prefetchMeta` 用）；缺省全局 `fetch`，无则 `prefetchMeta` 为空操作。 */
  fetchImpl?: typeof fetch
}

/** 浏览器 `LibLoader`（在契约上附加元数据预热）。 */
export interface BrowserLibLoader extends LibLoader {
  /**
   * 抓取已知各库的 `package.json`，把 `faijs.autoLift` 填进内部 meta 缓存。
   * 网络失败静默跳过（保持未声明 → 回落推断式）。在 `execute` 前 await 一次即可。
   * @returns promise resolving when all known libs have been probed.
   */
  prefetchMeta(): Promise<void>
}

/** 归一 CDN base：保证尾随 `/`，避免拼接出 `.../npm@1.0.0` 这类坏 URL。 */
function withTrailingSlash(base: string): string {
  return base.endsWith('/') ? base : `${base}/`
}

/**
 * 创建浏览器通用 `LibLoader`。
 *
 * 装载顺序：`name` → `aliases` 归一为 npm 包名 → 白名单校验 → 方案 b 直链（有
 * `versions[pkg]` 且未 `forceImportMap`）或方案 a 裸 specifier → 动态 `import()`；
 * 同一包名并发/重复装载共享同一 in-flight promise（CDN 只取一次）。
 * @param opts - CDN base、版本表 / 别名 / 元数据，以及测试用注入点。
 * @returns 满足 `LibLoader` 契约、并附加 `prefetchMeta()` 的浏览器装载器。
 */
export function createBrowserLibLoader(opts: CreateBrowserLibLoaderOptions = {}): BrowserLibLoader {
  const cdnBase = withTrailingSlash(opts.cdnBase ?? DEFAULT_CDN_BASE)
  const aliases: Record<string, string> = { ...(opts.aliases ?? {}) }
  const versions = opts.versions
  const allow = opts.libs ? new Set(opts.libs) : undefined
  const meta: Record<string, BrowserLibMeta> = { ...(opts.meta ?? {}) }
  const importModule =
    opts.importModule ?? ((url: string): Promise<unknown> => import(/* @vite-ignore */ url))
  const fetchImpl = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined)

  /** specifier → npm 包名。 */
  const pkgOf = (name: string): string => aliases[name] ?? name

  /** 已知 specifier 集合：别名键 ∪ 显式 libs ∪ 版本表键（后两者本身即合法 specifier）。 */
  const specifiers = new Set<string>([
    ...Object.keys(aliases),
    ...(opts.libs ?? []),
    ...Object.keys(versions ?? {}),
  ])

  /** 方案 b 的直链；返回 `undefined` 表示走方案 a。 */
  const urlOf = (pkg: string): string | undefined => {
    if (opts.forceImportMap) return undefined
    const v = versions?.[pkg]
    return v ? `${cdnBase}${pkg}@${v}/+esm` : undefined
  }

  const pending = new Map<string, Promise<StdlibNamespace>>()

  return {
    loadLib: (name: string): Promise<StdlibNamespace> => {
      const pkg = pkgOf(name)
      if (allow && !allow.has(pkg)) {
        return Promise.reject(
          new Error(`package "${pkg}" (from specifier "${name}") is not in the browser library whitelist`),
        )
      }
      const cached = pending.get(pkg)
      if (cached) return cached
      const url = urlOf(pkg)
      const job = importModule(url ?? pkg).then((mod) => mod as StdlibNamespace)
      pending.set(pkg, job)
      // 装载失败不留毒缓存：清掉后可重试（如网络恢复）。
      job.catch(() => pending.delete(pkg))
      return job
    },

    listLibs: () => [...specifiers],

    options: {
      ...(opts.autoLift === undefined ? {} : { autoLift: opts.autoLift }),
      // 逐库 autoLift 优先于全局：未声明 → undefined → 回落全局 / runtime 推断式。
      autoLiftFor: (name: string) => meta[pkgOf(name)]?.autoLift,
    },

    prefetchMeta: async (): Promise<void> => {
      if (!fetchImpl) return
      const pkgs = new Set<string>([...specifiers].map(pkgOf))
      await Promise.all(
        [...pkgs].map(async (pkg) => {
          if (meta[pkg]) return
          const v = versions?.[pkg]
          try {
            const res = await fetchImpl(`${cdnBase}${pkg}${v ? `@${v}` : ''}/package.json`)
            if (!res.ok) return
            const pj = (await res.json()) as { faijs?: { autoLift?: boolean } }
            const lifted = pj.faijs?.autoLift
            const entry: BrowserLibMeta = {}
            if (typeof lifted === 'boolean') entry.autoLift = lifted
            if (entry.autoLift !== undefined) meta[pkg] = entry
          } catch {
            // 网络不可达 / 非法 JSON → 保持未声明，交由 runtime 推断式。
          }
        }),
      )
    },
  }
}
