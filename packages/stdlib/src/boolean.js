/**
 * stdlib boolean — 布尔库函数（union/subtract/intersect，多输入）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 *          docs/plans/2026-08-27-faijs-language-normalization-implementation.md §3.3
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，BREP 路径用 *WithHistory 收集面演化。
 *
 * 阶段 1：拆为三个薄函数 union/subtract/intersect + 兼容 boolean 导出（过渡）。
 * 阶段 3 将删除 boolean 兼容导出。
 */
import { cad } from '@faicad/faijs-core/mesh';
import { solidToShape } from '@faicad/faijs-core/brep/brep-ops';
import { cutWithHistoryBrep, fuseWithHistoryBrep, intersectWithHistoryBrep, } from '@faicad/faijs-core/brep/face-evolution';
import { getBackends, keepHidden } from '@faicad/faijs-core/runtime-state';
import { solid, fromBrep, brepOf } from '@faicad/faijs-core/shape';
import { reconcileBrepInputs } from './reconcile';
import { dispatchPath } from '@faicad/faijs-core/cad-runtime/backend-dispatch';
/** BREP 实现标记（boolean 有 OCCT 精确布尔） */
const brepImpl = true;
// ── 共享内部实现 ──
/** BREP 路径：fuse/cut/common（*WithHistory 封装，收集面演化）。 */
function booleanBrep(inputs, operation) {
    const kernel = getBackends().kernel.occt;
    if (!kernel)
        throw new Error('[stdlib/boolean] no OCCT kernel');
    const inputSolids = inputs.map((s) => brepOf(s));
    if (inputSolids.some((s) => !s)) {
        throw new Error('[stdlib/boolean] input is not BREP');
    }
    let resultSolid;
    let lastEvolution;
    const applyBinary = (a, b) => {
        if (operation === 'union')
            return fuseWithHistoryBrep(kernel, a, b);
        if (operation === 'subtract')
            return cutWithHistoryBrep(kernel, a, b);
        return intersectWithHistoryBrep(kernel, a, b);
    };
    const first = applyBinary(inputSolids[0], inputSolids[1]);
    resultSolid = first.result;
    lastEvolution = first.faceEvolution;
    for (let i = 2; i < inputSolids.length; i++) {
        const prev = resultSolid;
        const r = applyBinary(prev, inputSolids[i]);
        resultSolid = r.result;
        lastEvolution = r.faceEvolution;
        kernel.release(prev);
    }
    return fromBrep(solidToShape(kernel, resultSolid), lastEvolution ? { solid: resultSolid, faceEvolution: lastEvolution } : { solid: resultSolid });
}
/** mesh 路径：manifold-3d mesh-CSG。 */
async function booleanMesh(inputs, operation) {
    if (inputs.length < 2) {
        if (inputs.length === 1)
            return inputs[0];
        throw new Error('[stdlib/boolean] boolean needs at least 1 input');
    }
    if (operation === 'union')
        return cad.union(inputs[0], inputs[1], ...inputs.slice(2));
    if (operation === 'subtract') {
        let result = await cad.subtract(inputs[0], inputs[1]);
        for (let i = 2; i < inputs.length; i++)
            result = await cad.subtract(result, inputs[i]);
        return result;
    }
    let result = await cad.intersect(inputs[0], inputs[1]);
    for (let i = 2; i < inputs.length; i++)
        result = await cad.intersect(result, inputs[i]);
    return result;
}
/**
 * 共享内部实现：operation 从参数改为入参。
 *
 * 函数体 keep 声明（keep-syntax 设计 §2.5）：union/subtract/intersect 保留其
 * 输入且隐藏（R5：3d_editor 现状）——keepHidden 使源变量保持终端但 canvas
 * 不渲染，只有布尔结果正常显示。
 */
async function booleanImpl(operation, inputs) {
    if (inputs.length > 0)
        keepHidden(...inputs);
    const path = dispatchPath(inputs, brepImpl);
    if (path === 'brep')
        return booleanBrep(inputs, operation);
    // 混合/断链时刻：BREP 侧输入先归约为合法 2-manifold 网格，mesh 侧原样透传
    return solid(await booleanMesh(reconcileBrepInputs(inputs), operation));
}
// ── 三个薄导出（多输入 variadic） ──
// P5：编译产物不再发射末参 exec，纯 variadic（P2 的 rest.pop() 过渡已移除）。
export function union(...shapes) {
    return booleanImpl('union', shapes);
}
export function subtract(...shapes) {
    return booleanImpl('subtract', shapes);
}
export function intersect(...shapes) {
    return booleanImpl('intersect', shapes);
}
//# sourceMappingURL=boolean.js.map