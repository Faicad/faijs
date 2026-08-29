/**
 * stdlib drill — 钻孔库函数
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh。
 * BREP 路径：OCCT cut（简单孔）或 threadBrep + cut（螺丝孔）。
 */
import { cad } from '@faicad/faijs-core/mesh';
import { drillBrep, solidToShape, matrixToArray, } from '@faicad/faijs-core/brep/brep-ops';
import { threadBrep } from './brepjs-mirror/threadFns';
import { getScrewSpec, threadToPitchMm } from '@faicad/faijs-core/primitives/screw/screw-db';
import * as THREE from 'three';
import { getBackends } from '@faicad/faijs-core/runtime-state';
import { solid, fromBrep, brepOf } from '@faicad/faijs-core/shape';
import { dispatchPath } from '@faicad/faijs-core/cad-runtime/backend-dispatch';
import { assertPositiveNumber, assertNumber, assertVec3 } from './assert';
/** BREP 实现标记（drill 有 OCCT 精确钻孔） */
const brepImpl = true;
// ── per-op 参数自校验（Phase 2.2；stdlib 被直接 import 时的防御层） ──
/** drill: diameter 必填 > 0；position（如有）为 vec3；depth（如有）为数字（<=0 表示通孔）。 */
export function assertDrillParams(params) {
    assertPositiveNumber(params.diameter, 'drill.diameter');
    if (params.position !== undefined && params.position !== null) {
        assertVec3(params.position, 'drill.position');
    }
    if (params.depth !== undefined && params.depth !== null) {
        assertNumber(params.depth, 'drill.depth');
    }
}
/** 世界坐标 → 几何体局部坐标（含单位缩放）。 */
function worldToLocalPosition(worldPos, partTransform) {
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
/** 解析 direction 枚举 → 钻孔方向向量。 */
function resolveDirection(params, faceNormal) {
    const directionEnum = params.direction ?? 'normal';
    if (directionEnum === 'normal')
        return faceNormal;
    if (directionEnum === 'x')
        return [-1, 0, 0];
    if (directionEnum === 'y')
        return [0, -1, 0];
    if (directionEnum === 'z')
        return [0, 0, -1];
    return faceNormal;
}
/** BREP 螺丝孔：底孔（圆柱 cut）+ 内螺纹（threadBrep + cut）。 */
function screwHoleBrep(kernel, upstreamSolid, params, direction, faceNormal, localPosition) {
    const diameter = params.diameter;
    const depth = params.depth;
    // 1. 底孔（圆柱 cut）
    const result = drillBrep(kernel, upstreamSolid, {
        diameter,
        depth,
        position: localPosition,
        direction,
        faceNormal,
        holeType: 'simple',
    });
    // 2. 螺纹（内螺纹 ridge，inward=true）
    const screwSystem = params.screwSystem ?? 'metric';
    const screwSpecIdx = params.screwSpecIdx ?? 5; // M6 default
    const screwThread = params.screwThread ?? 'coarse';
    const spec = getScrewSpec(screwSystem, screwSpecIdx);
    const pitch = threadToPitchMm(screwSystem, spec, screwThread);
    if (pitch > 0) {
        const threadSolid = threadBrep(kernel, {
            radius: diameter / 2,
            pitch,
            height: depth > 0 ? depth : 20,
            inward: true,
        });
        const dir = new THREE.Vector3(...direction).normalize();
        const fn = new THREE.Vector3(...faceNormal);
        if (dir.dot(fn) > 0)
            dir.negate();
        const zAxis = new THREE.Vector3(0, 0, 1);
        const quat = new THREE.Quaternion().setFromUnitVectors(zAxis, dir);
        const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(quat);
        const transMatrix = new THREE.Matrix4().makeTranslation(localPosition[0], localPosition[1], localPosition[2]);
        const fullMatrix = new THREE.Matrix4().multiplyMatrices(transMatrix, rotMatrix);
        const positionedThread = kernel.transform(threadSolid, matrixToArray(fullMatrix));
        kernel.release(threadSolid);
        const finalResult = kernel.cut(result, positionedThread);
        kernel.release(result);
        kernel.release(positionedThread);
        return finalResult;
    }
    return result;
}
/** BREP 路径：OCCT cut（简单孔）或 threadBrep + cut（螺丝孔）。 */
function drillBrepPath(input, params) {
    const kernel = getBackends().kernel.occt;
    if (!kernel)
        throw new Error('[stdlib/drill] no OCCT kernel');
    const inputSolid = brepOf(input);
    if (!inputSolid)
        throw new Error('[stdlib/drill] input is not BREP');
    const faceNormal = params.faceNormal;
    const direction = resolveDirection(params, faceNormal);
    const holeType = params.holeType;
    // 世界坐标 → 局部坐标（cad.load 返回的几何体在原始文件坐标系中）
    const partTransform = getBackends().config.partTransform;
    const localPosition = worldToLocalPosition(params.position, partTransform);
    let resultSolid;
    if (holeType === 'screw') {
        resultSolid = screwHoleBrep(kernel, inputSolid, params, direction, faceNormal, localPosition);
    }
    else {
        resultSolid = drillBrep(kernel, inputSolid, {
            diameter: params.diameter,
            depth: params.depth,
            position: localPosition,
            direction,
            faceNormal,
            holeType: 'simple',
        });
    }
    return fromBrep(solidToShape(kernel, resultSolid), { solid: resultSolid });
}
/** mesh 路径：manifold-3d mesh-CSG。 */
async function drillMeshPath(input, params) {
    const faceNormal = params.faceNormal;
    const direction = resolveDirection(params, faceNormal);
    const partTransform = getBackends().config.partTransform;
    const localPos = worldToLocalPosition(params.position, partTransform);
    const scale = partTransform?.scale;
    const unitScale = scale && (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1)
        ? scale[0]
        : 1;
    return cad.drill(input, {
        diameter: params.diameter / unitScale,
        depth: params.depth / unitScale,
        type: params.depth > 0 ? 'blind' : 'through',
        position: localPos,
        direction,
        faceNormal,
        tolerance: params.tolerance !== undefined ? params.tolerance / unitScale : undefined,
        holeType: params.holeType,
        screwSystem: params.screwSystem,
        screwSpecIdx: params.screwSpecIdx,
        screwThread: params.screwThread,
        screwHead: params.screwHead,
    });
}
export async function drill(input, params) {
    if (!input)
        throw new Error('[stdlib/drill] no input geometry');
    assertDrillParams(params);
    const path = dispatchPath([input], brepImpl);
    if (path === 'brep')
        return drillBrepPath(input, params);
    return solid(await drillMeshPath(input, params));
}
//# sourceMappingURL=drill.js.map