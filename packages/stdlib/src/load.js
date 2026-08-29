/**
 * stdlib load — 加载库函数（统一 load 函数）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * buffer 经宿主资产解析器解析，isCadFormat 静态判定 brep/mesh，
 * 产物经 solid()/fromBrep() 构造器创建。
 */
import { cad } from '@faicad/faijs-core/mesh';
import { isCadFormat } from '@faicad/faijs-core/brep/brep-chain';
import { loadBrep } from '@faicad/faijs-core/brep/brep-ops';
import { getBackends, BrepUnsupportedError } from '@faicad/faijs-core/runtime-state';
import { solid, fromBrep } from '@faicad/faijs-core/shape';
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
export async function load(params) {
    const assets = getBackends().assets;
    if (!assets) {
        throw new Error('[stdlib/load] assets is required for load op');
    }
    // 按 key/path/url 分流解析 buffer
    let buffer;
    if (params.key !== undefined && params.key !== null) {
        buffer = (await assets.resolveByKey(params.key)).bytes;
    }
    else if (params.path !== undefined && params.path !== null) {
        buffer = await assets.resolveFile(params.path);
    }
    else if (params.url !== undefined && params.url !== null) {
        buffer = await assets.resolveUrl(params.url);
    }
    else {
        throw new Error('[stdlib/load] load op requires exactly one of key/path/url');
    }
    // 静态判定路径：mesh 模式 / 无 kernel / 非 CAD 源 → mesh 路径；否则 BREP 路径
    const { config, kernel: kernels } = getBackends();
    const kernel = kernels.occt;
    const useBrep = config.mode !== 'mesh' && !!kernel && isCadFormat(params, true);
    // brep 模式且将走 mesh-only 路径 → 调用前抛错，不静默回退
    if (!useBrep && config.mode === 'brep') {
        throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: load op has no BREP implementation for this source');
    }
    // mesh 路径
    if (!useBrep) {
        return solid(await cad.load(buffer, params.format));
    }
    // BREP 路径（直接执行，不包 try-catch！异常 = 未预期错误，冒泡上报）
    // P2：brepChain（meshShapeCache）归引擎侧，loadBrep 不再传
    const { solid: solidHandle, shape } = loadBrep(kernel, buffer);
    return fromBrep(shape, { solid: solidHandle });
}
//# sourceMappingURL=load.js.map