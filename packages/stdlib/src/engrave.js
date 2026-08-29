/**
 * stdlib engrave — 雕刻库函数
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh。
 * BREP 路径：textToSolid/svgToSolid + boolean（cut/fuse）。
 */
import { cad } from '@faicad/faijs-core/mesh';
import { parseSvgNaturalSize } from '@faicad/faijs-core/primitives/parse-svg-size';
import { textToSolid } from '@faicad/faijs-core/brep/text/text-to-solid';
import { svgToSolid } from '@faicad/faijs-core/brep/svg/svg-to-solid';
import { ensureDefaultFont } from '@faicad/faijs-core/brep/text/fontRegistry';
import { solidToShape } from '@faicad/faijs-core/brep/brep-ops';
import { getSolidBoundingBox } from '@faicad/faijs-core/brep/brep-utils';
import { resolveSvgArg } from './internal/svg-asset-resolver';
import { getBackends } from '@faicad/faijs-core/runtime-state';
import { solid, fromBrep, brepOf } from '@faicad/faijs-core/shape';
import { dispatchPath } from '@faicad/faijs-core/cad-runtime/backend-dispatch';
import { assertPositiveNumber } from './assert';
/** BREP 实现标记（engrave 有 OCCT 精确雕刻） */
const brepImpl = true;
// ── per-op 参数自校验（Phase 2.2；stdlib 被直接 import 时的防御层） ──
/** engrave: 至少提供 text 或 svg 之一；depth（如有）> 0。 */
export function assertEngraveParams(params) {
    const hasText = params.text !== undefined && params.text !== null && params.text !== '';
    const hasSvg = params.svg !== undefined && params.svg !== null;
    if (!hasText && !hasSvg) {
        throw new Error('[stdlib] engrave requires either "text" or "svg"');
    }
    if (params.depth !== undefined && params.depth !== null) {
        assertPositiveNumber(params.depth, 'engrave.depth');
    }
}
/** 世界坐标 → BREP solid 局部坐标。 */
function worldToLocalPosition(worldPos, partTransform) {
    const offset = partTransform?.position;
    if (!offset)
        return worldPos;
    return [
        worldPos[0] - offset[0],
        worldPos[1] - offset[1],
        worldPos[2] - offset[2],
    ];
}
/** 计算将 +Z 轴对齐到目标法向量的 3x4 仿射变换矩阵（仅旋转，无平移，Rodrigues 公式）。 */
function alignZToNormal(normal) {
    const [nx, ny, nz] = normal;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-10) {
        return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
    }
    const ux = nx / len, uy = ny / len, uz = nz / len;
    if (Math.abs(ux) < 1e-10 && Math.abs(uy) < 1e-10) {
        if (uz > 0)
            return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
        return [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0];
    }
    const s = Math.sqrt(ux * ux + uy * uy);
    const c = uz;
    const t = 1 - c;
    const ax = -uy / s, ay = ux / s;
    return [
        c + ax * ax * t, ax * ay * t, ay * s, 0,
        ax * ay * t, c + ay * ay * t, -ax * s, 0,
        -ay * s, ax * s, c, 0,
    ];
}
/** 将 solid 居中到原点（基于包围盒中心，与 mesh 路径语义一致）。 */
function centerSolidAtOrigin(kernel, solid) {
    const bb = getSolidBoundingBox(kernel, solid);
    const cx = (bb.min[0] + bb.max[0]) / 2;
    const cy = (bb.min[1] + bb.max[1]) / 2;
    const cz = (bb.min[2] + bb.max[2]) / 2;
    const centered = kernel.translate(solid, -cx, -cy, -cz);
    kernel.release(solid);
    return centered;
}
/** BREP 路径：textToSolid/svgToSolid + boolean（cut/fuse）。 */
async function engraveBrepPath(input, params, svgText) {
    const kernel = getBackends().kernel.occt;
    if (!kernel)
        throw new Error('[stdlib/engrave] no OCCT kernel');
    const inputSolid = brepOf(input);
    if (!inputSolid)
        throw new Error('[stdlib/engrave] input is not BREP');
    const depth = params.depth;
    const mode = params.mode ?? 'concave';
    const text = params.text;
    // 1. 创建装饰 solid（文字或 SVG），depth 与 mesh 路径一致
    let decorationSolid;
    if (text) {
        await ensureDefaultFont();
        const textSize = params.textSize ?? 16;
        decorationSolid = textToSolid(kernel, text, { fontSize: textSize, depth });
    }
    else if (svgText) {
        decorationSolid = svgToSolid(kernel, svgText, {
            depth,
            targetLongSide: params.svgSize ?? 20,
        });
    }
    else {
        throw new Error('[stdlib/engrave] neither text nor svg provided');
    }
    // 2. 居中到原点
    decorationSolid = centerSolidAtOrigin(kernel, decorationSolid);
    // 3. 旋转 +Z 对齐面法向
    const worldFaceNormal = params.faceNormal ?? [0, 0, 1];
    const rotMatrix = alignZToNormal(worldFaceNormal);
    const rotated = kernel.transform(decorationSolid, rotMatrix);
    kernel.release(decorationSolid);
    // 4. 沿法向偏移 + 平移到面中心（凸 offset=+depth/2，凹 offset=-depth/2；加 0.01 避免共面）
    const worldFaceCenter = params.faceCenter ?? [0, 0, 0];
    const localFaceCenter = worldToLocalPosition(worldFaceCenter, getBackends().config.partTransform);
    const offset = mode === 'convex' ? depth / 2 : -depth / 2;
    const epsilon = 0.01;
    const tx = localFaceCenter[0] + worldFaceNormal[0] * (offset + epsilon);
    const ty = localFaceCenter[1] + worldFaceNormal[1] * (offset + epsilon);
    const tz = localFaceCenter[2] + worldFaceNormal[2] * (offset + epsilon);
    const positioned = kernel.translate(rotated, tx, ty, tz);
    kernel.release(rotated);
    // 5. 布尔运算（凸=fuse，凹=cut）
    const isRaised = mode === 'convex';
    let result;
    if (isRaised) {
        result = kernel.fuse(inputSolid, positioned);
    }
    else {
        result = kernel.cut(inputSolid, positioned);
    }
    kernel.release(positioned);
    // 5b. cut 可能分裂成多个 solid（compound），用 fuseAll 合并回单一 solid
    try {
        const subSolids = kernel.getSubShapes(result, 'solid');
        if (subSolids.length > 1) {
            const fused = kernel.fuseAll(subSolids);
            for (const s of subSolids) {
                try {
                    kernel.release(s);
                }
                catch { /* 已释放 */ }
            }
            try {
                kernel.release(result);
            }
            catch { /* 已释放 */ }
            result = fused;
        }
    }
    catch {
        // getSubShapes 失败说明结果不是 compound，无需处理
    }
    return fromBrep(solidToShape(kernel, result), { solid: result });
}
export async function engrave(input, params) {
    if (!input)
        throw new Error('[stdlib/engrave] no input geometry');
    assertEngraveParams(params);
    // 解析 SVG 资产引用（AssetRef → SVG 文本），如有
    const svgText = params.svg !== undefined && params.svg !== null
        ? await resolveSvgArg(params.svg, { assets: getBackends().assets })
        : undefined;
    const path = dispatchPath([input], brepImpl);
    if (path === 'brep')
        return await engraveBrepPath(input, params, svgText);
    // mesh 路径
    const faceCenter = params.faceCenter ?? [0, 0, 0];
    const faceNormal = params.faceNormal ?? [0, 0, 1];
    const { naturalWidth, naturalHeight } = svgText ? parseSvgNaturalSize(svgText) : { naturalWidth: 0, naturalHeight: 0 };
    const hasText = !!params.text;
    return solid(await cad.engrave(input, {
        mode: params.mode ?? 'concave',
        depth: params.depth,
        face: { center: faceCenter, normal: faceNormal },
        text: hasText ? params.text : undefined,
        textSize: params.textSize,
        svg: svgText,
        svgNaturalWidth: naturalWidth,
        svgNaturalHeight: naturalHeight,
        svgSize: params.svgSize,
    }));
}
//# sourceMappingURL=engrave.js.map