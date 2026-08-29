/**
 * stdlib knurl — 滚花库函数（mesh-only）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2/P4
 *
 * knurl 无 BREP 实现（mesh-only）——dispatchPath 在 brep 模式下调用前抛错。
 * part-brep-lost 事件由引擎统一发（P4，库不再 emit）。
 */
import { cad } from '@faicad/faijs-core/mesh';
import { solid } from '@faicad/faijs-core/shape';
import { reconcileBrepInputs } from './reconcile';
import { dispatchPath } from '@faicad/faijs-core/cad-runtime/backend-dispatch';
import { assertPositiveNumber } from './assert';
/** knurl: knurlTextureHeight 必填 > 0。 */
export function assertKnurlParams(params) {
    assertPositiveNumber(params.knurlTextureHeight, 'knurl.knurlTextureHeight');
}
export async function knurl(input, params) {
    if (!input)
        throw new Error('[stdlib/knurl] no input geometry');
    assertKnurlParams(params);
    // mesh-only：无 brepImpl；brep 模式下 dispatchPath 调用前抛 BrepUnsupportedError
    dispatchPath([input], undefined);
    // 断链时刻（用户点名场景）：BREP 建模的模型最后做滚花 → BREP 输入必须先归约为
    // 合法 2-manifold 网格再进 mesh 路径（reconcileBrepInputs 对 mesh 侧输入原样透传）
    const [meshInput] = reconcileBrepInputs([input]);
    return solid(await cad.knurl(meshInput, {
        face: {
            center: params.faceCenter ?? cad.bboxCenter(meshInput),
            normal: params.faceNormal ?? [0, 0, 1],
        },
        knurlTextureHeight: params.knurlTextureHeight ?? 0.5,
        knurlInvertDisplacement: params.knurlInvertDisplacement ?? false,
        knurlRefineLength: params.knurlRefineLength ?? 1.0,
        knurlScaleU: params.knurlScaleU ?? 0.15,
        knurlScaleV: params.knurlScaleV ?? 0.15,
        knurlMappingMode: params.knurlMappingMode ?? 5,
    }));
}
//# sourceMappingURL=knurl.js.map