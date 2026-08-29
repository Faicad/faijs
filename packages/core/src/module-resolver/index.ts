/**
 * module-resolver — 公开导出（channel ③，V5.2）
 *
 * 见 `./resolver` 与 `./version` 的头注释。
 */

export {
  resolveImports,
  splitVersionRange,
  ModuleResolverError,
  UnresolvedImportError,
  ImportVersionError,
  type ResolverValue,
  type ResolveImportsOptions,
  type ResolveResult,
} from './resolver'

export { satisfies, assertSatisfies, parseVersion, type ParsedVersion } from './version'