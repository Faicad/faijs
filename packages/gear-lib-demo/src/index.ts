/**
 * @faicad/gear-lib-demo — 第三方库样例（B4/C1 fixture 聚合入口）。
 *
 * 迁移自 test/faijs/libs/（P6）。gear-lib-demo 模拟仓库外的第三方 CAD 库：
 * - mock-mech-ing / mock-mech-mesh：B4 fixture（第三方库 BREP/mesh 版）
 * - gear：C2 fixture（齿轮/螺纹工厂，`import * as gear from '@faicad/gear-lib-demo'` 目标）
 *
 * P24（§8.1）起依赖 `@faicad/faijs`（L4 依赖宿主包，L2/L1 不依赖）。
 *
 * ⚠️ mock-mech-mesh 的符号同 BREP 版（contractVersion / makeHeadstock / makeBall），
 * export * 会歧义；mock-mech-mesh 由测试直接 import 文件路径（mock-lib.test.ts），
 * 不走包入口。gear 符号无同名冲突，完整 re-export。
 */
export * from './gear.js'
export * as mockBrep from './mock-mech-brep.js'
export { contractVersion, makeHeadstock, makeBall } from './mock-mech-brep.js'
export type { SolidShape } from '@faicad/faijs-core/sdk'