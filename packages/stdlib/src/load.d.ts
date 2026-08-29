/**
 * stdlib load — 加载库函数（统一 load 函数）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * buffer 经宿主资产解析器解析，isCadFormat 静态判定 brep/mesh，
 * 产物经 solid()/fromBrep() 构造器创建。
 */
import type { Shape } from '@faicad/faijs-core/mesh/types';
/**
 * 执行加载操作（统一 load 函数）
 *
 * 按 params 中存在的 key/path/url 分流解析 buffer，全部经宿主资产解析器。
 *
 * 静态分派：
 * - CAD 源 + kernel + 非 mesh 模式 → BREP 路径（loadBrep 异常 = 未预期错误，冒泡上报）
 * - 非 CAD 源 / 无 kernel / mesh 模式 → mesh 路径
 * - brep 模式且将走 mesh 路径 → 调用前抛 BrepUnsupportedError（不静默回退）
 */
export declare function load(params: Record<string, unknown>): Promise<Shape>;
//# sourceMappingURL=load.d.ts.map