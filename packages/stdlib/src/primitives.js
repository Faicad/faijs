/**
 * stdlib primitives — 基本体创建库函数（box/sphere/cylinder/cone/wedge）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */
import { cad } from '@faicad/faijs-core/mesh';
import { primitiveToBrepSolid } from '@faicad/faijs-core/primitives/brep-primitives';
import { solidToShape } from '@faicad/faijs-core/brep/brep-ops';
import { getBackends } from '@faicad/faijs-core/runtime-state';
import { solid, fromBrep } from '@faicad/faijs-core/shape';
import { dispatchPath } from '@faicad/faijs-core/cad-runtime/backend-dispatch';
import { assertPositiveNumber, assertNonNegativeNumber, assertNumberOrVec3 } from './assert';
// ── per-op 参数自校验（Phase 2.2；stdlib 被直接 import 时的防御层） ──
/** box: size 必填（number 或 vec3），> 0。 */
export function assertBoxParams(params) {
    assertNumberOrVec3(params.size, 'box.size');
}
/** sphere: radius 必填，> 0。 */
export function assertSphereParams(params) {
    assertPositiveNumber(params.radius, 'sphere.radius');
}
/** cylinder: radius/height 必填，> 0。 */
export function assertCylinderParams(params) {
    assertPositiveNumber(params.radius, 'cylinder.radius');
    assertPositiveNumber(params.height, 'cylinder.height');
}
/** cone: radiusBottom/height 必填 > 0，radiusTop >= 0。 */
export function assertConeParams(params) {
    assertPositiveNumber(params.radiusBottom, 'cone.radiusBottom');
    assertNonNegativeNumber(params.radiusTop, 'cone.radiusTop');
    assertPositiveNumber(params.height, 'cone.height');
}
/** wedge: width/height/angle/length 必填，> 0。 */
export function assertWedgeParams(params) {
    assertPositiveNumber(params.width, 'wedge.width');
    assertPositiveNumber(params.height, 'wedge.height');
    assertPositiveNumber(params.angle, 'wedge.angle');
    assertPositiveNumber(params.length, 'wedge.length');
}
/** BREP 实现标记（dispatchPath 判定用；primitives 有 OCCT 精确构造） */
const brepImpl = primitiveToBrepSolid;
/** BREP 路径：OCCT 精确构造 + 三角化 + fromBrep 登记（基本体无面演化）。 */
function primitiveBrep(op, params) {
    const kernel = getBackends().kernel.occt;
    if (!kernel)
        throw new Error('[stdlib/box] no OCCT kernel');
    const type = op === 'box' ? 'cube' : op;
    const result = primitiveToBrepSolid(kernel, type, params);
    return fromBrep(solidToShape(kernel, result.solid, params.segments), { solid: result.solid });
}
export function box(params) {
    assertBoxParams(params);
    const path = dispatchPath([], brepImpl);
    if (path === 'brep')
        return primitiveBrep('box', params);
    return solid(cad.box(params));
}
export function sphere(params) {
    assertSphereParams(params);
    const path = dispatchPath([], brepImpl);
    if (path === 'brep')
        return primitiveBrep('sphere', params);
    return solid(cad.sphere(params));
}
export function cylinder(params) {
    assertCylinderParams(params);
    const path = dispatchPath([], brepImpl);
    if (path === 'brep')
        return primitiveBrep('cylinder', params);
    return solid(cad.cylinder(params));
}
export function cone(params) {
    assertConeParams(params);
    const path = dispatchPath([], brepImpl);
    if (path === 'brep')
        return primitiveBrep('cone', params);
    return solid(cad.cone(params));
}
export function wedge(params) {
    assertWedgeParams(params);
    const path = dispatchPath([], brepImpl);
    if (path === 'brep')
        return primitiveBrep('wedge', params);
    return solid(cad.wedge(params));
}
//# sourceMappingURL=primitives.js.map