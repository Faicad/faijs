/**
 * stdlib internal svg-asset-resolver — SVG 资产解析辅助函数
 *
 * 从 src/ops/svg-asset-resolver.ts 迁入（Phase 2.5 删除 src/ops/）。
 *
 * AssetRef 类型已退役（§4.2：`cad.asset(...)` 走 CallRefIR，运行时解析为字符串）；
 * 此处保留对 `{$asset: key}` 结构（旧 IR / 宿主手写语句）的运行时兼容。
 */
import type { HostPorts } from '@faicad/faijs-core/cad-runtime/ports';
/**
 * 解析 args.svg 字段为 SVG 文本字符串。
 *
 * - 普通字符串：直接返回（兼容直接传入 SVG 文本）
 * - 旧 AssetRef 结构（{ $asset: key }）：按 key 解析（运行时兼容）
 *
 * @throws 如果 key 无法解析
 */
export declare function resolveSvgArg(svg: unknown, ports?: Pick<HostPorts, 'assets'>): Promise<string>;
//# sourceMappingURL=svg-asset-resolver.d.ts.map