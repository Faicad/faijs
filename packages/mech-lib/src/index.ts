/**
 * @faicad/mech-lib — 第三方库样例（B4/C1 fixture 聚合入口）。
 *
 * 迁移自 test/faijs/libs/（P6）。mech-lib 模拟仓库外的第三方 CAD 库：
 * - mock-mech-brep / mock-mech-mesh：B4 fixture（第三方库 BREP/mesh 版）
 * - brepjs-gear：C1 fixture（brepjs 兼容层 adapter）
 *
 * 只依赖 @faicad/faijs-core（L4 依赖宿主包，L2/L1 不依赖——engine-library-contract §11.1）。
 *
 * ⚠️ 仅显式 re-export BREP 版：mock-mech-mesh 与 brepjs-gear 的符号（contractVersion /
 * makeHeadstock / makeBall）与 BREP 版同名，export * 会歧义；它们由测试直接 import
 * 文件路径（mock-lib.test.ts / c3-brepjs-scenario.test.ts），不走包入口。
 * （.fai.js 脚本里的 `import * as mech from 'mech-lib'` 是库机制运行时注入，与此无关。）
 */
export { contractVersion, makeHeadstock, makeBall } from './mock-mech-brep'
export type { SolidShape } from '@faicad/faijs-core/sdk'
