/**
 * env-agnostic.ts — environment-agnostic shared surface (weapp plan §9.1)
 *
 * One home for the exports that every host entry (index / browser / weapp)
 * must share: identity + runtime-state + lang/* text-layer tools. Umbrella
 * entries re-export this module instead of hand-listing the same symbols three
 * times — hand lists are how drift (and entry leaks) happened before.
 *
 * Constraint: NOTHING in this module's dependency graph may be
 * platform-specific. No node:*, no DOM, no three (the weapp main thread holds
 * its own three copy — a second copy via this entry is a hard failure), no
 * brepkit, no wasm loaders. Guarded by entry-boundary.test.ts.
 */

// ── identity：品牌类型 + 信任点（f0，零依赖）──
export type {
  FileId, InnerId, ScopedId, StmtId, PartName, GroupName,
  RefId, ReferenceId, SelectorKey, OccurrenceId, ShapeId,
  FaceId, EdgeId, NodeId, StatementId, FaceSelector,
} from './identity'
export {
  asFileId, asInnerId, asScopedId, asStmtId, asPartName, asGroupName,
  asRefId, asReferenceId, asSelectorKey, asOccurrenceId, asShapeId,
  asFaceId, asEdgeId, asNodeId,
  toScopedId, splitScopedId, isScopedId, toInnerId,
} from './identity'

// ── runtime-state：运行时状态锚点（零依赖层；引擎与库共享）──
export {
  configureBackends, getBackends, setCurrentStmt, getCurrentStmt,
  keep, keepHidden, getRuntimeState, nameOf, setName, setKeepSink,
  setPendingAssemblyTransforms, takePendingAssemblyTransforms, assertContractVersion,
  CONTRACT_VERSION,
} from './runtime-state'
export type {
  Backends, FaijsRuntimeState, ShapeSlot, KeepSink, RuntimeExecutionMode,
  AssemblyTransform, StdlibFn, StdlibNamespace, ExecutionAnchor,
} from './runtime-state'

// ── L0 lang/ 文本面（IR 是引擎内部实现细节，不导出；公开面只有代码文本工具与结果类型）──
export type {
  Vec3, JsonValue,
  TerminalShape, ParamDef,
} from './lang/types'
// 拓扑身份 provenance 类型（op 级命名 / 拓扑身份系统公开面）。
export type { Provenance, NewFaceRule } from './topology/naming/lineage'
export {
  derivePartName, getMaxModelNum,
} from './lang/allocate-id'
export type { DerivePartNameInput, DerivePartNameResult } from './lang/allocate-id'
export { fmtNum, formatCodeLine } from './lang/codegen'
export type { FormatCodeLineInput } from './lang/codegen'
export { analyzeCode } from './lang/statement-summary'
export type { StatementSummary } from './lang/statement-summary'
export { codeToArgs } from './lang/code-to-args'
export type { CodeToArgsResult } from './lang/code-to-args'
// MetadataExtractor — 无 IR 元数据提取器（UI 通道语义源；UiMetadata 全量）
export { extractMetadata } from './lang/metadata-extractor'
export type {
  UiMetadata, ArgSource, ParamEntry, ImportEntry, FunctionEntry, BlockEntry, KeepEntry,
  ExtractMetadataOptions,
} from './lang/metadata-extractor'
// SecurityScanner — 静态安全门禁（纵深防御第一层）
export { scanSource, scanAst, assertSecure } from './lang/security-scanner'
export type {
  SecurityPolicy, SecurityRuleId, SecurityViolation,
  SecurityScanOptions, SecurityScanResult,
} from './lang/security-scanner'
// 参数表达式编辑（P0-C/P0-D）：实时校验层 + 编辑面板纯函数
export { validateExpression } from './lang/expr-validate'
export type { ExprValidateInput, ExprValidateResult } from './lang/expr-validate'
export { editArgSource } from './lang/source-edit'
export type { EditSourceError } from './lang/source-edit'
// HostArg — 宿主友好位置参数类型（IR 屏蔽层）
export type {
  HostArg, HostRef, HostVarRef, HostParamRef, HostCallRef, HostExprRef, HostRefKind,
} from './lang/host-arg'
export {
  isHostVarRef, isHostParamRef, isHostCallRef, isHostExprRef, isHostRef,
  hostArgToDisplay, hostArgToLiteral, HOST_REF_KINDS,
} from './lang/host-arg'
