/**
 * stdlib text — 文字创建库函数（text）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */
import { cad } from '@faicad/faijs-core/mesh';
import { solidToShape } from '@faicad/faijs-core/brep/brep-ops';
import { textToSolid } from '@faicad/faijs-core/brep/text/text-to-solid';
import { ensureDefaultFont } from '@faicad/faijs-core/brep/text/fontRegistry';
import { getSolidBoundingBox } from '@faicad/faijs-core/brep/brep-utils';
import { containsCjk, loadSystemCjkFont } from '@faicad/faijs-core/primitives/text/cjk';
import { getBackends } from '@faicad/faijs-core/runtime-state';
import { solid, fromBrep } from '@faicad/faijs-core/shape';
import { dispatchPath } from '@faicad/faijs-core/cad-runtime/backend-dispatch';
import { assertPositiveNumber } from './assert';
/** BREP 实现标记（dispatchPath 判定用；text 有 OCCT 精确构造） */
const brepImpl = textToSolid;
/** text: text 必填非空字符串；size/depth 必填 > 0。 */
export function assertTextParams(params) {
    if (typeof params.text !== 'string' || params.text.trim() === '') {
        throw new Error(`[stdlib/text] text must be a non-empty string, got ${JSON.stringify(params.text)}`);
    }
    assertPositiveNumber(params.size, 'text.size');
    assertPositiveNumber(params.depth, 'text.depth');
}
/**
 * BREP 路径：opentype.js → OCCT wire/face → extrude → center + fromBrep 登记。
 *
 * 与 mesh 路径一样，当文本包含 CJK 字符但没有 CJK 字体时，
 * 将 CJK 字符替换为 '?' 以实现优雅降级。
 */
async function textBrep(params) {
    const kernel = getBackends().kernel.occt;
    if (!kernel)
        throw new Error('[stdlib/text] no OCCT kernel');
    await ensureDefaultFont();
    const text = params.text;
    const size = params.size;
    const depth = params.depth;
    // 如果文本包含 CJK 字符，检查是否有 CJK 字体
    let renderText = text;
    if (containsCjk(text)) {
        const cjkResult = await loadSystemCjkFont();
        if (!cjkResult) {
            // 无 CJK 字体：将 CJK 字符替换为 '?' 以实现优雅降级
            renderText = text.replace(/[\u4E00-\u9FFF\u3400-\u4DBF\u2F800-\u2FA1F\u3000-\u303F\uFF00-\uFFEF]/g, '?');
        }
    }
    // 将文字转换为 OCCT solid
    const rawSolid = textToSolid(kernel, renderText, {
        fontSize: size,
        depth,
    });
    // Center the solid to match mesh path behavior:
    // X/Z centered at origin, Y bottom aligned to 0
    const bbox = getSolidBoundingBox(kernel, rawSolid);
    const cx = (bbox.min[0] + bbox.max[0]) / 2;
    const cz = (bbox.min[2] + bbox.max[2]) / 2;
    const centeredSolid = kernel.translate(rawSolid, -cx, -bbox.min[1], -cz);
    kernel.release(rawSolid);
    return fromBrep(solidToShape(kernel, centeredSolid), { solid: centeredSolid });
}
export async function text(inputOrParams, maybeParams) {
    // 兼容两种调用形态：`cad.text({ text, size, depth })`（创建类）与
    // `cad.text(part0, { text, size, depth })`（历史 fixture 带输入参数，输入被忽略）。
    const params = (maybeParams ?? inputOrParams ?? {});
    assertTextParams(params);
    const path = dispatchPath([], brepImpl);
    if (path === 'brep')
        return textBrep(params);
    return solid(await cad.text({ text: params.text, size: params.size, depth: params.depth }));
}
//# sourceMappingURL=text.js.map