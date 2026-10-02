/**
 * @faicad/cq-compat/assembly/browser — browser-safe entry.
 *
 * 不含 save()（其 import node:fs，浏览器打包会失败）。浏览器消费方用
 * buildAssembly/solve()/toCompound()；STEP 导出（save）仅在 Node 侧
 * （`@faicad/cq-compat/assembly` 根入口）提供。
 */

export {
  faceRef,
  pointRef,
  axisRef,
  constraint,
  constraintEx,
  buildAssembly,
  Color,
} from './assembly'
export type { CqAssembly, CqAssemblyMember } from './assembly'
