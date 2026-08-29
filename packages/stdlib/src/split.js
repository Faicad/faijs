/**
 * stdlib split — 分割库函数（返回具名对象 { front, back }）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，双输出以具名对象返回（替代 outputCache 多输出写入）。
 */
import { cad } from '@faicad/faijs-core/mesh';
import { splitBrep, solidToShape, translateBrep, } from '@faicad/faijs-core/brep/brep-ops';
import { dovetailBooleanSplitBrep, dowelOrTenonBooleanSplitBrep, } from './brepjs-mirror/joinery-brep';
import { computeBasisFromNormal } from '@faicad/faijs-core/mesh/split';
import { getBackends } from '@faicad/faijs-core/runtime-state';
import { solid, fromBrep, brepOf } from '@faicad/faijs-core/shape';
import { dispatchPath } from '@faicad/faijs-core/cad-runtime/backend-dispatch';
import { assertNonZeroVec3 } from './assert';
/** BREP 实现标记（split 有 OCCT 精确分割） */
const brepImpl = true;
/** 世界坐标 → 局部坐标（含单位缩放）。 */
function worldToLocalVec3(worldPos, partTransform) {
    const offset = partTransform?.position;
    if (!offset)
        return worldPos;
    const scale = partTransform?.scale;
    if (scale && (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1)) {
        return [
            (worldPos[0] - offset[0]) / scale[0],
            (worldPos[1] - offset[1]) / scale[1],
            (worldPos[2] - offset[2]) / scale[2],
        ];
    }
    return [
        worldPos[0] - offset[0],
        worldPos[1] - offset[1],
        worldPos[2] - offset[2],
    ];
}
/** BREP 路径：OCCT 平面/榫卯分割 + 分离位移。 */
function splitBrepPath(input, params) {
    const kernel = getBackends().kernel.occt;
    if (!kernel)
        throw new Error('[stdlib/split] no OCCT kernel');
    const inputSolid = brepOf(input);
    if (!inputSolid)
        throw new Error('[stdlib/split] input is not BREP');
    const cutMode = params.cutMode ?? 'plane';
    const normal = params.normal ?? [0, 0, 1];
    const offset = typeof params.offset === 'number' ? params.offset : 0;
    const inPlaneAngleDeg = typeof params.inPlaneAngleDeg === 'number' ? params.inPlaneAngleDeg : 0;
    const bbCenter = params.bbCenter ?? cad.bboxCenter(input);
    const bboxSize = params.bboxSize ?? cad.boundingBox(input).max.map((v, i) => v - cad.boundingBox(input).min[i]);
    const partTransform = getBackends().config.partTransform;
    const localBbCenter = worldToLocalVec3(bbCenter, partTransform);
    const scale = partTransform?.scale;
    const hasScale = scale && (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1);
    const localBboxSize = hasScale
        ? [bboxSize[0] / scale[0], bboxSize[1] / scale[1], bboxSize[2] / scale[2]]
        : bboxSize;
    const planeCenter = [
        localBbCenter[0] + offset * normal[0],
        localBbCenter[1] + offset * normal[1],
        localBbCenter[2] + offset * normal[2],
    ];
    const originOffset = normal[0] * planeCenter[0] + normal[1] * planeCenter[1] + normal[2] * planeCenter[2];
    const { widthDir, depthDir } = computeBasisFromNormal(normal, inPlaneAngleDeg);
    const basis = {
        normal: normal,
        widthDir: widthDir,
        depthDir: depthDir,
        planeCenter: planeCenter,
        originOffset,
    };
    let frontSolid;
    let backSolid;
    if (cutMode === 'dovetail') {
        const groove = {
            depth: params.grooveDepth ?? 0,
            depthTolerance: params.grooveDepthTolerance ?? 0,
            width: params.grooveWidth ?? 0,
            widthTolerance: params.grooveWidthTolerance ?? 0,
            flapsAngle: params.grooveFlapsAngle ?? 0,
        };
        const result = dovetailBooleanSplitBrep(kernel, inputSolid, basis, groove);
        frontSolid = result.front;
        backSolid = result.back;
    }
    else if (cutMode === 'dowel' || cutMode === 'straight-tenon' || cutMode === 'tenon') {
        const shape = cutMode === 'dowel' ? 'dowel' : 'tenon';
        let joineryParams;
        if (cutMode === 'dowel') {
            joineryParams = {
                size: params.dowelDiameter ?? 0,
                sizeTolerance: params.dowelDiameterTolerance ?? 0,
                height: params.dowelHeight ?? 0,
                heightTolerance: params.dowelHeightTolerance ?? 0,
            };
        }
        else {
            joineryParams = {
                size: params.tenonSideLength ?? 0,
                sizeTolerance: params.tenonSideLengthTolerance ?? 0,
                height: params.tenonHeight ?? 0,
                heightTolerance: params.tenonHeightTolerance ?? 0,
            };
        }
        const selectedSections = params.selectedSections;
        const result = dowelOrTenonBooleanSplitBrep(kernel, inputSolid, basis, shape, joineryParams, selectedSections ?? null);
        frontSolid = result.front;
        backSolid = result.back;
    }
    else {
        const splitResult = splitBrep(kernel, inputSolid, {
            normal: normal,
            originOffset,
            planeCenter: planeCenter,
        });
        frontSolid = splitResult.front;
        backSolid = splitResult.back;
    }
    // 分离位移：与 mesh 路径 finalizeExplode 同公式（bbox 对角线 2% + joinery 深度一半）
    const applyExplode = params.applyExplode ?? true;
    if (applyExplode) {
        const bboxDiagonal = Math.sqrt(localBboxSize[0] * localBboxSize[0] + localBboxSize[1] * localBboxSize[1] + localBboxSize[2] * localBboxSize[2]);
        const baseOffset = bboxDiagonal * 0.02;
        let joineryOffset = 0;
        if (cutMode === 'dovetail') {
            joineryOffset = (params.grooveDepth ?? 0) / 2;
        }
        else if (cutMode === 'dowel') {
            joineryOffset = (params.dowelHeight ?? 0) / 2;
        }
        else if (cutMode === 'straight-tenon' || cutMode === 'tenon') {
            joineryOffset = (params.tenonHeight ?? 0) / 2;
        }
        const frontOffset = baseOffset + joineryOffset;
        const backOffset = -(baseOffset + joineryOffset);
        const frontTranslated = translateBrep(kernel, frontSolid, [
            normal[0] * frontOffset,
            normal[1] * frontOffset,
            normal[2] * frontOffset,
        ]);
        const backTranslated = translateBrep(kernel, backSolid, [
            normal[0] * backOffset,
            normal[1] * backOffset,
            normal[2] * backOffset,
        ]);
        kernel.release(frontSolid);
        kernel.release(backSolid);
        frontSolid = frontTranslated;
        backSolid = backTranslated;
    }
    const frontShape = fromBrep(solidToShape(kernel, frontSolid), { solid: frontSolid });
    const backShape = fromBrep(solidToShape(kernel, backSolid), { solid: backSolid });
    return { front: frontShape, back: backShape };
}
/** mesh 路径：manifold-3d mesh-CSG。 */
async function splitMeshPath(input, params) {
    const cutMode = params.cutMode ?? 'plane';
    const normal = params.normal ?? [0, 0, 1];
    const offset = typeof params.offset === 'number' ? params.offset : 0;
    const inPlaneAngleDeg = typeof params.inPlaneAngleDeg === 'number' ? params.inPlaneAngleDeg : 0;
    const bbCenter = params.bbCenter ?? cad.bboxCenter(input);
    const bboxSize = params.bboxSize ?? cad.boundingBox(input).max.map((v, i) => v - cad.boundingBox(input).min[i]);
    const partTransform = getBackends().config.partTransform;
    const localBbCenter = worldToLocalVec3(bbCenter, partTransform);
    const scale = partTransform?.scale;
    const hasScale = scale && (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1);
    const localBboxSize = hasScale
        ? [bboxSize[0] / scale[0], bboxSize[1] / scale[1], bboxSize[2] / scale[2]]
        : bboxSize;
    const result = await cad.splitWithParams({
        shape: input,
        cutMode: cutMode,
        normal,
        offset,
        inPlaneAngleDeg,
        bbCenter: localBbCenter,
        bboxSize: localBboxSize,
        groove: params.grooveDepth !== undefined ? {
            depth: params.grooveDepth,
            depthTolerance: params.grooveDepthTolerance ?? 0,
            width: params.grooveWidth ?? 0,
            widthTolerance: params.grooveWidthTolerance ?? 0,
            flapsAngle: params.grooveFlapsAngle ?? 0,
        } : undefined,
        dowel: params.dowelDiameter !== undefined ? {
            diameter: params.dowelDiameter,
            diameterTolerance: params.dowelDiameterTolerance ?? 0,
            height: params.dowelHeight ?? 0,
            heightTolerance: params.dowelHeightTolerance ?? 0,
        } : undefined,
        tenon: params.tenonSideLength !== undefined ? {
            sideLength: params.tenonSideLength,
            sideLengthTolerance: params.tenonSideLengthTolerance ?? 0,
            height: params.tenonHeight ?? 0,
            heightTolerance: params.tenonHeightTolerance ?? 0,
        } : undefined,
        selectedSections: params.selectedSections,
        applyExplode: params.applyExplode ?? true,
    });
    return { front: solid(result.front), back: solid(result.back) };
}
export async function split(input, params = {}) {
    if (!input)
        throw new Error('[stdlib/split] no input geometry');
    if (params.normal !== undefined && params.normal !== null) {
        assertNonZeroVec3(params.normal, 'split.normal');
    }
    const path = dispatchPath([input], brepImpl);
    if (path === 'brep')
        return splitBrepPath(input, params);
    return splitMeshPath(input, params);
}
//# sourceMappingURL=split.js.map